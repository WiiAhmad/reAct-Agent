# Memory Port 3-Phase Roadmap Design

Date: 2026-05-21

## Purpose

Define a dependency-first 3-phase roadmap for bringing the current project’s memory system closer to TencentDB parity, while explicitly excluding Telegram-specific implementation and the TencentDB adapter layer that is only consumed rather than ported as core behavior.

This document is a **design roadmap**, not an implementation plan. It defines the 3 top-level phase boundaries, their internal workstreams, dependencies, scope, and completion criteria that the implementation plan should follow.

## Scope

This roadmap covers the core memory system in the current project, including:

- memory service wiring and config propagation
- backend/store contract alignment
- L0 capture behavior
- L1 extraction and dedupe
- recall and retrieval behavior
- L2 scene memory behavior
- L3 persona behavior
- offload/task-runtime behavior
- pipeline/session scheduling behavior
- cleanup, verification, and parity acceptance

## Explicit exclusions

This roadmap does **not** include:

- Telegram-specific message transport or bot concerns
- TencentDB host/plugin integration surfaces that only matter for Telegram/OpenClaw/Hermes hosting
- the borrowed TencentDB memory adapter layer itself
- unrelated refactors outside memory parity

## Design principles

1. **Dependency-first ordering**
   Later phases should depend on stable behavior established in earlier phases.

2. **Behavioral parity over name parity**
   Matching TencentDB concepts matters more than copying file names or APIs mechanically.

3. **Preserve project-owned strengths**
   The current project already has useful lineage/provenance and app-integrated memory behavior; parity work should not destroy those advantages unless they block the port.

4. **No Telegram scope creep**
   Any phase that drifts into Telegram-specific wiring is out of scope for this roadmap.

5. **Phase completion must be testable**
   Each phase needs explicit completion criteria so later planning can treat it as a stable base.

## Provenance anchors

Current-project source anchors used to define this roadmap:

- `src/index.ts:55`
- `src/index.ts:63`
- `src/agent/react-agent.ts:86`
- `src/agent/react-agent.ts:139`
- `src/memory/integration/factory.ts:103`
- `src/memory/pipeline/l1.ts:121`
- `src/memory/pipeline/l2.ts:36`
- `src/memory/pipeline/l3.ts:27`
- `src/memory/pipeline/coordinator.ts:65`
- `src/memory/offload/service.ts:71`
- `src/memory/backends/sqlite/store.ts:465`
- `src/memory/backends/sqlite/store.ts:820`

TencentDB source anchors used to define target parity:

- `TencentDB/src/core/hooks/auto-recall.ts:104`
- `TencentDB/src/core/record/l1-dedup.ts:58`
- `TencentDB/src/core/scene/scene-extractor.ts:88`
- `TencentDB/src/core/persona/persona-generator.ts:66`
- `TencentDB/src/utils/pipeline-manager.ts:342`
- `TencentDB/src/utils/pipeline-manager.ts:475`

---

## Phase navigation

- [Phase 1 — Foundation](2026-05-21-memory-port-10-phase-roadmap-design-phase-1.md) — former Phase 1–3
- [Phase 2 — Intelligence](2026-05-21-memory-port-10-phase-roadmap-design-phase-2.md) — former Phase 4–6
- [Phase 3 — Runtime & acceptance](2026-05-21-memory-port-10-phase-roadmap-design-phase-3.md) — former Phase 7–10

Use this index for scope, exclusions, principles, provenance, and cross-phase dependency rules. The detailed per-phase design content lives in the linked phase files.

## Dependency chain

The intended dependency order is strict at the top level:

1. **Phase 1 enables Phase 2 and Phase 3** by making configuration, contracts, and capture trustworthy.
2. **Phase 2 depends on Phase 1** and establishes the richer L1 and recall behavior that higher memory/runtime layers should consume.
3. **Phase 3 depends on Phase 2** and closes the remaining scene/persona/runtime/verification gaps.

Within each top-level phase, the intended workstream order is also strict:

- Phase 1: config parity → store contract parity → L0 capture parity
- Phase 2: L1 extraction parity → semantic dedupe parity → recall and retrieval parity
- Phase 3: L2 scene-memory parity → L3 persona parity → offload/task-runtime parity → pipeline/cleanup/verification parity

## Parity checklist mapped to phases

### Phase 1

- config propagation gap
- store/record contract ambiguity
- weaker L0 session/runtime semantics

### Phase 2

- minimal L1 extraction shape
- missing semantic dedupe parity
- reduced recall orchestration / single snapshot injection

### Phase 3

- scenario snapshot vs durable scene memory
- one-shot vs incremental persona behavior
- reduced offload runtime sophistication
- remaining scheduler/cleanup/acceptance gaps

## Do-not-port list

The following should remain out of scope even if they exist in TencentDB:

- Telegram-specific runtime wiring
- OpenClaw/Hermes/plugin-host-only behavior that does not affect core memory parity
- adapter-only layers used as dependencies rather than port targets
- unrelated cleanup or refactors outside the memory parity objective

## Recommended outcome of this design

The result of this design should be an implementation plan that executes the port in the same 3-phase order, with each phase broken into concrete file-level tasks, verification steps, and acceptance checks.

For traceability, that implementation plan should preserve the mapping back to the original internal workstreams:

- Phase 1 ↔ former Phase 1–3
- Phase 2 ↔ former Phase 4–6
- Phase 3 ↔ former Phase 7–10
