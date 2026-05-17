import type { Database } from "bun:sqlite";
import { describeSchedule, getNextDueAtUnix, isScheduleDue, normalizeSchedule, type ScheduleInput } from "./schedules";
import { nowIso } from "../utils/time";

export type AutonomousJobRow = {
  id: number;
  chatId: string;
  userId: string;
  prompt: string;
  enabled: boolean;
  scheduleMode: "interval" | "cron";
  intervalSec: number | null;
  cronExpr: string | null;
  lastRunAt: number | null;
  lastFinishedAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  scheduleLabel: string;
};

type AutonomousJobDbRow = {
  id: number;
  chat_id: string;
  user_id: string;
  prompt: string;
  enabled: number;
  schedule_mode: "interval" | "cron";
  interval_sec: number | null;
  cron_expr: string | null;
  last_run_at: number | null;
  last_finished_at: number | null;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function toUnixAnchor(createdAt: string, lastFinishedAt: number | null): number {
  return lastFinishedAt ?? Math.floor(new Date(createdAt).getTime() / 1000);
}

function toSchedule(row: Pick<AutonomousJobDbRow, "schedule_mode" | "interval_sec" | "cron_expr" | "last_finished_at">) {
  return normalizeSchedule({
    scheduleMode: row.schedule_mode,
    intervalSec: row.interval_sec,
    cronExpr: row.cron_expr,
    lastFinishedAt: row.last_finished_at,
  });
}

function mapRow(row: AutonomousJobDbRow): AutonomousJobRow {
  const schedule = toSchedule(row);
  return {
    id: row.id,
    chatId: row.chat_id,
    userId: row.user_id,
    prompt: row.prompt,
    enabled: row.enabled === 1,
    scheduleMode: schedule.scheduleMode,
    intervalSec: schedule.intervalSec,
    cronExpr: schedule.cronExpr,
    lastRunAt: row.last_run_at,
    lastFinishedAt: row.last_finished_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    scheduleLabel: describeSchedule(schedule),
  };
}

export class AutonomousJobService {
  constructor(private readonly db: Database) {}

  createJob(input: { chatId: string; userId: string; prompt: string; schedule: ScheduleInput }): AutonomousJobRow {
    const schedule = normalizeSchedule(input.schedule);
    const now = nowIso();
    const result = this.db
      .query(
        `INSERT INTO autonomous_jobs (
          chat_id,
          user_id,
          prompt,
          schedule_mode,
          interval_sec,
          cron_expr,
          enabled,
          last_run_at,
          last_finished_at,
          last_status,
          last_error,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, NULL, NULL, NULL, NULL, ?, ?)`,
      )
      .run(input.chatId, input.userId, input.prompt, schedule.scheduleMode, schedule.intervalSec, schedule.cronExpr, now, now);

    const job = this.getJobById(Number(result.lastInsertRowid));
    if (!job) throw new Error("Failed to load created autonomous job");
    return job;
  }

  getJobById(id: number): AutonomousJobRow | null {
    const row = this.db
      .query(
        `SELECT
          id,
          chat_id,
          user_id,
          prompt,
          enabled,
          schedule_mode,
          interval_sec,
          cron_expr,
          last_run_at,
          last_finished_at,
          last_status,
          last_error,
          created_at,
          updated_at
         FROM autonomous_jobs
         WHERE id = ?`,
      )
      .get(id) as AutonomousJobDbRow | undefined;

    return row ? mapRow(row) : null;
  }

  getJobByChat(chatId: string, id: number): AutonomousJobRow | null {
    const row = this.db
      .query(
        `SELECT
          id,
          chat_id,
          user_id,
          prompt,
          enabled,
          schedule_mode,
          interval_sec,
          cron_expr,
          last_run_at,
          last_finished_at,
          last_status,
          last_error,
          created_at,
          updated_at
         FROM autonomous_jobs
         WHERE chat_id = ? AND id = ?`,
      )
      .get(chatId, id) as AutonomousJobDbRow | undefined;

    return row ? mapRow(row) : null;
  }

  listJobsForChat(chatId: string): AutonomousJobRow[] {
    const rows = this.db
      .query(
        `SELECT
          id,
          chat_id,
          user_id,
          prompt,
          enabled,
          schedule_mode,
          interval_sec,
          cron_expr,
          last_run_at,
          last_finished_at,
          last_status,
          last_error,
          created_at,
          updated_at
         FROM autonomous_jobs
         WHERE chat_id = ?
         ORDER BY id DESC`,
      )
      .all(chatId) as AutonomousJobDbRow[];

    return rows.map(mapRow);
  }

  updatePrompt(id: number, prompt: string): AutonomousJobRow {
    this.db.query(`UPDATE autonomous_jobs SET prompt = ?, updated_at = ? WHERE id = ?`).run(prompt, nowIso(), id);
    const job = this.getJobById(id);
    if (!job) throw new Error(`Autonomous job not found: ${id}`);
    return job;
  }

  updateSchedule(id: number, scheduleInput: ScheduleInput): AutonomousJobRow {
    const schedule = normalizeSchedule(scheduleInput);
    this.db
      .query(`UPDATE autonomous_jobs SET schedule_mode = ?, interval_sec = ?, cron_expr = ?, updated_at = ? WHERE id = ?`)
      .run(schedule.scheduleMode, schedule.intervalSec, schedule.cronExpr, nowIso(), id);
    const job = this.getJobById(id);
    if (!job) throw new Error(`Autonomous job not found: ${id}`);
    return job;
  }

  setEnabled(id: number, enabled: boolean): AutonomousJobRow {
    this.db.query(`UPDATE autonomous_jobs SET enabled = ?, updated_at = ? WHERE id = ?`).run(enabled ? 1 : 0, nowIso(), id);
    const job = this.getJobById(id);
    if (!job) throw new Error(`Autonomous job not found: ${id}`);
    return job;
  }

  deleteJob(id: number): boolean {
    const result = this.db.query(`DELETE FROM autonomous_jobs WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  listDueJobs(nowUnix: number, limit: number): AutonomousJobRow[] {
    if (limit <= 0) return [];

    const rows = this.db
      .query(
        `SELECT
          id,
          chat_id,
          user_id,
          prompt,
          enabled,
          schedule_mode,
          interval_sec,
          cron_expr,
          last_run_at,
          last_finished_at,
          last_status,
          last_error,
          created_at,
          updated_at
         FROM autonomous_jobs
         WHERE enabled = 1
         ORDER BY id ASC`,
      )
      .all() as AutonomousJobDbRow[];

    const dueJobs: AutonomousJobRow[] = [];
    for (const row of rows) {
      const job = mapRow(row);
      const schedule = normalizeSchedule({
        scheduleMode: job.scheduleMode,
        intervalSec: job.intervalSec,
        cronExpr: job.cronExpr,
        lastFinishedAt: job.lastFinishedAt,
      });
      const anchor = toUnixAnchor(job.createdAt, job.lastFinishedAt);
      if (isScheduleDue(schedule, anchor, nowUnix)) {
        dueJobs.push(job);
      }
      if (dueJobs.length >= limit) break;
    }

    return dueJobs;
  }

  markRunStarted(id: number, nowUnix: number): AutonomousJobRow {
    this.db
      .query(`UPDATE autonomous_jobs SET last_run_at = ?, last_status = ?, last_error = NULL, updated_at = ? WHERE id = ?`)
      .run(nowUnix, "running", nowIso(), id);
    const job = this.getJobById(id);
    if (!job) throw new Error(`Autonomous job not found: ${id}`);
    return job;
  }

  markRunFinished(id: number, nowUnix: number, status: string, error: string | null): AutonomousJobRow {
    this.db
      .query(`UPDATE autonomous_jobs SET last_finished_at = ?, last_status = ?, last_error = ?, updated_at = ? WHERE id = ?`)
      .run(nowUnix, status, error, nowIso(), id);
    const job = this.getJobById(id);
    if (!job) throw new Error(`Autonomous job not found: ${id}`);
    return job;
  }
}
