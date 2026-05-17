import type { Database } from "bun:sqlite";
import { describeSchedule, isScheduleDue, normalizeSchedule, type ScheduleInput } from "./schedules";
import { nowIso } from "../utils/time";

export type MemoryUpdateSettingsRow = {
  userId: string;
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

type MemoryUpdateSettingsDbRow = {
  user_id: string;
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

function mapRow(row: MemoryUpdateSettingsDbRow): MemoryUpdateSettingsRow {
  const schedule = normalizeSchedule({
    scheduleMode: row.schedule_mode,
    intervalSec: row.interval_sec,
    cronExpr: row.cron_expr,
    lastFinishedAt: row.last_finished_at,
  });

  return {
    userId: row.user_id,
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

export class MemoryUpdateSettingsService {
  constructor(private readonly db: Database) {}

  getOrCreate(userId: string): MemoryUpdateSettingsRow {
    const existing = this.getByUserId(userId);
    if (existing) return existing;

    const now = nowIso();
    this.db
      .query(
        `INSERT INTO memory_update_settings (
          user_id,
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
        ) VALUES (?, 1, 'interval', 86400, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
      )
      .run(userId, now, now);

    const created = this.getByUserId(userId);
    if (!created) throw new Error(`Failed to create memory update settings for ${userId}`);
    return created;
  }

  updateSchedule(userId: string, scheduleInput: ScheduleInput): MemoryUpdateSettingsRow {
    const schedule = normalizeSchedule(scheduleInput);
    const existing = this.getOrCreate(userId);
    this.db
      .query(`UPDATE memory_update_settings SET schedule_mode = ?, interval_sec = ?, cron_expr = ?, updated_at = ? WHERE user_id = ?`)
      .run(schedule.scheduleMode, schedule.intervalSec, schedule.cronExpr, nowIso(), userId);
    return this.getByUserId(userId) ?? existing;
  }

  setEnabled(userId: string, enabled: boolean): MemoryUpdateSettingsRow {
    this.getOrCreate(userId);
    this.db.query(`UPDATE memory_update_settings SET enabled = ?, updated_at = ? WHERE user_id = ?`).run(enabled ? 1 : 0, nowIso(), userId);
    const row = this.getByUserId(userId);
    if (!row) throw new Error(`Memory update settings not found for ${userId}`);
    return row;
  }

  listDueUsers(nowUnix: number, limit: number): string[] {
    if (limit <= 0) return [];

    const rows = this.db
      .query(
        `SELECT
          user_id,
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
         FROM memory_update_settings
         WHERE enabled = 1
         ORDER BY created_at ASC`,
      )
      .all() as MemoryUpdateSettingsDbRow[];

    const dueUsers: string[] = [];
    for (const row of rows) {
      const setting = mapRow(row);
      const schedule = normalizeSchedule({
        scheduleMode: setting.scheduleMode,
        intervalSec: setting.intervalSec,
        cronExpr: setting.cronExpr,
        lastFinishedAt: setting.lastFinishedAt,
      });
      const anchor = toUnixAnchor(setting.createdAt, setting.lastFinishedAt);
      if (isScheduleDue(schedule, anchor, nowUnix)) {
        dueUsers.push(setting.userId);
      }
      if (dueUsers.length >= limit) break;
    }

    return dueUsers;
  }

  markRunStarted(userId: string, nowUnix: number): MemoryUpdateSettingsRow {
    this.getOrCreate(userId);
    this.db
      .query(`UPDATE memory_update_settings SET last_run_at = ?, last_status = ?, last_error = NULL, updated_at = ? WHERE user_id = ?`)
      .run(nowUnix, "running", nowIso(), userId);
    const row = this.getByUserId(userId);
    if (!row) throw new Error(`Memory update settings not found for ${userId}`);
    return row;
  }

  markRunFinished(userId: string, nowUnix: number, status: string, error: string | null): MemoryUpdateSettingsRow {
    this.getOrCreate(userId);
    this.db
      .query(`UPDATE memory_update_settings SET last_finished_at = ?, last_status = ?, last_error = ?, updated_at = ? WHERE user_id = ?`)
      .run(nowUnix, status, error, nowIso(), userId);
    const row = this.getByUserId(userId);
    if (!row) throw new Error(`Memory update settings not found for ${userId}`);
    return row;
  }

  renderSummary(setting: MemoryUpdateSettingsRow): string {
    const statusLine = setting.lastStatus ? `${setting.lastStatus}${setting.lastError ? `: ${setting.lastError}` : ""}` : "never run";
    return [
      `Memory update settings for ${setting.userId}`,
      `Enabled: ${setting.enabled ? "yes" : "no"}`,
      `Schedule: ${setting.scheduleLabel}`,
      `Last run: ${statusLine}`,
    ].join("\n");
  }

  private getByUserId(userId: string): MemoryUpdateSettingsRow | null {
    const row = this.db
      .query(
        `SELECT
          user_id,
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
         FROM memory_update_settings
         WHERE user_id = ?`,
      )
      .get(userId) as MemoryUpdateSettingsDbRow | undefined;

    return row ? mapRow(row) : null;
  }
}
