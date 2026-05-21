import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { migrateSqliteMemory } from "../../src/memory/backends/sqlite/migrate";
import { SqliteMemoryBackend } from "../../src/memory/backends/sqlite/backend";
import { SqliteMemoryStore } from "../../src/memory/backends/sqlite/store";
import { runL1Pipeline } from "../../src/memory/pipeline/l1";

test("runL1Pipeline stores scene and semantic metadata in IMemoryStore", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-l1-parity-"));
  const llm = {
    async complete() {
      return {
        content: JSON.stringify([
          {
            text: "Use Bun for local scripts",
            importance: 6,
            source_turn_ids: [1],
            memory_kind: "instruction",
            scene_name: "runtime",
            source_message_ids: ["msg-1"],
            timestamps: ["2026-05-18T08:00:00.000Z"],
          },
        ]),
        toolCalls: [],
      };
    },
  };

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });
    const store = new SqliteMemoryStore(db, { sqliteVecEnabled: false, bm25Enabled: false });
    await store.init();

    await runL1Pipeline(backend, llm as any, "u1", [
      {
        id: 1,
        chatId: "c1",
        userId: "u1",
        role: "user",
        content: "Please use Bun for local scripts.",
        meta: {},
        createdAt: "2026-05-18T08:00:00.000Z",
      },
    ], store);

    const records = await store.queryL1Records({ userId: "u1", type: "L1", limit: 10 });

    expect(records[0]).toEqual(
      expect.objectContaining({
        sceneName: "runtime",
        metadata: expect.objectContaining({
          memoryKind: "instruction",
          sourceMessageIds: ["msg-1"],
          timestamps: ["2026-05-18T08:00:00.000Z"],
        }),
      }),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runL1Pipeline preserves unrelated existing L1 metadata during semantic enrichment", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-l1-parity-"));
  const llm = {
    async complete() {
      return {
        content: JSON.stringify([
          {
            text: "Use Bun for local scripts",
            importance: 4,
            source_turn_ids: [2],
            memory_kind: "instruction",
            scene_name: "runtime",
            source_message_ids: ["msg-2"],
            timestamps: ["2026-05-18T09:00:00.000Z"],
          },
        ]),
        toolCalls: [],
      };
    },
  };

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });
    const store = new SqliteMemoryStore(db, { sqliteVecEnabled: false, bm25Enabled: false });
    await store.init();
    await store.upsertL1({
      recordId: "store:l1:existing",
      userId: "u1",
      sessionKey: "chat:c1",
      sessionId: "c1",
      content: "Use Bun for local scripts",
      type: "L1",
      priority: 2,
      sceneName: "conversation",
      timestampStr: "2026-05-18T08:00:00.000Z",
      timestampStart: "2026-05-18T08:00:00.000Z",
      timestampEnd: "2026-05-18T08:00:00.000Z",
      sourceConversationIds: [1],
      metadata: {
        source: "manual",
        customFlag: "keep-me",
        nested: { retained: true },
      },
      createdTime: "2026-05-18T08:00:00.000Z",
      updatedTime: "2026-05-18T08:00:00.000Z",
    });

    await runL1Pipeline(backend, llm as any, "u1", [
      {
        id: 2,
        chatId: "c1",
        userId: "u1",
        role: "user",
        content: "Please keep using Bun for local scripts.",
        meta: {},
        createdAt: "2026-05-18T09:00:00.000Z",
      },
    ], store);

    const records = await store.queryL1Records({ userId: "u1", type: "L1", limit: 10 });

    expect(records[0]).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          source: "pipeline",
          customFlag: "keep-me",
          nested: { retained: true },
          memoryKind: "instruction",
          sourceMessageIds: ["msg-2"],
          timestamps: ["2026-05-18T09:00:00.000Z"],
        }),
      }),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
