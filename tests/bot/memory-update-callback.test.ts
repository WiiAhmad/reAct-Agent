import { expect, test } from "bun:test";
import { createTelegramBot } from "../../src/bot/bot";
import { memoryUpdateCallbacks } from "../../src/bot/conversations/memory-update";
import { resetActiveMemoryUpdateRunsForTest } from "../../src/bot/conversations/memory-update-runner";
import { config } from "../../src/config";

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
        runMaintenanceForUser: async (userId: string, force: boolean, options?: { source?: string }) => {
          maintenanceCalls.push({ userId, force, source: options?.source });
          return maintenance.promise;
        },
      },
      memoryUpdateSettings: {
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
  const bot = createTelegramBot(deps as any);
  (bot as any).me = { id: 12345, is_bot: true, first_name: "Test Bot", username: "test_bot" };
  const apiCalls: ApiCall[] = [];

  bot.api.config.use((async (_prev: unknown, method: string, payload: Record<string, unknown> = {}) => {
    apiCalls.push({ method, payload });
    if (method === "getMe") {
      return { ok: true, result: { id: 12345, is_bot: true, first_name: "Test Bot", username: "test_bot" } };
    }
    if (method === "sendMessage") {
      return { ok: true, result: { message_id: apiCalls.length, date: 1, chat: { id: payload.chat_id, type: "private" }, text: payload.text } };
    }
    if (method === "answerCallbackQuery") {
      return { ok: true, result: true };
    }
    return { ok: true, result: true };
  }) as any);

  return { bot, apiCalls, maintenance, maintenanceCalls, settingsRuns };
}

test("stale memory update run-now callback starts background maintenance without waiting", async () => {
  const { bot, apiCalls, maintenance, maintenanceCalls, settingsRuns } = createBotHarness();

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
