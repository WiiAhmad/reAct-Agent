# Telegram menu, memory update, and autonomous jobs redesign

## Summary

This redesign shifts the bot from command-heavy interactions to a button-first Telegram experience built on `@grammyjs/conversations`. The public command surface becomes:

- `/start`
- `/menu`
- `/help`

Everything else moves behind inline buttons and structured conversations. Memory inspection, memory maintenance, autonomous jobs, and help become deterministic UI flows instead of free-form command handlers.

The redesign also replaces the current global autonomous scheduling model with user-configurable schedules stored in SQLite. Autonomous jobs become individually scheduled, and memory maintenance becomes a per-user feature with a default 24-hour cadence that can be changed from Telegram.

Finally, the ReAct agent prompt currently embedded in `src/agent/react-agent.ts` is extracted to a dedicated prompt module, and the agent gains an internal current date/time tool for timestamp-aware reasoning.

## Goals

1. Replace most slash-command UX with button-first Telegram menus.
2. Keep only `/start`, `/menu`, and `/help` as public commands.
3. Use `@grammyjs/conversations` for all multi-step Telegram flows.
4. Rename the old `memory_force` concept to `memory_update` and expose it as a menu feature, not a slash command.
5. Let users configure autonomous job cadence from Telegram instead of editing `.env`.
6. Let users configure automatic memory updates from Telegram with a minimum default of every 24 hours.
7. Extract the agent system prompt from `src/agent/react-agent.ts` into a separate file.
8. Add an internal tool for current date/time.
9. Update README and dedicated docs to match the new architecture and UX.

## Non-goals

1. Replacing the existing `runReactAgent` chat flow for normal free-form user messages.
2. Changing the memory layer model itself. The existing L0/L1/L2/L3 layers, offload refs, and Mermaid canvas are fixed for this project and must not be renamed, removed, merged, split, reinterpreted, or replaced.
3. Moving configuration persistence out of SQLite.
4. Adding a general-purpose Telegram settings framework beyond the features required here.
5. Keeping backward compatibility for removed commands.

## Protected memory model boundary

This redesign may touch memory-related code, but only to change how the existing memory model is accessed, scheduled, triggered, rendered, or described.

Allowed memory-related changes in this project:
- Telegram menu and conversation entry points for viewing memory
- `Memory Update` UI and run-now behavior
- per-user automatic memory-update scheduling
- memory status and summary rendering
- prompt wording or tool instructions that describe the existing memory system

Out of scope memory changes in this project:
- changing the meaning or responsibilities of L0 conversations
- changing the meaning or responsibilities of L1 atoms
- changing the meaning or responsibilities of L2 scenarios
- changing the meaning or responsibilities of L3 persona
- replacing or redesigning offload refs
- replacing or redesigning the Mermaid canvas
- introducing a different memory layer model

In short: the memory model itself must stay as-is; only how that model is accessed and run may change.

## Current state

The current implementation has several constraints that conflict with the requested UX:

- `src/bot/bot.ts` mixes onboarding, command handlers, job creation, memory actions, and free-form agent invocation in one file.
- `/tools`, `/memory`, `/memory_force`, `/job`, and `/jobs` are all exposed as slash commands.
- Autonomous jobs are inserted into `autonomous_jobs`, but execution cadence is controlled globally via `.env` values in `src/config.ts` and `src/cron/autonomous.ts`.
- Memory maintenance also runs from a global cron value in `.env`.
- The system prompt is embedded inline inside `src/agent/react-agent.ts`.
- The project already depends on `@grammyjs/conversations`, but it is not yet used to structure Telegram UI flows.

## Product decisions captured from the user

1. The preferred design is a menu-centric UX using `@grammyjs/conversations`.
2. Public commands should effectively be reduced to `/start`, `/menu`, and `/help`.
3. `/start` is primarily for first contact and should immediately present Menu and Help buttons.
4. The `memory_update` feature should be button-only, not a public slash command.
5. Autonomous job cadence should support preset intervals plus custom cron input.
6. Automatic memory update scheduling should be scoped per user.
7. Current date/time should be exposed as an internal agent tool, not as a visible Telegram menu item.

## Desired Telegram UX

### `/start`

`/start` becomes a lightweight onboarding entry point.

Behavior:
- send a short welcome message
- present inline buttons for `Menu` and `Help`
- avoid showing the old long command list

### `/menu`

`/menu` opens the main navigation hub. The menu should be message-based and button-driven.

Top-level entries:
- `Memory`
- `Jobs`
- `Help`

`Date & Time` is intentionally not shown because the user chose that capability as an internal tool only.

### `Help`

`/help` and the Help menu should describe the simplified command surface and explain that advanced actions now live behind buttons.

### `Memory`

The Memory section replaces the old `/memory` command and preserves its core information:
- memory status
- L3 persona snapshot
- L2 scenarios summary
- top L1 atoms
- active canvas indicator

The Memory section also exposes a `Memory Update` action.

### `Memory Update`

`Memory Update` replaces the old `memory_force` concept.

Available actions:
- `Run now`
- `Enable auto update`
- `Disable auto update`
- preset cadence selection: `6h`, `12h`, `24h`
- `Custom cron`
- status view showing enabled state, cadence, last run, last result, and last error if any

Default behavior:
- first-time users get automatic memory updates enabled
- the default cadence is every 24 hours

### `Jobs`

The Jobs section replaces `/job` and `/jobs`.

Available actions:
- `Add Job`
- `Jobs List`
- choose a job to view details
- edit prompt
- change schedule
- enable/disable
- delete

When creating or editing a job, schedule selection supports:
- preset intervals
- custom cron entry

## Conversation architecture

The Telegram UI layer should be restructured around `@grammyjs/conversations`.

### Why conversations

The requested UX contains multiple stepwise flows:
- create a job
- edit a job schedule
- enter a custom cron
- configure memory update behavior
- move through nested menus

These are a natural fit for conversations because they provide structured waiting for user input and well-defined replay behavior.

The Context7 documentation for `@grammyjs/conversations` confirms the intended model:
- `conversations()` installs the plugin
- `createConversation(...)` registers flows
- `ctx.conversation.enter(...)` enters a flow from a command or callback handler
- `conversation.wait()` and `conversation.form.*` collect user input
- `conversation.external(...)` protects side effects from replay

### Proposed file structure

```text
src/
  agent/
    prompts/
      system.ts
    react-agent.ts
  bot/
    bot.ts
    context.ts
    ui/
      keyboards.ts
      renderers.ts
    conversations/
      main-menu.ts
      memory-menu.ts
      memory-update.ts
      jobs-menu.ts
      job-create.ts
      job-detail.ts
      help.ts
  cron/
    autonomous.ts
    scheduler.ts
  services/
    autonomous-jobs.ts
    memory-update-settings.ts
```

This structure keeps responsibilities separated:
- `bot.ts` wires the bot
- `context.ts` defines the typed grammY context and conversation flavor
- `ui/*` contains button builders and shared render helpers
- `conversations/*` contains deterministic user interaction flows
- `services/*` contains persistence and business logic used by both conversations and cron dispatch
- `agent/prompts/system.ts` owns the system prompt text

The exact filenames may vary slightly during implementation, but the split of responsibilities should remain.

### Conversation entry model

- `/start` sends onboarding and shows buttons
- `/menu` enters or opens the main menu flow
- inline callback handlers route into the relevant conversation flow
- nested actions should reuse shared render helpers so that the same button labels and summaries are consistent everywhere

### Replay-safe rule

Any side effect inside a conversation must run through `conversation.external(...)`.

This includes:
- inserting a new job
- updating a job
- deleting a job
- toggling job enabled state
- running memory maintenance immediately
- writing memory-update settings
- querying mutable state that should not be repeated during replay

This rule is required because otherwise replayed conversation steps could duplicate writes or repeated operations.

## Agent architecture changes

### Extract the system prompt

The inline system prompt currently embedded in `src/agent/react-agent.ts` should move to a dedicated module.

Proposed target:
- `src/agent/prompts/system.ts`

Responsibilities of the new module:
- export a prompt builder or constant
- centralize Telegram-agent runtime rules
- keep `react-agent.ts` focused on orchestration

### Prompt content updates

The new prompt should clarify the redesigned runtime:
- the Telegram UX is menu-driven
- only `/start`, `/menu`, and `/help` are public commands
- memory update exists as a Telegram feature managed through menus
- autonomous jobs are scheduled per item, not by a single global job cadence
- a current date/time tool exists and should be used when accurate timestamps matter
- answers should remain concise and practical for Telegram

### New internal tool: current date/time

Add a new local tool for current time, for example `tdai_current_datetime`.

Expected output should include:
- current ISO timestamp
- Unix timestamp
- a readable local date/time string
- timezone identifier or UTC offset if available

This tool is internal for agent reasoning. It is not added to the visible Telegram menu.

Use cases:
- answering date/time questions accurately
- composing timestamped memory entries
- generating schedule-aware summaries
- helping autonomous jobs reason about current time without guessing

## Scheduling redesign

### Problem with the current model

Today, autonomous jobs are governed by global `.env` settings:
- `AUTONOMOUS_CRON`
- `AUTONOMOUS_MIN_INTERVAL_SEC`
- `AUTONOMOUS_MAX_JOBS_PER_TICK`

Memory maintenance also uses a global `.env` cron.

This conflicts with the requested UX because users should be able to configure schedule behavior directly from Telegram.

### New scheduling model

The runtime should move to a dispatcher model:
- a lightweight internal loop wakes up periodically
- on each tick, it selects due autonomous jobs and due memory-update tasks from SQLite
- each item determines its own cadence based on saved schedule settings

This means there are two scheduling layers:
1. a process-level dispatcher tick
2. per-item scheduling rules stored in the database

The dispatcher interval can still exist in runtime config as an internal operational knob, but it is no longer the user-facing source of truth for autonomous job timing.

### Schedule representations

The system should support two schedule modes:
- `interval`
- `cron`

For `interval` mode:
- store interval in seconds
- use it for preset selections like 10 minutes, 30 minutes, 1 hour, 24 hours

For `cron` mode:
- store the cron expression string exactly as entered
- validate it before save
- compute due state against current time on dispatcher ticks

### Per-user memory update scheduling

Memory auto-update settings are stored per user.

Default for a newly seen user:
- enabled = true
- schedule_mode = `interval`
- interval_sec = `86400`

This default fulfills the requirement that `/memory_update` should run at least every 24 hours by default.

## Data model changes

### `autonomous_jobs`

The current `autonomous_jobs` table should be expanded to support item-specific scheduling and observability.

Add fields equivalent to:
- `schedule_mode` (`interval` or `cron`)
- `interval_sec` nullable
- `cron_expr` nullable
- `last_finished_at`
- `last_status`
- `last_error`

Retain existing fields such as:
- `id`
- `chat_id`
- `user_id`
- `prompt`
- `enabled`
- `last_run_at`
- `created_at`
- `updated_at`

Optionally add `next_run_at` if implementation convenience or performance warrants it, but it is not required for the design to work. It is acceptable to compute due-ness dynamically on each dispatcher tick.

### New table: `memory_update_settings`

Create a table scoped per user with fields equivalent to:
- `user_id` primary key
- `enabled`
- `schedule_mode`
- `interval_sec` nullable
- `cron_expr` nullable
- `last_run_at` nullable
- `last_finished_at` nullable
- `last_status` nullable
- `last_error` nullable
- `created_at`
- `updated_at`

This table is the source of truth for Telegram-managed memory scheduling preferences.

## Services and responsibility boundaries

### Autonomous job service

A dedicated service should own:
- create job
- update prompt
- update schedule
- toggle enabled state
- delete job
- list jobs for a chat
- compute or expose human-readable schedule summaries
- mark start/completion/failure for executions

### Memory update settings service

A dedicated service should own:
- load effective settings for a user
- initialize defaults for a first-time user
- update enabled state
- update schedule mode and cadence
- record run status
- render status summaries for the Telegram UI

### Scheduler / dispatcher

The scheduler layer should:
- wake on a fixed internal tick
- query enabled jobs and enabled memory-update settings
- determine which items are due
- execute each due item
- record execution outcome
- keep existing protections against overlapping runs

Autonomous job execution still calls `runReactAgent` in autonomous mode.
Memory update execution still calls `memory.runMaintenanceForUser(userId, force)`.

## Telegram menu flows

### Main menu flow

Entry points:
- `/menu`
- Menu button from `/start`

Actions:
- open Memory
- open Jobs
- open Help
- go back or close

### Memory flow

Actions:
- view current memory summary
- open Memory Update settings
- return to main menu

### Memory Update flow

Actions:
- show current settings summary
- run update now
- enable/disable auto update
- choose preset interval
- enter custom cron
- confirm and save
- return to Memory menu

### Job creation flow

Steps:
1. ask for the job prompt
2. ask for schedule mode
3. if preset interval chosen, save interval
4. if custom cron chosen, ask for cron string and validate it
5. create the job
6. show success summary and offer navigation back to Jobs

### Job detail flow

Actions:
- show prompt
- show schedule
- show enabled state
- show last run / last result / last error
- edit prompt
- edit schedule
- enable/disable
- delete with confirmation

## Readme and documentation updates

### README

Update the root `README.md` to reflect:
- the new public commands
- button-first menu UX
- use of `@grammyjs/conversations`
- the new meaning of Memory Update
- per-job scheduling from Telegram
- per-user memory auto-update from Telegram
- the extracted agent prompt structure
- the new internal date/time tool

Remove or rewrite sections that still describe:
- `/tools`
- `/memory_force`
- `/job <prompt>`
- `/jobs`
- `.env` as the primary place for user-facing autonomous schedule control

### New docs

Add these documents:
- `docs/architecture.md`
- `docs/telegram-flow.md`
- `docs/memory.md`
- `docs/autonomous-jobs.md`

Recommended focus:
- `architecture.md`: runtime layers, services, persistence, agent/menu split
- `telegram-flow.md`: commands, buttons, conversations, user journeys
- `memory.md`: L0/L1/L2/L3 model plus Memory Update behavior
- `autonomous-jobs.md`: job lifecycle, schedule modes, dispatcher model, observability fields

## Migration strategy

1. Introduce typed grammY context and install the conversations plugin.
2. Extract the agent prompt into `src/agent/prompts/system.ts`.
3. Add service modules for autonomous jobs and memory update settings.
4. Migrate the database schema for new scheduling fields and the new table.
5. Replace old slash-command handlers with menu entry points.
6. Implement the main menu and memory flows.
7. Implement job creation and job detail flows.
8. Replace the current global autonomous execution logic with due-item dispatching.
9. Add the internal current date/time tool.
10. Update README and add dedicated docs.
11. Remove dead code and obsolete command/help text.

## Testing requirements

### Unit and integration coverage

Add or update tests for:
- schema migration of `autonomous_jobs`
- creation and default initialization of `memory_update_settings`
- due-item selection logic for interval schedules
- due-item selection logic for cron schedules
- validation failures for invalid cron input
- default per-user memory update cadence of 24 hours
- prompt extraction from `react-agent.ts`
- current date/time tool output shape
- menu/help text regression so removed commands are no longer advertised

### Behavior coverage

Add tests or verification for:
- `/start` showing Menu and Help buttons
- `/menu` opening the main navigation
- Memory Update `Run now`
- creating a job with a preset interval
- creating a job with a custom cron schedule
- listing jobs with schedule and status summaries
- editing a job without duplicate writes on replay-sensitive flows

### Manual verification

Before completion, verify in Telegram:
- onboarding flow from `/start`
- navigation through `/menu`
- memory summary display
- Memory Update enable/disable and run-now behavior
- job creation with both schedule styles
- job list visibility
- autonomous execution notifications still arrive correctly

## Risks and mitigations

### Replay-related duplicate side effects

Risk:
Conversation replay may duplicate writes or executions.

Mitigation:
Use `conversation.external(...)` for all persistence and execution side effects.

### Mixed old/new UX during migration

Risk:
Temporary overlap between removed commands and new menus can produce confusing behavior.

Mitigation:
Switch command help text and handlers deliberately, then remove obsolete handlers instead of leaving partial compatibility shims.

### Scheduler complexity

Risk:
Per-item scheduling is more complex than a single global cron.

Mitigation:
Keep a simple internal dispatcher tick and isolate due-calculation in dedicated services with tests.

## Final design decision

Implement a menu-centric Telegram UX built with `@grammyjs/conversations`, keep only `/start`, `/menu`, and `/help` as public commands, move memory and job management behind inline button flows, persist per-item schedules in SQLite, default memory auto-update to every 24 hours per user, extract the agent system prompt to a separate module, and add an internal current date/time tool for the agent.


50312e74-f0e6-4cbb-83f0-eef04ba35a8b