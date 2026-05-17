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
