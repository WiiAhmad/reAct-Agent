import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { migrateSqliteMemory } from "../../src/memory/backends/sqlite/migrate";
import { SqliteMemoryBackend } from "../../src/memory/backends/sqlite/backend";
import { RecallService } from "../../src/memory/recall/service";

test("recall returns active and relevant historical task canvases", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-task-recall-"));

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

    const active = await backend.createTaskCanvas({ chatId: "c1", userId: "u1", label: "active-login-task", status: "active" });
    const activeCanvas = "flowchart TD\n  A[\"Active login task\"]\n";
    await writeFile(join(tempDir, active.filePath), activeCanvas, "utf8");
    await backend.upsertTaskCanvasSearchText({
      taskId: active.id,
      chatId: "c1",
      userId: "u1",
      label: active.label,
      status: active.status,
      filePath: active.filePath,
      canvas: activeCanvas,
    });

    const completed = await backend.createTaskCanvas({ chatId: "c1", userId: "u1", label: "token-refresh-investigation", status: "completed" });
    await backend.updateTaskCanvasStatus(completed.id, "completed");
    const completedCanvas = "flowchart TD\n  T[\"Token refresh branch fixed\"]\n";
    await writeFile(join(tempDir, completed.filePath), completedCanvas, "utf8");
    await backend.upsertTaskCanvasSearchText({
      taskId: completed.id,
      chatId: "c1",
      userId: "u1",
      label: completed.label,
      status: "completed",
      filePath: completed.filePath,
      canvas: completedCanvas,
    });

    const recall = new RecallService(backend, { enabled: true, maxTasks: 3, maxCanvasChars: 2000 });
    const result = await recall.recall("u1", "token refresh", 5, "c1");

    expect(result.taskCanvas).toContain("Active login task");
    expect(result.taskCanvases.map((task) => task.label)).toContain("token-refresh-investigation");
    expect(result.taskCanvases.find((task) => task.label === "token-refresh-investigation")?.canvas).toContain("Token refresh branch fixed");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("recall only returns the requesting user's active task canvas in a shared chat", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-task-recall-"));

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

    const requesterTask = await backend.createTaskCanvas({ chatId: "shared-chat", userId: "u1", label: "requester-active-task", status: "active" });
    const otherUserTask = await backend.createTaskCanvas({ chatId: "shared-chat", userId: "u2", label: "other-user-active-task", status: "active" });
    await writeFile(join(tempDir, requesterTask.filePath), "flowchart TD\n  U1[\"Requester active canvas\"]\n", "utf8");
    await writeFile(join(tempDir, otherUserTask.filePath), "flowchart TD\n  U2[\"Other user active canvas\"]\n", "utf8");

    const recall = new RecallService(backend, { enabled: true, maxTasks: 3, maxCanvasChars: 2000 });
    const result = await recall.recall("u1", "shared task", 5, "shared-chat");

    expect(result.taskCanvas).toContain("Requester active canvas");
    expect(result.taskCanvas).not.toContain("Other user active canvas");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
