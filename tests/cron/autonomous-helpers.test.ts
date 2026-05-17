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
    enabled: 1,
    schedule_mode: "interval",
    interval_sec: 3600,
    cron_expr: null,
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
    enabled: true,
    scheduleMode: "interval",
    intervalSec: 3600,
    cronExpr: null,
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
