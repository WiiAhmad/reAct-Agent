# Durable Memory Flow

This guide explains how durable memory is written in this project, why some writes appear immediately while others only appear after maintenance runs, and where to inspect the data after a real chat.

The goal is simple: after chatting with the agent, you should be able to answer all of these questions without guessing:

- What got written right away?
- What is only written later?
- Which storage surface should I inspect first?
- Why might recall still look thin even though the chat succeeded?

## What durable memory means in this repo

Durable memory is the long-lived memory path that tries to preserve information that should still matter after the current conversation or task is over.

In this repo, the durable path is organized as these layers:

| Layer | Meaning | What it stores |
| --- | --- | --- |
| **L0** | raw conversation evidence | user/assistant chat evidence that later stages can promote |
| **L1** | memory atoms | small durable facts, preferences, habits, or constraints |
| **L2** | scenario snapshots | grouped higher-level summaries built from multiple L1 atoms |
| **L3** | persona/profile | the highest-level durable summary used to steer later recall |

This path is different from task/context offload memory. Durable memory is about long-lived knowledge. Task/context memory is about helping the agent keep track of active work.

## The short version

- Chatting writes raw evidence immediately.
- Durable `L1`, `L2`, and `L3` do **not** all appear immediately after a chat.
- A later maintenance/promotion pipeline turns saved chat evidence into durable memory.
- If recall still looks thin right after chatting, that is often expected in the current design.

## Immediate writes vs later writes

| Timing | What gets written | Why it exists |
| --- | --- | --- |
| Immediately during chat | `interaction_events`, chat history JSONL, and store-backed `memory_store_l0` rows | capture raw evidence from the conversation as it happens |
| Later during maintenance | `memory_atoms`, `memory_scenarios`, `personas`, lineage links, checkpoints, and store-backed L1/L2/L3 mirrors | turn raw evidence into reusable long-term memory |

The biggest source of confusion is that **successful chatting does not mean durable promotion already happened**.

## Step-by-step durable write flow

### 1. The live chat loop writes the raw interaction first

The main live chat path starts in `runReactAgent()` at `src/agent/react-agent.ts:105`. The agent immediately records the user message through `memory.logUserMessage(...)` at `src/agent/react-agent.ts:113-118`. When the model finishes, it records the assistant reply through `memory.logAssistantMessage(...)` at `src/agent/react-agent.ts:199-204` or `src/agent/react-agent.ts:293-297`.

Those writes are not durable `L1`/`L2`/`L3` yet. They are the raw conversation evidence that later promotion depends on.

### 2. Those chat writes become L0 evidence

`MemoryService.logUserMessage()` and `MemoryService.logAssistantMessage()` in `src/memory/core/service.ts:411-450` delegate to `InteractionLogService`, then mirror the same turns into the active `SqliteMemoryStore` L0 surface.

The immediate write surfaces for a normal chat are:

- `interaction_events` via `src/memory/events/service.ts:33-100` and `src/memory/backends/sqlite/backend.ts:262-282`
- `data/history/<chatId>.jsonl` via `appendChatHistoryTurn(...)` in `src/memory/events/service.ts:45-52` and `src/memory/events/service.ts:80-87`
- `memory_store_l0` via `store.upsertL0(...)` in `src/memory/core/service.ts:414-428` and `src/memory/core/service.ts:435-449`, implemented at `src/memory/backends/sqlite/store.ts:739-779`

Important nuance: the current live agent path does **not** use `logTurn()` for its main user/assistant writes. `logTurn()` writes backend `conversations` rows at `src/memory/core/service.ts:478-505`, but the real agent loop uses `logUserMessage()` and `logAssistantMessage()` instead. That is why inspecting only `conversations` after a chat can mislead you.

### 3. Maintenance promotes L0 evidence into durable L1 atoms

Durable atoms are created later by the maintenance pipeline, not by the main chat loop alone.

The promotion flow is coordinated by `PipelineCoordinator.runMaintenanceForUser()` at `src/memory/pipeline/coordinator.ts:65-177`. In the current runtime, when a store exists, it pulls pending L0 evidence from `memory_store_l0` through `queryL0ForUser(...)` at `src/memory/backends/sqlite/store.ts:859-875`.

Then `runL1Pipeline()` at `src/memory/pipeline/l1.ts:121-193` extracts durable memory candidates from those turns and writes them through:

- `store.upsertL1(...)` for the active store-backed L1 surface
- `backend.upsertMemoryAtom(...)` for backend durable atoms at `src/memory/backends/sqlite/backend.ts:546-649`
- `backend.insertLineageLink(...)` for provenance at `src/memory/pipeline/l1.ts:176-185`

This is the step where raw conversation evidence first becomes durable memory.

### 4. L2 groups durable atoms into scenario snapshots

Once durable atoms exist, `runL2Pipeline()` at `src/memory/pipeline/l2.ts:36-86` turns them into a scenario snapshot.

That stage writes to two places:

- backend `memory_scenarios` through `backend.insertMemoryScenario(...)` at `src/memory/backends/sqlite/backend.ts:651-660`
- store-backed profiles through `store.syncProfiles(...)` at `src/memory/pipeline/l2.ts:59-72`, implemented in `src/memory/backends/sqlite/store.ts:1072-1114`

It also records provenance from atoms to scenarios through `backend.insertLineageLink(...)` at `src/memory/pipeline/l2.ts:74-83`.

### 5. L3 distills scenarios into persona memory

The highest durable layer is written by `runL3Pipeline()` at `src/memory/pipeline/l3.ts:27-63`.

That stage writes:

- backend `personas` through `backend.upsertPersona(...)` at `src/memory/backends/sqlite/backend.ts:731-750`
- store-backed profiles through `store.syncProfiles(...)` at `src/memory/pipeline/l3.ts:43-45`
- lineage from scenario to persona through `backend.insertLineageLink(...)` at `src/memory/pipeline/l3.ts:53-60`

This persona/profile is what recall can surface as the highest-level durable summary for the user.

## Where the durable data lives

The durable path touches several storage surfaces. They do not all mean the same thing.

### Immediate raw-evidence surfaces

- `interaction_events` — structured event log for user messages, assistant messages, tool calls, and tool results
- `data/history/<chatId>.jsonl` — append-only chat history used for recent-message reads and search
- `memory_store_l0` — current store-backed L0 conversation surface used by the active runtime

### Promoted durable-memory surfaces

- `memory_atoms` — backend durable L1 atoms
- `memory_store_l1` — store-backed L1 records used by the current runtime
- `memory_scenarios` — backend durable L2 scenario snapshots
- `memory_store_profiles` with `type = l2` — store-backed L2 profile mirror
- `personas` — backend L3 persona/profile row
- `memory_store_profiles` with `type = l3` — store-backed L3 profile mirror
- `lineage_links` — provenance between turns, atoms, scenarios, and persona
- `pipeline_checkpoints` — progress markers for future promotion runs

### Older or alternate backend surface you may still encounter

- `conversations` — backend conversation rows used by `logTurn()` and backend-only flows; useful to know about, but not the main user/assistant write surface for the current agent loop

The memory runtime is composed in `src/memory/integration/factory.ts:103-162`, which is why both `SqliteMemoryBackend` and `SqliteMemoryStore` matter when you inspect the system.

## After one chat, what should I inspect?

### Scenario A: one user message, no tool call

You should expect raw evidence first, not a full durable memory promotion.

Inspect these surfaces first:

- `interaction_events` for the user-message row
- `data/history/<chatId>.jsonl` for the appended chat-history row
- `memory_store_l0` for the mirrored L0 conversation record

You should **not** assume that `memory_atoms`, `memory_scenarios`, or `personas` changed yet.

### Scenario B: one user message and one assistant reply

You should expect the same raw-evidence surfaces plus the assistant reply:

- `interaction_events`
- `data/history/<chatId>.jsonl`
- `memory_store_l0`

If you only chatted and did not run maintenance, it is still normal for durable `L1`/`L2`/`L3` to remain unchanged.

### Scenario C: after maintenance runs

Now you should expect promotion artifacts too:

- `memory_atoms` and `memory_store_l1`
- `memory_scenarios` and store-backed `l2` profiles
- `personas` and store-backed `l3` profiles
- `lineage_links`
- `pipeline_checkpoints`

This is the point where durable recall should have more to work with.

## Why durable recall may still look empty or thin

Common reasons:

1. **Maintenance has not run yet.** The chat loop saved evidence, but promotion did not happen.
2. **The latest chat did not produce extractable durable memory.** Not every conversation contains a stable preference, fact, or workflow worth keeping.
3. **L2 skipped because there were no new atoms.** `PipelineCoordinator` can skip later stages when there is no new L1 output.
4. **L3 skipped because no scenario was produced.** No scenario means no persona update.
5. **You inspected the wrong storage surface.** In the current runtime, `memory_store_l0`, `memory_store_l1`, and `memory_store_profiles` are often more relevant to active recall than older backend-only expectations.

In other words, “I chatted successfully” and “durable recall should already be richer” are not the same statement.

## How recall reads durable memory later

`RecallService.recall()` at `src/memory/recall/service.ts:153-205` does not read just one table.

In the current runtime, recall can merge:

- persona/profile memory
- scenario snapshots
- L1 atom results
- related conversation evidence
- task-aware context, if enabled

When a store exists, recall prefers store-backed paths for persona, scenarios, atoms, and conversations:

- persona comes from `pullProfiles()` at `src/memory/recall/service.ts:208-215`
- atoms come from hybrid L1 search at `src/memory/recall/service.ts:217-233`
- scenarios come from pulled profiles at `src/memory/recall/service.ts:235-255`
- conversations come from store-backed L0 results at `src/memory/recall/service.ts:257+`

That merged behavior is why one missing table does not automatically mean recall is broken, and one visible table does not guarantee the model is using only that source.

User-facing memory tools expose the same layered view through `tdai_memory_search` in `src/tools/local.ts:50-81`.

## Source map

Main implementation references for this guide:

- `src/agent/react-agent.ts:105-307`
- `src/memory/integration/factory.ts:103-162`
- `src/memory/core/service.ts:217-275`
- `src/memory/core/service.ts:411-505`
- `src/memory/events/service.ts:33-220`
- `src/memory/pipeline/coordinator.ts:65-177`
- `src/memory/pipeline/l1.ts:121-193`
- `src/memory/pipeline/l2.ts:36-86`
- `src/memory/pipeline/l3.ts:27-63`
- `src/memory/recall/service.ts:153-255`
- `src/memory/backends/sqlite/backend.ts:262-772`
- `src/memory/backends/sqlite/store.ts:493-779`
- `src/memory/backends/sqlite/store.ts:859-875`
- `src/memory/backends/sqlite/store.ts:1057-1114`
- `src/tools/local.ts:50-81`
