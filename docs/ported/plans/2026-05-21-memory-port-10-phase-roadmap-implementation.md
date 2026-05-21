# Memory Port 3-Phase Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the current project’s memory system materially closer to TencentDB parity across config wiring, store contract, capture, dedupe, recall, L2/L3 behavior, offload runtime, and cleanup, while excluding Telegram-specific and adapter-only code.

**Architecture:** Keep the current app-integrated memory stack and execute the port in three top-level phases. Phase 1 stabilizes config, storage contract, and capture semantics; Phase 2 improves L1 extraction, dedupe, and recall behavior; Phase 3 closes the remaining scene/persona/runtime gaps and defines final verification. Prefer project-owned helpers and focused files over mechanically copying TencentDB host/plugin structure.

**Tech Stack:** Bun, TypeScript, bun:test, bun:sqlite, sqlite-vec, project-owned memory services under `src/memory/`

---

## Phase navigation

- [Phase 1 — Foundation](2026-05-21-memory-port-10-phase-roadmap-implementation-phase-1.md) — Task 1 through Task 3
- [Phase 2 — Intelligence](2026-05-21-memory-port-10-phase-roadmap-implementation-phase-2.md) — Task 4 through Task 6
- [Phase 3 — Runtime & acceptance](2026-05-21-memory-port-10-phase-roadmap-implementation-phase-3.md) — Task 7 through Task 10 and final verification

Use this index for the overall execution order, spec coverage map, and cross-phase notes. The detailed task-by-task implementation steps now live in the linked phase files.

## Final verification location

The final verification sweep now lives inside the Phase 3 implementation file so the whole acceptance pass stays with the runtime and cleanup work.

## Spec coverage check

This plan covers every section of `docs/ported/specs/2026-05-21-memory-port-10-phase-roadmap-design.md`:

- Phase 1 — Foundation → Task 1 through Task 3
  - Workstream 1.1 config parity → Task 1
  - Workstream 1.2 store contract parity → Task 2
  - Workstream 1.3 L0 capture parity → Task 3
- Phase 2 — Intelligence → Task 4 through Task 6
  - Workstream 2.1 L1 extraction parity → Task 4
  - Workstream 2.2 L1 semantic dedupe parity → Task 5
  - Workstream 2.3 recall and retrieval parity → Task 6
- Phase 3 — Runtime & acceptance → Task 7 through Task 10
  - Workstream 3.1 L2 scene-memory parity → Task 7
  - Workstream 3.2 L3 persona parity → Task 8
  - Workstream 3.3 offload/task-runtime parity → Task 9
  - Workstream 3.4 pipeline, cleanup, and verification parity → Task 10

## Notes for execution

- Keep the changes phase-local. Do not implement Phase 3 workstreams while still inside Phase 2, and do not pull Phase 2 behavior forward before Phase 1 is stable.
- Within each top-level phase, execute the mapped workstreams in order so the dependency chain from the spec stays intact.
- Prefer extending the current project-owned memory system over copying TencentDB host/plugin structure directly.
- Preserve existing tests and provenance behavior unless a task explicitly replaces them.
- Do not touch Telegram-specific surfaces unless a memory-phase test proves a direct dependency.
