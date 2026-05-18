import { expect, mock, test } from "bun:test";
import { createLocalTools } from "../../src/tools/local";
import type { TaskCanvasRecall } from "../../src/memory/core/types";
import { currentDateTimeSnapshot } from "../../src/utils/time";

function createMemoryServiceDouble() {
  return {
    recall: mock(async () => ({
      persona: "- Uses Bun" as string | undefined,
      atoms: [],
      scenarios: [],
      conversations: [],
      taskCanvas: undefined,
      taskCanvases: [] as TaskCanvasRecall[],
      fallbackChain: [],
    })),
    searchConversations: mock(async () => "#1 [2026-05-17] user: remember Bun"),
    readContextRef: mock(async () => "# Offloaded tool result\n"),
    memoryStatus: mock(async () => "backend=sqlite"),
    saveMemory: mock(async () => 1),
  };
}

function createAutonomousJobsDouble() {
  return {
    createJob: mock((input: any) => ({
      id: 9,
      chatId: input.chatId,
      userId: input.userId,
      prompt: input.prompt,
      jobType: input.jobType,
      messageText: input.messageText,
      agentPrompt: input.agentPrompt,
      scheduleMode: input.schedule.scheduleMode,
      runAtUnix: input.schedule.runAtUnix ?? null,
      intervalSec: input.schedule.intervalSec ?? null,
      cronExpr: input.schedule.cronExpr ?? null,
      runCount: 0,
      maxRuns: input.maxRuns ?? null,
      scheduleLabel: input.schedule.scheduleMode === "once" ? "Once at 2026-05-18T06:30:00.000Z" : "Every 10 minutes",
    })),
  };
}

test("tool surface stays stable while calling MemoryService", async () => {
  const memory = createMemoryServiceDouble();
  const autonomousJobs = createAutonomousJobsDouble();
  const tools = createLocalTools(memory as any, undefined, autonomousJobs as any);

  expect(tools.map((tool) => tool.name)).toEqual([
    "tdai_memory_search",
    "tdai_conversation_search",
    "tdai_context_ref_read",
    "tdai_memory_status",
    "save_memory",
    "tdai_current_datetime",
    "tdai_create_job",
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

test("memory search tool renders relevant historical task canvases", async () => {
  const memory = createMemoryServiceDouble();
  memory.recall.mockResolvedValueOnce({
    persona: undefined,
    atoms: [],
    scenarios: [],
    conversations: [],
    taskCanvas: undefined,
    taskCanvases: [{
      id: 7,
      chatId: "c1",
      userId: "u1",
      label: "token-refresh-investigation",
      filePath: "memory/task-canvases/c1/task-7.mmd",
      status: "completed",
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:00:00.000Z",
      canvas: "flowchart TD\n  T[\"Token refresh branch fixed\"]\n",
    }],
    fallbackChain: [],
  });

  const tools = createLocalTools(memory as any);
  const search = tools.find((tool) => tool.name === "tdai_memory_search");

  const output = await search!.execute({ query: "token refresh" }, { chatId: "c1", userId: "u1", memory: memory as any });

  expect(output).toContain("## Relevant Task Canvases");
  expect(output).toContain("token-refresh-investigation");
  expect(output).toContain("Token refresh branch fixed");
});

test("tdai_create_job creates one-shot hybrid jobs with default max_runs", async () => {
  const memory = createMemoryServiceDouble();
  const autonomousJobs = createAutonomousJobsDouble();
  const tools = createLocalTools(memory as any, undefined, autonomousJobs as any);
  const createJob = tools.find((tool) => tool.name === "tdai_create_job");

  expect(createJob).toBeDefined();

  const output = await createJob!.execute(
    {
      message_text: "Pengingat: minum air",
      agent_prompt: "Kirim respons singkat bahwa ini pengingat minum air.",
      schedule: { mode: "once", run_at: "2026-05-18T06:30:00.000Z" },
    },
    { chatId: "chat-1", userId: "user-1", memory: memory as any },
  );

  expect(output).toContain("Created job #9");
  expect(output).toContain("max_runs=1");
  expect(autonomousJobs.createJob).toHaveBeenCalledWith({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Kirim respons singkat bahwa ini pengingat minum air.",
    jobType: "hybrid",
    messageText: "Pengingat: minum air",
    agentPrompt: "Kirim respons singkat bahwa ini pengingat minum air.",
    schedule: {
      scheduleMode: "once",
      runAtUnix: 1779085800,
    },
    maxRuns: 1,
  });
});

test("tdai_create_job creates interval jobs with caller supplied max_runs", async () => {
  const memory = createMemoryServiceDouble();
  const autonomousJobs = createAutonomousJobsDouble();
  const tools = createLocalTools(memory as any, undefined, autonomousJobs as any);
  const createJob = tools.find((tool) => tool.name === "tdai_create_job");

  await createJob!.execute(
    {
      message_text: "Pengingat: cek deploy",
      agent_prompt: "Berikan follow-up cek deploy.",
      schedule: { mode: "interval", interval_sec: 600 },
      max_runs: 3,
    },
    { chatId: "chat-1", userId: "user-1", memory: memory as any },
  );

  expect(autonomousJobs.createJob).toHaveBeenCalledWith({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Berikan follow-up cek deploy.",
    jobType: "hybrid",
    messageText: "Pengingat: cek deploy",
    agentPrompt: "Berikan follow-up cek deploy.",
    schedule: {
      scheduleMode: "interval",
      intervalSec: 600,
    },
    maxRuns: 3,
  });
});

test("tdai_create_job creates cron jobs", async () => {
  const memory = createMemoryServiceDouble();
  const autonomousJobs = createAutonomousJobsDouble();
  const tools = createLocalTools(memory as any, undefined, autonomousJobs as any);
  const createJob = tools.find((tool) => tool.name === "tdai_create_job");

  await createJob!.execute(
    {
      message_text: "Pengingat: cek deploy",
      agent_prompt: "Berikan follow-up cek deploy.",
      schedule: { mode: "cron", cron_expr: "*/10 * * * *" },
    },
    { chatId: "chat-1", userId: "user-1", memory: memory as any },
  );

  expect(autonomousJobs.createJob).toHaveBeenCalledWith({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Berikan follow-up cek deploy.",
    jobType: "hybrid",
    messageText: "Pengingat: cek deploy",
    agentPrompt: "Berikan follow-up cek deploy.",
    schedule: {
      scheduleMode: "cron",
      cronExpr: "*/10 * * * *",
    },
    maxRuns: 1,
  });
});

test("tdai_create_job returns validation errors for invalid cron expressions", async () => {
  const memory = createMemoryServiceDouble();
  const autonomousJobs = createAutonomousJobsDouble();
  const tools = createLocalTools(memory as any, undefined, autonomousJobs as any);
  const createJob = tools.find((tool) => tool.name === "tdai_create_job");

  await expect(
    createJob!.execute(
      {
        message_text: "Pengingat: cek deploy",
        agent_prompt: "Berikan follow-up cek deploy.",
        schedule: { mode: "cron", cron_expr: "not cron" },
      },
      { chatId: "chat-1", userId: "user-1", memory: memory as any },
    ),
  ).resolves.toBe("Invalid cron expression: not cron");

  expect(autonomousJobs.createJob).not.toHaveBeenCalled();
});

test("tdai_create_job returns validation errors for incomplete input", async () => {
  const memory = createMemoryServiceDouble();
  const autonomousJobs = createAutonomousJobsDouble();
  const tools = createLocalTools(memory as any, undefined, autonomousJobs as any);
  const createJob = tools.find((tool) => tool.name === "tdai_create_job");

  await expect(
    createJob!.execute(
      {
        message_text: "",
        agent_prompt: "Prompt",
        schedule: { mode: "interval", interval_sec: 600 },
      },
      { chatId: "chat-1", userId: "user-1", memory: memory as any },
    ),
  ).resolves.toBe("message_text is required.");

  expect(autonomousJobs.createJob).not.toHaveBeenCalled();
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
