import { expect, mock, test } from "bun:test";
import { createLocalTools } from "../../src/tools/local";
import { currentDateTimeSnapshot } from "../../src/utils/time";

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
    timezone: "Asia/Jakarta",
    offset_minutes: 420,
    locale: "id-ID",
    local_date: expect.any(String),
    local_time: expect.any(String),
    weekday_local: expect.any(String),
    weekday_en: expect.any(String),
    iso_weekday: expect.any(Number),
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

test("currentDateTimeSnapshot formats deterministic snapshots with timezone and locale", () => {
  const snapshot = currentDateTimeSnapshot(new Date("2026-05-17T18:14:45.815Z"), {
    timezone: "Asia/Jakarta",
    locale: "id-ID",
  });

  expect(snapshot.iso_timestamp).toBe("2026-05-17T18:14:45.815Z");
  expect(snapshot.unix_timestamp).toBe(1779041685);
  expect(snapshot.timezone).toBe("Asia/Jakarta");
  expect(snapshot.offset_minutes).toBe(420);
  expect(snapshot.locale).toBe("id-ID");
  expect(snapshot.local_date).toBe("2026-05-18");
  expect(snapshot.local_time).toBe("01:14:45");
  expect(snapshot.weekday_local.toLowerCase()).toBe("senin");
  expect(snapshot.weekday_en).toBe("Monday");
  expect(snapshot.iso_weekday).toBe(1);
  expect(snapshot.readable_local_datetime.toLowerCase()).toContain("senin");
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
