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
