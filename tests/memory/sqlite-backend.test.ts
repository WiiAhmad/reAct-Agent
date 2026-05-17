import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { migrate } from "../../src/db/schema";
import { migrateSqliteMemory } from "../../src/memory/backends/sqlite/migrate";
import { SqliteMemoryBackend } from "../../src/memory/backends/sqlite/backend";
import { InteractionLogService } from "../../src/memory/events/service";
import type { JsonValue } from "../../src/memory/core/types";

test("SQLite backend stores interaction events, optional JSONL exports, L0 turns, and checkpoints", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-memory-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);

    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });
    const logs = new InteractionLogService(backend, {
      enabled: true,
      exportDir: join(tempDir, "jsonl"),
    });

    await logs.logUserMessage({ chatId: "c1", userId: "u1", content: "remember Bun", mode: "chat" });
    await logs.logToolResult({
      chatId: "c1",
      userId: "u1",
      toolName: "tdai_memory_search",
      toolCallId: "call_1",
      content: "No relevant memory found.",
      offloaded: false,
    });
    await backend.setCheckpoint("u1", "l1_last_conversation_id", "1");

    const turns = await backend.listConversationTurns("u1", "c1", 10);
    const events = await backend.listInteractionEvents("u1", "c1", 10);
    const jsonl = await Bun.file(join(tempDir, "jsonl", "c1.jsonl")).text();

    expect(turns[0]?.content).toBe("remember Bun");
    expect(jsonl).toContain('"type":"user_message"');
    expect(events.some((event) => event.type === "tool_result")).toBe(true);
    expect(await backend.getCheckpoint("u1", "l1_last_conversation_id")).toBe("1");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("SQLite backend logs events even when JSONL export is disabled", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-memory-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);

    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });
    const logs = new InteractionLogService(backend, {
      enabled: false,
      exportDir: join(tempDir, "jsonl"),
    });

    const eventId = await logs.logUserMessage({ chatId: "c2", userId: "u2", content: "persist this", mode: "chat" });
    const turns = await backend.listConversationTurns("u2", "c2", 10);
    const events = await backend.listInteractionEvents("u2", "c2", 10);

    expect(eventId).toBeNumber();
    expect(turns).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(await Bun.file(join(tempDir, "jsonl", "c2.jsonl")).exists()).toBe(false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("SQLite backend round-trips checkpoint values including numbers", async () => {
  const db = new Database(":memory:");
  migrateSqliteMemory(db);

  const backend = new SqliteMemoryBackend(db, {
    dataDir: join(tmpdir(), "grammy-memory-unused"),
    refsDir: join(tmpdir(), "grammy-memory-unused-refs"),
    canvasDir: join(tmpdir(), "grammy-memory-unused-canvases"),
  });

  const cases: Array<[string, JsonValue]> = [
    ["string", "value"],
    ["number", 42],
    ["float", 3.14],
    ["boolean", true],
    ["null", null],
    ["array", ["x", 2, false]],
    ["object", { nested: [1, "two"], ok: true }],
  ];

  for (const [key, value] of cases) {
    await backend.setCheckpoint("u3", key, value);
    expect(await backend.getCheckpoint("u3", key)).toEqual(value);
  }
});

test("migrate upgrades legacy memory_atoms table for canonical atom upserts", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-memory-"));

  try {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE memory_atoms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        text TEXT NOT NULL,
        importance INTEGER NOT NULL DEFAULT 3,
        source_turn_ids_json TEXT NOT NULL DEFAULT '[]',
        source_layer TEXT NOT NULL DEFAULT 'L1',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, text)
      );
    `);
    migrateSqliteMemory(db);

    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });

    const result = await backend.upsertMemoryAtom({
      userId: "u1",
      text: "User prefers concise responses.",
      sourceConversationIds: [1],
      sourceLayer: "L1",
    });

    expect(result.created).toBe(true);
    expect(result.atom.text).toBe("User prefers concise responses.");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("migrate upgrades legacy app memory tables with missing columns", () => {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE autonomous_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE memory_atoms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      text TEXT NOT NULL,
      importance INTEGER NOT NULL DEFAULT 3,
      source_turn_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, text)
    );

    CREATE TABLE memory_scenarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body_markdown TEXT NOT NULL,
      atom_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  migrate(db);

  const jobColumns = new Set(
    (db.query(`PRAGMA table_info(autonomous_jobs)`).all() as Array<{ name: string }>).map((row) => row.name),
  );
  const atomColumns = new Set(
    (db.query(`PRAGMA table_info(memory_atoms)`).all() as Array<{ name: string }>).map((row) => row.name),
  );
  const scenarioColumns = new Set(
    (db.query(`PRAGMA table_info(memory_scenarios)`).all() as Array<{ name: string }>).map((row) => row.name),
  );

  expect(jobColumns.has("schedule_mode")).toBe(true);
  expect(jobColumns.has("interval_sec")).toBe(true);
  expect(jobColumns.has("cron_expr")).toBe(true);
  expect(jobColumns.has("last_finished_at")).toBe(true);
  expect(jobColumns.has("last_status")).toBe(true);
  expect(jobColumns.has("last_error")).toBe(true);
  expect(atomColumns.has("source_layer")).toBe(true);
  expect(scenarioColumns.has("file_path")).toBe(true);
});

test("app schema keeps transitional legacy memory tables available", () => {
  const db = new Database(":memory:");
  migrate(db);

  const tableNames = new Set(
    (db
      .query(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all() as Array<{ name: string }>)
      .map((row) => row.name),
  );

  expect(tableNames.has("memory_atoms")).toBe(true);
  expect(tableNames.has("memory_atoms_fts")).toBe(true);
  expect(tableNames.has("memory_scenarios")).toBe(true);
  expect(tableNames.has("personas")).toBe(true);
  expect(tableNames.has("memory_pipeline_state")).toBe(true);
  expect(tableNames.has("memory_offload_refs")).toBe(true);
  expect(tableNames.has("memory_task_nodes")).toBe(true);
  expect(tableNames.has("memory_run_log")).toBe(true);
  expect(tableNames.has("memory_update_settings")).toBe(true);

  const updateSettingsColumns = (db.query(`PRAGMA table_info(memory_update_settings)`).all() as Array<{ name: string }>).map((row) => row.name);
  expect(updateSettingsColumns).toEqual([
    "user_id",
    "enabled",
    "schedule_mode",
    "interval_sec",
    "cron_expr",
    "last_run_at",
    "last_finished_at",
    "last_status",
    "last_error",
    "created_at",
    "updated_at",
  ]);
});

test("SQLite backend canonicalizes obvious atom variants on upsert", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-memory-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });

    const first = await backend.upsertMemoryAtom({
      userId: "u1",
      text: "User's name is Wii.",
      importance: 2,
      sourceConversationIds: [1],
      sourceLayer: "L1",
    });
    const second = await backend.upsertMemoryAtom({
      userId: "u1",
      text: "User’s name is Wii.",
      importance: 5,
      sourceConversationIds: [2, 1],
      sourceLayer: "L1",
    });

    const atoms = await backend.listMemoryAtoms("u1", 10);
    const row = db
      .query(`SELECT canonical_text FROM memory_atoms WHERE id = ?`)
      .get(first.atom.id) as { canonical_text: string | null } | null;

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.atom.id).toBe(first.atom.id);
    expect(atoms).toEqual([
      expect.objectContaining({
        id: first.atom.id,
        text: "User’s name is Wii.",
        importance: 5,
        sourceConversationIds: [1, 2],
      }),
    ]);
    expect(row?.canonical_text).not.toBeNull();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("SQLite backend keeps broader paraphrases separate when canonical text differs", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-memory-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });

    await backend.upsertMemoryAtom({
      userId: "u1",
      text: "User prefers the assistant not to use bold formatting like **text**.",
      sourceConversationIds: [3],
      sourceLayer: "L1",
    });
    await backend.upsertMemoryAtom({
      userId: "u1",
      text: "User does not want the assistant to use ** (bold/markdown tebal) in answers.",
      sourceConversationIds: [4],
      sourceLayer: "L1",
    });

    expect(await backend.listMemoryAtoms("u1", 10)).toHaveLength(2);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
