export type CurrentDateTimeSnapshot = {
  iso_timestamp: string;
  unix_timestamp: number;
  readable_local_datetime: string;
  timezone: string;
  offset_minutes: number;
};

export function currentDateTimeSnapshot(date = new Date()): CurrentDateTimeSnapshot {
  const offsetMinutes = -date.getTimezoneOffset();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  return {
    iso_timestamp: date.toISOString(),
    unix_timestamp: Math.floor(date.getTime() / 1000),
    readable_local_datetime: date.toLocaleString(),
    timezone,
    offset_minutes: offsetMinutes,
  };
}

export function nowIso(): string {
  return currentDateTimeSnapshot().iso_timestamp;
}

export function unixNow(): number {
  return currentDateTimeSnapshot().unix_timestamp;
}
