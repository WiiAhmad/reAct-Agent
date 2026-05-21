import { expect, test } from "bun:test";
import { createTelegramBot } from "../../src/bot/bot";
import { config } from "../../src/config";
import { memoryUpdateCallbacks } from "../../src/bot/conversations/memory-update";
import { resetActiveMemoryUpdateRunsForTest } from "../../src/bot/conversations/memory-update-runner";
import { uiCallbacks } from "../../src/bot/ui/keyboards";

type ApiCall = { method: string; payload: Record<string, unknown> };

type JobRow = {
  id: number;
  chatId: string;
  userId: string;
  prompt: string;
  enabled: boolean;
  scheduleMode: "interval" | "cron" | "once";
  intervalSec: number | null;
  cronExpr: string | null;
  runAtUnix: number | null;
  runCount: number;
  maxRuns: number | null;
  jobType: "agent" | "hybrid";
  messageText: string;
  agentPrompt: string;
  lastRunAt: number | null;
  lastFinishedAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  scheduleLabel: string;
};

const from = { id: 42, is_bot: false, first_name: "User" };
const otherFrom = { id: 77, is_bot: false, first_name: "Other User" };
const baseJob: JobRow = {
  id: 1,
  chatId: "99",
  userId: "42",
  prompt: "Owned job",
  enabled: true,
  scheduleMode: "interval",
  intervalSec: 600,
  cronExpr: null,
  runAtUnix: null,
  runCount: 0,
  maxRuns: null,
  jobType: "agent",
  messageText: "",
  agentPrompt: "",
  lastRunAt: null,
  lastFinishedAt: null,
  lastStatus: null,
  lastError: null,
  createdAt: "2026-05-18T00:00:00.000Z",
  updatedAt: "2026-05-18T00:00:00.000Z",
  scheduleLabel: "10m",
};

function createBotHarness(options: {
  chatType?: "private" | "group";
  jobs?: JobRow[];
  getJobForActorResult?: JobRow | null;
} = {}) {
  resetActiveMemoryUpdateRunsForTest();
  config.telegram.botToken = "12345:test-token";

  const memoryCalls = {
    memoryStatus: 0,
    recall: 0,
    countGeneratedSkills: 0,
  };
  const jobCalls = {
    listJobsForActor: [] as Array<{ chatId: string; userId: string }>,
    getJobForActor: [] as Array<{ chatId: string; userId: string; jobId: number }>,
    createJob: [] as Array<{
      chatId: string;
      userId: string;
      prompt: string;
      schedule: { scheduleMode: "interval" | "cron"; intervalSec?: number; cronExpr?: string };
    }>,
    updatePrompt: [] as Array<{ jobId: number; prompt: string }>,
    updateSchedule: [] as Array<{ jobId: number; schedule: unknown }>,
    setEnabled: [] as Array<{ jobId: number; enabled: boolean }>,
    deleteJob: [] as number[],
  };
  const jobs = options.jobs ?? [{ ...baseJob }];
  const chat = { id: 99, type: options.chatType ?? "group" };
  const apiCalls: ApiCall[] = [];

  const recordApiCall = (method: string, payload: Record<string, unknown> = {}) => {
    apiCalls.push({ method, payload });
    if (method === "getMe") {
      return { id: 12345, is_bot: true, first_name: "Test Bot", username: "test_bot" };
    }
    if (method === "sendMessage") {
      return { message_id: apiCalls.length, date: 1, chat: { id: payload.chat_id, type: chat.type }, text: payload.text };
    }
    if (method === "answerCallbackQuery") {
      return true;
    }
    return true;
  };

  const deps = {
    memory: {
      memoryStatus: async () => {
        memoryCalls.memoryStatus += 1;
        return "sensitive-memory-status";
      },
      recall: async () => {
        memoryCalls.recall += 1;
        return { persona: "Sensitive persona", atoms: [{ id: 1, text: "Secret atom", importance: 10 }], scenarios: [], conversations: [], taskCanvas: null, taskCanvases: [] };
      },
      countGeneratedSkills: async () => {
        memoryCalls.countGeneratedSkills += 1;
        return 7;
      },
      logUserMessage: async () => 1,
      judgeTaskTurn: async () => ({ taskId: null, judgment: { isLongTask: false, isContinuation: false, taskCompleted: false, source: "test" } }),
      recentMessages: async () => [],
      logAssistantMessage: async () => 2,
      listTaskCanvases: async () => [],
      generateSkillDraft: async () => ({ ok: true, skillName: "draft-skill", filePath: "generated/draft.md" }),
      runMaintenanceForUser: async () => ({ l1Created: 0, l2ScenarioId: 1, personaUpdated: true }),
    },
    memoryUpdateSettings: {
      getOrCreate: (userId: string) => ({
        userId,
        enabled: true,
        scheduleMode: "interval",
        intervalSec: 600,
        cronExpr: null,
        lastRunAt: null,
        lastFinishedAt: null,
        lastStatus: null,
        lastError: null,
        createdAt: "2026-05-18T00:00:00.000Z",
        updatedAt: "2026-05-18T00:00:00.000Z",
        scheduleLabel: "10m",
      }),
      renderSummary: () => "Memory update settings",
      setEnabled: (userId: string, enabled: boolean) => ({
        userId,
        enabled,
        scheduleMode: "interval",
        intervalSec: 600,
        cronExpr: null,
        lastRunAt: null,
        lastFinishedAt: null,
        lastStatus: null,
        lastError: null,
        createdAt: "2026-05-18T00:00:00.000Z",
        updatedAt: "2026-05-18T00:00:00.000Z",
        scheduleLabel: "10m",
      }),
      updateSchedule: (userId: string) => ({
        userId,
        enabled: true,
        scheduleMode: "interval",
        intervalSec: 600,
        cronExpr: null,
        lastRunAt: null,
        lastFinishedAt: null,
        lastStatus: null,
        lastError: null,
        createdAt: "2026-05-18T00:00:00.000Z",
        updatedAt: "2026-05-18T00:00:00.000Z",
        scheduleLabel: "10m",
      }),
      markRunStarted: () => undefined,
      markRunFinished: (userId: string, _finishedAt: number, status: string) => ({ userId, enabled: true, scheduleLabel: "10m", lastStatus: status, lastError: null }),
    },
    autonomousJobs: {
      listJobsForActor: (chatId: string, userId: string) => {
        jobCalls.listJobsForActor.push({ chatId, userId });
        return jobs;
      },
      getJobForActor: (chatId: string, userId: string, jobId: number) => {
        jobCalls.getJobForActor.push({ chatId, userId, jobId });
        return "getJobForActorResult" in options ? options.getJobForActorResult : jobs.find((job) => job.id === jobId) ?? null;
      },
      createJob: ({ chatId, userId, prompt, schedule }: { chatId: string; userId: string; prompt: string; schedule: { scheduleMode: "interval" | "cron"; intervalSec?: number; cronExpr?: string } }) => {
        jobCalls.createJob.push({ chatId, userId, prompt, schedule });
        return { ...baseJob, chatId, userId, prompt, scheduleLabel: schedule.scheduleMode === "cron" ? schedule.cronExpr ?? "custom" : "10m" };
      },
      updatePrompt: (jobId: number, prompt: string) => {
        jobCalls.updatePrompt.push({ jobId, prompt });
        return { ...baseJob, id: jobId, prompt };
      },
      updateSchedule: (jobId: number, schedule: unknown) => {
        jobCalls.updateSchedule.push({ jobId, schedule });
        return { ...baseJob, id: jobId };
      },
      setEnabled: (jobId: number, enabled: boolean) => {
        jobCalls.setEnabled.push({ jobId, enabled });
        return { ...baseJob, id: jobId, enabled };
      },
      deleteJob: (jobId: number) => {
        jobCalls.deleteJob.push(jobId);
        return true;
      },
    },
    registry: { list: () => [] },
    llm: { complete: async () => ({ content: "agent answer", toolCalls: [] }) },
  };

  const bot = createTelegramBot(deps as any);
  (bot as any).me = { id: 12345, is_bot: true, first_name: "Test Bot", username: "test_bot" };
  (bot as any).clientConfig = {
    ...(bot as any).clientConfig,
    fetch: async (url: string | URL, init?: RequestInit) => {
      const method = String(url).split("/").pop() ?? "unknown";
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      return new Response(JSON.stringify({ ok: true, result: recordApiCall(method, payload) }), {
        headers: { "content-type": "application/json" },
      });
    },
  };
  bot.api.config.use((async (_prev: unknown, method: string, payload: Record<string, unknown> = {}) => {
    return { ok: true, result: recordApiCall(method, payload) };
  }) as any);

  return { bot, apiCalls, memoryCalls, jobCalls, chat };
}

async function pressCallbackAs(
  bot: ReturnType<typeof createTelegramBot>,
  chat: { id: number; type: "private" | "group" },
  updateId: number,
  data: string,
  actor: typeof from,
) {
  await bot.handleUpdate({
    update_id: updateId,
    callback_query: {
      id: `callback-${updateId}`,
      from: actor,
      message: { message_id: 10, date: 1, chat },
      chat_instance: "chat-instance",
      data,
    },
  } as any);
}

async function pressCallback(
  bot: ReturnType<typeof createTelegramBot>,
  chat: { id: number; type: "private" | "group" },
  updateId: number,
  data: string,
) {
  await pressCallbackAs(bot, chat, updateId, data, from);
}

async function sendTextAs(
  bot: ReturnType<typeof createTelegramBot>,
  chat: { id: number; type: "private" | "group" },
  updateId: number,
  text: string,
  actor: typeof from,
) {
  await bot.handleUpdate({
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1,
      chat,
      from: actor,
      text,
    },
  } as any);
}

async function sendCommand(
  bot: ReturnType<typeof createTelegramBot>,
  chat: { id: number; type: "private" | "group" },
  updateId: number,
  text: "/menu" | "/help",
) {
  await bot.handleUpdate({
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1,
      chat,
      from,
      text,
      entities: [{ offset: 0, length: text.length, type: "bot_command" }],
    },
  } as any);
}

test("group /menu omits memory entrypoints from the rendered surface", async () => {
  const { bot, apiCalls, chat } = createBotHarness({ chatType: "group" });

  await sendCommand(bot, chat, 1, "/menu");

  const menuCall = apiCalls.find((call) => call.method === "sendMessage" && String(call.payload.text).includes("Menu utama"));
  expect(menuCall).toBeDefined();
  expect(String(menuCall?.payload.text)).toContain("Jobs membuka pengelolaan autonomous jobs dari menu.");
  expect(String(menuCall?.payload.text)).toContain("Memory tetap private-only");
  expect(String(menuCall?.payload.text)).not.toContain("Memory membuka ringkasan memory");
  expect(String(menuCall?.payload.text)).not.toContain("Memory Update");
  expect(String(menuCall?.payload.text)).not.toContain("Skill Drafts");
  const callbacks = ((menuCall?.payload.reply_markup as { inline_keyboard?: Array<Array<{ callback_data?: string }>> } | undefined)?.inline_keyboard ?? [])
    .flat()
    .map((button) => button.callback_data);
  expect(callbacks).not.toContain(uiCallbacks.memory);
  expect(callbacks).not.toContain(uiCallbacks.memoryUpdate);
  expect(callbacks).not.toContain(uiCallbacks.skillDrafts);
  expect(callbacks).toContain(uiCallbacks.jobs);
  expect(callbacks).toContain(uiCallbacks.help);
});

test("group /help avoids advertising memory menu entries", async () => {
  const { bot, apiCalls, chat } = createBotHarness({ chatType: "group" });

  await sendCommand(bot, chat, 2, "/help");

  const helpCall = apiCalls.find((call) => call.method === "sendMessage" && String(call.payload.text).includes("Help"));
  expect(helpCall).toBeDefined();
  expect(String(helpCall?.payload.text)).toContain("Jobs tersedia dari menu");
  expect(String(helpCall?.payload.text)).toContain("Memory tetap private-only");
  expect(String(helpCall?.payload.text)).not.toContain("Memory Update, Skill Drafts, dan Jobs tersedia dari menu");
  expect(String(helpCall?.payload.text)).not.toContain("Skill Drafts");
  expect(String(helpCall?.payload.text)).not.toContain("Memory Update");
});

test("group memory callback refuses to render memory data", async () => {
  const { bot, apiCalls, memoryCalls, chat } = createBotHarness({ chatType: "group" });

  await pressCallback(bot, chat, 3, uiCallbacks.memory);

  expect(apiCalls).toContainEqual({
    method: "editMessageText",
    payload: {
      chat_id: 99,
      message_id: 10,
      text: "Memory hanya tersedia di private chat.",
      reply_markup: expect.any(Object),
    },
  });
  expect(memoryCalls).toEqual({ memoryStatus: 0, recall: 0, countGeneratedSkills: 0 });
  expect(apiCalls.some((call) => String(call.payload.text).includes("Sensitive persona"))).toBe(false);
});

test("group memory update callback refuses to enter the private-only memory flow", async () => {
  const { bot, apiCalls, memoryCalls, chat } = createBotHarness({ chatType: "group" });

  await pressCallback(bot, chat, 2, uiCallbacks.memoryUpdate);

  expect(apiCalls).toContainEqual({
    method: "editMessageText",
    payload: {
      chat_id: 99,
      message_id: 10,
      text: "Memory hanya tersedia di private chat.",
      reply_markup: expect.any(Object),
    },
  });
  expect(memoryCalls).toEqual({ memoryStatus: 0, recall: 0, countGeneratedSkills: 0 });
  expect(apiCalls.some((call) => String(call.payload.text).includes("Memory Update"))).toBe(false);
});

test("group stale memory run-now callback refuses to start memory update", async () => {
  const { bot, apiCalls, memoryCalls, chat } = createBotHarness({ chatType: "group" });

  await pressCallback(bot, chat, 3, memoryUpdateCallbacks.runNow);

  expect(apiCalls).toContainEqual({
    method: "editMessageText",
    payload: {
      chat_id: 99,
      message_id: 10,
      text: "Memory hanya tersedia di private chat.",
      reply_markup: expect.any(Object),
    },
  });
  expect(memoryCalls).toEqual({ memoryStatus: 0, recall: 0, countGeneratedSkills: 0 });
  expect(apiCalls.some((call) => String(call.payload.text).includes("Memory update dimulai"))).toBe(false);
});

test("group stale skill drafts callback refuses to enter memory-related UI", async () => {
  const { bot, apiCalls, memoryCalls, chat } = createBotHarness({ chatType: "group" });

  await pressCallback(bot, chat, 4, uiCallbacks.skillDrafts);

  expect(apiCalls).toContainEqual({
    method: "editMessageText",
    payload: {
      chat_id: 99,
      message_id: 10,
      text: "Memory hanya tersedia di private chat.",
      reply_markup: expect.any(Object),
    },
  });
  expect(memoryCalls).toEqual({ memoryStatus: 0, recall: 0, countGeneratedSkills: 0 });
  expect(apiCalls.some((call) => String(call.payload.text).includes("Skill Drafts"))).toBe(false);
});

test("jobs screen uses actor-scoped jobs and only renders owned jobs", async () => {
  const ownedJob = { ...baseJob, id: 1, prompt: "Owned job" };
  const { bot, apiCalls, jobCalls, chat } = createBotHarness({
    chatType: "group",
    jobs: [ownedJob],
  });

  await pressCallback(bot, chat, 3, uiCallbacks.jobs);

  expect(jobCalls.listJobsForActor).toEqual([{ chatId: "99", userId: "42" }]);
  const jobsScreenCall = apiCalls.find((call) => call.method === "editMessageText" && String(call.payload.text).includes("Jobs"));
  expect(jobsScreenCall?.payload.text).toContain("Owned job");
  expect(jobsScreenCall?.payload.text).not.toContain("Other user job");
});

test("job detail callback cannot open another user's job in a shared chat", async () => {
  const { bot, apiCalls, jobCalls, chat } = createBotHarness({
    chatType: "group",
    jobs: [{ ...baseJob, id: 1, prompt: "Owned job" }],
    getJobForActorResult: null,
  });

  await pressCallback(bot, chat, 4, "jobs:detail:1");

  expect(jobCalls.getJobForActor).toEqual([{ chatId: "99", userId: "42", jobId: 1 }]);
  expect(apiCalls).toContainEqual({
    method: "sendMessage",
    payload: {
      chat_id: 99,
      text: "Autonomous job #1 tidak ditemukan.",
    },
  });
});

test("foreign callback cannot mutate an already-open job detail conversation", async () => {
  const { bot, jobCalls, chat } = createBotHarness({
    chatType: "group",
    jobs: [{ ...baseJob, id: 1, prompt: "Owned job", enabled: true }],
  });

  await pressCallback(bot, chat, 5, "jobs:detail:1");
  await pressCallbackAs(bot, chat, 6, "jobs:detail:toggle-enabled", otherFrom);

  expect(jobCalls.setEnabled).toEqual([]);
});

test("foreign text and callbacks cannot hijack shared-chat job creation", async () => {
  const { bot, jobCalls, chat } = createBotHarness({ chatType: "group" });

  await pressCallback(bot, chat, 7, uiCallbacks.addJob);
  await sendTextAs(bot, chat, 8, "Hijacked prompt", otherFrom);
  await sendTextAs(bot, chat, 9, "Owner prompt", from);
  await pressCallbackAs(bot, chat, 10, uiCallbacks.schedulePreset1h, otherFrom);
  await pressCallback(bot, chat, 11, uiCallbacks.schedulePreset10m);

  expect(jobCalls.createJob).toEqual([
    {
      chatId: "99",
      userId: "42",
      prompt: "Owner prompt",
      schedule: { scheduleMode: "interval", intervalSec: 600 },
    },
  ]);
});

test("foreign text input cannot update prompt inside an already-open job detail conversation", async () => {
  const { bot, jobCalls, chat } = createBotHarness({
    chatType: "group",
    jobs: [{ ...baseJob, id: 1, prompt: "Owned job" }],
  });

  await pressCallback(bot, chat, 7, "jobs:detail:1");
  await pressCallback(bot, chat, 8, "jobs:detail:edit-prompt");
  await sendTextAs(bot, chat, 9, "Hijacked prompt", otherFrom);

  expect(jobCalls.updatePrompt).toEqual([]);
});
