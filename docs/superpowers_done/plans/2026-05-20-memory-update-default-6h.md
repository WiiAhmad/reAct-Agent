# Memory Update Default 6h Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change newly created Memory Update settings to default to a 6-hour cadence while preserving existing user schedules and keeping Telegram schedule editing unchanged.

**Architecture:** This is a narrow change in the per-user settings creation path. `MemoryUpdateSettingsService.getOrCreate(...)` should insert `21600` seconds for new rows, while all existing rows remain untouched; the scheduler tick and memory pipeline do not change. Verification stays focused on the service tests that lock in the default plus a small regression run over existing bot tests to ensure the Memory Update UI path still behaves normally.

**Tech Stack:** TypeScript, Bun, bun:test, SQLite (`bun:sqlite`)

---

## File structure

- Modify: `src/services/memory-update-settings.ts:65-90`
  - Owns the default `memory_update_settings` row creation path for new users.
- Modify: `tests/services/memory-update-settings.test.ts:12-29`
  - Locks in the default schedule label and verifies users can still switch to custom cron after creation.
- Read only: `src/services/schedules.ts:36-47`
  - Already formats `21600` as `Every 6 hours`; no code change needed.
- Regression only: `tests/bot/conversation-pass-through.test.ts:243-289`
  - Confirms `/menu` and the Memory Update schedule screen still route correctly through the bot middleware.
- Regression only: `tests/bot/memory-update-callback.test.ts:200-235`
  - Confirms the Memory Update conversation still renders and runs after service-level changes.

### Task 1: Lock in the new default with failing tests

**Files:**
- Modify: `tests/services/memory-update-settings.test.ts:12-29`
- Read: `src/services/schedules.ts:121-128`

- [ ] **Step 1: Rewrite the default-settings test to expect a 6-hour interval**

```ts
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
```

- [ ] **Step 2: Tighten the custom-cron test so it proves a user can override the default after row creation**

```ts
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
```

- [ ] **Step 3: Run the focused service test file to confirm it fails before implementation**

Run:

```bash
bun test tests/services/memory-update-settings.test.ts
```

Expected: FAIL in the renamed default-settings test because the implementation still returns `Every 24 hours` and `86400`.

### Task 2: Implement the minimal service change

**Files:**
- Modify: `src/services/memory-update-settings.ts:69-86`
- Test: `tests/services/memory-update-settings.test.ts`

- [ ] **Step 1: Change the inserted default interval from `86400` to `21600`**

```ts
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
      ) VALUES (?, 1, 'interval', 21600, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
    )
    .run(userId, now, now);

  const created = this.getByUserId(userId);
  if (!created) throw new Error(`Failed to create memory update settings for ${userId}`);
  return created;
}
```

- [ ] **Step 2: Re-run the focused service tests and verify they pass**

Run:

```bash
bun test tests/services/memory-update-settings.test.ts
```

Expected: PASS, including `Every 6 hours` and the custom-cron override test.

- [ ] **Step 3: Run bot-level regression tests for the Memory Update flow**

Run:

```bash
bun test tests/bot/conversation-pass-through.test.ts tests/bot/memory-update-callback.test.ts
```

Expected: PASS. The bot should still reach the Memory Update schedule screen and render the existing conversation callbacks normally.

- [ ] **Step 4: Commit the finished change**

```bash
git add src/services/memory-update-settings.ts tests/services/memory-update-settings.test.ts
git commit -m "$(cat <<'EOF'
feat: default memory updates to 6 hours

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

## Testing summary

Run these commands in order during execution:

```bash
bun test tests/services/memory-update-settings.test.ts
bun test tests/bot/conversation-pass-through.test.ts tests/bot/memory-update-callback.test.ts
```

Expected outcomes:

- new `memory_update_settings` rows report `Every 6 hours`
- existing tests for custom cron still pass
- Memory Update bot callbacks still route correctly

## References

- Spec: `docs/superpowers/specs/2026-05-20-memory-update-default-6h-design.md`
- Default row creation: `src/services/memory-update-settings.ts:65-90`
- Interval label formatting: `src/services/schedules.ts:121-128`
- Memory Update Telegram schedule flow: `src/bot/conversations/memory-update.ts:83-128`
- Memory Update menu entry points: `src/bot/ui/keyboards.ts:28-38`

## Self-review checklist

- Spec coverage: default changes only for new rows, existing schedules preserved, Telegram schedule editing unchanged, scheduler tick unchanged.
- Placeholder scan: no TODO/TBD markers; all code-change steps include concrete code and commands.
- Type consistency: `intervalSec`, `scheduleMode`, and `cronExpr` names match the current service and test APIs.