import { CronExpressionParser } from "cron-parser";
import { unixNow } from "../utils/time";

export type ScheduleMode = "interval" | "cron";

export type ScheduleInput = {
  scheduleMode: ScheduleMode;
  intervalSec?: number | null;
  cronExpr?: string | null;
  lastFinishedAt?: number | null;
};

export type Schedule = {
  scheduleMode: ScheduleMode;
  intervalSec: number | null;
  cronExpr: string | null;
  lastFinishedAt: number | null;
};

export type ScheduleAnchor = number | null | undefined;

export type ScheduleDueClock = {
  now?: number;
};

function assertPositiveInteger(value: number | null | undefined, fieldName: string): number {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return value as number;
}

function describeInterval(seconds: number): string {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

export function validateCronExpression(cronExpr: string): string {
  const normalized = cronExpr.trim();
  if (!normalized) {
    throw new Error("cronExpr is required");
  }

  try {
    CronExpressionParser.parse(normalized);
  } catch (error) {
    throw new Error(`Invalid cron expression: ${normalized}`);
  }

  return normalized;
}

export function normalizeSchedule(input: ScheduleInput): Schedule {
  if (input.scheduleMode === "interval") {
    return {
      scheduleMode: "interval",
      intervalSec: assertPositiveInteger(input.intervalSec ?? null, "intervalSec"),
      cronExpr: null,
      lastFinishedAt: input.lastFinishedAt ?? null,
    };
  }

  if (input.scheduleMode === "cron") {
    return {
      scheduleMode: "cron",
      intervalSec: null,
      cronExpr: validateCronExpression(input.cronExpr ?? ""),
      lastFinishedAt: input.lastFinishedAt ?? null,
    };
  }

  throw new Error(`Unsupported schedule mode: ${String(input.scheduleMode)}`);
}

export function getNextDueAtUnix(schedule: Schedule, anchorUnix: ScheduleAnchor = schedule.lastFinishedAt): number {
  const nowUnix = anchorUnix ?? unixNow();

  if (schedule.scheduleMode === "interval") {
    return anchorUnix == null ? nowUnix : anchorUnix + schedule.intervalSec!;
  }

  const currentDate = new Date(nowUnix * 1000);
  const parsed = CronExpressionParser.parse(schedule.cronExpr ?? "", { currentDate });
  const next = parsed.next() as { toDate?: () => Date; getTime?: () => number };
  const nextDate = typeof next.toDate === "function" ? next.toDate() : new Date(next.getTime?.() ?? currentDate.getTime());
  return Math.floor(nextDate.getTime() / 1000);
}

export function isScheduleDue(schedule: Schedule, anchorUnix: ScheduleAnchor = schedule.lastFinishedAt, nowUnix: number = unixNow()): boolean {
  return getNextDueAtUnix(schedule, anchorUnix) <= nowUnix;
}

export function describeSchedule(schedule: Schedule): string {
  if (schedule.scheduleMode === "interval") {
    return `Every ${describeInterval(schedule.intervalSec!)}`;
  }

  return `Cron: ${schedule.cronExpr}`;
}
