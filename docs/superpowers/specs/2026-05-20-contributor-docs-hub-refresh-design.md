# Contributor Docs Architecture-Hub Refresh Design

**Date:** 2026-05-20  
**Status:** Draft for user review  
**Target project:** `D:\Code\Test\yunus\grammy`

## Goal

Refresh and rewrite these contributor-facing docs so they match the current runtime and read as one coherent documentation set:

- `docs/architecture.md`
- `docs/autonomous-jobs.md`
- `docs/memory.md`
- `docs/telegram-flow.md`

The resulting structure should make `docs/architecture.md` the entry-point hub, with the other three files acting as focused deep-dives.

## User-approved direction

Conversation decisions already made:

- refresh content **and** rewrite structure/wording where stale
- optimize for **contributors** rather than general readers
- use **architecture hub** structure, with `architecture.md` as the top-level map
- make `docs/memory.md` explain the split between **durable memory** and **task/context offload** in much deeper detail

## Non-goals

- Do not change runtime behavior.
- Do not rename runtime concepts in code.
- Do not add new product features, menus, or commands.
- Do not expand this work into README or unrelated docs unless later requested.
- Do not turn these docs into end-user product help; they remain contributor docs.

## Existing context

The current docs already describe the right broad areas, but they overlap and repeat each other:

- `docs/architecture.md` mixes runtime layers with memory/offload details.
- `docs/autonomous-jobs.md` explains per-job scheduling, but not the contributor-facing distinction between menu-created jobs and tool-created hybrid jobs.
- `docs/memory.md` correctly protects L0/L1/L2/L3 semantics, but it needs a much sharper explanation of the parallel task/offload path.
- `docs/telegram-flow.md` correctly describes the command-light, menu-driven surface, but it can better connect Telegram UX to service boundaries.

Provenance:

- current architecture doc: `docs/architecture.md:1-85`
- current autonomous jobs doc: `docs/autonomous-jobs.md:1-56`
- current memory doc: `docs/memory.md:1-79`
- current Telegram flow doc: `docs/telegram-flow.md:1-64`

## Runtime facts the rewrite must reflect

### Runtime entrypoint and wiring

`src/index.ts` is the main runtime bootstrap. It initializes the DB, LLM provider, memory service, tool registry, Telegram bot, local tools, and the unified scheduler loop.

Provenance:

- runtime bootstrap and dependency wiring: `src/index.ts:19-108`

### Telegram command surface

The public Telegram command surface is limited to:

- `/start`
- `/menu`
- `/help`

Everything else is exposed through menus, callbacks, or conversations.

Provenance:

- public commands constant: `src/bot/bot.ts:22-31`
- command handlers: `src/bot/bot.ts:138-160`
- menu/callback entrypoints: `src/bot/bot.ts:162-255`

### Unified scheduler

The runtime uses a unified scheduler loop that first runs due autonomous jobs, then spends any remaining per-tick capacity on due Memory Update users.

This means scheduler capacity is shared between autonomous jobs and Memory Update execution.

Provenance:

- scheduler dispatch order and remaining capacity: `src/cron/scheduler.ts:25-64`
- scheduler loop bootstrap: `src/index.ts:82-108`

### Autonomous job model

Autonomous jobs support:

- `agent` and `hybrid` job types
- `once`, `interval`, and `cron` schedule modes
- lifecycle fields such as run count, max runs, last status, and last error

The service defaults `maxRuns` to `1` for `once` jobs unless a value is explicitly provided.

Provenance:

- job types and row shape: `src/services/autonomous-jobs.ts:5-29`
- create job defaults and schedule persistence: `src/services/autonomous-jobs.ts:131-178`
- schedule updates and lifecycle fields: `src/services/autonomous-jobs.ts:217-260`

### Memory Update settings model

Memory Update scheduling is per-user, supports `interval` and `cron`, and defaults a new user to enabled with a 24-hour interval.

Provenance:

- settings row shape: `src/services/memory-update-settings.ts:5-18`
- default new-user settings: `src/services/memory-update-settings.ts:65-91`
- `once` mode rejection: `src/services/memory-update-settings.ts:93-104`
- due-user selection: `src/services/memory-update-settings.ts:114-154`

### Local tool surface relevant to docs

The local tool layer exposes memory search, conversation search, context-ref read, memory status, memory save, current datetime, scheduled job creation, and Telegram send-message capabilities.

The job-creation tool creates **hybrid** jobs and documents that it sends fixed text first and then runs an agent prompt.

Provenance:

- tool list and memory tools: `src/tools/local.ts:50-164`
- hybrid job tool contract: `src/tools/local.ts:166-239`

### Memory service composition

The memory runtime is assembled from:

- SQLite memory backend
- SQLite memory store
- recall service
- interaction log service
- offload service
- pipeline coordinator

This is the core structural fact behind the memory docs rewrite.

Provenance:

- memory service factory composition: `src/memory/integration/factory.ts:103-163`

### Agent memory and offload usage

The agent logs user messages, runs task judgment, loads recent context and recall, executes tools, offloads tool results, and feeds those offloaded summaries back into the ongoing run.

Provenance:

- task judgment, recall loading, and tool filtering: `src/agent/react-agent.ts:105-173`
- tool execution and offload path: `src/agent/react-agent.ts:216-260`

## Chosen approach

Use an **architecture hub** documentation model.

That means:

1. `docs/architecture.md` becomes the contributor-facing system map.
2. `docs/autonomous-jobs.md`, `docs/memory.md`, and `docs/telegram-flow.md` become narrower deep-dives.
3. Shared terminology is normalized across the whole set.
4. Repetition is reduced by giving each document a clear ownership boundary.
5. Each doc includes direct code anchors so contributors can jump from concept to implementation quickly.

This is preferred over a minimal sync because the current docs already cover the right subjects; the main problem is structure, overlap, and stale framing.

## Document ownership model

### `docs/architecture.md` owns

- runtime overview
- major subsystem boundaries
- inbound and scheduled execution flows
- storage surfaces
- terminology map
- links to the three deep-dives

It should answer: **What are the main moving parts, how do they connect, and where should I read next?**

### `docs/autonomous-jobs.md` owns

- autonomous job model
- schedule model
- creation paths
- runtime execution lifecycle
- scheduler interaction

It should answer: **How does scheduled autonomous work behave at runtime and in storage?**

### `docs/memory.md` owns

- protected semantic model
- durable memory vs task/context offload split
- recall and storage boundaries
- Memory Update workflow and invariants

It should answer: **What memory layers exist, what are they for, and which parts are durable semantics versus working-context machinery?**

### `docs/telegram-flow.md` owns

- public command surface
- menus, callbacks, and conversations
- service handoff boundary
- UX principles for contributor edits

It should answer: **How do users move through the bot, and where does Telegram UI stop and service/runtime logic begin?**

## Detailed rewrite plan per file

### `docs/architecture.md`

Proposed outline:

1. Purpose and audience
2. Runtime in one view
3. Major runtime layers
4. Main execution flows
   - inbound Telegram message flow
   - scheduler-driven background flow
5. Persistence and storage surfaces
6. Terminology map
7. Where to read next

Required content:

- identify Bun + grammY + ReAct agent + SQLite + unified scheduler as the top-level runtime
- explain the boundary between bot/UI, agent, services/scheduler, memory, and persistence/logging
- show that `src/index.ts` is the integration point
- point to the deep-dive docs instead of re-explaining all details inline

Relevant code anchors:

- `src/index.ts`
- `src/bot/bot.ts`
- `src/agent/react-agent.ts`
- `src/cron/scheduler.ts`
- `src/memory/integration/factory.ts`

### `docs/autonomous-jobs.md`

Proposed outline:

1. Purpose and scope
2. Source of truth for job state
3. Job model
4. Schedule model
5. Creation paths
   - menu-created jobs
   - tool-created hybrid jobs
6. Runtime execution lifecycle
7. Scheduler interaction and capacity sharing
8. Relevant code
9. Related docs

Required content:

- explain `agent` vs `hybrid`
- explain `once`, `interval`, `cron`
- distinguish menu-created jobs from `tdai_create_job`
- explain max-runs behavior for one-shot work
- explain that per-job records are the source of truth, not the scheduler tick
- explain that unified scheduler capacity is shared with Memory Update runs

Relevant code anchors:

- `src/services/autonomous-jobs.ts`
- `src/services/memory-update-settings.ts`
- `src/services/schedules.ts`
- `src/cron/scheduler.ts`
- `src/tools/local.ts`
- `src/bot/conversations/job-create.ts`
- `src/bot/conversations/job-detail.ts`

### `docs/memory.md`

Proposed outline:

1. Purpose and protected boundary
2. Durable memory layers
3. Task/context offload layers
4. Canonical history, indexes, refs, and canvases
5. Recall behavior
6. Memory Update workflow
7. Per-user scheduling semantics
8. Contributor invariants
9. Relevant code
10. Related docs

This file needs the biggest conceptual upgrade.

#### Core mental model

The doc should teach contributors to see **two parallel systems**:

```text
conversation + tool activity
├─ durable memory path
│  └─ L0 conversations -> L1 atoms -> L2 scenarios -> L3 persona
└─ task/context offload path
   └─ L1 evidence -> L1.5 task judgment -> task canvas + refs -> task-aware recall -> optional L4 draft skills
```

The key point is that these are **parallel systems with different purposes**, not one long numbered ladder.

#### Durable memory path

The durable path is the protected semantic model:

- **L0 conversations**: raw conversation evidence and transcript-level history
- **L1 atoms**: durable extracted facts/preferences/constraints/decisions
- **L2 scenarios**: grouped higher-level contextual memory
- **L3 persona**: the slowest-changing, most distilled user/project profile

The doc must state clearly that the durable pipeline is:

`L0 conversation evidence -> L1 atoms -> L2 scenarios -> L3 persona`

This path is maintained through **Memory Update**, not through inline task offload behavior.

Provenance:

- memory recall result shape: `src/memory/core/service.ts:21-28`
- recall assembly of persona/scenarios/atoms/conversations/task canvases: `src/memory/core/service.ts:217-276`
- recall service querying persona, scenarios, conversations, and task canvases: `src/memory/recall/service.ts:153-205`

#### Task/context offload path

The offload path is operational working-context infrastructure:

- **L1 evidence**: compact task-oriented summaries of tool/interaction results
- **L1.5 task judgment**: routing logic that decides whether a turn starts, continues, completes, or avoids task-scoped context
- **task canvases**: structured task-scoped working summaries used for continuity and recall
- **refs**: raw offloaded detail for large or heavy outputs
- **L4 draft skills**: user-triggered project-local draft skills derived from task context

The doc must state clearly that this path exists to:

- preserve working context for long tasks
- avoid prompt bloat
- keep heavy raw results recoverable
- support task-aware recall and draft skill generation

It is **not** the same as durable L0/L1/L2/L3 semantics.

#### Critical distinctions the doc must make explicit

- L1 **atoms** are not the same thing as L1 **evidence**.
- Durable L2 **scenarios** are not the same thing as task-scoped L2 **Mermaid canvases**.
- L1.5 is not a durable semantic layer; it is a task routing/judgment layer.
- Refs are raw detail storage, not the primary summary.
- L4 draft skills are reviewable outputs from task context, not auto-installed runtime behavior.

#### Timing model

The doc should distinguish two clocks:

- **task/context offload** happens inline during active work
- **durable memory maintenance** happens asynchronously through Memory Update

This gives contributors the right mental split between **operational continuity now** and **semantic consolidation later**.

#### End-to-end example to include

The rewritten doc should include one short worked example:

1. user asks for a longer investigation
2. the agent runs tools
3. tool results produce L1 evidence
4. L1.5 decides whether this belongs to a long-running task
5. task canvas is created or updated when appropriate
6. large tool output is stored as refs while summaries stay compact
7. task-aware recall can later inject task canvases back into context
8. Memory Update later distills durable long-term meaning into L1/L2/L3

That example will make the split concrete instead of abstract.

#### Storage boundaries

The memory doc should make storage roles explicit:

- canonical transcript history lives in per-chat JSONL
- SQLite stores structured indexes, recall state, task state, scheduling/checkpoint state, and memory/store tables
- refs store heavy raw output
- task canvases store structured task summaries

Provenance:

- history directory and interaction log wiring: `src/memory/integration/factory.ts:125-138`
- recall includes active and historical task canvases: `src/memory/recall/service.ts:153-205`
- task judgment API and options shape: `src/memory/core/service.ts:46-86`
- L1.5 routing behavior and safe short fallback: `src/memory/offload/l15.ts:23-63`, `src/memory/offload/l15.ts:107-123`, `src/memory/offload/l15.ts:157-179`

#### Contributor invariants

Add a short invariants section that says:

- durable L0/L1/L2/L3 semantics are protected
- task canvases do not replace durable scenarios
- L1.5 is a control/routing layer, not a durable semantic layer
- refs hold raw detail, not the main summary
- Memory Update maintains durable memory, not task continuity semantics
- L4 draft skills remain drafts until explicitly handled by the user

### `docs/telegram-flow.md`

Proposed outline:

1. Purpose and public surface
2. Commands vs menus vs conversations
3. Main menu journeys
4. Callback and conversation routing
5. Service handoff boundary
6. Background-triggered UX updates
7. UI principles for contributors
8. Relevant code
9. Related docs

Required content:

- reinforce that `/start`, `/menu`, and `/help` are the public command boundary
- explain that Memory Update, Skill Drafts, and Jobs are menu/callback driven
- describe conversations as the multi-step mechanism for schedules, confirmation flows, and draft generation
- explain that Telegram is the transport/UI shell and services own persistent logic
- note that Memory Update run-now is asynchronous and can send progress/result messages later

Relevant code anchors:

- `src/bot/bot.ts`
- `src/bot/ui/keyboards.ts`
- `src/bot/ui/renderers.ts`
- `src/bot/conversations/memory-update.ts`
- `src/bot/conversations/memory-update-runner.ts`
- `src/bot/conversations/job-create.ts`
- `src/bot/conversations/job-detail.ts`
- `src/bot/conversations/skill-draft.ts`

## Cross-linking model

Cross-linking should be deliberate and minimal:

- `docs/architecture.md` links outward to the three deep-dives
- each deep-dive links back to `docs/architecture.md`
- deep-dives link sideways only when another doc owns the concept more fully
- each file ends with a short `Relevant code` section and a short `Related docs` section

This keeps the set navigable without turning every page into a duplicate index.

## Terminology normalization

Use these exact terms consistently across the four docs:

- **unified scheduler**
- **autonomous jobs**
- **Memory Update**
- **durable memory**
- **task/context offload**
- **public command surface**
- **menu/callback/conversation flows**

Avoid mixing old and new framing for the same concepts.

## Editorial rules

- write for contributors first
- prefer source-of-truth statements over vague summaries
- make ownership boundaries explicit
- remove repeated project background where one doc already owns it
- keep sections short and scannable
- anchor each doc to current code paths
- explain why a concept exists when that boundary is easy to confuse

## Implementation notes

This documentation change should be implemented as direct edits to the four existing docs.

No new runtime docs files are required beyond this design spec.

The edit strategy should be:

1. rewrite `docs/architecture.md` first so it defines the shared vocabulary and hub links
2. tighten `docs/autonomous-jobs.md` around scheduler/job semantics
3. rewrite `docs/memory.md` with the durable-vs-offload split as the central organizing principle
4. finish `docs/telegram-flow.md` so its UI and service boundaries use the same vocabulary as the hub
5. cross-check all four docs for duplicate explanations and inconsistent terms

## Verification

Verification for this work is editorial/runtime-accuracy review, not product behavior testing.

Before calling the doc rewrite complete, confirm:

1. every behavioral statement matches current code
2. menu-created jobs and `tdai_create_job` hybrid jobs are distinguished correctly
3. Memory Update scheduling is documented as per-user `interval`/`cron` only
4. unified scheduler capacity sharing is documented correctly
5. durable memory and task/context offload are clearly separated
6. public Telegram commands are documented as `/start`, `/menu`, `/help` only
7. each file includes useful code anchors and related-doc links

## Tradeoffs

### Why not keep each doc broadly self-contained?

Because the current problem is not missing topics; it is overlapping topics. A hub-and-deep-dive model reduces duplication and gives contributors one obvious starting point.

### Why not merge everything into one big architecture doc?

Because contributors editing jobs, memory, or Telegram flow need focused deep-dives. A single long document would be harder to maintain and easier to let drift.

### Why spend so much space on the memory split?

Because that is the most semantically confusing part of the current runtime. If contributors blur durable memory and task/offload behavior together, they will misunderstand both the storage model and the update paths.

## Success criteria

This design is successful when the rewritten docs:

- make `docs/architecture.md` the obvious contributor entry point
- give the other three docs crisp ownership boundaries
- reflect the unified scheduler and current Telegram UI model accurately
- explain autonomous job creation/runtime behavior without ambiguity
- explain memory in a way that preserves the protected L0/L1/L2/L3 model while clearly separating task/context offload
- reduce duplication and improve navigation from docs to code
