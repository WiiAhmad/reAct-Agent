import { expect, mock, test } from "bun:test";
import { createLocalTools } from "../../src/tools/local";

function createMemoryServiceDouble() {
  return {
    recall: mock(async () => ({
      persona: "- Uses Bun",
      atoms: [],
      scenarios: [],
      conversations: [],
      taskCanvas: undefined,
      fallbackChain: [],
    })),
    searchConversations: mock(async () => "#1 [2026-05-17] user: remember Bun"),
    readContextRef: mock(async () => "# Offloaded tool result\n"),
    memoryStatus: mock(async () => "backend=sqlite"),
    saveMemory: mock(async () => 1),
  };
}

test("tool surface stays stable while calling MemoryService", async () => {
  const memory = createMemoryServiceDouble();
  const tools = createLocalTools(memory as any);

  expect(tools.map((tool) => tool.name)).toEqual([
    "tdai_memory_search",
    "tdai_conversation_search",
    "tdai_context_ref_read",
    "tdai_memory_status",
    "save_memory",
    "tdai_current_datetime",
    "telegram_send_message",
  ]);

  const datetimeTool = tools.find((tool) => tool.name === "tdai_current_datetime");
  expect(datetimeTool).toBeDefined();

  const datetime = await datetimeTool!.execute({}, { chatId: "c1", userId: "u1", memory: memory as any });
  const parsed = JSON.parse(datetime);

  expect(parsed).toMatchObject({
    iso_timestamp: expect.any(String),
    unix_timestamp: expect.any(Number),
    readable_local_datetime: expect.any(String),
    timezone: expect.any(String),
    offset_minutes: expect.any(Number),
  });

  const saveMemory = tools.find((tool) => tool.name === "save_memory");
  expect(saveMemory).toBeDefined();

  await expect(
    saveMemory!.execute(
      { text: "Remember Bun", importance: 4 },
      { chatId: "c1", userId: "u1", memory: memory as any },
    ),
  ).resolves.toBe("Saved L1 memory atom #1.");

  expect(memory.saveMemory).toHaveBeenCalledWith({
    userId: "u1",
    text: "Remember Bun",
    importance: 4,
    sourceLayer: "L1",
  });
});

test("memory-backed tools use ctx.memory instead of the factory capture", async () => {
  const capturedMemory = createMemoryServiceDouble();
  const runtimeMemory = createMemoryServiceDouble();
  runtimeMemory.readContextRef.mockResolvedValueOnce("# Runtime memory ref\n");

  const tools = createLocalTools(capturedMemory as any);
  const contextRefRead = tools.find((tool) => tool.name === "tdai_context_ref_read");

  expect(contextRefRead).toBeDefined();

  await expect(
    contextRefRead!.execute(
      { node_id: "node-1" },
      { chatId: "c1", userId: "u1", memory: runtimeMemory as any },
    ),
  ).resolves.toBe("# Runtime memory ref\n");

  expect(runtimeMemory.readContextRef).toHaveBeenCalledWith({
    userId: "u1",
    nodeId: "node-1",
    resultRef: "",
  });
  expect(capturedMemory.readContextRef).not.toHaveBeenCalled();
});
