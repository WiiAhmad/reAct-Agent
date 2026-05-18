# grammY Telegram Agent on Bun

A Telegram AI agent built with Bun, grammY, and `@grammyjs/conversations`.

The runtime is now menu-driven. Public commands are only:

- `/start`
- `/menu`
- `/help`

Everything else happens through Telegram menus, inline buttons, and structured conversations.

## What this project does

- runs on Bun
- serves a Telegram bot with grammY
- uses `@grammyjs/conversations` for multi-step UI flows
- routes normal chat messages through a ReAct-style agent loop
- stores memory in a project-owned backend
- routes long-running context through L1.5 task judgment, task-scoped Mermaid canvases, and L4 draft skill generation
- schedules autonomous jobs from Telegram and dispatches them through the unified scheduler
- exposes an internal current datetime tool for accurate timestamp-aware reasoning

## Telegram UX

### `/start`

First-contact entry point. It welcomes the user and offers navigation into the menu or help.

### `/menu`

Opens the main menu. The menu is button-first and keeps the rest of the runtime behind structured flows.

Typical menu sections:

- Memory
- Skill Drafts
- Jobs
- Help

### `/help`

Explains the simplified public surface and how to use the button-driven menu flows.

## Memory Update

Memory Update is the Telegram-managed workflow for durable memory maintenance.

It is not a public slash command.

Memory Update can be used to:

- run memory maintenance now without blocking the Telegram conversation flow
- receive progress messages while L1, L2, and L3 complete
- enable or disable automatic updates
- choose a preset cadence
- enter a custom cron schedule when needed
- inspect status, last run, last result, and last error

The schedule is stored per user. The default behavior is an enabled update cadence of every 24 hours for a first-time user.

## Autonomous jobs

Autonomous jobs are created and managed from Telegram.

A job has its own schedule, and the unified scheduler dispatches due jobs from the database. This replaces the old single global cron-centric model.

Jobs support preset intervals and custom cron expressions. The bot surfaces job creation, editing, enable/disable, and deletion through menu flows instead of slash commands.

## Agent prompt and tools

The agent system prompt is extracted into `src/agent/prompts/system.ts` so the prompt stays separate from orchestration code.

The agent also has an internal current datetime tool, `tdai_current_datetime`, for situations where an accurate timestamp matters. It returns values using the configured timezone/locale and includes weekday fields so the agent does not infer the day name.

Other local tools still include memory search, conversation search, memory status, offloaded context ref reading, durable memory saving, and Telegram message sending for autonomous runs.

## Memory model

The memory backend is project-owned and keeps the existing layered model:

- L0 conversations
- L1 atoms
- L2 scenarios
- L3 persona
- offload refs
- task-scoped Mermaid canvases

Those durable semantics stay unchanged. The context-offload pipeline is separate: offloaded L1 evidence summaries are routed through L1.5 task judgment, captured in task-scoped Mermaid canvases, and can later feed L4 draft skill generation.

Skill Drafts is a Telegram menu flow for reviewing task canvases and generating draft skills under project storage. Drafts are not auto-installed globally.

## Key files

- `src/index.ts` - app bootstrap
- `src/bot/bot.ts` - grammY wiring
- `src/agent/prompts/system.ts` - extracted system prompt
- `src/agent/react-agent.ts` - ReAct orchestration
- `src/cron/scheduler.ts` - unified scheduler dispatcher
- `src/cron/autonomous.ts` - autonomous execution entry points
- `src/services/` - scheduling and memory-update services
- `src/tools/local.ts` - local memory and Telegram tools
- `src/db/schema.ts` - SQLite schema

## Run locally

```bash
bun install
bun run dev
```

## Tests

```bash
bun test
bun run typecheck
```

## Documentation

- `docs/architecture.md`
- `docs/telegram-flow.md`
- `docs/memory.md`
- `docs/autonomous-jobs.md`
