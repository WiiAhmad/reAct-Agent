import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import type { LlmProvider } from "../../src/agent/types";
import { migrate } from "../../src/db/schema";
import { migrateSqliteMemory } from "../../src/memory/backends/sqlite/migrate";
import { SqliteMemoryBackend } from "../../src/memory/backends/sqlite/backend";
import { SqliteMemoryStore } from "../../src/memory/backends/sqlite/store";
import { createMemoryService } from "../../src/memory/integration/factory";
import { MemoryService, type MemoryServiceOptions } from "../../src/memory/core/service";
import { RecallService } from "../../src/memory/recall/service";
import { PipelineCoordinator } from "../../src/memory/pipeline/coordinator";
import { runL1Pipeline } from "../../src/memory/pipeline/l1";
import { runL2Pipeline } from "../../src/memory/pipeline/l2";
import { buildSceneProfiles } from "../../src/memory/pipeline/l2-scenes";
import { runL3Pipeline } from "../../src/memory/pipeline/l3";

const fakeLlm: LlmProvider = {
  async complete({ messages }) {
    const system = String(messages[0]?.content ?? "");
    if (system.includes("L1 extractor")) {
      return {
        content: JSON.stringify([{ text: "User prefers Bun runtime", importance: 4, source_turn_ids: [1] }]),
        toolCalls: [],
      };
    }
    if (system.includes("L2 Scenario aggregator")) {
      return { content: "## Runtime choices\n- atom_id=1 User prefers Bun runtime", toolCalls: [] };
    }
    return { content: "# Persona\nPrefers Bun runtime.", toolCalls: [] };
  },
};

async function createMemory() {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-imemory-store-integration-"));
  const db = new Database(":memory:");
  migrateSqliteMemory(db);
  const backend = new SqliteMemoryBackend(db, {
    dataDir: tempDir,
    refsDir: join(tempDir, "refs"),
    canvasDir: join(tempDir, "canvases"),
  });
  const store = new SqliteMemoryStore(db, { sqliteVecEnabled: false, bm25Enabled: false });
  await store.init();
  return { tempDir, backend, store };
}

function memoryServiceOptions(tempDir: string): MemoryServiceOptions {
  return {
    dataDir: tempDir,
    backendName: "sqlite",
    backendOwner: "test-owner",
    maintenanceCron: "0 * * * *",
    retentionDays: 30,
    offloadEnabled: true,
    l15: {
      enabled: true,
      mode: "hybrid",
      recentMessages: 6,
      historyTaskLimit: 10,
      maxCanvasChars: 12000,
      safeFallback: "short",
    },
    l1: {
      enabled: true,
      mode: "local",
      maxSummaryChars: 900,
      defaultScore: 5,
    },
    l2: {
      enabled: true,
      mode: "local",
      triggerMinEntries: 1,
      maxCanvasChars: 12000,
    },
    taskRecall: {
      enabled: true,
      maxTasks: 3,
      maxCanvasChars: 2200,
    },
    l4: {
      enabled: true,
      mode: "local",
      requireCompletedTask: true,
      maxEvidenceEntries: 5,
      maxCanvasChars: 12000,
      maxSkillChars: 20000,
    },
    generatedSkillsDir: join(tempDir, "generated-skills"),
  };
}

async function createFactoryMemory() {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-imemory-factory-"));
  const db = new Database(":memory:");
  migrate(db);
  const service = await createMemoryService(db, fakeLlm, {
    storage: {
      dataDir: tempDir,
      memoryRefsDir: join(tempDir, "refs"),
      memoryCanvasDir: join(tempDir, "canvases"),
      memoryJsonlExportDir: join(tempDir, "jsonl"),
      historyDir: join(tempDir, "history"),
      memoryTaskCanvasDir: join(tempDir, "task-canvases"),
      memoryGeneratedSkillsDir: join(tempDir, "generated-skills"),
    },
    memory: {
      maintenanceCron: "0 * * * *",
      retentionDays: 30,
      offloadEnabled: true,
      offloadMinChars: 2500,
      offloadSummaryChars: 900,
      sqliteVecEnabled: false,
      jsonlExportEnabled: false,
    },
  });

  return { tempDir, db, service };
}

test("createMemoryService wires a store-backed MemoryService for generic save and recall", async () => {
  const { tempDir, db, service } = await createFactoryMemory();

  try {
    const id = await service.saveMemory({ userId: "u1", text: "User prefers Bun runtime", importance: 6 });
    await service.logUserMessage({ chatId: "c1", userId: "u1", content: "Please remember my Bun runtime preference.", mode: "chat" });
    const recall = await service.recall("u1", "Bun runtime", 5, "c1");
    const storeCount = db.query(`SELECT COUNT(*) AS count FROM memory_store_l1 WHERE user_id = ?`).get("u1") as { count: number } | null;

    expect(id).toBeGreaterThan(0);
    expect(storeCount?.count).toBe(1);
    expect(recall.atoms).toEqual([expect.objectContaining({ text: "User prefers Bun runtime", importance: 6 })]);
    expect(recall.conversations).toEqual([
      expect.objectContaining({ role: "user", content: "Please remember my Bun runtime preference." }),
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}, 20000);

test("createMemoryService restart does not duplicate store L1 records during legacy backfill", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-imemory-restart-"));
  const dbPath = join(tempDir, "agent.db");
  const config = {
    storage: {
      dataDir: tempDir,
      memoryRefsDir: join(tempDir, "refs"),
      memoryCanvasDir: join(tempDir, "canvases"),
      memoryJsonlExportDir: join(tempDir, "jsonl"),
      historyDir: join(tempDir, "history"),
      memoryTaskCanvasDir: join(tempDir, "task-canvases"),
      memoryGeneratedSkillsDir: join(tempDir, "generated-skills"),
    },
    memory: {
      maintenanceCron: "0 * * * *",
      retentionDays: 30,
      offloadEnabled: true,
      offloadMinChars: 2500,
      offloadSummaryChars: 900,
      sqliteVecEnabled: false,
      jsonlExportEnabled: false,
    },
  };

  try {
    {
      const db = new Database(dbPath);
      migrate(db);
      const service = await createMemoryService(db, fakeLlm, config);
      await service.saveMemory({ userId: "u1", text: "User prefers Bun runtime", importance: 6 });

      const recordIds = (db.query(`SELECT record_id FROM memory_store_l1 WHERE user_id = ? ORDER BY record_id ASC`).all("u1") as Array<{ record_id: string }>)
        .map((row) => row.record_id);

      expect(recordIds).toHaveLength(1);
      expect(recordIds[0]?.startsWith("store:l1:")).toBe(true);
      db.close();
    }

    {
      const db = new Database(dbPath);
      migrate(db);
      await createMemoryService(db, fakeLlm, config);

      const recordIds = (db.query(`SELECT record_id FROM memory_store_l1 WHERE user_id = ? ORDER BY record_id ASC`).all("u1") as Array<{ record_id: string }>)
        .map((row) => row.record_id);

      expect(recordIds).toHaveLength(1);
      expect(recordIds[0]?.startsWith("store:l1:")).toBe(true);
      expect(recordIds.some((recordId) => recordId.startsWith("legacy:l1:"))).toBe(false);
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => undefined);
  }
}, 20000);

test("createMemoryService restart merges legacy L1 evidence into canonical store records", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-imemory-restart-merge-"));
  const dbPath = join(tempDir, "agent.db");
  const config = {
    storage: {
      dataDir: tempDir,
      memoryRefsDir: join(tempDir, "refs"),
      memoryCanvasDir: join(tempDir, "canvases"),
      memoryJsonlExportDir: join(tempDir, "jsonl"),
      historyDir: join(tempDir, "history"),
      memoryTaskCanvasDir: join(tempDir, "task-canvases"),
      memoryGeneratedSkillsDir: join(tempDir, "generated-skills"),
    },
    memory: {
      maintenanceCron: "0 * * * *",
      retentionDays: 30,
      offloadEnabled: true,
      offloadMinChars: 2500,
      offloadSummaryChars: 900,
      sqliteVecEnabled: false,
      jsonlExportEnabled: false,
    },
  };

  try {
    {
      const db = new Database(dbPath);
      migrate(db);
      const service = await createMemoryService(db, fakeLlm, config);
      await service.saveMemory({ userId: "u1", text: "User prefers Bun runtime", importance: 4 });
      db.query(`
        UPDATE memory_atoms
        SET importance = ?, source_turn_ids_json = ?, updated_at = ?
        WHERE user_id = ? AND text = ?
      `).run(6, "[42]", "2026-05-18T09:00:00.000Z", "u1", "User prefers Bun runtime");
      db.close();
    }

    {
      const db = new Database(dbPath);
      migrate(db);
      await createMemoryService(db, fakeLlm, config);

      const rows = db.query(`
        SELECT record_id, priority, source_conversation_ids_json
        FROM memory_store_l1
        WHERE user_id = ?
        ORDER BY record_id ASC
      `).all("u1") as Array<{ record_id: string; priority: number; source_conversation_ids_json: string }>;

      expect(rows).toHaveLength(1);
      expect(rows[0]?.record_id.startsWith("store:l1:")).toBe(true);
      expect(rows[0]?.priority).toBe(6);
      expect(JSON.parse(rows[0]?.source_conversation_ids_json ?? "[]")).toEqual([42]);
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => undefined);
  }
}, 20000);

test("createMemoryService restart compacts paraphrased generic memories across backend and store", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-imemory-generic-compact-"));
  const dbPath = join(tempDir, "agent.db");
  const config = {
    storage: {
      dataDir: tempDir,
      memoryRefsDir: join(tempDir, "refs"),
      memoryCanvasDir: join(tempDir, "canvases"),
      memoryJsonlExportDir: join(tempDir, "jsonl"),
      historyDir: join(tempDir, "history"),
      memoryTaskCanvasDir: join(tempDir, "task-canvases"),
      memoryGeneratedSkillsDir: join(tempDir, "generated-skills"),
    },
    memory: {
      maintenanceCron: "0 * * * *",
      retentionDays: 30,
      offloadEnabled: true,
      offloadMinChars: 2500,
      offloadSummaryChars: 900,
      sqliteVecEnabled: false,
      jsonlExportEnabled: false,
    },
  };

  try {
    {
      const db = new Database(dbPath);
      migrate(db);
      const service = await createMemoryService(db, fakeLlm, config);
      await service.saveMemory({ userId: "u1", text: "User wants the assistant's name to be Winter.", importance: 4 });
      await service.saveMemory({ userId: "u1", text: "User wants the assistant's name to be Winter (user corrects: 'remember ur name is Winter').", importance: 4 });
      db.close();
    }

    {
      const db = new Database(dbPath);
      migrate(db);
      await createMemoryService(db, fakeLlm, config);

      const atomCount = (db.query(`SELECT COUNT(*) AS count FROM memory_atoms WHERE user_id = ?`).get("u1") as { count: number }).count;
      const storeCount = (db.query(`SELECT COUNT(*) AS count FROM memory_store_l1 WHERE user_id = ?`).get("u1") as { count: number }).count;

      expect(atomCount).toBe(1);
      expect(storeCount).toBe(1);
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => undefined);
  }
}, 20000);

test("createMemoryService semantically merges paraphrased generic saves immediately", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-imemory-semantic-save-"));
  const db = new Database(":memory:");
  migrate(db);
  const llm = {
    async complete({ messages }: { messages: Array<{ role: string; content?: string }> }) {
      const system = String(messages[0]?.content ?? "");
      if (!system.includes("L1 semantic dedupe decision step")) {
        throw new Error(`Unexpected LLM call: ${system}`);
      }
      const prompt = String(messages[1]?.content ?? "");
      const payload = JSON.parse(prompt.match(/\{[\s\S]*\}$/)?.[0] ?? "{}") as { candidates?: Array<{ recordId: string }> };
      return {
        content: JSON.stringify({ action: "merge", targetRecordId: payload.candidates?.[0]?.recordId }),
        toolCalls: [],
      };
    },
  };
  const service = await createMemoryService(db, llm as any, {
    storage: {
      dataDir: tempDir,
      memoryRefsDir: join(tempDir, "refs"),
      memoryCanvasDir: join(tempDir, "canvases"),
      memoryJsonlExportDir: join(tempDir, "jsonl"),
      historyDir: join(tempDir, "history"),
      memoryTaskCanvasDir: join(tempDir, "task-canvases"),
      memoryGeneratedSkillsDir: join(tempDir, "generated-skills"),
    },
    memory: {
      maintenanceCron: "0 * * * *",
      retentionDays: 30,
      offloadEnabled: true,
      offloadMinChars: 2500,
      offloadSummaryChars: 900,
      sqliteVecEnabled: false,
      jsonlExportEnabled: false,
    },
  });

  try {
    await service.saveMemory({ userId: "u1", text: "User prefers short replies.", importance: 4 });
    await service.saveMemory({ userId: "u1", text: "User prefers terse replies.", importance: 4 });

    const atomCount = (db.query(`SELECT COUNT(*) AS count FROM memory_atoms WHERE user_id = ?`).get("u1") as { count: number }).count;
    const storeRows = db.query(`SELECT content FROM memory_store_l1 WHERE user_id = ? ORDER BY record_id ASC`).all("u1") as Array<{ content: string }>;

    expect(atomCount).toBe(1);
    expect(storeRows).toHaveLength(1);
    expect(storeRows[0]?.content).toBe("User prefers short replies.");
  } finally {
    db.close();
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}, 20000);

test("createMemoryService restart refreshes stale generic scene profiles after compaction", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-imemory-scene-refresh-"));
  const dbPath = join(tempDir, "agent.db");
  const config = {
    storage: {
      dataDir: tempDir,
      memoryRefsDir: join(tempDir, "refs"),
      memoryCanvasDir: join(tempDir, "canvases"),
      memoryJsonlExportDir: join(tempDir, "jsonl"),
      historyDir: join(tempDir, "history"),
      memoryTaskCanvasDir: join(tempDir, "task-canvases"),
      memoryGeneratedSkillsDir: join(tempDir, "generated-skills"),
    },
    memory: {
      maintenanceCron: "0 * * * *",
      retentionDays: 30,
      offloadEnabled: true,
      offloadMinChars: 2500,
      offloadSummaryChars: 900,
      sqliteVecEnabled: false,
      jsonlExportEnabled: false,
    },
  };

  try {
    {
      const db = new Database(dbPath);
      migrate(db);
      const service = await createMemoryService(db, fakeLlm, config);
      await service.saveMemory({ userId: "u1", text: "User wants the assistant's name to be Winter.", importance: 4 });
      await service.saveMemory({ userId: "u1", text: "User wants the assistant's name to be Winter (user corrects: 'remember ur name is Winter').", importance: 4 });
      db.query(`
        UPDATE memory_store_profiles
        SET content = ?, content_md5 = ?, updated_at_ms = ?
        WHERE id = ?
      `).run(
        "# Scene: generic memory\n\n- [4] User wants the assistant's name to be Winter.\n- [4] User wants the assistant's name to be Winter (user corrects: 'remember ur name is Winter').",
        "stale-scene",
        1,
        "scene:u1:generic-memory",
      );
      db.close();
    }

    {
      const db = new Database(dbPath);
      migrate(db);
      await createMemoryService(db, fakeLlm, config);

      const row = db.query(`SELECT content FROM memory_store_profiles WHERE id = ?`).get("scene:u1:generic-memory") as { content: string } | null;
      const bulletCount = (row?.content.match(/^- \[4\]/gm) ?? []).length;

      expect(bulletCount).toBe(1);
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => undefined);
  }
}, 20000);

test("createMemoryService falls back to plain generic save when semantic dedupe fails", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-imemory-dedupe-fallback-"));
  const db = new Database(":memory:");
  migrate(db);
  const llm = {
    async complete() {
      throw new Error("dedupe offline");
    },
  };
  const service = await createMemoryService(db, llm as any, {
    storage: {
      dataDir: tempDir,
      memoryRefsDir: join(tempDir, "refs"),
      memoryCanvasDir: join(tempDir, "canvases"),
      memoryJsonlExportDir: join(tempDir, "jsonl"),
      historyDir: join(tempDir, "history"),
      memoryTaskCanvasDir: join(tempDir, "task-canvases"),
      memoryGeneratedSkillsDir: join(tempDir, "generated-skills"),
    },
    memory: {
      maintenanceCron: "0 * * * *",
      retentionDays: 30,
      offloadEnabled: true,
      offloadMinChars: 2500,
      offloadSummaryChars: 900,
      sqliteVecEnabled: false,
      jsonlExportEnabled: false,
    },
  });

  try {
    await service.saveMemory({ userId: "u1", text: "User prefers short replies.", importance: 4 });
    await expect(service.saveMemory({ userId: "u1", text: "User prefers terse replies.", importance: 4 })).resolves.toBeGreaterThan(0);

    const atomCount = (db.query(`SELECT COUNT(*) AS count FROM memory_atoms WHERE user_id = ?`).get("u1") as { count: number }).count;
    const storeCount = (db.query(`SELECT COUNT(*) AS count FROM memory_store_l1 WHERE user_id = ?`).get("u1") as { count: number }).count;

    expect(atomCount).toBe(2);
    expect(storeCount).toBe(2);
  } finally {
    db.close();
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}, 20000);

test("createMemoryService restart keeps meaningful trailing parentheticals distinct", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-imemory-parenthetical-safety-"));
  const dbPath = join(tempDir, "agent.db");
  const config = {
    storage: {
      dataDir: tempDir,
      memoryRefsDir: join(tempDir, "refs"),
      memoryCanvasDir: join(tempDir, "canvases"),
      memoryJsonlExportDir: join(tempDir, "jsonl"),
      historyDir: join(tempDir, "history"),
      memoryTaskCanvasDir: join(tempDir, "task-canvases"),
      memoryGeneratedSkillsDir: join(tempDir, "generated-skills"),
    },
    memory: {
      maintenanceCron: "0 * * * *",
      retentionDays: 30,
      offloadEnabled: true,
      offloadMinChars: 2500,
      offloadSummaryChars: 900,
      sqliteVecEnabled: false,
      jsonlExportEnabled: false,
    },
  };

  try {
    {
      const db = new Database(dbPath);
      migrate(db);
      const service = await createMemoryService(db, fakeLlm, config);
      await service.saveMemory({ userId: "u1", text: "User lives in Paris (Texas).", importance: 4 });
      await service.saveMemory({ userId: "u1", text: "User lives in Paris.", importance: 4 });
      db.close();
    }

    {
      const db = new Database(dbPath);
      migrate(db);
      await createMemoryService(db, fakeLlm, config);

      const atomCount = (db.query(`SELECT COUNT(*) AS count FROM memory_atoms WHERE user_id = ?`).get("u1") as { count: number }).count;
      const storeCount = (db.query(`SELECT COUNT(*) AS count FROM memory_store_l1 WHERE user_id = ?`).get("u1") as { count: number }).count;

      expect(atomCount).toBe(2);
      expect(storeCount).toBe(2);
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => undefined);
  }
}, 20000);

test("createMemoryService semantic skip does not create fallback legacy store rows", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-imemory-skip-no-fallback-"));
  const db = new Database(":memory:");
  migrate(db);
  const llm = {
    async complete({ messages }: { messages: Array<{ role: string; content?: string }> }) {
      const system = String(messages[0]?.content ?? "");
      if (!system.includes("L1 semantic dedupe decision step")) {
        throw new Error(`Unexpected LLM call: ${system}`);
      }
      const prompt = String(messages[1]?.content ?? "");
      const payload = JSON.parse(prompt.match(/\{[\s\S]*\}$/)?.[0] ?? "{}") as { candidates?: Array<{ recordId: string }> };
      return {
        content: JSON.stringify({ action: "skip", targetRecordId: payload.candidates?.[0]?.recordId }),
        toolCalls: [],
      };
    },
  };
  const service = await createMemoryService(db, llm as any, {
    storage: {
      dataDir: tempDir,
      memoryRefsDir: join(tempDir, "refs"),
      memoryCanvasDir: join(tempDir, "canvases"),
      memoryJsonlExportDir: join(tempDir, "jsonl"),
      historyDir: join(tempDir, "history"),
      memoryTaskCanvasDir: join(tempDir, "task-canvases"),
      memoryGeneratedSkillsDir: join(tempDir, "generated-skills"),
    },
    memory: {
      maintenanceCron: "0 * * * *",
      retentionDays: 30,
      offloadEnabled: true,
      offloadMinChars: 2500,
      offloadSummaryChars: 900,
      sqliteVecEnabled: false,
      jsonlExportEnabled: false,
    },
  });

  try {
    await service.saveMemory({ userId: "u1", text: "User prefers short replies.", importance: 4 });
    await service.saveMemory({ userId: "u1", text: "User prefers terse replies.", importance: 4 });

    const atomCount = (db.query(`SELECT COUNT(*) AS count FROM memory_atoms WHERE user_id = ?`).get("u1") as { count: number }).count;
    const storeRecordIds = (db.query(`SELECT record_id FROM memory_store_l1 WHERE user_id = ? ORDER BY record_id ASC`).all("u1") as Array<{ record_id: string }>)
      .map((row) => row.record_id);

    expect(atomCount).toBe(1);
    expect(storeRecordIds).toHaveLength(1);
    expect(storeRecordIds[0]?.startsWith("store:l1:")).toBe(true);
  } finally {
    db.close();
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}, 20000);

test("MemoryService.saveMemory writes to IMemoryStore before backend compatibility mirror", async () => {
  const { tempDir, backend, store } = await createMemory();
  const calls: string[] = [];
  const orderedBackend = new Proxy(backend, {
    get(target, property, receiver) {
      if (property === "upsertMemoryAtom") {
        return async (...args: Parameters<typeof backend.upsertMemoryAtom>) => {
          calls.push("backend.upsertMemoryAtom");
          return backend.upsertMemoryAtom(...args);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const orderedStore = new Proxy(store, {
    get(target, property, receiver) {
      if (property === "upsertL1") {
        return async (...args: Parameters<typeof store.upsertL1>) => {
          calls.push("store.upsertL1");
          return store.upsertL1(...args);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const service = new MemoryService(orderedBackend, fakeLlm, memoryServiceOptions(tempDir), undefined, undefined, undefined, undefined, orderedStore);

  try {
    const id = await service.saveMemory({ userId: "u1", text: "User prefers Bun runtime", importance: 6 });

    expect(id).toBeGreaterThan(0);
    expect(calls.slice(0, 2)).toEqual(["store.upsertL1", "backend.upsertMemoryAtom"]);
    expect(await store.queryL1Records({ userId: "u1", type: "L1", limit: 10 })).toEqual([
      expect.objectContaining({ content: "User prefers Bun runtime", priority: 6 }),
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("store-backed memoryStatus reflects store L1/L2/L3 data", async () => {
  const { tempDir, db, service } = await createFactoryMemory();

  try {
    await service.saveMemory({ userId: "u1", text: "User prefers Bun runtime", importance: 6 });
    db.query(`
      INSERT INTO memory_store_profiles (
        id, type, user_id, filename, content, content_md5, version,
        created_at_ms, updated_at_ms, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "l2-u1", "l2", "u1", "scenario-u1.md", "## Runtime\nBun runtime preference", "l2-md5", 1, 1710000000000, 1710000000000, "{}",
      "l3-u1", "l3", "u1", "persona-u1.md", "# Persona\nPrefers Bun runtime.", "l3-md5", 1, 1710000000000, 1710000000000, "{}",
    );

    const status = await service.memoryStatus("u1", "c1");

    expect(status).toContain("L1 atoms=1");
    expect(status).toContain("L2 scenarios=2");
    expect(status).toContain("L3 persona=yes");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("L1 pipeline writes generic atoms into IMemoryStore when provided", async () => {
  const { tempDir, backend, store } = await createMemory();

  try {
    const result = await runL1Pipeline(backend, fakeLlm, "u1", [
      {
        id: 1,
        chatId: "c1",
        userId: "u1",
        role: "user",
        content: "Please use Bun for this bot.",
        meta: {},
        createdAt: "2026-05-18T08:00:00.000Z",
      },
    ], store);

    expect(result.createdAtoms).toBe(1);
    expect(await store.queryL1Records({ userId: "u1", type: "L1", limit: 10 })).toEqual([
      expect.objectContaining({ content: "User prefers Bun runtime", priority: 4, sourceConversationIds: [1] }),
    ]);
    expect(await backend.listLineageTargets("u1", "conversation", "1")).toEqual(
      expect.arrayContaining([expect.objectContaining({ targetKind: "memory_atom" })]),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("L1 pipeline writes to IMemoryStore before mirroring generic atoms to backend", async () => {
  const { tempDir, backend, store } = await createMemory();
  const calls: string[] = [];
  const orderedBackend = new Proxy(backend, {
    get(target, property, receiver) {
      if (property === "upsertMemoryAtom") {
        return async (...args: Parameters<typeof backend.upsertMemoryAtom>) => {
          calls.push("backend.upsertMemoryAtom");
          return backend.upsertMemoryAtom(...args);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const orderedStore = new Proxy(store, {
    get(target, property, receiver) {
      if (property === "upsertL1") {
        return async (...args: Parameters<typeof store.upsertL1>) => {
          calls.push("store.upsertL1");
          return store.upsertL1(...args);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });

  try {
    await runL1Pipeline(orderedBackend, fakeLlm, "u1", [
      {
        id: 1,
        chatId: "c1",
        userId: "u1",
        role: "user",
        content: "Please use Bun for this bot.",
        meta: {},
        createdAt: "2026-05-18T08:00:00.000Z",
      },
    ], orderedStore);

    expect(calls.slice(0, 2)).toEqual(["store.upsertL1", "backend.upsertMemoryAtom"]);
    expect(await store.queryL1Records({ userId: "u1", type: "L1", limit: 10 })).toEqual([
      expect.objectContaining({ content: "User prefers Bun runtime", priority: 4, sourceConversationIds: [1] }),
    ]);
    expect(await backend.listMemoryAtoms("u1", 10)).toEqual([
      expect.objectContaining({ text: "User prefers Bun runtime", importance: 4, sourceConversationIds: [1] }),
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("L2 and L3 pipelines sync profiles to IMemoryStore before backend compatibility writes", async () => {
  const { tempDir, backend, store } = await createMemory();
  const calls: string[] = [];
  const orderedBackend = new Proxy(backend, {
    get(target, property, receiver) {
      if (property === "insertMemoryScenario") {
        return async (...args: Parameters<typeof backend.insertMemoryScenario>) => {
          calls.push("backend.insertMemoryScenario");
          return backend.insertMemoryScenario(...args);
        };
      }
      if (property === "upsertPersona") {
        return async (...args: Parameters<typeof backend.upsertPersona>) => {
          calls.push("backend.upsertPersona");
          return backend.upsertPersona(...args);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const orderedStore = new Proxy(store, {
    get(target, property, receiver) {
      if (property === "syncProfiles") {
        return async (...args: Parameters<NonNullable<typeof store.syncProfiles>>) => {
          calls.push("store.syncProfiles");
          return store.syncProfiles?.(...args);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });

  try {
    await store.upsertL1({
      recordId: "101",
      userId: "u1",
      sessionKey: "chat:c1",
      sessionId: "c1",
      content: "User prefers Bun runtime",
      type: "L1",
      priority: 4,
      sceneName: "conversation",
      timestampStr: "2026-05-18T08:00:00.000Z",
      sourceConversationIds: [1],
      metadata: { source: "test" },
      createdTime: "2026-05-18T08:00:00.000Z",
      updatedTime: "2026-05-18T08:00:00.000Z",
    });

    const l2 = await runL2Pipeline(orderedBackend, fakeLlm, "u1", [
      {
        id: 1,
        userId: "u1",
        text: "User prefers Bun runtime",
        importance: 4,
        sourceConversationIds: [1],
        sourceLayer: "L1",
        createdAt: "2026-05-18T08:00:00.000Z",
        updatedAt: "2026-05-18T08:00:00.000Z",
      },
    ], orderedStore);
    expect(l2?.scenarioId).toBeGreaterThan(0);
    const firstPersonaUpdate = await runL3Pipeline(orderedBackend, fakeLlm, "u1", l2?.scenarioId ?? 0, l2?.bodyMarkdown ?? "", orderedStore);
    const secondPersonaUpdate = await runL3Pipeline(orderedBackend, fakeLlm, "u1", l2?.scenarioId ?? 0, l2?.bodyMarkdown ?? "", orderedStore);

    expect(firstPersonaUpdate).toBe(true);
    expect(secondPersonaUpdate).toBe(false);
    expect(calls[0]).toBe("store.syncProfiles");
    expect(calls.indexOf("store.syncProfiles")).toBeLessThan(calls.indexOf("backend.insertMemoryScenario"));
    expect(calls.lastIndexOf("store.syncProfiles")).toBeLessThan(calls.indexOf("backend.upsertPersona"));
    expect(await store.pullProfiles?.()).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "l2", userId: "u1", filename: "scene-conversation.md", content: expect.stringContaining("User prefers Bun runtime") }),
      expect.objectContaining({ type: "l3", userId: "u1", content: expect.stringContaining("Prefers Bun runtime") }),
    ]));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("RecallService reads atoms, persona, and conversations from IMemoryStore when provided", async () => {
  const { tempDir, backend, store } = await createMemory();

  try {
    await store.upsertL1({
      recordId: "101",
      userId: "u1",
      sessionKey: "chat:c1",
      sessionId: "c1",
      content: "User prefers Bun runtime",
      type: "L1",
      priority: 7,
      sceneName: "runtime preferences",
      timestampStr: "2026-05-18T08:01:00.000Z",
      sourceConversationIds: [201],
      metadata: { source: "test" },
      createdTime: "2026-05-18T08:01:00.000Z",
      updatedTime: "2026-05-18T08:01:00.000Z",
    });
    await store.upsertL0({
      recordId: "201",
      sessionKey: "chat:c1",
      sessionId: "c1",
      chatId: "c1",
      userId: "u1",
      role: "user",
      messageText: "Please remember my Bun runtime preference.",
      recordedAt: "2026-05-18T08:00:00.000Z",
      timestamp: 201,
      metadata: { source: "test" },
    });
    await store.syncProfiles?.([
      {
        id: "l2-u1-1",
        type: "l2",
        userId: "u1",
        filename: "scenario-u1.md",
        content: "## Runtime choices\nUser prefers Bun runtime.",
        contentMd5: "scenario-md5",
        version: 1,
        createdAtMs: 1710000000000,
        updatedAtMs: 1710000000000,
        metadata: { scenarioId: 301, title: "Runtime choices", atomIds: [101] },
      },
      {
        id: "l3-u1",
        type: "l3",
        userId: "u1",
        filename: "persona-u1.md",
        content: "# Persona\nPrefers Bun runtime.",
        contentMd5: "persona-md5",
        version: 1,
        createdAtMs: 1710000000000,
        updatedAtMs: 1710000000000,
        metadata: { source: "test" },
      },
    ]);

    const recall = await new RecallService(backend, undefined, store).recall("u1", "Bun runtime", 5, "c1");

    expect(recall.persona).toContain("Prefers Bun runtime");
    expect(recall.atoms).toEqual([expect.objectContaining({ id: 101, text: "User prefers Bun runtime", importance: 7 })]);
    expect(recall.scenarios).toEqual([
      expect.objectContaining({ id: 301, title: "Runtime choices", atomIds: [101] }),
    ]);
    expect(recall.conversations).toEqual([
      expect.objectContaining({ id: 201, chatId: "c1", userId: "u1", role: "user", content: "Please remember my Bun runtime preference." }),
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("PipelineCoordinator can source pending L0 turns from IMemoryStore", async () => {
  const { tempDir, backend, store } = await createMemory();

  try {
    await store.upsertL0({
      recordId: "legacy:l0:11",
      sessionKey: "telegram:c1:u1",
      sessionId: "c1",
      chatId: "c1",
      userId: "u1",
      role: "user",
      messageText: "Please use Bun for this bot.",
      recordedAt: "2026-05-18T08:00:00.000Z",
      timestamp: Date.parse("2026-05-18T08:00:00.000Z"),
      metadata: { mode: "chat" },
    });

    const result = await new PipelineCoordinator(backend, fakeLlm, store).runMaintenanceForUser("u1");

    expect(result.l1Created).toBe(1);
    expect(await store.queryL1Records({ userId: "u1", type: "L1", limit: 10 })).toEqual([
      expect.objectContaining({ content: "User prefers Bun runtime" }),
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("PipelineCoordinator coerces object checkpoint fields before querying IMemoryStore", async () => {
  const { tempDir, backend, store } = await createMemory();
  let capturedCursor: unknown;
  const capturingStore = new Proxy(store, {
    get(target, property, receiver) {
      if (property === "queryL0ForUser") {
        return async (...args: Parameters<typeof store.queryL0ForUser>) => {
          capturedCursor = args[1];
          return [];
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });

  try {
    await backend.setCheckpoint("u1", "l1_last_conversation_id", { timestamp: "1000", recordId: 123 });

    await new PipelineCoordinator(backend, fakeLlm, capturingStore).runMaintenanceForUser("u1");

    expect(capturedCursor).toEqual({ timestamp: 1000, recordId: "123" });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("PipelineCoordinator preserves same-timestamp IMemoryStore rows across batches", async () => {
  const { tempDir, backend, store } = await createMemory();
  const timestamp = Date.parse("2026-05-18T08:00:00.000Z");
  let l1Calls = 0;
  const batchLlm: LlmProvider = {
    async complete({ messages }) {
      const system = String(messages[0]?.content ?? "");
      if (system.includes("L1 extractor")) {
        l1Calls += 1;
        return {
          content: JSON.stringify([{ text: `Batch ${l1Calls} same timestamp memory`, importance: 4, source_turn_ids: [l1Calls] }]),
          toolCalls: [],
        };
      }
      if (system.includes("L2 Scenario aggregator")) {
        return { content: "## Same timestamp batches\n- atom_id=1 Batch memory", toolCalls: [] };
      }
      return { content: "# Persona\nTracks same timestamp batches.", toolCalls: [] };
    },
  };

  try {
    for (let index = 1; index <= 81; index += 1) {
      const padded = String(index).padStart(3, "0");
      await store.upsertL0({
        recordId: `legacy:l0:${padded}`,
        sessionKey: "telegram:c1:u1",
        sessionId: "c1",
        chatId: "c1",
        userId: "u1",
        role: "user",
        messageText: `same timestamp message ${padded}`,
        recordedAt: "2026-05-18T08:00:00.000Z",
        timestamp,
        metadata: { mode: "chat" },
      });
    }

    const first = await new PipelineCoordinator(backend, batchLlm, store).runMaintenanceForUser("u1");
    expect(first.l1Created).toBe(1);
    expect(await backend.getCheckpoint("u1", "l1_last_conversation_id")).toEqual({ timestamp, recordId: "legacy:l0:080" });

    const second = await new PipelineCoordinator(backend, batchLlm, store).runMaintenanceForUser("u1");
    expect(second.l1Created).toBe(1);
    expect(await backend.getCheckpoint("u1", "l1_last_conversation_id")).toEqual({ timestamp, recordId: "legacy:l0:081" });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}, 20000);

test("task canvas and offload backend paths remain active when PipelineCoordinator uses IMemoryStore", async () => {
  const { tempDir, backend, store } = await createMemory();

  try {
    const task = await backend.createTaskCanvas({ chatId: "c1", userId: "u1", label: "Runtime migration", status: "active" });
    await backend.insertOffloadRef({
      chatId: "c1",
      userId: "u1",
      nodeId: "node-1",
      kind: "analysis",
      title: "Runtime notes",
      filePath: "refs/c1/node-1.md",
      summary: "Bun runtime migration notes",
    });
    await backend.insertConversationTurn({ chatId: "c1", userId: "u1", role: "user", content: "Please use Bun for this bot.", meta: { mode: "chat" } });

    const result = await new PipelineCoordinator(backend, fakeLlm, store).runMaintenanceForUser("u1", true);
    const recall = await new RecallService(backend, undefined, store).recall("u1", "runtime", 5, "c1");

    const profiles = await store.pullProfiles?.();

    expect(result.personaUpdated).toBe(true);
    expect(profiles?.map((profile) => profile.type).sort()).toEqual(["l2", "l3"]);
    expect(recall.taskCanvas).toContain(`task_${task.id}`);
    expect(await backend.findOffloadRefByNodeId("u1", "node-1")).toEqual(
      expect.objectContaining({ title: "Runtime notes", summary: "Bun runtime migration notes" }),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
