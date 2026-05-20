# Autonomous jobs

This document explains how scheduled autonomous work is represented, created, and executed.

Use `docs/architecture.md` for the top-level system map. This file owns the job model and scheduler-facing job behavior.

## Source of truth

The source of truth for autonomous job state is the per-job record stored in SQLite.

The scheduler tick is only the dispatch mechanism. It is not the user-visible schedule source of truth.

## Job model

An autonomous job stores:

- the chat and user it belongs to
- the persisted prompt fields
- the job type
- its schedule fields
- whether it is enabled
- lifecycle fields such as run count, max runs, last status, and last error

## Job types

- `agent` — runs an agent prompt without a fixed leading Telegram message
- `hybrid` — sends fixed text first, then runs an agent prompt

That distinction matters because not every stored job has the same prompt shape.

## Schedule model

Autonomous jobs support three schedule modes:

- `once`
- `interval`
- `cron`

For one-shot work, the service defaults `maxRuns` to `1` unless a different value is explicitly supplied.

## Creation paths

### Menu-created jobs

The Telegram Jobs menu creates stored jobs through the conversation-based job creation flow. Today that flow asks for one prompt and a repeating schedule, then stores the job as a plain prompt-driven job.

The current menu flow uses interval presets or a custom cron expression. It does not ask for a separate fixed `message_text` field.

### Tool-created hybrid jobs

`tdai_create_job` creates `hybrid` jobs. It stores `message_text`, stores the agent prompt separately, and documents that the fixed Telegram message is sent before the agent prompt runs.

This path also supports `once`, `interval`, and `cron` schedules through the tool schema.

## Runtime execution lifecycle

When a job is due, the runtime:

1. selects it from persisted job state
2. records the run start time and running status
3. sends the fixed Telegram text first when the job is `hybrid`
4. runs the autonomous agent prompt
5. sends the final autonomous reply back to Telegram
6. records completion status, timestamps, and any error text
7. deletes the job if its max-runs limit has been exhausted

## Scheduler interaction and capacity sharing

The unified scheduler runs due autonomous jobs first.

After autonomous jobs consume part of the tick budget, the scheduler can spend the remaining capacity on due Memory Update users. This means autonomous job throughput and Memory Update throughput share the same per-tick dispatch budget.

## Relevant code

- `src/services/autonomous-jobs.ts`
- `src/services/schedules.ts`
- `src/cron/scheduler.ts`
- `src/cron/autonomous.ts`
- `src/tools/local.ts`
- `src/bot/conversations/job-create.ts`
- `src/bot/conversations/job-detail.ts`

## Related docs

- `docs/architecture.md`
- `docs/telegram-flow.md`
