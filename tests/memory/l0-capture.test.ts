import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { migrateSqliteMemory } from "../../src/memory/backends/sqlite/migrate";
import { SqliteMemoryBackend } from "../../src/memory/backends/sqlite/backend";
import { SqliteMemoryStore } from "../../src/memory/backends/sqlite/store";
import { MemoryService } from "../../src/memory/core/service";

const fakeLlm = {
  async complete() {
    return { content: "ok", toolCalls: [] };
  },
};

test("logToolCall and logToolResult mirror tool events into IMemoryStore L0", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-l0-capture-"));

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

    const service = new MemoryService(
      backend,
      fakeLlm as any,
      {
        dataDir: tempDir,
        backendName: "sqlite",
        backendOwner: "test",
        maintenanceCron: "0 * * * *",
        retentionDays: 30,
        offloadEnabled: true,
        l15: { enabled: true, mode: "hybrid", recentMessages: 6, historyTaskLimit: 10, maxCanvasChars: 12000, safeFallback: "short" },
        l1: { enabled: true, mode: "local", maxSummaryChars: 900, defaultScore: 5 },
        l2: { enabled: true, mode: "local", triggerMinEntries: 1, maxCanvasChars: 12000 },
        taskRecall: { enabled: true, maxTasks: 3, maxCanvasChars: 2200 },
        l4: { enabled: true, mode: "local", requireCompletedTask: false, maxEvidenceEntries: 80, maxCanvasChars: 20000, maxSkillChars: 20000 },
        generatedSkillsDir: join(tempDir, "skills"),
      },
      undefined,
      undefined,
      undefined,
      undefined,
      store,
    );

    await service.logToolCall({
      chatId: "c1",
      userId: "u1",
      toolName: "bun_test",
      toolCallId: "call-1",
      content: 'CALL bun_test({"file":"tests/memory/recall.test.ts"})',
    });
    await service.logToolResult({
      chatId: "c1",
      userId: "u1",
      toolName: "bun_test",
      toolCallId: "call-1",
      offloaded: false,
      content: "RESULT bun_test: PASS",
    });

    const rows = await store.queryL0ForL1("telegram:c1:u1", 0, 10);

    expect(rows.map((row) => [row.role, row.metadata?.eventType, row.metadata?.toolName])).toEqual([
      ["tool", "tool_call", "bun_test"],
      ["tool", "tool_result", "bun_test"],
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
