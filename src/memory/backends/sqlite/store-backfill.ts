import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { EventMeta } from "../../core/types";
import type { L0Record, L1Record, ProfileSyncRecord } from "../../core/store/types";
import type { SqliteMemoryStore } from "./store";

function md5(content: string): string {
  return createHash("md5").update(content).digest("hex");
}

function parseJsonObject(raw: string): EventMeta {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as EventMeta : {};
  } catch {
    return {};
  }
}

function parseNumberArray(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === "number" && Number.isFinite(value)) : [];
  } catch {
    return [];
  }
}

function timestampMs(iso: string, fallback: number): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sessionKey(chatId: string, userId: string): string {
  return `telegram:${chatId}:${userId}`;
}

const BACKFILL_VERSION = "1";

function hasTable(db: Database, tableName: string): boolean {
  const row = db.query(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tableName) as { present: number } | null;
  return row?.present === 1;
}

export async function backfillLegacyMemoryStore(db: Database, store: SqliteMemoryStore): Promise<void> {
  const conversations = hasTable(db, "conversations")
    ? db.query(`
        SELECT id, chat_id, user_id, role, content, meta_json, created_at
        FROM conversations
        ORDER BY id ASC
      `).all() as Array<{
        id: number;
        chat_id: string;
        user_id: string;
        role: L0Record["role"];
        content: string;
        meta_json: string;
        created_at: string;
      }>
    : [];

  for (const row of conversations) {
    await store.upsertL0({
      recordId: `legacy:l0:${row.id}`,
      sessionKey: sessionKey(row.chat_id, row.user_id),
      sessionId: row.chat_id,
      chatId: row.chat_id,
      userId: row.user_id,
      role: row.role,
      messageText: row.content,
      recordedAt: row.created_at,
      timestamp: timestampMs(row.created_at, row.id),
      metadata: { ...parseJsonObject(row.meta_json), legacyId: row.id },
    });
  }

  const atoms = hasTable(db, "memory_atoms")
    ? db.query(`
        SELECT id, user_id, text, importance, source_turn_ids_json, source_layer, created_at, updated_at
        FROM memory_atoms
        ORDER BY id ASC
      `).all() as Array<{
        id: number;
        user_id: string;
        text: string;
        importance: number;
        source_turn_ids_json: string;
        source_layer: string;
        created_at: string;
        updated_at: string;
      }>
    : [];

  for (const row of atoms) {
    const record: L1Record = {
      recordId: `legacy:l1:${row.id}`,
      userId: row.user_id,
      sessionKey: `legacy:${row.user_id}`,
      sessionId: "legacy",
      content: row.text,
      type: row.source_layer,
      priority: row.importance,
      sceneName: "legacy memory atom",
      timestampStr: row.updated_at,
      timestampStart: row.created_at,
      timestampEnd: row.updated_at,
      sourceConversationIds: parseNumberArray(row.source_turn_ids_json),
      metadata: { legacyId: row.id, sourceLayer: row.source_layer },
      createdTime: row.created_at,
      updatedTime: row.updated_at,
    };
    await store.upsertL1(record);
  }

  const profiles: ProfileSyncRecord[] = [];
  const scenarios = hasTable(db, "memory_scenarios")
    ? db.query(`
        SELECT id, user_id, title, body_markdown, atom_ids_json, file_path, created_at, updated_at
        FROM memory_scenarios
        ORDER BY id ASC
      `).all() as Array<{
        id: number;
        user_id: string;
        title: string;
        body_markdown: string;
        atom_ids_json: string;
        file_path: string | null;
        created_at: string;
        updated_at: string;
      }>
    : [];

  for (const row of scenarios) {
    profiles.push({
      id: `legacy:l2:${row.id}`,
      type: "l2",
      userId: row.user_id,
      filename: `scenario-${row.id}.md`,
      content: row.body_markdown,
      contentMd5: md5(row.body_markdown),
      version: 1,
      createdAtMs: timestampMs(row.created_at, row.id),
      updatedAtMs: timestampMs(row.updated_at, row.id),
      metadata: {
        legacyId: row.id,
        title: row.title,
        atomIds: parseNumberArray(row.atom_ids_json),
        ...(row.file_path ? { filePath: row.file_path } : {}),
      },
    });
  }

  const personas = hasTable(db, "personas")
    ? db.query(`
        SELECT user_id, markdown, source_scenario_ids_json, updated_at
        FROM personas
        ORDER BY user_id ASC
      `).all() as Array<{
        user_id: string;
        markdown: string;
        source_scenario_ids_json: string;
        updated_at: string;
      }>
    : [];

  for (const row of personas) {
    profiles.push({
      id: `legacy:l3:${row.user_id}`,
      type: "l3",
      userId: row.user_id,
      filename: `persona-${row.user_id}.md`,
      content: row.markdown,
      contentMd5: md5(row.markdown),
      version: 1,
      createdAtMs: timestampMs(row.updated_at, 0),
      updatedAtMs: timestampMs(row.updated_at, 0),
      metadata: { sourceScenarioIds: parseNumberArray(row.source_scenario_ids_json) },
    });
  }

  await store.syncProfiles(profiles);
  db.query(`
    INSERT INTO memory_store_meta (key, value, updated_at)
    VALUES ('backfill.version', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(BACKFILL_VERSION, new Date().toISOString());
}
