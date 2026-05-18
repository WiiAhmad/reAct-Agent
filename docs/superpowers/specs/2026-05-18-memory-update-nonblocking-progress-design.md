# Memory Update non-blocking progress design

## Purpose

Fix the Telegram Memory Update flow so a long memory maintenance run does not make the bot look frozen, and add clear runtime observability for each pipeline stage.

The current issue is that Telegram `Run now` awaits the full memory maintenance pipeline inside a grammY conversation handler. With `bot.start()` long polling, updates are processed sequentially, so later Telegram updates wait behind that long handler. Cron logs can still print while the bot appears unresponsive, which makes the issue look like an async/node-cron problem even though the main blocker is the awaited Telegram handler.

## Scope

Implement a focused fix for Memory Update execution and logs:

- Make Telegram `Run now` start maintenance in the background instead of awaiting the full pipeline in the callback handler.
- Send Telegram progress as separate messages for the manual run path.
- Add structured console logs for Memory Update run lifecycle and L1/L2/L3 stages.
- Keep scheduler behavior functionally the same, but give scheduled runs the same structured logs.
- Prevent duplicate manual Memory Update runs for the same user while one is already active.

Do not change the memory model semantics. L0 conversations, L1 atoms, L2 scenarios, L3 persona, offload refs, and Mermaid canvas keep their existing meaning.

## Current code baseline (2026-05-18)

At the time this design is written, the repository still uses the blocking path:

- `src/memory/pipeline/coordinator.ts` exposes `runMaintenanceForUser(userId, force = false)` and emits no progress events.
- `src/memory/core/service.ts` forwards only `(userId, force)` to the pipeline coordinator.
- `src/cron/autonomous.ts` `runOneMemoryUpdateNow` marks settings and awaits `memory.runMaintenanceForUser(userId, true)` without `[memory-update:*]` lifecycle logs.
- `src/bot/conversations/memory-update.ts` awaits `runOneMemoryUpdateNow` inside `conversation.external` for `memory-update:run-now`.
- `src/memory/pipeline/progress.ts`, `src/bot/conversations/memory-update-runner.ts`, and `tests/bot/memory-update-runner.test.ts` do not exist yet.

## Non-goals

- Do not introduce a full durable job queue.
- Do not change public Telegram commands.
- Do not switch the bot from long polling to webhooks.
- Do not redesign the scheduler.
- Do not alter L1/L2/L3 prompt behavior except to report stage progress.

## Recommended approach

Use a lightweight background execution path for manual Telegram Memory Update runs, with a shared progress-reporting interface used by both Telegram and scheduler calls.

This solves the visible freeze because the Telegram callback handler returns quickly after acknowledging the button and sending a start message. The long LLM-backed maintenance pipeline continues in a background promise with explicit error handling. The scheduler can continue to await scheduled maintenance so capacity and `busy` semantics remain unchanged.

## Components

### Progress event model

Add a small progress event type for memory maintenance lifecycle events. It should include:

- `stage`: `run`, `l1`, `l2`, or `l3`
- `status`: `start`, `complete`, `skip`, or `error`
- `source`: `telegram` or `scheduler`
- `userId`
- optional details such as created atom count, scenario id, persona status, error message, and duration

This interface should be internal and minimal. It exists to support logging and Telegram progress messages, not to redefine the memory pipeline.

### Pipeline coordinator

Extend `PipelineCoordinator.runMaintenanceForUser(userId, force, options?)` so it can emit progress events around each stage:

1. Resolve the L1 checkpoint and pending conversation evidence.
2. Emit L1 skip when there is no pending non-forced work, otherwise emit L1 start with the pending turn count before running the L1 extractor.
3. Emit L1 complete with created atom count and checkpoint information.
4. If no further work is needed, emit L2/L3 skip where appropriate and return.
5. Emit L2 start before building a scenario.
6. Emit L2 complete with scenario id, or L2 skip if there are no atoms.
7. Emit L3 start before persona distillation.
8. Emit L3 complete with persona update result.

The pipeline should still return the existing `PipelineMaintenanceResult` shape.

### Memory Update runner

Extend `runOneMemoryUpdateNow()` with optional metadata:

- `source`: default to `scheduler` unless the caller passes `telegram`
- `onProgress`: optional async callback

The runner should:

1. Mark the user run as `running`.
2. Log `run-start`.
3. Call `memory.runMaintenanceForUser(userId, true, { source, onProgress })` through the service-level API.
4. Mark the user run as `success` and log `run-complete` on success.
5. Mark the user run as `error`, log `run-error`, and rethrow on failure.

### Telegram manual run path

For the `memory-update:run-now` callback:

1. Answer the callback query immediately.
2. If a run is already active for that user in this process, send `Memory update masih berjalan untuk user ini.` and do not start another run.
3. Send `Memory update dimulai...` as a normal Telegram message.
4. Start the maintenance run in a background promise and return control to the conversation loop quickly.
5. For each progress event, send a new Telegram message:
   - `L1 dimulai...`
   - `L1 selesai: X atom dibuat.`
   - `L2 dimulai...`
   - `L2 selesai: scenario #N.`
   - `L2 dilewati: tidak ada atom.`
   - `L3 dimulai...`
   - `L3 selesai: persona updated.`
   - `L3 dilewati.`
6. On final success, send `Memory update selesai. L1=...` with the L1/L2/L3 summary.
7. On failure, send `Memory update gagal: <error>`.
8. Always clear the active-run guard in `finally`.

The conversation screen can still refresh to show `Last status: running` shortly after starting. It should not wait for pipeline completion before accepting more Telegram updates.

### Scheduler path

The scheduler should keep awaiting scheduled memory updates so `maxItemsPerTick` and `busy` behavior stay predictable.

The existing `src/cron/scheduler.ts` dispatch contract can keep passing only `{ userId, nowUnix }`; `runOneMemoryUpdateNow()` should default `source` to `"scheduler"` and use the same structured progress logging. Scheduled runs do not need Telegram progress messages.

## Logging

Add console logs with stable prefixes:

- `[memory-update:run-start]`
- `[memory-update:l1-start]`
- `[memory-update:l1-complete]`
- `[memory-update:l1-skip]`
- `[memory-update:l2-start]`
- `[memory-update:l2-complete]`
- `[memory-update:l2-skip]`
- `[memory-update:l3-start]`
- `[memory-update:l3-complete]`
- `[memory-update:l3-skip]`
- `[memory-update:run-complete]`
- `[memory-update:run-error]`
- `[memory-update:run-skip]` for duplicate manual runs

Each log should include at least `source`, `userId`, and timestamp/duration details where available. Errors should include a normalized message.

Cron logs such as `[cron:scheduler-tick]` remain separate. The important fix is that scheduled logging and manual progress logging do not require the Telegram callback handler to stay blocked.

## Expected runtime behavior

After the fix:

- A node-cron scheduler tick may still log every minute.
- A scheduled memory update may still take time while it awaits LLM-backed pipeline work.
- A manual Telegram `Run now` no longer blocks the Telegram update handler until L1/L2/L3 finish.
- The bot should keep responding to new Telegram updates after the `Run now` handler has acknowledged and spawned the background task.
- If the process itself is CPU-starved or blocked by synchronous work, responsiveness can still degrade, but this design removes the current awaited-handler bottleneck.

## Error handling

Background execution must catch all errors so there are no unhandled promise rejections.

On error:

- Update memory update settings with `last_status = "error"` and `last_error`.
- Log `[memory-update:run-error]`.
- Send a Telegram failure message for manual runs.
- Clear the per-user active-run guard.

## Testing

Add or update tests for:

1. Pipeline progress event order across L1, L2, and L3.
2. L2/L3 skip progress when there is no downstream work.
3. `runOneMemoryUpdateNow()` success and error lifecycle logging/progress behavior.
4. Telegram manual run starts background execution without awaiting pipeline completion.
5. Duplicate manual run guard prevents a second active run for the same user.
6. Existing scheduler tests still pass.
7. Full typecheck passes.

## Acceptance criteria

- Pressing Telegram `Run now` produces immediate Telegram feedback.
- Telegram receives separate progress messages through L1, L2, and L3.
- Console logs show Memory Update run start, per-stage progress, completion, and errors.
- `Run now` does not make the bot wait for the entire pipeline before handling later Telegram updates.
- Scheduler behavior remains compatible with the existing unified scheduler.
- Tests and typecheck pass.
