import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { nowIso } from "../../../utils/time";
import { ftsQuery } from "../../../utils/text";
import type { MemoryBackend } from "../../core/backend";
import type {
  ConversationTurn,
  EventMeta,
  GeneratedSkill,
  InteractionEvent,
  JsonValue,
  L15Judgment,
  L1EvidenceEntry,
  L1EvidenceStatus,
  LineageLink,
  LineageSourceKind,
  MemoryAtom,
  MemoryRecallFallback,
  MemoryScenario,
  NewConversationTurn,
  NewGeneratedSkill,
  NewInteractionEvent,
  NewL15Judgment,
  NewL1EvidenceEntry,
  NewLineageLink,
  NewMemoryAtom,
  NewMemoryScenario,
  NewOffloadRef,
  NewPersonaProfile,
  NewTaskBoundary,
  NewTaskCanvas,
  NewTaskGraphNode,
  OffloadRef,
  PersonaProfile,
  PipelineCheckpointValue,
  TaskBoundary,
  TaskCanvas,
  TaskCanvasRecall,
  TaskCanvasStatus,
  TaskGraphNode,
  UpsertMemoryAtomResult,
} from "../../core/types";
import { migrateSqliteMemory } from "./migrate";
import { canonicalizeMemoryAtomText, mergeNumberSets } from "./canonical";
import { deserializeVector, embedTextToVector, ensureSqliteVecTable, isZeroVector, loadSqliteVec, serializeVector } from "./vec";
import type { Database } from "bun:sqlite";

type SqliteMemoryBackendOptions = {
  dataDir: string;
  refsDir: string;
  canvasDir: string;
  taskCanvasDir?: string;
  generatedSkillsDir?: string;
  sqliteVecEnabled?: boolean;
};

const MAX_VECTOR_DISTANCE = 0.95;

function parseJsonValue(raw: string): JsonValue {
  return JSON.parse(raw) as JsonValue;
}

function parseEventMeta(raw: string): EventMeta {
  return JSON.parse(raw) as EventMeta;
}

function parseNumberArray(raw: string): number[] {
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === "number") : [];
}

function parseStringArray(raw: string): string[] {
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
}

function safePathSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "task";
}

function safeChatSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "chat";
}

function mapTaskCanvasRow(row: {
  id: number;
  chat_id: string;
  user_id: string;
  label: string;
  file_path: string;
  status: TaskCanvasStatus;
  created_at: string;
  updated_at: string;
}): TaskCanvas {
  return {
    id: row.id,
    chatId: row.chat_id,
    userId: row.user_id,
    label: row.label,
    filePath: row.file_path,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapL1EvidenceRow(row: {
  id: number;
  chat_id: string;
  user_id: string;
  task_id: number | null;
  node_id: string;
  tool_call_id: string | null;
  tool_name: string;
  args_json: string;
  summary: string;
  result_ref: string | null;
  score: number;
  mmd_node_id: string | null;
  status: string;
  created_at: string;
}): L1EvidenceEntry {
  return {
    id: row.id,
    chatId: row.chat_id,
    userId: row.user_id,
    taskId: row.task_id ?? undefined,
    nodeId: row.node_id,
    toolCallId: row.tool_call_id ?? undefined,
    toolName: row.tool_name,
    args: parseEventMeta(row.args_json),
    summary: row.summary,
    resultRef: row.result_ref ?? undefined,
    score: row.score,
    mmdNodeId: row.mmd_node_id ?? undefined,
    status: row.status as L1EvidenceStatus,
    createdAt: row.created_at,
  };
}

function parseSearchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[%_]/g, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function scenarioSearchScore(title: string, bodyMarkdown: string, terms: string[]): number {
  if (terms.length === 0) return 0;

  const titleText = title.toLowerCase();
  const bodyText = bodyMarkdown.toLowerCase();
  return terms.reduce((score, term) => {
    let nextScore = score;
    if (titleText.includes(term)) nextScore += 2;
    if (bodyText.includes(term)) nextScore += 1;
    return nextScore;
  }, 0);
}

function serializeCheckpointValue(value: PipelineCheckpointValue): string {
  return JSON.stringify(value);
}

function deserializeCheckpointValue(raw: string): PipelineCheckpointValue {
  try {
    return parseJsonValue(raw);
  } catch {
    return raw;
  }
}

function vectorDistance(left: Float32Array, right: Float32Array): number {
  let sum = 0;
  const size = Math.max(left.length, right.length);

  for (let index = 0; index < size; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    sum += delta * delta;
  }

  return Math.sqrt(sum);
}

export class SqliteMemoryBackend implements MemoryBackend {
  private vecReady = false;

  constructor(
    private readonly db: Database,
    private readonly options: SqliteMemoryBackendOptions,
  ) {}

  private indexMemoryAtomVector(atomId: number, embeddingJson: string): void {
    if (!this.vecReady) {
      return;
    }

    this.db.query(`DELETE FROM memory_atoms_vec WHERE rowid = ?`).run(atomId);
    this.db.query(`INSERT INTO memory_atoms_vec(rowid, embedding) VALUES (?, ?)`).run(atomId, deserializeVector(embeddingJson));
  }

  private replaceMemoryAtomSearchRow(atomId: number, userId: string, text: string): void {
    this.db.query(`DELETE FROM memory_atoms_fts WHERE atom_id = ? AND user_id = ?`).run(String(atomId), userId);
    this.db.query(`INSERT INTO memory_atoms_fts (text, atom_id, user_id) VALUES (?, ?, ?)`).run(text, String(atomId), userId);
  }

  private upsertMemoryAtomEmbedding(atomId: number, userId: string, embeddingJson: string, updatedAt: string): void {
    this.db
      .query(`
        INSERT INTO memory_atom_embeddings (atom_id, user_id, embedding_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(atom_id) DO UPDATE SET
          user_id = excluded.user_id,
          embedding_json = excluded.embedding_json,
          updated_at = excluded.updated_at
      `)
      .run(atomId, userId, embeddingJson, updatedAt);
    this.indexMemoryAtomVector(atomId, embeddingJson);
  }

  private rebuildMemoryAtomVectorIndex(): void {
    if (!this.vecReady) {
      return;
    }

    const rows = this.db
      .query(`SELECT atom_id, embedding_json FROM memory_atom_embeddings ORDER BY atom_id ASC`)
      .all() as Array<{ atom_id: number; embedding_json: string }>;

    this.db.exec(`DELETE FROM memory_atoms_vec`);
    for (const row of rows) {
      this.db.query(`INSERT INTO memory_atoms_vec(rowid, embedding) VALUES (?, ?)`).run(row.atom_id, deserializeVector(row.embedding_json));
    }
  }

  async init(): Promise<void> {
    migrateSqliteMemory(this.db);

    if (!this.vecReady && this.options.sqliteVecEnabled !== false) {
      loadSqliteVec(this.db);
      ensureSqliteVecTable(this.db);
      this.vecReady = true;
      this.rebuildMemoryAtomVectorIndex();
    }

    await Promise.all([
      mkdir(this.options.dataDir, { recursive: true }),
      mkdir(this.options.refsDir, { recursive: true }),
      mkdir(this.options.canvasDir, { recursive: true }),
      mkdir(this.options.taskCanvasDir ?? join(this.options.dataDir, "task-canvases"), { recursive: true }),
      mkdir(this.options.generatedSkillsDir ?? join(this.options.dataDir, "generated-skills"), { recursive: true }),
    ]);
  }

  async insertInteractionEvent(event: NewInteractionEvent): Promise<number> {
    const createdAt = event.createdAt ?? nowIso();
    const result = this.db
      .query(`
        INSERT INTO interaction_events (chat_id, user_id, type, content, tool_name, tool_call_id, offloaded, meta_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        event.chatId,
        event.userId,
        event.type,
        event.content,
        event.toolName ?? null,
        event.toolCallId ?? null,
        event.offloaded ? 1 : 0,
        JSON.stringify(event.meta ?? {}),
        createdAt,
      );

    return Number(result.lastInsertRowid);
  }

  async insertConversationTurn(turn: NewConversationTurn): Promise<number> {
    const createdAt = turn.createdAt ?? nowIso();
    const result = this.db
      .query(`
        INSERT INTO conversations (chat_id, user_id, role, content, meta_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(turn.chatId, turn.userId, turn.role, turn.content, JSON.stringify(turn.meta ?? {}), createdAt);

    const id = Number(result.lastInsertRowid);
    this.db
      .query(`INSERT INTO conversation_fts (content, conversation_id, chat_id, user_id) VALUES (?, ?, ?, ?)`)
      .run(turn.content, String(id), turn.chatId, turn.userId);

    return id;
  }

  async listInteractionEvents(userId: string, chatId: string, limit: number): Promise<InteractionEvent[]> {
    const rows = this.db
      .query(`
        SELECT id, chat_id, user_id, type, content, tool_name, tool_call_id, offloaded, meta_json, created_at
        FROM interaction_events
        WHERE user_id = ? AND chat_id = ?
        ORDER BY id DESC
        LIMIT ?
      `)
      .all(userId, chatId, limit) as Array<{
      id: number;
      chat_id: string;
      user_id: string;
      type: InteractionEvent["type"];
      content: string;
      tool_name: string | null;
      tool_call_id: string | null;
      offloaded: number;
      meta_json: string;
      created_at: string;
    }>;

    return rows.reverse().map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      userId: row.user_id,
      type: row.type,
      content: row.content,
      toolName: row.tool_name ?? undefined,
      toolCallId: row.tool_call_id ?? undefined,
      offloaded: Boolean(row.offloaded),
      meta: parseEventMeta(row.meta_json),
      createdAt: row.created_at,
    }));
  }

  async listConversationTurns(userId: string, chatId: string, limit: number): Promise<ConversationTurn[]> {
    const rows = this.db
      .query(`
        SELECT id, chat_id, user_id, role, content, meta_json, created_at
        FROM conversations
        WHERE user_id = ? AND chat_id = ?
        ORDER BY id DESC
        LIMIT ?
      `)
      .all(userId, chatId, limit) as Array<{
      id: number;
      chat_id: string;
      user_id: string;
      role: ConversationTurn["role"];
      content: string;
      meta_json: string;
      created_at: string;
    }>;

    return rows.reverse().map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      userId: row.user_id,
      role: row.role,
      content: row.content,
      meta: parseEventMeta(row.meta_json),
      createdAt: row.created_at,
    }));
  }

  async listPendingConversationEvidence(userId: string, afterConversationId: number, limit: number): Promise<ConversationTurn[]> {
    const rows = this.db
      .query(`
        SELECT id, chat_id, user_id, role, content, meta_json, created_at
        FROM conversations
        WHERE user_id = ? AND id > ? AND role IN ('user', 'assistant')
        ORDER BY id ASC
        LIMIT ?
      `)
      .all(userId, afterConversationId, limit) as Array<{
      id: number;
      chat_id: string;
      user_id: string;
      role: ConversationTurn["role"];
      content: string;
      meta_json: string;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      userId: row.user_id,
      role: row.role,
      content: row.content,
      meta: parseEventMeta(row.meta_json),
      createdAt: row.created_at,
    }));
  }

  async listMemoryAtoms(userId: string, limit: number): Promise<MemoryAtom[]> {
    const rows = this.db
      .query(`
        SELECT id, user_id, text, importance, source_turn_ids_json, source_layer, created_at, updated_at
        FROM memory_atoms
        WHERE user_id = ?
        ORDER BY importance DESC, updated_at DESC, id DESC
        LIMIT ?
      `)
      .all(userId, limit) as Array<{
      id: number;
      user_id: string;
      text: string;
      importance: number;
      source_turn_ids_json: string;
      source_layer: MemoryAtom["sourceLayer"];
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      text: row.text,
      importance: row.importance,
      sourceConversationIds: parseNumberArray(row.source_turn_ids_json),
      sourceLayer: row.source_layer,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async countMemoryAtoms(userId: string): Promise<number> {
    const row = this.db
      .query(`SELECT COUNT(*) AS count FROM memory_atoms WHERE user_id = ?`)
      .get(userId) as { count: number } | null;

    return row?.count ?? 0;
  }

  async searchMemoryAtoms(userId: string, query: string, limit: number): Promise<MemoryAtom[]> {
    const fts = ftsQuery(query);
    if (!fts) {
      return this.listMemoryAtoms(userId, limit);
    }

    const rows = this.db
      .query(`
        SELECT m.id, m.user_id, m.text, m.importance, m.source_turn_ids_json, m.source_layer, m.created_at, m.updated_at
        FROM memory_atoms_fts f
        JOIN memory_atoms m ON m.id = CAST(f.atom_id AS INTEGER)
        WHERE memory_atoms_fts MATCH ? AND f.user_id = ?
        ORDER BY m.importance DESC, m.updated_at DESC, m.id DESC
        LIMIT ?
      `)
      .all(fts, userId, limit) as Array<{
      id: number;
      user_id: string;
      text: string;
      importance: number;
      source_turn_ids_json: string;
      source_layer: MemoryAtom["sourceLayer"];
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      text: row.text,
      importance: row.importance,
      sourceConversationIds: parseNumberArray(row.source_turn_ids_json),
      sourceLayer: row.source_layer,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async searchMemoryAtomsByVector(userId: string, query: string, limit: number): Promise<MemoryAtom[]> {
    if (!this.vecReady || limit <= 0) {
      return [];
    }

    const vector = embedTextToVector(query);
    if (isZeroVector(vector)) {
      return [];
    }

    const rows = this.db
      .query(`
        SELECT m.id, m.user_id, m.text, m.importance, m.source_turn_ids_json, m.source_layer, m.created_at, m.updated_at, e.embedding_json
        FROM memory_atom_embeddings e
        JOIN memory_atoms m ON m.id = e.atom_id
        WHERE m.user_id = ?
      `)
      .all(userId) as Array<{
      id: number;
      user_id: string;
      text: string;
      importance: number;
      source_turn_ids_json: string;
      source_layer: MemoryAtom["sourceLayer"];
      created_at: string;
      updated_at: string;
      embedding_json: string;
    }>;

    return rows
      .map((row) => ({
        row,
        distance: vectorDistance(vector, deserializeVector(row.embedding_json)),
      }))
      .filter(({ distance }) => distance <= MAX_VECTOR_DISTANCE)
      .sort((left, right) => {
        return left.distance - right.distance
          || right.row.importance - left.row.importance
          || right.row.updated_at.localeCompare(left.row.updated_at)
          || right.row.id - left.row.id;
      })
      .slice(0, limit)
      .map(({ row }) => ({
        id: row.id,
        userId: row.user_id,
        text: row.text,
        importance: row.importance,
        sourceConversationIds: parseNumberArray(row.source_turn_ids_json),
        sourceLayer: row.source_layer,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
  }

  async listExistingMemoryAtomIds(userId: string, atomIds: number[]): Promise<Set<number>> {
    if (atomIds.length === 0) {
      return new Set();
    }

    const placeholders = atomIds.map(() => "?").join(", ");
    const rows = this.db
      .query(`
        SELECT id
        FROM memory_atoms
        WHERE user_id = ? AND id IN (${placeholders})
      `)
      .all(userId, ...atomIds) as Array<{ id: number }>;

    return new Set(rows.map((row) => row.id));
  }

  async upsertMemoryAtom(atom: NewMemoryAtom): Promise<UpsertMemoryAtomResult> {
    const text = atom.text.trim();
    if (!text) {
      throw new Error("Memory atom text cannot be empty");
    }

    const canonicalText = canonicalizeMemoryAtomText(text);
    if (!canonicalText) {
      throw new Error("Memory atom canonical text cannot be empty");
    }

    const existing = this.db
      .query(`
        SELECT id, user_id, text, canonical_text, importance, source_turn_ids_json, source_layer, created_at, updated_at
        FROM memory_atoms
        WHERE user_id = ? AND canonical_text = ?
        ORDER BY CASE WHEN text = ? THEN 0 ELSE 1 END, id ASC
        LIMIT 1
      `)
      .get(atom.userId, canonicalText, text) as {
      id: number;
      user_id: string;
      text: string;
      canonical_text: string;
      importance: number;
      source_turn_ids_json: string;
      source_layer: MemoryAtom["sourceLayer"];
      created_at: string;
      updated_at: string;
    } | null;

    const sourceConversationIds = atom.sourceConversationIds ?? [];
    const sourceLayer = atom.sourceLayer ?? "L1";
    const importance = atom.importance ?? 3;
    const updatedAt = nowIso();
    const embeddingJson = serializeVector(embedTextToVector(text));

    if (existing) {
      const mergedSourceConversationIds = mergeNumberSets(
        parseNumberArray(existing.source_turn_ids_json),
        sourceConversationIds,
      );
      const mergedImportance = Math.max(existing.importance, importance);

      this.db
        .query(`
          UPDATE memory_atoms
          SET text = ?, canonical_text = ?, importance = ?, source_turn_ids_json = ?, source_layer = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          text,
          canonicalText,
          mergedImportance,
          JSON.stringify(mergedSourceConversationIds),
          sourceLayer,
          updatedAt,
          existing.id,
        );

      this.replaceMemoryAtomSearchRow(existing.id, atom.userId, text);
      this.upsertMemoryAtomEmbedding(existing.id, atom.userId, embeddingJson, updatedAt);

      return {
        created: false,
        atom: {
          id: existing.id,
          userId: existing.user_id,
          text,
          importance: mergedImportance,
          sourceConversationIds: mergedSourceConversationIds,
          sourceLayer,
          createdAt: existing.created_at,
          updatedAt,
        },
      };
    }

    const createdAt = updatedAt;
    const result = this.db
      .query(`
        INSERT INTO memory_atoms (user_id, text, canonical_text, importance, source_turn_ids_json, source_layer, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(atom.userId, text, canonicalText, importance, JSON.stringify(sourceConversationIds), sourceLayer, createdAt, updatedAt);

    const id = Number(result.lastInsertRowid);
    this.replaceMemoryAtomSearchRow(id, atom.userId, text);
    this.upsertMemoryAtomEmbedding(id, atom.userId, embeddingJson, updatedAt);

    return {
      created: true,
      atom: {
        id,
        userId: atom.userId,
        text,
        importance,
        sourceConversationIds,
        sourceLayer,
        createdAt,
        updatedAt,
      },
    };
  }

  async insertMemoryScenario(scenario: NewMemoryScenario): Promise<number> {
    const createdAt = nowIso();
    const result = this.db
      .query(`
        INSERT INTO memory_scenarios (user_id, title, body_markdown, atom_ids_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(scenario.userId, scenario.title, scenario.bodyMarkdown, JSON.stringify(scenario.atomIds), createdAt, createdAt);

    return Number(result.lastInsertRowid);
  }

  async countMemoryScenarios(userId: string): Promise<number> {
    const row = this.db
      .query(`SELECT COUNT(*) AS count FROM memory_scenarios WHERE user_id = ?`)
      .get(userId) as { count: number } | null;

    return row?.count ?? 0;
  }

  async searchMemoryScenarios(userId: string, query: string, limit: number): Promise<MemoryScenario[]> {
    const rows = this.db
      .query(`
        SELECT id, user_id, title, body_markdown, atom_ids_json, created_at, updated_at
        FROM memory_scenarios
        WHERE user_id = ?
        ORDER BY updated_at DESC, id DESC
      `)
      .all(userId) as Array<{
      id: number;
      user_id: string;
      title: string;
      body_markdown: string;
      atom_ids_json: string;
      created_at: string;
      updated_at: string;
    }>;

    const terms = parseSearchTerms(query);
    return rows
      .map((row) => ({
        id: row.id,
        userId: row.user_id,
        title: row.title,
        bodyMarkdown: row.body_markdown,
        atomIds: parseNumberArray(row.atom_ids_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        score: scenarioSearchScore(row.title, row.body_markdown, terms),
      }))
      .filter((row) => terms.length === 0 || row.score > 0)
      .sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt) || right.id - left.id)
      .slice(0, limit)
      .map(({ score: _score, ...scenario }) => scenario);
  }

  async getPersona(userId: string): Promise<PersonaProfile | undefined> {
    const row = this.db
      .query(`
        SELECT user_id, markdown, source_scenario_ids_json, updated_at
        FROM personas
        WHERE user_id = ?
      `)
      .get(userId) as {
      user_id: string;
      markdown: string;
      source_scenario_ids_json: string;
      updated_at: string;
    } | null;

    return row
      ? {
          userId: row.user_id,
          markdown: row.markdown,
          sourceScenarioIds: parseNumberArray(row.source_scenario_ids_json),
          updatedAt: row.updated_at,
        }
      : undefined;
  }

  async upsertPersona(profile: NewPersonaProfile): Promise<PersonaProfile> {
    const updatedAt = nowIso();
    this.db
      .query(`
        INSERT INTO personas (user_id, markdown, source_scenario_ids_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          markdown = excluded.markdown,
          source_scenario_ids_json = excluded.source_scenario_ids_json,
          updated_at = excluded.updated_at
      `)
      .run(profile.userId, profile.markdown, JSON.stringify(profile.sourceScenarioIds), updatedAt);

    return {
      userId: profile.userId,
      markdown: profile.markdown,
      sourceScenarioIds: profile.sourceScenarioIds,
      updatedAt,
    };
  }

  async insertLineageLink(link: NewLineageLink): Promise<number> {
    const createdAt = nowIso();
    const result = this.db
      .query(`
        INSERT OR IGNORE INTO lineage_links (user_id, source_kind, source_id, target_kind, target_id, link_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(link.userId, link.sourceKind, link.sourceId, link.targetKind, link.targetId, link.linkType, createdAt);

    if (Number(result.changes) === 0) {
      const existing = this.db
        .query(`
          SELECT id FROM lineage_links
          WHERE user_id = ? AND source_kind = ? AND source_id = ? AND target_kind = ? AND target_id = ? AND link_type = ?
        `)
        .get(link.userId, link.sourceKind, link.sourceId, link.targetKind, link.targetId, link.linkType) as { id: number } | null;
      return existing?.id ?? 0;
    }

    return Number(result.lastInsertRowid);
  }

  async listLineageTargets(userId: string, sourceKind: LineageSourceKind, sourceId: string): Promise<LineageLink[]> {
    const rows = this.db
      .query(`
        SELECT id, user_id, source_kind, source_id, target_kind, target_id, link_type, created_at
        FROM lineage_links
        WHERE user_id = ? AND source_kind = ? AND source_id = ?
        ORDER BY id ASC
      `)
      .all(userId, sourceKind, sourceId) as Array<{
      id: number;
      user_id: string;
      source_kind: LineageLink["sourceKind"];
      source_id: string;
      target_kind: LineageLink["targetKind"];
      target_id: string;
      link_type: string;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      sourceKind: row.source_kind,
      sourceId: row.source_id,
      targetKind: row.target_kind,
      targetId: row.target_id,
      linkType: row.link_type,
      createdAt: row.created_at,
    }));
  }

  async getFallbackChain(userId: string, missingKind: LineageSourceKind, missingId: string): Promise<MemoryRecallFallback[]> {
    const links = await this.listLineageTargets(userId, missingKind, missingId);
    return links.map((link) => ({
      missingKind: link.sourceKind,
      missingId: link.sourceId,
      fallbackKind: link.targetKind,
      fallbackId: link.targetId,
      linkType: link.linkType,
    }));
  }

  async searchConversationTurns(userId: string, query: string, limit: number): Promise<ConversationTurn[]> {
    const fts = ftsQuery(query);
    if (!fts) {
      return [];
    }

    const rows = this.db
      .query(`
        SELECT c.id, c.chat_id, c.user_id, c.role, c.content, c.meta_json, c.created_at
        FROM conversation_fts f
        JOIN conversations c ON c.id = CAST(f.conversation_id AS INTEGER)
        WHERE conversation_fts MATCH ? AND f.user_id = ?
        ORDER BY c.id DESC
        LIMIT ?
      `)
      .all(fts, userId, limit) as Array<{
      id: number;
      chat_id: string;
      user_id: string;
      role: ConversationTurn["role"];
      content: string;
      meta_json: string;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      userId: row.user_id,
      role: row.role,
      content: row.content,
      meta: parseEventMeta(row.meta_json),
      createdAt: row.created_at,
    }));
  }

  async countConversationTurns(userId: string): Promise<number> {
    const row = this.db
      .query(`SELECT COUNT(*) AS count FROM conversations WHERE user_id = ?`)
      .get(userId) as { count: number } | null;

    return row?.count ?? 0;
  }

  async createTaskCanvas(task: NewTaskCanvas): Promise<TaskCanvas> {
    const createdAt = nowIso();
    const status = task.status ?? "active";
    const insert = this.db
      .query(`
        INSERT INTO memory_task_canvases (chat_id, user_id, label, file_path, status, created_at, updated_at)
        VALUES (?, ?, ?, '', ?, ?, ?)
      `)
      .run(task.chatId, task.userId, task.label, status, createdAt, createdAt);
    const id = Number(insert.lastInsertRowid);
    const taskCanvasDir = this.options.taskCanvasDir ?? join(this.options.dataDir, "task-canvases");
    const generatedAbsolutePath = join(taskCanvasDir, safeChatSegment(task.chatId), `${String(id).padStart(6, "0")}-${safePathSegment(task.label)}.mmd`);
    const filePath = task.filePath ?? relative(this.options.dataDir, generatedAbsolutePath).replace(/\\/g, "/");

    this.db
      .query(`UPDATE memory_task_canvases SET file_path = ? WHERE id = ?`)
      .run(filePath, id);

    const absolutePath = task.filePath ? join(this.options.dataDir, task.filePath) : generatedAbsolutePath;
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, `graph LR\n  task_${id}["${task.label.replace(/"/g, "\\\"")}"]\n`, "utf8");

    return {
      id,
      chatId: task.chatId,
      userId: task.userId,
      label: task.label,
      filePath,
      status,
      createdAt,
      updatedAt: createdAt,
    };
  }

  async getTaskCanvasById(userId: string, taskId: number): Promise<TaskCanvas | undefined> {
    const row = this.db
      .query(`
        SELECT id, chat_id, user_id, label, file_path, status, created_at, updated_at
        FROM memory_task_canvases
        WHERE user_id = ? AND id = ?
      `)
      .get(userId, taskId) as Parameters<typeof mapTaskCanvasRow>[0] | null;

    return row ? mapTaskCanvasRow(row) : undefined;
  }

  async getActiveTaskCanvas(userId: string, chatId: string): Promise<TaskCanvas | undefined> {
    const row = this.db
      .query(`
        SELECT id, chat_id, user_id, label, file_path, status, created_at, updated_at
        FROM memory_task_canvases
        WHERE user_id = ? AND chat_id = ? AND status = 'active'
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `)
      .get(userId, chatId) as Parameters<typeof mapTaskCanvasRow>[0] | null;

    return row ? mapTaskCanvasRow(row) : undefined;
  }

  async listTaskCanvases(userId: string, chatId: string, limit: number): Promise<TaskCanvas[]> {
    const rows = this.db
      .query(`
        SELECT id, chat_id, user_id, label, file_path, status, created_at, updated_at
        FROM memory_task_canvases
        WHERE user_id = ? AND chat_id = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT ?
      `)
      .all(userId, chatId, limit) as Array<Parameters<typeof mapTaskCanvasRow>[0]>;

    return rows.map(mapTaskCanvasRow);
  }

  async updateTaskCanvasStatus(taskId: number, status: TaskCanvasStatus): Promise<void> {
    this.db
      .query(`UPDATE memory_task_canvases SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, nowIso(), taskId);
  }

  async recordL15Judgment(judgment: NewL15Judgment): Promise<L15Judgment> {
    const createdAt = judgment.createdAt ?? nowIso();
    const result = this.db
      .query(`
        INSERT INTO memory_l15_judgments (
          chat_id, user_id, source_conversation_id, task_completed, is_long_task,
          is_continuation, selected_task_id, new_task_label, source, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        judgment.chatId,
        judgment.userId,
        judgment.sourceConversationId ?? null,
        judgment.taskCompleted ? 1 : 0,
        judgment.isLongTask ? 1 : 0,
        judgment.isContinuation ? 1 : 0,
        judgment.selectedTaskId ?? null,
        judgment.newTaskLabel ?? null,
        judgment.source,
        createdAt,
      );

    return {
      id: Number(result.lastInsertRowid),
      chatId: judgment.chatId,
      userId: judgment.userId,
      sourceConversationId: judgment.sourceConversationId,
      taskCompleted: judgment.taskCompleted,
      isLongTask: judgment.isLongTask,
      isContinuation: judgment.isContinuation,
      selectedTaskId: judgment.selectedTaskId,
      newTaskLabel: judgment.newTaskLabel,
      source: judgment.source,
      createdAt,
    };
  }

  async insertTaskBoundary(boundary: NewTaskBoundary): Promise<TaskBoundary> {
    const createdAt = boundary.createdAt ?? nowIso();
    const result = this.db
      .query(`
        INSERT INTO memory_task_boundaries (chat_id, user_id, start_node_sequence, result, task_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(boundary.chatId, boundary.userId, boundary.startNodeSequence, boundary.result, boundary.taskId ?? null, createdAt);

    return {
      id: Number(result.lastInsertRowid),
      chatId: boundary.chatId,
      userId: boundary.userId,
      startNodeSequence: boundary.startNodeSequence,
      result: boundary.result,
      taskId: boundary.taskId,
      createdAt,
    };
  }

  async getTaskCanvas(chatId: string): Promise<string | undefined> {
    const active = this.db
      .query(`
        SELECT file_path
        FROM memory_task_canvases
        WHERE chat_id = ? AND status = 'active'
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `)
      .get(chatId) as { file_path: string } | null;

    if (active) {
      try {
        return await readFile(join(this.options.dataDir, active.file_path), "utf8");
      } catch {
        // Fall through to the legacy per-chat canvas path.
      }
    }

    const row = this.db
      .query(`SELECT COUNT(*) AS count FROM memory_task_nodes WHERE chat_id = ?`)
      .get(chatId) as { count: number } | null;

    if ((row?.count ?? 0) === 0) {
      return undefined;
    }

    try {
      return await readFile(join(this.options.canvasDir, `${chatId}.mmd`), "utf8");
    } catch {
      return undefined;
    }
  }

  async getOffloadPath(chatId: string, nodeId: string): Promise<{ absolutePath: string; relativePath: string }> {
    const absolutePath = join(this.options.refsDir, chatId, `${nodeId}.md`);
    return {
      absolutePath,
      relativePath: relative(this.options.dataDir, absolutePath).replace(/\\/g, "/"),
    };
  }

  async getL1EvidenceJsonlPath(chatId: string): Promise<{ absolutePath: string; relativePath: string }> {
    const relativePath = join("memory", "jsonl", "l1", `${safeChatSegment(chatId)}.jsonl`).replace(/\\/g, "/");
    return {
      absolutePath: join(this.options.dataDir, relativePath),
      relativePath,
    };
  }

  async getTaskCanvasPath(chatId: string): Promise<string> {
    return join(this.options.canvasDir, `${chatId}.mmd`);
  }

  async getTaskCanvasFilePath(taskId: number): Promise<{ absolutePath: string; relativePath: string } | undefined> {
    const row = this.db
      .query(`SELECT file_path FROM memory_task_canvases WHERE id = ? LIMIT 1`)
      .get(taskId) as { file_path: string } | null;
    if (!row?.file_path) {
      return undefined;
    }
    return {
      absolutePath: join(this.options.dataDir, row.file_path),
      relativePath: row.file_path,
    };
  }

  async findOffloadRefByNodeId(userId: string, nodeId: string): Promise<OffloadRef | undefined> {
    const row = this.db
      .query(`
        SELECT id, chat_id, user_id, node_id, kind, title, file_path, summary, created_at
        FROM memory_offload_refs
        WHERE user_id = ? AND node_id = ?
      `)
      .get(userId, nodeId) as {
      id: number;
      chat_id: string;
      user_id: string;
      node_id: string;
      kind: string;
      title: string;
      file_path: string;
      summary: string;
      created_at: string;
    } | null;

    return row
      ? {
          id: row.id,
          chatId: row.chat_id,
          userId: row.user_id,
          nodeId: row.node_id,
          kind: row.kind,
          title: row.title,
          filePath: row.file_path,
          summary: row.summary,
          createdAt: row.created_at,
        }
      : undefined;
  }

  async findOffloadRefByFilePath(userId: string, filePath: string): Promise<OffloadRef | undefined> {
    const row = this.db
      .query(`
        SELECT id, chat_id, user_id, node_id, kind, title, file_path, summary, created_at
        FROM memory_offload_refs
        WHERE user_id = ? AND file_path = ?
      `)
      .get(userId, filePath) as {
      id: number;
      chat_id: string;
      user_id: string;
      node_id: string;
      kind: string;
      title: string;
      file_path: string;
      summary: string;
      created_at: string;
    } | null;

    return row
      ? {
          id: row.id,
          chatId: row.chat_id,
          userId: row.user_id,
          nodeId: row.node_id,
          kind: row.kind,
          title: row.title,
          filePath: row.file_path,
          summary: row.summary,
          createdAt: row.created_at,
        }
      : undefined;
  }

  async insertOffloadRef(ref: NewOffloadRef): Promise<number> {
    const createdAt = ref.createdAt ?? nowIso();
    const result = this.db
      .query(`
        INSERT INTO memory_offload_refs (chat_id, user_id, node_id, kind, title, file_path, summary, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(ref.chatId, ref.userId, ref.nodeId, ref.kind, ref.title, ref.filePath, ref.summary, createdAt);

    return Number(result.lastInsertRowid);
  }

  async countOffloadRefs(userId: string): Promise<number> {
    const row = this.db
      .query(`SELECT COUNT(*) AS count FROM memory_offload_refs WHERE user_id = ?`)
      .get(userId) as { count: number } | null;

    return row?.count ?? 0;
  }

  async insertTaskGraphNode(node: NewTaskGraphNode): Promise<number> {
    const createdAt = node.createdAt ?? nowIso();
    const result = this.db
      .query(`
        INSERT INTO memory_task_nodes (chat_id, user_id, task_id, node_id, tool_name, tool_call_id, args_json, summary, result_ref, score, mmd_node_id, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        node.chatId,
        node.userId,
        node.taskId ?? null,
        node.nodeId,
        node.toolName ?? null,
        node.toolCallId ?? null,
        JSON.stringify(node.args ?? {}),
        node.summary,
        node.resultRef ?? null,
        node.score ?? 5,
        node.mmdNodeId ?? null,
        node.status,
        createdAt,
      );

    return Number(result.lastInsertRowid);
  }

  async insertOffloadRefWithTaskGraphNode(ref: NewOffloadRef, node: NewTaskGraphNode): Promise<void> {
    const insertBoth = this.db.transaction((nextRef: NewOffloadRef, nextNode: NewTaskGraphNode) => {
      const refCreatedAt = nextRef.createdAt ?? nowIso();
      const nodeCreatedAt = nextNode.createdAt ?? nowIso();

      this.db
        .query(`
          INSERT INTO memory_offload_refs (chat_id, user_id, node_id, kind, title, file_path, summary, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(nextRef.chatId, nextRef.userId, nextRef.nodeId, nextRef.kind, nextRef.title, nextRef.filePath, nextRef.summary, refCreatedAt);

      this.db
        .query(`
          INSERT INTO memory_task_nodes (chat_id, user_id, task_id, node_id, tool_name, tool_call_id, args_json, summary, result_ref, score, mmd_node_id, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          nextNode.chatId,
          nextNode.userId,
          nextNode.taskId ?? null,
          nextNode.nodeId,
          nextNode.toolName ?? null,
          nextNode.toolCallId ?? null,
          JSON.stringify(nextNode.args ?? {}),
          nextNode.summary,
          nextNode.resultRef ?? null,
          nextNode.score ?? 5,
          nextNode.mmdNodeId ?? null,
          nextNode.status,
          nodeCreatedAt,
        );
    });

    insertBoth(ref, node);
  }

  async deleteOffloadMetadata(nodeId: string): Promise<void> {
    const deleteBoth = this.db.transaction((nextNodeId: string) => {
      this.db.query(`DELETE FROM memory_task_nodes WHERE node_id = ?`).run(nextNodeId);
      this.db.query(`DELETE FROM memory_offload_refs WHERE node_id = ?`).run(nextNodeId);
    });

    deleteBoth(nodeId);
  }

  async listTaskGraphNodes(chatId: string, limit: number): Promise<TaskGraphNode[]> {
    const rows = this.db
      .query(`
        SELECT id, chat_id, user_id, task_id, node_id, tool_name, tool_call_id, args_json, summary, result_ref, score, mmd_node_id, status, created_at
        FROM memory_task_nodes
        WHERE chat_id = ?
        ORDER BY id DESC
        LIMIT ?
      `)
      .all(chatId, limit) as Array<{
      id: number;
      chat_id: string;
      user_id: string;
      task_id: number | null;
      node_id: string;
      tool_name: string | null;
      tool_call_id: string | null;
      args_json: string;
      summary: string;
      result_ref: string | null;
      score: number;
      mmd_node_id: string | null;
      status: string;
      created_at: string;
    }>;

    return rows.reverse().map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      userId: row.user_id,
      taskId: row.task_id ?? undefined,
      nodeId: row.node_id,
      toolName: row.tool_name ?? undefined,
      toolCallId: row.tool_call_id ?? undefined,
      args: parseEventMeta(row.args_json),
      summary: row.summary,
      resultRef: row.result_ref ?? undefined,
      score: row.score,
      mmdNodeId: row.mmd_node_id ?? undefined,
      status: row.status,
      createdAt: row.created_at,
    }));
  }

  async listTaskGraphNodesForTask(taskId: number, limit: number): Promise<TaskGraphNode[]> {
    const rows = this.db
      .query(`
        SELECT id, chat_id, user_id, task_id, node_id, tool_name, tool_call_id, args_json, summary, result_ref, score, mmd_node_id, status, created_at
        FROM memory_task_nodes
        WHERE task_id = ?
        ORDER BY id ASC
        LIMIT ?
      `)
      .all(taskId, limit) as Array<{
      id: number;
      chat_id: string;
      user_id: string;
      task_id: number | null;
      node_id: string;
      tool_name: string | null;
      tool_call_id: string | null;
      args_json: string;
      summary: string;
      result_ref: string | null;
      score: number;
      mmd_node_id: string | null;
      status: string;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      userId: row.user_id,
      taskId: row.task_id ?? undefined,
      nodeId: row.node_id,
      toolName: row.tool_name ?? undefined,
      toolCallId: row.tool_call_id ?? undefined,
      args: parseEventMeta(row.args_json),
      summary: row.summary,
      resultRef: row.result_ref ?? undefined,
      score: row.score,
      mmdNodeId: row.mmd_node_id ?? undefined,
      status: row.status,
      createdAt: row.created_at,
    }));
  }

  async insertL1EvidenceEntry(entry: NewL1EvidenceEntry): Promise<L1EvidenceEntry> {
    const createdAt = entry.createdAt ?? nowIso();
    const score = entry.score ?? 5;
    const status = entry.status ?? "pending";
    const result = this.db
      .query(`
        INSERT INTO memory_l1_evidence_entries (
          chat_id, user_id, task_id, node_id, tool_call_id, tool_name, args_json,
          summary, result_ref, score, mmd_node_id, status, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        entry.chatId,
        entry.userId,
        entry.taskId ?? null,
        entry.nodeId,
        entry.toolCallId ?? null,
        entry.toolName,
        JSON.stringify(entry.args ?? {}),
        entry.summary,
        entry.resultRef ?? null,
        score,
        entry.mmdNodeId ?? null,
        status,
        createdAt,
      );

    return {
      id: Number(result.lastInsertRowid),
      chatId: entry.chatId,
      userId: entry.userId,
      taskId: entry.taskId,
      nodeId: entry.nodeId,
      toolCallId: entry.toolCallId,
      toolName: entry.toolName,
      args: entry.args ?? {},
      summary: entry.summary,
      resultRef: entry.resultRef,
      score,
      mmdNodeId: entry.mmdNodeId,
      status,
      createdAt,
    };
  }

  async listL1EvidenceEntriesForTask(taskId: number, limit: number): Promise<L1EvidenceEntry[]> {
    const rows = this.db
      .query(`
        SELECT id, chat_id, user_id, task_id, node_id, tool_call_id, tool_name, args_json,
          summary, result_ref, score, mmd_node_id, status, created_at
        FROM memory_l1_evidence_entries
        WHERE task_id = ?
        ORDER BY id ASC
        LIMIT ?
      `)
      .all(taskId, limit) as Array<Parameters<typeof mapL1EvidenceRow>[0]>;

    return rows.map(mapL1EvidenceRow);
  }

  async listPendingL1EvidenceEntriesForTask(taskId: number, limit: number): Promise<L1EvidenceEntry[]> {
    const rows = this.db
      .query(`
        SELECT id, chat_id, user_id, task_id, node_id, tool_call_id, tool_name, args_json,
          summary, result_ref, score, mmd_node_id, status, created_at
        FROM memory_l1_evidence_entries
        WHERE task_id = ? AND status = 'pending'
        ORDER BY id ASC
        LIMIT ?
      `)
      .all(taskId, limit) as Array<Parameters<typeof mapL1EvidenceRow>[0]>;

    return rows.map(mapL1EvidenceRow);
  }

  async updateL1EvidenceNodeMapping(taskId: number, mapping: Record<string, string>): Promise<void> {
    const updateEvidence = this.db.query(`
      UPDATE memory_l1_evidence_entries
      SET mmd_node_id = ?, status = 'mapped'
      WHERE task_id = ? AND node_id = ?
    `);
    const updateNode = this.db.query(`
      UPDATE memory_task_nodes
      SET mmd_node_id = ?
      WHERE task_id = ? AND node_id = ?
    `);

    const tx = this.db.transaction(() => {
      for (const [nodeId, mmdNodeId] of Object.entries(mapping)) {
        updateEvidence.run(mmdNodeId, taskId, nodeId);
        updateNode.run(mmdNodeId, taskId, nodeId);
      }
    });
    tx();
  }

  async upsertTaskCanvasSearchText(input: { taskId: number; chatId: string; userId: string; label: string; status: TaskCanvasStatus; filePath: string; canvas: string }): Promise<void> {
    this.db.query(`DELETE FROM memory_task_canvas_fts WHERE task_id = ?`).run(String(input.taskId));
    this.db
      .query(`
        INSERT INTO memory_task_canvas_fts (label, canvas, task_id, chat_id, user_id, status, file_path)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(input.label, input.canvas, String(input.taskId), input.chatId, input.userId, input.status, input.filePath);
  }

  async searchTaskCanvases(userId: string, query: string, limit: number, chatId?: string): Promise<TaskCanvasRecall[]> {
    const fts = ftsQuery(query);
    if (!fts) {
      return [];
    }

    const rows = this.db
      .query(`
        SELECT c.id, c.chat_id, c.user_id, c.label, c.file_path, c.status, c.created_at, c.updated_at, f.canvas
        FROM memory_task_canvas_fts f
        JOIN memory_task_canvases c ON c.id = CAST(f.task_id AS INTEGER)
        WHERE f.user_id = ?
          AND (? IS NULL OR f.chat_id = ?)
          AND memory_task_canvas_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `)
      .all(userId, chatId ?? null, chatId ?? null, fts, limit) as Array<{
      id: number;
      chat_id: string;
      user_id: string;
      label: string;
      file_path: string;
      status: TaskCanvasStatus;
      created_at: string;
      updated_at: string;
      canvas: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      userId: row.user_id,
      label: row.label,
      filePath: row.file_path,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      canvas: row.canvas,
    }));
  }

  async insertGeneratedSkill(skill: NewGeneratedSkill): Promise<GeneratedSkill> {
    const createdAt = skill.createdAt ?? nowIso();
    const updatedAt = skill.updatedAt ?? createdAt;
    const status = skill.status ?? "draft";
    const result = this.db
      .query(`
        INSERT INTO memory_generated_skills (
          source_task_id, chat_id, user_id, skill_name, skill_description, skill_focus,
          skill_file_path, source_canvas_file_path, source_node_ids_json, source_evidence_ids_json,
          status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        skill.sourceTaskId,
        skill.chatId,
        skill.userId,
        skill.skillName,
        skill.skillDescription,
        skill.skillFocus ?? null,
        skill.skillFilePath,
        skill.sourceCanvasFilePath,
        JSON.stringify(skill.sourceNodeIds),
        JSON.stringify(skill.sourceEvidenceIds),
        status,
        createdAt,
        updatedAt,
      );

    return {
      id: Number(result.lastInsertRowid),
      sourceTaskId: skill.sourceTaskId,
      chatId: skill.chatId,
      userId: skill.userId,
      skillName: skill.skillName,
      skillDescription: skill.skillDescription,
      skillFocus: skill.skillFocus,
      skillFilePath: skill.skillFilePath,
      sourceCanvasFilePath: skill.sourceCanvasFilePath,
      sourceNodeIds: skill.sourceNodeIds,
      sourceEvidenceIds: skill.sourceEvidenceIds,
      status,
      createdAt,
      updatedAt,
    };
  }

  async countGeneratedSkills(userId: string): Promise<number> {
    const row = this.db
      .query(`SELECT COUNT(*) AS count FROM memory_generated_skills WHERE user_id = ?`)
      .get(userId) as { count: number } | null;

    return row?.count ?? 0;
  }

  async listGeneratedSkills(userId: string, limit: number): Promise<GeneratedSkill[]> {
    const rows = this.db
      .query(`
        SELECT id, source_task_id, chat_id, user_id, skill_name, skill_description, skill_focus,
          skill_file_path, source_canvas_file_path, source_node_ids_json, source_evidence_ids_json,
          status, created_at, updated_at
        FROM memory_generated_skills
        WHERE user_id = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT ?
      `)
      .all(userId, limit) as Array<{
      id: number;
      source_task_id: number;
      chat_id: string;
      user_id: string;
      skill_name: string;
      skill_description: string;
      skill_focus: string | null;
      skill_file_path: string;
      source_canvas_file_path: string;
      source_node_ids_json: string;
      source_evidence_ids_json: string;
      status: GeneratedSkill["status"];
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      sourceTaskId: row.source_task_id,
      chatId: row.chat_id,
      userId: row.user_id,
      skillName: row.skill_name,
      skillDescription: row.skill_description,
      skillFocus: row.skill_focus ?? undefined,
      skillFilePath: row.skill_file_path,
      sourceCanvasFilePath: row.source_canvas_file_path,
      sourceNodeIds: parseStringArray(row.source_node_ids_json),
      sourceEvidenceIds: parseStringArray(row.source_evidence_ids_json),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async getCheckpoint(userId: string, key: string): Promise<PipelineCheckpointValue | undefined> {
    const row = this.db
      .query(`SELECT value FROM pipeline_checkpoints WHERE user_id = ? AND key = ?`)
      .get(userId, key) as { value: string } | null;

    return row ? deserializeCheckpointValue(row.value) : undefined;
  }

  async setCheckpoint(userId: string, key: string, value: PipelineCheckpointValue): Promise<void> {
    const updatedAt = nowIso();
    this.db
      .query(`
        INSERT INTO pipeline_checkpoints (user_id, key, value, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)
      .run(userId, key, serializeCheckpointValue(value), updatedAt);
  }
}
