import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { migrate } from "../../src/db/schema";
import { MemoryUpdateSettingsService } from "../../src/services/memory-update-settings";

function makeService() {
  const db = new Database(":memory:");
  migrate(db);
  return { db, service: new MemoryUpdateSettingsService(db) };
}

test("memory update settings default to enabled every 6 hours", () => {
  const { service } = makeService();

  const setting = service.getOrCreate("user-1");

  expect(setting.enabled).toBe(true);
  expect(setting.scheduleMode).toBe("interval");
  expect(setting.intervalSec).toBe(21600);
  expect(setting.cronExpr).toBeNull();
  expect(setting.scheduleLabel).toBe("Every 6 hours");
  expect(service.renderSummary(setting)).toContain("Every 6 hours");
});

test("memory update settings accept custom cron schedules after default creation", () => {
  const { service } = makeService();

  service.getOrCreate("user-1");
  const updated = service.updateSchedule("user-1", { scheduleMode: "cron", cronExpr: "0 9 * * *" });

  expect(updated.scheduleMode).toBe("cron");
  expect(updated.intervalSec).toBeNull();
  expect(updated.cronExpr).toBe("0 9 * * *");
  expect(updated.scheduleLabel).toBe("Cron: 0 9 * * *");
  expect(service.getOrCreate("user-1").cronExpr).toBe("0 9 * * *");
});

test("memory update settings reject one-shot schedules", () => {
  const { service } = makeService();
  const existing = service.getOrCreate("user-1");

  expect(() => service.updateSchedule("user-1", { scheduleMode: "once", runAtUnix: 1_779_085_800 } as any)).toThrow(
    "Memory update schedules only support interval and cron modes",
  );
  expect(service.getOrCreate("user-1").scheduleMode).toBe(existing.scheduleMode);
});

test("lists due memory update settings using the first completed run anchor", () => {
  const { db, service } = makeService();

  service.getOrCreate("user-1");
  db.query(`UPDATE memory_update_settings SET created_at = ?, interval_sec = ? WHERE user_id = ?`).run(
    "2026-05-17T10:00:00.000Z",
    3600,
    "user-1",
  );

  expect(service.listDueUsers(Math.floor(Date.UTC(2026, 4, 17, 11, 10, 0) / 1000), 10)).toEqual(["user-1"]);

  service.markRunFinished("user-1", Math.floor(Date.UTC(2026, 4, 17, 11, 20, 0) / 1000), "success", null);
  expect(service.listDueUsers(Math.floor(Date.UTC(2026, 4, 17, 11, 30, 0) / 1000), 10)).toEqual([]);
});

test("does not return due memory update settings when limit is zero", () => {
  const { service } = makeService();

  service.getOrCreate("user-1");

  expect(service.listDueUsers(Math.floor(Date.UTC(2026, 4, 17, 11, 25, 0) / 1000), 0)).toEqual([]);
});
