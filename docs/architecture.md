# Architecture

This project is a Telegram AI agent running on Bun with a menu-driven grammY UI.

## Runtime layers

- `src/index.ts` bootstraps the application.
- `src/bot/bot.ts` wires grammY, conversations, menus, and commands.
- `src/agent/react-agent.ts` runs the ReAct-style agent loop.
- `src/agent/prompts/system.ts` owns the extracted system prompt.
- `src/services/` owns persistence-backed business logic for memory updates and autonomous jobs.
- `src/cron/scheduler.ts` dispatches due autonomous work.
- `src/tools/local.ts` exposes internal tools to the agent.
- `src/db/schema.ts` defines the SQLite schema.

## Interaction model

The public Telegram surface is intentionally small:

- `/start`
- `/menu`
- `/help`

Everything else is handled through inline buttons and conversations from `@grammyjs/conversations`.

That gives the bot deterministic multi-step flows for memory updates, job creation, job editing, and nested navigation without falling back to a command-heavy interface.

## Responsibility boundaries

### Bot layer

The bot layer should only handle Telegram transport concerns:

- receiving messages and callback queries
- rendering menus and summaries
- entering conversations
- forwarding requests to services

### Service layer

The service layer should own stateful application logic:

- autonomous job persistence and lifecycle updates
- per-user memory update settings
- schedule summaries and validation
- execution bookkeeping

### Scheduler layer

The scheduler is a dispatcher, not a user-facing schedule source.

It wakes on an internal tick, reads due work from SQLite, and executes items whose own schedule says they are ready. This keeps scheduling logic centralized while allowing each job or user setting to keep its own cadence.

### Agent layer

The agent uses a separate prompt module and internal tools. The prompt stays focused on behavior, while orchestration remains in `react-agent.ts`.

An internal current datetime tool is available so the agent can answer time-sensitive questions accurately instead of guessing.

## Context offload pipeline

The context-offload path is intentionally separate from durable memory maintenance. Durable memory continues to maintain L0 conversations, L1 atoms, L2 scenarios, and L3 persona through the Memory Update workflow.

Context offload handles high-volume working context:

- L1.5 task judgment classifies whether a turn should attach to a long-running task, continue an existing task, complete one, or stay short-term only.
- task-scoped L2 Mermaid canvas files summarize evidence for active tasks without rewriting durable scenarios.
- L4 draft skill generation turns reviewed task canvases and linked evidence into project-local draft skills through menu/review flows.

## Data ownership

All durable state is stored in the project-owned backend. The runtime no longer depends on the old vendor-specific memory workflow for its primary behavior.

The README and memory docs describe the protected memory model in the current project terms: L0 conversations, L1 atoms, L2 scenarios, L3 persona, offload refs, and the Mermaid canvas.
