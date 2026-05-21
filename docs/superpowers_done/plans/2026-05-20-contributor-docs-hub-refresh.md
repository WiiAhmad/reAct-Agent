# Contributor Docs Hub Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the four contributor docs so `docs/architecture.md` becomes the hub and the autonomous jobs, memory, and Telegram flow docs become accurate deep-dives aligned with the current runtime.

**Architecture:** Treat the docs as one contributor-facing set with explicit ownership boundaries. Rewrite `architecture.md` first to establish shared vocabulary, then narrow the other docs around job scheduling, durable memory versus task/context offload, and the Telegram UI boundary.

**Tech Stack:** Markdown docs, Bun runtime, grammY, SQLite, project-owned memory runtime, unified scheduler

---

**Source spec:** `docs/superpowers/specs/2026-05-20-contributor-docs-hub-refresh-design.md`

**Execution note:** This is a documentation-only plan. Because current instructions do not authorize unrequested git commits, use diff-based verification instead of commit checkpoints unless the user later asks for commits.

## File structure

### Docs to modify

- `docs/architecture.md` — contributor-facing system map and entry-point hub
- `docs/autonomous-jobs.md` — scheduler/job model deep-dive
- `docs/memory.md` — durable memory versus task/context offload boundary doc
- `docs/telegram-flow.md` — Telegram UI/control-surface deep-dive

### Runtime files to reference while editing

- `src/index.ts` — bootstrap, runtime wiring, unified scheduler startup
- `src/bot/bot.ts` — public commands, menus, callbacks, conversations, async Memory Update trigger
- `src/agent/react-agent.ts` — task judgment, recall loading, tool filtering, tool-result offload
- `src/cron/scheduler.ts` — unified scheduler dispatch order and shared capacity
- `src/services/autonomous-jobs.ts` — job model, schedule model, lifecycle fields
- `src/services/memory-update-settings.ts` — per-user Memory Update scheduling
- `src/tools/local.ts` — `tdai_create_job` hybrid job behavior and memory tools
- `src/memory/integration/factory.ts` — memory service composition
- `src/memory/core/service.ts` — recall/result shape and memory APIs
- `src/memory/offload/l15.ts` — L1.5 task judgment semantics
- `src/memory/recall/service.ts` — recall layering across persona/scenarios/atoms/history/task canvases

### Shared terminology to keep consistent

- **unified scheduler**
- **autonomous jobs**
- **Memory Update**
- **durable memory**
- **task/context offload**
- **public command surface**
- **menu/callback/conversation flows**

## Task 1: Rewrite `docs/architecture.md` as the hub

**Files:**
- Modify: `docs/architecture.md`
- Reference: `src/index.ts:19-108`
- Reference: `src/bot/bot.ts:22-31`
- Reference: `src/agent/react-agent.ts:105-173`
- Reference: `src/cron/scheduler.ts:25-64`
- Reference: `src/memory/integration/factory.ts:103-163`
- Reference: `docs/superpowers/specs/2026-05-20-contributor-docs-hub-refresh-design.md`

- [ ] **Step 1: Replace the opening with contributor-facing framing and a one-view runtime summary**

```md
# Architecture

This document is the contributor-facing map of the runtime.

Use it to understand the major runtime boundaries, the two main execution flows, and which deeper doc owns each subsystem.

## Runtime in one view

This project is a Bun-based Telegram AI agent built around:

- a grammY bot with menu/callback/conversation flows
- a ReAct-style agent loop
- a project-owned memory runtime backed by SQLite and JSONL history
- a unified scheduler that runs autonomous jobs and Memory Update work

`src/index.ts` is the integration point that wires the runtime together.
```

- [ ] **Step 2: Add the major runtime layers section with explicit ownership boundaries**

```md
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
```

- [ ] **Step 3: Add the two main execution flows and the storage surfaces section**

```md
## Main execution flows

### Inbound Telegram message flow

1. Telegram delivers a message or callback to the bot layer.
2. The bot routes the interaction into a screen update, conversation, or agent run.
3. The agent logs the turn, runs task judgment, loads recent context and layered recall, and executes tools as needed.
4. Tool results are summarized or offloaded through the memory runtime before the agent continues.
5. The bot sends the final Telegram response.

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
```

- [ ] **Step 4: Add the terminology map and the doc map that links to the deep-dives**

```md
## Terminology map

- **unified scheduler** — the scheduler loop in `src/cron/scheduler.ts`
- **autonomous jobs** — scheduled background jobs stored per job record
- **Memory Update** — the Telegram-managed durable-memory maintenance workflow
- **durable memory** — the protected L0/L1/L2/L3 semantic model
- **task/context offload** — the operational path for L1 evidence, L1.5 task judgment, task canvases, refs, and L4 draft skills
- **public command surface** — `/start`, `/menu`, and `/help`

## Where to read next

- `docs/autonomous-jobs.md` — job model, schedule model, and unified scheduler behavior
- `docs/memory.md` — durable memory, task/context offload, recall, and Memory Update boundaries
- `docs/telegram-flow.md` — menus, callbacks, conversations, and Telegram UX boundaries
```

- [ ] **Step 5: Verify the architecture hub rewrite matches the approved shape**

Run: `git diff -- docs/architecture.md`
Expected: the diff shows `## Runtime in one view`, `## Major runtime layers`, `## Main execution flows`, `## Persistence and storage surfaces`, `## Terminology map`, and `## Where to read next`.

## Task 2: Rewrite `docs/autonomous-jobs.md` as the scheduler/job deep-dive

**Files:**
- Modify: `docs/autonomous-jobs.md`
- Reference: `src/services/autonomous-jobs.ts:5-29`
- Reference: `src/services/autonomous-jobs.ts:131-178`
- Reference: `src/services/autonomous-jobs.ts:217-260`
- Reference: `src/services/memory-update-settings.ts:114-154`
- Reference: `src/cron/scheduler.ts:25-64`
- Reference: `src/tools/local.ts:166-239`
- Reference: `src/bot/conversations/job-create.ts`
- Reference: `src/bot/conversations/job-detail.ts`

- [ ] **Step 1: Replace the file opening with scope, source-of-truth language, and the job model**

```md
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
```

- [ ] **Step 2: Add the schedule model and creation-path distinction**

```md
## Schedule model

Autonomous jobs support three schedule modes:

- `once`
- `interval`
- `cron`

For one-shot work, the service defaults `maxRuns` to `1` unless a different value is explicitly supplied.

## Creation paths

### Menu-created jobs

The Telegram Jobs menu creates stored jobs through the conversation-based job creation flow. This is the primary contributor-facing user path for manual job management.

### Tool-created hybrid jobs

`tdai_create_job` creates `hybrid` jobs. It stores `message_text`, stores the agent prompt separately, and documents that the fixed Telegram message is sent before the agent prompt runs.

This distinction matters because not every stored job has the same prompt shape.
```

- [ ] **Step 3: Add lifecycle, scheduler interaction, and related-doc anchors**

```md
## Runtime execution lifecycle

When a job is due, the runtime:

1. selects it from persisted job state
2. marks or records the run state through the job lifecycle fields
3. executes the autonomous work
4. records completion status, timestamps, and any error text
5. deletes the job if its max-runs limit has been exhausted

## Scheduler interaction and capacity sharing

The unified scheduler runs due autonomous jobs first.

After autonomous jobs consume part of the tick budget, the scheduler can spend the remaining capacity on due Memory Update users. This means autonomous job throughput and Memory Update throughput share the same per-tick dispatch budget.

## Relevant code

- `src/services/autonomous-jobs.ts`
- `src/services/schedules.ts`
- `src/cron/scheduler.ts`
- `src/tools/local.ts`
- `src/bot/conversations/job-create.ts`
- `src/bot/conversations/job-detail.ts`

## Related docs

- `docs/architecture.md`
- `docs/telegram-flow.md`
```

- [ ] **Step 4: Verify the job doc reflects current runtime behavior**

Run: `git diff -- docs/autonomous-jobs.md`
Expected: the diff shows `## Source of truth`, `## Job model`, `## Job types`, `## Schedule model`, `## Creation paths`, `## Runtime execution lifecycle`, and `## Scheduler interaction and capacity sharing`.

## Task 3: Rewrite `docs/memory.md` around durable memory versus task/context offload

**Files:**
- Modify: `docs/memory.md`
- Reference: `src/memory/integration/factory.ts:103-163`
- Reference: `src/memory/core/service.ts:21-28`
- Reference: `src/memory/core/service.ts:217-276`
- Reference: `src/memory/recall/service.ts:153-205`
- Reference: `src/memory/offload/l15.ts:23-63`
- Reference: `src/memory/offload/l15.ts:107-123`
- Reference: `src/memory/offload/l15.ts:157-179`
- Reference: `src/agent/react-agent.ts:105-173`
- Reference: `src/agent/react-agent.ts:216-260`

- [ ] **Step 1: Replace the opening with the protected-boundary framing and the two-path mental model**

````md
# Memory

This document explains the memory runtime boundaries for contributors.

The most important rule is that the runtime has two parallel systems with different purposes:

- **durable memory** for long-lived semantic understanding
- **task/context offload** for operational working context during long or noisy tasks

## Protected boundary

The durable semantic meanings of L0, L1, L2, and L3 are protected. Future runtime changes may evolve storage, recall, or offload mechanics around those layers, but they should not casually redefine the durable model.

## Core mental model

```text
conversation + tool activity
├─ durable memory path
│  └─ L0 conversations -> L1 atoms -> L2 scenarios -> L3 persona
└─ task/context offload path
   └─ L1 evidence -> L1.5 task judgment -> task canvas + refs -> task-aware recall -> optional L4 draft skills
```
````

- [ ] **Step 2: Add the durable-memory section with explicit layer meanings**

```md
## Durable memory layers

### L0 conversations

L0 is the conversation-evidence layer. It preserves transcript-level history that later durable layers can build from.

### L1 atoms

L1 atoms are durable extracted memory units such as stable facts, preferences, constraints, and decisions worth carrying forward.

### L2 scenarios

L2 scenarios group durable meaning into higher-level contextual clusters rather than isolated facts.

### L3 persona

L3 persona is the most distilled durable layer. It captures the slowest-changing high-level understanding of the user and their working patterns.

The durable maintenance path is:

`L0 conversation evidence -> L1 atoms -> L2 scenarios -> L3 persona`

Memory Update maintains this path asynchronously. It is not the owner of inline task continuity.
```

- [ ] **Step 3: Add the task/context offload section, timing model, and worked example**

```md
## Task/context offload layers

### L1 evidence

L1 evidence is the compact operational summary layer for tool and interaction results. It carries forward progress, blockers, verification signals, and key findings for task continuity.

### L1.5 task judgment

L1.5 is a task routing layer. It decides whether a turn starts, continues, completes, or avoids task-scoped context.

### Task canvases

Task canvases are structured task-scoped working summaries used for continuity and recall. They are not the same thing as durable L2 scenarios.

### Refs

Refs store raw offloaded detail when a tool result is too heavy to keep inline.

### L4 draft skills

L4 draft skills are user-triggered, project-local draft artifacts derived from task context. They are not automatically installed runtime behavior.

## Timing model

- task/context offload happens inline during active work
- durable memory maintenance happens later through Memory Update

This is the difference between operational continuity now and semantic consolidation later.

## Worked example

1. a user starts a longer investigation
2. the agent runs tools
3. tool results produce L1 evidence
4. L1.5 decides whether the turn belongs to a long-running task
5. the runtime creates or updates a task canvas when appropriate
6. large tool output is stored as refs while the canvas keeps a compact summary
7. task-aware recall can later inject active or historical task canvases back into context
8. Memory Update later distills durable long-term meaning into L1 atoms, L2 scenarios, and L3 persona
```

- [ ] **Step 4: Add storage boundaries, recall behavior, Memory Update semantics, and contributor invariants**

```md
## Canonical history, indexes, refs, and canvases

- per-chat JSONL history is the canonical transcript record
- SQLite stores structured indexes, memory state, task state, and recall-related records
- refs store heavy raw output
- task canvases store structured task summaries

## Recall behavior

Recall can combine:

- durable persona
- durable scenarios
- durable atoms
- relevant conversation evidence
- the active task canvas
- relevant historical task canvases

## Memory Update workflow

Memory Update is the Telegram-managed durable-memory maintenance workflow. It can run on demand or on a per-user schedule, and it is responsible for refreshing durable L0/L1/L2/L3 outputs.

## Per-user scheduling semantics

Memory Update scheduling is stored per user and supports `interval` and `cron` modes.

## Contributor invariants

- durable L0/L1/L2/L3 semantics are protected
- L1 atoms are not the same thing as L1 evidence
- durable L2 scenarios are not the same thing as task canvases
- L1.5 is a routing layer, not a durable semantic layer
- refs hold raw detail, not the primary summary
- Memory Update maintains durable memory, not task continuity semantics
- L4 draft skills remain drafts until explicitly handled by the user

## Relevant code

- `src/memory/integration/factory.ts`
- `src/memory/core/service.ts`
- `src/memory/recall/service.ts`
- `src/memory/offload/l15.ts`
- `src/agent/react-agent.ts`

## Related docs

- `docs/architecture.md`
- `docs/telegram-flow.md`
```

- [ ] **Step 5: Verify the memory doc preserves the protected model and the new split**

Run: `git diff -- docs/memory.md`
Expected: the diff shows `## Core mental model`, `## Durable memory layers`, `## Task/context offload layers`, `## Timing model`, `## Worked example`, and `## Contributor invariants`.

## Task 4: Rewrite `docs/telegram-flow.md` as the Telegram UI/control-surface deep-dive

**Files:**
- Modify: `docs/telegram-flow.md`
- Reference: `src/bot/bot.ts:22-31`
- Reference: `src/bot/bot.ts:138-255`
- Reference: `src/bot/ui/keyboards.ts`
- Reference: `src/bot/ui/renderers.ts`
- Reference: `src/bot/conversations/memory-update.ts`
- Reference: `src/bot/conversations/memory-update-runner.ts`
- Reference: `src/bot/conversations/job-create.ts`
- Reference: `src/bot/conversations/job-detail.ts`
- Reference: `src/bot/conversations/skill-draft.ts`

- [ ] **Step 1: Replace the opening with the public-surface framing and command boundary**

```md
# Telegram flow

This document explains the Telegram-facing control surface of the runtime.

Use `docs/architecture.md` for the system map. This file owns the command, menu, callback, and conversation boundaries.

## Public command surface

The public Telegram commands are:

- `/start`
- `/menu`
- `/help`

Everything else should be treated as menu/callback/conversation behavior rather than part of a larger public slash-command API.

## Commands vs menus vs conversations

- commands open entry points
- menus provide navigation and screen selection
- callbacks trigger actions or route into deeper flows
- conversations handle multi-step input safely
```

- [ ] **Step 2: Add the main journeys and routing behavior**

```md
## Main menu journeys

The menu is the main navigation hub for:

- Memory
- Skill Drafts
- Jobs
- Help

## Callback and conversation routing

Callbacks are used to move between screens and trigger actions such as opening Memory Update, opening Jobs, refreshing screens, or entering a detail flow.

Conversations are used for flows that need multiple steps, including:

- Memory Update schedule changes
- asynchronous Memory Update run-now handling
- job creation
- job detail editing
- skill draft generation
```

- [ ] **Step 3: Add the service handoff boundary, background UX behavior, and contributor rules**

```md
## Service handoff boundary

The Telegram layer should stay focused on transport, rendering, and routing.

Persistent logic belongs in service and memory layers, not in Telegram UI handlers.

## Background-triggered UX updates

Some Telegram actions do not finish in a single synchronous screen change.

The clearest current example is Memory Update run-now: the callback can trigger background work, and follow-up progress or result messages can arrive later.

## UI principles for contributors

- keep the public command surface small
- prefer menus and callbacks over new public commands
- use conversations for multi-step or confirmation-heavy flows
- keep Telegram handlers thin and delegate persistent behavior to services

## Relevant code

- `src/bot/bot.ts`
- `src/bot/ui/keyboards.ts`
- `src/bot/ui/renderers.ts`
- `src/bot/conversations/memory-update.ts`
- `src/bot/conversations/memory-update-runner.ts`
- `src/bot/conversations/job-create.ts`
- `src/bot/conversations/job-detail.ts`
- `src/bot/conversations/skill-draft.ts`

## Related docs

- `docs/architecture.md`
- `docs/autonomous-jobs.md`
- `docs/memory.md`
```

- [ ] **Step 4: Verify the Telegram flow doc reflects the current menu-driven UI**

Run: `git diff -- docs/telegram-flow.md`
Expected: the diff shows `## Public command surface`, `## Commands vs menus vs conversations`, `## Main menu journeys`, `## Callback and conversation routing`, `## Service handoff boundary`, and `## Background-triggered UX updates`.

## Task 5: Cross-check terminology, links, and contributor navigation across the four docs

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/autonomous-jobs.md`
- Modify: `docs/memory.md`
- Modify: `docs/telegram-flow.md`
- Reference: `docs/superpowers/specs/2026-05-20-contributor-docs-hub-refresh-design.md`

- [ ] **Step 1: Ensure the same cross-links and terminology appear in all four docs**

```md
Cross-link checklist:
- `docs/architecture.md` links to the three deep-dives
- each deep-dive links back to `docs/architecture.md`
- `docs/autonomous-jobs.md` links to `docs/telegram-flow.md` where UI creation/edit flows matter
- `docs/memory.md` links to `docs/telegram-flow.md` where Memory Update UX is referenced

Terminology checklist:
- unified scheduler
- autonomous jobs
- Memory Update
- durable memory
- task/context offload
- public command surface
- menu/callback/conversation flows
```

- [ ] **Step 2: Run a combined diff to confirm only the intended doc set changed**

Run: `git diff -- docs/architecture.md docs/autonomous-jobs.md docs/memory.md docs/telegram-flow.md`
Expected: the diff only covers the four target docs and shows the new hub/deep-dive structure consistently.

- [ ] **Step 3: Run a term check over the four docs**

Run: `git grep -n "unified scheduler\|autonomous jobs\|Memory Update\|durable memory\|task/context offload\|public command surface" -- docs/architecture.md docs/autonomous-jobs.md docs/memory.md docs/telegram-flow.md`
Expected: each target term appears in the docs that own it, and there are no obvious old-terminology holdovers.

- [ ] **Step 4: Do a final editorial pass against the approved spec**

Run: `git diff -- docs/architecture.md docs/autonomous-jobs.md docs/memory.md docs/telegram-flow.md`
Expected: the docs clearly match the approved design: architecture hub, scheduler/job deep-dive, durable-memory versus task/offload split, and Telegram UI boundary.
