# Task and Context Offload Memory Flow

This guide explains the tool-driven working-memory path in this project: what gets written during tool execution, how task context is tracked, how offloaded refs and task canvases are stored, and how task-aware recall reads those artifacts later.

This guide exists because the task/context path is easy to confuse with durable memory. They are related, but they are not the same thing.

## What task/context memory means in this repo

The task/context path is the working-memory side of the system. It is meant to keep active tool-heavy work understandable without waiting for full durable-memory promotion.

This path covers:

| Term | Meaning | What it stores |
| --- | --- | --- |
| **L1 evidence** | compact tool-result summaries | short progress, blocker, or verification evidence derived from tool output |
| **L1.5 task judgment** | task routing decision | whether the current chat is a long task, continuation, completion, or short-only work |
| **offload refs** | raw-result storage | large tool outputs saved to separate markdown files |
| **task graph nodes** | task execution metadata | structured records tied to tool calls/results |
| **task canvases** | working-memory summary | Mermaid files that summarize active task context |
| **task-aware recall** | recall over task artifacts | active canvas plus relevant historical canvases |
| **L4 draft skills** | downstream artifact generation | reviewable skill drafts built from selected task artifacts |

This is different from durable `L0 -> L1 -> L2 -> L3` memory. Durable memory tries to preserve long-lived knowledge. The task/context path tries to keep active work understandable right now.

## The short version

- Tool execution can create task-context writes immediately.
- Large raw tool results may be offloaded into ref files.
- The system can write evidence rows even when it does **not** create a task canvas.
- Task canvases appear only when the chat has been routed into a long-running task.
- Task-aware recall can use this path even when durable memory has not changed.

## Immediate writes in the task/offload path

Unlike durable `L1`/`L2`/`L3` promotion, the task/offload path is mostly immediate.

During one live tool loop, the runtime can:

- log the tool call
- execute the tool
- decide whether the result stays inline or becomes an offload ref
- write a compact L1 evidence summary
- write task node metadata
- update a task canvas when task routing is active
- log the final tool result event

That means this path is often the first place you should inspect after a tool-heavy chat.

## Step-by-step task/offload write flow

### 1. L1.5 task judgment runs before the tool loop

The live agent path records the user message, then immediately calls `memory.judgeTaskTurn(...)` in `src/agent/react-agent.ts:119-124`.

That logic lives in `MemoryService.judgeTaskTurn()` at `src/memory/core/service.ts:538-603`. It decides whether the latest user message:

- belongs to a long-running task
- continues an older task
- completes an active task
- should stay short-term only

The backend writes for this decision are:

- `memory_l15_judgments` through `recordL15Judgment(...)` at `src/memory/backends/sqlite/backend.ts:940-976`
- `memory_task_boundaries` through `insertTaskBoundary(...)` at `src/memory/backends/sqlite/backend.ts:978-996`
- `memory_task_canvases` when a new long task is created through `createTaskCanvas(...)` at `src/memory/backends/sqlite/backend.ts:860-904`

Important nuance: the tool path can still write evidence even when `L1.5` decides there is **no** long-running task.

### 2. The agent logs the tool call and gets the raw result

Inside the live tool loop, `runReactAgent()` logs the tool call before execution and then captures the raw result afterward at `src/agent/react-agent.ts:218-252`.

The immediate logging surfaces are:

- `interaction_events` via `logToolCall(...)` and `logToolResult(...)`
- `data/history/<chatId>.jsonl` through the same interaction logger

These writes tell you that the tool ran, even before you inspect offload refs or task canvases.

### 3. The result stays inline or becomes an offload ref

The raw tool result is passed to `memory.offloadToolResult(...)` at `src/agent/react-agent.ts:244-252`, which delegates to `OffloadService.offloadToolResult()` at `src/memory/offload/service.ts:71-196`.

The service does two different things depending on size:

#### Short result: inline path

If the result is shorter than the offload threshold:

- it does **not** create an offload ref file
- it writes a `memory_task_nodes` row through `insertTaskGraphNode(...)`
- it still writes L1 evidence through `insertL1EvidenceEntry(...)`

That is why you may see task/evidence metadata even when no ref file exists.

#### Large result: offload path

If the result is large enough to offload:

- it writes a markdown ref file under `data/memory/refs/...`
- it writes `memory_offload_refs`
- it writes a corresponding `memory_task_nodes` row
- it returns a `nodeId` and `resultRef`

The combined metadata write happens through `insertOffloadRefWithTaskGraphNode(...)` at `src/memory/backends/sqlite/backend.ts:1179-1214`.

### 4. L1 evidence is written for the tool result

Every tool result, inline or offloaded, produces a compact evidence summary through `persistL1Evidence(...)` at `src/memory/offload/service.ts:213-247`.

That evidence is stored in:

- `memory_l1_evidence_entries`
- `data/memory/jsonl/l1/<chat>.jsonl` when JSONL export is enabled

The backend write is implemented in `insertL1EvidenceEntry(...)` at `src/memory/backends/sqlite/backend.ts:1313-1353`.

This evidence layer is important because it lets the system keep progress, blockers, and verification signals without dragging the full raw tool output back into the main context.

### 5. Task metadata and task canvases are updated only when a task is active

After writing evidence, `OffloadService` tries to update the task canvas through `tryWriteTaskCanvas(...)` and `writeTaskCanvas(...)` at `src/memory/offload/service.ts:293-358`.

This only matters when `taskId` exists. If the chat was not routed into a long-running task, `writeTaskCanvas()` exits early at `src/memory/offload/service.ts:293-300`.

When a task **is** active, the runtime can update:

- `memory_task_canvases`
- `memory_task_canvas_fts`
- the actual Mermaid file under `data/memory/task-canvases/...`
- node-to-Mermaid mappings through `updateL1EvidenceNodeMapping(...)`

There are two canvas-write modes:

1. **Patch mode** — uses semantic L2 patch generation when there is enough pending evidence
2. **Fallback mode** — builds a simpler Mermaid view directly from task graph nodes

This distinction matters because you may see a real task canvas file even if the system did not produce a rich semantic patch.

### 6. Task-aware recall reads the active or historical task context

`RecallService.recall()` at `src/memory/recall/service.ts:153-205` can read:

- the active task canvas for the current chat through `getTaskCanvas(chatId)`
- relevant historical task canvases through `searchTaskCanvases(...)`

That is why task-aware recall can stay useful even when durable `L1`/`L2`/`L3` promotion has not changed yet.

User-facing tooling exposes the same idea through:

- `tdai_memory_search` at `src/tools/local.ts:53-81`
- `tdai_context_ref_read` at `src/tools/local.ts:101-115`

### 7. L4 draft skills stay downstream of task artifacts

Draft skills are generated later from selected task artifacts through `generateSkillDraft(...)` at `src/memory/core/service.ts:618-679`.

That flow depends on:

- a task canvas
- task graph nodes
- linked evidence
- backend generated-skill metadata at `src/memory/backends/sqlite/backend.ts:1426-1518`

These are reviewable downstream outputs. They are **not** automatically installed durable memory.

## Where the task/offload data lives

The task/context path can touch these storage surfaces:

### Immediate logging surfaces

- `interaction_events` — tool call and tool result logging
- `data/history/<chatId>.jsonl` — tool activity mirrored into chat history

### Task-routing and metadata surfaces

- `memory_l15_judgments` — task-routing decisions
- `memory_task_boundaries` — task boundary records
- `memory_task_canvases` — task canvas metadata
- `memory_task_nodes` — task graph nodes tied to tool execution

### Evidence and recall surfaces

- `memory_l1_evidence_entries` — compact L1 evidence summaries for tool results
- `memory_task_canvas_fts` — searchable task canvas text
- `data/memory/jsonl/l1/<chat>.jsonl` — JSONL mirror for L1 evidence, when enabled
- `data/memory/task-canvases/...` — Mermaid task-canvas files

### Raw-result offload surfaces

- `memory_offload_refs` — metadata for large offloaded results
- `data/memory/refs/<chatId>/<node>.md` — raw offloaded result files

### L4 downstream artifacts

- generated skill draft files
- backend generated-skill metadata rows

## After a tool-heavy chat, what should I inspect?

### Scenario A: short inline tool result

Expect:

- `interaction_events` tool-call and tool-result rows
- `data/history/<chatId>.jsonl`
- a `memory_task_nodes` row
- a `memory_l1_evidence_entries` row

You may **not** see:

- an offload ref file
- a `memory_offload_refs` row
- a task canvas, if `L1.5` did not route the chat into a long-running task

### Scenario B: large offloaded tool result

Expect everything from the inline case plus:

- `memory_offload_refs`
- a `nodeId`
- a `resultRef`
- `data/memory/refs/<chatId>/<node>.md`

If the chat is still short-term only, you may still get the ref and evidence rows without a task canvas.

### Scenario C: long-running task with a canvas

Expect task-routing and canvas artifacts too:

- `memory_l15_judgments`
- `memory_task_boundaries`
- `memory_task_canvases`
- `memory_task_canvas_fts`
- `data/memory/task-canvases/...`

This is the scenario where task-aware recall has the richest working-memory surface to read.

## Why task artifacts may exist even when durable memory did not change

This is expected behavior.

The task/context path is designed to support active work immediately. That means the system can create:

- evidence rows
- task nodes
- offload refs
- task canvases

inside the current chat loop, even when durable `L1` atoms, `L2` scenarios, and `L3` persona have not been promoted yet.

So if you see task artifacts without a durable persona/scenario change, that is not a contradiction. It means the working-memory path updated first.

## How task-aware recall uses these writes later

Task-aware recall complements durable recall. It does not replace it.

Later reads can use:

- the active task canvas for the current chat
- relevant historical task canvases
- offload refs that can be opened directly when the Mermaid summary is too small

This is why `tdai_context_ref_read` exists in `src/tools/local.ts:101-115`: sometimes the canvas summary is enough, and sometimes you need the raw offloaded result.

## Source map

Main implementation references for this guide:

- `src/agent/react-agent.ts:218-289`
- `src/memory/core/service.ts:538-679`
- `src/memory/offload/service.ts:71-378`
- `src/memory/recall/service.ts:153-205`
- `src/memory/backends/sqlite/backend.ts:860-1518`
- `src/tools/local.ts:53-115`
