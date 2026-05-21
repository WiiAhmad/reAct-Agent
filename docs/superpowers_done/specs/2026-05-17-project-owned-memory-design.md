# Project-Owned Memory System Design

Date: 2026-05-17
Status: Approved in brainstorming

## Summary

This project will replace the current vendor-reference approach around `vendor/tencentdb-agent-memory` with a fully project-owned memory subsystem built for this Bun/grammY AI agent. The new system will keep the useful TencentDB-Agent-Memory feature set relevant to this repo, including layered memory, recall, context offload, Mermaid task canvas, and a local-first SQLite runtime using `sqlite-vec` plus FTS5, while removing OpenClaw, Hermes, gateway, plugin, cloud-backend, and host-specific adapter concerns.
The design intentionally does not preserve the current schema or stored data. Existing local data may be deleted. The goal is a clean Bun-native implementation whose runtime boundary is this repository, not the upstream plugin architecture.

## Goals

- Implement a project-owned memory subsystem for this AI agent.
- Keep the useful memory feature set from TencentDB-Agent-Memory.
- Support a local-first SQLite backend with `sqlite-vec` and FTS5 for memory retrieval.
- Keep the system Bun-native and directly integrated into this bot.
- Preserve memory provenance so derived answers can be traced back to supporting evidence.
- Preserve and improve the current project's chat and tool logging behavior so user messages, assistant replies, tool calls, tool results, and offload refs remain traceable.
- Keep JSONL available as an optional export/debug trace for interactions, but not as the primary persistence layer.
- Keep large raw tool results available through offload references and task canvas drill-down.

## Non-Goals

- Running OpenClaw or Hermes in any form.
- Keeping upstream plugin manifests, gateway server, or host lifecycle hooks.
- Maintaining compatibility with the current local schema or current data files.
- Using JSONL as the primary system of record for memory state.
- Implementing or shipping a cloud TCVDB backend in v1.
- Preserving the vendored source tree as a runtime dependency.

## Current-State Context

The current runtime is already local to this repo:

- `src/index.ts` boots the bot, memory store, tools, and cron loops.
- `src/tools/local.ts` exposes the memory-related tools to the agent.
- `src/agent/react-agent.ts` already records user turns, assistant replies, tool calls, tool results, offload refs, and console agent events.
- `src/memory/store.ts` is the current monolithic local memory implementation.
- `src/db/schema.ts` defines the current SQLite schema.
- `scripts/vendor-tencentdb-agent-memory.ts` only downloads the upstream source snapshot into `vendor/`.
- `vendor/tencentdb-agent-memory/` is a reference snapshot, not the live runtime implementation.

That means the replacement should treat the current bot integration as the real runtime boundary and use the vendor package as a feature and algorithm reference rather than as the new codebase shape.

## Architecture

The new system should replace the current monolith in `src/memory/store.ts` with a project-owned memory subsystem that has one host-neutral core and one thin Bun/agent integration layer.

### Proposed top-level structure

```text
src/memory/
  core/
  events/
  pipeline/
  prompts/
  recall/
  offload/
  backends/
    sqlite/
  integration/
```

### Architectural boundaries

- `core/` contains the project-owned memory domain, orchestration contracts, object types, and shared interfaces.
- `events/` contains persistent interaction logging for user messages, assistant replies, tool calls, tool results, offload refs, and operational event capture.
- `pipeline/` contains L0 capture flow and the L1, L2, and L3 synthesis stages.
- `prompts/` contains extraction and synthesis prompt templates plus structured output parsers.
- `recall/` contains retrieval, ranking, fallback traversal, and answer-support assembly.
- `offload/` contains raw-result storage, summary refs, task graph updates, and Mermaid canvas generation.
- `backends/` contains the local-first SQLite backend used in v1, including `sqlite-vec` and FTS5 integration for hybrid retrieval.
- `integration/` contains the thin adapter that binds the memory system to this grammY/Bun agent runtime.

### Core design rule

The memory core must know nothing about OpenClaw, Hermes, plugin manifests, gateway lifecycle, or upstream host hooks. All host-specific knowledge must live in this repository's Bun integration layer.

## Components and Data Flow

### Main components

#### MemoryService
Top-level API consumed by the bot and agent runtime. It owns the main use cases:

- `logTurn`
- `recall`
- `searchConversations`
- `runMaintenance`
- `offloadToolResult`
- `readContextRef`
- `memoryStatus`

`MemoryService` coordinates the other components but does not embed storage-specific behavior.

#### InteractionLogService
Owns the persistent project-level audit trail for:

- user messages
- assistant replies
- tool call start events
- tool results and offload refs
- autonomous or scheduled agent actions
- lightweight operational events needed for traceability

These logs are first-class product features, not debug-only output. They must preserve enough structured detail to reconstruct what the agent did, what tools it used, and which memory objects or refs were derived from those interactions.

#### PipelineCoordinator
Owns stage scheduling and checkpoint rules for:

- L1 extraction
- L2 scenario aggregation
- L3 persona/profile synthesis

It decides when a stage should run, which evidence window it should inspect, and which outputs become the next stage's inputs.

#### RecallService
Owns cross-layer memory retrieval. It merges and ranks:

- L3 persona/profile entries
- L2 scenario blocks
- L1 memory atoms
- L0 conversations
- active task graph and canvas references

It also owns lineage-aware fallback traversal when the ideal memory object is not directly available.

#### BackendAdapter
Shared interface between the memory core and the local-first SQLite backend. The abstraction should keep storage details, `sqlite-vec` usage, and FTS5 query mechanics out of the higher-level memory services.

#### OffloadService
Owns:

- raw tool-result offload
- summary generation
- offload ref metadata
- task graph node creation
- Mermaid canvas updates
- context-ref reads

#### PromptModules
Owns prompt templates and parsing logic for L1, L2, L3, and any offload summarization that depends on model generation.

#### MemoryToolsAdapter
Maps agent-facing tools to the project-owned memory services. The conceptual tool surface can remain similar to the current `tdai_*` model because it fits the agent workflow well, even though the internals will be fully redesigned.

### Runtime data flow

1. The bot or agent records each user message, assistant reply, tool call, tool result, and autonomous action as structured interaction events.
2. L0 evidence is materialized from those interaction events and stored in a recall-friendly conversation form.
3. The pipeline coordinator decides whether L1, L2, or L3 should run.
4. L1 extracts durable memory atoms from L0 evidence.
5. L2 groups L1 atoms into scenario blocks.
6. L3 distills scenario blocks into an agent-facing persona/profile.
7. Recall tools search across memory layers and active task context.
8. Heavy tool outputs are offloaded into refs storage, summarized, linked into the task graph, and reflected in the Mermaid canvas.
9. If a queried memory object is missing, the recall layer follows lineage links to nearest supporting evidence.

## Backends, Storage, and Scope

## Runtime mode

The v1 memory system uses one production storage mode:

- **SQLite mode**: the default and only runtime mode for this repo, implemented locally in Bun with `bun:sqlite`, `sqlite-vec`, and FTS5.

The core services should still hide low-level storage mechanics behind a local backend interface so the rest of the app does not depend directly on SQL schema details or extension-loading code.

## Backend contract

The local SQLite backend must support these logical responsibilities:

- persist and query interaction events for chat and tool activity
- persist and query L0 conversations
- persist and query L1 atoms
- persist and query L2 scenario blocks
- persist and query L3 persona/profile data
- persist lineage links
- persist offload refs and task graph data
- persist pipeline checkpoints
- persist operational logs tied to memory and tool flows
- support retrieval primitives needed by RecallService
- support local vector search through `sqlite-vec`
- support keyword search through FTS5

The backend interface should isolate SQLite schema details, `sqlite-vec` extension loading, and retrieval implementation details from the memory core.

## Recommended persisted domains

The new storage model should be designed around project requirements rather than the current schema:

- `interaction_events` for raw user/assistant/tool activity, including tool call start, tool result, offload linkage, and autonomous actions
- optional JSONL export files derived from `interaction_events` for debugging or external log consumption
- `conversations` for L0 recall-oriented conversation history
- `memory_atoms` for L1 durable facts, preferences, workflows, and constraints
- `scenario_blocks` for L2 grouped context
- `persona_profiles` for L3 distilled agent-facing memory
- `lineage_links` for explicit provenance and fallback traversal
- `offload_refs` for heavy raw tool results
- `task_graph_nodes` for Mermaid/task-canvas state
- `pipeline_checkpoints` for L1/L2/L3 progress and triggers
- `run_logs` for operational tracing and debugging

## Files on disk

SQLite should be the source of truth, but file-based artifacts still provide operational value.

The new system should keep file artifacts for:

- raw offloaded tool results
- Mermaid canvas files
- optional JSONL interaction exports for debugging, auditing, or log shipping
- optional exported scenario snapshots for inspection
- optional exported persona snapshots for inspection

These files must be derived outputs or externally stored payloads, not the primary state model.

## JSONL role

The upstream vendor used JSONL as part of its original storage strategy. This project-owned design does not depend on JSONL for primary persistence because a local SQLite backend is the system of record for this repo.

If JSONL is kept, it should be treated as an optional append-only export/debug surface for interaction history or operational tracing. The agent runtime must continue to work correctly if JSONL export is disabled.

## Features to keep

Version one must include:

- L0/L1/L2/L3 layered memory
- cross-layer recall/search
- conversation search
- structured chat logging for user and assistant turns
- structured tool logging for tool calls, tool results, offload refs, and autonomous actions
- optional JSONL export/debug logs for interaction traces
- context offload with raw ref drill-down
- Mermaid task canvas
- maintenance pipeline and checkpoints
- SQLite local mode with `sqlite-vec` and FTS5
- optional JSONL export/debug logging derived from structured interaction events
- Bun-native integration into this bot

## Features to remove

The project-owned implementation should drop all upstream concerns that only exist for other hosts:

- OpenClaw plugin lifecycle
- Hermes adapter and gateway/server packaging
- plugin manifests and startup hooks
- upstream install scripts and runtime glue for those environments

## Provenance, Lineage, and Fallback Retrieval

The system needs stronger traceability than simple stage success/failure logs.

### Primary observability model

The primary observability model should be a provenance graph, not only per-stage logs.

Every important memory object should have a stable ID and explicit links to its supporting evidence. Example chains:

- `L0 conversation turn` → `L1 atom A`
- `L1 atom A/B/C` → `L2 scenario S`
- `L2 scenario S` → `L3 persona statement P`
- `tool result/offload ref R` → `task node T` → derived atoms/scenarios

### Traceable answer support

When the agent answers from memory, the system should be able to resolve:

- which memory object was used
- which upstream evidence supports it
- which nearest fallback evidence exists if the exact object is missing

### Fallback by linked evidence

If target memory object `A` is missing, stale, or not directly retrievable, the recall layer should traverse the nearest linked evidence `B` or `C` and use that chain to reconstruct or surface `A` in answers when possible.

This means the system should not stop at reporting that `A` failed. It should attempt to recover the answer path through connected evidence and derived memory relationships.

### Offload lineage

Offload must preserve lineage as well:

- successful offload writes a stable ref link into the graph
- if offload storage fails, the system stores a minimal inline summary plus a source pointer in the primary backend so the chain is still intact

### Operational logs

Simple run logs for L1, L2, L3, recall, and offload should still exist, but they are secondary to the provenance model.

In addition, the project must preserve a structured interaction log comparable to the current behavior in `src/agent/react-agent.ts`:

- user chat entries
- assistant answer entries
- tool call start entries
- tool result entries
- offload ref linkage entries
- autonomous-action entries when the agent runs on schedule

These logs are not just for debugging. They are part of the product's traceability surface and should be queryable enough to explain what happened during a run and how memory was derived from tool usage.

The more important question is whether the system can trace, explain, and recover memory through connected evidence.

## Agent-Facing Surface

The project can redesign internals freely, but the agent-facing surface should remain simple and task-oriented.

The conceptual tool surface should continue to provide:

- memory search
- conversation search
- context-ref read
- memory status
- explicit durable memory save

Keeping a similar conceptual surface minimizes churn in the agent loop while allowing complete internal replacement.

## Error Handling and Validation

### Startup validation

Configuration validation should happen at startup for:

- SQLite database path and writable directories
- `sqlite-vec` extension load readiness
- JSONL export settings when enabled
- LLM requirements for extraction and synthesis
- offload thresholds and limits

### Failure isolation

Failures must be isolated at the boundary where they occur:

- backend failures stay backend failures
- pipeline failures stay scoped to their stage
- offload failures do not silently lose the raw tool result

### Safe degradation

If offload cannot store a large result, the system must preserve continuity by keeping a minimal inline summary and source pointer in the primary backend so the provenance chain is still usable.

## Testing Strategy

The replacement is large enough that the design must assume a full test matrix.

### Unit tests

- prompt output parsing
- checkpoint rules and stage triggers
- recall merge and ranking logic
- lineage traversal and fallback reconstruction
- offload reference handling
- Mermaid graph generation

### Backend contract tests

The SQLite backend must pass a contract suite covering:

- schema creation
- `sqlite-vec` extension loading
- vector-table writes and reads
- FTS5 search behavior
- interaction, lineage, checkpoint, and offload persistence

### Integration tests

- L0 → L1 → L2 → L3 pipeline
- cross-layer recall
- conversation search
- offload and ref read
- lineage traversal and fallback retrieval
- maintenance scheduling behavior

### Agent-facing tests

- memory-related tool calls
- end-to-end memory behavior inside this bot runtime

## Migration and Replacement Strategy

The replacement should not preserve backward compatibility with the current local schema or existing stored data.

### Replacement steps

1. Build the new project-owned memory subsystem alongside the current implementation.
2. Verify `sqlite-vec` loads correctly in the Bun runtime and wire it into the local SQLite backend.
3. Switch `src/index.ts` and `src/tools/local.ts` to the new service boundary.
4. Verify end-to-end behavior in local SQLite mode with JSONL export both enabled and disabled.
5. Remove the old local adapter implementation in `src/memory/store.ts`.
6. Remove vendor download/config/doc paths that are no longer needed.
7. Reset local data and schema to the new format.

### Reason for clean replacement

A compatibility layer would drag current schema decisions, vendor-reference assumptions, and transitional complexity into the new architecture. Since existing data may be deleted, a clean replacement is the simplest and most maintainable path.

## Implementation Guidance

The implementation plan should optimize for modularity and incremental replacement.

Recommended implementation order:

1. Define the project-owned memory domain types and local backend contract.
2. Implement the new SQLite backend schema and interaction logging.
3. Load and verify `sqlite-vec` in the Bun runtime.
4. Implement lineage-aware core entities and persistence model.
5. Implement L0 capture and L1/L2/L3 pipeline services.
6. Implement recall, vector search, and fallback traversal.
7. Implement offload, refs, Mermaid task graph, and optional JSONL export.
8. Integrate the new memory system into the current bot and tool surface.
9. Remove the old store and vendor-reference workflow.

## Acceptance Criteria

This design is complete when the repo has a project-owned memory subsystem that:

- runs entirely inside the Bun/grammY app
- uses a local-first SQLite backend with `sqlite-vec` and FTS5
- provides layered L0/L1/L2/L3 memory
- supports lineage-aware recall and fallback retrieval
- supports context offload, raw refs, and Mermaid task canvas
- can optionally emit JSONL interaction/debug logs without relying on them as the source of truth
- no longer depends on OpenClaw, Hermes, TCVDB cloud mode, or their host adapters
- no longer needs the vendor snapshot as part of runtime architecture
