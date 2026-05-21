# Memory Writing Flow Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create two separate newcomer-friendly docs in `docs/` that explain how this repo writes durable memory and task/context offload memory, why recall may not reflect everything immediately after chatting, and exactly where a developer should inspect the resulting data.

**Architecture:** Write two parallel guides with the same inspection-first structure. `docs/memory-flow-durable.md` explains the promotion-based `L0 -> L1 -> L2 -> L3` path, while `docs/memory-flow-task-offload.md` explains the immediate tool-driven offload path for L1 evidence, L1.5 task judgment, refs, task canvases, and L4 draft skills. Both guides must tie their explanations to the live runtime entry points and current storage split (`SqliteMemoryBackend` plus `SqliteMemoryStore`) without changing runtime behavior.

**Tech Stack:** Markdown docs, existing TypeScript source as provenance, Bun/SQLite runtime, PowerShell commands for verification.

---

## Source references

- Approved design: `docs/superpowers/specs/2026-05-20-memory-writing-flow-design.md`
- Live agent entry: `src/agent/react-agent.ts`
- Memory composition root: `src/memory/integration/factory.ts`
- Memory service facade: `src/memory/core/service.ts`
- Interaction logging: `src/memory/events/service.ts`
- Durable promotion stages: `src/memory/pipeline/coordinator.ts`, `src/memory/pipeline/l1.ts`, `src/memory/pipeline/l2.ts`, `src/memory/pipeline/l3.ts`
- Task/offload flow: `src/memory/offload/service.ts`
- Recall behavior: `src/memory/recall/service.ts`
- Legacy/backend storage surfaces: `src/memory/backends/sqlite/backend.ts`
- Store-backed runtime surfaces: `src/memory/backends/sqlite/store.ts`
- User-facing recall/ref tools: `src/tools/local.ts`
- Guardrail doc to leave untouched: `docs/memory.md`

## File structure

Create these files:

- `docs/memory-flow-durable.md` — newcomer-focused durable-memory walkthrough for immediate writes, maintenance promotion, storage surfaces, recall usage, and inspection checklists.
- `docs/memory-flow-task-offload.md` — newcomer-focused task/offload walkthrough for tool-result writes, evidence summaries, task routing, canvas updates, task-aware recall, and inspection checklists.

Do not modify these files:

- `docs/memory.md` — keep unchanged.
- Any runtime source file under `src/` — this plan is documentation-only.

---

### Task 1: Write the durable memory guide

**Files:**
- Create: `docs/memory-flow-durable.md`
- Reference only: `src/agent/react-agent.ts`, `src/memory/events/service.ts`, `src/memory/core/service.ts`, `src/memory/pipeline/coordinator.ts`, `src/memory/pipeline/l1.ts`, `src/memory/pipeline/l2.ts`, `src/memory/pipeline/l3.ts`, `src/memory/recall/service.ts`, `src/memory/backends/sqlite/backend.ts`, `src/memory/backends/sqlite/store.ts`

- [ ] **Step 1: Create the durable guide skeleton with the exact section layout**

Create `docs/memory-flow-durable.md` with this initial structure:

```md
# Durable Memory Flow

This guide explains how durable memory is written in this project, why some writes appear immediately while others only appear after maintenance runs, and where to inspect the data after a real chat.

## What durable memory means in this repo

Durable memory is the long-lived path that turns chat evidence into reusable memory layers:

- **L0** conversation evidence
- **L1** memory atoms
- **L2** scenario snapshots
- **L3** persona/profile memory

This path is different from task/context offload memory. Durable memory is the memory that should still matter later, after the current task is over.

## The short version

- Chatting writes raw evidence immediately.
- Durable L1/L2/L3 do **not** all appear immediately after a chat.
- Maintenance/promotion is what turns L0 evidence into L1 atoms, L2 scenarios, and L3 persona memory.
- If recall still looks thin right after chatting, that is often expected.

## Immediate writes vs later writes

## Step-by-step durable write flow

### 1. The live chat loop writes the raw interaction first

### 2. Those chat writes become L0 evidence

### 3. Maintenance promotes L0 evidence into L1 atoms

### 4. L2 groups durable atoms into scenario snapshots

### 5. L3 distills scenarios into persona memory

## Where the durable data lives

## After one chat, what should I inspect?

### Scenario A: one user message, no tool call

### Scenario B: one user message and one assistant reply

### Scenario C: after maintenance runs

## Why durable recall may still look empty or thin

## How recall reads durable memory later

## Source map
```

- [ ] **Step 2: Fill the durable write-flow sections with the current runtime behavior**

Use the source files to write these concrete explanations into `docs/memory-flow-durable.md`:

```md
## Immediate writes vs later writes

| Timing | What gets written | Why it exists |
| --- | --- | --- |
| Immediately during chat | interaction logs, chat history JSONL, store-backed L0 rows | capture raw evidence from the conversation as it happens |
| Later during maintenance | durable L1 atoms, L2 scenarios, L3 persona | turn raw evidence into reusable long-term memory |

## Step-by-step durable write flow

### 1. The live chat loop writes the raw interaction first

In the real runtime, the main chat path starts in `runReactAgent()` and immediately records the user message through `memory.logUserMessage(...)`. When the model finishes, it records the assistant reply through `memory.logAssistantMessage(...)`.

Those writes are not the final durable memory objects yet. They are the raw evidence that later promotion steps depend on.

**Code provenance:** `src/agent/react-agent.ts`, `src/memory/core/service.ts`, `src/memory/events/service.ts`

### 2. Those chat writes become L0 evidence

The interaction logger writes structured interaction rows, appends chat history JSONL, and the memory service mirrors user/assistant turns into the active `SqliteMemoryStore` L0 surface.

That means a developer may see conversation evidence in more than one place:

- `interaction_events`
- `data/history/<chatId>.jsonl`
- `memory_store_l0`

This is one reason the system can feel confusing at first: the repo has both broad backend tables and newer store-backed runtime tables.

**Code provenance:** `src/memory/events/service.ts`, `src/memory/core/service.ts`, `src/memory/backends/sqlite/store.ts`

### 3. Maintenance promotes L0 evidence into L1 atoms

Durable memory atoms are created later by the pipeline coordinator, not by the basic chat loop alone. The coordinator looks for pending L0 evidence after a checkpoint, runs the L1 extraction prompt, and writes durable atoms.

That promotion writes into the durable atom surfaces and lineage links the extracted atoms back to their supporting conversation turns.

**Code provenance:** `src/memory/pipeline/coordinator.ts`, `src/memory/pipeline/l1.ts`, `src/memory/backends/sqlite/backend.ts`

### 4. L2 groups durable atoms into scenario snapshots

After new L1 atoms exist, the L2 stage turns them into a scenario snapshot. This is a higher-level grouped memory layer that summarizes related atoms together.

The result is stored in the backend scenario table and also mirrored into the store-backed profile surface used by the current runtime.

**Code provenance:** `src/memory/pipeline/l2.ts`, `src/memory/backends/sqlite/backend.ts`, `src/memory/backends/sqlite/store.ts`

### 5. L3 distills scenarios into persona memory

The L3 stage turns the latest scenario snapshot into a persona/profile summary for the user. That persona is what recall can surface as the highest-level durable context.

Like L2, it writes through the backend and the store-backed profile path.

**Code provenance:** `src/memory/pipeline/l3.ts`, `src/memory/backends/sqlite/backend.ts`, `src/memory/backends/sqlite/store.ts`
```

- [ ] **Step 3: Add the storage map, inspection checklist, recall explanation, and source map**

Append these concrete sections to `docs/memory-flow-durable.md`:

```md
## Where the durable data lives

The durable path can touch several storage surfaces:

- `interaction_events` — raw structured interaction logging
- `conversations` — backend conversation rows used as durable evidence input
- `memory_store_l0` — current store-backed L0 conversation surface
- `memory_atoms` — backend durable L1 atoms
- `memory_store_l1` — current store-backed L1 records
- `memory_scenarios` — backend L2 scenario snapshots
- store-backed L2 profiles — current runtime profile mirror for scenario recall
- `personas` — backend L3 persona/profile row
- store-backed L3 profiles — current runtime profile mirror for persona recall
- `lineage_links` — provenance between conversation turns, atoms, scenarios, and persona
- `pipeline_checkpoints` — progress markers that determine what promotion runs next
- `data/history/<chatId>.jsonl` — append-only chat history evidence

## After one chat, what should I inspect?

### Scenario A: one user message, no tool call

You should expect raw evidence first, not a full durable memory promotion.

Check these places first:

- `interaction_events` for the user message row
- `data/history/<chatId>.jsonl` for the appended chat-history row
- `memory_store_l0` for the mirrored L0 conversation record

You should **not** assume that `memory_atoms`, `memory_scenarios`, or `personas` changed yet.

### Scenario B: one user message and one assistant reply

You should expect the same raw-evidence surfaces plus the assistant reply:

- `interaction_events`
- `data/history/<chatId>.jsonl`
- `memory_store_l0`

If you only chatted and did not run maintenance, it is still normal for durable L1/L2/L3 to remain unchanged.

### Scenario C: after maintenance runs

Now you should expect promotion artifacts too:

- `memory_atoms` and `memory_store_l1`
- `memory_scenarios` and the store-backed L2 profile mirror
- `personas` and the store-backed L3 profile mirror
- `lineage_links`
- `pipeline_checkpoints`

## Why durable recall may still look empty or thin

Common reasons:

- maintenance has not run yet
- the latest chat did not produce any durable L1 extraction
- L2 skipped because there were no new atoms
- L3 skipped because no scenario was produced
- recall is reading store-backed surfaces the developer did not inspect first

## How recall reads durable memory later

Recall does not read just one table. It merges multiple durable layers:

- persona/profile memory
- scenario snapshots
- L1 atom results
- related conversation evidence

That merged behavior is why one missing table does not always mean recall is broken, and one visible table does not guarantee the model is using only that source.

**Code provenance:** `src/memory/recall/service.ts`, `src/memory/core/service.ts`, `src/tools/local.ts`

## Source map

- `src/agent/react-agent.ts`
- `src/memory/events/service.ts`
- `src/memory/core/service.ts`
- `src/memory/pipeline/coordinator.ts`
- `src/memory/pipeline/l1.ts`
- `src/memory/pipeline/l2.ts`
- `src/memory/pipeline/l3.ts`
- `src/memory/recall/service.ts`
- `src/memory/backends/sqlite/backend.ts`
- `src/memory/backends/sqlite/store.ts`
```

- [ ] **Step 4: Verify the durable guide contains the required inspection-first sections**

Run:

```powershell
Select-String -Path "docs/memory-flow-durable.md" -Pattern '^## '
```

Expected: output includes headings for `What durable memory means in this repo`, `Immediate writes vs later writes`, `Step-by-step durable write flow`, `Where the durable data lives`, `After one chat, what should I inspect?`, `Why durable recall may still look empty or thin`, and `How recall reads durable memory later`.

- [ ] **Step 5: Commit the durable guide if commits were explicitly requested for the execution session**

```powershell
git add -- "docs/memory-flow-durable.md"
git commit -m @'
docs: add durable memory flow guide

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

If commits were not requested, skip this step and leave the change uncommitted.

---

### Task 2: Write the task/context offload guide

**Files:**
- Create: `docs/memory-flow-task-offload.md`
- Reference only: `src/agent/react-agent.ts`, `src/memory/offload/service.ts`, `src/memory/core/service.ts`, `src/memory/recall/service.ts`, `src/memory/backends/sqlite/backend.ts`, `src/tools/local.ts`

- [ ] **Step 1: Create the task/offload guide skeleton with the exact section layout**

Create `docs/memory-flow-task-offload.md` with this initial structure:

```md
# Task and Context Offload Memory Flow

This guide explains the tool-driven working-memory path in this project: what gets written during tool execution, how task context is tracked, how offloaded refs and task canvases are stored, and how task-aware recall reads those artifacts later.

## What task/context memory means in this repo

This path covers:

- L1 evidence summaries
- L1.5 task judgment
- offload refs
- task graph nodes
- task canvases
- task-aware recall
- optional L4 draft skills

This is different from durable `L0 -> L1 -> L2 -> L3` memory. It is the working-context path for long-running or tool-heavy tasks.

## The short version

- Tool execution can create task-context writes immediately.
- Large raw results may be offloaded into ref files.
- Task canvases summarize working progress without waiting for durable promotion.
- Task-aware recall can read this path even when durable memory has not changed.

## Immediate writes in the task/offload path

## Step-by-step task/offload write flow

### 1. The agent logs the tool call and gets the raw result

### 2. The result stays inline or becomes an offload ref

### 3. L1 evidence is written for the tool result

### 4. L1.5 task judgment decides whether the work belongs to a long-running task

### 5. Task metadata and task canvases are updated

### 6. Task-aware recall reads the active or historical task context

### 7. L4 draft skills stay downstream of task artifacts

## Where the task/offload data lives

## After a tool-heavy chat, what should I inspect?

### Scenario A: short inline tool result

### Scenario B: large offloaded tool result

### Scenario C: long-running task with a canvas

## Why task artifacts may exist even when durable memory did not change

## How task-aware recall uses these writes later

## Source map
```

- [ ] **Step 2: Fill the task/offload flow sections with the current runtime behavior**

Use the source files to write these concrete explanations into `docs/memory-flow-task-offload.md`:

```md
## Immediate writes in the task/offload path

Unlike durable L1/L2/L3 promotion, the task/offload path is mostly immediate. When the agent calls a tool, the runtime can log the tool call, summarize the result, offload the raw output, write task evidence, and update a task canvas in the same chat loop.

## Step-by-step task/offload write flow

### 1. The agent logs the tool call and gets the raw result

The live agent loop records the tool call before executing it, then captures the raw tool result after execution.

**Code provenance:** `src/agent/react-agent.ts`

### 2. The result stays inline or becomes an offload ref

The offload service decides whether the raw tool result is short enough to stay inline or large enough to be written into a separate ref file. Large outputs get a `nodeId`, a `resultRef`, and an offload markdown file.

**Code provenance:** `src/memory/offload/service.ts`, `src/memory/backends/sqlite/backend.ts`

### 3. L1 evidence is written for the tool result

Every tool result also produces a compact evidence summary so the task path can keep progress, blockers, and verification signals without carrying the full raw output in the main context.

**Code provenance:** `src/memory/offload/service.ts`, `src/memory/backends/sqlite/backend.ts`

### 4. L1.5 task judgment decides whether the work belongs to a long-running task

The runtime judges whether the current chat should attach work to a long-running task, continue an old task, close one, or stay short-term only.

**Code provenance:** `src/agent/react-agent.ts`, `src/memory/core/service.ts`, `src/memory/backends/sqlite/backend.ts`

### 5. Task metadata and task canvases are updated

When task routing is active, task graph nodes, evidence mappings, and Mermaid task canvases are updated so the system has an inspectable working-memory artifact.

**Code provenance:** `src/memory/offload/service.ts`, `src/memory/backends/sqlite/backend.ts`

### 6. Task-aware recall reads the active or historical task context

Later recall can return the active task canvas for the current chat and also search historical task canvases when task-aware recall is enabled.

**Code provenance:** `src/memory/recall/service.ts`, `src/memory/core/service.ts`, `src/tools/local.ts`

### 7. L4 draft skills stay downstream of task artifacts

Draft skills are generated from selected task artifacts later. They are reviewable outputs built from task evidence and task canvases, not automatically installed memory.

**Code provenance:** `src/memory/core/service.ts`, `src/memory/backends/sqlite/backend.ts`
```

- [ ] **Step 3: Add the storage map, inspection checklist, recall explanation, and source map**

Append these concrete sections to `docs/memory-flow-task-offload.md`:

```md
## Where the task/offload data lives

The task/context path can touch these storage surfaces:

- `interaction_events` — tool call and tool result logging
- `data/history/<chatId>.jsonl` — tool activity mirrored into chat history
- `memory_offload_refs` — metadata for large offloaded results
- `memory_task_nodes` — task graph nodes tied to tool execution
- `memory_l1_evidence_entries` — compact L1 evidence summaries for tool results
- `memory_l15_judgments` — task-routing decisions
- `memory_task_boundaries` — task boundary records
- `memory_task_canvases` — task canvas metadata
- `memory_task_canvas_fts` — searchable task canvas text
- `data/memory/refs/<chatId>/<node>.md` — raw offloaded result files
- `data/memory/jsonl/l1/<chat>.jsonl` — JSONL mirror for L1 evidence
- `data/memory/task-canvases/...` — Mermaid task-canvas files
- generated skill draft files and metadata — downstream L4 artifacts

## After a tool-heavy chat, what should I inspect?

### Scenario A: short inline tool result

Expect:

- `interaction_events` tool call/result rows
- `data/history/<chatId>.jsonl`
- a `memory_task_nodes` entry
- a `memory_l1_evidence_entries` row

You may **not** see an offload ref file if the result stayed inline.

### Scenario B: large offloaded tool result

Expect everything from the inline case plus:

- `memory_offload_refs`
- a `resultRef` / `nodeId`
- `data/memory/refs/<chatId>/<node>.md`

### Scenario C: long-running task with a canvas

Expect task-routing and canvas artifacts too:

- `memory_l15_judgments`
- `memory_task_boundaries`
- `memory_task_canvases`
- `memory_task_canvas_fts`
- `data/memory/task-canvases/...`

## Why task artifacts may exist even when durable memory did not change

Task/context memory is meant to support active work immediately. A task canvas can be updated in the current chat loop even if durable L1 atoms, L2 scenarios, and L3 persona have not been promoted yet.

That is expected behavior, not a contradiction.

## How task-aware recall uses these writes later

Task-aware recall can return:

- the active task canvas for the current chat
- related historical task canvases
- offload refs that a developer or tool can read directly when the canvas summary is too small

This path complements durable recall. It does not replace durable L0/L1/L2/L3 memory.

**Code provenance:** `src/memory/recall/service.ts`, `src/memory/core/service.ts`, `src/tools/local.ts`

## Source map

- `src/agent/react-agent.ts`
- `src/memory/offload/service.ts`
- `src/memory/core/service.ts`
- `src/memory/recall/service.ts`
- `src/memory/backends/sqlite/backend.ts`
- `src/tools/local.ts`
```

- [ ] **Step 4: Verify the task/offload guide contains the required inspection-first sections**

Run:

```powershell
Select-String -Path "docs/memory-flow-task-offload.md" -Pattern '^## '
```

Expected: output includes headings for `What task/context memory means in this repo`, `Immediate writes in the task/offload path`, `Step-by-step task/offload write flow`, `Where the task/offload data lives`, `After a tool-heavy chat, what should I inspect?`, `Why task artifacts may exist even when durable memory did not change`, and `How task-aware recall uses these writes later`.

- [ ] **Step 5: Commit the task/offload guide if commits were explicitly requested for the execution session**

```powershell
git add -- "docs/memory-flow-task-offload.md"
git commit -m @'
docs: add task offload memory flow guide

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

If commits were not requested, skip this step and leave the change uncommitted.

---

### Task 3: Cross-review both guides against the approved design and current source

**Files:**
- Modify if needed: `docs/memory-flow-durable.md`
- Modify if needed: `docs/memory-flow-task-offload.md`
- Reference only: `docs/superpowers/specs/2026-05-20-memory-writing-flow-design.md`

- [ ] **Step 1: Check that only the two new docs changed**

Run:

```powershell
git diff --name-only -- "docs"
```

Expected: output includes only:

```text
docs/memory-flow-durable.md
docs/memory-flow-task-offload.md
```

If `docs/memory.md` appears, remove that change before continuing.

- [ ] **Step 2: Verify that both docs cite the live runtime and memory source files**

Run:

```powershell
Select-String -Path "docs/memory-flow-durable.md","docs/memory-flow-task-offload.md" -Pattern "src/agent/react-agent.ts|src/memory/events/service.ts|src/memory/pipeline/coordinator.ts|src/memory/offload/service.ts|src/memory/recall/service.ts|src/memory/backends/sqlite/backend.ts|src/memory/backends/sqlite/store.ts|src/tools/local.ts"
```

Expected: the durable guide includes the durable-path citations, and the task/offload guide includes the tool/offload/task-recall citations.

- [ ] **Step 3: Verify formatting and consistency**

Run:

```powershell
git diff --check -- "docs/memory-flow-durable.md" "docs/memory-flow-task-offload.md"
```

Expected: no output.

Then manually confirm these statements are all true:

- the durable guide clearly says chat writes evidence first and promotes L1/L2/L3 later
- the task/offload guide clearly says task/context writes are mostly immediate
- both guides include an inspection checklist
- both guides explain why the developer may not see every layer immediately
- neither guide tells the reader to inspect `docs/memory.md`

- [ ] **Step 4: Do a final proofreading pass for newcomer clarity**

Make these final edits if needed:

- shorten any sentence that mixes durable and task memory in one paragraph
- replace abstract phrases like “promotion semantics” with plain language like “maintenance turns saved chat evidence into durable memory”
- ensure every storage name appears next to a plain-English explanation of what it stores
- ensure every “why you may not see it yet” section is explicit, not implied

- [ ] **Step 5: Commit the reviewed docs if commits were explicitly requested for the execution session**

```powershell
git add -- "docs/memory-flow-durable.md" "docs/memory-flow-task-offload.md"
git commit -m @'
docs: add memory writing flow guides

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

If commits were not requested, skip this step and leave the changes uncommitted.
