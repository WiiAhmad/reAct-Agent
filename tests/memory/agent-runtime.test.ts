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
      },
      memory: {
        maintenanceCron: "*/10 * * * *",
        offloadEnabled: true,
        offloadMinChars: 2500,
        offloadSummaryChars: 900,
        sqliteVecEnabled: true,
        jsonlExportEnabled: true,
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
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
