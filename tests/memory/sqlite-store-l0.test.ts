import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { L0Record } from "../../src/memory/core/store/types";
import { SqliteMemoryStore } from "../../src/memory/backends/sqlite/store";
import { embedTextToVector } from "../../src/memory/backends/sqlite/vec";

function createRecord(overrides: Partial<L0Record> = {}): L0Record {
  return {
    recordId: "l0-coffee",
    sessionKey: "session-key-1",
    sessionId: "session-1",
    chatId: "chat-1",
    userId: "user-1",
    role: "user",
    messageText: "Ada mentioned espresso during quiet morning planning.",
    recordedAt: "2026-05-18T08:00:00.000Z",
    timestamp: 1000,
    metadata: { source: "test" },
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

test("upsertL0 creates relational, FTS, vector, and sparse rows", async () => {
  const { db, store } = await createStore();
  const record = createRecord();

  await expect(store.upsertL0(record)).resolves.toBe(true);

  expect(db.query("SELECT record_id, message_text FROM memory_store_l0 WHERE record_id = ?").get(record.recordId)).toEqual({
    record_id: record.recordId,
    message_text: record.messageText,
  });
  expect(db.query("SELECT record_id, message_text FROM memory_store_l0_fts WHERE record_id = ?").get(record.recordId)).toEqual({
    record_id: record.recordId,
    message_text: record.messageText,
  });
  expect(db.query("SELECT COUNT(*) AS count FROM memory_store_l0_vec").get()).toEqual({ count: 1 });

  const sparseRow = db.query("SELECT sparse_vector_json FROM memory_store_l0_sparse WHERE record_id = ?").get(record.recordId) as { sparse_vector_json: string } | null;
  expect(sparseRow).not.toBeNull();
  expect(JSON.parse(sparseRow?.sparse_vector_json ?? "[]").length).toBeGreaterThan(0);
}, 20000);

test("countL0 counts all rows and rows for one user", async () => {
  const { store } = await createStore();
  await store.upsertL0(createRecord({ recordId: "l0-a", userId: "user-1" }));
  await store.upsertL0(createRecord({ recordId: "l0-b", userId: "user-2" }));

  await expect(store.countL0()).resolves.toBe(2);
  await expect(store.countL0("user-1")).resolves.toBe(1);
}, 20000);

test("queryL0ForL1 returns session rows ordered by timestamp", async () => {
  const { store } = await createStore();
  const later = createRecord({ recordId: "l0-later", messageText: "later message", timestamp: 3000, recordedAt: "2026-05-18T08:03:00.000Z" });
  const earlier = createRecord({ recordId: "l0-earlier", messageText: "earlier message", timestamp: 1000, recordedAt: "2026-05-18T08:01:00.000Z" });
  const otherSession = createRecord({ recordId: "l0-other", sessionKey: "session-key-2", timestamp: 2000 });
  await store.upsertL0(later);
  await store.upsertL0(earlier);
  await store.upsertL0(otherSession);

  await expect(store.queryL0ForL1("session-key-1", 0, 10)).resolves.toEqual([earlier, later]);
  await expect(store.queryL0ForL1("session-key-1", 1000, 10)).resolves.toEqual([later]);
  await expect(store.queryL0ForL1("session-key-1", 0, 1)).resolves.toEqual([earlier]);
}, 20000);

test("queryL0GroupedBySessionId groups rows by sessionId", async () => {
  const { store } = await createStore();
  const first = createRecord({ recordId: "l0-s1-a", sessionId: "session-1", timestamp: 1000 });
  const second = createRecord({ recordId: "l0-s2-a", sessionId: "session-2", timestamp: 2000 });
  const third = createRecord({ recordId: "l0-s1-b", sessionId: "session-1", timestamp: 3000 });
  await store.upsertL0(third);
  await store.upsertL0(first);
  await store.upsertL0(second);

  await expect(store.queryL0GroupedBySessionId("session-key-1", 0, 10)).resolves.toEqual([
    { sessionId: "session-1", records: [first, third] },
    { sessionId: "session-2", records: [second] },
  ]);
}, 20000);

test("searchL0Fts finds the row", async () => {
  const { store } = await createStore();
  const record = createRecord();
  await store.upsertL0(record);

  const results = await store.searchL0Fts("espresso", 5, record.userId);

  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ recordId: record.recordId, messageText: record.messageText });
  expect(results[0]?.score).toBeGreaterThan(0);
}, 20000);

test("searchL0Hybrid merges FTS, vector, and sparse results", async () => {
  const { store } = await createStore();
  const record = createRecord();
  await store.upsertL0(record);

  await expect(store.searchL0Hybrid?.({ query: "espresso", queryEmbedding: embedTextToVector("espresso morning planning"), topK: 5, userId: record.userId })).resolves.toEqual([
    expect.objectContaining({ recordId: record.recordId, messageText: record.messageText }),
  ]);
}, 20000);

test("searchL0Vector finds the row using embedTextToVector", async () => {
  const { store } = await createStore();
  const record = createRecord();
  await store.upsertL0(record);

  const results = await store.searchL0Vector(embedTextToVector("espresso morning planning"), 5, undefined, record.userId);

  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ recordId: record.recordId, messageText: record.messageText });
  expect(results[0]?.score).toBeGreaterThan(0);
}, 20000);

test("updateL0Embedding succeeds", async () => {
  const { store } = await createStore();
  const record = createRecord();
  await store.upsertL0(record, embedTextToVector("unrelated original text"));

  await expect(store.updateL0Embedding(record.recordId, embedTextToVector("rare update token"))).resolves.toBe(true);

  const results = await store.searchL0Vector(embedTextToVector("rare update token"), 5, undefined, record.userId);
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ recordId: record.recordId });
}, 20000);

test("deleteL0 removes data", async () => {
  const { db, store } = await createStore();
  const record = createRecord();
  await store.upsertL0(record);

  await expect(store.deleteL0(record.recordId)).resolves.toBe(true);

  await expect(store.countL0()).resolves.toBe(0);
  await expect(store.queryL0ForL1(record.sessionKey)).resolves.toEqual([]);
  await expect(store.searchL0Fts("espresso", 5, record.userId)).resolves.toEqual([]);
  await expect(store.searchL0Vector(embedTextToVector("espresso"), 5, undefined, record.userId)).resolves.toEqual([]);
  expect(db.query("SELECT COUNT(*) AS count FROM memory_store_l0_vec").get()).toEqual({ count: 0 });
  expect(db.query("SELECT COUNT(*) AS count FROM memory_store_l0_sparse").get()).toEqual({ count: 0 });
}, 20000);

test("deleteL0Expired removes rows older than a cutoff and returns the deleted count", async () => {
  const { store } = await createStore();
  const oldRecord = createRecord({ recordId: "l0-old", recordedAt: "2026-05-18T08:00:00.000Z", timestamp: 1000, messageText: "old espresso" });
  const cutoffRecord = createRecord({ recordId: "l0-cutoff", recordedAt: "2026-05-18T09:00:00.000Z", timestamp: 2000, messageText: "cutoff espresso" });
  const freshRecord = createRecord({ recordId: "l0-fresh", recordedAt: "2026-05-18T10:00:00.000Z", timestamp: 3000, messageText: "fresh espresso" });
  await store.upsertL0(oldRecord);
  await store.upsertL0(cutoffRecord);
  await store.upsertL0(freshRecord);

  await expect(store.deleteL0Expired("2026-05-18T09:00:00.000Z")).resolves.toBe(1);

  await expect(store.countL0()).resolves.toBe(2);
  await expect(store.queryL0ForL1("session-key-1", 0, 10)).resolves.toEqual([cutoffRecord, freshRecord]);
  await expect(store.searchL0Fts("old", 5, oldRecord.userId)).resolves.toEqual([]);
}, 20000);
