# Architecture

This document is the contributor-facing map of the runtime.

Use it to understand the major subsystem boundaries, the two main execution flows, and which deeper doc owns each area.

## Runtime in one view

This project is a Bun-based Telegram AI agent built around:

- a grammY bot with menu/callback/conversation flows
- a ReAct-style agent loop
- a project-owned memory runtime backed by SQLite and JSONL history
- a unified scheduler that runs autonomous jobs and Memory Update work

`src/index.ts` is the integration point that wires the runtime together.

## Major runtime layers

### Bootstrap and runtime wiring

`src/index.ts` initializes the DB, LLM provider, memory service, tool registry, Telegram bot, local tools, and unified scheduler.

### Telegram transport and UI

`src/bot/bot.ts` owns the public command surface, menus, callback routing, and conversation entrypoints. It should stay focused on Telegram transport and UI coordination.

### Agent loop

`src/agent/react-agent.ts` owns task judgment, recent-context loading, layered recall, tool execution, and tool-result offload during agent runs.

### Services and scheduling

`src/services/*` owns persistent job and Memory Update settings. `src/cron/scheduler.ts` owns due-work dispatch across autonomous jobs and Memory Update runs.

### Memory runtime

`src/memory/*` owns durable memory maintenance, task/context offload, recall, interaction logging, refs, task canvases, and draft skill generation.

### Persistence and diagnostics

SQLite stores structured runtime state, while JSONL stores canonical chat history and optional memory/export artifacts. Logging and runtime traces sit alongside those storage surfaces.

## Main execution flows

### Inbound Telegram message flow

1. Telegram delivers a message or callback to the bot layer.
2. The bot routes the interaction into a screen update, conversation, or agent run.
3. The agent logs the turn, runs task judgment, loads recent context and layered recall, and executes tools as needed.
4. Tool results are summarized or offloaded through the memory runtime before the agent continues.
5. The bot sends the final Telegram response.

The public command surface stays intentionally small: `/start`, `/menu`, and `/help`. The rest of the user-visible behavior lives behind menus, callbacks, and conversations.

### Scheduler-driven background flow

1. The unified scheduler wakes on its internal tick.
2. It selects due autonomous jobs up to the per-tick capacity.
3. It runs those jobs first.
4. It spends any remaining capacity on due Memory Update users.
5. Both paths write status and timestamps back to persistent state.

## Persistence and storage surfaces

- SQLite is the structured source of truth for jobs, Memory Update settings, memory indexes, task state, and recall-related records.
- `data/history/<chatId>.jsonl` is the canonical per-chat transcript history.
- offloaded raw tool output is stored as refs.
- task-scoped working context is stored as task canvases.
- generated draft skills are written to project storage and remain reviewable artifacts until a user handles them explicitly.

## Terminology map

- **unified scheduler** — the scheduler loop in `src/cron/scheduler.ts`
- **autonomous jobs** — scheduled background jobs stored per job record
- **Memory Update** — the Telegram-managed durable-memory maintenance workflow
- **durable memory** — the protected L0/L1/L2/L3 semantic model
- **task/context offload** — the operational path for L1 evidence, L1.5 task judgment, task canvases, refs, and L4 draft skills
- **public command surface** — `/start`, `/menu`, and `/help`
- **menu/callback/conversation flows** — the button-driven grammY interaction model used for multi-step UI behavior

## Relevant code

- `src/index.ts`
- `src/bot/bot.ts`
- `src/agent/react-agent.ts`
- `src/cron/scheduler.ts`
- `src/memory/integration/factory.ts`
- `src/db/schema.ts`

## Where to read next

- `docs/autonomous-jobs.md` — job model, schedule model, and unified scheduler behavior
- `docs/memory.md` — durable memory, task/context offload, recall, and Memory Update boundaries
- `docs/telegram-flow.md` — menus, callbacks, conversations, and Telegram UX boundaries
