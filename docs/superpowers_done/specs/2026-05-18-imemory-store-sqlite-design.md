# IMemoryStore SQLite Replacement Design

**Date:** 2026-05-18  
**Status:** Draft for user review  
**Target project:** `D:\Code\Test\yunus\grammy`  
**Reference project:** `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory`

## Goal

Implement a Project-A-native `IMemoryStore` storage abstraction modeled after TencentDB-Agent-Memory’s core store contract, backed by local SQLite, sqlite-vec, SQLite FTS5, and local BM25 sparse-vector encoding via `@tencentdb-agent-memory/tcvdb-text`, then replace Project A’s generic L0/L1/profile memory consumers with this store.

## Non-goals

- Do not add Tencent Cloud VectorDB support in this implementation; BM25 sparse vectors are local-only.
- Do not move Telegram jobs, offload refs, task canvases, L1.5 judgments, L1 evidence entries, or generated skill drafts into `IMemoryStore`.
- Do not remove Project A’s Telegram UX or autonomous-job features.
- Do not copy Project B’s OpenClaw/Hermes host assumptions into Project A.

## Existing context

Project A currently has a broad `MemoryBackend` interface at `src/memory/core/backend.ts`. It includes generic memory behavior plus Project-A-specific features such as task canvases, offload refs, L1.5 judgments, generated skills, and pipeline checkpoints.

Project A’s current SQLite backend is `src/memory/backends/sqlite/backend.ts`. It already supports local SQLite, FTS-backed memory/conversation search, deterministic local vector embeddings, sqlite-vec indexing for memory atoms, task canvas storage, offload metadata, and Project A app-specific memory tables.

Project B’s `IMemoryStore` lives in `TencentDB-Agent-Memory/src/core/store/types.ts`. It is narrower than Project A’s `MemoryBackend`: it focuses on backend capabilities, lifecycle, L0 raw conversation records, L1 structured memory records, L2/L3 profile sync, and reindexing.

## Chosen approach

Use a **native replacement** approach for Project A:

- Add a Project-A-native `IMemoryStore` interface.
- Add a new `SqliteMemoryStore` implementation using Bun SQLite, sqlite-vec, SQLite FTS5, and local BM25 sparse-vector encoding.
- Add `@tencentdb-agent-memory/tcvdb-text` as a Project A dependency for local sparse-vector encoding.
- Add new TencentDB-style L0/L1/profile store tables.
- Backfill existing Project A data into the new tables.
- Refactor generic memory consumers to depend on `IMemoryStore`.
- Keep Project-A-specific app storage separate from `IMemoryStore`.

## Architecture

The new storage boundary splits generic memory storage from app-specific memory features.

```text
IMemoryStore
  owns generic memory storage:
  - L0 raw conversation records
  - L1 structured memory records
  - L2/L3 profile records
  - vector search
  - FTS5 search
  - local BM25 sparse-vector encoding
  - lifecycle/capabilities
  - reindexing

Project A app memory services
  own Telegram/task/offload/job-specific behavior:
  - task canvases
  - offload refs
  - L1 evidence entries
  - L1.5 judgments
  - generated skills
  - autonomous jobs
  - Telegram-specific state
```

This prevents the new interface from becoming another broad `MemoryBackend`.

## Components

### `src/memory/core/store/types.ts`

Defines the Project A store contract and related types:

- `StoreCapabilities`
- `StoreInitResult`
- `MaybePromise<T>`
- `L0Record`
- `L0QueryRow`
- `L0SessionGroup`
- `L0SearchResult`
- `L0FtsResult`
- `L1Record`
- `L1QueryFilter`
- `L1RecordRow`
- `L1SearchResult`
- `L1FtsResult`
- `ProfileRecord`
- `ProfileSyncRecord`
- `EmbeddingProviderInfo`
- `IMemoryStore`

`StoreCapabilities` reports:

```ts
type StoreCapabilities = {
  vectorSearch: boolean;
  ftsSearch: boolean;
  nativeHybridSearch: boolean;
  sparseVectors: boolean;
};
```

For Project A’s SQLite store:

- `vectorSearch`: true only when sqlite-vec loads and vector tables initialize.
- `ftsSearch`: true when FTS5 tables initialize.
- `nativeHybridSearch`: always false.
- `sparseVectors`: true when the local BM25 encoder initializes; false if `@tencentdb-agent-memory/tcvdb-text` cannot be loaded or BM25 is disabled.

### `src/memory/backends/sqlite/bm25-local.ts`

Wraps `@tencentdb-agent-memory/tcvdb-text` for Project A.

Responsibilities:

- Create a local `BM25Encoder` with configurable language, defaulting to `en` to match Project B.
- Encode L0/L1 document text for upsert.
- Encode search queries for local sparse-vector scoring.
- Return empty sparse vectors and mark sparse search degraded if encoding fails.

This mirrors Project B's `TencentDB-Agent-Memory/src/core/store/bm25-local.ts`, where `@tencentdb-agent-memory/tcvdb-text` is used as a local TypeScript BM25 sparse-vector encoder.

### `src/memory/backends/sqlite/store.ts`

Implements:

```ts
export class SqliteMemoryStore implements IMemoryStore
```

Responsibilities:

- Initialize store schema.
- Load sqlite-vec when enabled.
- Create and maintain L0/L1 relational tables.
- Create and maintain L0/L1 FTS5 tables.
- Create and maintain L0/L1 sqlite-vec tables.
- Encode and store L0/L1 local BM25 sparse vectors.
- Store and sync L2/L3 profile records.
- Perform L0/L1 upsert/delete/count/query/search operations.
- Perform optional local hybrid search by merging FTS, dense vector, and sparse-vector results.
- Reindex all L0/L1 vectors.
- Report degradation and capabilities.

### `src/memory/backends/sqlite/store-migrate.ts`

Creates the store-specific schema.

Tables:

- `memory_store_l0`
- `memory_store_l0_fts`
- `memory_store_l0_vec`
- `memory_store_l0_sparse`
- `memory_store_l1`
- `memory_store_l1_fts`
- `memory_store_l1_vec`
- `memory_store_l1_sparse`
- `memory_store_profiles`
- `memory_store_meta`

The schema is separate from Project A’s existing app-specific memory tables.

### `src/memory/backends/sqlite/store-backfill.ts`

Runs idempotent data migration from Project A’s old memory tables into the new store tables.

Backfill mappings:

| Existing table | New store destination |
|---|---|
| `conversations` | `memory_store_l0` |
| `memory_atoms` | `memory_store_l1` |
| `memory_scenarios` | `memory_store_profiles` with `type = "l2"` |
| `personas` | `memory_store_profiles` with `type = "l3"` |

Backfill must use stable IDs so it can run repeatedly without duplicates.

Stable ID examples:

- L0: `legacy:l0:${conversation.id}`
- L1: `legacy:l1:${memory_atoms.id}`
- L2 profile: `legacy:l2:${memory_scenarios.id}`
- L3 profile: `legacy:l3:${personas.user_id}`

## Store schema

### `memory_store_l0`

Stores raw or near-raw conversation records.

Fields:

- `record_id TEXT PRIMARY KEY`
- `session_key TEXT NOT NULL`
- `session_id TEXT NOT NULL`
- `chat_id TEXT NOT NULL`
- `user_id TEXT NOT NULL`
- `role TEXT NOT NULL`
- `message_text TEXT NOT NULL`
- `recorded_at TEXT NOT NULL`
- `timestamp INTEGER NOT NULL`
- `metadata_json TEXT NOT NULL DEFAULT '{}'`

Project A mapping:

- `session_key` should be `telegram:${chatId}:${userId}`.
- `session_id` should be the chat ID unless a future conversation/session ID is introduced.
- `chat_id` and `user_id` remain first-class fields for Project A filtering.

### `memory_store_l0_fts`

FTS5 table for L0 text.

Fields:

- `message_text`
- `record_id UNINDEXED`
- `session_key UNINDEXED`
- `session_id UNINDEXED`
- `chat_id UNINDEXED`
- `user_id UNINDEXED`

### `memory_store_l0_vec`

sqlite-vec table for L0 embeddings.

- `rowid` maps to an internal integer vector row ID.
- A companion mapping column/table is needed because L0 record IDs are strings while sqlite-vec row IDs are integers.

### `memory_store_l0_sparse`

Stores local BM25 sparse vectors for L0 records produced by `@tencentdb-agent-memory/tcvdb-text`.

Fields:

- `record_id TEXT PRIMARY KEY`
- `sparse_vector_json TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

### `memory_store_l1`

Stores structured long-term memory records.

Fields:

- `record_id TEXT PRIMARY KEY`
- `user_id TEXT NOT NULL`
- `session_key TEXT NOT NULL`
- `session_id TEXT NOT NULL`
- `content TEXT NOT NULL`
- `type TEXT NOT NULL`
- `priority INTEGER NOT NULL`
- `scene_name TEXT NOT NULL DEFAULT ''`
- `timestamp_str TEXT NOT NULL`
- `timestamp_start TEXT NOT NULL DEFAULT ''`
- `timestamp_end TEXT NOT NULL DEFAULT ''`
- `source_conversation_ids_json TEXT NOT NULL DEFAULT '[]'`
- `metadata_json TEXT NOT NULL DEFAULT '{}'`
- `created_time TEXT NOT NULL`
- `updated_time TEXT NOT NULL`

Project A mapping:

- Old `MemoryAtom.text` becomes `content`.
- Old `MemoryAtom.importance` becomes `priority`.
- Old `MemoryAtom.sourceLayer` becomes `type` unless a more specific type is available.
- Old `MemoryAtom.sourceConversationIds` becomes `source_conversation_ids_json`.

### `memory_store_l1_fts`

FTS5 table for L1 content.

Fields:

- `content`
- `record_id UNINDEXED`
- `user_id UNINDEXED`
- `session_key UNINDEXED`
- `session_id UNINDEXED`
- `type UNINDEXED`
- `scene_name UNINDEXED`

### `memory_store_l1_vec`

sqlite-vec table for L1 embeddings.

- `rowid` maps to an internal integer vector row ID.
- A companion mapping column/table is needed because L1 record IDs are strings while sqlite-vec row IDs are integers.

### `memory_store_l1_sparse`

Stores local BM25 sparse vectors for L1 records produced by `@tencentdb-agent-memory/tcvdb-text`.

Fields:

- `record_id TEXT PRIMARY KEY`
- `sparse_vector_json TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

The sparse vector shape is the package’s `SparseVector`: an array of `[token_hash, weight]` pairs. Project A stores it as JSON for local scoring and future backend portability.

### `memory_store_profiles`

Stores L2/L3 profile records.

Fields:

- `id TEXT PRIMARY KEY`
- `type TEXT NOT NULL CHECK(type IN ('l2', 'l3'))`
- `user_id TEXT NOT NULL`
- `filename TEXT NOT NULL`
- `content TEXT NOT NULL`
- `content_md5 TEXT NOT NULL`
- `version INTEGER NOT NULL`
- `created_at_ms INTEGER NOT NULL`
- `updated_at_ms INTEGER NOT NULL`
- `metadata_json TEXT NOT NULL DEFAULT '{}'`

### `memory_store_meta`

Stores metadata for initialization and reindex checks.

Fields:

- `key TEXT PRIMARY KEY`
- `value TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Expected keys:

- `embedding.provider`
- `embedding.model`
- `embedding.dimensions`
- `bm25.enabled`
- `bm25.language`
- `backfill.version`

## Data flow

### L0 capture

Current flow:

```text
MemoryService.logConversation()
  -> MemoryBackend.insertConversationTurn()
  -> conversations
```

New flow:

```text
MemoryService.logConversation()
  -> IMemoryStore.upsertL0()
  -> memory_store_l0
  -> memory_store_l0_fts
  -> memory_store_l0_vec
  -> memory_store_l0_sparse
```

### L1 save/extraction

Current flow:

```text
save_memory tool / L1 pipeline
  -> MemoryBackend.upsertMemoryAtom()
  -> memory_atoms
  -> memory_atoms_fts
  -> memory_atom_embeddings
```

New flow:

```text
save_memory tool / L1 pipeline
  -> IMemoryStore.upsertL1()
  -> memory_store_l1
  -> memory_store_l1_fts
  -> memory_store_l1_vec
  -> memory_store_l1_sparse
```

### Recall

Current flow:

```text
RecallService
  -> searchMemoryAtoms()
  -> searchMemoryAtomsByVector()
  -> searchConversationTurns()
  -> scenarios/persona/task canvases
```

New flow:

```text
RecallService
  -> IMemoryStore.searchL1Fts()
  -> IMemoryStore.searchL1Vector()
  -> local BM25 query encoding for sparse scoring when enabled
  -> IMemoryStore.searchL0Fts()
  -> IMemoryStore.searchL0Vector()
  -> IMemoryStore.pullProfiles()
  -> existing task-canvas storage for task-specific recall
```

### L2/L3 profiles

Project A’s durable concepts remain:

- L2 scenario
- L3 persona

Their generic storage/search/sync moves to profile records:

```text
L2 scenario markdown -> ProfileRecord(type: "l2")
L3 persona markdown  -> ProfileRecord(type: "l3")
```

Project A may keep compatibility service methods that return `MemoryScenario` and `PersonaProfile` shapes while internally reading profile records.

## Refactor boundaries

### Move to `IMemoryStore`

These generic memory operations should move to the new store:

- Conversation capture and query for L1 extraction.
- L1 memory upsert/delete/count/query/search.
- L0 conversation search.
- L2 scenario profile persistence for generic profile sync.
- L3 persona profile persistence for generic profile sync.
- Reindexing.

### Keep outside `IMemoryStore`

These Project-A-specific operations remain in existing app storage/services:

- `interaction_events`
- `memory_offload_refs`
- `memory_task_nodes`
- `memory_l1_evidence_entries`
- `memory_task_canvases`
- `memory_task_canvas_fts`
- `memory_l15_judgments`
- `memory_task_boundaries`
- `memory_generated_skills`
- autonomous job tables
- memory update settings
- Telegram bot state

## Error handling and degradation

`SqliteMemoryStore` should follow Project B’s store rule: methods return empty results or `false` for recoverable storage/search failures rather than crashing callers. `init()` may throw only for unrecoverable schema/database setup failures.

### Degraded mode

`isDegraded()` returns true if any required store capability fails during initialization or operation.

If sqlite-vec fails:

- L0/L1 relational writes still succeed.
- FTS5 search still works.
- vector search returns `[]`.
- `getCapabilities().vectorSearch` returns false.
- `isDegraded()` returns true.

If FTS5 table maintenance fails:

- relational writes should still succeed when possible.
- FTS search returns `[]`.
- `getCapabilities().ftsSearch` returns false.
- `isDegraded()` returns true.

If BM25 encoder initialization or sparse-vector encoding fails:

- L0/L1 relational writes still succeed.
- FTS5 and dense vector search still work when their capabilities are available.
- sparse-vector scoring contributes no results.
- `getCapabilities().sparseVectors` returns false.
- `isDegraded()` returns true.

### Transactions

`upsertL0()` and `upsertL1()` use transactions so relational rows, FTS rows, vector rows, and sparse-vector rows stay consistent.

`deleteL0()` and `deleteL1()` delete relational rows, FTS rows, vector rows, and sparse-vector rows together.

### Hybrid search

`nativeHybridSearch` remains false.

`searchL1Hybrid()` may still exist as an optional local helper that merges FTS, dense-vector, and sparse-vector results using reciprocal rank fusion. This is not a native backend capability.

### Close behavior

`close()` is safe and idempotent.

If the store receives Project A’s shared Bun database handle, `close()` must not unexpectedly close the application’s database connection. If the store owns its own database handle in a test or future sidecar mode, it may close that owned handle.

## Backfill behavior

Backfill runs during store initialization after schema creation.

Rules:

- Backfill is idempotent.
- Backfill does not duplicate rows.
- Backfill does not overwrite newer new-store rows unless the row is a legacy row with the same stable ID.
- Backfill writes FTS, dense vector, and local BM25 sparse-vector indexes for migrated L0/L1 data.
- Backfill records its version in `memory_store_meta`.

Backfill should not delete old tables. Old tables remain available for app-specific compatibility and rollback until a later cleanup decision.

## Testing strategy

### Capabilities/lifecycle tests

- init reports `ftsSearch: true` when FTS5 tables initialize.
- init reports `nativeHybridSearch: false`.
- init reports `sparseVectors: true` when `@tencentdb-agent-memory/tcvdb-text` initializes and BM25 is enabled.
- init reports `sparseVectors: false` when BM25 is disabled or encoder initialization fails.
- vector capability follows sqlite-vec availability/config.
- close is safe and idempotent.

### L1 tests

- upsert L1 creates relational, FTS, dense vector, and sparse-vector data.
- upsert same ID updates content and search indexes.
- delete L1 removes relational/search/vector/sparse data.
- count/query return expected rows.
- vector search returns relevant records.
- FTS search returns relevant records.
- sparse query encoding produces local BM25 scores when enabled.
- hybrid search merges vector, FTS, and sparse results without duplicates.

### L0 tests

- upsert L0 creates relational, FTS, dense vector, and sparse-vector data.
- update L0 embedding works.
- delete expired L0 removes old rows and sparse-vector rows.
- query L0 for L1 extraction respects session/cursor/limit.
- query grouped by session works.
- vector and FTS search return expected rows.
- sparse query encoding produces local BM25 scores when enabled.

### BM25 sparse-vector tests

- local BM25 encoder initializes through `@tencentdb-agent-memory/tcvdb-text`.
- document encoding writes `SparseVector` JSON for L0/L1 upserts.
- query encoding produces sparse vectors for local scoring.
- encoder failures degrade sparse search without breaking relational, FTS, or dense vector operations.

### Profile sync tests

- sync L2 profile.
- sync L3 profile.
- pull profiles.
- delete profiles.
- repeated sync updates content/version correctly.

### Backfill tests

- conversations backfill into L0.
- memory atoms backfill into L1.
- scenarios backfill into L2 profiles.
- persona backfill into L3 profiles.
- backfill is idempotent.
- backfill does not corrupt existing new-store data.

### Integration tests

- `RecallService` reads L0/L1/profile data from `IMemoryStore`.
- L1 pipeline writes into `IMemoryStore`.
- `save_memory` persists through `IMemoryStore`.
- task/offload/job features still use their existing Project A storage paths.

## Implementation order

1. Add `@tencentdb-agent-memory/tcvdb-text` and update the Bun lockfile.
2. Add store types.
3. Add local BM25 wrapper.
4. Add store migration schema, including sparse-vector tables.
5. Add `SqliteMemoryStore` lifecycle/capabilities.
6. Add L1 upsert/query/search/delete, including sparse-vector writes.
7. Add L0 upsert/query/search/delete, including sparse-vector writes.
8. Add profile sync.
9. Add reindexing.
10. Add backfill with FTS, dense vector, and sparse-vector index writes.
11. Refactor `RecallService`.
12. Refactor L1 pipeline writes.
13. Refactor `MemoryService` generic L0/L1/profile operations.
14. Keep task/offload/job-specific operations on existing app storage.
15. Add tests for each layer and integration path.
16. Run `bun test` and `bunx tsc --noEmit`.

## Open design decisions resolved

- The target is Project A.
- The approach is native replacement, not a thin wrapper.
- New TencentDB-style tables will be introduced.
- Existing data will be backfilled.
- FTS5 stays enabled.
- No Tencent Cloud VectorDB backend will be added now.
- `@tencentdb-agent-memory/tcvdb-text` will be added for local BM25 sparse-vector encoding.
- Sparse vectors are supported locally, but Tencent Cloud VectorDB is still out of scope.
- Native hybrid search is unsupported in this implementation.

## Success criteria

- Project A has a narrow `IMemoryStore` interface for generic memory storage.
- Project A has a working `SqliteMemoryStore` implementation with L0, L1, profile sync, vector search, FTS5 search, local BM25 sparse-vector support, lifecycle, capabilities, and reindexing.
- Existing conversations, memory atoms, scenarios, and personas are backfilled into the new store tables.
- Generic memory consumers use `IMemoryStore` instead of directly depending on the old broad `MemoryBackend` methods.
- Project-A-specific task/offload/job storage remains outside `IMemoryStore`.
- Existing memory, recall, pipeline, offload, task, and autonomous-job tests pass after the refactor.
- New store tests cover lifecycle, capabilities, L0, L1, local BM25 sparse vectors, profile sync, reindexing, backfill, and integration.
