import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { L1Record } from "../../src/memory/core/store/types";
import { SqliteMemoryStore } from "../../src/memory/backends/sqlite/store";
import { embedTextToVector } from "../../src/memory/backends/sqlite/vec";

function createRecord(overrides: Partial<L1Record> = {}): L1Record {
  return {
    recordId: "l1-coffee",
    userId: "user-1",
    sessionKey: "session-key-1",
    sessionId: "session-1",
    content: "Remember that Ada likes espresso and quiet morning planning.",
    type: "L1",
    priority: 7,
    sceneName: "morning planning",
    timestampStr: "2026-05-18T08:00:00.000Z",
    timestampStart: "2026-05-18T08:00:00.000Z",
    timestampEnd: "2026-05-18T08:05:00.000Z",
    sourceConversationIds: [101, 102],
    metadata: { source: "test" },
    createdTime: "2026-05-18T08:00:00.000Z",
    updatedTime: "2026-05-18T08:05:00.000Z",
    ...overrides,
  };
}

async function createStore(): Promise<{ db: Database; store: SqliteMemoryStore }> {
  const db = new Database(":memory:");
  const store = new SqliteMemoryStore(db, { sqliteVecEnabled: true, bm25Enabled: true, bm25Language: "en" });
  await store.init({ provider: "local", model: "deterministic", dimensions: 64 });
  expect(store.getCapabilities().vectorSearch).toBe(true);
  expect(store.getCapabilities().sparseVectors).toBe(true);
  return { db, store };
}

test("upsertL1 creates relational, FTS, vector, and sparse rows", async () => {
  const { db, store } = await createStore();
  const record = createRecord();

  await expect(store.upsertL1(record)).resolves.toBe(true);

  expect(db.query("SELECT record_id, content FROM memory_store_l1 WHERE record_id = ?").get(record.recordId)).toEqual({
    record_id: record.recordId,
    content: record.content,
  });
  expect(db.query("SELECT record_id, content FROM memory_store_l1_fts WHERE record_id = ?").get(record.recordId)).toEqual({
    record_id: record.recordId,
    content: record.content,
  });
  expect(db.query("SELECT COUNT(*) AS count FROM memory_store_l1_vec").get()).toEqual({ count: 1 });

  const sparseRow = db.query("SELECT sparse_vector_json FROM memory_store_l1_sparse WHERE record_id = ?").get(record.recordId) as { sparse_vector_json: string } | null;
  expect(sparseRow).not.toBeNull();
  expect(JSON.parse(sparseRow?.sparse_vector_json ?? "[]").length).toBeGreaterThan(0);
}, 20000);

test("countL1 and queryL1Records return the inserted row", async () => {
  const { store } = await createStore();
  const record = createRecord();
  await store.upsertL1(record);

  await expect(store.countL1()).resolves.toBe(1);
  await expect(store.countL1(record.userId)).resolves.toBe(1);
  await expect(store.queryL1Records({ userId: record.userId, sessionKey: record.sessionKey, limit: 10 })).resolves.toEqual([record]);
}, 20000);

test("searchL1Fts finds the row", async () => {
  const { store } = await createStore();
  const record = createRecord();
  await store.upsertL1(record);

  const results = await store.searchL1Fts("espresso", 5, record.userId);

  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ recordId: record.recordId, content: record.content });
  expect(results[0]?.score).toBeGreaterThan(0);
}, 20000);

test("searchL1Vector finds the row using embedTextToVector", async () => {
  const { store } = await createStore();
  const record = createRecord();
  await store.upsertL1(record);

  const results = await store.searchL1Vector(embedTextToVector("espresso morning planning"), 5, undefined, record.userId);

  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ recordId: record.recordId, content: record.content });
  expect(results[0]?.score).toBeGreaterThan(0);
}, 20000);

test("searchL1Hybrid merges results and returns the row", async () => {
  const { store } = await createStore();
  const record = createRecord();
  await store.upsertL1(record);

  const results = await store.searchL1Hybrid({ query: "espresso", queryEmbedding: embedTextToVector("espresso"), topK: 5, userId: record.userId });

  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ recordId: record.recordId, content: record.content });
  expect(results[0]?.score).toBeGreaterThan(0);
}, 20000);

test("upsertL1 with the same ID updates content and indexes", async () => {
  const { store } = await createStore();
  const original = createRecord();
  const updated = createRecord({
    content: "Remember that Ada now prefers matcha during afternoon reviews.",
    priority: 9,
    sourceConversationIds: [103],
    updatedTime: "2026-05-18T09:00:00.000Z",
  });
  await store.upsertL1(original);

  await expect(store.upsertL1(updated)).resolves.toBe(true);

  await expect(store.countL1()).resolves.toBe(1);
  await expect(store.queryL1Records({ userId: updated.userId })).resolves.toEqual([updated]);
  await expect(store.searchL1Fts("espresso", 5, updated.userId)).resolves.toEqual([]);
  expect(await store.searchL1Fts("matcha", 5, updated.userId)).toHaveLength(1);
  expect(await store.searchL1Vector(embedTextToVector("matcha afternoon reviews"), 5, undefined, updated.userId)).toHaveLength(1);
}, 20000);

test("deleteL1Expired removes older L1 records", async () => {
  const { store } = await createStore();
  await store.upsertL1(createRecord({ recordId: "l1-old", updatedTime: "2026-05-18T07:00:00.000Z", timestampStr: "2026-05-18T07:00:00.000Z" }));
  await store.upsertL1(createRecord({ recordId: "l1-new", updatedTime: "2026-05-18T09:00:00.000Z", timestampStr: "2026-05-18T09:00:00.000Z" }));

  await expect(store.deleteL1Expired("2026-05-18T08:00:00.000Z")).resolves.toBe(1);
  await expect(store.queryL1Records({ userId: "user-1" })).resolves.toEqual([
    expect.objectContaining({ recordId: "l1-new" }),
  ]);
}, 20000);

test("deleteL1 removes data and searches return empty results", async () => {
  const { db, store } = await createStore();
  const record = createRecord();
  await store.upsertL1(record);

  await expect(store.deleteL1(record.recordId)).resolves.toBe(true);

  await expect(store.countL1()).resolves.toBe(0);
  await expect(store.queryL1Records()).resolves.toEqual([]);
  await expect(store.searchL1Fts("espresso", 5, record.userId)).resolves.toEqual([]);
  await expect(store.searchL1Vector(embedTextToVector("espresso"), 5, undefined, record.userId)).resolves.toEqual([]);
  await expect(store.searchL1Hybrid({ query: "espresso", queryEmbedding: embedTextToVector("espresso"), topK: 5, userId: record.userId })).resolves.toEqual([]);
  expect(db.query("SELECT COUNT(*) AS count FROM memory_store_l1_vec").get()).toEqual({ count: 0 });
  expect(db.query("SELECT COUNT(*) AS count FROM memory_store_l1_sparse").get()).toEqual({ count: 0 });
}, 20000);

test("deleteL1Batch removes multiple L1 records", async () => {
  const { store } = await createStore();
  await store.upsertL1(createRecord({ recordId: "l1-a", content: "Ada likes espresso." }));
  await store.upsertL1(createRecord({ recordId: "l1-b", content: "Ben likes matcha." }));

  await expect(store.deleteL1Batch(["l1-a", "l1-b"])).resolves.toBe(true);

  await expect(store.countL1()).resolves.toBe(0);
}, 20000);
