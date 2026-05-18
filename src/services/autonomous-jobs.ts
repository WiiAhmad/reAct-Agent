import type { Database } from "bun:sqlite";
import { describeSchedule, isScheduleDue, normalizeSchedule, type ScheduleInput, type ScheduleMode } from "./schedules";
import { nowIso } from "../utils/time";

export type AutonomousJobType = "agent" | "hybrid";

export type AutonomousJobRow = {
  id: number;
  chatId: string;
  userId: string;
  prompt: string;
  jobType: AutonomousJobType;
  messageText: string;
  agentPrompt: string;
  runAtUnix: number | null;
  runCount: number;
  maxRuns: number | null;
  enabled: boolean;
  scheduleMode: ScheduleMode;
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
  job_type: AutonomousJobType;
  message_text: string;
  agent_prompt: string;
  run_at_unix: number | null;
  run_count: number;
  max_runs: number | null;
  enabled: number;
  schedule_mode: ScheduleMode;
  interval_sec: number | null;
  cron_expr: string | null;
  last_run_at: number | null;
  last_finished_at: number | null;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateAutonomousJobInput = {
  chatId: string;
  userId: string;
  prompt: string;
  jobType?: AutonomousJobType;
  messageText?: string;
  agentPrompt?: string;
  schedule: ScheduleInput;
  maxRuns?: number | null;
};

const AUTONOMOUS_JOB_COLUMNS = `
          id,
          chat_id,
          user_id,
          prompt,
          job_type,
          message_text,
          agent_prompt,
          run_at_unix,
          run_count,
          max_runs,
          enabled,
          schedule_mode,
          interval_sec,
          cron_expr,
          last_run_at,
          last_finished_at,
          last_status,
          last_error,
          created_at,
          updated_at`;

function toUnixAnchor(createdAt: string, lastFinishedAt: number | null): number {
  return lastFinishedAt ?? Math.floor(new Date(createdAt).getTime() / 1000);
}

function toSchedule(row: Pick<AutonomousJobDbRow, "schedule_mode" | "run_at_unix" | "interval_sec" | "cron_expr" | "last_finished_at">) {
  return normalizeSchedule({
    scheduleMode: row.schedule_mode,
    runAtUnix: row.run_at_unix,
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
    jobType: row.job_type,
    messageText: row.message_text,
    agentPrompt: row.agent_prompt,
    runAtUnix: schedule.runAtUnix,
    runCount: row.run_count,
    maxRuns: row.max_runs,
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

  createJob(input: CreateAutonomousJobInput): AutonomousJobRow {
    const schedule = normalizeSchedule(input.schedule);
    const maxRuns = input.maxRuns ?? (schedule.scheduleMode === "once" ? 1 : null);
    const now = nowIso();
    const result = this.db
      .query(
        `INSERT INTO autonomous_jobs (
          chat_id,
          user_id,
          prompt,
          job_type,
          message_text,
          agent_prompt,
          run_at_unix,
          run_count,
          max_runs,
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 1, NULL, NULL, NULL, NULL, ?, ?)`,
      )
      .run(
        input.chatId,
        input.userId,
        input.prompt,
        input.jobType ?? "agent",
        input.messageText ?? "",
        input.agentPrompt ?? "",
        schedule.runAtUnix,
        maxRuns,
        schedule.scheduleMode,
        schedule.intervalSec,
        schedule.cronExpr,
        now,
        now,
      );

    const job = this.getJobById(Number(result.lastInsertRowid));
    if (!job) throw new Error("Failed to load created autonomous job");
    return job;
  }

  getJobById(id: number): AutonomousJobRow | null {
    const row = this.db
      .query(
        `SELECT${AUTONOMOUS_JOB_COLUMNS}
         FROM autonomous_jobs
         WHERE id = ?`,
      )
      .get(id) as AutonomousJobDbRow | undefined;

    return row ? mapRow(row) : null;
  }

  getJobByChat(chatId: string, id: number): AutonomousJobRow | null {
    const row = this.db
      .query(
        `SELECT${AUTONOMOUS_JOB_COLUMNS}
         FROM autonomous_jobs
         WHERE chat_id = ? AND id = ?`,
      )
      .get(chatId, id) as AutonomousJobDbRow | undefined;

    return row ? mapRow(row) : null;
  }

  listJobsForChat(chatId: string): AutonomousJobRow[] {
    const rows = this.db
      .query(
        `SELECT${AUTONOMOUS_JOB_COLUMNS}
         FROM autonomous_jobs
         WHERE chat_id = ?
         ORDER BY id DESC`,
      )
      .all(chatId) as AutonomousJobDbRow[];

    return rows.map(mapRow);
  }

  updatePrompt(id: number, prompt: string): AutonomousJobRow {
    this.db
      .query(`UPDATE autonomous_jobs SET prompt = ?, agent_prompt = CASE WHEN job_type = 'hybrid' THEN ? ELSE agent_prompt END, updated_at = ? WHERE id = ?`)
      .run(prompt, prompt, nowIso(), id);
    const job = this.getJobById(id);
    if (!job) throw new Error(`Autonomous job not found: ${id}`);
    return job;
  }

  updateSchedule(id: number, scheduleInput: ScheduleInput): AutonomousJobRow {
    const schedule = normalizeSchedule(scheduleInput);
    if (schedule.scheduleMode === "once") {
      this.db
        .query(`UPDATE autonomous_jobs SET schedule_mode = ?, run_at_unix = ?, interval_sec = ?, cron_expr = ?, max_runs = COALESCE(max_runs, 1), updated_at = ? WHERE id = ?`)
        .run(schedule.scheduleMode, schedule.runAtUnix, schedule.intervalSec, schedule.cronExpr, nowIso(), id);
    } else {
      this.db
        .query(`UPDATE autonomous_jobs SET schedule_mode = ?, run_at_unix = ?, interval_sec = ?, cron_expr = ?, updated_at = ? WHERE id = ?`)
        .run(schedule.scheduleMode, schedule.runAtUnix, schedule.intervalSec, schedule.cronExpr, nowIso(), id);
    }
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

  recordSuccessfulRun(id: number): { deleted: boolean; job: AutonomousJobRow | null; runCount: number } {
    const job = this.getJobById(id);
    if (!job) throw new Error(`Autonomous job not found: ${id}`);

    const nextRunCount = job.runCount + 1;
    if (job.maxRuns !== null && nextRunCount >= job.maxRuns) {
      this.deleteJob(id);
      return { deleted: true, job: null, runCount: nextRunCount };
    }

    this.db.query(`UPDATE autonomous_jobs SET run_count = ?, updated_at = ? WHERE id = ?`).run(nextRunCount, nowIso(), id);
    const updatedJob = this.getJobById(id);
    if (!updatedJob) throw new Error(`Autonomous job not found: ${id}`);
    return { deleted: false, job: updatedJob, runCount: nextRunCount };
  }

  listDueJobs(nowUnix: number, limit: number): AutonomousJobRow[] {
    if (limit <= 0) return [];

    const rows = this.db
      .query(
        `SELECT${AUTONOMOUS_JOB_COLUMNS}
         FROM autonomous_jobs
         WHERE enabled = 1
         ORDER BY id ASC`,
      )
      .all() as AutonomousJobDbRow[];

    const dueJobs: AutonomousJobRow[] = [];
    for (const row of rows) {
      const job = mapRow(row);
      if (job.maxRuns !== null && job.runCount >= job.maxRuns) {
        continue;
      }
      const schedule = normalizeSchedule({
        scheduleMode: job.scheduleMode,
        runAtUnix: job.runAtUnix,
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
