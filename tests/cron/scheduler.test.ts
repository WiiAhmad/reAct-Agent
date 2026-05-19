import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { migrate } from "../../src/db/schema";
import { AutonomousJobService } from "../../src/services/autonomous-jobs";
import { MemoryUpdateSettingsService } from "../../src/services/memory-update-settings";
import { dispatchSchedulerTick } from "../../src/cron/scheduler";

function makeDb() {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

test("dispatchSchedulerTick runs due jobs first, then memory updates within the limit", async () => {
  const db = makeDb();
  const jobs = new AutonomousJobService(db);
  const settings = new MemoryUpdateSettingsService(db);
  const nowUnix = Math.floor(Date.UTC(2026, 4, 17, 12, 0, 0) / 1000);

  const firstJob = jobs.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "First due job",
    schedule: { scheduleMode: "interval", intervalSec: 3600 },
  });
  const secondJob = jobs.createJob({
    chatId: "chat-2",
    userId: "user-2",
    prompt: "Second due job",
    schedule: { scheduleMode: "interval", intervalSec: 3600 },
  });
  settings.getOrCreate("user-3");
  settings.getOrCreate("user-4");

  db.query(`UPDATE autonomous_jobs SET created_at = ? WHERE id = ?`).run("2026-05-17T10:00:00.000Z", firstJob.id);
  db.query(`UPDATE autonomous_jobs SET created_at = ?, last_finished_at = ? WHERE id = ?`).run(
    "2026-05-17T09:00:00.000Z",
    Math.floor(Date.UTC(2026, 4, 17, 11, 0, 0) / 1000),
    secondJob.id,
  );
  db.query(`UPDATE memory_update_settings SET created_at = ?, interval_sec = ? WHERE user_id = ?`).run(
    "2026-05-17T10:00:00.000Z",
    3600,
    "user-3",
  );
  db.query(`UPDATE memory_update_settings SET created_at = ?, interval_sec = ?, last_finished_at = ? WHERE user_id = ?`).run(
    "2026-05-17T09:00:00.000Z",
    3600,
    Math.floor(Date.UTC(2026, 4, 17, 11, 0, 0) / 1000),
    "user-4",
  );

  const calls: Array<string> = [];
  const traceEvents: Array<{ source: string; event: string; payload?: unknown }> = [];
  const result = await dispatchSchedulerTick({
    jobs,
    memoryUpdateSettings: settings,
    maxItemsPerTick: 3,
    nowUnix,
    trace: { emit: (event) => traceEvents.push(event) },
    runOneAutonomousJob: async ({ job }) => {
      calls.push(`job:${job.id}`);
      return { answer: "ok" } as any;
    },
    runOneMemoryUpdateNow: async ({ userId }) => {
      calls.push(`memory:${userId}`);
      return { maintenanceResult: { l1Created: 0, l2ScenarioId: null, personaUpdated: false } } as any;
    },
  });

  expect(result).toEqual({ jobsRun: 2, memoryUpdatesRun: 1 });
  expect(calls).toEqual([`job:${firstJob.id}`, `job:${secondJob.id}`, "memory:user-4"]);
  expect(traceEvents.map((event) => `${event.source}:${event.event}`)).toEqual([
    "scheduler:tick.start",
    "scheduler:tick.complete",
  ]);
});
