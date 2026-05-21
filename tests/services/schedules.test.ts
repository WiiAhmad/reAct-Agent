import { expect, test } from "bun:test";
import { config } from "../../src/config";
import {
  describeSchedule,
  normalizeSchedule,
  isScheduleDue,
  getNextDueAtUnix,
  validateCronExpression,
} from "../../src/services/schedules";

test("interval schedules are due when enough seconds have elapsed", () => {
  const schedule = normalizeSchedule({ scheduleMode: "interval", intervalSec: 600 });

  expect(isScheduleDue(schedule, 1_700_000_000, 1_700_000_599)).toBe(false);
  expect(isScheduleDue(schedule, 1_700_000_000, 1_700_000_600)).toBe(true);
});

test("cron schedules compute the next run time from the current timestamp", () => {
  const schedule = normalizeSchedule({ scheduleMode: "cron", cronExpr: "*/15 * * * *" });
  const anchorUnix = Math.floor(Date.UTC(2026, 0, 1, 12, 7, 0) / 1000);

  expect(getNextDueAtUnix(schedule, anchorUnix)).toBe(Math.floor(Date.UTC(2026, 0, 1, 12, 15, 0) / 1000));
});

test("cron schedules compute the next run time in APP_TIMEZONE", () => {
  const previousTimezone = config.app.timezone;
  const anchorUnix = Math.floor(Date.UTC(2026, 0, 1, 1, 30, 0) / 1000);

  try {
    config.app.timezone = "Asia/Jakarta";
    const jakartaSchedule = normalizeSchedule({ scheduleMode: "cron", cronExpr: "0 9 * * *" });
    const jakartaNextRun = getNextDueAtUnix(jakartaSchedule, anchorUnix);

    config.app.timezone = "UTC";
    const utcSchedule = normalizeSchedule({ scheduleMode: "cron", cronExpr: "0 9 * * *" });
    const utcNextRun = getNextDueAtUnix(utcSchedule, anchorUnix);

    expect(jakartaNextRun).toBe(Math.floor(Date.UTC(2026, 0, 1, 2, 0, 0) / 1000));
    expect(utcNextRun).toBe(Math.floor(Date.UTC(2026, 0, 1, 9, 0, 0) / 1000));
    expect(jakartaNextRun).not.toBe(utcNextRun);
  } finally {
    config.app.timezone = previousTimezone;
  }
});

test("validateCronExpression rejects invalid expressions", () => {
  expect(() => validateCronExpression("not a cron")).toThrow();
});

test("describeSchedule formats interval and cron schedules for the UI", () => {
  expect(describeSchedule(normalizeSchedule({ scheduleMode: "interval", intervalSec: 600 }))).toBe("Every 10 minutes");
  expect(describeSchedule(normalizeSchedule({ scheduleMode: "cron", cronExpr: "*/15 * * * *" }))).toBe("Cron: */15 * * * *");
});
