import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { migrate } from "../../src/db/schema";
import { runReactAgent } from "../../src/agent/react-agent";
import { createMemoryService } from "../../src/memory/integration/factory";
import { ToolRegistry } from "../../src/tools/registry";
import { createLocalTools } from "../../src/tools/local";

test("agent loop logs user and assistant turns through MemoryService", async () => {
  let seenMessages: Array<{ role: string; content?: string }> = [];
  const llm = {
    async complete({ messages }: { messages: Array<{ role: string; content?: string }> }) {
      seenMessages = messages;
      return {
        content: "Done. I saved the memory.",
        toolCalls: [],
      };
    },
  };

  const tempDir = await mkdtemp(join(tmpdir(), "grammy-agent-runtime-"));

  try {
    const db = new Database(":memory:");
    migrate(db);
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
        offloadMinChars: 2500,
        offloadSummaryChars: 900,
        sqliteVecEnabled: true,
        jsonlExportEnabled: true,
        l15: {
          enabled: true,
          mode: "rules",
          recentMessages: 6,
          historyTaskLimit: 10,
          maxCanvasChars: 12000,
          safeFallback: "short",
        },
        l4: {
          enabled: true,
          mode: "local",
          requireCompletedTask: false,
          maxEvidenceEntries: 80,
          maxCanvasChars: 20000,
          maxSkillChars: 20000,
        },
      },
    });
    const registry = new ToolRegistry(db);
    registry.registerMany(createLocalTools(memory));

    const answer = await runReactAgent({
      chatId: "c1",
      userId: "u1",
      input: "remember that we use Bun",
      memory,
      registry,
      llm: llm as any,
      mode: "chat",
    });

    expect(answer).toContain("Done.");
    expect(seenMessages.filter((message) => message.role === "user" && message.content === "remember that we use Bun")).toHaveLength(1);
    expect(registry.list().map((tool) => tool.name)).toContain("tdai_current_datetime");
    const events = await memory.listInteractionEvents("u1", "c1", 10);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["user_message", "assistant_message"]));

    const jsonlPath = join(tempDir, "memory", "jsonl", "c1.jsonl");
    expect(await Bun.file(jsonlPath).exists()).toBe(true);
    const jsonl = await Bun.file(jsonlPath).text();
    expect(jsonl).toContain('"type":"user_message"');
    expect(jsonl).toContain('"type":"assistant_message"');

    const history = await Bun.file(join(tempDir, "history", "c1.jsonl")).text();
    expect(history).toContain('"role":"user"');
    expect(history).toContain('"role":"assistant"');
    expect(db.query(`SELECT COUNT(*) AS count FROM conversations`).get()).toEqual({ count: 0 });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agent runtime keeps current datetime one-shot question out of task canvas recall", async () => {
  const llmCalls: Array<Array<{ role: string; content?: string }>> = [];
  const llm = {
    async complete({ messages }: { messages: Array<{ role: string; content?: string }> }) {
      llmCalls.push(messages);
      if (llmCalls.length === 1) {
        return {
          content: "Saya akan cek waktu saat ini.",
          toolCalls: [{ id: "call_1", name: "tdai_current_datetime", arguments: {} }],
        };
      }
      return {
        content: "Sekarang adalah waktu yang diminta.",
        toolCalls: [],
      };
    },
  };

  const tempDir = await mkdtemp(join(tmpdir(), "grammy-agent-runtime-"));

  try {
    const db = new Database(":memory:");
    migrate(db);
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
        offloadMinChars: 2500,
        offloadSummaryChars: 900,
        sqliteVecEnabled: true,
        jsonlExportEnabled: false,
        l15: {
          enabled: true,
          mode: "rules",
          recentMessages: 6,
          historyTaskLimit: 10,
          maxCanvasChars: 12000,
          safeFallback: "short",
        },
        l4: {
          enabled: true,
          mode: "local",
          requireCompletedTask: false,
          maxEvidenceEntries: 80,
          maxCanvasChars: 20000,
          maxSkillChars: 20000,
        },
      },
    });
    const registry = new ToolRegistry(db);
    registry.registerMany(createLocalTools(memory));

    await runReactAgent({
      chatId: "c-time",
      userId: "u1",
      input: "sekarang Hari apa dan jam berapa?",
      memory,
      registry,
      llm: llm as any,
      mode: "chat",
    });

    const history = await Bun.file(join(tempDir, "history", "c-time.jsonl")).text();
    expect(history).toContain('"role":"user"');
    expect(history).toContain('"role":"assistant"');
    expect(db.query(`SELECT COUNT(*) AS count FROM conversations`).get()).toEqual({ count: 0 });

    const recall = await memory.recall("u1", "sekarang Hari apa dan jam berapa?", 5, "c-time");
    expect(recall.taskCanvas).toBeUndefined();
    expect(llmCalls[0]?.some((message) => message.content?.includes("Active Mermaid task canvas"))).toBe(false);
    const nodeRows = db.query(`SELECT task_id, tool_name FROM memory_task_nodes ORDER BY id ASC`).all() as Array<{
      task_id: number | null;
      tool_name: string;
    }>;
    expect(nodeRows).toEqual([{ task_id: null, tool_name: "tdai_current_datetime" }]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agent runtime passes tool call id into semantic L1 offload", async () => {
  const llmCalls: Array<Array<{ role: string; content?: string }>> = [];
  const llm = {
    async complete({ messages }: { messages: Array<{ role: string; content?: string }> }) {
      llmCalls.push(messages);
      if (llmCalls.length === 1) {
        return { content: "I will inspect time.", toolCalls: [{ id: "call_time", name: "tdai_current_datetime", arguments: {} }] };
      }
      if (messages.some((message) => message.content?.includes("semantic L1 evidence summary"))) {
        return { content: JSON.stringify({ summary: "Resolved current datetime with explicit weekday fields.", score: 8 }), toolCalls: [] };
      }
      return { content: "Done", toolCalls: [] };
    },
  };

  const tempDir = await mkdtemp(join(tmpdir(), "grammy-agent-runtime-"));

  try {
    const db = new Database(":memory:");
    migrate(db);
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
        offloadMinChars: 2500,
        offloadSummaryChars: 900,
        sqliteVecEnabled: true,
        jsonlExportEnabled: true,
        l15: { enabled: true, mode: "rules", recentMessages: 6, historyTaskLimit: 10, maxCanvasChars: 12000, safeFallback: "short" },
        l4: { enabled: true, mode: "local", requireCompletedTask: false, maxEvidenceEntries: 80, maxCanvasChars: 20000, maxSkillChars: 20000 },
        l1: { enabled: true, mode: "local", maxSummaryChars: 900, defaultScore: 5 },
        l2: { enabled: false, mode: "local", triggerMinEntries: 1, maxCanvasChars: 12000 },
        taskRecall: { enabled: true, maxTasks: 3, maxCanvasChars: 2200 },
      },
    });
    const registry = new ToolRegistry(db);
    registry.registerMany(createLocalTools(memory));

    await runReactAgent({ chatId: "c-time", userId: "u1", input: "sekarang hari apa?", memory, registry, llm: llm as any, mode: "chat" });

    const rows = db.query(`SELECT tool_call_id FROM memory_l1_evidence_entries ORDER BY id ASC`).all() as Array<{ tool_call_id: string | null }>;
    expect(rows).toEqual([{ tool_call_id: "call_time" }]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agent runtime includes relevant historical task canvases in memory context", async () => {
  let seenMessages: Array<{ role: string; content?: string }> = [];
  const llm = {
    async complete({ messages }: { messages: Array<{ role: string; content?: string }> }) {
      seenMessages = messages;
      return { content: "Done", toolCalls: [] };
    },
  };

  const tempDir = await mkdtemp(join(tmpdir(), "grammy-agent-runtime-"));

  try {
    const db = new Database(":memory:");
    migrate(db);
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
        offloadMinChars: 2500,
        offloadSummaryChars: 900,
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
    const insert = db
      .query(`
        INSERT INTO memory_task_canvases (chat_id, user_id, label, file_path, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run("c1", "u1", "token-refresh-investigation", "memory/task-canvases/c1/task-1.mmd", "completed", createdAt, createdAt) as { lastInsertRowid: number | bigint };
    const canvas = "flowchart TD\n  T[\"Token refresh branch fixed\"]\n";
    db
      .query(`
        INSERT INTO memory_task_canvas_fts (label, canvas, task_id, chat_id, user_id, status, file_path)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run("token-refresh-investigation", canvas, String(insert.lastInsertRowid), "c1", "u1", "completed", "memory/task-canvases/c1/task-1.mmd");

    const registry = new ToolRegistry(db);
    registry.registerMany(createLocalTools(memory));

    await runReactAgent({ chatId: "c1", userId: "u1", input: "what did we learn about token refresh?", memory, registry, llm: llm as any, mode: "chat" });

    const memoryContext = seenMessages.find((message) => message.role === "system" && message.content?.includes("Relevant layered memory snapshot"))?.content ?? "";
    expect(memoryContext).toContain("Relevant historical task canvases");
    expect(memoryContext).toContain("token-refresh-investigation");
    expect(memoryContext).toContain("Token refresh branch fixed");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
