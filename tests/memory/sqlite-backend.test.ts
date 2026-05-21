import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { migrate } from "../../src/db/schema";
import { migrateSqliteMemory } from "../../src/memory/backends/sqlite/migrate";
import { SqliteMemoryBackend } from "../../src/memory/backends/sqlite/backend";
import { InteractionLogService } from "../../src/memory/events/service";
import type { JsonValue } from "../../src/memory/core/types";

test("SQLite backend stores interaction events, optional diagnostic exports, JSONL history, and checkpoints", async () => {
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
      historyDir: join(tempDir, "history"),
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
    const history = await Bun.file(join(tempDir, "history", "c1.jsonl")).text();

    expect(turns).toHaveLength(0);
    expect(jsonl).toContain('"type":"user_message"');
    expect(history).toContain('"role":"user"');
    expect(history).toContain('"role":"tool"');
    expect(events.some((event) => event.type === "tool_result")).toBe(true);
    expect(await backend.getCheckpoint("u1", "l1_last_conversation_id")).toBe("1");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("SQLite backend stores task offload pipeline records", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-memory-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);

    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
      taskCanvasDir: join(tempDir, "memory", "task-canvases"),
    });
    await backend.init();

    const task = await backend.createTaskCanvas({
      chatId: "chat/one",
      userId: "u1",
      label: "Build Skill!",
    });

    expect(task.status).toBe("active");
    expect(task.filePath).toStartWith("memory/task-canvases/chat_one/");
    expect(task.filePath).toEndWith("-build-skill.mmd");
    expect(await readFile(join(tempDir, task.filePath), "utf8")).toContain("graph LR");
    expect(await backend.getActiveTaskCanvas("u1", "chat/one")).toEqual(task);

    const boundary = await backend.insertTaskBoundary({
      chatId: "chat/one",
      userId: "u1",
      startNodeSequence: 7,
      result: "long",
      taskId: task.id,
    });
    expect(boundary.taskId).toBe(task.id);
    expect(boundary.result).toBe("long");

    const judgment = await backend.recordL15Judgment({
      chatId: "chat/one",
      userId: "u1",
      sourceConversationId: 12,
      taskCompleted: false,
      isLongTask: true,
      isContinuation: true,
      selectedTaskId: task.id,
      source: "rules",
    });
    expect(judgment.selectedTaskId).toBe(task.id);
    expect(judgment.sourceConversationId).toBe(12);

    await backend.insertTaskGraphNode({
      chatId: "chat/one",
      userId: "u1",
      nodeId: "node-1",
      toolName: "demo_tool",
      args: { ok: true },
      summary: "did work",
      status: "offloaded",
      taskId: task.id,
    });
    const taskNodes = await backend.listTaskGraphNodesForTask(task.id, 10);
    expect(taskNodes).toEqual([
      expect.objectContaining({
        nodeId: "node-1",
        taskId: task.id,
      }),
    ]);

    const skill = await backend.insertGeneratedSkill({
      sourceTaskId: task.id,
      chatId: "chat/one",
      userId: "u1",
      skillName: "demo-skill",
      skillDescription: "Demo skill",
      skillFocus: "offload",
      skillFilePath: "skills/demo-skill/SKILL.md",
      sourceCanvasFilePath: task.filePath,
      sourceNodeIds: ["node-1"],
      sourceEvidenceIds: ["evidence-1"],
      status: "draft",
    });

    expect(skill.sourceNodeIds).toEqual(["node-1"]);
    expect(await backend.countGeneratedSkills("u1")).toBe(1);
    expect(await backend.listGeneratedSkills("u1", 10)).toEqual([
      expect.objectContaining({
        id: skill.id,
        sourceEvidenceIds: ["evidence-1"],
      }),
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("SQLite backend reads the active task canvas for the matching user only", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-memory-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);

    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
      taskCanvasDir: join(tempDir, "task-canvases"),
    });
    await backend.init();

    const userOneTask = await backend.createTaskCanvas({ chatId: "shared-chat", userId: "u1", label: "user-one-task", status: "active" });
    const userTwoTask = await backend.createTaskCanvas({ chatId: "shared-chat", userId: "u2", label: "user-two-task", status: "active" });
    await writeFile(join(tempDir, userOneTask.filePath), "flowchart TD\n  U1[\"User one active canvas\"]\n", "utf8");
    await writeFile(join(tempDir, userTwoTask.filePath), "flowchart TD\n  U2[\"User two active canvas\"]\n", "utf8");

    expect(await backend.getTaskCanvasForUser("u1", "shared-chat")).toContain("User one active canvas");
    expect(await backend.getTaskCanvasForUser("u1", "shared-chat")).not.toContain("User two active canvas");
    expect(await backend.getTaskCanvasForUser("u2", "shared-chat")).toContain("User two active canvas");
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
      historyDir: join(tempDir, "history"),
    });

    const eventId = await logs.logUserMessage({ chatId: "c2", userId: "u2", content: "persist this", mode: "chat" });
    const turns = await backend.listConversationTurns("u2", "c2", 10);
    const events = await backend.listInteractionEvents("u2", "c2", 10);

    expect(eventId).toBeNumber();
    expect(turns).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(await Bun.file(join(tempDir, "history", "c2.jsonl")).exists()).toBe(true);
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

test("migrate backfills canonical text for exact legacy memory atom upserts", async () => {
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

      CREATE VIRTUAL TABLE memory_atoms_fts USING fts5(
        text,
        atom_id UNINDEXED,
        user_id UNINDEXED,
        tokenize = 'unicode61'
      );

      CREATE TABLE memory_atom_embeddings (
        atom_id INTEGER PRIMARY KEY,
        user_id TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(atom_id) REFERENCES memory_atoms(id) ON DELETE CASCADE
      );

      INSERT INTO memory_atoms (id, user_id, text, importance, source_turn_ids_json, source_layer, created_at, updated_at)
      VALUES (42, 'u1', 'User prefers concise responses.', 2, '[7]', 'L1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
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
      importance: 5,
      sourceConversationIds: [9, 7],
      sourceLayer: "L1",
    });
    const rows = db.query(`SELECT id, canonical_text FROM memory_atoms WHERE user_id = 'u1'`).all() as Array<{
      id: number;
      canonical_text: string | null;
    }>;

    expect(result.created).toBe(false);
    expect(result.atom.id).toBe(42);
    expect(result.atom.importance).toBe(5);
    expect(result.atom.sourceConversationIds).toEqual([7, 9]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: 42,
      canonical_text: expect.any(String),
    });
    expect(rows[0]?.canonical_text).not.toBe("");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("migrateSqliteMemory backfills canonical_text and compacts exact duplicate atoms", async () => {
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

    CREATE VIRTUAL TABLE memory_atoms_fts USING fts5(
      text,
      atom_id UNINDEXED,
      user_id UNINDEXED,
      tokenize = 'unicode61'
    );

    CREATE TABLE memory_atom_embeddings (
      atom_id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE lineage_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      link_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, source_kind, source_id, target_kind, target_id, link_type)
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

  db.query(`INSERT INTO memory_atoms (user_id, text, importance, source_turn_ids_json, source_layer, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("u1", "User's name is Wii.", 2, JSON.stringify([1]), "L1", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  db.query(`INSERT INTO memory_atoms (user_id, text, importance, source_turn_ids_json, source_layer, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("u1", "User’s name is Wii.", 5, JSON.stringify([2]), "L1", "2026-01-02T00:00:00.000Z", "2026-01-02T00:00:00.000Z");

  db.query(`INSERT INTO memory_atoms_fts (text, atom_id, user_id) VALUES (?, ?, ?)`)
    .run("User's name is Wii.", "1", "u1");
  db.query(`INSERT INTO memory_atoms_fts (text, atom_id, user_id) VALUES (?, ?, ?)`)
    .run("User’s name is Wii.", "2", "u1");
  db.query(`INSERT INTO memory_atom_embeddings (atom_id, user_id, embedding_json, updated_at) VALUES (?, ?, ?, ?)`)
    .run(1, "u1", "[1,0,0]", "2026-01-01T00:00:00.000Z");
  db.query(`INSERT INTO memory_atom_embeddings (atom_id, user_id, embedding_json, updated_at) VALUES (?, ?, ?, ?)`)
    .run(2, "u1", "[0,1,0]", "2026-01-02T00:00:00.000Z");

  db.query(`INSERT INTO lineage_links (user_id, source_kind, source_id, target_kind, target_id, link_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("u1", "conversation", "7", "memory_atom", "1", "evidence", "2026-01-01T00:00:00.000Z");
  db.query(`INSERT INTO lineage_links (user_id, source_kind, source_id, target_kind, target_id, link_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("u1", "conversation", "7", "memory_atom", "2", "evidence", "2026-01-01T00:00:00.000Z");
  db.query(`INSERT INTO memory_scenarios (user_id, title, body_markdown, atom_ids_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("u1", "Identity", "- atom_id=1 User's name is Wii.\n- atom_id=2 User’s name is Wii.", JSON.stringify([1, 2]), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");

  migrateSqliteMemory(db);

  const atoms = db.query(`SELECT id, text, importance, source_turn_ids_json, canonical_text FROM memory_atoms ORDER BY id ASC`).all() as Array<{
    id: number;
    text: string;
    importance: number;
    source_turn_ids_json: string;
    canonical_text: string;
  }>;
  const scenario = db.query(`SELECT atom_ids_json FROM memory_scenarios WHERE user_id = ?`).get("u1") as { atom_ids_json: string } | null;
  const lineageCount = db.query(`SELECT COUNT(*) AS count FROM lineage_links WHERE user_id = ? AND target_kind = 'memory_atom' AND target_id = '1'`).get("u1") as { count: number };
  const duplicateLineageCount = db.query(`SELECT COUNT(*) AS count FROM lineage_links WHERE user_id = ? AND target_kind = 'memory_atom' AND target_id = '2'`).get("u1") as { count: number };

  expect(atoms).toEqual([
    expect.objectContaining({
      id: 1,
      importance: 5,
      source_turn_ids_json: JSON.stringify([1, 2]),
    }),
  ]);
  expect(atoms[0]?.canonical_text).toBeString();
  expect(JSON.parse(scenario?.atom_ids_json ?? "[]")).toEqual([1]);
  expect(lineageCount.count).toBe(1);
  expect(duplicateLineageCount.count).toBe(0);
});

test("migrateSqliteMemory removes lineage self-links created by duplicate compaction", () => {
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

    CREATE TABLE lineage_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      link_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, source_kind, source_id, target_kind, target_id, link_type)
    );

    INSERT INTO memory_atoms (id, user_id, text, importance, source_turn_ids_json, source_layer, created_at, updated_at)
    VALUES
      (1, 'u1', 'User''s name is Wii.', 2, '[1]', 'L1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      (2, 'u1', 'User’s name is Wii.', 3, '[2]', 'L1', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');

    INSERT INTO lineage_links (user_id, source_kind, source_id, target_kind, target_id, link_type, created_at)
    VALUES
      ('u1', 'memory_atom', '1', 'memory_atom', '2', 'derived_from', '2026-01-02T00:00:00.000Z'),
      ('u1', 'memory_atom', '2', 'memory_atom', '1', 'derived_from', '2026-01-02T00:00:00.000Z');
  `);

  migrateSqliteMemory(db);

  const atoms = db.query(`SELECT id FROM memory_atoms ORDER BY id ASC`).all() as Array<{ id: number }>;
  const selfLinkCount = db.query(`
    SELECT COUNT(*) AS count
    FROM lineage_links
    WHERE source_kind = 'memory_atom'
      AND target_kind = 'memory_atom'
      AND source_id = target_id
  `).get() as { count: number };

  expect(atoms).toEqual([{ id: 1 }]);
  expect(selfLinkCount.count).toBe(0);
});

test("migrateSqliteMemory keeps lowest duplicate id but preserves latest updated text", () => {
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

    INSERT INTO memory_atoms (id, user_id, text, importance, source_turn_ids_json, source_layer, created_at, updated_at)
    VALUES
      (1, 'u1', 'User’s name is Wii.', 2, '[1]', 'L1', '2026-01-01T00:00:00.000Z', '2026-01-03T00:00:00.000Z'),
      (2, 'u1', 'User''s name is Wii.', 3, '[2]', 'L1', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
  `);

  migrateSqliteMemory(db);

  const atoms = db.query(`SELECT id, text, updated_at FROM memory_atoms ORDER BY id ASC`).all() as Array<{
    id: number;
    text: string;
    updated_at: string;
  }>;

  expect(atoms).toEqual([
    {
      id: 1,
      text: "User’s name is Wii.",
      updated_at: "2026-01-03T00:00:00.000Z",
    },
  ]);
});

test("migrateSqliteMemory compacts empty canonical_text duplicates and indexes non-null canonical text", () => {
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

    CREATE VIRTUAL TABLE memory_atoms_fts USING fts5(
      text,
      atom_id UNINDEXED,
      user_id UNINDEXED,
      tokenize = 'unicode61'
    );

    CREATE TABLE memory_atom_embeddings (
      atom_id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE lineage_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      link_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, source_kind, source_id, target_kind, target_id, link_type)
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

    INSERT INTO memory_atoms (id, user_id, text, importance, source_turn_ids_json, source_layer, created_at, updated_at)
    VALUES
      (1, 'u1', '!!!', 1, '[1]', 'L1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      (2, 'u1', '???', 4, '[2]', 'L1', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
  `);

  migrateSqliteMemory(db);

  const atoms = db.query(`SELECT id, canonical_text, importance, source_turn_ids_json FROM memory_atoms ORDER BY id ASC`).all() as Array<{
    id: number;
    canonical_text: string | null;
    importance: number;
    source_turn_ids_json: string;
  }>;
  const index = db.query(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'memory_atoms_user_canonical_text_idx'`).get() as { sql: string } | null;
  const normalizedIndexSql = index?.sql.replace(/\s+/g, " ").trim();

  expect(atoms).toEqual([
    {
      id: 1,
      canonical_text: "",
      importance: 4,
      source_turn_ids_json: JSON.stringify([1, 2]),
    },
  ]);
  expect(normalizedIndexSql).toContain("WHERE canonical_text IS NOT NULL");
  expect(normalizedIndexSql).not.toContain("canonical_text != ''");
});

test("migrateSqliteMemory replaces stale canonical_text unique index predicate", () => {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE memory_atoms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      text TEXT NOT NULL,
      canonical_text TEXT,
      importance INTEGER NOT NULL DEFAULT 3,
      source_turn_ids_json TEXT NOT NULL DEFAULT '[]',
      source_layer TEXT NOT NULL DEFAULT 'L1',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, text)
    );

    CREATE UNIQUE INDEX memory_atoms_user_canonical_text_idx
    ON memory_atoms (user_id, canonical_text)
    WHERE canonical_text IS NOT NULL AND canonical_text != '';
  `);

  migrateSqliteMemory(db);

  const index = db.query(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'memory_atoms_user_canonical_text_idx'`).get() as { sql: string } | null;
  const normalizedIndexSql = index?.sql.replace(/\s+/g, " ").trim();

  expect(normalizedIndexSql).toContain("WHERE canonical_text IS NOT NULL");
  expect(normalizedIndexSql).not.toContain("canonical_text != ''");
});

test("migrateSqliteMemory drops stale canonical_text unique index before duplicate backfill", () => {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE memory_atoms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      text TEXT NOT NULL,
      canonical_text TEXT,
      importance INTEGER NOT NULL DEFAULT 3,
      source_turn_ids_json TEXT NOT NULL DEFAULT '[]',
      source_layer TEXT NOT NULL DEFAULT 'L1',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, text)
    );

    CREATE UNIQUE INDEX memory_atoms_user_canonical_text_idx
    ON memory_atoms (user_id, canonical_text)
    WHERE canonical_text IS NOT NULL AND canonical_text != '';

    INSERT INTO memory_atoms (id, user_id, text, canonical_text, importance, source_turn_ids_json, source_layer, created_at, updated_at)
    VALUES
      (1, 'u1', 'User''s name is Wii.', NULL, 2, '[7]', 'L1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      (2, 'u1', 'User’s name is Wii.', NULL, 5, '[8]', 'L1', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
  `);

  expect(() => migrateSqliteMemory(db)).not.toThrow();

  const atoms = db.query(`SELECT id, canonical_text, importance, source_turn_ids_json FROM memory_atoms ORDER BY id ASC`).all() as Array<{
    id: number;
    canonical_text: string | null;
    importance: number;
    source_turn_ids_json: string;
  }>;
  const index = db.query(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'memory_atoms_user_canonical_text_idx'`).get() as { sql: string } | null;
  const normalizedIndexSql = index?.sql.replace(/\s+/g, " ").trim();

  expect(atoms).toEqual([
    {
      id: 1,
      canonical_text: "user s name is wii",
      importance: 5,
      source_turn_ids_json: JSON.stringify([7, 8]),
    },
  ]);
  expect(normalizedIndexSql).toContain("WHERE canonical_text IS NOT NULL");
  expect(normalizedIndexSql).not.toContain("canonical_text != ''");
});

test("SQLite backend uses compacted canonical duplicate survivor after migration", async () => {
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

      CREATE VIRTUAL TABLE memory_atoms_fts USING fts5(
        text,
        atom_id UNINDEXED,
        user_id UNINDEXED,
        tokenize = 'unicode61'
      );

      CREATE TABLE memory_atom_embeddings (
        atom_id INTEGER PRIMARY KEY,
        user_id TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(atom_id) REFERENCES memory_atoms(id) ON DELETE CASCADE
      );

      INSERT INTO memory_atoms (id, user_id, text, importance, source_turn_ids_json, source_layer, created_at, updated_at)
      VALUES
        (41, 'u1', 'User''s name is Wii.', 2, '[7]', 'L1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
        (42, 'u1', 'User’s name is Wii.', 3, '[8]', 'L1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `);
    migrateSqliteMemory(db);

    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });

    const result = await backend.upsertMemoryAtom({
      userId: "u1",
      text: "User’s name is Wii.",
      importance: 5,
      sourceConversationIds: [9],
      sourceLayer: "L1",
    });
    const rows = db
      .query(`SELECT id, text, canonical_text, importance, source_turn_ids_json FROM memory_atoms WHERE user_id = 'u1' ORDER BY id ASC`)
      .all() as Array<{ id: number; text: string; canonical_text: string | null; importance: number; source_turn_ids_json: string }>;

    expect(result.created).toBe(false);
    expect(result.atom.id).toBe(41);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      id: 41,
      text: "User’s name is Wii.",
      importance: 5,
      source_turn_ids_json: JSON.stringify([7, 8, 9]),
    }));
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
  expect(atomColumns.has("canonical_text")).toBe(true);
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

test("SQLite backend keeps programming language atoms with semantic symbols separate", async () => {
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
      text: "User primarily codes in C++.",
      sourceConversationIds: [1],
      sourceLayer: "L1",
    });
    const second = await backend.upsertMemoryAtom({
      userId: "u1",
      text: "User primarily codes in C#.",
      sourceConversationIds: [2],
      sourceLayer: "L1",
    });

    const atoms = await backend.listMemoryAtoms("u1", 10);

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(atoms).toHaveLength(2);
    expect(atoms.map((atom) => atom.text).sort()).toEqual([
      "User primarily codes in C#.",
      "User primarily codes in C++.",
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("SQLite backend stores L1 evidence and indexes task canvases for recall", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-memory-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);

    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
      taskCanvasDir: join(tempDir, "memory", "task-canvases"),
    });
    await backend.init();

    const task = await backend.createTaskCanvas({ chatId: "c1", userId: "u1", label: "fix-login-flow" });
    const evidence = await backend.insertL1EvidenceEntry({
      chatId: "c1",
      userId: "u1",
      taskId: task.id,
      nodeId: "ref_l1_1",
      toolCallId: "call_1",
      toolName: "read_file",
      args: { path: "src/login.ts" },
      summary: "Read login flow and found missing token refresh branch.",
      resultRef: "refs/c1/ref_l1_1.md",
      score: 8,
      status: "pending",
    });

    expect(evidence.id).toBeNumber();
    expect(evidence.toolCallId).toBe("call_1");
    expect(evidence.score).toBe(8);

    const pending = await backend.listPendingL1EvidenceEntriesForTask(task.id, 10);
    expect(pending.map((entry) => entry.nodeId)).toEqual(["ref_l1_1"]);

    await backend.updateL1EvidenceNodeMapping(task.id, { ref_l1_1: "N1" });
    const mapped = await backend.listL1EvidenceEntriesForTask(task.id, 10);
    expect(mapped[0]).toEqual(expect.objectContaining({ nodeId: "ref_l1_1", mmdNodeId: "N1", status: "mapped" }));

    const canvas = "flowchart TD\n  N1[\"Inspect login flow<br/>status: done<br/>summary: Missing token refresh branch\"]\n";
    await backend.upsertTaskCanvasSearchText({
      taskId: task.id,
      chatId: "c1",
      userId: "u1",
      label: task.label,
      status: "active",
      filePath: task.filePath,
      canvas,
    });

    const results = await backend.searchTaskCanvases("u1", "token refresh", 5, "c1");
    expect(results).toEqual([
      expect.objectContaining({
        id: task.id,
        label: "fix-login-flow",
        filePath: task.filePath,
        canvas,
      }),
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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
