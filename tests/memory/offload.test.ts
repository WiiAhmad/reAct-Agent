import { expect, mock, test } from "bun:test";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { migrateSqliteMemory } from "../../src/memory/backends/sqlite/migrate";
import { SqliteMemoryBackend } from "../../src/memory/backends/sqlite/backend";
import { OffloadService } from "../../src/memory/offload/service";

test("offload writes refs and nodes without updating a canvas when no taskId is provided", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-offload-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });
    await backend.init();

    const ok = new OffloadService(backend, { offloadMinChars: 10, offloadSummaryChars: 80 });
    const stored = await ok.offloadToolResult({
      chatId: "c1",
      userId: "u1",
      toolName: "demo_tool",
      args: { city: "Bandung" },
      rawResult: "x".repeat(200),
    });

    expect(stored.offloaded).toBe(true);
    expect(stored.resultRef).toContain("refs/c1/");
    expect(stored.content).toContain("result_ref=");

    const refRows = db
      .query(`SELECT chat_id, user_id, node_id, file_path, summary FROM memory_offload_refs ORDER BY id ASC`)
      .all() as Array<{
      chat_id: string;
      user_id: string;
      node_id: string;
      file_path: string;
      summary: string;
    }>;
    expect(refRows).toHaveLength(1);
    expect(refRows[0]?.chat_id).toBe("c1");
    expect(refRows[0]?.user_id).toBe("u1");
    expect(refRows[0]?.file_path).toBe(stored.resultRef);

    const refMarkdown = await readFile(join(tempDir, stored.resultRef!), "utf8");
    expect(refMarkdown).toContain("# Offloaded tool result");
    expect(refMarkdown).toContain(`- node_id: ${stored.nodeId}`);
    expect(refMarkdown).toContain("- tool: demo_tool");
    expect(refMarkdown).toContain('"city": "Bandung"');
    expect(refMarkdown).toContain("## Raw result");
    expect(refMarkdown).toContain("x".repeat(200));

    const nodeRows = db
      .query(`SELECT chat_id, user_id, task_id, node_id, tool_name, result_ref, status FROM memory_task_nodes ORDER BY id ASC`)
      .all() as Array<{
      chat_id: string;
      user_id: string;
      task_id: number | null;
      node_id: string;
      tool_name: string;
      result_ref: string | null;
      status: string;
    }>;
    expect(nodeRows).toHaveLength(1);
    expect(nodeRows[0]?.task_id).toBeNull();
    expect(nodeRows[0]?.node_id).toBe(stored.nodeId);
    expect(nodeRows[0]?.status).toBe("offloaded");
    expect(nodeRows[0]?.result_ref).toBe(stored.resultRef);

    const canvas = await backend.getTaskCanvas("c1");
    expect(canvas).toBeUndefined();

    const failingWriter = mock(async (filePath: string, content: string) => {
      if (filePath.endsWith(".md")) {
        throw new Error("disk full");
      }
      await writeFile(filePath, content, "utf8");
    });
    const degraded = new OffloadService(backend, { offloadMinChars: 10, offloadSummaryChars: 80 }, failingWriter);
    const fallback = await degraded.offloadToolResult({
      chatId: "c1",
      userId: "u1",
      toolName: "demo_tool",
      args: {},
      rawResult: "y".repeat(200),
    });

    expect(fallback.offloaded).toBe(false);
    expect(fallback.resultRef).toBeUndefined();
    expect(fallback.content).toContain("[offload-fallback]");
    expect(fallback.nodeId).toBeDefined();
    const fallbackNodeId = fallback.nodeId!;

    const refCount = db.query(`SELECT COUNT(*) AS count FROM memory_offload_refs`).get() as { count: number };
    const nodeRowsAfterFailure = db
      .query(`SELECT node_id, status, result_ref, summary FROM memory_task_nodes ORDER BY id ASC`)
      .all() as Array<{
      node_id: string;
      status: string;
      result_ref: string | null;
      summary: string;
    }>;

    expect(refCount.count).toBe(1);
    expect(nodeRowsAfterFailure).toHaveLength(2);
    expect(nodeRowsAfterFailure[1]?.status).toBe("fallback");
    expect(nodeRowsAfterFailure[1]?.result_ref).toBeNull();
    await expect(access(join(tempDir, `refs/c1/${fallbackNodeId}.md`), constants.F_OK)).rejects.toThrow();

    const finalCanvas = await backend.getTaskCanvas("c1");
    expect(finalCanvas).toBeUndefined();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("task-scoped offload writes a Mermaid task canvas for the provided taskId", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-offload-"));

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
    const task = await backend.createTaskCanvas({ chatId: "c1", userId: "u1", label: "demo-task" });

    const service = new OffloadService(backend, { offloadMinChars: 1000, offloadSummaryChars: 80 });
    const result = await service.offloadToolResult({
      chatId: "c1",
      userId: "u1",
      taskId: task.id,
      toolName: "demo_tool",
      args: { city: "Bandung" },
      rawResult: "short result",
    });

    expect(result.offloaded).toBe(false);
    expect(result.nodeId).toBeDefined();
    const nodeRows = db.query(`SELECT task_id, node_id, tool_name FROM memory_task_nodes ORDER BY id ASC`).all() as Array<{
      task_id: number | null;
      node_id: string;
      tool_name: string;
    }>;
    expect(nodeRows).toEqual([{ task_id: task.id, node_id: result.nodeId!, tool_name: "demo_tool" }]);

    const offloaded = await service.offloadToolResult({
      chatId: "c1",
      userId: "u1",
      taskId: task.id,
      toolName: "large_tool",
      args: { city: "Bandung" },
      rawResult: "x".repeat(2000),
    });

    expect(offloaded.offloaded).toBe(true);
    const updatedNodeRows = db.query(`SELECT task_id, node_id, tool_name FROM memory_task_nodes ORDER BY id ASC`).all() as Array<{
      task_id: number | null;
      node_id: string;
      tool_name: string;
    }>;
    expect(updatedNodeRows).toEqual([
      { task_id: task.id, node_id: result.nodeId!, tool_name: "demo_tool" },
      { task_id: task.id, node_id: offloaded.nodeId!, tool_name: "large_tool" },
    ]);

    const canvas = await backend.getTaskCanvas("c1");
    expect(canvas).toContain("graph LR");
    expect(canvas).toContain(`node_id=${result.nodeId}`);
    expect(canvas).toContain(`node_id=${offloaded.nodeId}`);
    expect(canvas).toContain("demo_tool");
    expect(canvas).toContain("large_tool");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("stale canvas files are ignored when the chat has no task graph nodes", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-offload-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });
    await backend.init();

    await writeFile(join(tempDir, "canvases", "c1.mmd"), "graph LR\n  stale[stale]\n", "utf8");

    await expect(backend.getTaskCanvas("c1")).resolves.toBeUndefined();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("offload degrades safely when transactional metadata persistence fails", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-offload-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });
    await backend.init();

    const ok = new OffloadService(backend, { offloadMinChars: 10, offloadSummaryChars: 80 });
    const stored = await ok.offloadToolResult({
      chatId: "c1",
      userId: "u1",
      toolName: "demo_tool",
      args: { city: "Bandung" },
      rawResult: "x".repeat(200),
    });

    expect(stored.offloaded).toBe(true);

    const insertOffloadRefWithTaskGraphNode = backend.insertOffloadRefWithTaskGraphNode.bind(backend);
    backend.insertOffloadRefWithTaskGraphNode = mock(async (ref, node) => {
      await insertOffloadRefWithTaskGraphNode(ref, {
        ...node,
        nodeId: stored.nodeId!,
      });
    });

    const degraded = new OffloadService(backend, { offloadMinChars: 10, offloadSummaryChars: 80 });
    const fallback = await degraded.offloadToolResult({
      chatId: "c1",
      userId: "u1",
      toolName: "demo_tool",
      args: {},
      rawResult: "y".repeat(200),
    });

    expect(fallback.offloaded).toBe(false);
    expect(fallback.resultRef).toBeUndefined();
    expect(fallback.content).toContain("[offload-fallback]");
    expect(fallback.nodeId).toBeDefined();
    const fallbackNodeId = fallback.nodeId!;
    await expect(access(join(tempDir, `refs/c1/${fallbackNodeId}.md`), constants.F_OK)).rejects.toThrow();

    const refRows = db
      .query(`SELECT node_id FROM memory_offload_refs ORDER BY id ASC`)
      .all() as Array<{ node_id: string }>;
    const nodeRows = db
      .query(`SELECT node_id, status, result_ref FROM memory_task_nodes ORDER BY id ASC`)
      .all() as Array<{
      node_id: string;
      status: string;
      result_ref: string | null;
    }>;

    expect(refRows).toHaveLength(1);
    expect(refRows[0]?.node_id).toBe(stored.nodeId);
    expect(nodeRows).toHaveLength(2);
    expect(nodeRows.filter((row) => row.status === "offloaded")).toHaveLength(1);
    expect(nodeRows[1]).toEqual({
      node_id: fallbackNodeId,
      status: "fallback",
      result_ref: null,
    });

    const finalCanvas = await backend.getTaskCanvas("c1");
    expect(finalCanvas).toBeUndefined();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
