import { expect, test } from "bun:test";
import { createTelegramBot } from "../../src/bot/bot";
import { memoryUpdateCallbacks } from "../../src/bot/conversations/memory-update";
import { resetActiveMemoryUpdateRunsForTest } from "../../src/bot/conversations/memory-update-runner";
import { renderMainMenuScreen } from "../../src/bot/ui/renderers";
import { config } from "../../src/config";
import { uiCallbacks } from "../../src/bot/ui/keyboards";

type ApiCall = { method: string; payload: Record<string, unknown> };

const from = { id: 42, is_bot: false, first_name: "User" };
const chat = { id: 99, type: "private" };
const baseJob = {
  id: 1,
  chatId: "99",
  userId: "42",
  prompt: "Existing job",
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
};

function createBotHarness() {
  resetActiveMemoryUpdateRunsForTest();
  config.telegram.botToken = "12345:test-token";
  const jobs = [{ ...baseJob }];
  const apiCalls: ApiCall[] = [];
  const recordApiCall = (method: string, payload: Record<string, unknown> = {}) => {
    apiCalls.push({ method, payload });
    if (method === "getMe") {
      return { id: 12345, is_bot: true, first_name: "Test Bot", username: "test_bot" };
    }
    if (method === "sendMessage") {
      return { message_id: apiCalls.length, date: 1, chat: { id: payload.chat_id, type: "private" }, text: payload.text };
    }
    if (method === "answerCallbackQuery") {
      return true;
    }
    return true;
  };

  const deps = {
    memory: {
      memoryStatus: async () => "status",
      recall: async () => ({ persona: "Persona", atoms: [], scenarios: [], taskCanvas: null, taskCanvases: [] }),
      countGeneratedSkills: async () => 0,
      listTaskCanvases: async () => [{ id: 1, label: "Task canvas" }],
      generateSkillDraft: async () => ({ ok: true, skillName: "draft-skill", filePath: "generated/draft.md" }),
      runMaintenanceForUser: async (_userId: string, _force: boolean, options?: { onProgress?: (event: any) => Promise<void> | void }) => {
        await options?.onProgress?.({ source: "telegram", userId: "42", stage: "l1", status: "complete", createdAtoms: 0 });
        return { l1Created: 0, l2ScenarioId: 1, personaUpdated: true };
      },
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
      updateSchedule: (userId: string, schedule: { scheduleMode: "interval" | "cron"; intervalSec?: number; cronExpr?: string }) => ({
        userId,
        enabled: true,
        scheduleMode: schedule.scheduleMode,
        intervalSec: schedule.intervalSec ?? null,
        cronExpr: schedule.cronExpr ?? null,
        lastRunAt: null,
        lastFinishedAt: null,
        lastStatus: null,
        lastError: null,
        createdAt: "2026-05-18T00:00:00.000Z",
        updatedAt: "2026-05-18T00:00:00.000Z",
        scheduleLabel: schedule.scheduleMode === "cron" ? schedule.cronExpr : "10m",
      }),
      markRunStarted: () => undefined,
      markRunFinished: (userId: string, _finishedAt: number, status: string) => ({ userId, enabled: true, scheduleLabel: "10m", lastStatus: status, lastError: null }),
    },
    autonomousJobs: {
      listJobsForChat: () => jobs,
      getJobByChat: (_chatId: string, jobId: number) => jobs.find((job) => job.id === jobId) ?? null,
      createJob: ({ chatId, userId, prompt, schedule }: any) => {
        const job = { ...baseJob, id: jobs.length + 1, chatId, userId, prompt, ...schedule };
        jobs.push(job);
        return job;
      },
      updatePrompt: (jobId: number, prompt: string) => {
        const job = jobs.find((item) => item.id === jobId)!;
        Object.assign(job, { prompt });
        return job;
      },
      updateSchedule: (jobId: number, schedule: any) => {
        const job = jobs.find((item) => item.id === jobId)!;
        Object.assign(job, schedule, { scheduleLabel: schedule.scheduleMode === "cron" ? schedule.cronExpr : "10m" });
        return job;
      },
      setEnabled: (jobId: number, enabled: boolean) => {
        const job = jobs.find((item) => item.id === jobId)!;
        Object.assign(job, { enabled });
        return job;
      },
      deleteJob: (jobId: number) => {
        const index = jobs.findIndex((item) => item.id === jobId);
        if (index >= 0) jobs.splice(index, 1);
      },
    },
    registry: {},
    llm: {},
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

  return { bot, apiCalls };
}

async function pressCallback(bot: ReturnType<typeof createTelegramBot>, updateId: number, data: string) {
  await bot.handleUpdate({
    update_id: updateId,
    callback_query: {
      id: `callback-${updateId}`,
      from,
      message: { message_id: 10, date: 1, chat },
      chat_instance: "chat-instance",
      data,
    },
  } as any);
}

async function sendMenu(bot: ReturnType<typeof createTelegramBot>, updateId: number) {
  await bot.handleUpdate({
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1,
      chat,
      from,
      text: "/menu",
      entities: [{ offset: 0, length: 5, type: "bot_command" }],
    },
  } as any);
}

function expectMainMenuScreen(apiCalls: ApiCall[]) {
  expect(apiCalls.some((call) =>
    (call.method === "sendMessage" || call.method === "editMessageText") &&
    String(call.payload.chat_id) === "99" &&
    call.payload.text === renderMainMenuScreen()
  )).toBe(true);
}

const passThroughScenarios: Array<{
  name: string;
  open: (bot: ReturnType<typeof createTelegramBot>) => Promise<void>;
}> = [
  {
    name: "memory update schedule selection",
    open: async (bot) => {
      await pressCallback(bot, 1, uiCallbacks.memoryUpdate);
      await pressCallback(bot, 2, memoryUpdateCallbacks.changeSchedule);
    },
  },
  {
    name: "job creation prompt",
    open: async (bot) => {
      await pressCallback(bot, 1, uiCallbacks.addJob);
    },
  },
  {
    name: "job detail screen",
    open: async (bot) => {
      await pressCallback(bot, 1, "jobs:detail:1");
    },
  },
  {
    name: "skill draft screen",
    open: async (bot) => {
      await pressCallback(bot, 1, uiCallbacks.skillDrafts);
    },
  },
];

for (const scenario of passThroughScenarios) {
  test(`${scenario.name} lets /menu reach command middleware`, async () => {
    const { bot, apiCalls } = createBotHarness();

    await scenario.open(bot);
    await sendMenu(bot, 20);

    expectMainMenuScreen(apiCalls);
  });

  test(`${scenario.name} lets Menu callback reach callback middleware`, async () => {
    const { bot, apiCalls } = createBotHarness();

    await scenario.open(bot);
    await pressCallback(bot, 21, uiCallbacks.menu);

    expectMainMenuScreen(apiCalls);
  });
}
