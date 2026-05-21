# Memory Update default 6h design

## Summary

Change the default Memory Update cadence for newly created per-user settings rows from 24 hours to 6 hours.

This change does not modify existing user schedules, does not change the global scheduler tick, and does not change the L0 → L1 → L2 → L3 pipeline behavior.

## Decision

Approved behavior:

- New `memory_update_settings` rows default to `interval` mode with `21600` seconds.
- Existing `memory_update_settings` rows keep their current values.
- Telegram users must still be able to change the schedule to any supported preset or custom cron after the default is created.
- The scheduler continues polling on its existing tick and respects per-user stored schedules.

## Scope

### In scope

- Update the inserted default interval for `MemoryUpdateSettingsService.getOrCreate(...)`.
- Keep the Telegram Memory Update menu behavior unchanged.
- Update tests that currently assert the 24-hour default.

### Out of scope

- Migrating or overwriting existing user settings.
- Adding snapshot/diff logic for skipping L2/L3 updates.
- Changing scheduler tick cadence.
- Changing pipeline semantics or memory layer meanings.

## Design

### 1. Default settings row

Update the default row created by `MemoryUpdateSettingsService.getOrCreate(...)` so newly created settings use a 6-hour interval instead of a 24-hour interval.

Expected result:

- `enabled = true`
- `schedule_mode = 'interval'`
- `interval_sec = 21600`
- `cron_expr = NULL`

### 2. Existing user preservation

Do not add a migration and do not normalize stored rows at startup.

Reasoning:

- The user explicitly wants older settings to keep working as-is.
- A one-line default change is lower risk than a data rewrite.
- Telegram already exposes a schedule editor for users who want to switch manually.

### 3. Telegram schedule editing remains authoritative

The Memory Update Telegram flow already supports:

- 10m
- 30m
- 1h
- 6h
- 12h
- 24h
- custom cron

This flow remains unchanged. The default only affects the first row creation path.

### 4. Scheduler boundary

The global scheduler tick is separate from the per-user Memory Update cadence.

- Global tick: frequent polling loop that checks due work.
- Per-user cadence: stored in `memory_update_settings` and used by `listDueUsers(...)`.

No scheduler tick changes are required for this design.

## Verification

Update focused tests so they prove:

1. new settings default to enabled every 6 hours
2. summary rendering reports `Every 6 hours`
3. custom cron editing still works after row creation
4. due-user calculations still respect stored intervals

## Risks

Low risk.

Primary risk is only that tests or text assertions still mention 24 hours after the default changes.

## Provenance

### User-approved design decisions

- Conversation decision on 2026-05-20: change only the default for newly created settings rows to 6 hours.
- Conversation decision on 2026-05-20: existing user schedules must remain unchanged.
- Conversation decision on 2026-05-20: Telegram users must still be able to switch to other presets or custom cron.

### Source files reviewed

- `src/services/memory-update-settings.ts`
  - Current default row creation lives here.
  - This is the only required behavior change.
- `tests/services/memory-update-settings.test.ts`
  - Current assertions lock in the 24-hour default and should be updated.
- `src/bot/conversations/memory-update.ts`
  - Confirms Telegram users can still switch to 10m/30m/1h/6h/12h/24h/custom cron.
- `src/bot/ui/keyboards.ts`
  - Confirms the Memory Update UI exposes the schedule presets and entry path.
- `src/config.ts`
  - Confirms `MEMORY_MAINTENANCE_CRON` is a global polling tick, not the user cadence setting.
- `docs/memory.md`
  - Confirms Memory Update is a Telegram-managed per-user scheduling feature.

## Implementation note

No data migration is needed for this design.