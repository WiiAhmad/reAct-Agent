export type CurrentDateTimeSnapshot = {
  iso_timestamp: string;
  unix_timestamp: number;
  readable_local_datetime: string;
  timezone: string;
  offset_minutes: number;
  locale: string;
  local_date: string;
  local_time: string;
  weekday_local: string;
  weekday_en: string;
  iso_weekday: number;
};

type DateTimeSnapshotOptions = {
  timezone?: string;
  locale?: string;
};

function formatParts(date: Date, timezone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function offsetMinutesFor(date: Date, timezone: string): number {
  const parts = formatParts(date, timezone);
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((localAsUtc - date.getTime()) / 60000);
}

function isoWeekday(date: Date, timezone: string): number {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(date);
  return { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7 }[weekday] ?? 1;
}

export function currentDateTimeSnapshot(date = new Date(), options: DateTimeSnapshotOptions = {}): CurrentDateTimeSnapshot {
  const timezone = options.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const locale = options.locale || Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
  const parts = formatParts(date, timezone);

  return {
    iso_timestamp: date.toISOString(),
    unix_timestamp: Math.floor(date.getTime() / 1000),
    readable_local_datetime: new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date),
    timezone,
    offset_minutes: offsetMinutesFor(date, timezone),
    locale,
    local_date: `${parts.year}-${parts.month}-${parts.day}`,
    local_time: `${parts.hour}:${parts.minute}:${parts.second}`,
    weekday_local: new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: "long" }).format(date),
    weekday_en: new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(date),
    iso_weekday: isoWeekday(date, timezone),
  };
}

export function nowIso(): string {
  return currentDateTimeSnapshot().iso_timestamp;
}

export function unixNow(): number {
  return currentDateTimeSnapshot().unix_timestamp;
}
