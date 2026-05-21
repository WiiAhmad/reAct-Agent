# Memory Port Phase 1 — Foundation Design

Date: 2026-05-21

[Back to design index](2026-05-21-memory-port-10-phase-roadmap-design.md) | [Next: Phase 2](2026-05-21-memory-port-10-phase-roadmap-design-phase-2.md)

This phase file contains the detailed design content for Phase 1 / former Phase 1–3.

---
## Phase 1 — Foundation

Covers the former Phase 1 through Phase 3.

### Goal

Make the current project’s memory runtime trustworthy at the configuration, contract, and capture layers so later parity work is built on stable inputs and stable boundaries.

### Why this phase comes first

Every later parity improvement depends on the runtime actually honoring memory settings, storing memory against a clear contract, and capturing conversation/runtime evidence deterministically enough for downstream processing.

### Workstream 1.1 — Foundation and config parity

Former Phase 1.

#### Goal

Make the current project’s memory runtime honor the intended configuration and define the exact parity boundary for the rest of the port.

#### Key gaps addressed

- bootstrap/config propagation mismatch
- “parsed but ignored” memory settings
- ambiguous boundary between must-port and intentionally excluded TencentDB behavior

#### Primary files and surfaces

- `src/index.ts:63`
- `src/memory/integration/factory.ts:103`
- current memory config surfaces referenced in `docs/ported/1.md`

#### Completion criteria

- all intended memory settings reach the live runtime
- `l1`, `l2`, and `taskRecall` are either fully wired or explicitly deprecated
- the port boundary is written down and referenced by later workstreams

### Workstream 1.2 — Store contract parity

Former Phase 2.

#### Goal

Establish a stable current-project memory contract that later phases can depend on, especially where the current project still splits behavior across the legacy backend model and the newer store model.

#### Key gaps addressed

- mismatch between memory-atom semantics and richer TencentDB memory-record semantics
- ambiguity between legacy backend truth and newer `IMemoryStore` truth
- unclear long-term contract for record fields needed by later parity phases

#### Primary files and surfaces

- `src/memory/integration/factory.ts:103`
- current backend/store types and storage layers referenced in `docs/ported/1.md`

#### Completion criteria

- the current project has one clearly defined working memory contract for later phases
- record fields required for richer L1, recall, and persona behavior are explicitly defined
- legacy/new-store responsibilities are clear enough that later phases do not need to re-open the storage boundary

### Workstream 1.3 — L0 capture parity

Former Phase 3.

#### Goal

Strengthen conversation capture semantics so L0 behavior is reliable enough to support richer TencentDB-style downstream memory processing.

#### Key gaps addressed

- over-reliance on direct agent-loop logging
- weaker session/runtime semantics than TencentDB
- reduced capture robustness compared with TencentDB’s broader lifecycle model

#### Primary files and surfaces

- `src/agent/react-agent.ts:86`
- current maintenance/pipeline surfaces that consume captured turns
- TencentDB behavioral target: `TencentDB/src/utils/pipeline-manager.ts:342`

#### Completion criteria

- L0 capture is deterministic enough for later semantic phases
- capture, buffering, and flush behavior are no longer only incidental side-effects of one agent path
- downstream phases can trust L0 ordering and session context

### Phase 1 completion criteria

- runtime config is trustworthy enough that later parity work is not being silently ignored
- the storage and record boundary is clear enough for richer L1/L2/L3 work
- L0 capture is stable enough that later semantic and runtime phases can trust their inputs

### Risk notes

If this phase is skipped or compressed too aggressively, later parity work may appear implemented while still behaving inconsistently because config, contract, or capture assumptions are unstable.

---

