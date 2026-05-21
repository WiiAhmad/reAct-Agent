import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { migrate } from "../../src/db/schema";
import { createMemoryService } from "../../src/memory/integration/factory";

test("completion turns keep task ownership for follow-up tool offload", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-task-routing-"));

  try {
    const db = new Database(":memory:");
    migrate(db);
    const llm = {
      async complete() {
        return { content: "", toolCalls: [] };
      },
    };
    const memory = await createMemoryService(db, llm as any, {
      storage: {
        dataDir: tempDir,
        memoryRefsDir: join(tempDir, "memory", "refs"),
        memoryCanvasDir: join(tempDir, "memory", "canvases"),
        memoryJsonlExportDir: join(tempDir, "memory", "jsonl"),
        historyDir: join(tempDir, "history"),
        memoryTaskCanvasDir: join(tempDir, "memory", "task-canvases"),
        memoryGeneratedSkillsDir: join(tempDir, "memory", "skills"),
      },
      memory: {
        maintenanceCron: "*/10 * * * *",
        offloadEnabled: true,
        offloadMinChars: 1000,
        offloadSummaryChars: 80,
        sqliteVecEnabled: true,
        jsonlExportEnabled: false,
        l15: { enabled: true, mode: "rules", recentMessages: 6, historyTaskLimit: 10, maxCanvasChars: 12000, safeFallback: "short" },
        l1: { enabled: true, mode: "local", maxSummaryChars: 900, defaultScore: 5 },
        l2: { enabled: false, mode: "local", triggerMinEntries: 1, maxCanvasChars: 12000 },
        taskRecall: { enabled: true, maxTasks: 3, maxCanvasChars: 2200 },
        l4: { enabled: true, mode: "local", requireCompletedTask: false, maxEvidenceEntries: 80, maxCanvasChars: 20000, maxSkillChars: 20000 },
      },
    });

    const createdAt = "2026-05-18T00:00:00.000Z";
    const insert = db.query(`
      INSERT INTO memory_task_canvases (chat_id, user_id, label, file_path, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("c1", "u1", "demo-task", "memory/task-canvases/c1/task-1.mmd", "active", createdAt, createdAt) as {
      lastInsertRowid: number | bigint;
    };
    const taskId = Number(insert.lastInsertRowid);

    const routing = await memory.judgeTaskTurn({
      chatId: "c1",
      userId: "u1",
      latestUserMessage: "sudah selesai, tests passing",
      sourceConversationId: 1,
    });

    expect(routing.judgment.taskCompleted).toBe(true);
    expect(routing.taskId).toBe(taskId);

    await memory.offloadToolResult({
      chatId: "c1",
      userId: "u1",
      taskId: routing.taskId,
      toolName: "bun_test",
      args: { file: "tests/app.test.ts" },
      rawResult: "All targeted tests passed.",
    });

    const boundaries = db.query(`SELECT result, task_id FROM memory_task_boundaries ORDER BY id ASC`).all() as Array<{
      result: string;
      task_id: number | null;
    }>;
    const nodes = db.query(`SELECT task_id, tool_name FROM memory_task_nodes ORDER BY id ASC`).all() as Array<{
      task_id: number | null;
      tool_name: string;
    }>;

    expect(boundaries).toEqual([{ result: "long", task_id: taskId }]);
    expect(nodes).toEqual([{ task_id: taskId, tool_name: "bun_test" }]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
