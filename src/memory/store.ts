import type { Database } from "bun:sqlite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { config } from "../config";
import { appendJsonl, readJsonlTail } from "./jsonl";
import { ftsQuery, safeJsonParse, truncateText } from "../utils/text";
import { nowIso, unixNow } from "../utils/time";
import type { LlmProvider } from "../agent/types";

export type MemoryRecall = {
  persona?: string;
  atoms: Array<{ id: number; text: string; importance: number }>;
  scenarios: Array<{ id: number; title: string; body_markdown: string; file_path?: string }>;
  conversations: Array<{ id: number; role: string; content: string; created_at: string }>;
  taskCanvas?: string;
};

export type ChatTurn = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  created_at: string;
  meta?: Record<string, unknown>;
};

export type OffloadResult = {
  content: string;
  offloaded: boolean;
  nodeId?: string;
  resultRef?: string;
  summary?: string;
};

type ConversationRow = { id: number; role: string; content: string; created_at: string };
type AtomExtraction = { text: string; importance?: number; source_turn_ids?: number[] };

function makeNodeId(prefix = "n"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function fenceSafe(input: string): string {
  return input.replace(/```/g, "''' ");
}

function jsonArrayFromText<T>(text: string, fallback: T): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced ?? text.match(/\[[\s\S]*\]/)?.[0] ?? "";
  return raw ? safeJsonParse<T>(raw, fallback) : fallback;
}

export class MemoryStore {
  constructor(private readonly db: Database) {}

  historyPath(chatId: string): string {
    return join(config.storage.historyDir, `${chatId}.jsonl`);
  }

  canvasPath(chatId: string): string {
    return join(config.storage.memoryCanvasDir, `${chatId}.mmd`);
  }

  private stateKey(userId: string, key: string): string | undefined {
    const row = this.db
      .query(`SELECT value FROM memory_pipeline_state WHERE user_id = ? AND key = ?`)
      .get(userId, key) as { value: string } | null;
    return row?.value;
  }

  private setState(userId: string, key: string, value: string): void {
    this.db
      .query(`
        INSERT INTO memory_pipeline_state (user_id, key, value, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)
      .run(userId, key, value, nowIso());
  }

  private logRun(userId: string, phase: string, status: string, details: Record<string, unknown> = {}): void {
    this.db
      .query(`INSERT INTO memory_run_log (user_id, phase, status, details_json, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(userId, phase, status, JSON.stringify(details), nowIso());
  }

  async logTurn(input: {
    chatId: string;
    userId: string;
    role: ChatTurn["role"];
    content: string;
    meta?: Record<string, unknown>;
  }): Promise<number> {
    const createdAt = nowIso();
    const meta = input.meta ?? {};
    const result = this.db
      .query(`
        INSERT INTO conversations (chat_id, user_id, role, content, meta_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(input.chatId, input.userId, input.role, input.content, JSON.stringify(meta), createdAt);

    const id = Number(result.lastInsertRowid);
    this.db
      .query(`INSERT INTO conversation_fts (content, conversation_id, chat_id, user_id) VALUES (?, ?, ?, ?)`)
      .run(input.content, String(id), input.chatId, input.userId);

    await appendJsonl(this.historyPath(input.chatId), {
      id,
      chat_id: input.chatId,
      user_id: input.userId,
      role: input.role,
      content: input.content,
      meta,
      created_at: createdAt,
    });

    return id;
  }

  async recentMessages(chatId: string, limit = config.agent.maxRecentMessages): Promise<ChatTurn[]> {
    const fromJsonl = await readJsonlTail<ChatTurn & { chat_id?: string }>(this.historyPath(chatId), limit);
    if (fromJsonl.length > 0) return fromJsonl;

    return this.db
      .query(`
        SELECT role, content, created_at, meta_json
        FROM conversations
        WHERE chat_id = ?
        ORDER BY id DESC
        LIMIT ?
      `)
      .all(chatId, limit)
      .reverse()
      .map((row: any) => ({
        role: row.role,
        content: row.content,
        created_at: row.created_at,
        meta: safeJsonParse(row.meta_json, {}),
      }));
  }

  getPersona(userId: string): string | undefined {
    const row = this.db.query(`SELECT markdown FROM personas WHERE user_id = ?`).get(userId) as { markdown: string } | null;
    return row?.markdown;
  }

  getTaskCanvas(chatId: string): string | undefined {
    const path = this.canvasPath(chatId);
    if (!existsSync(path)) return undefined;
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  }

  async recall(userId: string, query: string, maxResults = config.memory.recallMaxResults, chatId?: string): Promise<MemoryRecall> {
    const q = ftsQuery(query);
    const persona = this.getPersona(userId);

    const atoms = q
      ? (this.db
          .query(`
            SELECT m.id, m.text, m.importance
            FROM memory_atoms_fts f
            JOIN memory_atoms m ON m.id = CAST(f.atom_id AS INTEGER)
            WHERE memory_atoms_fts MATCH ? AND f.user_id = ?
            ORDER BY m.importance DESC, m.updated_at DESC
            LIMIT ?
          `)
          .all(q, userId, maxResults) as Array<{ id: number; text: string; importance: number }>)
      : (this.db
          .query(`
            SELECT id, text, importance
            FROM memory_atoms
            WHERE user_id = ?
            ORDER BY importance DESC, updated_at DESC
            LIMIT ?
          `)
          .all(userId, maxResults) as Array<{ id: number; text: string; importance: number }>);

    const scenarios = this.db
      .query(`
        SELECT id, title, body_markdown, file_path
        FROM memory_scenarios
        WHERE user_id = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `)
      .all(userId, Math.min(maxResults, 3)) as Array<{ id: number; title: string; body_markdown: string; file_path?: string }>;

    const conversations = q
      ? (this.db
          .query(`
            SELECT c.id, c.role, c.content, c.created_at
            FROM conversation_fts f
            JOIN conversations c ON c.id = CAST(f.conversation_id AS INTEGER)
            WHERE conversation_fts MATCH ? AND f.user_id = ?
            ORDER BY c.id DESC
            LIMIT ?
          `)
          .all(q, userId, maxResults) as Array<{ id: number; role: string; content: string; created_at: string }>)
      : [];

    return { persona, atoms, scenarios, conversations, taskCanvas: chatId ? this.getTaskCanvas(chatId) : undefined };
  }

  addAtom(input: { userId: string; text: string; importance?: number; sourceTurnIds?: number[]; sourceLayer?: string }): number {
    const text = input.text.trim();
    if (!text) return 0;

    if (config.memory.enableDedup) {
      const existing = this.db
        .query(`SELECT id FROM memory_atoms WHERE user_id = ? AND lower(text) = lower(?)`)
        .get(input.userId, text) as { id: number } | null;
      if (existing) return existing.id;
    }

    const createdAt = nowIso();
    const result = this.db
      .query(`
        INSERT OR IGNORE INTO memory_atoms (user_id, text, importance, source_turn_ids_json, source_layer, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.userId,
        text,
        input.importance ?? 3,
        JSON.stringify(input.sourceTurnIds ?? []),
        input.sourceLayer ?? "L1",
        createdAt,
        createdAt,
      );
    const id = Number(result.lastInsertRowid);
    if (id > 0) this.db.query(`INSERT INTO memory_atoms_fts (text, atom_id, user_id) VALUES (?, ?, ?)`).run(text, String(id), input.userId);
    return id;
  }

  searchConversations(userId: string, query: string, limit = 5): string {
    const q = ftsQuery(query);
    if (!q) return "No query provided.";
    const rows = this.db
      .query(`
        SELECT c.id, c.role, c.content, c.created_at
        FROM conversation_fts f
        JOIN conversations c ON c.id = CAST(f.conversation_id AS INTEGER)
        WHERE conversation_fts MATCH ? AND f.user_id = ?
        ORDER BY c.id DESC
        LIMIT ?
      `)
      .all(q, userId, limit) as Array<{ id: number; role: string; content: string; created_at: string }>;

    if (rows.length === 0) return "No matching conversation found.";
    return rows.map((r) => `#${r.id} [${r.created_at}] ${r.role}: ${truncateText(r.content, 800)}`).join("\n\n");
  }

  async runL1Extraction(userId: string, llm: LlmProvider, force = false): Promise<number> {
    const lastSeen = Number.parseInt(this.stateKey(userId, "l1_last_conversation_id") ?? "0", 10);
    const totalNew = this.db
      .query(`SELECT COUNT(*) AS count FROM conversations WHERE user_id = ? AND id > ? AND role IN ('user', 'assistant')`)
      .get(userId, lastSeen) as { count: number } | null;

    if (!force && (totalNew?.count ?? 0) < config.memory.pipelineEveryNConversations) return 0;

    const rows = this.db
      .query(`
        SELECT id, role, content, created_at
        FROM conversations
        WHERE user_id = ? AND id > ? AND role IN ('user', 'assistant')
        ORDER BY id ASC
        LIMIT 80
      `)
      .all(userId, lastSeen) as ConversationRow[];

    if (rows.length === 0) return 0;

    const transcript = rows.map((r) => `turn_id=${r.id} ${r.role}: ${truncateText(r.content, 1500)}`).join("\n");
    const response = await llm.complete({
      messages: [
        {
          role: "system",
          content: [
            "You are the L1 extractor from TencentDB-Agent-Memory style layered memory.",
            "Extract durable atomic memories from L0 conversations.",
            "Return ONLY valid JSON array. Each item: {\"text\": string, \"importance\": 1-5, \"source_turn_ids\": number[]}.",
            "Keep facts, preferences, project context, reusable workflows, constraints, decisions, and stable tool habits.",
            "Ignore greetings, one-off temporary states, secrets, and duplicate facts.",
          ].join("\n"),
        },
        { role: "user", content: transcript },
      ],
      tools: [],
    });

    const items = jsonArrayFromText<AtomExtraction[]>(response.content, []);
    let created = 0;

    for (const item of items.slice(0, config.memory.extractionMaxMemoriesPerSession)) {
      if (!item.text || item.text.length < 8) continue;
      const id = this.addAtom({
        userId,
        text: item.text,
        importance: item.importance ?? 3,
        sourceTurnIds: item.source_turn_ids ?? [],
        sourceLayer: "L1",
      });
      if (id > 0) created++;
    }

    this.setState(userId, "l1_last_conversation_id", String(rows.at(-1)?.id ?? lastSeen));
    this.logRun(userId, "L1", "ok", { scanned: rows.length, created });
    return created;
  }

  async runL2ScenarioUpdate(userId: string, llm: LlmProvider, force = false): Promise<number | undefined> {
    const lastL2 = Number.parseInt(this.stateKey(userId, "l2_last_run_unix") ?? "0", 10);
    if (!force && unixNow() - lastL2 < config.memory.l2MinIntervalSec) return undefined;

    const atoms = this.db
      .query(`
        SELECT id, text, importance, updated_at, source_turn_ids_json
        FROM memory_atoms
        WHERE user_id = ?
        ORDER BY importance DESC, updated_at DESC
        LIMIT 100
      `)
      .all(userId) as Array<{ id: number; text: string; importance: number; updated_at: string; source_turn_ids_json: string }>;

    if (atoms.length === 0) return undefined;

    const atomText = atoms.map((a) => `atom_id=${a.id} importance=${a.importance} source_turn_ids=${a.source_turn_ids_json}: ${a.text}`).join("\n");
    const scenarioResp = await llm.complete({
      messages: [
        {
          role: "system",
          content: [
            "You are the L2 Scenario aggregator from TencentDB-Agent-Memory style layered memory.",
            "Group L1 atomic facts into 3-7 scenario blocks.",
            "Return markdown only. Use headings, concise bullets, and keep atom_id evidence references.",
            "Do not invent facts. Preserve drill-down references.",
          ].join("\n"),
        },
        { role: "user", content: atomText },
      ],
      tools: [],
    });

    const now = nowIso();
    const title = `L2 Scenario snapshot ${now}`;
    const scenarioResult = this.db
      .query(`
        INSERT INTO memory_scenarios (user_id, title, body_markdown, atom_ids_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(userId, title, scenarioResp.content, JSON.stringify(atoms.map((a) => a.id)), now, now);
    const scenarioId = Number(scenarioResult.lastInsertRowid);
    const filePath = join(config.storage.memoryScenarioDir, `${userId}-${scenarioId}.md`);
    await writeFile(filePath, scenarioResp.content, "utf8");
    this.db.query(`UPDATE memory_scenarios SET file_path = ? WHERE id = ?`).run(relative(config.storage.dataDir, filePath), scenarioId);
    this.setState(userId, "l2_last_run_unix", String(unixNow()));
    this.logRun(userId, "L2", "ok", { scenarioId, atomCount: atoms.length });
    return scenarioId;
  }

  async runL3PersonaUpdate(userId: string, llm: LlmProvider, scenarioId?: number): Promise<string | undefined> {
    const scenarios = this.db
      .query(`
        SELECT id, title, body_markdown
        FROM memory_scenarios
        WHERE user_id = ?
        ORDER BY updated_at DESC
        LIMIT 8
      `)
      .all(userId) as Array<{ id: number; title: string; body_markdown: string }>;

    if (scenarios.length === 0) return undefined;
    const scenarioText = scenarios.map((s) => `scenario_id=${s.id} ${s.title}\n${s.body_markdown}`).join("\n\n---\n\n");

    const personaResp = await llm.complete({
      messages: [
        {
          role: "system",
          content: [
            "You are the L3 Persona/profile distiller from TencentDB-Agent-Memory style layered memory.",
            "Create/update a concise agent-facing profile from L2 scenarios.",
            "Include stable preferences, project context, coding style, tool habits, recurring workflows, and constraints.",
            "Every bullet should be grounded in scenario_id or atom_id references when possible.",
            "Do not infer sensitive attributes or invent facts. Return markdown only.",
          ].join("\n"),
        },
        { role: "user", content: scenarioText },
      ],
      tools: [],
    });

    const sourceScenarioIds = scenarioId ? [scenarioId] : scenarios.map((s) => s.id);
    this.db
      .query(`
        INSERT INTO personas (user_id, markdown, source_scenario_ids_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          markdown = excluded.markdown,
          source_scenario_ids_json = excluded.source_scenario_ids_json,
          updated_at = excluded.updated_at
      `)
      .run(userId, personaResp.content, JSON.stringify(sourceScenarioIds), nowIso());

    await writeFile(join(config.storage.memoryDir, `persona-${userId}.md`), personaResp.content, "utf8");
    this.logRun(userId, "L3", "ok", { sourceScenarioIds });
    return personaResp.content;
  }

  async runMaintenanceForUser(userId: string, llm: LlmProvider, force = false): Promise<{ l1Created: number; l2ScenarioId?: number; personaUpdated: boolean }> {
    const l1Created = await this.runL1Extraction(userId, llm, force);
    let l2ScenarioId: number | undefined;
    let personaUpdated = false;

    if (force || l1Created > 0) {
      l2ScenarioId = await this.runL2ScenarioUpdate(userId, llm, force);
      const totalAtoms = this.db.query(`SELECT COUNT(*) AS count FROM memory_atoms WHERE user_id = ?`).get(userId) as { count: number } | null;
      const lastPersonaCount = Number.parseInt(this.stateKey(userId, "l3_last_atom_count") ?? "0", 10);
      const shouldPersona = force || Boolean(l2ScenarioId) || ((totalAtoms?.count ?? 0) - lastPersonaCount >= config.memory.personaTriggerEveryN);
      if (shouldPersona) {
        await this.runL3PersonaUpdate(userId, llm, l2ScenarioId);
        this.setState(userId, "l3_last_atom_count", String(totalAtoms?.count ?? 0));
        personaUpdated = true;
      }
    }

    return { l1Created, l2ScenarioId, personaUpdated };
  }

  private async writeCanvas(chatId: string): Promise<string> {
    const rows = this.db
      .query(`
        SELECT node_id, tool_name, summary, result_ref, status, created_at
        FROM memory_task_nodes
        WHERE chat_id = ?
        ORDER BY id DESC
        LIMIT 40
      `)
      .all(chatId)
      .reverse() as Array<{ node_id: string; tool_name?: string; summary: string; result_ref?: string; status: string; created_at: string }>;

    const lines = ["graph LR", `  Start([chat ${chatId}])`];
    let previous = "Start";
    for (const row of rows) {
      const label = `${row.tool_name ?? "turn"}: ${truncateText(row.summary.replace(/[\n\r]+/g, " "), 90)}`.replace(/"/g, "'");
      lines.push(`  ${row.node_id}["${label}<br/>node_id=${row.node_id}"]`);
      lines.push(`  ${previous} --> ${row.node_id}`);
      if (row.result_ref) lines.push(`  ${row.node_id} -. result_ref .-> ${row.node_id}_ref[("${basename(row.result_ref)}")]`);
      previous = row.node_id;
    }
    const canvas = lines.join("\n") + "\n";
    await writeFile(this.canvasPath(chatId), canvas, "utf8");
    return canvas;
  }

  async addTaskNode(input: {
    chatId: string;
    userId: string;
    toolName?: string;
    args?: Record<string, unknown>;
    summary: string;
    resultRef?: string;
    status?: string;
    nodeId?: string;
  }): Promise<string> {
    const id = input.nodeId ?? makeNodeId("task");
    this.db
      .query(`
        INSERT OR IGNORE INTO memory_task_nodes (chat_id, user_id, node_id, tool_name, args_json, summary, result_ref, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.chatId,
        input.userId,
        id,
        input.toolName ?? null,
        JSON.stringify(input.args ?? {}),
        truncateText(input.summary, 1200),
        input.resultRef ?? null,
        input.status ?? "ok",
        nowIso(),
      );
    await this.writeCanvas(input.chatId);
    return id;
  }

  async offloadToolResult(input: {
    chatId: string;
    userId: string;
    toolName: string;
    args: Record<string, unknown>;
    rawResult: string;
  }): Promise<OffloadResult> {
    const summary = truncateText(input.rawResult.replace(/\s+/g, " ").trim(), config.memory.offloadSummaryChars);

    if (!config.memory.offloadEnabled || input.rawResult.length < config.memory.offloadMinChars) {
      await this.addTaskNode({
        chatId: input.chatId,
        userId: input.userId,
        toolName: input.toolName,
        args: input.args,
        summary,
        status: "ok",
      });
      return { content: input.rawResult, offloaded: false, summary };
    }

    const id = makeNodeId("ref");
    const dir = join(config.storage.memoryRefsDir, input.chatId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${id}.md`);
    const markdown = [
      "# Offloaded tool result",
      "",
      `- node_id: ${id}`,
      `- chat_id: ${input.chatId}`,
      `- user_id: ${input.userId}`,
      `- tool: ${input.toolName}`,
      `- created_at: ${nowIso()}`,
      "",
      "## Arguments",
      "```json",
      JSON.stringify(input.args ?? {}, null, 2),
      "```",
      "",
      "## Summary",
      summary,
      "",
      "## Raw result",
      "```text",
      fenceSafe(input.rawResult),
      "```",
    ].join("\n");

    await writeFile(filePath, markdown, "utf8");
    const ref = relative(config.storage.dataDir, filePath);
    this.db
      .query(`
        INSERT INTO memory_offload_refs (chat_id, user_id, node_id, kind, title, file_path, summary, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(input.chatId, input.userId, id, "tool_result", `Tool result ${input.toolName}`, ref, summary, nowIso());

    await this.addTaskNode({
      chatId: input.chatId,
      userId: input.userId,
      toolName: input.toolName,
      args: input.args,
      summary,
      resultRef: ref,
      status: "offloaded",
      nodeId: id,
    });

    return {
      offloaded: true,
      nodeId: id,
      resultRef: ref,
      summary,
      content: [
        "[TencentDB-style context offload]",
        `node_id=${id}`,
        `result_ref=${ref}`,
        `tool=${input.toolName}`,
        `summary=${summary}`,
        "The raw tool output is stored externally. Use tool tdai_context_ref_read with node_id or result_ref if you need exact details.",
      ].join("\n"),
    };
  }

  async readContextRef(input: { userId: string; nodeId?: string; resultRef?: string }): Promise<string> {
    let row: { file_path: string; summary: string; node_id: string } | null = null;
    if (input.nodeId) {
      row = this.db
        .query(`SELECT file_path, summary, node_id FROM memory_offload_refs WHERE user_id = ? AND node_id = ?`)
        .get(input.userId, input.nodeId) as { file_path: string; summary: string; node_id: string } | null;
    } else if (input.resultRef) {
      row = this.db
        .query(`SELECT file_path, summary, node_id FROM memory_offload_refs WHERE user_id = ? AND file_path = ?`)
        .get(input.userId, input.resultRef) as { file_path: string; summary: string; node_id: string } | null;
    }

    if (!row) return "No matching context ref found.";
    const path = resolve(config.storage.dataDir, row.file_path);
    if (!path.startsWith(config.storage.dataDir)) return "Invalid ref path.";
    return truncateText(await readFile(path, "utf8"), 12000);
  }

  memoryStatus(userId: string, chatId?: string): string {
    const atoms = this.db.query(`SELECT COUNT(*) AS count FROM memory_atoms WHERE user_id = ?`).get(userId) as { count: number } | null;
    const scenarios = this.db.query(`SELECT COUNT(*) AS count FROM memory_scenarios WHERE user_id = ?`).get(userId) as { count: number } | null;
    const refs = this.db.query(`SELECT COUNT(*) AS count FROM memory_offload_refs WHERE user_id = ?`).get(userId) as { count: number } | null;
    const conv = this.db.query(`SELECT COUNT(*) AS count FROM conversations WHERE user_id = ?`).get(userId) as { count: number } | null;
    const hasPersona = Boolean(this.getPersona(userId));
    const canvas = chatId ? this.getTaskCanvas(chatId) : undefined;
    return [
      "TencentDB-Agent-Memory style local adapter",
      `mode=${config.tencentMemory.mode}`,
      `release=${config.tencentMemory.version}`,
      `L0 conversations=${conv?.count ?? 0}`,
      `L1 atoms=${atoms?.count ?? 0}`,
      `L2 scenarios=${scenarios?.count ?? 0}`,
      `L3 persona=${hasPersona ? "yes" : "no"}`,
      `offload_refs=${refs?.count ?? 0}`,
      `offload_enabled=${config.memory.offloadEnabled}`,
      `task_canvas=${canvas && chatId ? this.canvasPath(chatId) : "none"}`,
      `memory_maintenance_cron=${config.memory.maintenanceCron}`,
    ].join("\n");
  }
}
