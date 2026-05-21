# Memory Port Phase 2 — Intelligence Design

Date: 2026-05-21

[Previous: Phase 1](2026-05-21-memory-port-10-phase-roadmap-design-phase-1.md) | [Back to design index](2026-05-21-memory-port-10-phase-roadmap-design.md) | [Next: Phase 3](2026-05-21-memory-port-10-phase-roadmap-design-phase-3.md)

This phase file contains the detailed design content for Phase 2 / former Phase 4–6.

---
## Phase 2 — Intelligence

Covers the former Phase 4 through Phase 6.

### Goal

Bring the current project closer to TencentDB at the core memory intelligence layer: richer L1 records, semantic conflict resolution, and better recall/retrieval orchestration.

### Why this phase comes second

Richer recall and higher memory behavior should not be built on a weak L1 shape. Once Phase 1 makes runtime inputs trustworthy, the highest-leverage parity work is to improve how memory is extracted, deduped, and recalled.

### Workstream 2.1 — L1 extraction parity

Former Phase 4.

#### Goal

Move the current project from a minimal L1 atom extractor toward a richer TencentDB-style memory record model.

#### Key gaps addressed

- current minimal extraction shape in `src/memory/pipeline/l1.ts:9`
- weak semantic richness in current L1 records
- insufficient structure for deeper conflict resolution and retrieval

#### Primary files and surfaces

- `src/memory/pipeline/l1.ts:121`
- record/store structures defined earlier in Phase 1
- parity target concept: `TencentDB/src/core/record/l1-dedup.ts:58`

#### Completion criteria

- L1 records carry enough structure for semantic comparison and better retrieval
- L1 is no longer effectively just `text + importance + source_turn_ids`
- later workstreams can operate on richer memory records without redefining them

### Workstream 2.2 — L1 semantic dedupe parity

Former Phase 5.

#### Goal

Port the highest-value missing TencentDB behavior: semantic conflict resolution for L1 memory.

#### Key gaps addressed

- current canonical-text reuse only
- absence of vector/FTS candidate recall for conflict resolution
- absence of decision types like merge/update/skip

#### Primary files and surfaces

- current L1 path centered on `src/memory/pipeline/l1.ts:121`
- parity target: `TencentDB/src/core/record/l1-dedup.ts:58`

#### Completion criteria

- duplicate and overlapping memories are resolved semantically, not only canonically
- candidate recall exists for conflict resolution
- decisions like keep/store/update/merge/skip are modeled explicitly enough for parity goals

### Workstream 2.3 — Recall and retrieval parity

Former Phase 6.

#### Goal

Bring current-project retrieval behavior closer to TencentDB in ranking, orchestration, and prompt injection structure.

#### Key gaps addressed

- single combined memory snapshot injection in `src/agent/react-agent.ts:139`
- weaker recall orchestration than TencentDB
- reduced separation between stable memory context and dynamic recalled memory

#### Primary files and surfaces

- `src/agent/react-agent.ts:139`
- current recall surfaces referenced in `docs/ported/1.md`
- parity target: `TencentDB/src/core/hooks/auto-recall.ts:104`

#### Completion criteria

- retrieval strategy is explicit enough for parity work
- stable vs dynamic memory injection is defined and working
- recall produces materially cleaner and more TencentDB-like prompt context

### Phase 2 completion criteria

- L1 records are rich enough to express more than minimal memory atoms
- semantic dedupe reduces fragmentation caused by paraphrases, overlap, and superseded facts
- recall behaves as an explicit retrieval system rather than one combined snapshot append

### Risk notes

This phase is high-value but also high-risk because semantic dedupe and retrieval quality can become unstable if they outgrow the storage and capture guarantees established in Phase 1.

---

