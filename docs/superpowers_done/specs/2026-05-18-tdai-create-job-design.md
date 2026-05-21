# tdai_create_job Hybrid Scheduled Jobs Design

## Goal

Add a model-callable local tool, `tdai_create_job`, so the Telegram agent can create scheduled reminder/jobs directly from natural-language chat without sending users through `/jobs` or the Jobs menu.

The tool creates hybrid scheduled jobs: when due, the scheduler sends a fixed Telegram text first, then runs an agent prompt and sends the agent response. Jobs can be one-shot or recurring. If the user does not specify a repeat count, the default is one run.

## Provenance

- Current tool surface: `src/tools/local.ts` exposes local tools such as `tdai_current_datetime` and `telegram_send_message` through `createLocalTools()`.
- Tool runtime context: `src/tools/types.ts` defines `ToolContext` with `chatId`, `userId`, memory, and optional Telegram API.
- Current job persistence: `src/services/autonomous-jobs.ts` owns `AutonomousJobService.createJob()` and reads from `autonomous_jobs`.
- Current job creation UI: `src/bot/conversations/job-create.ts` creates jobs through menu-driven Telegram conversations.
- Current scheduler execution: `src/cron/autonomous.ts` dispatches due jobs from the unified scheduler.
- Product context: `docs/autonomous-jobs.md` documents that Jobs are managed through menu flows, not public slash commands.

## Architecture

Extend the existing autonomous jobs system rather than adding a new slash command or separate scheduler. `tdai_create_job` will be registered as a local tool and will call `AutonomousJobService.createJob()` using the current chat/user context.

The `autonomous_jobs` table gains explicit hybrid execution fields:

- `message_text`: fixed Telegram text sent first when the job is due.
- `agent_prompt`: prompt passed to the agent after the fixed text is sent.
- `run_count`: number of completed executions.
- `max_runs`: maximum executions before deletion.
- `job_type`: distinguishes hybrid scheduled jobs from any legacy agent-only jobs if needed.
- `run_at_unix`: one-shot due timestamp for `schedule.mode = "once"`.

Due-job selection uses `run_at_unix` for one-shot jobs, and the existing interval/cron schedule logic for recurring jobs.

Due-job execution order:

1. Scheduler selects a due enabled job.
2. Bot sends `message_text` to the job chat.
3. Scheduler runs the agent with `agent_prompt`.
4. Bot sends the agent response.
5. Service increments `run_count`.
6. If `run_count >= max_runs`, the service deletes the job.

## Tool contract

`tdai_create_job` accepts:

```ts
{
  message_text: string,
  agent_prompt: string,
  schedule: {
    mode: "once" | "interval" | "cron",
    run_at?: string,
    interval_sec?: number,
    cron_expr?: string
  },
  max_runs?: number
}
```

Rules:

- `message_text` is required and must be non-empty.
- `agent_prompt` is required and must be non-empty, because all due jobs run as text-then-agent.
- `max_runs` defaults to `1` when omitted.
- `max_runs`, if provided, must be a positive integer.
- `schedule.mode = "once"` requires `run_at`; the tool parses it into `run_at_unix` and uses `max_runs = 1` unless the caller explicitly supplies a positive value.
- `schedule.mode = "interval"` requires `interval_sec > 0` and leaves `run_at_unix` empty.
- `schedule.mode = "cron"` requires a valid cron expression and leaves `run_at_unix` empty.

The tool returns a concise confirmation containing the created job id, schedule label, and max run count.

## Agent behavior

The system prompt should tell the agent to use `tdai_current_datetime` before creating time-sensitive jobs, then call `tdai_create_job` when the user asks for a reminder or scheduled task.

Examples:

- “Ingatkan saya 1 menit lagi untuk minum air” creates a one-shot job with `message_text = "Pengingat: minum air"`, a short `agent_prompt`, `schedule.mode = "once"`, and `max_runs = 1`.
- “Ingatkan saya setiap 10 menit” creates an interval job with `interval_sec = 600` and default `max_runs = 1`.
- “Ingatkan saya setiap 10 menit sebanyak 3 kali” creates an interval job with `interval_sec = 600` and `max_runs = 3`.
- A cron request without a repeat count uses `max_runs = 1`, so the cron expression only determines the first due time.

## Components

- `src/tools/types.ts`: add optional `autonomousJobs` to `ToolContext`.
- `src/tools/local.ts`: change `createLocalTools()` to accept an optional `AutonomousJobService`; add `tdai_create_job`.
- `src/index.ts`: pass `autonomousJobs` into `createLocalTools()` and into tool execution context if needed.
- `src/services/autonomous-jobs.ts`: extend job creation/mapping/update helpers for hybrid fields, one-shot due timestamps, and run limits.
- `src/db/schema.ts`: add backward-compatible migrations for new columns, including `run_at_unix`.
- `src/cron/autonomous.ts`: send fixed text first, run the agent prompt, increment `run_count`, and delete completed jobs.
- `src/agent/prompts/system.ts`: document `tdai_create_job`, default `max_runs = 1`, and the need to use current datetime for relative time.

## Error handling

`tdai_create_job` should return tool errors instead of throwing through the agent loop for expected validation failures:

- empty `message_text`
- empty `agent_prompt`
- missing or invalid schedule fields
- invalid cron expression
- non-positive or non-integer `max_runs`
- missing job service dependency

Unexpected service/database errors can use the existing registry behavior, which reports `Tool tdai_create_job failed: ...`.

## Testing

Add or update tests for:

- tool surface includes `tdai_create_job`
- one-shot creation stores `run_at_unix` and defaults `max_runs` to `1`
- interval creation stores caller-supplied `max_runs` and leaves `run_at_unix` empty
- cron creation validates `cron_expr`
- invalid inputs return clear errors
- scheduler sends `message_text` before running the agent
- scheduler sends the agent response after fixed text
- scheduler deletes the job after `run_count >= max_runs`
- system prompt mentions `tdai_create_job` and default `max_runs = 1`

## Out of scope

- Reintroducing `/jobs` as the primary UX.
- Creating a separate scheduler.
- Supporting unlimited recurring jobs by default.
- Skipping the agent prompt for due jobs.
