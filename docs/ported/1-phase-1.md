# Memory Port Comparison — Phase 1: Foundation

[Back to comparison index](1.md) | [Next: Phase 2](1-phase-2.md)

This phase file groups the foundation-side comparison: architecture, capture, store contract, and live config wiring.

---
## 1. High-level architecture comparison

## Current project

The current memory stack is assembled in `createMemoryService()`:

- backend: `src/memory/integration/factory.ts:108`
- store: `src/memory/integration/factory.ts:118`
- recall service: `src/memory/integration/factory.ts:125`
- offload service: `src/memory/integration/factory.ts:131`
- pipeline coordinator: `src/memory/integration/factory.ts:138`
- final facade: `src/memory/integration/factory.ts:140`

The runtime uses this stack directly inside the app bootstrap:

- memory service created in `src/index.ts:55`
- memory config passed in `src/index.ts:63`
- agent runtime calls memory directly in `src/agent/react-agent.ts:86`

This means the current project memory system is tightly embedded into the app’s own execution path.

## TencentDB

TencentDB’s memory design is broader and more runtime-oriented.

From the comparison, its core behavior is centered around:

- pre-recall / pre-prompt memory injection: `TencentDB/src/core/hooks/auto-recall.ts:104`
- richer L1 conflict detection: `TencentDB/src/core/record/l1-dedup.ts:58`
- scene memory management: `TencentDB/src/core/scene/scene-extractor.ts:88`
- persona regeneration with scene awareness: `TencentDB/src/core/persona/persona-generator.ts:66`
- per-session pipeline runtime: `TencentDB/src/utils/pipeline-manager.ts:342`
- explicit session flush: `TencentDB/src/utils/pipeline-manager.ts:475`

## Core architectural difference

The current project ports the **memory layers and storage ideas**, but TencentDB still has the richer **runtime control model**.

### Verdict

- **Ported:** memory layers, recall, pipeline existence
- **Partial:** runtime lifecycle parity
- **Missing/Reduced:** host-neutral, session-aware runtime semantics

---


## 2. L0 capture and conversation memory

## Current project

In the current project, L0 capture happens directly from the agent loop.

Relevant flow:

- user message logged: `src/agent/react-agent.ts:94`
- task turn judged: `src/agent/react-agent.ts:100`
- assistant answer logged: `src/agent/react-agent.ts:176`
- tool call logged: `src/agent/react-agent.ts:208`
- tool result logged: `src/agent/react-agent.ts:241`

This is simple and effective, but tightly coupled to one runtime path.

## TencentDB

TencentDB’s L0 flow is more defensive and lifecycle-aware.

From the comparison findings, it includes:

- capture before/after memory orchestration via recall hook flow: `TencentDB/src/core/hooks/auto-recall.ts:104`
- coordination with a session pipeline manager: `TencentDB/src/utils/pipeline-manager.ts:342`
- explicit flush behavior on session end: `TencentDB/src/utils/pipeline-manager.ts:475`

## Gap analysis

The current project **does have L0 capture**, so the feature is ported.

But compared to TencentDB, it appears weaker in:

- session-aware buffering
- richer flush/recovery semantics
- broader runtime lifecycle control
- stronger protection against capture drift or duplicated lifecycle behavior

### Verdict

- **Ported:** yes
- **Fully equivalent:** no
- **Status:** **partially ported**

---


## 11. Storage model

## Current project

Current project uses a dual storage model in practice:

1. older backend-oriented memory model
2. newer `IMemoryStore` model

Factory wiring shows both are active:

- backend created: `src/memory/integration/factory.ts:108`
- store created: `src/memory/integration/factory.ts:118`

This gives the current project flexibility, but it also means the port is not a 1:1 store translation.

## TencentDB

TencentDB’s memory storage, according to the comparison, is more tightly aligned to a unified runtime-oriented store model with richer conflict and lifecycle semantics.

## Gap analysis

### Current project strengths

- practical SQLite-centric implementation
- layered records exist
- retrieval primitives exist
- profile sync exists

### Current project weakness relative to TencentDB

- less unified store semantics
- weaker semantic dedupe integration
- less backend/runtime flexibility

### Verdict

- **Ported:** partially
- **Equivalent:** no
- **Status:** **partially ported**

---


## 14. Concrete current-project wiring issue

This looks like a real incomplete port/wiring problem rather than just architectural drift.

`createMemoryService()` supports:

- `l1`: `src/memory/integration/factory.ts:105`
- `l2`: `src/memory/integration/factory.ts:106`
- `taskRecall`: `src/memory/integration/factory.ts:107`

But the main bootstrap passes only:

- `maintenanceCron`
- `offloadEnabled`
- `offloadMinChars`
- `offloadSummaryChars`
- `sqliteVecEnabled`
- `jsonlExportEnabled`
- `l15`
- `l4`

See the actual bootstrap object in `src/index.ts:63`.

That means `config.memory.l1`, `config.memory.l2`, and `config.memory.taskRecall` appear to be supported by the factory but are **not being passed from bootstrap**.

## Why this matters

That can cause documented config to be parsed but ignored at runtime.

## Judgment

This is a strong candidate for:

> something from the fuller memory design was started or expected, but not fully wired into the live application path

---

