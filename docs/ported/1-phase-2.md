# Memory Port Comparison — Phase 2: Intelligence

[Previous: Phase 1](1-phase-1.md) | [Back to comparison index](1.md) | [Next: Phase 3](1-phase-3.md)

This phase file groups the intelligence-layer comparison: richer L1 records, semantic dedupe, retrieval, recall, and prompt injection strategy.

---
## 3. L1 extraction model

## Current project

The L1 extraction format in the current project is very small:

- `text`
- optional `importance`
- optional `source_turn_ids`

See `src/memory/pipeline/l1.ts:9`.

Main L1 pipeline:

- starts at `src/memory/pipeline/l1.ts:121`
- calls the LLM at `src/memory/pipeline/l1.ts:132`
- parses output at `src/memory/pipeline/l1.ts:141`
- stores extracted records at `src/memory/pipeline/l1.ts:155`
- upserts backend atoms at `src/memory/pipeline/l1.ts:161`
- writes lineage links at `src/memory/pipeline/l1.ts:177`

The current system therefore models L1 mainly as **memory atoms**.

## TencentDB

TencentDB’s L1 layer is richer and closer to a typed memory record model.

Its conflict detection and candidate handling start here:

- `TencentDB/src/core/record/l1-dedup.ts:58`

From the comparison work, TencentDB L1 includes stronger semantics such as:

- richer record typing
- stronger candidate matching
- semantic merge/update/skip behavior
- closer linkage between extraction and conflict resolution

## Gap analysis

This is a meaningful reduction in the port.

The current project did port **L1 extraction itself**, but the **shape and semantics** of L1 are simplified.

### What is present

- extraction exists
- storage exists
- provenance exists
- retrieval exists

### What is weakened

- richer record semantics
- deeper conflict handling
- more expressive memory typing

### Verdict

- **Ported:** yes
- **Fully equivalent:** no
- **Status:** **partially ported**

---


## 4. L1 dedupe and conflict resolution

## Current project

The current project’s L1 dedupe is mostly canonical-text based.

Important current behavior:

- canonical check during store primary record construction: `src/memory/pipeline/l1.ts:77`
- existing record lookup by canonicalized content: `src/memory/pipeline/l1.ts:90`
- same record reused on match: `src/memory/pipeline/l1.ts:102`
- upsert path based on extracted text: `src/memory/pipeline/l1.ts:155`

This is useful for exact duplicates and near-exact textual duplicates.

## TencentDB

TencentDB has materially stronger semantic dedupe.

Core file:

- `TencentDB/src/core/record/l1-dedup.ts:58`

Important paths:

- vector-first candidate recall: `TencentDB/src/core/record/l1-dedup.ts:106`
- FTS fallback: `TencentDB/src/core/record/l1-dedup.ts:123`
- batch LLM judgment: `TencentDB/src/core/record/l1-dedup.ts:141`

TencentDB can make decisions like:

- store
- update
- merge
- skip

## Gap analysis

This is one of the clearest areas where the port is **not complete**.

The current project handles:

- canonical duplicates
- simple reuse/upsert

TencentDB handles:

- semantic similarity candidate recall
- candidate pool comparison
- LLM-based conflict judgment
- merge/update/skip decisioning

### Practical effect of the gap

The current project may create more fragmented L1 memory than TencentDB in cases like:

- paraphrases
- superseded memories
- overlapping facts
- partial updates to the same long-lived user fact

### Verdict

- **Ported:** basic dedupe only
- **Fully equivalent:** no
- **Status:** **partially ported, and likely one of the highest-value missing behaviors**

---


## 5. Retrieval and recall

## Current project

Recall is loaded before generation:

- `src/agent/react-agent.ts:117`
- `src/agent/react-agent.ts:118`
- `src/agent/react-agent.ts:119`

Memory snapshot injection happens here:

- `src/agent/react-agent.ts:139`
- system messages assembled in `src/agent/react-agent.ts:141`

The formatter includes:

- L3 persona: `src/agent/react-agent.ts:28`
- L2 scenarios: `src/agent/react-agent.ts:29`
- L1 atoms: `src/agent/react-agent.ts:36`
- L0 conversation evidence: `src/agent/react-agent.ts:39`
- active task canvas: `src/agent/react-agent.ts:46`
- historical task canvases: `src/agent/react-agent.ts:49`

So yes, recall is truly used in the current system.

## TencentDB

TencentDB’s recall path is more structured around prompt-cache-aware injection.

The key split starts at:

- `TencentDB/src/core/hooks/auto-recall.ts:187`

It separates:

- **stable** system-appended context
- **dynamic** query-specific prepended memory context

That design is important because it preserves cacheability of stable memory while keeping per-turn recall dynamic.

## Gap analysis

The current project ports the **recall feature**, but not TencentDB’s **stable/dynamic split**.

### What is present

- recall exists
- multi-layer recall exists
- memory is injected before model execution

### What is weaker

- prompt caching strategy
- stable vs dynamic segregation
- explicit memory tools guidance in stable prompt context

### Verdict

- **Ported:** yes
- **Fully equivalent:** no
- **Status:** **partially ported**

---


## 6. Prompt injection strategy

## Current project

The project injects one combined layered snapshot:

- memory formatting starts at `src/agent/react-agent.ts:26`
- memory prompt is created at `src/agent/react-agent.ts:139`
- appended as a system message at `src/agent/react-agent.ts:143`

This is simple and works.

## TencentDB

TencentDB uses a more advanced injection model:

- stable append system context: `TencentDB/src/core/hooks/auto-recall.ts:187`
- dynamic prepend context: `TencentDB/src/core/hooks/auto-recall.ts:205`
- memory tools guide inclusion: `TencentDB/src/core/hooks/auto-recall.ts:212`

## Gap analysis

This is not a total absence; it is a **reduced design**.

Current project has:

- direct injection
- multi-layer formatting

TencentDB additionally has:

- cache-aware separation
- explicit tool guidance in context
- better separation between long-lived memory and turn-specific memory

### Verdict

- **Ported:** yes, conceptually
- **Equivalent:** no
- **Status:** **partially ported**

---

