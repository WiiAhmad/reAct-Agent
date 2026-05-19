import { expect, test } from "bun:test";
import { createTelegramBot } from "../../src/bot/bot";
import { memoryUpdateCallbacks } from "../../src/bot/conversations/memory-update";
import { resetActiveMemoryUpdateRunsForTest } from "../../src/bot/conversations/memory-update-runner";
import { config } from "../../src/config";
import { uiCallbacks } from "../../src/bot/ui/keyboards";

type ApiCall = { method: string; payload: Record<string, unknown> };

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createMemoryUpdateDeps() {
  const maintenanceCalls: Array<{ userId: string; force: boolean; source?: string }> = [];
  const maintenance = createDeferred<{ l1Created: number; l2ScenarioId?: number; personaUpdated: boolean }>();
  const settingsRuns: Array<{ event: "started" | "finished"; userId: string; status?: string | null }> = [];

  return {
    maintenance,
    maintenanceCalls,
    settingsRuns,
    deps: {
      memory: {
        runMaintenanceForUser: async (userId: string, force: boolean, options?: { source?: string; onProgress?: (event: any) => Promise<void> | void }) => {
          maintenanceCalls.push({ userId, force, source: options?.source });
          const result = await maintenance.promise;
          await options?.onProgress?.({ source: "telegram", userId, stage: "l1", status: "complete", createdAtoms: result.l1Created });
          return result;
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
        markRunStarted: (userId: string) => {
          settingsRuns.push({ event: "started", userId });
        },
        markRunFinished: (userId: string, _finishedAt: number, status: string, _error: string | null) => {
          settingsRuns.push({ event: "finished", userId, status });
          return { userId, enabled: true, scheduleLabel: "10m", lastStatus: status, lastError: null };
        },
      },
      registry: {} as any,
      llm: {} as any,
      autonomousJobs: {} as any,
    },
  };
}

function createBotHarness() {
  resetActiveMemoryUpdateRunsForTest();
  config.telegram.botToken = "12345:test-token";
  const { deps, maintenance, maintenanceCalls, settingsRuns } = createMemoryUpdateDeps();
  const traceEvents: Array<{ source: string; event: string; chatId?: string; userId?: string }> = [];
  const bot = createTelegramBot({ ...deps, trace: { emit: (event: any) => traceEvents.push(event) } } as any);
  (bot as any).me = { id: 12345, is_bot: true, first_name: "Test Bot", username: "test_bot" };
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

  return { bot, apiCalls, maintenance, maintenanceCalls, settingsRuns, traceEvents };
}

test("stale memory update run-now callback starts background maintenance without waiting", async () => {
  const { bot, apiCalls, maintenance, maintenanceCalls, settingsRuns, traceEvents } = createBotHarness();

  const update = {
    update_id: 1,
    callback_query: {
      id: "callback-1",
      from: { id: 42, is_bot: false, first_name: "User" },
      message: { message_id: 10, date: 1, chat: { id: 99, type: "private" } },
      chat_instance: "chat-instance",
      data: memoryUpdateCallbacks.runNow,
    },
  };

  const handlePromise = bot.handleUpdate(update as any);
  const result = await Promise.race([
    handlePromise.then(() => "returned" as const),
    new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 25)),
  ]);

  expect(result).toBe("returned");
  expect(maintenanceCalls).toEqual([{ userId: "42", force: true, source: "telegram" }]);
  expect(settingsRuns).toEqual([{ event: "started", userId: "42" }]);
  expect(apiCalls).toContainEqual({
    method: "answerCallbackQuery",
    payload: { callback_query_id: "callback-1" },
  });
  expect(apiCalls).toContainEqual({
    method: "sendMessage",
    payload: { chat_id: "99", text: "Memory update dimulai..." },
  });
  expect(traceEvents.map((event) => `${event.source}:${event.event}`)).toEqual([
    "bot:callback.memory_update.run_now",
    "bot:outbound.send.complete",
  ]);

  maintenance.resolve({ l1Created: 1, l2ScenarioId: 7, personaUpdated: true });
  await handlePromise;
});

test("stale memory update run-now callback without target answers with an error and has no side effects", async () => {
  const { bot, apiCalls, maintenanceCalls, settingsRuns } = createBotHarness();

  await bot.handleUpdate({
    update_id: 2,
    callback_query: {
      id: "callback-2",
      chat_instance: "chat-instance",
      data: memoryUpdateCallbacks.runNow,
    },
  } as any);

  expect(apiCalls).toContainEqual({
    method: "answerCallbackQuery",
    payload: {
      callback_query_id: "callback-2",
      text: "Tidak bisa menjalankan Memory Update dari tombol ini.",
      show_alert: true,
    },
  });
  expect(apiCalls.some((call) => call.method === "sendMessage")).toBe(false);
  expect(maintenanceCalls).toEqual([]);
  expect(settingsRuns).toEqual([]);
});

async function enterMemoryUpdateConversation(bot: ReturnType<typeof createTelegramBot>) {
  await bot.handleUpdate({
    update_id: 3,
    callback_query: {
      id: "callback-open",
      from: { id: 42, is_bot: false, first_name: "User" },
      message: { message_id: 10, date: 1, chat: { id: 99, type: "private" } },
      chat_instance: "chat-instance",
      data: uiCallbacks.memoryUpdate,
    },
  } as any);
}

async function pressMemoryUpdateRunNow(bot: ReturnType<typeof createTelegramBot>) {
  return bot.handleUpdate({
    update_id: 4,
    callback_query: {
      id: "callback-run",
      from: { id: 42, is_bot: false, first_name: "User" },
      message: { message_id: 10, date: 1, chat: { id: 99, type: "private" } },
      chat_instance: "chat-instance",
      data: memoryUpdateCallbacks.runNow,
    },
  } as any);
}

test("active memory update conversation run-now callback returns quickly and sends background progress", async () => {
  const { bot, apiCalls, maintenance, maintenanceCalls, settingsRuns } = createBotHarness();

  await enterMemoryUpdateConversation(bot);

  const handlePromise = pressMemoryUpdateRunNow(bot);
  const result = await Promise.race([
    handlePromise.then(() => "returned" as const),
    new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 25)),
  ]);

  expect(result).toBe("returned");
  expect(maintenanceCalls).toEqual([{ userId: "42", force: true, source: "telegram" }]);
  expect(settingsRuns).toEqual([{ event: "started", userId: "42" }]);
  expect(apiCalls).toContainEqual({
    method: "editMessageText",
    payload: {
      chat_id: 99,
      message_id: 10,
      text: "Memory Update\nEnabled: yes\nSchedule: 10m\nLast status: never run\nNote: Run now dimulai. Progress dikirim sebagai pesan baru.\nActions:\n- Run now\n- Enable/Disable\n- Change schedule\n- Back",
      reply_markup: expect.any(Object),
    },
  });

  maintenance.resolve({ l1Created: 1, l2ScenarioId: 7, personaUpdated: true });
  await handlePromise;
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(apiCalls).toContainEqual({
    method: "sendMessage",
    payload: { chat_id: "99", text: "L1 selesai: 1 atom dibuat." },
  });
  expect(apiCalls).toContainEqual({
    method: "sendMessage",
    payload: { chat_id: "99", text: "Memory update selesai. L1=1 atom, L2=scenario #7, L3=updated." },
  });
});

test("active memory update conversation lets /menu reach command middleware after run-now", async () => {
  const { bot, apiCalls, maintenance } = createBotHarness();

  await enterMemoryUpdateConversation(bot);
  const handlePromise = pressMemoryUpdateRunNow(bot);
  maintenance.resolve({ l1Created: 0, l2ScenarioId: 12, personaUpdated: true });
  await handlePromise;
  await new Promise((resolve) => setTimeout(resolve, 0));

  await bot.handleUpdate({
    update_id: 5,
    message: {
      message_id: 11,
      date: 1,
      chat: { id: 99, type: "private" },
      from: { id: 42, is_bot: false, first_name: "User" },
      text: "/menu",
      entities: [{ offset: 0, length: 5, type: "bot_command" }],
    },
  } as any);

  expect(apiCalls.some((call) =>
    call.method === "sendMessage" &&
    call.payload.chat_id === 99 &&
    call.payload.text === "Menu utama\nMemory membuka ringkasan memory dan pengaturan Memory Update.\nJobs membuka pengelolaan autonomous jobs dari menu.\nHelp menampilkan perintah publik dan panduan singkat."
  )).toBe(true);
});
