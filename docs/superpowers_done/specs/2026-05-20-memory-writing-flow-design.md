# Memory Writing Flow Documentation Design

Date: 2026-05-20
Status: Approved in brainstorming

## Summary

This design adds two new end-user-facing documentation guides under `docs/` that explain how memory is written in this project and how those writes later affect recall. The guides are aimed at new engineers who currently cannot tell what should appear after chatting with the agent, which writes happen immediately versus later, and which tables/files they should inspect to verify that the memory pipeline is working.

The documentation will explicitly separate the two memory paths that currently get conflated:

1. **Durable memory** for `L0 -> L1 -> L2 -> L3`
2. **Task/context offload memory** for `L1 evidence -> L1.5 task judgment -> refs/task nodes/task canvases -> task-aware recall -> optional L4 draft skills`

The docs will be inspection-first, not just architecture-first. Each step will explain what triggers the write, which service performs it, where it is stored, whether recall can use it immediately, and why a reader may not see it yet after a real chat.

## Goals

- Create newcomer-friendly docs that explain the memory writing flow in plain language.
- Make the durable memory pipeline understandable as a distinct path from task/context offload.
- Explain which writes happen immediately during a chat and which only appear after maintenance/promotions run.
- Show where data is stored in SQLite, JSONL, offload refs, and Mermaid/task canvas files.
- Show how recall reads those stored artifacts later, so the purpose of each write is obvious.
- Add explicit inspection checklists so a reader can verify what should exist after one chat with the agent.
- Use code provenance references so readers can trace each explanation back to the implementation.

## Non-Goals

- Changing memory runtime behavior.
- Fixing missing logs, missing writes, or recall bugs as part of this task.
- Rewriting or replacing `docs/memory.md`.
- Merging durable memory and task/offload memory into one giant guide.
- Documenting every unrelated memory feature in the repo.

## Audience

Primary audience: **new engineers**.

The docs should assume the reader does not yet understand this project's memory model, storage split, or promotion timing. They should use simple language first, then add code/storage details once the mental model is clear.

## Deliverables

Create two separate guides under `docs/`:

1. `docs/memory-flow-durable.md`
2. `docs/memory-flow-task-offload.md`

Do **not** update `docs/memory.md`. These guides are intentionally separate from the current high-level memory overview.

## Current-State Context

### Core runtime composition

The live memory runtime is composed in `src/memory/integration/factory.ts` and wires together:

- `SqliteMemoryBackend`
- `SqliteMemoryStore`
- `RecallService`
- `InteractionLogService`
- `OffloadService`
- `PipelineCoordinator`
- `MemoryService`

**Provenance:** `src/memory/integration/factory.ts:103-162`

This matters because the docs must explain both the older backend tables and the newer store-backed surfaces that are both visible in the runtime.

### Real chat write path

A real chat goes through `runReactAgent()` in `src/agent/react-agent.ts`.

The live runtime currently does the following during an agent run:

1. Logs the user message immediately.
2. Runs L1.5 task judgment immediately.
3. Loads recall before answering.
4. Logs tool calls immediately.
5. Offloads or summarizes tool results immediately.
6. Logs the assistant message immediately.

**Provenance:** `src/agent/react-agent.ts:105-307`

This is important because users currently expect durable memory objects to appear right after a chat, but the code only guarantees some writes immediately.

### Immediate writes vs promoted writes

The design must make one critical distinction explicit:

- **Immediate writes during chat/tool execution** include interaction logs, history JSONL, store-backed L0 rows, task judgment metadata, L1 evidence summaries, offload refs, task graph nodes, and task canvases.
- **Promoted durable memory writes** such as durable L1 atoms, L2 scenarios, and L3 persona are created by maintenance/pipeline promotion, not by the basic chat loop alone.

**Provenance:**
- immediate interaction writes: `src/memory/events/service.ts:33-196`
- store-backed L0 mirroring: `src/memory/core/service.ts:411-505`
- offload/task writes: `src/memory/offload/service.ts:71-358`
- durable promotion pipeline: `src/memory/pipeline/coordinator.ts:65-177`

## Documentation Architecture

### Guide 1: Durable memory

`docs/memory-flow-durable.md` will explain the durable memory path.

#### Purpose

Teach readers how raw conversation activity becomes durable memory over time, and why recall may still look thin immediately after chatting.

#### Required sections

1. **What durable memory means here**
   - Define L0, L1, L2, L3 in project terms.
   - Explain that this is the long-lived memory path.

2. **Mental model: chat now, promotion later**
   - State that chatting writes evidence immediately.
   - State that L1/L2/L3 are derived/promoted later by maintenance.

3. **Step-by-step durable write flow**
   - User/assistant messages are logged.
   - L0 evidence is stored.
   - Maintenance picks up pending L0 evidence.
   - L1 extraction writes durable atoms.
   - L2 synthesis writes scenario snapshots.
   - L3 synthesis upserts persona.
   - Recall reads these layers back.

4. **Where each durable write lives**
   - `interaction_events`
   - `conversations`
   - `memory_store_l0`
   - `memory_atoms`
   - `memory_store_l1`
   - `memory_scenarios`
   - store-backed L2 profiles
   - `personas`
   - store-backed L3 profiles
   - lineage links and checkpoints
   - chat history JSONL where relevant

5. **Why recall may not show durable memory yet**
   - No maintenance run yet
   - No extractable L1 memory created
   - L2/L3 skipped because there were no new atoms or no scenario
   - Recall may be reading store-backed records that do not map 1:1 to older tables a reader expected to inspect

6. **Inspection checklist after one chat**
   - What should exist immediately
   - What only exists after maintenance
   - Where to look first if the reader is debugging visibility

7. **Recall connection**
   - Explain how `RecallService` reads persona, scenarios, atoms, and conversations
   - Explain that recall merges multiple sources and may prefer store-backed records

#### Implementation provenance to cite in this guide

- real chat entry: `src/agent/react-agent.ts:113-205`
- interaction logging: `src/memory/events/service.ts:33-196`
- store-backed L0 mirroring: `src/memory/core/service.ts:411-505`
- durable save path: `src/memory/core/service.ts:372-409`
- L1 extraction: `src/memory/pipeline/l1.ts:121-193`
- L2 synthesis: `src/memory/pipeline/l2.ts:36-86`
- L3 synthesis: `src/memory/pipeline/l3.ts:27-63`
- maintenance orchestration/checkpoints: `src/memory/pipeline/coordinator.ts:65-177`
- durable backend tables: `src/memory/backends/sqlite/backend.ts:262-772`
- store-backed L0/L1 surfaces: `src/memory/backends/sqlite/store.ts:520-940`
- recall merge behavior: `src/memory/recall/service.ts:153-255`

### Guide 2: Task/context offload memory

`docs/memory-flow-task-offload.md` will explain the task/context memory path.

#### Purpose

Teach readers that task/context memory is a separate working-memory path optimized for tool-heavy sessions, long-running tasks, and inspectable offload artifacts.

#### Required sections

1. **What task/context memory means here**
   - Define L1 evidence, L1.5, refs, task nodes, task canvases, task-aware recall, and L4 draft skills.
   - State clearly that this is not the same as durable L0/L1/L2/L3.

2. **Mental model: immediate working context path**
   - Tool execution can produce task-context writes immediately.
   - These writes are meant to keep working context visible without waiting for durable promotion.

3. **Step-by-step task/offload write flow**
   - Tool call is logged.
   - Raw result stays inline or is offloaded.
   - Summary/L1 evidence entry is written.
   - L1.5 judges task routing.
   - Task node/ref metadata is written.
   - Task canvas is written or patched.
   - Task-aware recall can surface the active or historical task context.
   - L4 draft skills can later be generated from completed task artifacts.

4. **Where each task/offload write lives**
   - `interaction_events`
   - history JSONL for tool activity
   - `memory_offload_refs`
   - `memory_task_nodes`
   - `memory_l1_evidence_entries`
   - `memory_l15_judgments`
   - `memory_task_boundaries`
   - `memory_task_canvases`
   - `memory_task_canvas_fts`
   - `data/memory/refs/...`
   - `data/memory/jsonl/l1/...`
   - `data/memory/task-canvases/...`
   - generated skill draft files/metadata for L4

5. **When a reader should expect these writes to appear**
   - after any tool execution
   - after offload threshold decisions
   - after long-task routing decisions
   - after canvas patching or fallback canvas generation

6. **Inspection checklist after a tool-heavy chat**
   - what should exist after a short inline tool result
   - what additional artifacts appear after a large offloaded tool result
   - why a task canvas may exist even when durable persona/scenario memory has not changed

7. **Recall connection**
   - explain active task canvas vs historical task canvases
   - explain when offload refs need to be read directly because the canvas summary is insufficient
   - explain that task-aware recall is meant to complement durable recall, not replace it

8. **L4 boundary**
   - explain that draft skills are derived from task artifacts and are reviewable outputs, not auto-installed durable memory

#### Implementation provenance to cite in this guide

- task judgment from live chat: `src/agent/react-agent.ts:119-139`
- tool call/result handling: `src/agent/react-agent.ts:218-289`
- offload processing and canvas writes: `src/memory/offload/service.ts:71-358`
- task-aware memory API: `src/memory/core/service.ts:538-679`
- task/offload backend writes: `src/memory/backends/sqlite/backend.ts:860-1468`
- task-aware recall reads: `src/memory/recall/service.ts:153-205`
- local tools that expose recall/ref reads: `src/tools/local.ts:50-150`

## Shared Documentation Pattern

Both guides should use the same per-step explanation template so readers can compare the two pipelines easily.

For each major step, document:

1. **Trigger** — what starts the write
2. **Writer** — service/function that writes it
3. **Storage** — table/file/index/artifact updated
4. **Immediate or deferred** — whether it appears during the chat loop or after maintenance
5. **Recall impact** — how later reads use it
6. **How to inspect it** — what a developer should check after a real chat
7. **Why it might be missing** — common reasons a reader would not see it yet

## Inspection-First Requirements

The docs must directly answer the practical question:

> “I just chatted with the agent. What should I see now, where, and what will only appear later?”

That means each guide must include explicit checklists such as:

- **After one user message with no tools**
- **After one user message and one assistant reply**
- **After a tool call with a short inline result**
- **After a tool call with a large offloaded result**
- **After maintenance runs**

The docs should avoid promising that all memory layers update immediately. The writing must reflect the current implementation precisely.

## Key Concepts the Docs Must Clarify

1. `logUserMessage` / `logAssistantMessage` are the live chat writes, not `logTurn`, for the main agent loop.
2. `SqliteMemoryStore` is in the active runtime and mirrors key L0/L1/L2/L3 data in addition to older backend tables.
3. Durable memory is promotion-based and checkpoint-driven.
4. Task/context memory is immediate and tool-driven.
5. Recall merges multiple sources, so the most obvious table is not always the one powering what the model sees.
6. Missing durable recall right after chatting is often expected behavior, not automatically a bug.

## Writing Style Requirements

- Use newcomer-friendly language.
- Prefer “what happens” and “why” before “schema details”.
- Keep the two guides parallel in structure so readers can compare them.
- Include code provenance in the body where claims depend on specific files or flows.
- Avoid abstract vendor-history discussion except where it helps explain the current storage split.
- Be explicit about immediacy, timing, and inspectability.

## Success Criteria

A new engineer reading the two guides should be able to answer all of the following without reading the source first:

- What is durable memory in this project?
- What is task/context offload memory in this project?
- Which writes happen immediately during chat?
- Which writes only appear after maintenance/promotions run?
- Why might recall still look empty or thin after chatting?
- Which tables/files/artifacts should I inspect after a real chat?
- Which code paths own the writes for durable memory?
- Which code paths own the writes for task/offload memory?
- How does recall use each stored layer later?

## Out of Scope Follow-Up Opportunities

The docs may reveal genuine runtime confusion worth fixing later, but those should be treated as follow-up work rather than part of this documentation design. Likely future follow-ups include:

- a dedicated troubleshooting guide for memory visibility bugs
- runtime instrumentation improvements around promotion timing
- a small developer command/checklist for inspecting live memory state after a chat
- simplification of overlapping backend/store write surfaces if the current split remains confusing
