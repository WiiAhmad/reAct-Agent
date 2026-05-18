import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { migrate } from "../../src/db/schema";
import { AutonomousJobService } from "../../src/services/autonomous-jobs";

function makeService() {
  const db = new Database(":memory:");
  migrate(db);
  return { db, service: new AutonomousJobService(db) };
}

test("creates autonomous jobs with a human-friendly schedule label", () => {
  const { service } = makeService();

  const job = service.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Check in with the team",
    schedule: { scheduleMode: "interval", intervalSec: 86400 },
  });

  expect(job.scheduleLabel).toBe("Every 24 hours");
  expect(service.getJobById(job.id)?.scheduleLabel).toBe("Every 24 hours");
  expect(service.getJobByChat("chat-1", job.id)?.prompt).toBe("Check in with the team");
});

test("lists due autonomous jobs from created_at until the first completed run, then last_finished_at", () => {
  const { db, service } = makeService();

  const first = service.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "First job",
    schedule: { scheduleMode: "interval", intervalSec: 3600 },
  });
  const second = service.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Second job",
    schedule: { scheduleMode: "interval", intervalSec: 3600 },
  });

  db.query(`UPDATE autonomous_jobs SET created_at = ? WHERE id = ?`).run("2026-05-17T10:00:00.000Z", first.id);
  db.query(`UPDATE autonomous_jobs SET created_at = ?, last_finished_at = ? WHERE id = ?`).run(
    "2026-05-17T09:00:00.000Z",
    Math.floor(Date.UTC(2026, 4, 17, 10, 20, 0) / 1000),
    second.id,
  );

  expect(service.listDueJobs(Math.floor(Date.UTC(2026, 4, 17, 11, 10, 0) / 1000), 10).map((job) => job.id)).toEqual([
    first.id,
  ]);
  expect(service.listDueJobs(Math.floor(Date.UTC(2026, 4, 17, 11, 25, 0) / 1000), 10).map((job) => job.id)).toEqual([
    first.id,
    second.id,
  ]);
});

test("does not return due autonomous jobs when limit is zero", () => {
  const { service } = makeService();

  service.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "First job",
    schedule: { scheduleMode: "interval", intervalSec: 3600 },
  });

  expect(service.listDueJobs(Math.floor(Date.UTC(2026, 4, 17, 11, 25, 0) / 1000), 0)).toEqual([]);
});

test("creates hybrid one-shot jobs with a run limit", () => {
  const { service } = makeService();
  const runAtUnix = Math.floor(Date.UTC(2026, 4, 18, 6, 30, 0) / 1000);

  const job = service.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Berikan respons singkat bahwa ini pengingat minum air.",
    jobType: "hybrid",
    messageText: "Pengingat: minum air",
    agentPrompt: "Berikan respons singkat bahwa ini pengingat minum air.",
    schedule: { scheduleMode: "once", runAtUnix },
    maxRuns: 1,
  });

  expect(job).toMatchObject({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Berikan respons singkat bahwa ini pengingat minum air.",
    jobType: "hybrid",
    messageText: "Pengingat: minum air",
    agentPrompt: "Berikan respons singkat bahwa ini pengingat minum air.",
    scheduleMode: "once",
    runAtUnix,
    runCount: 0,
    maxRuns: 1,
  });
  expect(job.scheduleLabel).toBe("Once at 2026-05-18T06:30:00.000Z");
});

test("updates hybrid agent prompts when updating the job prompt", () => {
  const { service } = makeService();
  const job = service.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Old follow-up",
    jobType: "hybrid",
    messageText: "Pengingat: cek deploy",
    agentPrompt: "Old follow-up",
    schedule: { scheduleMode: "interval", intervalSec: 600 },
  });

  const updated = service.updatePrompt(job.id, "New follow-up");

  expect(updated.prompt).toBe("New follow-up");
  expect(updated.agentPrompt).toBe("New follow-up");
});

test("defaults one-shot jobs to a single successful run", () => {
  const { service } = makeService();
  const runAtUnix = Math.floor(Date.UTC(2026, 4, 18, 6, 30, 0) / 1000);
  const job = service.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Reminder follow-up",
    schedule: { scheduleMode: "once", runAtUnix },
  });

  expect(job.maxRuns).toBe(1);
  expect(service.recordSuccessfulRun(job.id)).toEqual({ deleted: true, job: null, runCount: 1 });
});

test("lists one-shot jobs only when run_at_unix is due", () => {
  const { service } = makeService();
  const runAtUnix = Math.floor(Date.UTC(2026, 4, 18, 6, 30, 0) / 1000);
  const job = service.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Reminder follow-up",
    jobType: "hybrid",
    messageText: "Pengingat: minum air",
    agentPrompt: "Reminder follow-up",
    schedule: { scheduleMode: "once", runAtUnix },
    maxRuns: 1,
  });

  expect(service.listDueJobs(runAtUnix - 1, 10)).toEqual([]);
  expect(service.listDueJobs(runAtUnix, 10).map((dueJob) => dueJob.id)).toEqual([job.id]);
});

test("updates one-shot schedules to a single successful run when no run limit exists", () => {
  const { service } = makeService();
  const job = service.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Reminder follow-up",
    schedule: { scheduleMode: "interval", intervalSec: 600 },
  });
  const runAtUnix = Math.floor(Date.UTC(2026, 4, 18, 6, 30, 0) / 1000);

  const updated = service.updateSchedule(job.id, { scheduleMode: "once", runAtUnix });

  expect(updated.maxRuns).toBe(1);
  expect(service.recordSuccessfulRun(job.id)).toEqual({ deleted: true, job: null, runCount: 1 });
});

test("records successful runs and deletes jobs that reach max_runs", () => {
  const { service } = makeService();
  const job = service.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Reminder follow-up",
    jobType: "hybrid",
    messageText: "Pengingat: minum air",
    agentPrompt: "Reminder follow-up",
    schedule: { scheduleMode: "interval", intervalSec: 600 },
    maxRuns: 1,
  });

  const result = service.recordSuccessfulRun(job.id);

  expect(result).toEqual({ deleted: true, job: null, runCount: 1 });
  expect(service.getJobById(job.id)).toBeNull();
});
