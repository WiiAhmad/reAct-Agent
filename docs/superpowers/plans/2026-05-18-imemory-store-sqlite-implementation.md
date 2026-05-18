# IMemoryStore SQLite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Project-A-native `IMemoryStore` and `SqliteMemoryStore` backed by Bun SQLite, FTS5, sqlite-vec, and local BM25 sparse vectors, then move generic L0/L1/L2/L3 memory consumers onto that store while leaving task/offload/job-specific storage on the existing backend.

**Architecture:** Keep `MemoryBackend` as the broad app-storage contract for Project-A-specific tables, and add `IMemoryStore` as the narrow generic memory-store contract. `SqliteMemoryStore` owns new `memory_store_*` tables, including L0, L1, profile, FTS, dense-vector, and sparse-vector tables. Existing services receive both dependencies during the transition: generic memory paths use `IMemoryStore`; task/offload/lineage/checkpoint/generated-skill paths continue to use `MemoryBackend`.

**Tech Stack:** Bun, TypeScript strict mode, Bun SQLite, SQLite FTS5, `sqlite-vec`, `@tencentdb-agent-memory/tcvdb-text`, Bun test runner.

---

## Source references

- Approved design: `docs/superpowers/specs/2026-05-18-imemory-store-sqlite-design.md`
- Project B reference contract: `TencentDB-Agent-Memory/src/core/store/types.ts`
- Project B BM25 reference: `TencentDB-Agent-Memory/src/core/store/bm25-local.ts`
- Current broad backend: `src/memory/core/backend.ts`
- Current SQLite backend: `src/memory/backends/sqlite/backend.ts`
- Current SQLite schema: `src/memory/backends/sqlite/migrate.ts`
- Current vector helpers: `src/memory/backends/sqlite/vec.ts`
- Composition root: `src/memory/integration/factory.ts`
- Generic consumers: `src/memory/recall/service.ts`, `src/memory/pipeline/coordinator.ts`, `src/memory/pipeline/l1.ts`, `src/memory/pipeline/l2.ts`, `src/memory/pipeline/l3.ts`, `src/memory/core/service.ts`

## File structure

Create these files:

- `src/memory/core/store/types.ts` — Project-A-native `IMemoryStore` contract and store record/search/profile types.
- `src/memory/backends/sqlite/bm25-local.ts` — safe wrapper around `@tencentdb-agent-memory/tcvdb-text`.
- `src/memory/backends/sqlite/store-migrate.ts` — new `memory_store_*` schema creation.
- `src/memory/backends/sqlite/store.ts` — `SqliteMemoryStore` implementation.
- `src/memory/backends/sqlite/store-backfill.ts` — idempotent migration from legacy tables into `memory_store_*` tables.
- `tests/memory/imemory-store-types.test.ts` — minimal contract import/type smoke tests.
- `tests/memory/sqlite-store-lifecycle.test.ts` — capabilities, migration, init, close.
- `tests/memory/sqlite-store-l1.test.ts` — L1 CRUD, FTS, vector, sparse, hybrid.
- `tests/memory/sqlite-store-l0.test.ts` — L0 CRUD, FTS, vector, sparse, extraction queries.
- `tests/memory/sqlite-store-profiles.test.ts` — L2/L3 profile sync.
- `tests/memory/sqlite-store-backfill.test.ts` — backfill coverage.
- `tests/memory/imemory-store-integration.test.ts` — `RecallService`, `PipelineCoordinator`, `MemoryService` integration against the new store.

Modify these files:

- `package.json` — add `@tencentdb-agent-memory/tcvdb-text` dependency.
- `bun.lock` — update via `bun add @tencentdb-agent-memory/tcvdb-text`.
- `src/memory/backends/sqlite/vec.ts` — add reusable vector table helpers for `memory_store_l0_vec` and `memory_store_l1_vec` without breaking `memory_atoms_vec`.
- `src/memory/recall/service.ts` — receive `IMemoryStore` for generic recall while retaining `MemoryBackend` for task-canvas and lineage fallback.
- `src/memory/pipeline/coordinator.ts` — receive `IMemoryStore` for L0/L1/profile reads and writes while retaining `MemoryBackend` for checkpoints and lineage.
- `src/memory/pipeline/l1.ts` — write L1 records through `IMemoryStore` and keep lineage writes on `MemoryBackend`.
- `src/memory/pipeline/l2.ts` — sync L2 profile through `IMemoryStore` and keep lineage writes on `MemoryBackend`.
- `src/memory/pipeline/l3.ts` — sync L3 profile through `IMemoryStore` and keep lineage writes on `MemoryBackend`.
- `src/memory/core/service.ts` — use `IMemoryStore` for generic counts, save_memory, and `logTurn`; keep app-specific operations on `MemoryBackend`.
- `src/memory/integration/factory.ts` — instantiate `SqliteMemoryStore`, run init/backfill, and inject it into generic services.
- Existing memory tests as needed to use the new constructors.

---

### Task 1: Add BM25 dependency

**Files:**
- Modify: `package.json:16-26`
- Modify: `bun.lock`

- [ ] **Step 1: Add the dependency with Bun**

Run:

```powershell
bun add @tencentdb-agent-memory/tcvdb-text
```

Expected: `package.json` gains `"@tencentdb-agent-memory/tcvdb-text"` under `dependencies`, and `bun.lock` is updated.

- [ ] **Step 2: Verify dependency is installed**

Run:

```powershell
bun pm ls @tencentdb-agent-memory/tcvdb-text
```

Expected: output includes `@tencentdb-agent-memory/tcvdb-text`.

- [ ] **Step 3: Commit**

```powershell
git add package.json bun.lock
git commit -m @'
feat: add local BM25 text encoder

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 2: Define the Project-A IMemoryStore contract

**Files:**
- Create: `src/memory/core/store/types.ts`
- Test: `tests/memory/imemory-store-types.test.ts`

- [ ] **Step 1: Write the failing type/import smoke test**

Create `tests/memory/imemory-store-types.test.ts`:

```ts
import { expect, test } from "bun:test";
import type { IMemoryStore, L0Record, L1Record, ProfileSyncRecord, StoreCapabilities } from "../../src/memory/core/store/types";

test("IMemoryStore types model generic L0 L1 and profile storage", () => {
  const capabilities: StoreCapabilities = {
    vectorSearch: true,
    ftsSearch: true,
    nativeHybridSearch: false,
    sparseVectors: true,
  };
  const l0: L0Record = {
    recordId: "l0-1",
    sessionKey: "telegram:c1:u1",
    sessionId: "c1",
    chatId: "c1",
    userId: "u1",
    role: "user",
    messageText: "remember Bun runtime",
    recordedAt: "2026-05-18T00:00:00.000Z",
    timestamp: 1,
    metadata: { source: "test" },
  };
  const l1: L1Record = {
    recordId: "l1-1",
    userId: "u1",
    sessionKey: "telegram:c1:u1",
    sessionId: "c1",
    content: "User prefers Bun runtime",
    type: "L1",
    priority: 8,
    sceneName: "",
    timestampStr: "2026-05-18T00:00:00.000Z",
    sourceConversationIds: [1],
    metadata: {},
    createdTime: "2026-05-18T00:00:00.000Z",
    updatedTime: "2026-05-18T00:00:00.000Z",
  };
  const profile: ProfileSyncRecord = {
    id: "profile-1",
    type: "l3",
    userId: "u1",
    filename: "persona-u1.md",
    content: "# Persona",
    contentMd5: "md5",
    version: 1,
    createdAtMs: 1,
    updatedAtMs: 2,
    metadata: {},
  };
  const store = undefined as unknown as IMemoryStore;

  expect(capabilities.nativeHybridSearch).toBe(false);
  expect(l0.sessionKey).toBe("telegram:c1:u1");
  expect(l1.sourceConversationIds).toEqual([1]);
  expect(profile.type).toBe("l3");
  expect(store).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
bun test tests/memory/imemory-store-types.test.ts
```

Expected: FAIL with a module resolution error for `src/memory/core/store/types`.

- [ ] **Step 3: Create the store types**

Create `src/memory/core/store/types.ts`:

```ts
import type { ConversationTurnRole, EventMeta } from "../types";

export type MaybePromise<T> = T | Promise<T>;

export type StoreCapabilities = {
  vectorSearch: boolean;
  ftsSearch: boolean;
  nativeHybridSearch: boolean;
  sparseVectors: boolean;
};

export type StoreInitResult = {
  capabilities: StoreCapabilities;
  degraded: boolean;
};

export type EmbeddingProviderInfo = {
  provider?: string;
  model?: string;
  dimensions?: number;
};

export type L0Record = {
  recordId: string;
  sessionKey: string;
  sessionId: string;
  chatId: string;
  userId: string;
  role: ConversationTurnRole;
  messageText: string;
  recordedAt: string;
  timestamp: number;
  metadata?: EventMeta;
};

export type L0QueryRow = L0Record;

export type L0SessionGroup = {
  sessionId: string;
  records: L0QueryRow[];
};

export type L0SearchResult = L0Record & {
  score: number;
};

export type L0FtsResult = L0Record & {
  score: number;
};

export type L1Record = {
  recordId: string;
  userId: string;
  sessionKey: string;
  sessionId: string;
  content: string;
  type: "L1" | "L2" | "L3" | string;
  priority: number;
  sceneName: string;
  timestampStr: string;
  timestampStart?: string;
  timestampEnd?: string;
  sourceConversationIds: number[];
  metadata?: EventMeta;
  createdTime: string;
  updatedTime: string;
};

export type L1QueryFilter = {
  userId?: string;
  sessionKey?: string;
  sessionId?: string;
  type?: string;
  limit?: number;
};

export type L1RecordRow = L1Record;

export type L1SearchResult = L1Record & {
  score: number;
};

export type L1FtsResult = L1Record & {
  score: number;
};

export type ProfileRecord = {
  id: string;
  type: "l2" | "l3";
  userId: string;
  filename: string;
  content: string;
  contentMd5: string;
  version: number;
  createdAtMs: number;
  updatedAtMs: number;
  metadata?: EventMeta;
};

export type ProfileSyncRecord = ProfileRecord;

export type IMemoryStore = {
  readonly supportsDeferredEmbedding?: boolean;

  init(providerInfo?: EmbeddingProviderInfo): MaybePromise<StoreInitResult>;
  isDegraded(): boolean;
  getCapabilities(): StoreCapabilities;
  close(): void;

  upsertL1(record: L1Record, embedding?: Float32Array): MaybePromise<boolean>;
  deleteL1(recordId: string): MaybePromise<boolean>;
  deleteL1Batch(recordIds: string[]): MaybePromise<boolean>;
  deleteL1Expired(cutoffIso: string): MaybePromise<number>;
  countL1(userId?: string): MaybePromise<number>;
  queryL1Records(filter?: L1QueryFilter): MaybePromise<L1RecordRow[]>;
  getAllL1Texts(): MaybePromise<Array<{ record_id: string; content: string; updated_time: string }>>;
  searchL1Vector(queryEmbedding: Float32Array, topK?: number, queryText?: string, userId?: string): MaybePromise<L1SearchResult[]>;
  searchL1Fts(ftsQuery: string, limit?: number, userId?: string): MaybePromise<L1FtsResult[]>;
  searchL1Hybrid?(params: { query?: string; queryEmbedding?: Float32Array; topK?: number; userId?: string }): MaybePromise<L1SearchResult[]>;

  upsertL0(record: L0Record, embedding?: Float32Array): MaybePromise<boolean>;
  updateL0Embedding?(recordId: string, embedding: Float32Array): MaybePromise<boolean>;
  deleteL0(recordId: string): MaybePromise<boolean>;
  deleteL0Expired(cutoffIso: string): MaybePromise<number>;
  countL0(userId?: string): MaybePromise<number>;
  queryL0ForL1(sessionKey: string, afterRecordedAtMs?: number, limit?: number): MaybePromise<L0QueryRow[]>;
  queryL0GroupedBySessionId(sessionKey: string, afterRecordedAtMs?: number, limit?: number): MaybePromise<L0SessionGroup[]>;
  getAllL0Texts(): MaybePromise<Array<{ record_id: string; message_text: string; recorded_at: string }>>;
  searchL0Vector(queryEmbedding: Float32Array, topK?: number, queryText?: string, userId?: string): MaybePromise<L0SearchResult[]>;
  searchL0Fts(ftsQuery: string, limit?: number, userId?: string): MaybePromise<L0FtsResult[]>;

  pullProfiles?(): Promise<ProfileRecord[]>;
  syncProfiles?(records: ProfileSyncRecord[]): Promise<void>;
  deleteProfiles?(recordIds: string[]): Promise<void>;

  reindexAll(embedFn: (text: string) => Promise<Float32Array>, onProgress?: (done: number, total: number, layer: "L1" | "L0") => void): Promise<{ l1Count: number; l0Count: number }>;
  isFtsAvailable(): boolean;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
bun test tests/memory/imemory-store-types.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/memory/core/store/types.ts tests/memory/imemory-store-types.test.ts
git commit -m @'
feat: define generic memory store contract

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 3: Add local BM25 wrapper

**Files:**
- Create: `src/memory/backends/sqlite/bm25-local.ts`
- Test: `tests/memory/sqlite-store-lifecycle.test.ts`

- [ ] **Step 1: Write failing BM25 wrapper tests**

Create `tests/memory/sqlite-store-lifecycle.test.ts` with the first tests:

```ts
import { expect, test } from "bun:test";
import { createBM25LocalEncoder } from "../../src/memory/backends/sqlite/bm25-local";

test("local BM25 encoder produces sparse vectors for documents and queries", () => {
  const encoder = createBM25LocalEncoder({ enabled: true, language: "zh" });

  expect(encoder.available).toBe(true);
  expect(encoder.encodeTexts(["remember Bun runtime"])[0]?.length).toBeGreaterThan(0);
  expect(encoder.encodeQueries(["Bun runtime"])[0]?.length).toBeGreaterThan(0);
});

test("local BM25 encoder can be disabled", () => {
  const encoder = createBM25LocalEncoder({ enabled: false, language: "zh" });

  expect(encoder.available).toBe(false);
  expect(encoder.encodeTexts(["remember Bun runtime"])).toEqual([]);
  expect(encoder.encodeQueries(["Bun runtime"])).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
bun test tests/memory/sqlite-store-lifecycle.test.ts
```

Expected: FAIL with a module resolution error for `bm25-local`.

- [ ] **Step 3: Create the BM25 wrapper**

Create `src/memory/backends/sqlite/bm25-local.ts`:

```ts
import { BM25Encoder, type SparseVector } from "@tencentdb-agent-memory/tcvdb-text";

export type { SparseVector };

export type BM25LocalOptions = {
  enabled?: boolean;
  language?: "zh" | "en";
};

export type BM25LocalEncoder = {
  available: boolean;
  encodeTexts(texts: string[]): SparseVector[];
  encodeQueries(texts: string[]): SparseVector[];
};

const unavailableEncoder: BM25LocalEncoder = {
  available: false,
  encodeTexts: () => [],
  encodeQueries: () => [],
};

export function createBM25LocalEncoder(options: BM25LocalOptions = {}): BM25LocalEncoder {
  if (options.enabled === false) {
    return unavailableEncoder;
  }

  try {
    const encoder = BM25Encoder.default(options.language ?? "zh");
    return {
      available: true,
      encodeTexts(texts: string[]): SparseVector[] {
        if (texts.length === 0) {
          return [];
        }
        try {
          return encoder.encodeTexts(texts);
        } catch {
          return [];
        }
      },
      encodeQueries(texts: string[]): SparseVector[] {
        if (texts.length === 0) {
          return [];
        }
        try {
          return encoder.encodeQueries(texts);
        } catch {
          return [];
        }
      },
    };
  } catch {
    return unavailableEncoder;
  }
}

export function sparseVectorScore(query: SparseVector, document: SparseVector): number {
  if (query.length === 0 || document.length === 0) {
    return 0;
  }

  const documentWeights = new Map<number, number>();
  for (const [token, weight] of document) {
    documentWeights.set(token, weight);
  }

  let score = 0;
  for (const [token, weight] of query) {
    score += weight * (documentWeights.get(token) ?? 0);
  }

  return score;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```powershell
bun test tests/memory/sqlite-store-lifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/memory/backends/sqlite/bm25-local.ts tests/memory/sqlite-store-lifecycle.test.ts
git commit -m @'
feat: wrap local BM25 sparse encoder

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 4: Add store-specific SQLite schema

**Files:**
- Create: `src/memory/backends/sqlite/store-migrate.ts`
- Modify: `tests/memory/sqlite-store-lifecycle.test.ts`

- [ ] **Step 1: Add failing schema migration test**

Append to `tests/memory/sqlite-store-lifecycle.test.ts`:

```ts
import { Database } from "bun:sqlite";
import { migrateSqliteMemoryStore } from "../../src/memory/backends/sqlite/store-migrate";

test("store migration creates generic memory store tables", () => {
  const db = new Database(":memory:");

  migrateSqliteMemoryStore(db);

  const tableNames = (db.query("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') ORDER BY name ASC").all() as Array<{ name: string }>).map((row) => row.name);
  expect(tableNames).toContain("memory_store_l0");
  expect(tableNames).toContain("memory_store_l0_fts");
  expect(tableNames).toContain("memory_store_l0_sparse");
  expect(tableNames).toContain("memory_store_l1");
  expect(tableNames).toContain("memory_store_l1_fts");
  expect(tableNames).toContain("memory_store_l1_sparse");
  expect(tableNames).toContain("memory_store_profiles");
  expect(tableNames).toContain("memory_store_meta");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
bun test tests/memory/sqlite-store-lifecycle.test.ts
```

Expected: FAIL with a module resolution error for `store-migrate`.

- [ ] **Step 3: Create the migration function**

Create `src/memory/backends/sqlite/store-migrate.ts`:

```ts
import type { Database } from "bun:sqlite";

export function migrateSqliteMemoryStore(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_store_l0 (
      record_id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL,
      session_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      message_text TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_store_l0_fts USING fts5(
      message_text,
      record_id UNINDEXED,
      session_key UNINDEXED,
      session_id UNINDEXED,
      chat_id UNINDEXED,
      user_id UNINDEXED,
      tokenize = 'unicode61'
    );

    CREATE TABLE IF NOT EXISTS memory_store_l0_sparse (
      record_id TEXT PRIMARY KEY,
      sparse_vector_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_store_l1 (
      record_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_key TEXT NOT NULL,
      session_id TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT NOT NULL,
      priority INTEGER NOT NULL,
      scene_name TEXT NOT NULL DEFAULT '',
      timestamp_str TEXT NOT NULL,
      timestamp_start TEXT NOT NULL DEFAULT '',
      timestamp_end TEXT NOT NULL DEFAULT '',
      source_conversation_ids_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_time TEXT NOT NULL,
      updated_time TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_store_l1_fts USING fts5(
      content,
      record_id UNINDEXED,
      user_id UNINDEXED,
      session_key UNINDEXED,
      session_id UNINDEXED,
      type UNINDEXED,
      scene_name UNINDEXED,
      tokenize = 'unicode61'
    );

    CREATE TABLE IF NOT EXISTS memory_store_l1_sparse (
      record_id TEXT PRIMARY KEY,
      sparse_vector_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_store_profiles (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('l2', 'l3')),
      user_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      content TEXT NOT NULL,
      content_md5 TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS memory_store_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS memory_store_l0_session_timestamp_idx ON memory_store_l0(session_key, timestamp);
    CREATE INDEX IF NOT EXISTS memory_store_l0_user_timestamp_idx ON memory_store_l0(user_id, timestamp);
    CREATE INDEX IF NOT EXISTS memory_store_l1_user_updated_idx ON memory_store_l1(user_id, updated_time);
    CREATE INDEX IF NOT EXISTS memory_store_profiles_user_type_idx ON memory_store_profiles(user_id, type);
  `);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
bun test tests/memory/sqlite-store-lifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/memory/backends/sqlite/store-migrate.ts tests/memory/sqlite-store-lifecycle.test.ts
git commit -m @'
feat: add generic memory store schema

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 5: Extend vector helpers for store tables

**Files:**
- Modify: `src/memory/backends/sqlite/vec.ts`
- Modify: `tests/memory/sqlite-store-lifecycle.test.ts`

- [ ] **Step 1: Add failing vector helper test**

Append to `tests/memory/sqlite-store-lifecycle.test.ts`:

```ts
import { ensureSqliteVecTable } from "../../src/memory/backends/sqlite/vec";

test("sqlite-vec helper can create store-specific vector tables", () => {
  const db = new Database(":memory:");

  ensureSqliteVecTable(db, "memory_store_l1_vec");
  ensureSqliteVecTable(db, "memory_store_l0_vec");

  const tableNames = (db.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC").all() as Array<{ name: string }>).map((row) => row.name);
  expect(tableNames).toContain("memory_store_l1_vec");
  expect(tableNames).toContain("memory_store_l0_vec");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
bun test tests/memory/sqlite-store-lifecycle.test.ts
```

Expected: FAIL because `ensureSqliteVecTable` accepts no table-name argument.

- [ ] **Step 3: Update vector helper**

Modify `src/memory/backends/sqlite/vec.ts`:

```ts
const VECTOR_DIMENSIONS = 64;

export function vectorDimensions(): number {
  return VECTOR_DIMENSIONS;
}

export function ensureSqliteVecTable(db: Database, tableName = "memory_atoms_vec"): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
    throw new Error(`Invalid sqlite-vec table name: ${tableName}`);
  }
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName} USING vec0(embedding float[${VECTOR_DIMENSIONS}])`);
}
```

Keep the existing `loadSqliteVec`, `embedTextToVector`, `isZeroVector`, `serializeVector`, and `deserializeVector` exports unchanged.

- [ ] **Step 4: Run existing vector tests**

Run:

```powershell
bun test tests/memory/sqlite-vec.test.ts tests/memory/sqlite-store-lifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/memory/backends/sqlite/vec.ts tests/memory/sqlite-store-lifecycle.test.ts
git commit -m @'
feat: allow store-specific sqlite-vec tables

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 6: Implement SqliteMemoryStore lifecycle and capabilities

**Files:**
- Create: `src/memory/backends/sqlite/store.ts`
- Modify: `tests/memory/sqlite-store-lifecycle.test.ts`

- [ ] **Step 1: Add failing lifecycle tests**

Append to `tests/memory/sqlite-store-lifecycle.test.ts`:

```ts
import { SqliteMemoryStore } from "../../src/memory/backends/sqlite/store";

test("SqliteMemoryStore initializes capabilities and metadata", async () => {
  const db = new Database(":memory:");
  const store = new SqliteMemoryStore(db, { sqliteVecEnabled: false, bm25Enabled: true });

  const result = await store.init({ provider: "local", model: "deterministic", dimensions: 64 });

  expect(result.capabilities.ftsSearch).toBe(true);
  expect(result.capabilities.vectorSearch).toBe(false);
  expect(result.capabilities.nativeHybridSearch).toBe(false);
  expect(result.capabilities.sparseVectors).toBe(true);
  expect(store.isFtsAvailable()).toBe(true);
  expect(store.isDegraded()).toBe(false);
  expect(db.query("SELECT value FROM memory_store_meta WHERE key = 'embedding.dimensions'").get()).toEqual({ value: "64" });
  store.close();
  store.close();
});

test("SqliteMemoryStore degrades vector capability when disabled", async () => {
  const db = new Database(":memory:");
  const store = new SqliteMemoryStore(db, { sqliteVecEnabled: false, bm25Enabled: false });

  await store.init();

  expect(store.getCapabilities()).toEqual({
    vectorSearch: false,
    ftsSearch: true,
    nativeHybridSearch: false,
    sparseVectors: false,
  });
  expect(store.isDegraded()).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
bun test tests/memory/sqlite-store-lifecycle.test.ts
```

Expected: FAIL with a module resolution error for `store`.

- [ ] **Step 3: Create initial store implementation**

Create `src/memory/backends/sqlite/store.ts` with lifecycle, mapping helpers, and empty method stubs that return safe values:

```ts
import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type {
  EmbeddingProviderInfo,
  IMemoryStore,
  L0FtsResult,
  L0QueryRow,
  L0Record,
  L0SearchResult,
  L0SessionGroup,
  L1FtsResult,
  L1QueryFilter,
  L1Record,
  L1RecordRow,
  L1SearchResult,
  ProfileRecord,
  ProfileSyncRecord,
  StoreCapabilities,
  StoreInitResult,
} from "../../core/store/types";
import { createBM25LocalEncoder, sparseVectorScore, type BM25LocalEncoder, type SparseVector } from "./bm25-local";
import { embedTextToVector, ensureSqliteVecTable, isZeroVector, loadSqliteVec, serializeVector, deserializeVector } from "./vec";
import { migrateSqliteMemoryStore } from "./store-migrate";

export type SqliteMemoryStoreOptions = {
  sqliteVecEnabled?: boolean;
  bm25Enabled?: boolean;
  bm25Language?: "zh" | "en";
  ownsDatabase?: boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function parseNumberArray(raw: string): number[] {
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === "number") : [];
}

function stableProfileHash(content: string): string {
  return createHash("md5").update(content).digest("hex");
}

function ftsQuery(query: string): string {
  return query
    .normalize("NFKC")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.replace(/"/g, "") }*`)
    .join(" OR ");
}

export class SqliteMemoryStore implements IMemoryStore {
  private capabilities: StoreCapabilities = {
    vectorSearch: false,
    ftsSearch: false,
    nativeHybridSearch: false,
    sparseVectors: false,
  };
  private degraded = false;
  private bm25: BM25LocalEncoder = createBM25LocalEncoder({ enabled: false });
  private closed = false;

  constructor(
    private readonly db: Database,
    private readonly options: SqliteMemoryStoreOptions = {},
  ) {}

  async init(providerInfo: EmbeddingProviderInfo = {}): Promise<StoreInitResult> {
    migrateSqliteMemoryStore(this.db);
    this.capabilities.ftsSearch = true;

    if (this.options.sqliteVecEnabled !== false) {
      try {
        loadSqliteVec(this.db);
        ensureSqliteVecTable(this.db, "memory_store_l0_vec");
        ensureSqliteVecTable(this.db, "memory_store_l1_vec");
        this.capabilities.vectorSearch = true;
      } catch {
        this.capabilities.vectorSearch = false;
        this.degraded = true;
      }
    }

    this.bm25 = createBM25LocalEncoder({
      enabled: this.options.bm25Enabled !== false,
      language: this.options.bm25Language ?? "zh",
    });
    this.capabilities.sparseVectors = this.bm25.available;
    this.writeMeta("embedding.provider", providerInfo.provider ?? "local");
    this.writeMeta("embedding.model", providerInfo.model ?? "deterministic-local");
    this.writeMeta("embedding.dimensions", String(providerInfo.dimensions ?? 64));
    this.writeMeta("bm25.enabled", String(this.capabilities.sparseVectors));
    this.writeMeta("bm25.language", this.options.bm25Language ?? "zh");

    return { capabilities: this.getCapabilities(), degraded: this.degraded };
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  getCapabilities(): StoreCapabilities {
    return { ...this.capabilities };
  }

  isFtsAvailable(): boolean {
    return this.capabilities.ftsSearch;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.options.ownsDatabase) {
      this.db.close();
    }
  }

  private writeMeta(key: string, value: string): void {
    this.db.query(`
      INSERT INTO memory_store_meta (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, nowIso());
  }

  async upsertL1(_record: L1Record, _embedding?: Float32Array): Promise<boolean> { return false; }
  async deleteL1(_recordId: string): Promise<boolean> { return false; }
  async deleteL1Batch(recordIds: string[]): Promise<boolean> {
    for (const recordId of recordIds) {
      await this.deleteL1(recordId);
    }
    return true;
  }
  async deleteL1Expired(_cutoffIso: string): Promise<number> { return 0; }
  async countL1(_userId?: string): Promise<number> { return 0; }
  async queryL1Records(_filter: L1QueryFilter = {}): Promise<L1RecordRow[]> { return []; }
  async getAllL1Texts(): Promise<Array<{ record_id: string; content: string; updated_time: string }>> { return []; }
  async searchL1Vector(_queryEmbedding: Float32Array, _topK = 5, _queryText?: string, _userId?: string): Promise<L1SearchResult[]> { return []; }
  async searchL1Fts(_ftsQuery: string, _limit = 5, _userId?: string): Promise<L1FtsResult[]> { return []; }
  async searchL1Hybrid(_params: { query?: string; queryEmbedding?: Float32Array; topK?: number; userId?: string }): Promise<L1SearchResult[]> { return []; }

  async upsertL0(_record: L0Record, _embedding?: Float32Array): Promise<boolean> { return false; }
  async updateL0Embedding(_recordId: string, _embedding: Float32Array): Promise<boolean> { return false; }
  async deleteL0(_recordId: string): Promise<boolean> { return false; }
  async deleteL0Expired(_cutoffIso: string): Promise<number> { return 0; }
  async countL0(_userId?: string): Promise<number> { return 0; }
  async queryL0ForL1(_sessionKey: string, _afterRecordedAtMs = 0, _limit = 80): Promise<L0QueryRow[]> { return []; }
  async queryL0GroupedBySessionId(_sessionKey: string, _afterRecordedAtMs = 0, _limit = 80): Promise<L0SessionGroup[]> { return []; }
  async getAllL0Texts(): Promise<Array<{ record_id: string; message_text: string; recorded_at: string }>> { return []; }
  async searchL0Vector(_queryEmbedding: Float32Array, _topK = 5, _queryText?: string, _userId?: string): Promise<L0SearchResult[]> { return []; }
  async searchL0Fts(_ftsQuery: string, _limit = 5, _userId?: string): Promise<L0FtsResult[]> { return []; }

  async pullProfiles(): Promise<ProfileRecord[]> { return []; }
  async syncProfiles(_records: ProfileSyncRecord[]): Promise<void> {}
  async deleteProfiles(_recordIds: string[]): Promise<void> {}
  async reindexAll(_embedFn: (text: string) => Promise<Float32Array>, _onProgress?: (done: number, total: number, layer: "L1" | "L0") => void): Promise<{ l1Count: number; l0Count: number }> {
    return { l1Count: 0, l0Count: 0 };
  }
}
```

- [ ] **Step 4: Run lifecycle tests**

Run:

```powershell
bun test tests/memory/sqlite-store-lifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/memory/backends/sqlite/store.ts tests/memory/sqlite-store-lifecycle.test.ts
git commit -m @'
feat: add sqlite memory store lifecycle

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 7: Implement L1 storage, search, sparse scoring, and hybrid search

**Files:**
- Modify: `src/memory/backends/sqlite/store.ts`
- Create: `tests/memory/sqlite-store-l1.test.ts`

- [ ] **Step 1: Write failing L1 tests**

Create `tests/memory/sqlite-store-l1.test.ts`:

```ts
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SqliteMemoryStore } from "../../src/memory/backends/sqlite/store";
import { embedTextToVector } from "../../src/memory/backends/sqlite/vec";

function l1(content: string, recordId = "l1-1") {
  return {
    recordId,
    userId: "u1",
    sessionKey: "telegram:c1:u1",
    sessionId: "c1",
    content,
    type: "L1",
    priority: 7,
    sceneName: "",
    timestampStr: "2026-05-18T00:00:00.000Z",
    sourceConversationIds: [1],
    metadata: { source: "test" },
    createdTime: "2026-05-18T00:00:00.000Z",
    updatedTime: "2026-05-18T00:00:00.000Z",
  };
}

test("L1 upsert query FTS vector sparse and delete work", async () => {
  const db = new Database(":memory:");
  const store = new SqliteMemoryStore(db, { bm25Enabled: true });
  await store.init();

  expect(await store.upsertL1(l1("User prefers Bun runtime"))).toBe(true);
  expect(await store.countL1("u1")).toBe(1);
  expect((await store.queryL1Records({ userId: "u1", limit: 5 }))[0]?.content).toBe("User prefers Bun runtime");
  expect((await store.searchL1Fts("Bun", 5, "u1"))[0]?.recordId).toBe("l1-1");
  expect((await store.searchL1Vector(embedTextToVector("bun runtime"), 5, "bun runtime", "u1"))[0]?.recordId).toBe("l1-1");
  expect((await store.searchL1Hybrid({ query: "Bun runtime", queryEmbedding: embedTextToVector("Bun runtime"), topK: 5, userId: "u1" }))[0]?.recordId).toBe("l1-1");

  const sparseRow = db.query("SELECT sparse_vector_json FROM memory_store_l1_sparse WHERE record_id = ?").get("l1-1") as { sparse_vector_json: string } | null;
  expect(JSON.parse(sparseRow?.sparse_vector_json ?? "[]").length).toBeGreaterThan(0);

  expect(await store.upsertL1(l1("User prefers TypeScript runtime", "l1-1"))).toBe(true);
  expect((await store.searchL1Fts("TypeScript", 5, "u1"))[0]?.content).toBe("User prefers TypeScript runtime");

  expect(await store.deleteL1("l1-1")).toBe(true);
  expect(await store.countL1("u1")).toBe(0);
  expect(await store.searchL1Fts("TypeScript", 5, "u1")).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
bun test tests/memory/sqlite-store-l1.test.ts
```

Expected: FAIL because `upsertL1`, queries, and searches return stub values.

- [ ] **Step 3: Implement L1 mapping and writes**

In `src/memory/backends/sqlite/store.ts`, add helpers inside `SqliteMemoryStore`:

```ts
private l1RowToRecord(row: {
  record_id: string;
  user_id: string;
  session_key: string;
  session_id: string;
  content: string;
  type: string;
  priority: number;
  scene_name: string;
  timestamp_str: string;
  timestamp_start: string;
  timestamp_end: string;
  source_conversation_ids_json: string;
  metadata_json: string;
  created_time: string;
  updated_time: string;
}): L1RecordRow {
  return {
    recordId: row.record_id,
    userId: row.user_id,
    sessionKey: row.session_key,
    sessionId: row.session_id,
    content: row.content,
    type: row.type,
    priority: row.priority,
    sceneName: row.scene_name,
    timestampStr: row.timestamp_str,
    timestampStart: row.timestamp_start || undefined,
    timestampEnd: row.timestamp_end || undefined,
    sourceConversationIds: parseNumberArray(row.source_conversation_ids_json),
    metadata: parseJsonObject(row.metadata_json),
    createdTime: row.created_time,
    updatedTime: row.updated_time,
  };
}

private replaceL1SearchRows(record: L1Record): void {
  this.db.query(`DELETE FROM memory_store_l1_fts WHERE record_id = ?`).run(record.recordId);
  this.db.query(`
    INSERT INTO memory_store_l1_fts (content, record_id, user_id, session_key, session_id, type, scene_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(record.content, record.recordId, record.userId, record.sessionKey, record.sessionId, record.type, record.sceneName);
}

private replaceL1Vector(recordId: string, embedding: Float32Array): void {
  if (!this.capabilities.vectorSearch) {
    return;
  }
  const rowid = this.numericRowId(recordId);
  this.db.query(`DELETE FROM memory_store_l1_vec WHERE rowid = ?`).run(rowid);
  this.db.query(`INSERT INTO memory_store_l1_vec(rowid, embedding) VALUES (?, ?)`).run(rowid, embedding);
}

private replaceL1Sparse(recordId: string, content: string, updatedAt: string): void {
  if (!this.capabilities.sparseVectors) {
    return;
  }
  const sparse = this.bm25.encodeTexts([content])[0];
  if (!sparse || sparse.length === 0) {
    this.degraded = true;
    return;
  }
  this.db.query(`
    INSERT INTO memory_store_l1_sparse (record_id, sparse_vector_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(record_id) DO UPDATE SET sparse_vector_json = excluded.sparse_vector_json, updated_at = excluded.updated_at
  `).run(recordId, JSON.stringify(sparse), updatedAt);
}

private numericRowId(recordId: string): number {
  let hash = 2166136261;
  for (const char of recordId) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 1;
}
```

Replace the L1 stub methods with:

```ts
async upsertL1(record: L1Record, embedding = embedTextToVector(record.content)): Promise<boolean> {
  try {
    const tx = this.db.transaction(() => {
      this.db.query(`
        INSERT INTO memory_store_l1 (
          record_id, user_id, session_key, session_id, content, type, priority, scene_name,
          timestamp_str, timestamp_start, timestamp_end, source_conversation_ids_json,
          metadata_json, created_time, updated_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(record_id) DO UPDATE SET
          user_id = excluded.user_id,
          session_key = excluded.session_key,
          session_id = excluded.session_id,
          content = excluded.content,
          type = excluded.type,
          priority = excluded.priority,
          scene_name = excluded.scene_name,
          timestamp_str = excluded.timestamp_str,
          timestamp_start = excluded.timestamp_start,
          timestamp_end = excluded.timestamp_end,
          source_conversation_ids_json = excluded.source_conversation_ids_json,
          metadata_json = excluded.metadata_json,
          updated_time = excluded.updated_time
      `).run(
        record.recordId,
        record.userId,
        record.sessionKey,
        record.sessionId,
        record.content,
        record.type,
        record.priority,
        record.sceneName,
        record.timestampStr,
        record.timestampStart ?? "",
        record.timestampEnd ?? "",
        JSON.stringify(record.sourceConversationIds),
        JSON.stringify(record.metadata ?? {}),
        record.createdTime,
        record.updatedTime,
      );
      this.replaceL1SearchRows(record);
      this.replaceL1Vector(record.recordId, embedding);
      this.replaceL1Sparse(record.recordId, record.content, record.updatedTime);
    });
    tx();
    return true;
  } catch {
    this.degraded = true;
    return false;
  }
}

async deleteL1(recordId: string): Promise<boolean> {
  const rowid = this.numericRowId(recordId);
  const tx = this.db.transaction(() => {
    this.db.query(`DELETE FROM memory_store_l1_fts WHERE record_id = ?`).run(recordId);
    this.db.query(`DELETE FROM memory_store_l1_sparse WHERE record_id = ?`).run(recordId);
    if (this.capabilities.vectorSearch) {
      this.db.query(`DELETE FROM memory_store_l1_vec WHERE rowid = ?`).run(rowid);
    }
    this.db.query(`DELETE FROM memory_store_l1 WHERE record_id = ?`).run(recordId);
  });
  tx();
  return true;
}

async countL1(userId?: string): Promise<number> {
  const row = userId
    ? this.db.query(`SELECT COUNT(*) AS count FROM memory_store_l1 WHERE user_id = ?`).get(userId)
    : this.db.query(`SELECT COUNT(*) AS count FROM memory_store_l1`).get();
  return (row as { count: number } | null)?.count ?? 0;
}

async queryL1Records(filter: L1QueryFilter = {}): Promise<L1RecordRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.userId) { clauses.push("user_id = ?"); params.push(filter.userId); }
  if (filter.sessionKey) { clauses.push("session_key = ?"); params.push(filter.sessionKey); }
  if (filter.sessionId) { clauses.push("session_id = ?"); params.push(filter.sessionId); }
  if (filter.type) { clauses.push("type = ?"); params.push(filter.type); }
  params.push(filter.limit ?? 50);
  const rows = this.db.query(`
    SELECT * FROM memory_store_l1
    ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY priority DESC, updated_time DESC, record_id DESC
    LIMIT ?
  `).all(...params) as Parameters<typeof this.l1RowToRecord>[0][];
  return rows.map((row) => this.l1RowToRecord(row));
}

async getAllL1Texts(): Promise<Array<{ record_id: string; content: string; updated_time: string }>> {
  return this.db.query(`SELECT record_id, content, updated_time FROM memory_store_l1 ORDER BY record_id ASC`).all() as Array<{ record_id: string; content: string; updated_time: string }>;
}
```

- [ ] **Step 4: Implement L1 search methods**

Add these methods to replace the L1 search stubs:

```ts
async searchL1Fts(query: string, limit = 5, userId?: string): Promise<L1FtsResult[]> {
  const normalized = ftsQuery(query);
  if (!normalized || !this.capabilities.ftsSearch || limit <= 0) {
    return [];
  }
  const rows = this.db.query(`
    SELECT m.*, bm25(memory_store_l1_fts) AS score
    FROM memory_store_l1_fts f
    JOIN memory_store_l1 m ON m.record_id = f.record_id
    WHERE memory_store_l1_fts MATCH ? ${userId ? "AND f.user_id = ?" : ""}
    ORDER BY score ASC, m.priority DESC, m.updated_time DESC
    LIMIT ?
  `).all(...(userId ? [normalized, userId, limit] : [normalized, limit])) as Array<Parameters<typeof this.l1RowToRecord>[0] & { score: number }>;
  return rows.map((row) => ({ ...this.l1RowToRecord(row), score: Math.abs(row.score) }));
}

async searchL1Vector(queryEmbedding: Float32Array, topK = 5, _queryText?: string, userId?: string): Promise<L1SearchResult[]> {
  if (topK <= 0 || isZeroVector(queryEmbedding)) {
    return [];
  }
  const rows = this.db.query(`SELECT * FROM memory_store_l1 ${userId ? "WHERE user_id = ?" : ""}`).all(...(userId ? [userId] : [])) as Parameters<typeof this.l1RowToRecord>[0][];
  return rows
    .map((row) => {
      const record = this.l1RowToRecord(row);
      const vector = embedTextToVector(record.content);
      let sum = 0;
      for (let index = 0; index < Math.max(queryEmbedding.length, vector.length); index += 1) {
        const delta = (queryEmbedding[index] ?? 0) - (vector[index] ?? 0);
        sum += delta * delta;
      }
      return { ...record, score: 1 / (1 + Math.sqrt(sum)) };
    })
    .filter((row) => row.score > 0.45)
    .sort((left, right) => right.score - left.score || right.priority - left.priority)
    .slice(0, topK);
}

private searchL1Sparse(query: string, topK: number, userId?: string): L1SearchResult[] {
  if (!this.capabilities.sparseVectors || topK <= 0) {
    return [];
  }
  const sparseQuery = this.bm25.encodeQueries([query])[0];
  if (!sparseQuery || sparseQuery.length === 0) {
    return [];
  }
  const rows = this.db.query(`
    SELECT m.*, s.sparse_vector_json
    FROM memory_store_l1_sparse s
    JOIN memory_store_l1 m ON m.record_id = s.record_id
    ${userId ? "WHERE m.user_id = ?" : ""}
  `).all(...(userId ? [userId] : [])) as Array<Parameters<typeof this.l1RowToRecord>[0] & { sparse_vector_json: string }>;
  return rows
    .map((row) => ({ ...this.l1RowToRecord(row), score: sparseVectorScore(sparseQuery, JSON.parse(row.sparse_vector_json) as SparseVector) }))
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || right.priority - left.priority)
    .slice(0, topK);
}

async searchL1Hybrid(params: { query?: string; queryEmbedding?: Float32Array; topK?: number; userId?: string }): Promise<L1SearchResult[]> {
  const topK = params.topK ?? 5;
  const merged = new Map<string, L1SearchResult>();
  const add = (rows: L1SearchResult[]) => {
    rows.forEach((row, index) => {
      const existing = merged.get(row.recordId);
      const score = (existing?.score ?? 0) + 1 / (60 + index + 1);
      merged.set(row.recordId, { ...(existing ?? row), score });
    });
  };
  if (params.query) {
    add((await this.searchL1Fts(params.query, topK, params.userId)).map((row) => ({ ...row, score: row.score })));
    add(this.searchL1Sparse(params.query, topK, params.userId));
  }
  if (params.queryEmbedding) {
    add(await this.searchL1Vector(params.queryEmbedding, topK, params.query, params.userId));
  }
  return [...merged.values()].sort((left, right) => right.score - left.score).slice(0, topK);
}
```

- [ ] **Step 5: Run tests**

Run:

```powershell
bun test tests/memory/sqlite-store-l1.test.ts tests/memory/sqlite-store-lifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/memory/backends/sqlite/store.ts tests/memory/sqlite-store-l1.test.ts
git commit -m @'
feat: implement sqlite store L1 search

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 8: Implement L0 storage and search

**Files:**
- Modify: `src/memory/backends/sqlite/store.ts`
- Create: `tests/memory/sqlite-store-l0.test.ts`

- [ ] **Step 1: Write failing L0 tests**

Create `tests/memory/sqlite-store-l0.test.ts`:

```ts
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SqliteMemoryStore } from "../../src/memory/backends/sqlite/store";
import { embedTextToVector } from "../../src/memory/backends/sqlite/vec";

function l0(messageText: string, recordId = "l0-1", timestamp = 1) {
  return {
    recordId,
    sessionKey: "telegram:c1:u1",
    sessionId: "c1",
    chatId: "c1",
    userId: "u1",
    role: "user" as const,
    messageText,
    recordedAt: new Date(timestamp).toISOString(),
    timestamp,
    metadata: { source: "test" },
  };
}

test("L0 upsert query FTS vector sparse update and delete work", async () => {
  const db = new Database(":memory:");
  const store = new SqliteMemoryStore(db, { bm25Enabled: true });
  await store.init();

  expect(await store.upsertL0(l0("remember Bun runtime"))).toBe(true);
  expect(await store.upsertL0(l0("assistant acknowledged Bun", "l0-2", 2))).toBe(true);
  expect(await store.countL0("u1")).toBe(2);
  expect((await store.queryL0ForL1("telegram:c1:u1", 0, 10)).map((row) => row.recordId)).toEqual(["l0-1", "l0-2"]);
  expect((await store.queryL0GroupedBySessionId("telegram:c1:u1", 0, 10))[0]?.records).toHaveLength(2);
  expect((await store.searchL0Fts("Bun", 5, "u1"))[0]?.recordId).toBe("l0-1");
  expect((await store.searchL0Vector(embedTextToVector("Bun runtime"), 5, "Bun runtime", "u1"))[0]?.recordId).toBe("l0-1");

  const sparseRow = db.query("SELECT sparse_vector_json FROM memory_store_l0_sparse WHERE record_id = ?").get("l0-1") as { sparse_vector_json: string } | null;
  expect(JSON.parse(sparseRow?.sparse_vector_json ?? "[]").length).toBeGreaterThan(0);

  expect(await store.updateL0Embedding("l0-1", embedTextToVector("new embedding"))).toBe(true);
  expect(await store.deleteL0("l0-1")).toBe(true);
  expect(await store.countL0("u1")).toBe(1);
  expect(await store.deleteL0Expired(new Date(3).toISOString())).toBe(1);
  expect(await store.countL0("u1")).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
bun test tests/memory/sqlite-store-l0.test.ts
```

Expected: FAIL because L0 methods return stub values.

- [ ] **Step 3: Implement L0 mapping and writes**

Add L0 helpers to `SqliteMemoryStore`:

```ts
private l0RowToRecord(row: {
  record_id: string;
  session_key: string;
  session_id: string;
  chat_id: string;
  user_id: string;
  role: L0Record["role"];
  message_text: string;
  recorded_at: string;
  timestamp: number;
  metadata_json: string;
}): L0Record {
  return {
    recordId: row.record_id,
    sessionKey: row.session_key,
    sessionId: row.session_id,
    chatId: row.chat_id,
    userId: row.user_id,
    role: row.role,
    messageText: row.message_text,
    recordedAt: row.recorded_at,
    timestamp: row.timestamp,
    metadata: parseJsonObject(row.metadata_json),
  };
}

private replaceL0SearchRows(record: L0Record): void {
  this.db.query(`DELETE FROM memory_store_l0_fts WHERE record_id = ?`).run(record.recordId);
  this.db.query(`
    INSERT INTO memory_store_l0_fts (message_text, record_id, session_key, session_id, chat_id, user_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(record.messageText, record.recordId, record.sessionKey, record.sessionId, record.chatId, record.userId);
}

private replaceL0Vector(recordId: string, embedding: Float32Array): void {
  if (!this.capabilities.vectorSearch) {
    return;
  }
  const rowid = this.numericRowId(recordId);
  this.db.query(`DELETE FROM memory_store_l0_vec WHERE rowid = ?`).run(rowid);
  this.db.query(`INSERT INTO memory_store_l0_vec(rowid, embedding) VALUES (?, ?)`).run(rowid, embedding);
}

private replaceL0Sparse(recordId: string, messageText: string, updatedAt: string): void {
  if (!this.capabilities.sparseVectors) {
    return;
  }
  const sparse = this.bm25.encodeTexts([messageText])[0];
  if (!sparse || sparse.length === 0) {
    this.degraded = true;
    return;
  }
  this.db.query(`
    INSERT INTO memory_store_l0_sparse (record_id, sparse_vector_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(record_id) DO UPDATE SET sparse_vector_json = excluded.sparse_vector_json, updated_at = excluded.updated_at
  `).run(recordId, JSON.stringify(sparse), updatedAt);
}
```

Replace L0 stubs with:

```ts
async upsertL0(record: L0Record, embedding = embedTextToVector(record.messageText)): Promise<boolean> {
  try {
    const tx = this.db.transaction(() => {
      this.db.query(`
        INSERT INTO memory_store_l0 (record_id, session_key, session_id, chat_id, user_id, role, message_text, recorded_at, timestamp, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(record_id) DO UPDATE SET
          session_key = excluded.session_key,
          session_id = excluded.session_id,
          chat_id = excluded.chat_id,
          user_id = excluded.user_id,
          role = excluded.role,
          message_text = excluded.message_text,
          recorded_at = excluded.recorded_at,
          timestamp = excluded.timestamp,
          metadata_json = excluded.metadata_json
      `).run(record.recordId, record.sessionKey, record.sessionId, record.chatId, record.userId, record.role, record.messageText, record.recordedAt, record.timestamp, JSON.stringify(record.metadata ?? {}));
      this.replaceL0SearchRows(record);
      this.replaceL0Vector(record.recordId, embedding);
      this.replaceL0Sparse(record.recordId, record.messageText, record.recordedAt);
    });
    tx();
    return true;
  } catch {
    this.degraded = true;
    return false;
  }
}

async updateL0Embedding(recordId: string, embedding: Float32Array): Promise<boolean> {
  this.replaceL0Vector(recordId, embedding);
  return true;
}

async deleteL0(recordId: string): Promise<boolean> {
  const rowid = this.numericRowId(recordId);
  const tx = this.db.transaction(() => {
    this.db.query(`DELETE FROM memory_store_l0_fts WHERE record_id = ?`).run(recordId);
    this.db.query(`DELETE FROM memory_store_l0_sparse WHERE record_id = ?`).run(recordId);
    if (this.capabilities.vectorSearch) {
      this.db.query(`DELETE FROM memory_store_l0_vec WHERE rowid = ?`).run(rowid);
    }
    this.db.query(`DELETE FROM memory_store_l0 WHERE record_id = ?`).run(recordId);
  });
  tx();
  return true;
}

async deleteL0Expired(cutoffIso: string): Promise<number> {
  const rows = this.db.query(`SELECT record_id FROM memory_store_l0 WHERE recorded_at < ?`).all(cutoffIso) as Array<{ record_id: string }>;
  for (const row of rows) {
    await this.deleteL0(row.record_id);
  }
  return rows.length;
}

async countL0(userId?: string): Promise<number> {
  const row = userId
    ? this.db.query(`SELECT COUNT(*) AS count FROM memory_store_l0 WHERE user_id = ?`).get(userId)
    : this.db.query(`SELECT COUNT(*) AS count FROM memory_store_l0`).get();
  return (row as { count: number } | null)?.count ?? 0;
}

async queryL0ForL1(sessionKey: string, afterRecordedAtMs = 0, limit = 80): Promise<L0QueryRow[]> {
  const rows = this.db.query(`
    SELECT * FROM memory_store_l0
    WHERE session_key = ? AND timestamp > ? AND role IN ('user', 'assistant')
    ORDER BY timestamp ASC, record_id ASC
    LIMIT ?
  `).all(sessionKey, afterRecordedAtMs, limit) as Parameters<typeof this.l0RowToRecord>[0][];
  return rows.map((row) => this.l0RowToRecord(row));
}

async queryL0GroupedBySessionId(sessionKey: string, afterRecordedAtMs = 0, limit = 80): Promise<L0SessionGroup[]> {
  const rows = await this.queryL0ForL1(sessionKey, afterRecordedAtMs, limit);
  const groups = new Map<string, L0QueryRow[]>();
  for (const row of rows) {
    groups.set(row.sessionId, [...(groups.get(row.sessionId) ?? []), row]);
  }
  return [...groups.entries()].map(([sessionId, records]) => ({ sessionId, records }));
}

async getAllL0Texts(): Promise<Array<{ record_id: string; message_text: string; recorded_at: string }>> {
  return this.db.query(`SELECT record_id, message_text, recorded_at FROM memory_store_l0 ORDER BY record_id ASC`).all() as Array<{ record_id: string; message_text: string; recorded_at: string }>;
}
```

- [ ] **Step 4: Implement L0 searches**

Replace L0 search stubs with:

```ts
async searchL0Fts(query: string, limit = 5, userId?: string): Promise<L0FtsResult[]> {
  const normalized = ftsQuery(query);
  if (!normalized || !this.capabilities.ftsSearch || limit <= 0) {
    return [];
  }
  const rows = this.db.query(`
    SELECT m.*, bm25(memory_store_l0_fts) AS score
    FROM memory_store_l0_fts f
    JOIN memory_store_l0 m ON m.record_id = f.record_id
    WHERE memory_store_l0_fts MATCH ? ${userId ? "AND f.user_id = ?" : ""}
    ORDER BY score ASC, m.timestamp DESC
    LIMIT ?
  `).all(...(userId ? [normalized, userId, limit] : [normalized, limit])) as Array<Parameters<typeof this.l0RowToRecord>[0] & { score: number }>;
  return rows.map((row) => ({ ...this.l0RowToRecord(row), score: Math.abs(row.score) }));
}

async searchL0Vector(queryEmbedding: Float32Array, topK = 5, _queryText?: string, userId?: string): Promise<L0SearchResult[]> {
  if (topK <= 0 || isZeroVector(queryEmbedding)) {
    return [];
  }
  const rows = this.db.query(`SELECT * FROM memory_store_l0 ${userId ? "WHERE user_id = ?" : ""}`).all(...(userId ? [userId] : [])) as Parameters<typeof this.l0RowToRecord>[0][];
  return rows
    .map((row) => {
      const record = this.l0RowToRecord(row);
      const vector = embedTextToVector(record.messageText);
      let sum = 0;
      for (let index = 0; index < Math.max(queryEmbedding.length, vector.length); index += 1) {
        const delta = (queryEmbedding[index] ?? 0) - (vector[index] ?? 0);
        sum += delta * delta;
      }
      return { ...record, score: 1 / (1 + Math.sqrt(sum)) };
    })
    .filter((row) => row.score > 0.45)
    .sort((left, right) => right.score - left.score || right.timestamp - left.timestamp)
    .slice(0, topK);
}
```

- [ ] **Step 5: Run tests**

Run:

```powershell
bun test tests/memory/sqlite-store-l0.test.ts tests/memory/sqlite-store-l1.test.ts tests/memory/sqlite-store-lifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/memory/backends/sqlite/store.ts tests/memory/sqlite-store-l0.test.ts
git commit -m @'
feat: implement sqlite store L0 search

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 9: Implement profile sync

**Files:**
- Modify: `src/memory/backends/sqlite/store.ts`
- Create: `tests/memory/sqlite-store-profiles.test.ts`

- [ ] **Step 1: Write failing profile tests**

Create `tests/memory/sqlite-store-profiles.test.ts`:

```ts
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SqliteMemoryStore } from "../../src/memory/backends/sqlite/store";

test("profile sync pulls updates and deletes L2 L3 profiles", async () => {
  const db = new Database(":memory:");
  const store = new SqliteMemoryStore(db, { sqliteVecEnabled: false, bm25Enabled: false });
  await store.init();

  await store.syncProfiles?.([
    {
      id: "l2-u1-s1",
      type: "l2",
      userId: "u1",
      filename: "scenario-u1.md",
      content: "# Scenario",
      contentMd5: "old",
      version: 1,
      createdAtMs: 1,
      updatedAtMs: 1,
      metadata: { scenarioId: 1 },
    },
    {
      id: "l3-u1",
      type: "l3",
      userId: "u1",
      filename: "persona-u1.md",
      content: "# Persona",
      contentMd5: "old",
      version: 1,
      createdAtMs: 1,
      updatedAtMs: 1,
      metadata: {},
    },
  ]);

  expect((await store.pullProfiles?.())?.map((profile) => profile.id).sort()).toEqual(["l2-u1-s1", "l3-u1"]);

  await store.syncProfiles?.([{ id: "l3-u1", type: "l3", userId: "u1", filename: "persona-u1.md", content: "# Persona v2", contentMd5: "new", version: 2, createdAtMs: 1, updatedAtMs: 2, metadata: {} }]);
  expect((await store.pullProfiles?.())?.find((profile) => profile.id === "l3-u1")?.version).toBe(2);

  await store.deleteProfiles?.(["l2-u1-s1"]);
  expect((await store.pullProfiles?.())?.map((profile) => profile.id)).toEqual(["l3-u1"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
bun test tests/memory/sqlite-store-profiles.test.ts
```

Expected: FAIL because profile methods are stubs.

- [ ] **Step 3: Implement profile sync methods**

Replace profile stubs in `src/memory/backends/sqlite/store.ts`:

```ts
async pullProfiles(): Promise<ProfileRecord[]> {
  const rows = this.db.query(`
    SELECT id, type, user_id, filename, content, content_md5, version, created_at_ms, updated_at_ms, metadata_json
    FROM memory_store_profiles
    ORDER BY user_id ASC, type ASC, id ASC
  `).all() as Array<{
    id: string;
    type: "l2" | "l3";
    user_id: string;
    filename: string;
    content: string;
    content_md5: string;
    version: number;
    created_at_ms: number;
    updated_at_ms: number;
    metadata_json: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    userId: row.user_id,
    filename: row.filename,
    content: row.content,
    contentMd5: row.content_md5,
    version: row.version,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    metadata: parseJsonObject(row.metadata_json),
  }));
}

async syncProfiles(records: ProfileSyncRecord[]): Promise<void> {
  const tx = this.db.transaction(() => {
    for (const record of records) {
      this.db.query(`
        INSERT INTO memory_store_profiles (id, type, user_id, filename, content, content_md5, version, created_at_ms, updated_at_ms, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          user_id = excluded.user_id,
          filename = excluded.filename,
          content = excluded.content,
          content_md5 = excluded.content_md5,
          version = excluded.version,
          updated_at_ms = excluded.updated_at_ms,
          metadata_json = excluded.metadata_json
      `).run(record.id, record.type, record.userId, record.filename, record.content, record.contentMd5, record.version, record.createdAtMs, record.updatedAtMs, JSON.stringify(record.metadata ?? {}));
    }
  });
  tx();
}

async deleteProfiles(recordIds: string[]): Promise<void> {
  const tx = this.db.transaction(() => {
    for (const recordId of recordIds) {
      this.db.query(`DELETE FROM memory_store_profiles WHERE id = ?`).run(recordId);
    }
  });
  tx();
}
```

- [ ] **Step 4: Run profile tests**

Run:

```powershell
bun test tests/memory/sqlite-store-profiles.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/memory/backends/sqlite/store.ts tests/memory/sqlite-store-profiles.test.ts
git commit -m @'
feat: implement memory store profile sync

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 10: Implement reindexing

**Files:**
- Modify: `src/memory/backends/sqlite/store.ts`
- Modify: `tests/memory/sqlite-store-lifecycle.test.ts`

- [ ] **Step 1: Add failing reindex test**

Append to `tests/memory/sqlite-store-lifecycle.test.ts`:

```ts
test("reindexAll rebuilds L0 and L1 dense vectors", async () => {
  const db = new Database(":memory:");
  const store = new SqliteMemoryStore(db, { bm25Enabled: false });
  await store.init();
  await store.upsertL0({ recordId: "l0-reindex", sessionKey: "telegram:c1:u1", sessionId: "c1", chatId: "c1", userId: "u1", role: "user", messageText: "Bun runtime", recordedAt: "2026-05-18T00:00:00.000Z", timestamp: 1, metadata: {} });
  await store.upsertL1({ recordId: "l1-reindex", userId: "u1", sessionKey: "telegram:c1:u1", sessionId: "c1", content: "Bun runtime preference", type: "L1", priority: 5, sceneName: "", timestampStr: "2026-05-18T00:00:00.000Z", sourceConversationIds: [], metadata: {}, createdTime: "2026-05-18T00:00:00.000Z", updatedTime: "2026-05-18T00:00:00.000Z" });

  const progress: string[] = [];
  const result = await store.reindexAll(async () => new Float32Array(64).fill(0.1), (done, total, layer) => progress.push(`${layer}:${done}/${total}`));

  expect(result).toEqual({ l1Count: 1, l0Count: 1 });
  expect(progress).toContain("L1:1/1");
  expect(progress).toContain("L0:1/1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
bun test tests/memory/sqlite-store-lifecycle.test.ts
```

Expected: FAIL because `reindexAll` returns zero counts.

- [ ] **Step 3: Implement reindexAll**

Replace the reindex stub in `src/memory/backends/sqlite/store.ts`:

```ts
async reindexAll(
  embedFn: (text: string) => Promise<Float32Array>,
  onProgress?: (done: number, total: number, layer: "L1" | "L0") => void,
): Promise<{ l1Count: number; l0Count: number }> {
  const l1Texts = await this.getAllL1Texts();
  let l1Done = 0;
  for (const row of l1Texts) {
    this.replaceL1Vector(row.record_id, await embedFn(row.content));
    l1Done += 1;
    onProgress?.(l1Done, l1Texts.length, "L1");
  }

  const l0Texts = await this.getAllL0Texts();
  let l0Done = 0;
  for (const row of l0Texts) {
    this.replaceL0Vector(row.record_id, await embedFn(row.message_text));
    l0Done += 1;
    onProgress?.(l0Done, l0Texts.length, "L0");
  }

  return { l1Count: l1Done, l0Count: l0Done };
}
```

- [ ] **Step 4: Run lifecycle tests**

Run:

```powershell
bun test tests/memory/sqlite-store-lifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/memory/backends/sqlite/store.ts tests/memory/sqlite-store-lifecycle.test.ts
git commit -m @'
feat: add memory store reindexing

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 11: Add legacy backfill

**Files:**
- Create: `src/memory/backends/sqlite/store-backfill.ts`
- Modify: `src/memory/backends/sqlite/store.ts`
- Create: `tests/memory/sqlite-store-backfill.test.ts`

- [ ] **Step 1: Write failing backfill test**

Create `tests/memory/sqlite-store-backfill.test.ts`:

```ts
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrateSqliteMemory } from "../../src/memory/backends/sqlite/migrate";
import { SqliteMemoryBackend } from "../../src/memory/backends/sqlite/backend";
import { SqliteMemoryStore } from "../../src/memory/backends/sqlite/store";

test("store backfill migrates conversations atoms scenarios and persona idempotently", async () => {
  const db = new Database(":memory:");
  migrateSqliteMemory(db);
  const backend = new SqliteMemoryBackend(db, { dataDir: ".", refsDir: ".", canvasDir: ".", sqliteVecEnabled: false });
  const conversationId = await backend.insertConversationTurn({ chatId: "c1", userId: "u1", role: "user", content: "remember Bun", createdAt: "2026-05-18T00:00:00.000Z" });
  const atom = await backend.upsertMemoryAtom({ userId: "u1", text: "User likes Bun", importance: 8, sourceConversationIds: [conversationId], sourceLayer: "L1" });
  const scenarioId = await backend.insertMemoryScenario({ userId: "u1", title: "Runtime", bodyMarkdown: "# Runtime", atomIds: [atom.atom.id] });
  await backend.upsertPersona({ userId: "u1", markdown: "# Persona", sourceScenarioIds: [scenarioId] });

  const store = new SqliteMemoryStore(db, { sqliteVecEnabled: false, bm25Enabled: false });
  await store.init();
  await store.backfillLegacy?.();
  await store.backfillLegacy?.();

  expect(await store.countL0("u1")).toBe(1);
  expect(await store.countL1("u1")).toBe(1);
  expect((await store.pullProfiles?.())?.map((profile) => profile.type).sort()).toEqual(["l2", "l3"]);
  expect((await store.queryL1Records({ userId: "u1" }))[0]?.recordId).toBe(`legacy:l1:${atom.atom.id}`);
});
```

- [ ] **Step 2: Update store type for backfill hook**

In `src/memory/core/store/types.ts`, add this optional method to `IMemoryStore` after `isFtsAvailable()`:

```ts
backfillLegacy?(): Promise<void>;
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```powershell
bun test tests/memory/sqlite-store-backfill.test.ts
```

Expected: FAIL because `backfillLegacy` is undefined.

- [ ] **Step 4: Create backfill function**

Create `src/memory/backends/sqlite/store-backfill.ts`:

```ts
import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { L0Record, L1Record, ProfileSyncRecord } from "../../core/store/types";
import type { SqliteMemoryStore } from "./store";

function md5(content: string): string {
  return createHash("md5").update(content).digest("hex");
}

function parseNumberArray(raw: string): number[] {
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === "number") : [];
}

function sessionKey(chatId: string, userId: string): string {
  return `telegram:${chatId}:${userId}`;
}

export async function backfillLegacyMemoryStore(db: Database, store: SqliteMemoryStore): Promise<void> {
  const conversations = db.query(`SELECT id, chat_id, user_id, role, content, meta_json, created_at FROM conversations ORDER BY id ASC`).all() as Array<{ id: number; chat_id: string; user_id: string; role: L0Record["role"]; content: string; meta_json: string; created_at: string }>;
  for (const row of conversations) {
    await store.upsertL0({
      recordId: `legacy:l0:${row.id}`,
      sessionKey: sessionKey(row.chat_id, row.user_id),
      sessionId: row.chat_id,
      chatId: row.chat_id,
      userId: row.user_id,
      role: row.role,
      messageText: row.content,
      recordedAt: row.created_at,
      timestamp: Date.parse(row.created_at) || row.id,
      metadata: JSON.parse(row.meta_json || "{}") as Record<string, never>,
    });
  }

  const atoms = db.query(`SELECT id, user_id, text, importance, source_turn_ids_json, source_layer, created_at, updated_at FROM memory_atoms ORDER BY id ASC`).all() as Array<{ id: number; user_id: string; text: string; importance: number; source_turn_ids_json: string; source_layer: string; created_at: string; updated_at: string }>;
  for (const row of atoms) {
    const record: L1Record = {
      recordId: `legacy:l1:${row.id}`,
      userId: row.user_id,
      sessionKey: `legacy:${row.user_id}`,
      sessionId: "legacy",
      content: row.text,
      type: row.source_layer,
      priority: row.importance,
      sceneName: "",
      timestampStr: row.updated_at,
      sourceConversationIds: parseNumberArray(row.source_turn_ids_json),
      metadata: { legacyId: row.id },
      createdTime: row.created_at,
      updatedTime: row.updated_at,
    };
    await store.upsertL1(record);
  }

  const profiles: ProfileSyncRecord[] = [];
  const scenarios = db.query(`SELECT id, user_id, title, body_markdown, atom_ids_json, created_at, updated_at FROM memory_scenarios ORDER BY id ASC`).all() as Array<{ id: number; user_id: string; title: string; body_markdown: string; atom_ids_json: string; created_at: string; updated_at: string }>;
  for (const row of scenarios) {
    profiles.push({
      id: `legacy:l2:${row.id}`,
      type: "l2",
      userId: row.user_id,
      filename: `scenario-${row.id}.md`,
      content: row.body_markdown,
      contentMd5: md5(row.body_markdown),
      version: 1,
      createdAtMs: Date.parse(row.created_at) || row.id,
      updatedAtMs: Date.parse(row.updated_at) || row.id,
      metadata: { title: row.title, atomIds: parseNumberArray(row.atom_ids_json) },
    });
  }

  const personas = db.query(`SELECT user_id, markdown, source_scenario_ids_json, updated_at FROM personas ORDER BY user_id ASC`).all() as Array<{ user_id: string; markdown: string; source_scenario_ids_json: string; updated_at: string }>;
  for (const row of personas) {
    profiles.push({
      id: `legacy:l3:${row.user_id}`,
      type: "l3",
      userId: row.user_id,
      filename: `persona-${row.user_id}.md`,
      content: row.markdown,
      contentMd5: md5(row.markdown),
      version: 1,
      createdAtMs: Date.parse(row.updated_at) || 0,
      updatedAtMs: Date.parse(row.updated_at) || 0,
      metadata: { sourceScenarioIds: parseNumberArray(row.source_scenario_ids_json) },
    });
  }
  await store.syncProfiles(profiles);
}
```

- [ ] **Step 5: Wire backfill into store**

In `src/memory/backends/sqlite/store.ts`, import the helper:

```ts
import { backfillLegacyMemoryStore } from "./store-backfill";
```

Add this method to `SqliteMemoryStore`:

```ts
async backfillLegacy(): Promise<void> {
  await backfillLegacyMemoryStore(this.db, this);
  this.writeMeta("backfill.version", "1");
}
```

- [ ] **Step 6: Run backfill tests**

Run:

```powershell
bun test tests/memory/sqlite-store-backfill.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/memory/core/store/types.ts src/memory/backends/sqlite/store.ts src/memory/backends/sqlite/store-backfill.ts tests/memory/sqlite-store-backfill.test.ts
git commit -m @'
feat: backfill legacy memory store data

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 12: Refactor RecallService to use IMemoryStore for generic recall

**Files:**
- Modify: `src/memory/recall/service.ts`
- Modify: `tests/memory/recall.test.ts`
- Create: `tests/memory/imemory-store-integration.test.ts`

- [ ] **Step 1: Write failing integration recall test**

Create `tests/memory/imemory-store-integration.test.ts`:

```ts
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SqliteMemoryBackend } from "../../src/memory/backends/sqlite/backend";
import { SqliteMemoryStore } from "../../src/memory/backends/sqlite/store";
import { RecallService } from "../../src/memory/recall/service";

test("RecallService reads generic memory from IMemoryStore and task canvases from MemoryBackend", async () => {
  const db = new Database(":memory:");
  const backend = new SqliteMemoryBackend(db, { dataDir: ".", refsDir: ".", canvasDir: ".", sqliteVecEnabled: false });
  await backend.init();
  const store = new SqliteMemoryStore(db, { sqliteVecEnabled: false, bm25Enabled: false });
  await store.init();
  await store.upsertL1({ recordId: "l1-recall", userId: "u1", sessionKey: "telegram:c1:u1", sessionId: "c1", content: "User prefers Bun runtime", type: "L1", priority: 9, sceneName: "", timestampStr: "2026-05-18T00:00:00.000Z", sourceConversationIds: [], metadata: {}, createdTime: "2026-05-18T00:00:00.000Z", updatedTime: "2026-05-18T00:00:00.000Z" });
  await store.syncProfiles?.([{ id: "l3-u1", type: "l3", userId: "u1", filename: "persona-u1.md", content: "# Persona\nLikes fast local tooling.", contentMd5: "x", version: 1, createdAtMs: 1, updatedAtMs: 1, metadata: {} }]);

  const recall = await new RecallService(store, backend).recall("u1", "Bun runtime", 5, "c1");

  expect(recall.persona).toContain("fast local tooling");
  expect(recall.atoms[0]?.text).toBe("User prefers Bun runtime");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
bun test tests/memory/imemory-store-integration.test.ts
```

Expected: FAIL because `RecallService` constructor still expects only `MemoryBackend`.

- [ ] **Step 3: Refactor RecallService constructor and generic reads**

Modify `src/memory/recall/service.ts`:

```ts
import { truncateText } from "../../utils/text";
import type { MemoryBackend } from "../core/backend";
import type { MemoryAtom, MemoryRecall, MemoryRecallFallback, MemoryScenario, PersonaProfile, TaskCanvasRecall } from "../core/types";
import type { IMemoryStore, L1RecordRow, ProfileRecord } from "../core/store/types";
```

Change constructor:

```ts
constructor(
  private readonly store: IMemoryStore,
  private readonly backend: MemoryBackend,
  private readonly taskRecallOptions: TaskRecallOptions = defaultTaskRecallOptions,
) {}
```

Add mapping helpers:

```ts
function l1ToAtom(record: L1RecordRow): MemoryAtom {
  const legacyId = typeof record.metadata?.legacyId === "number" ? record.metadata.legacyId : Number(record.recordId.replace(/\D+/g, "")) || 0;
  return {
    id: legacyId,
    userId: record.userId,
    text: record.content,
    importance: record.priority,
    sourceConversationIds: record.sourceConversationIds,
    sourceLayer: record.type === "L2" || record.type === "L3" ? record.type : "L1",
    createdAt: record.createdTime,
    updatedAt: record.updatedTime,
  };
}

function profileToScenario(profile: ProfileRecord): MemoryScenario {
  const atomIds = Array.isArray(profile.metadata?.atomIds) ? profile.metadata.atomIds.filter((value): value is number => typeof value === "number") : [];
  return {
    id: typeof profile.metadata?.legacyId === "number" ? profile.metadata.legacyId : Number(profile.id.replace(/\D+/g, "")) || 0,
    userId: profile.userId,
    title: typeof profile.metadata?.title === "string" ? profile.metadata.title : profile.filename,
    bodyMarkdown: profile.content,
    atomIds,
    createdAt: new Date(profile.createdAtMs).toISOString(),
    updatedAt: new Date(profile.updatedAtMs).toISOString(),
  };
}
```

Replace generic calls in `recall()`:

```ts
const profilesPromise = this.store.pullProfiles?.() ?? Promise.resolve([]);
const [profiles, keywordAtoms, vectorAtoms, conversations, taskCanvas, taskCanvases] = await Promise.all([
  profilesPromise,
  this.store.searchL1Fts(query, maxResults, userId),
  this.store.searchL1Hybrid?.({ query, topK: maxResults, userId }) ?? Promise.resolve([]),
  this.store.searchL0Fts(query, maxResults, userId),
  chatId ? this.backend.getTaskCanvas(chatId) : Promise.resolve(undefined),
  this.taskRecallOptions.enabled && taskCanvasLimit > 0
    ? this.backend.searchTaskCanvases(userId, query, taskCanvasLimit + 1, chatId)
    : Promise.resolve([]),
]);
const personaProfile = profiles.find((profile) => profile.type === "l3" && profile.userId === userId);
const scenarios = profiles.filter((profile) => profile.type === "l2" && profile.userId === userId).map(profileToScenario).slice(0, maxResults);
const atoms = mergeAtomResults(keywordAtoms.map(l1ToAtom), vectorAtoms.map(l1ToAtom), maxResults);
```

Keep fallback-chain logic on `backend.listExistingMemoryAtomIds` and `backend.getFallbackChain` for legacy lineage compatibility.

Map conversations in return:

```ts
conversations: conversations.map((record) => ({
  id: Number(record.recordId.replace(/\D+/g, "")) || 0,
  chatId: record.chatId,
  userId: record.userId,
  role: record.role,
  content: record.messageText,
  meta: record.metadata ?? {},
  createdAt: record.recordedAt,
})),
persona: personaProfile?.content,
```

- [ ] **Step 4: Update existing constructor call sites in tests if needed**

For every `new RecallService(backend)` in tests, replace with:

```ts
const store = new SqliteMemoryStore(db, { sqliteVecEnabled: false, bm25Enabled: false });
await store.init();
await store.backfillLegacy?.();
const recall = await new RecallService(store, backend).recall("u1", "query", 5, "c1");
```

- [ ] **Step 5: Run recall tests**

Run:

```powershell
bun test tests/memory/imemory-store-integration.test.ts tests/memory/recall.test.ts tests/memory/sqlite-vec.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/memory/recall/service.ts tests/memory/imemory-store-integration.test.ts tests/memory/recall.test.ts tests/memory/sqlite-vec.test.ts
git commit -m @'
refactor: read generic recall through memory store

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 13: Refactor L1/L2/L3 pipeline writes to IMemoryStore

**Files:**
- Modify: `src/memory/pipeline/l1.ts`
- Modify: `src/memory/pipeline/l2.ts`
- Modify: `src/memory/pipeline/l3.ts`
- Modify: `src/memory/pipeline/coordinator.ts`
- Modify: `tests/memory/pipeline.test.ts`
- Modify: `tests/memory/imemory-store-integration.test.ts`

- [ ] **Step 1: Add failing pipeline integration test**

Append to `tests/memory/imemory-store-integration.test.ts`:

```ts
import type { LlmProvider } from "../../src/agent/types";
import { PipelineCoordinator } from "../../src/memory/pipeline/coordinator";

const testLlm: LlmProvider = {
  async complete(input) {
    const system = input.messages[0]?.content ?? "";
    if (system.includes("L1")) {
      return { content: JSON.stringify([{ text: "User prefers Bun runtime", importance: 8, source_turn_ids: [1] }]) };
    }
    if (system.includes("L2")) {
      return { content: "# Runtime scenario\nUser prefers Bun." };
    }
    return { content: "# Persona\nUser prefers Bun runtime." };
  },
};

test("PipelineCoordinator writes L1 and profiles through IMemoryStore", async () => {
  const db = new Database(":memory:");
  const backend = new SqliteMemoryBackend(db, { dataDir: ".", refsDir: ".", canvasDir: ".", sqliteVecEnabled: false });
  await backend.init();
  const store = new SqliteMemoryStore(db, { sqliteVecEnabled: false, bm25Enabled: false });
  await store.init();
  await store.upsertL0({ recordId: "legacy:l0:1", sessionKey: "telegram:c1:u1", sessionId: "c1", chatId: "c1", userId: "u1", role: "user", messageText: "remember Bun", recordedAt: "2026-05-18T00:00:00.000Z", timestamp: 1, metadata: { legacyConversationId: 1 } });

  const result = await new PipelineCoordinator(store, backend, testLlm).runMaintenanceForUser("u1", true);

  expect(result.l1Created).toBe(1);
  expect(await store.countL1("u1")).toBe(1);
  expect((await store.pullProfiles?.())?.map((profile) => profile.type).sort()).toEqual(["l2", "l3"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
bun test tests/memory/imemory-store-integration.test.ts
```

Expected: FAIL because `PipelineCoordinator` still expects `(backend, llm)`.

- [ ] **Step 3: Refactor `runL1Pipeline`**

Modify `src/memory/pipeline/l1.ts` imports and signature:

```ts
import type { IMemoryStore } from "../core/store/types";
import type { MemoryBackend } from "../core/backend";
```

Change signature:

```ts
export async function runL1Pipeline(
  store: IMemoryStore,
  backend: MemoryBackend,
  llm: LlmProvider,
  userId: string,
  turns: ConversationTurn[],
): Promise<{ createdAtoms: number; lastConversationId: number; checkpointAdvanced: boolean }> {
```

Replace `backend.upsertMemoryAtom(...)` with:

```ts
const recordId = `l1:${userId}:${Bun.hash(text).toString(16)}`;
const now = new Date().toISOString();
const created = (await store.queryL1Records({ userId, limit: 500 })).every((record) => record.recordId !== recordId);
await store.upsertL1({
  recordId,
  userId,
  sessionKey: turns[0] ? `telegram:${turns[0].chatId}:${userId}` : `legacy:${userId}`,
  sessionId: turns[0]?.chatId ?? "legacy",
  content: text,
  type: "L1",
  priority: item.importance ?? 3,
  sceneName: "",
  timestampStr: now,
  sourceConversationIds: item.source_turn_ids ?? [],
  metadata: {},
  createdTime: now,
  updatedTime: now,
});
const result = { atom: { id: Number.parseInt(recordId.replace(/\D+/g, ""), 10) || 0 }, created };
```

Keep `backend.insertLineageLink(...)` as the lineage writer.

- [ ] **Step 4: Refactor `runL2Pipeline`**

Modify `src/memory/pipeline/l2.ts` to accept `store` and `backend`:

```ts
import { createHash } from "node:crypto";
import type { IMemoryStore } from "../core/store/types";
```

Change signature:

```ts
export async function runL2Pipeline(
  store: IMemoryStore,
  backend: MemoryBackend,
  llm: LlmProvider,
  userId: string,
  atoms: MemoryAtom[],
): Promise<{ scenarioId: number; bodyMarkdown: string } | undefined> {
```

Replace `backend.insertMemoryScenario(...)` with:

```ts
const scenarioId = Date.now();
const bodyMarkdown = response.content;
await store.syncProfiles?.([{
  id: `l2:${userId}:${scenarioId}`,
  type: "l2",
  userId,
  filename: `scenario-${scenarioId}.md`,
  content: bodyMarkdown,
  contentMd5: createHash("md5").update(bodyMarkdown).digest("hex"),
  version: 1,
  createdAtMs: scenarioId,
  updatedAtMs: scenarioId,
  metadata: { title: `Scenario snapshot ${new Date(scenarioId).toISOString()}`, atomIds: atoms.map((atom) => atom.id), legacyId: scenarioId },
}]);
```

Keep `backend.insertLineageLink(...)` for lineage.

- [ ] **Step 5: Refactor `runL3Pipeline`**

Modify `src/memory/pipeline/l3.ts` to accept `store` and `backend`:

```ts
import { createHash } from "node:crypto";
import type { IMemoryStore } from "../core/store/types";
```

Change signature:

```ts
export async function runL3Pipeline(
  store: IMemoryStore,
  backend: MemoryBackend,
  llm: LlmProvider,
  userId: string,
  scenarioId: number,
  scenarioMarkdown: string,
): Promise<boolean> {
```

Replace `backend.upsertPersona(...)` with:

```ts
const nowMs = Date.now();
await store.syncProfiles?.([{
  id: `l3:${userId}`,
  type: "l3",
  userId,
  filename: `persona-${userId}.md`,
  content: response.content,
  contentMd5: createHash("md5").update(response.content).digest("hex"),
  version: nowMs,
  createdAtMs: nowMs,
  updatedAtMs: nowMs,
  metadata: { sourceScenarioIds: [scenarioId] },
}]);
```

Keep `backend.insertLineageLink(...)` for lineage.

- [ ] **Step 6: Refactor PipelineCoordinator**

Modify `src/memory/pipeline/coordinator.ts` constructor:

```ts
constructor(
  private readonly store: IMemoryStore,
  private readonly backend: MemoryBackend,
  private readonly llm: LlmProvider,
) {}
```

Replace pending-turn and atom reads:

```ts
const l0Rows = await this.store.getAllL0Texts();
const pendingTurns = l0Rows
  .filter((row) => Number(row.record_id.replace(/\D+/g, "")) > afterConversationId)
  .slice(0, DEFAULT_EVIDENCE_LIMIT)
  .map((row) => ({
    id: Number(row.record_id.replace(/\D+/g, "")) || Date.parse(row.recorded_at) || 0,
    chatId: "",
    userId,
    role: "user" as const,
    content: row.message_text,
    meta: {},
    createdAt: row.recorded_at,
  }));
```

Replace pipeline calls:

```ts
: await runL1Pipeline(this.store, this.backend, this.llm, userId, pendingTurns);
```

Replace atom list:

```ts
const atoms = (await this.store.queryL1Records({ userId, limit: DEFAULT_ATOM_LIMIT })).map((record) => ({
  id: Number(record.recordId.replace(/\D+/g, "")) || 0,
  userId: record.userId,
  text: record.content,
  importance: record.priority,
  sourceConversationIds: record.sourceConversationIds,
  sourceLayer: "L1" as const,
  createdAt: record.createdTime,
  updatedAt: record.updatedTime,
}));
```

Replace `runL2Pipeline` and `runL3Pipeline` calls:

```ts
const l2Result = await runL2Pipeline(this.store, this.backend, this.llm, userId, atoms);
const personaUpdated = await runL3Pipeline(this.store, this.backend, this.llm, userId, l2Result.scenarioId, l2Result.bodyMarkdown);
```

- [ ] **Step 7: Run pipeline tests**

Run:

```powershell
bun test tests/memory/imemory-store-integration.test.ts tests/memory/pipeline.test.ts
```

Expected: PASS after updating test setup constructors to pass both `store` and `backend`.

- [ ] **Step 8: Commit**

```powershell
git add src/memory/pipeline/l1.ts src/memory/pipeline/l2.ts src/memory/pipeline/l3.ts src/memory/pipeline/coordinator.ts tests/memory/imemory-store-integration.test.ts tests/memory/pipeline.test.ts
git commit -m @'
refactor: write memory pipeline through memory store

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 14: Refactor MemoryService and factory wiring

**Files:**
- Modify: `src/memory/core/service.ts`
- Modify: `src/memory/integration/factory.ts`
- Modify: `tests/memory/tools.test.ts`
- Modify: `tests/memory/agent-runtime.test.ts`
- Modify: `tests/memory/imemory-store-integration.test.ts`

- [ ] **Step 1: Add failing MemoryService save/log integration test**

Append to `tests/memory/imemory-store-integration.test.ts`:

```ts
import { MemoryService } from "../../src/memory/core/service";
import { InteractionLogService } from "../../src/memory/events/service";
import { OffloadService } from "../../src/memory/offload/service";

test("MemoryService saves generic memory through IMemoryStore", async () => {
  const db = new Database(":memory:");
  const backend = new SqliteMemoryBackend(db, { dataDir: ".", refsDir: ".", canvasDir: ".", sqliteVecEnabled: false });
  await backend.init();
  const store = new SqliteMemoryStore(db, { sqliteVecEnabled: false, bm25Enabled: false });
  await store.init();
  const memory = new MemoryService(
    backend,
    store,
    testLlm,
    { dataDir: ".", backendName: "sqlite", backendOwner: "project-owned memory backend", maintenanceCron: "0 * * * *", offloadEnabled: true, l15: { enabled: false, mode: "rules", recentMessages: 6, historyTaskLimit: 10, maxCanvasChars: 12000, safeFallback: "short" }, l1: { enabled: true, mode: "local", maxSummaryChars: 900, defaultScore: 5 }, l2: { enabled: true, mode: "local", triggerMinEntries: 1, maxCanvasChars: 12000 }, taskRecall: { enabled: true, maxTasks: 3, maxCanvasChars: 2200 }, l4: { enabled: false, mode: "local", requireCompletedTask: false, maxEvidenceEntries: 80, maxCanvasChars: 20000, maxSkillChars: 20000 }, generatedSkillsDir: "." },
    new RecallService(store, backend),
    new OffloadService(backend, { offloadMinChars: Number.MAX_SAFE_INTEGER, offloadSummaryChars: 900, l1: { enabled: true, mode: "local", maxSummaryChars: 900, defaultScore: 5 }, l2: { enabled: true, mode: "local", triggerMinEntries: 1, maxCanvasChars: 12000 }, jsonlEnabled: false }, testLlm),
    new PipelineCoordinator(store, backend, testLlm),
    new InteractionLogService(backend, { enabled: false, historyDir: "." }),
  );

  await memory.logTurn({ chatId: "c1", userId: "u1", role: "user", content: "remember Bun" });
  await memory.saveMemory({ userId: "u1", text: "User likes Bun", importance: 8 });
  const status = await memory.memoryStatus("u1", "c1");

  expect(await store.countL0("u1")).toBe(1);
  expect(await store.countL1("u1")).toBe(1);
  expect(status).toContain("L1 atoms=1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
bun test tests/memory/imemory-store-integration.test.ts
```

Expected: FAIL because `MemoryService` constructor does not accept `IMemoryStore`.

- [ ] **Step 3: Refactor MemoryService state and constructor**

Modify `src/memory/core/service.ts` imports:

```ts
import type { IMemoryStore } from "./store/types";
```

Change state:

```ts
type MemoryServiceState = {
  backend: MemoryBackend;
  store: IMemoryStore;
  recallService: RecallService;
  interactionLogService: InteractionLogService;
  offloadService: OffloadService;
  pipelineCoordinator: PipelineCoordinator;
  llm: LlmProvider;
  options: MemoryServiceOptions;
};
```

Change constructor signature and defaults:

```ts
constructor(
  backend: MemoryBackend,
  store: IMemoryStore,
  llm: LlmProvider,
  options: MemoryServiceOptions,
  recallService = new RecallService(store, backend, options.taskRecall),
  offloadService = new OffloadService(backend, {
    offloadMinChars: 2500,
    offloadSummaryChars: 900,
    l1: options.l1,
    l2: options.l2,
    jsonlEnabled: false,
  }, llm),
  pipelineCoordinator = new PipelineCoordinator(store, backend, llm),
  interactionLogService = new InteractionLogService(backend, {
    enabled: false,
    historyDir: resolve(options.dataDir, "history"),
  }),
) {
  memoryServiceState.set(this, {
    backend,
    store,
    recallService,
    interactionLogService,
    offloadService,
    pipelineCoordinator,
    llm,
    options,
  });
}
```

- [ ] **Step 4: Refactor generic MemoryService methods**

In `memoryStatus`, destructure `store` and replace counts/persona:

```ts
const { backend, store, interactionLogService, options } = getState(this);
const profiles = await store.pullProfiles?.() ?? [];
const persona = profiles.find((profile) => profile.type === "l3" && profile.userId === userId);
```

Use:

```ts
store.countL1(userId)
profiles.filter((profile) => profile.type === "l2" && profile.userId === userId).length
```

Replace `saveMemory`:

```ts
async saveMemory(input: SaveMemoryInput): Promise<number> {
  const { store } = getState(this);
  const recordId = `manual:${input.userId}:${Bun.hash(input.text.trim()).toString(16)}`;
  const now = new Date().toISOString();
  await store.upsertL1({
    recordId,
    userId: input.userId,
    sessionKey: `manual:${input.userId}`,
    sessionId: "manual",
    content: input.text,
    type: input.sourceLayer ?? "L1",
    priority: input.importance ?? 3,
    sceneName: "",
    timestampStr: now,
    sourceConversationIds: input.sourceConversationIds ?? [],
    metadata: { manual: true },
    createdTime: now,
    updatedTime: now,
  });
  return Number.parseInt(recordId.replace(/\D+/g, ""), 10) || 0;
}
```

Replace `logTurn`:

```ts
async logTurn(input: LogTurnInput): Promise<number> {
  const { store } = getState(this);
  const timestamp = Date.now();
  const recordId = `manual:l0:${timestamp}`;
  await store.upsertL0({
    recordId,
    sessionKey: `telegram:${input.chatId}:${input.userId}`,
    sessionId: input.chatId,
    chatId: input.chatId,
    userId: input.userId,
    role: input.role,
    messageText: input.content,
    recordedAt: new Date(timestamp).toISOString(),
    timestamp,
    metadata: input.meta ?? {},
  });
  return timestamp;
}
```

- [ ] **Step 5: Refactor factory wiring**

Modify `src/memory/integration/factory.ts` imports:

```ts
import { SqliteMemoryStore } from "../backends/sqlite/store";
```

After backend init:

```ts
const store = new SqliteMemoryStore(db, {
  sqliteVecEnabled: config.memory.sqliteVecEnabled,
  bm25Enabled: true,
  bm25Language: "zh",
});
await store.init({ provider: "local", model: "deterministic-local", dimensions: 64 });
await store.backfillLegacy?.();
```

Change service construction:

```ts
const recallService = new RecallService(store, backend, taskRecall);
const pipelineCoordinator = new PipelineCoordinator(store, backend, llm);
return new MemoryService(
  backend,
  store,
  llm,
  { ... },
  recallService,
  offloadService,
  pipelineCoordinator,
  interactionLogService,
);
```

- [ ] **Step 6: Update constructor call sites in tests**

Search for `new MemoryService(` and update each call to pass `store` as the second argument and to construct `RecallService(store, backend)` and `PipelineCoordinator(store, backend, llm)` where explicit services are passed.

- [ ] **Step 7: Run integration tests**

Run:

```powershell
bun test tests/memory/imemory-store-integration.test.ts tests/memory/tools.test.ts tests/memory/agent-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/memory/core/service.ts src/memory/integration/factory.ts tests/memory/imemory-store-integration.test.ts tests/memory/tools.test.ts tests/memory/agent-runtime.test.ts
git commit -m @'
refactor: wire generic memory consumers to memory store

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 15: Preserve app-specific storage behavior

**Files:**
- Modify: existing tests only if constructor setup changed
- Test: `tests/memory/offload.test.ts`, `tests/memory/task-recall.test.ts`, `tests/memory/sqlite-backend.test.ts`, `tests/memory/l4.test.ts`

- [ ] **Step 1: Run app-specific memory tests**

Run:

```powershell
bun test tests/memory/offload.test.ts tests/memory/task-recall.test.ts tests/memory/sqlite-backend.test.ts tests/memory/l4.test.ts
```

Expected: PASS or constructor-related failures only.

- [ ] **Step 2: Fix constructor-only test setup failures**

For any failing test that constructs `MemoryService`, add a `SqliteMemoryStore` alongside the existing `SqliteMemoryBackend`:

```ts
const store = new SqliteMemoryStore(db, { sqliteVecEnabled: false, bm25Enabled: false });
await store.init();
await store.backfillLegacy?.();
```

Pass `store` into `MemoryService`, `RecallService`, and `PipelineCoordinator` as in Task 14.

Do not move any of these operations into `IMemoryStore`:

```ts
createTaskCanvas
getActiveTaskCanvas
searchTaskCanvases
insertL1EvidenceEntry
updateL1EvidenceNodeMapping
insertOffloadRef
insertGeneratedSkill
getCheckpoint
setCheckpoint
```

- [ ] **Step 3: Run app-specific tests again**

Run:

```powershell
bun test tests/memory/offload.test.ts tests/memory/task-recall.test.ts tests/memory/sqlite-backend.test.ts tests/memory/l4.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add tests/memory/offload.test.ts tests/memory/task-recall.test.ts tests/memory/sqlite-backend.test.ts tests/memory/l4.test.ts
git commit -m @'
test: preserve app-specific memory storage paths

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

If no files changed, do not create an empty commit.

---

### Task 16: Final verification and cleanup

**Files:**
- Potentially modify: `docs/superpowers/specs/2026-05-18-imemory-store-sqlite-design.md` only if implementation reveals a small naming correction.
- Potentially modify: tests touched by compile errors.

- [ ] **Step 1: Run focused memory tests**

Run:

```powershell
bun test tests/memory
```

Expected: PASS.

- [ ] **Step 2: Run all tests**

Run:

```powershell
bun test
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript check**

Run:

```powershell
bunx tsc --noEmit
```

Expected: exit code 0.

- [ ] **Step 4: Inspect git diff**

Run:

```powershell
git status --short; git diff --stat
```

Expected: only intended source, test, package, lockfile, spec/plan files are changed or newly committed.

- [ ] **Step 5: Commit final fixes if needed**

If Step 1-4 required fixes, commit them:

```powershell
git add <changed-files>
git commit -m @'
fix: stabilize memory store integration

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

If no files changed, do not create an empty commit.

---

## Self-review

- **Spec coverage:** Covered store types, BM25 wrapper, schema, lifecycle/capabilities, L1, L0, profiles, reindexing, backfill, recall refactor, pipeline refactor, MemoryService/factory wiring, app-specific storage boundaries, and final tests.
- **Placeholder scan:** No task uses TBD/TODO/fill-in language. Each code-changing step includes concrete code or an explicit existing-call-site update pattern.
- **Type consistency:** The plan uses `IMemoryStore`, `L0Record`, `L1Record`, `ProfileSyncRecord`, `SqliteMemoryStore`, `createBM25LocalEncoder`, `migrateSqliteMemoryStore`, and `backfillLegacyMemoryStore` consistently across tasks.
