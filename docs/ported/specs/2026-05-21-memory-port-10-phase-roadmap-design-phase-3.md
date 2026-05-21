# Memory Port Phase 3 — Runtime & acceptance Design

Date: 2026-05-21

[Previous: Phase 2](2026-05-21-memory-port-10-phase-roadmap-design-phase-2.md) | [Back to design index](2026-05-21-memory-port-10-phase-roadmap-design.md)

This phase file contains the detailed design content for Phase 3 / former Phase 7–10.

---
## Phase 3 — Runtime & acceptance

Covers the former Phase 7 through Phase 10.

### Goal

Close the remaining runtime and higher-layer parity gaps by strengthening durable scene/persona behavior, offload/task runtime behavior, scheduling, cleanup, and final acceptance criteria.

### Why this phase comes last

These workstreams should validate and build on the improved L1/retrieval behavior from Phase 2 instead of compensating for missing foundations. This phase is where the memory system starts to behave like a fuller runtime rather than only a layered extractor.

### Workstream 3.1 — L2 scene-memory parity

Former Phase 7.

#### Goal

Replace or evolve the current scenario-snapshot L2 behavior toward a more durable scene-based memory model.

#### Key gaps addressed

- one-shot scenario snapshot generation in `src/memory/pipeline/l2.ts:36`
- lack of durable scene-based memory management
- reduced continuity compared with TencentDB’s scene-block system

#### Primary files and surfaces

- `src/memory/pipeline/l2.ts:36`
- parity target: `TencentDB/src/core/scene/scene-extractor.ts:88`

#### Completion criteria

- L2 is a maintained memory layer, not only a generated summary artifact
- scene-oriented continuity exists
- the layer is stable enough for L3 to depend on it as durable input

### Workstream 3.2 — L3 persona parity

Former Phase 8.

#### Goal

Move from one-shot persona distillation to incremental, scene-aware persona maintenance.

#### Key gaps addressed

- current one-shot persona generation in `src/memory/pipeline/l3.ts:27`
- lack of changed-scene-aware persona maintenance
- reduced continuity across persona refreshes

#### Primary files and surfaces

- `src/memory/pipeline/l3.ts:27`
- parity target: `TencentDB/src/core/persona/persona-generator.ts:66`

#### Completion criteria

- L3 updates are incremental enough to preserve continuity
- persona behavior reflects scene changes rather than full re-distillation every time
- persona output is stable enough to serve as a long-lived recall layer

### Workstream 3.3 — Offload and task-runtime parity

Former Phase 9.

#### Goal

Bring the current project’s offload and task memory behavior closer to TencentDB’s richer runtime semantics.

#### Key gaps addressed

- current offload is real but comparatively local/synchronous in `src/memory/offload/service.ts:71`
- weaker lifecycle sophistication than TencentDB’s broader runtime treatment
- reduced integration between task evidence, compaction, and memory runtime behavior

#### Primary files and surfaces

- `src/memory/offload/service.ts:71`
- task evidence/canvas surfaces referenced in `docs/ported/1.md`

#### Completion criteria

- offload behaves like a runtime subsystem, not only a post-tool helper
- task evidence flow is robust enough for sustained use
- compaction/evidence behavior is aligned with the roadmap’s parity target

### Workstream 3.4 — Pipeline, cleanup, and verification parity

Former Phase 10.

#### Goal

Close the remaining scheduler/session/runtime gaps and define the acceptance bar for “ported enough.”

#### Key gaps addressed

- remaining session/runtime scheduling mismatches
- incomplete cleanup/expiry parity
- lack of explicit end-to-end parity acceptance criteria

#### Primary files and surfaces

- `src/memory/pipeline/coordinator.ts:65`
- `src/memory/backends/sqlite/store.ts:465`
- `src/memory/backends/sqlite/store.ts:820`
- parity target: `TencentDB/src/utils/pipeline-manager.ts:475`

#### Completion criteria

- scheduler/session behavior is explicit and verified
- cleanup/expiry behavior is verified against parity goals
- the port has a concrete acceptance checklist and can be judged phase by phase

### Phase 3 completion criteria

- L2 and L3 behave as maintained higher memory layers rather than one-shot artifacts
- offload and task memory behave like runtime subsystems rather than isolated helpers
- scheduling, cleanup, and verification define a concrete bar for behavioral parity

### Risk notes

This phase can sprawl unless kept focused on memory/runtime parity rather than turning into a catch-all refactor of task management, prompt design, or non-memory product behavior.

---

