import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { L0Record, L1Record } from "../../src/memory/core/store/types";
import { createBM25LocalEncoder } from "../../src/memory/backends/sqlite/bm25-local";
import { SqliteMemoryStore } from "../../src/memory/backends/sqlite/store";
import { migrateSqliteMemoryStore } from "../../src/memory/backends/sqlite/store-migrate";
import { embedTextToVector, ensureSqliteVecTable, loadSqliteVec } from "../../src/memory/backends/sqlite/vec";

test("local BM25 encoder produces sparse vectors for documents and queries", () => {
  const encoder = createBM25LocalEncoder({ enabled: true, language: "zh" });

  expect(encoder.available).toBe(true);
  expect(encoder.encodeTexts(["remember Bun runtime"])[0]?.length).toBeGreaterThan(0);
  expect(encoder.encodeQueries(["Bun runtime"])[0]?.length).toBeGreaterThan(0);
}, 20000);

test("local BM25 encoder can be disabled", () => {
  const encoder = createBM25LocalEncoder({ enabled: false, language: "zh" });

  expect(encoder.available).toBe(false);
  expect(encoder.encodeTexts(["remember Bun runtime"])).toEqual([]);
  expect(encoder.encodeQueries(["Bun runtime"])).toEqual([]);
}, 20000);

test("sqlite-vec helper can create store-specific vector tables", () => {
  const db = new Database(":memory:");
  loadSqliteVec(db);

  ensureSqliteVecTable(db, "memory_store_l1_vec");
  ensureSqliteVecTable(db, "memory_store_l0_vec");

  const tableNames = (db.query("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') ORDER BY name ASC").all() as Array<{ name: string }>).map((row) => row.name);
  expect(tableNames).toContain("memory_store_l1_vec");
  expect(tableNames).toContain("memory_store_l0_vec");
}, 20000);

test("store migration creates generic memory store tables", () => {
  const db = new Database(":memory:");

  migrateSqliteMemoryStore(db);

  const tableNames = (db.query("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') ORDER BY name ASC").all() as Array<{ name: string }>).map((row) => row.name);
  expect(tableNames).toContain("memory_store_l0");
  expect(tableNames).toContain("memory_store_l0_fts");
  expect(tableNames).toContain("memory_store_l0_sparse");
  expect(tableNames).toContain("memory_store_l1");
  expect(tableNames).toContain("memory_store_l1_fts");
  expect(tableNames).toContain("memory_store_l1_sparse");
  expect(tableNames).toContain("memory_store_profiles");
  expect(tableNames).toContain("memory_store_meta");
}, 20000);

test("SqliteMemoryStore initializes lifecycle metadata with BM25 enabled", async () => {
  const db = new Database(":memory:");
  const store = new SqliteMemoryStore(db, { sqliteVecEnabled: false, bm25Enabled: true, bm25Language: "zh" });

  const result = await store.init({ provider: "local", model: "deterministic", dimensions: 64 });

  expect(result.capabilities).toEqual({
    vectorSearch: false,
    ftsSearch: true,
    nativeHybridSearch: false,
    sparseVectors: true,
  });
  expect(result.degraded).toBe(false);
  expect(store.getCapabilities()).toEqual(result.capabilities);
  expect(store.isFtsAvailable()).toBe(true);
  expect(store.isDegraded()).toBe(false);
  expect(db.query("SELECT value FROM memory_store_meta WHERE key = 'embedding.provider'").get()).toEqual({ value: "local" });
  expect(db.query("SELECT value FROM memory_store_meta WHERE key = 'embedding.model'").get()).toEqual({ value: "deterministic" });
  expect(db.query("SELECT value FROM memory_store_meta WHERE key = 'embedding.dimensions'").get()).toEqual({ value: "64" });
  expect(db.query("SELECT value FROM memory_store_meta WHERE key = 'bm25.enabled'").get()).toEqual({ value: "true" });
  expect(db.query("SELECT value FROM memory_store_meta WHERE key = 'bm25.language'").get()).toEqual({ value: "zh" });

  store.close();
  store.close();
  expect(db.query("SELECT 1 AS ok").get()).toEqual({ ok: 1 });
}, 20000);

test("SqliteMemoryStore initializes lifecycle metadata with BM25 disabled", async () => {
  const db = new Database(":memory:");
  const store = new SqliteMemoryStore(db, { sqliteVecEnabled: false, bm25Enabled: false, bm25Language: "en" });

  const result = await store.init();

  expect(result.capabilities).toEqual({
    vectorSearch: false,
    ftsSearch: true,
    nativeHybridSearch: false,
    sparseVectors: false,
  });
  expect(result.degraded).toBe(false);
  expect(store.getCapabilities()).toEqual(result.capabilities);
  expect(store.isFtsAvailable()).toBe(true);
  expect(store.isDegraded()).toBe(false);
  expect(db.query("SELECT value FROM memory_store_meta WHERE key = 'embedding.provider'").get()).toEqual({ value: "local" });
  expect(db.query("SELECT value FROM memory_store_meta WHERE key = 'embedding.model'").get()).toEqual({ value: "deterministic-local" });
  expect(db.query("SELECT value FROM memory_store_meta WHERE key = 'embedding.dimensions'").get()).toEqual({ value: "64" });
  expect(db.query("SELECT value FROM memory_store_meta WHERE key = 'bm25.enabled'").get()).toEqual({ value: "false" });
  expect(db.query("SELECT value FROM memory_store_meta WHERE key = 'bm25.language'").get()).toEqual({ value: "en" });

  store.close();
  store.close();
  expect(db.query("SELECT 1 AS ok").get()).toEqual({ ok: 1 });
}, 20000);

test("SqliteMemoryStore returns fallbacks and degrades after recoverable DB failures", async () => {
  const db = new Database(":memory:");
  const store = new SqliteMemoryStore(db, { sqliteVecEnabled: false, bm25Enabled: true, bm25Language: "en" });
  await store.init();
  db.close();

  const l1: L1Record = {
    recordId: "l1-fallback",
    userId: "user-1",
    sessionKey: "session-key-1",
    sessionId: "session-1",
    content: "Ada likes espresso.",
    type: "L1",
    priority: 5,
    sceneName: "fallback",
    timestampStr: "2026-05-18T08:00:00.000Z",
    sourceConversationIds: [101],
    metadata: { source: "fallback-test" },
    createdTime: "2026-05-18T08:00:00.000Z",
    updatedTime: "2026-05-18T08:01:00.000Z",
  };
  const l0: L0Record = {
    recordId: "l0-fallback",
    sessionKey: "session-key-1",
    sessionId: "session-1",
    chatId: "chat-1",
    userId: "user-1",
    role: "user",
    messageText: "Please remember the espresso detail.",
    recordedAt: "2026-05-18T08:00:30.000Z",
    timestamp: 1710000030000,
    metadata: { source: "fallback-test" },
  };

  await expect(store.upsertL1(l1)).resolves.toBe(false);
  await expect(store.deleteL1(l1.recordId)).resolves.toBe(false);
  await expect(store.deleteL1Batch([l1.recordId])).resolves.toBe(false);
  await expect(store.deleteL1Expired("2026-05-18T09:00:00.000Z")).resolves.toBe(0);
  await expect(store.countL1()).resolves.toBe(0);
  await expect(store.queryL1Records()).resolves.toEqual([]);
  await expect(store.getAllL1Texts()).resolves.toEqual([]);
  await expect(store.searchL1Fts("espresso")).resolves.toEqual([]);
  await expect(store.searchL1Hybrid({ query: "espresso", topK: 5 })).resolves.toEqual([]);

  await expect(store.upsertL0(l0)).resolves.toBe(false);
  await expect(store.updateL0Embedding(l0.recordId, embedTextToVector("espresso"))).resolves.toBe(false);
  await expect(store.deleteL0(l0.recordId)).resolves.toBe(false);
  await expect(store.deleteL0Expired("2026-05-18T09:00:00.000Z")).resolves.toBe(0);
  await expect(store.countL0()).resolves.toBe(0);
  await expect(store.queryL0ForUser(l0.userId)).resolves.toEqual([]);
  await expect(store.queryL0ForL1(l0.sessionKey)).resolves.toEqual([]);
  await expect(store.queryL0GroupedBySessionId(l0.sessionKey)).resolves.toEqual([]);
  await expect(store.getAllL0Texts()).resolves.toEqual([]);
  await expect(store.searchL0Fts("espresso")).resolves.toEqual([]);
  await expect(store.searchL0Hybrid({ query: "espresso", topK: 5 })).resolves.toEqual([]);

  await expect(store.pullProfiles()).resolves.toEqual([]);
  await expect(store.syncProfiles([{ id: "profile-1", type: "l2", userId: "user-1", filename: "user-1.md", content: "content", contentMd5: "md5", version: 1, createdAtMs: 1, updatedAtMs: 1 }])).resolves.toBeUndefined();
  await expect(store.deleteProfiles(["profile-1"])).resolves.toBeUndefined();
  await expect(store.reindexAll(async () => embedTextToVector("espresso"))).resolves.toEqual({ l1Count: 0, l0Count: 0 });

  expect(store.isDegraded()).toBe(true);
  expect(store.isFtsAvailable()).toBe(false);
}, 20000);

test("upsert keeps relational rows when FTS maintenance fails", async () => {
  const db = new Database(":memory:");
  const store = new SqliteMemoryStore(db, { sqliteVecEnabled: false, bm25Enabled: false, bm25Language: "en" });
  await store.init();
  db.exec("DROP TABLE memory_store_l1_fts; DROP TABLE memory_store_l0_fts;");

  const l1: L1Record = {
    recordId: "l1-degraded",
    userId: "user-1",
    sessionKey: "session-key-1",
    sessionId: "session-1",
    content: "Ada likes espresso.",
    type: "L1",
    priority: 5,
    sceneName: "degraded",
    timestampStr: "2026-05-18T08:00:00.000Z",
    sourceConversationIds: [101],
    metadata: { source: "degraded-test" },
    createdTime: "2026-05-18T08:00:00.000Z",
    updatedTime: "2026-05-18T08:01:00.000Z",
  };
  const l0: L0Record = {
    recordId: "l0-degraded",
    sessionKey: "session-key-1",
    sessionId: "session-1",
    chatId: "chat-1",
    userId: "user-1",
    role: "user",
    messageText: "Please remember the espresso detail.",
    recordedAt: "2026-05-18T08:00:30.000Z",
    timestamp: 1710000030000,
    metadata: { source: "degraded-test" },
  };

  await expect(store.upsertL1(l1)).resolves.toBe(true);
  await expect(store.upsertL0(l0)).resolves.toBe(true);
  await expect(store.countL1("user-1")).resolves.toBe(1);
  await expect(store.countL0("user-1")).resolves.toBe(1);
  expect(store.isDegraded()).toBe(true);
  expect(store.isFtsAvailable()).toBe(false);
}, 20000);

test("reindexAll rebuilds L0 and L1 vector and sparse indexes with progress", async () => {
  const db = new Database(":memory:");
  const store = new SqliteMemoryStore(db, { sqliteVecEnabled: true, bm25Enabled: true, bm25Language: "en" });
  await store.init({ provider: "local", model: "deterministic", dimensions: 64 });

  const l1: L1Record = {
    recordId: "l1-reindex",
    userId: "user-1",
    sessionKey: "session-key-1",
    sessionId: "session-1",
    content: "Ada likes espresso during reindex tests.",
    type: "L1",
    priority: 5,
    sceneName: "reindex",
    timestampStr: "2026-05-18T08:00:00.000Z",
    sourceConversationIds: [101],
    metadata: { source: "reindex-test" },
    createdTime: "2026-05-18T08:00:00.000Z",
    updatedTime: "2026-05-18T08:01:00.000Z",
  };
  const l0: L0Record = {
    recordId: "l0-reindex",
    sessionKey: "session-key-1",
    sessionId: "session-1",
    chatId: "chat-1",
    userId: "user-1",
    role: "user",
    messageText: "Please remember the espresso reindex detail.",
    recordedAt: "2026-05-18T08:00:30.000Z",
    timestamp: 1710000030000,
    metadata: { source: "reindex-test" },
  };
  await store.upsertL1(l1, embedTextToVector("stale l1 vector"));
  await store.upsertL0(l0, embedTextToVector("stale l0 vector"));
  db.exec(`
    DELETE FROM memory_store_l1_vec;
    DELETE FROM memory_store_l0_vec;
    DELETE FROM memory_store_l1_sparse;
    DELETE FROM memory_store_l0_sparse;
  `);

  const progress: string[] = [];
  const result = await store.reindexAll(
    async (text) => embedTextToVector(text),
    (done, total, layer) => progress.push(`${layer}:${done}/${total}`),
  );

  expect(result).toEqual({ l1Count: 1, l0Count: 1 });
  expect(progress).toEqual(["L1:1/1", "L0:1/1"]);
  expect(db.query("SELECT COUNT(*) AS count FROM memory_store_l1_vec").get()).toEqual({ count: 1 });
  expect(db.query("SELECT COUNT(*) AS count FROM memory_store_l0_vec").get()).toEqual({ count: 1 });
  expect(db.query("SELECT COUNT(*) AS count FROM memory_store_l1_sparse").get()).toEqual({ count: 1 });
  expect(db.query("SELECT COUNT(*) AS count FROM memory_store_l0_sparse").get()).toEqual({ count: 1 });
  expect(await store.searchL1Vector(embedTextToVector("espresso reindex tests"), 5, undefined, "user-1")).toHaveLength(1);
  expect(await store.searchL0Vector(embedTextToVector("espresso reindex detail"), 5, undefined, "user-1")).toHaveLength(1);
}, 20000);
