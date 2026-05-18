import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { migrate } from "../../src/db/schema";
import { AutonomousJobService } from "../../src/services/autonomous-jobs";
import { MemoryUpdateSettingsService } from "../../src/services/memory-update-settings";
import { mapAutonomousJobRow, runOneAutonomousJob, runOneMemoryUpdateNow } from "../../src/cron/autonomous";

function makeDb() {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

test("mapAutonomousJobRow converts snake_case database rows to camelCase rows", () => {
  const mapped = mapAutonomousJobRow({
    id: 42,
    chat_id: "chat-1",
    user_id: "user-1",
    prompt: "Check in with the team",
    job_type: "agent",
    message_text: "",
    agent_prompt: "",
    enabled: 1,
    schedule_mode: "interval",
    run_at_unix: null,
    interval_sec: 3600,
    cron_expr: null,
    run_count: 0,
    max_runs: null,
    last_run_at: 1715944800,
    last_finished_at: 1715948400,
    last_status: "success",
    last_error: null,
    created_at: "2026-05-17T11:00:00.000Z",
    updated_at: "2026-05-17T11:15:00.000Z",
  });

  expect(mapped).toMatchObject({
    id: 42,
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Check in with the team",
    jobType: "agent",
    messageText: "",
    agentPrompt: "",
    enabled: true,
    scheduleMode: "interval",
    runAtUnix: null,
    intervalSec: 3600,
    cronExpr: null,
    runCount: 0,
    maxRuns: null,
    lastRunAt: 1715944800,
    lastFinishedAt: 1715948400,
    lastStatus: "success",
    lastError: null,
    createdAt: "2026-05-17T11:00:00.000Z",
    updatedAt: "2026-05-17T11:15:00.000Z",
  });
  expect(mapped.scheduleLabel).toBe("Every 1 hour");
});

test("runOneAutonomousJob marks the job as successful and sends the response", async () => {
  const db = makeDb();
  const jobs = new AutonomousJobService(db);
  const job = jobs.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Check in with the team",
    schedule: { scheduleMode: "interval", intervalSec: 3600 },
  });
  const sent: Array<{ chatId: string; text: string }> = [];

  const startedAt = Math.floor(Date.UTC(2026, 4, 17, 11, 25, 0) / 1000);
  const finishedAt = startedAt + 37;

  const result = await runOneAutonomousJob({
    db,
    bot: {
      api: {
        sendMessage: async (chatId: string, text: string) => {
          sent.push({ chatId, text });
        },
      },
    } as any,
    memory: { } as any,
    registry: { } as any,
    llm: { } as any,
    job,
    runAgent: async () => "Autonomous answer",
    nowUnix: startedAt,
    finishedUnix: finishedAt,
  });

  expect(result.answer).toBe("Autonomous answer");
  expect(sent).toEqual([{ chatId: "chat-1", text: expect.stringContaining("Autonomous answer") }]);
  const refreshed = jobs.getJobById(job.id);
  expect(refreshed?.lastStatus).toBe("success");
  expect(refreshed?.lastRunAt).toBe(startedAt);
  expect(refreshed?.lastFinishedAt).toBe(finishedAt);
});

test("runOneAutonomousJob sends hybrid fixed text before agent response and deletes after max_runs", async () => {
  const db = makeDb();
  const jobs = new AutonomousJobService(db);
  const job = jobs.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Kirim tindak lanjut singkat.",
    jobType: "hybrid",
    messageText: "Pengingat: minum air",
    agentPrompt: "Kirim tindak lanjut singkat.",
    schedule: { scheduleMode: "interval", intervalSec: 600 },
    maxRuns: 1,
  });
  const sent: Array<{ chatId: string; text: string }> = [];
  const agentInputs: string[] = [];

  const result = await runOneAutonomousJob({
    db,
    bot: {
      api: {
        sendMessage: async (chatId: string, text: string) => {
          sent.push({ chatId, text });
        },
      },
    } as any,
    memory: {} as any,
    registry: {} as any,
    llm: {} as any,
    job,
    runAgent: async ({ input }) => {
      agentInputs.push(input);
      return "Agent follow-up";
    },
    nowUnix: 1_779_000_000,
    finishedUnix: 1_779_000_037,
  });

  expect(result.answer).toBe("Agent follow-up");
  expect(result.deleted).toBe(true);
  expect(result.runCount).toBe(1);
  expect(result.job).toBeNull();
  expect(agentInputs).toEqual(["[AUTONOMOUS_JOB #1] Kirim tindak lanjut singkat."]);
  expect(sent).toEqual([
    { chatId: "chat-1", text: "Pengingat: minum air" },
    { chatId: "chat-1", text: expect.stringContaining("Agent follow-up") },
  ]);
  expect(jobs.getJobById(job.id)).toBeNull();
});

test("runOneAutonomousJob does not count or delete jobs when the agent response fails to send", async () => {
  const db = makeDb();
  const jobs = new AutonomousJobService(db);
  const job = jobs.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Kirim tindak lanjut singkat.",
    jobType: "hybrid",
    messageText: "Pengingat: minum air",
    agentPrompt: "Kirim tindak lanjut singkat.",
    schedule: { scheduleMode: "interval", intervalSec: 600 },
    maxRuns: 1,
  });
  const agentInputs: string[] = [];

  await expect(runOneAutonomousJob({
    db,
    bot: {
      api: {
        sendMessage: async (_chatId: string, text: string) => {
          if (text.includes("Agent follow-up")) throw new Error("telegram down");
        },
      },
    } as any,
    memory: {} as any,
    registry: {} as any,
    llm: {} as any,
    job,
    runAgent: async ({ input }) => {
      agentInputs.push(input);
      return "Agent follow-up";
    },
    nowUnix: 1_779_000_000,
    finishedUnix: 1_779_000_037,
  })).rejects.toThrow("Failed to send autonomous job #1");

  const refreshed = jobs.getJobById(job.id);
  expect(agentInputs).toEqual(["[AUTONOMOUS_JOB #1] Kirim tindak lanjut singkat."]);
  expect(refreshed?.lastStatus).toBe("error");
  expect(refreshed?.runCount).toBe(0);
});

test("runOneAutonomousJob does not count or delete hybrid jobs when fixed text fails", async () => {
  const db = makeDb();
  const jobs = new AutonomousJobService(db);
  const job = jobs.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Kirim tindak lanjut singkat.",
    jobType: "hybrid",
    messageText: "Pengingat: minum air",
    agentPrompt: "Kirim tindak lanjut singkat.",
    schedule: { scheduleMode: "interval", intervalSec: 600 },
    maxRuns: 1,
  });
  const agentInputs: string[] = [];

  await expect(runOneAutonomousJob({
    db,
    bot: {
      api: {
        sendMessage: async (_chatId: string, text: string) => {
          if (text === "Pengingat: minum air") throw new Error("telegram down");
        },
      },
    } as any,
    memory: {} as any,
    registry: {} as any,
    llm: {} as any,
    job,
    runAgent: async ({ input }) => {
      agentInputs.push(input);
      return "Agent follow-up";
    },
    nowUnix: 1_779_000_000,
    finishedUnix: 1_779_000_037,
  })).rejects.toThrow("Failed to send hybrid job text #1");

  const refreshed = jobs.getJobById(job.id);
  expect(agentInputs).toEqual([]);
  expect(refreshed?.lastStatus).toBe("error");
  expect(refreshed?.runCount).toBe(0);
});

test("runOneMemoryUpdateNow runs maintenance and marks the settings as successful", async () => {
  const db = makeDb();
  const settings = new MemoryUpdateSettingsService(db);
  const setting = settings.getOrCreate("user-1");
  const maintenanceCalls: Array<{ userId: string; force: boolean }> = [];

  const startedAt = Math.floor(Date.UTC(2026, 4, 17, 11, 25, 0) / 1000);
  const finishedAt = startedAt + 37;

  const result = await runOneMemoryUpdateNow({
    memory: {
      runMaintenanceForUser: async (userId: string, force = false) => {
        maintenanceCalls.push({ userId, force });
        return { l1Created: 1, l2ScenarioId: 17, personaUpdated: true };
      },
    } as any,
    settings,
    userId: setting.userId,
    nowUnix: startedAt,
    finishedUnix: finishedAt,
  });

  expect(maintenanceCalls).toEqual([{ userId: "user-1", force: true }]);
  expect(result.maintenanceResult).toEqual({ l1Created: 1, l2ScenarioId: 17, personaUpdated: true });
  expect(result.settings.lastStatus).toBe("success");
  expect(result.settings.lastFinishedAt).toBe(finishedAt);
});

test("runOneMemoryUpdateNow forwards source and progress reporter to memory maintenance", async () => {
  const db = makeDb();
  const settings = new MemoryUpdateSettingsService(db);
  const setting = settings.getOrCreate("user-1");
  const progressEvents: string[] = [];
  const maintenanceCalls: Array<{ userId: string; force: boolean; source: string | undefined }> = [];

  const result = await runOneMemoryUpdateNow({
    memory: {
      runMaintenanceForUser: async (userId: string, force = false, options?: any) => {
        maintenanceCalls.push({ userId, force, source: options?.source });
        await options?.onProgress?.({ source: options.source, userId, stage: "l1", status: "complete", createdAtoms: 2 });
        return { l1Created: 2, l2ScenarioId: 18, personaUpdated: true };
      },
    } as any,
    settings,
    userId: setting.userId,
    source: "telegram",
    onProgress: async (event) => {
      progressEvents.push(`${event.source}:${event.stage}:${event.status}:${event.createdAtoms ?? ""}`);
    },
    nowUnix: 1_779_000_000,
    finishedUnix: 1_779_000_030,
  });

  expect(maintenanceCalls).toEqual([{ userId: "user-1", force: true, source: "telegram" }]);
  expect(progressEvents).toEqual([
    "telegram:run:start:",
    "telegram:l1:complete:2",
    "telegram:run:complete:2",
  ]);
  expect(result.maintenanceResult).toEqual({ l1Created: 2, l2ScenarioId: 18, personaUpdated: true });
  expect(result.settings.lastStatus).toBe("success");
});

test("runOneMemoryUpdateNow succeeds when progress reporter rejects", async () => {
  const db = makeDb();
  const settings = new MemoryUpdateSettingsService(db);
  const setting = settings.getOrCreate("user-1");
  const progressEvents: string[] = [];
  const maintenanceCalls: Array<{ userId: string; force: boolean }> = [];

  const result = await runOneMemoryUpdateNow({
    memory: {
      runMaintenanceForUser: async (userId: string, force = false, options?: any) => {
        maintenanceCalls.push({ userId, force });
        await options?.onProgress?.({ source: options.source, userId, stage: "l1", status: "complete", createdAtoms: 3 });
        return { l1Created: 3, l2ScenarioId: 19, personaUpdated: false };
      },
    } as any,
    settings,
    userId: setting.userId,
    source: "scheduler",
    onProgress: async (event) => {
      progressEvents.push(`${event.stage}:${event.status}`);
      throw new Error(`reporter failed at ${event.stage}:${event.status}`);
    },
    nowUnix: 1_779_000_000,
    finishedUnix: 1_779_000_030,
  });

  expect(maintenanceCalls).toEqual([{ userId: "user-1", force: true }]);
  expect(progressEvents).toEqual(["run:start", "l1:complete", "run:complete"]);
  expect(result.maintenanceResult).toEqual({ l1Created: 3, l2ScenarioId: 19, personaUpdated: false });
  expect(result.settings.lastStatus).toBe("success");
  expect(result.settings.lastFinishedAt).toBe(1_779_000_030);
});

test("runOneMemoryUpdateNow rethrows the maintenance failure when error reporting rejects", async () => {
  const db = makeDb();
  const settings = new MemoryUpdateSettingsService(db);
  const setting = settings.getOrCreate("user-1");

  await expect(runOneMemoryUpdateNow({
    memory: {
      runMaintenanceForUser: async () => {
        throw new Error("LLM timeout");
      },
    } as any,
    settings,
    userId: setting.userId,
    source: "scheduler",
    onProgress: async (event) => {
      if (event.status === "error") {
        throw new Error("reporter failed while reporting error");
      }
    },
    nowUnix: 1_779_000_000,
    finishedUnix: 1_779_000_030,
  })).rejects.toThrow("LLM timeout");

  const refreshed = settings.getOrCreate("user-1");
  expect(refreshed.lastStatus).toBe("error");
  expect(refreshed.lastError).toBe("LLM timeout");
});

test("runOneMemoryUpdateNow marks settings as error and rethrows maintenance failures", async () => {
  const db = makeDb();
  const settings = new MemoryUpdateSettingsService(db);
  const setting = settings.getOrCreate("user-1");

  await expect(runOneMemoryUpdateNow({
    memory: {
      runMaintenanceForUser: async () => {
        throw new Error("LLM timeout");
      },
    } as any,
    settings,
    userId: setting.userId,
    source: "scheduler",
    nowUnix: 1_779_000_000,
    finishedUnix: 1_779_000_030,
  })).rejects.toThrow("LLM timeout");

  const refreshed = settings.getOrCreate("user-1");
  expect(refreshed.lastStatus).toBe("error");
  expect(refreshed.lastError).toBe("LLM timeout");
});
