# Memory Port Comparison — Phase 3: Runtime & acceptance

[Previous: Phase 2](1-phase-2.md) | [Back to comparison index](1.md)

This phase file groups the higher-memory and runtime comparison: L2, L3, offload, scheduling, cleanup, and the project-owned provenance strength that should be preserved through parity work.

---
## 7. L2 memory layer

## Current project

Current L2 pipeline:

- starts at `src/memory/pipeline/l2.ts:36`
- calls LLM with atom digest at `src/memory/pipeline/l2.ts:47`
- creates scenario title at `src/memory/pipeline/l2.ts:56`
- syncs profile at `src/memory/pipeline/l2.ts:60`
- writes backend scenario at `src/memory/pipeline/l2.ts:64`
- inserts lineage links at `src/memory/pipeline/l2.ts:75`

This means the current project’s L2 is primarily:

> atoms → one generated scenario snapshot

## TencentDB

TencentDB L2 is much richer.

Core scene system:

- `TencentDB/src/core/scene/scene-extractor.ts:88`

Important behavior:

- backup before scene extraction: `TencentDB/src/core/scene/scene-extractor.ts:138`
- scene index load: `TencentDB/src/core/scene/scene-extractor.ts:146`
- scene count / merge pressure handling: `TencentDB/src/core/scene/scene-extractor.ts:155`
- sandboxed scene editing by tools: `TencentDB/src/core/scene/scene-extractor.ts:205`
- cleanup of deleted or META-only files: `TencentDB/src/core/scene/scene-extractor.ts:228`

## Gap analysis

This is another major non-equivalent area.

The current project ported the **existence of L2**, but not TencentDB’s **scene memory management model**.

### Current project L2 characteristics

- snapshot-based
- one-shot generation
- stored as scenario/profile markdown

### TencentDB L2 characteristics

- durable scene block files
- scene index/navigation
- scene merge pressure
- tool-mediated updates
- cleanup and maintenance of scene artifacts

### Verdict

- **Ported:** yes, at concept level
- **Equivalent:** no
- **Status:** **partially ported, with major behavioral reduction**

---


## 8. L3 persona layer

## Current project

Current L3 starts here:

- `src/memory/pipeline/l3.ts:27`

Key actions:

- LLM call from scenario markdown: `src/memory/pipeline/l3.ts:35`
- sync profile: `src/memory/pipeline/l3.ts:44`
- backend persona upsert: `src/memory/pipeline/l3.ts:48`
- lineage from scenario to persona: `src/memory/pipeline/l3.ts:54`

This is a valid L3 pipeline, but it is a simpler distillation model.

## TencentDB

TencentDB persona generation is incremental and scene-aware.

Main flow:

- `TencentDB/src/core/persona/persona-generator.ts:66`

Important behavior:

- existing persona load: `TencentDB/src/core/persona/persona-generator.ts:76`
- detect changed scenes: `TencentDB/src/core/persona/persona-generator.ts:86`
- choose mode: `TencentDB/src/core/persona/persona-generator.ts:117`
- run persona generation with file/tool behavior: `TencentDB/src/core/persona/persona-generator.ts:153`
- append fresh scene navigation: `TencentDB/src/core/persona/persona-generator.ts:188`

## Gap analysis

The current project ports persona generation, but not TencentDB’s richer maintenance semantics.

### Current project

- persona regenerated from latest scenario
- simple profile sync
- lineage kept

### TencentDB

- incremental persona update
- changed-scene-only focus
- stronger continuity across updates
- explicit scene navigation output

### Verdict

- **Ported:** yes
- **Equivalent:** no
- **Status:** **partially ported**

---


## 9. Offload and task memory runtime

## Current project

The current offload engine is real and non-trivial.

Main path:

- entrypoint: `src/memory/offload/service.ts:71`
- inline vs ref offload decision: `src/memory/offload/service.ts:85`
- write offloaded ref path: `src/memory/offload/service.ts:108`
- persist L1 evidence: `src/memory/offload/service.ts:213`
- JSONL evidence append: `src/memory/offload/service.ts:249`
- task canvas rebuild / patch path: `src/memory/offload/service.ts:293`

This is a meaningful port.

## TencentDB

TencentDB’s offload system is broader and more like a runtime engine.

From the comparison work, its capabilities include:

- hook-driven lifecycle
- batching
- retries/fallback
- active state management
- token-aware compression
- reinjection of compressed/offloaded context into prompt flow

## Gap analysis

The current project ports the offload idea and several concrete behaviors, but TencentDB still has the stronger runtime layer.

### What is present

- offload thresholding
- reference write path
- L1 evidence persistence
- task canvas patching

### What is weaker or likely missing

- more advanced offload state control
- fuller retry/fallback lifecycle
- deeper token-budget-aware compaction behavior
- richer hook-based reinjection model

### Verdict

- **Ported:** yes
- **Equivalent:** no
- **Status:** **partially ported**

---


## 10. Pipeline scheduling and maintenance

## Current project

Current maintenance pipeline starts at:

- `src/memory/pipeline/coordinator.ts:65`

It performs:

- checkpoint and pending L0 load
- L1 pass
- L2 pass
- L3 pass

Scheduling is driven through app scheduler infrastructure:

- scheduler dispatch: `src/cron/scheduler.ts:25`
- scheduler loop: `src/cron/scheduler.ts:72`

This is a real maintenance flow, but more batch/schedule-oriented.

## TencentDB

TencentDB has much richer session-aware scheduling semantics.

Pipeline manager entry region:

- `TencentDB/src/utils/pipeline-manager.ts:342`

Important behavior:

- warm-up thresholds: `TencentDB/src/utils/pipeline-manager.ts:342`
- threshold-triggered L1: `TencentDB/src/utils/pipeline-manager.ts:416`
- idle-triggered L1: `TencentDB/src/utils/pipeline-manager.ts:425`
- session flush: `TencentDB/src/utils/pipeline-manager.ts:475`
- destroy / recovery semantics: `TencentDB/src/utils/pipeline-manager.ts:513`

## Gap analysis

This is one of the largest practical differences in runtime behavior.

### Current project

- scheduler-driven maintenance
- simpler orchestration model
- app-level periodic consolidation

### TencentDB

- session state machine behavior
- warm-up progression
- threshold triggers
- idle triggers
- session flush behavior
- recovery-aware shutdown

### Verdict

- **Ported:** yes, at a basic architectural level
- **Equivalent:** no
- **Status:** **partially ported, with major runtime reduction**

---


## 12. TTL / expiry / cleanup

## Current project

The current store exposes TTL deletion methods:

- L1 expiry: `src/memory/backends/sqlite/store.ts:465`
- L0 expiry: `src/memory/backends/sqlite/store.ts:820`

But in the current `src/` tree comparison, there is no clearly corresponding richer memory-cleaner layer surfaced by grep beyond these deletion methods.

## TencentDB

TencentDB was identified as having a fuller cleanup/runtime management story in the comparison, tied into its broader pipeline/session runtime.

## Gap analysis

The current project has **expiry capability**, but the broader cleanup/runtime semantics appear thinner.

### Verdict

- **Ported:** basic expiry support yes
- **Equivalent:** unclear/no
- **Status:** **partially ported**

---


## 13. Provenance and lineage

## Current project

This is one of the stronger areas of the current project.

Lineage links are explicitly written:

- conversation → memory atom: `src/memory/pipeline/l1.ts:177`
- memory atom → scenario: `src/memory/pipeline/l2.ts:75`
- scenario → persona: `src/memory/pipeline/l3.ts:54`

## TencentDB

TencentDB has richer runtime semantics overall, but the current project’s lineage model is explicit and useful.

## Gap analysis

This is one place where the current project is not obviously weaker in concept; instead it has a clear project-owned representation of provenance.

### Verdict

- **Ported:** yes
- **Status:** **well ported / one of the stronger preserved areas**

---

