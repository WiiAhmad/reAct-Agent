# Memory Atom Dedupe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deduplicate obvious duplicate memory atoms at write time, compact existing exact duplicates during migration, and let L2 scenario output become cleaner automatically.

**Architecture:** Add a small canonicalization helper under the SQLite memory backend, switch `upsertMemoryAtom()` to match on a persisted `canonical_text` key, and run an exact-match cleanup pass inside `migrateSqliteMemory()` for legacy rows. Keep the change focused at the atom layer; L2 stays append-only and benefits from a smaller atom set without any scenario-specific merge logic.

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, FTS5, sqlite-vec-compatible embedding rows, Bun test

---

## Planned File Map

- Create: `src/memory/backends/sqlite/canonical.ts`
  - Responsibility: deterministic canonicalization for short natural-language memory atoms plus small array merge helpers shared by backend writes and migration cleanup.

- Modify: `src/memory/backends/sqlite/backend.ts:41-118, 287-317, 436-530`
  - Responsibility: use `canonical_text` during upsert, merge source turn IDs and importance deterministically, and refresh FTS + embedding rows when an existing atom absorbs a new write.

- Modify: `src/memory/backends/sqlite/migrate.ts:3-143`
  - Responsibility: add the `canonical_text` column, backfill it for legacy rows, compact exact canonical collisions, repoint lineage/scenario references, and create the unique index.

- Modify: `src/db/schema.ts:29-144`
  - Responsibility: keep the transitional app schema aligned with the memory backend schema by including `canonical_text` in the legacy-compatible `memory_atoms` table definition and upgrade checks.

- Modify: `src/memory/prompts/l1.ts:1-9`
  - Responsibility: tighten the L1 prompt so the model emits one stable phrasing for each durable fact instead of multiple equivalent variants.

- Modify: `tests/memory/sqlite-backend.test.ts:12-166` plus new dedupe/migration coverage near the bottom
  - Responsibility: verify canonical write-time dedupe, exact-cleanup migration behavior, schema upgrades, lineage rewrites, and scenario atom-id cleanup.

- Modify: `tests/memory/pipeline.test.ts:14-34, 160-200` plus one new regression test
  - Responsibility: verify that near-duplicate L1 outputs collapse to one stored atom and feed one atom reference into L2 scenario snapshots.

## Deferred Item From The Spec

The spec includes an optional follow-up for reviewer false-positive reduction, but no repo-owned reviewer implementation was found under `src/` or `scripts/` during planning. Do not add that work to this implementation plan. If reviewer logic later becomes local to this repo, write a separate spec/plan for that system.

### Task 1: Canonical write-time dedupe for new atoms

**Files:**
- Create: `src/memory/backends/sqlite/canonical.ts`
- Modify: `src/memory/backends/sqlite/backend.ts:41-118, 436-530`
- Test: `tests/memory/sqlite-backend.test.ts`

- [ ] **Step 1: Write the failing backend tests for canonical dedupe and non-goal separation**

Add these tests near the end of `tests/memory/sqlite-backend.test.ts`:

```ts
test("SQLite backend canonicalizes obvious atom variants on upsert", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-memory-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });

    const first = await backend.upsertMemoryAtom({
      userId: "u1",
      text: "User's name is Wii.",
      importance: 2,
      sourceConversationIds: [1],
      sourceLayer: "L1",
    });
    const second = await backend.upsertMemoryAtom({
      userId: "u1",
      text: "User’s name is Wii.",
      importance: 5,
      sourceConversationIds: [2, 1],
      sourceLayer: "L1",
    });

    const atoms = await backend.listMemoryAtoms("u1", 10);
    const row = db
      .query(`SELECT canonical_text FROM memory_atoms WHERE id = ?`)
      .get(first.atom.id) as { canonical_text: string | null } | null;

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.atom.id).toBe(first.atom.id);
    expect(atoms).toEqual([
      expect.objectContaining({
        id: first.atom.id,
        text: "User’s name is Wii.",
        importance: 5,
        sourceConversationIds: [1, 2],
      }),
    ]);
    expect(row?.canonical_text).not.toBeNull();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("SQLite backend keeps broader paraphrases separate when canonical text differs", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-memory-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });

    await backend.upsertMemoryAtom({
      userId: "u1",
      text: "User prefers the assistant not to use bold formatting like **text**.",
      sourceConversationIds: [3],
      sourceLayer: "L1",
    });
    await backend.upsertMemoryAtom({
      userId: "u1",
      text: "User does not want the assistant to use ** (bold/markdown tebal) in answers.",
      sourceConversationIds: [4],
      sourceLayer: "L1",
    });

    expect(await backend.listMemoryAtoms("u1", 10)).toHaveLength(2);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the targeted backend tests to confirm they fail first**

Run:

```bash
bun test tests/memory/sqlite-backend.test.ts --test-name-pattern "canonicalizes obvious atom variants|keeps broader paraphrases separate"
```

Expected before implementation:
- the canonical variant test fails because the second upsert still creates a second row
- the paraphrase separation test should already pass or stay green; keep it as a regression guard

- [ ] **Step 3: Implement the canonical helper and switch backend upserts to `canonical_text`**

Create `src/memory/backends/sqlite/canonical.ts` with:

```ts
const MARKDOWN_NOISE = /[*_`~]+/g;
const CURLY_SINGLE_QUOTES = /[‘’]/g;
const CURLY_DOUBLE_QUOTES = /[“”]/g;
const NON_WORD_SEPARATORS = /[^\p{L}\p{N}\s]+/gu;
const WHITESPACE = /\s+/g;

export function canonicalizeMemoryAtomText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(CURLY_SINGLE_QUOTES, "'")
    .replace(CURLY_DOUBLE_QUOTES, '"')
    .replace(MARKDOWN_NOISE, " ")
    .toLowerCase()
    .replace(NON_WORD_SEPARATORS, " ")
    .replace(WHITESPACE, " ")
    .trim();
}

export function mergeNumberSets(...groups: number[][]): number[] {
  return [...new Set(groups.flat())].sort((left, right) => left - right);
}
```

In `src/memory/backends/sqlite/backend.ts`, add two tiny helpers near the existing vector helpers:

```ts
private replaceMemoryAtomSearchRow(atomId: number, userId: string, text: string): void {
  this.db.query(`DELETE FROM memory_atoms_fts WHERE atom_id = ? AND user_id = ?`).run(String(atomId), userId);
  this.db.query(`INSERT INTO memory_atoms_fts (text, atom_id, user_id) VALUES (?, ?, ?)`).run(text, String(atomId), userId);
}

private upsertMemoryAtomEmbedding(atomId: number, userId: string, embeddingJson: string, updatedAt: string): void {
  this.db
    .query(`
      INSERT INTO memory_atom_embeddings (atom_id, user_id, embedding_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(atom_id) DO UPDATE SET
        user_id = excluded.user_id,
        embedding_json = excluded.embedding_json,
        updated_at = excluded.updated_at
    `)
    .run(atomId, userId, embeddingJson, updatedAt);
  this.indexMemoryAtomVector(atomId, embeddingJson);
}
```

Then update `upsertMemoryAtom()` to use the canonical key and merged metadata:

```ts
import { canonicalizeMemoryAtomText, mergeNumberSets } from "./canonical";

async upsertMemoryAtom(atom: NewMemoryAtom): Promise<UpsertMemoryAtomResult> {
  const text = atom.text.trim();
  if (!text) {
    throw new Error("Memory atom text cannot be empty");
  }

  const canonicalText = canonicalizeMemoryAtomText(text);
  if (!canonicalText) {
    throw new Error("Memory atom canonical text cannot be empty");
  }

  const existing = this.db
    .query(`
      SELECT id, user_id, text, canonical_text, importance, source_turn_ids_json, source_layer, created_at, updated_at
      FROM memory_atoms
      WHERE user_id = ? AND canonical_text = ?
    `)
    .get(atom.userId, canonicalText) as {
      id: number;
      user_id: string;
      text: string;
      canonical_text: string;
      importance: number;
      source_turn_ids_json: string;
      source_layer: MemoryAtom["sourceLayer"];
      created_at: string;
      updated_at: string;
    } | null;

  const sourceConversationIds = atom.sourceConversationIds ?? [];
  const sourceLayer = atom.sourceLayer ?? "L1";
  const importance = atom.importance ?? 3;
  const updatedAt = nowIso();
  const embeddingJson = serializeVector(embedTextToVector(text));

  if (existing) {
    const mergedSourceConversationIds = mergeNumberSets(
      parseNumberArray(existing.source_turn_ids_json),
      sourceConversationIds,
    );
    const mergedImportance = Math.max(existing.importance, importance);

    this.db
      .query(`
        UPDATE memory_atoms
        SET text = ?, canonical_text = ?, importance = ?, source_turn_ids_json = ?, source_layer = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        text,
        canonicalText,
        mergedImportance,
        JSON.stringify(mergedSourceConversationIds),
        sourceLayer,
        updatedAt,
        existing.id,
      );

    this.replaceMemoryAtomSearchRow(existing.id, atom.userId, text);
    this.upsertMemoryAtomEmbedding(existing.id, atom.userId, embeddingJson, updatedAt);

    return {
      created: false,
      atom: {
        id: existing.id,
        userId: existing.user_id,
        text,
        importance: mergedImportance,
        sourceConversationIds: mergedSourceConversationIds,
        sourceLayer,
        createdAt: existing.created_at,
        updatedAt,
      },
    };
  }

  const createdAt = updatedAt;
  const result = this.db
    .query(`
      INSERT INTO memory_atoms (user_id, text, canonical_text, importance, source_turn_ids_json, source_layer, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(atom.userId, text, canonicalText, importance, JSON.stringify(sourceConversationIds), sourceLayer, createdAt, updatedAt);

  const id = Number(result.lastInsertRowid);
  this.replaceMemoryAtomSearchRow(id, atom.userId, text);
  this.upsertMemoryAtomEmbedding(id, atom.userId, embeddingJson, updatedAt);

  return {
    created: true,
    atom: {
      id,
      userId: atom.userId,
      text,
      importance,
      sourceConversationIds,
      sourceLayer,
      createdAt,
      updatedAt,
    },
  };
}
```

- [ ] **Step 4: Re-run the targeted backend tests and the full backend test file**

Run:

```bash
bun test tests/memory/sqlite-backend.test.ts --test-name-pattern "canonicalizes obvious atom variants|keeps broader paraphrases separate"
bun test tests/memory/sqlite-backend.test.ts
```

Expected after implementation:
- both targeted tests PASS
- the full backend test file stays green

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add tests/memory/sqlite-backend.test.ts src/memory/backends/sqlite/canonical.ts src/memory/backends/sqlite/backend.ts
git commit -m "$(cat <<'EOF'
fix: canonicalize duplicate memory atoms on write

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 2: Backfill `canonical_text` and compact exact legacy duplicates

**Files:**
- Modify: `src/memory/backends/sqlite/migrate.ts:3-143`
- Modify: `src/db/schema.ts:29-144`
- Test: `tests/memory/sqlite-backend.test.ts`

- [ ] **Step 1: Write the failing migration and legacy-schema tests**

Extend `tests/memory/sqlite-backend.test.ts` with a migration compaction test and update the existing legacy-column assertion:

```ts
test("migrateSqliteMemory backfills canonical_text and compacts exact duplicate atoms", async () => {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE memory_atoms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      text TEXT NOT NULL,
      importance INTEGER NOT NULL DEFAULT 3,
      source_turn_ids_json TEXT NOT NULL DEFAULT '[]',
      source_layer TEXT NOT NULL DEFAULT 'L1',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, text)
    );

    CREATE VIRTUAL TABLE memory_atoms_fts USING fts5(
      text,
      atom_id UNINDEXED,
      user_id UNINDEXED,
      tokenize = 'unicode61'
    );

    CREATE TABLE memory_atom_embeddings (
      atom_id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE lineage_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      link_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, source_kind, source_id, target_kind, target_id, link_type)
    );

    CREATE TABLE memory_scenarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body_markdown TEXT NOT NULL,
      atom_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.query(`INSERT INTO memory_atoms (user_id, text, importance, source_turn_ids_json, source_layer, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("u1", "User's name is Wii.", 2, JSON.stringify([1]), "L1", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  db.query(`INSERT INTO memory_atoms (user_id, text, importance, source_turn_ids_json, source_layer, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("u1", "User’s name is Wii.", 5, JSON.stringify([2]), "L1", "2026-01-02T00:00:00.000Z", "2026-01-02T00:00:00.000Z");

  db.query(`INSERT INTO memory_atoms_fts (text, atom_id, user_id) VALUES (?, ?, ?)`)
    .run("User's name is Wii.", "1", "u1");
  db.query(`INSERT INTO memory_atoms_fts (text, atom_id, user_id) VALUES (?, ?, ?)`)
    .run("User’s name is Wii.", "2", "u1");
  db.query(`INSERT INTO memory_atom_embeddings (atom_id, user_id, embedding_json, updated_at) VALUES (?, ?, ?, ?)`)
    .run(1, "u1", "[1,0,0]", "2026-01-01T00:00:00.000Z");
  db.query(`INSERT INTO memory_atom_embeddings (atom_id, user_id, embedding_json, updated_at) VALUES (?, ?, ?, ?)`)
    .run(2, "u1", "[0,1,0]", "2026-01-02T00:00:00.000Z");

  db.query(`INSERT INTO lineage_links (user_id, source_kind, source_id, target_kind, target_id, link_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("u1", "conversation", "7", "memory_atom", "1", "evidence", "2026-01-01T00:00:00.000Z");
  db.query(`INSERT INTO lineage_links (user_id, source_kind, source_id, target_kind, target_id, link_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("u1", "conversation", "7", "memory_atom", "2", "evidence", "2026-01-01T00:00:00.000Z");
  db.query(`INSERT INTO memory_scenarios (user_id, title, body_markdown, atom_ids_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("u1", "Identity", "- atom_id=1 User's name is Wii.\n- atom_id=2 User’s name is Wii.", JSON.stringify([1, 2]), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");

  migrateSqliteMemory(db);

  const atoms = db.query(`SELECT id, text, importance, source_turn_ids_json, canonical_text FROM memory_atoms ORDER BY id ASC`).all() as Array<{
    id: number;
    text: string;
    importance: number;
    source_turn_ids_json: string;
    canonical_text: string;
  }>;
  const scenario = db.query(`SELECT atom_ids_json FROM memory_scenarios WHERE user_id = ?`).get("u1") as { atom_ids_json: string } | null;
  const lineageCount = db.query(`SELECT COUNT(*) AS count FROM lineage_links WHERE user_id = ? AND target_kind = 'memory_atom' AND target_id = '1'`).get("u1") as { count: number };
  const duplicateLineageCount = db.query(`SELECT COUNT(*) AS count FROM lineage_links WHERE user_id = ? AND target_kind = 'memory_atom' AND target_id = '2'`).get("u1") as { count: number };

  expect(atoms).toEqual([
    expect.objectContaining({
      id: 1,
      importance: 5,
      source_turn_ids_json: JSON.stringify([1, 2]),
    }),
  ]);
  expect(atoms[0]?.canonical_text).toBeString();
  expect(JSON.parse(scenario?.atom_ids_json ?? "[]")).toEqual([1]);
  expect(lineageCount.count).toBe(1);
  expect(duplicateLineageCount.count).toBe(0);
});
```

Update the existing legacy app-schema test expectation block from:

```ts
expect(atomColumns.has("source_layer")).toBe(true);
expect(scenarioColumns.has("file_path")).toBe(true);
```

to:

```ts
expect(atomColumns.has("source_layer")).toBe(true);
expect(atomColumns.has("canonical_text")).toBe(true);
expect(scenarioColumns.has("file_path")).toBe(true);
```

- [ ] **Step 2: Run the migration-focused tests and confirm they fail first**

Run:

```bash
bun test tests/memory/sqlite-backend.test.ts --test-name-pattern "backfills canonical_text|legacy app memory tables"
```

Expected before implementation:
- migration compaction test fails because `canonical_text` does not exist and duplicates are left untouched
- the legacy schema test fails because `canonical_text` is not added yet

- [ ] **Step 3: Implement the schema upgrade, exact cleanup, and schema bridge alignment**

First, update `src/memory/backends/sqlite/migrate.ts` to add `canonical_text` to the base schema and run exact cleanup during migration:

```ts
import type { Database } from "bun:sqlite";
import { canonicalizeMemoryAtomText, mergeNumberSets } from "./canonical";
import { embedTextToVector, serializeVector } from "./vec";

function parseNumberArray(raw: string): number[] {
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === "number") : [];
}

function hasColumn(db: Database, tableName: string, columnName: string): boolean {
  return (db.query(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).some((row) => row.name === columnName);
}

function repointLineageAtomReferences(db: Database, userId: string, loserId: number, winnerId: number): void {
  const sourceRows = db
    .query(`SELECT id, source_kind, target_kind, target_id, link_type, created_at FROM lineage_links WHERE user_id = ? AND source_kind = 'memory_atom' AND source_id = ?`)
    .all(userId, String(loserId)) as Array<{
      id: number;
      source_kind: string;
      target_kind: string;
      target_id: string;
      link_type: string;
      created_at: string;
    }>;

  for (const row of sourceRows) {
    db.query(`
      INSERT OR IGNORE INTO lineage_links (user_id, source_kind, source_id, target_kind, target_id, link_type, created_at)
      VALUES (?, 'memory_atom', ?, ?, ?, ?, ?)
    `).run(userId, String(winnerId), row.target_kind, row.target_id, row.link_type, row.created_at);
    db.query(`DELETE FROM lineage_links WHERE id = ?`).run(row.id);
  }

  const targetRows = db
    .query(`SELECT id, source_kind, source_id, target_kind, link_type, created_at FROM lineage_links WHERE user_id = ? AND target_kind = 'memory_atom' AND target_id = ?`)
    .all(userId, String(loserId)) as Array<{
      id: number;
      source_kind: string;
      source_id: string;
      target_kind: string;
      link_type: string;
      created_at: string;
    }>;

  for (const row of targetRows) {
    db.query(`
      INSERT OR IGNORE INTO lineage_links (user_id, source_kind, source_id, target_kind, target_id, link_type, created_at)
      VALUES (?, ?, ?, 'memory_atom', ?, ?, ?)
    `).run(userId, row.source_kind, row.source_id, String(winnerId), row.link_type, row.created_at);
    db.query(`DELETE FROM lineage_links WHERE id = ?`).run(row.id);
  }
}

function rewriteScenarioAtomIds(db: Database, userId: string, loserId: number, winnerId: number): void {
  const rows = db
    .query(`SELECT id, atom_ids_json FROM memory_scenarios WHERE user_id = ? ORDER BY id ASC`)
    .all(userId) as Array<{ id: number; atom_ids_json: string }>;

  for (const row of rows) {
    const ids = parseNumberArray(row.atom_ids_json);
    if (!ids.includes(loserId)) {
      continue;
    }

    const rewritten = [...new Set(ids.map((id) => (id === loserId ? winnerId : id)))];
    db.query(`UPDATE memory_scenarios SET atom_ids_json = ? WHERE id = ?`).run(JSON.stringify(rewritten), row.id);
  }
}

function compactCanonicalAtomDuplicates(db: Database): void {
  const rows = db
    .query(`
      SELECT id, user_id, text, canonical_text, importance, source_turn_ids_json, source_layer, created_at, updated_at
      FROM memory_atoms
      WHERE canonical_text IS NOT NULL AND canonical_text != ''
      ORDER BY user_id ASC, canonical_text ASC, id ASC
    `)
    .all() as Array<{
      id: number;
      user_id: string;
      text: string;
      canonical_text: string;
      importance: number;
      source_turn_ids_json: string;
      source_layer: string;
      created_at: string;
      updated_at: string;
    }>;

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.user_id}:${row.canonical_text}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }

    const winner = group[0]!;
    const losers = group.slice(1);
    const mergedSourceTurnIds = mergeNumberSets(...group.map((row) => parseNumberArray(row.source_turn_ids_json)));
    const mergedImportance = Math.max(...group.map((row) => row.importance));
    const winnerText = group.at(-1)?.text ?? winner.text;
    const updatedAt = group.at(-1)?.updated_at ?? winner.updated_at;
    const embeddingJson = serializeVector(embedTextToVector(winnerText));

    db.query(`
      UPDATE memory_atoms
      SET text = ?, canonical_text = ?, importance = ?, source_turn_ids_json = ?, updated_at = ?
      WHERE id = ?
    `).run(winnerText, winner.canonical_text, mergedImportance, JSON.stringify(mergedSourceTurnIds), updatedAt, winner.id);

    db.query(`DELETE FROM memory_atoms_fts WHERE atom_id = ? AND user_id = ?`).run(String(winner.id), winner.user_id);
    db.query(`INSERT INTO memory_atoms_fts (text, atom_id, user_id) VALUES (?, ?, ?)`)
      .run(winnerText, String(winner.id), winner.user_id);
    db.query(`
      INSERT INTO memory_atom_embeddings (atom_id, user_id, embedding_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(atom_id) DO UPDATE SET
        user_id = excluded.user_id,
        embedding_json = excluded.embedding_json,
        updated_at = excluded.updated_at
    `).run(winner.id, winner.user_id, embeddingJson, updatedAt);

    for (const loser of losers) {
      repointLineageAtomReferences(db, winner.user_id, loser.id, winner.id);
      rewriteScenarioAtomIds(db, winner.user_id, loser.id, winner.id);
      db.query(`DELETE FROM memory_atoms_fts WHERE atom_id = ? AND user_id = ?`).run(String(loser.id), loser.user_id);
      db.query(`DELETE FROM memory_atom_embeddings WHERE atom_id = ?`).run(loser.id);
      db.query(`DELETE FROM memory_atoms WHERE id = ?`).run(loser.id);
    }
  }
}

function backfillCanonicalText(db: Database): void {
  const rows = db
    .query(`SELECT id, text FROM memory_atoms ORDER BY id ASC`)
    .all() as Array<{ id: number; text: string }>;

  for (const row of rows) {
    db.query(`UPDATE memory_atoms SET canonical_text = ? WHERE id = ?`).run(canonicalizeMemoryAtomText(row.text), row.id);
  }
}

export function migrateSqliteMemory(db: Database) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS memory_atoms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      text TEXT NOT NULL,
      canonical_text TEXT,
      importance INTEGER NOT NULL DEFAULT 3,
      source_turn_ids_json TEXT NOT NULL DEFAULT '[]',
      source_layer TEXT NOT NULL DEFAULT 'L1',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, text)
    );
  `);

  if (!hasColumn(db, "memory_atoms", "source_layer")) {
    db.exec(`ALTER TABLE memory_atoms ADD COLUMN source_layer TEXT NOT NULL DEFAULT 'L1'`);
  }
  if (!hasColumn(db, "memory_atoms", "canonical_text")) {
    db.exec(`ALTER TABLE memory_atoms ADD COLUMN canonical_text TEXT`);
  }

  backfillCanonicalText(db);
  compactCanonicalAtomDuplicates(db);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS memory_atoms_user_canonical_text_idx
    ON memory_atoms (user_id, canonical_text)
    WHERE canonical_text IS NOT NULL
  `);

  // Keep the existing file_path upgrade block for memory_scenarios.
}
```

Then keep the transitional app schema aligned in `src/db/schema.ts`:

```ts
CREATE TABLE IF NOT EXISTS memory_atoms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  canonical_text TEXT,
  importance INTEGER NOT NULL DEFAULT 3,
  source_turn_ids_json TEXT NOT NULL DEFAULT '[]',
  source_layer TEXT NOT NULL DEFAULT 'L1',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, text)
);
```

and add the upgrade guard after the existing `source_layer` check:

```ts
if (!hasColumn(db, "memory_atoms", "canonical_text")) {
  db.exec(`ALTER TABLE memory_atoms ADD COLUMN canonical_text TEXT`);
}
```

- [ ] **Step 4: Run the migration-focused tests, then the full backend test file**

Run:

```bash
bun test tests/memory/sqlite-backend.test.ts --test-name-pattern "backfills canonical_text|legacy app memory tables"
bun test tests/memory/sqlite-backend.test.ts
```

Expected after implementation:
- migration compaction test PASS
- legacy schema upgrade test PASS with `canonical_text` present
- full backend test file stays green

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add tests/memory/sqlite-backend.test.ts src/memory/backends/sqlite/migrate.ts src/db/schema.ts
git commit -m "$(cat <<'EOF'
fix: compact legacy duplicate memory atoms

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 3: Tighten L1 phrasing and verify the pipeline feeds one atom into L2

**Files:**
- Modify: `src/memory/prompts/l1.ts:1-9`
- Modify: `tests/memory/pipeline.test.ts:160-200` plus one new regression test

- [ ] **Step 1: Write the failing pipeline regression test for near-duplicate L1 output**

Add this test to `tests/memory/pipeline.test.ts` after the existing `runL1Pipeline counts duplicate L1 outputs as updates instead of new atoms` case:

```ts
test("pipeline collapses canonical atom variants before building the L2 scenario", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-pipeline-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });
    const logs = new InteractionLogService(backend, {
      enabled: false,
      exportDir: join(tempDir, "jsonl"),
    });
    const duplicateVariantLlm: LlmProvider = {
      async complete({ messages }) {
        const system = String(messages[0]?.content ?? "");
        if (system.includes("L1 extractor")) {
          return {
            content: JSON.stringify([
              { text: "User's name is Wii.", importance: 4, source_turn_ids: [1] },
              { text: "User’s name is Wii.", importance: 5, source_turn_ids: [1] },
            ]),
            toolCalls: [],
          };
        }
        if (system.includes("L2 Scenario aggregator")) {
          const atomDigest = String(messages[1]?.content ?? "");
          return {
            content: `## Identity\n${atomDigest.split("\n").filter(Boolean).map((line) => `- ${line}`).join("\n")}`,
            toolCalls: [],
          };
        }
        return {
          content: "- scenario_id=1 Identity\n- atom_id=1 User’s name is Wii.",
          toolCalls: [],
        };
      },
    };
    const pipeline = new PipelineCoordinator(backend, duplicateVariantLlm);

    await logs.logUserMessage({ chatId: "c1", userId: "u1", content: "My name is Wii.", mode: "chat" });
    const result = await pipeline.runMaintenanceForUser("u1", true);

    const atoms = await backend.listMemoryAtoms("u1", 10);
    const scenario = db
      .query(`SELECT body_markdown, atom_ids_json FROM memory_scenarios WHERE user_id = ? ORDER BY id DESC LIMIT 1`)
      .get("u1") as { body_markdown: string; atom_ids_json: string } | null;

    expect(result.l1Created).toBe(1);
    expect(atoms).toHaveLength(1);
    expect(JSON.parse(scenario?.atom_ids_json ?? "[]")).toEqual([1]);
    expect((scenario?.body_markdown.match(/atom_id=/g) ?? [])).toHaveLength(1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the targeted pipeline test to verify it fails before the prompt change is in place**

Run:

```bash
bun test tests/memory/pipeline.test.ts --test-name-pattern "collapses canonical atom variants"
```

Expected before implementation:
- the test fails if Task 1 and Task 2 are not yet present
- after Tasks 1 and 2 it should already be close to green; keep this step anyway so the pipeline-level contract is explicit before the prompt edit

- [ ] **Step 3: Tighten the L1 prompt wording without changing the output shape**

Update `src/memory/prompts/l1.ts` to this:

```ts
export function buildL1SystemPrompt(): string {
  return [
    "You are the L1 extractor for the project-owned memory pipeline.",
    "Extract durable atomic memories from conversation turns.",
    'Return ONLY valid JSON array items shaped as {"text": string, "importance": 1-5, "source_turn_ids": number[]}.',
    "Keep stable preferences, constraints, project context, decisions, and reusable workflow facts.",
    "Prefer stable phrasing for identity, preferences, constraints, and reusable workflow instructions.",
    "When two extracted memories mean the same thing, emit the clearest wording once.",
    "Ignore transient chit-chat, secrets, and duplicates.",
  ].join("\n");
}
```

Do not change `runL1Pipeline()` in this task; the backend dedupe already enforces correctness. This prompt change is only there to reduce noisy duplicate variants before they hit storage.

- [ ] **Step 4: Run the targeted pipeline test, then the full memory pipeline tests**

Run:

```bash
bun test tests/memory/pipeline.test.ts --test-name-pattern "collapses canonical atom variants"
bun test tests/memory/pipeline.test.ts
```

Expected after implementation:
- the new pipeline regression test PASS
- the existing pipeline tests stay green

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add tests/memory/pipeline.test.ts src/memory/prompts/l1.ts
git commit -m "$(cat <<'EOF'
refactor: reduce duplicate memory variants in L1

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 4: Final verification across the memory test suite

**Files:**
- Test only: `tests/memory/sqlite-backend.test.ts`
- Test only: `tests/memory/pipeline.test.ts`
- Test only: `tests/memory/recall.test.ts`
- Test only: `tests/memory/tools.test.ts`

- [ ] **Step 1: Run the focused suite that covers the changed surfaces**

Run:

```bash
bun test tests/memory/sqlite-backend.test.ts tests/memory/pipeline.test.ts tests/memory/recall.test.ts tests/memory/tools.test.ts
```

Expected:
- PASS
- no regressions in recall or tool-facing memory behavior

- [ ] **Step 2: Run the whole memory test directory once**

Run:

```bash
bun test tests/memory
```

Expected:
- PASS
- the canonical-text migration and atom dedupe changes do not break other memory-layer tests

- [ ] **Step 3: Inspect git diff for accidental scope drift before handing off**

Run:

```bash
git diff --stat
git diff -- tests/memory/sqlite-backend.test.ts tests/memory/pipeline.test.ts src/memory/backends/sqlite/canonical.ts src/memory/backends/sqlite/backend.ts src/memory/backends/sqlite/migrate.ts src/db/schema.ts src/memory/prompts/l1.ts
```

Expected:
- only the planned files changed
- no unrelated edits slipped into the branch

- [ ] **Step 4: Do not implement the reviewer false-positive follow-up here**

Record this handoff note in the implementation summary, not in code:

```text
Reviewer false-positive reduction was specified as a separate follow-up and no repo-owned reviewer implementation was found during planning, so it stays out of this change set.
```

Expected:
- the atom dedupe change stays focused
- no speculative reviewer-logic edits are mixed into the memory backend work

## Self-Review Against The Spec

- Spec coverage:
  - canonical matching key: Task 1
  - new-write upsert behavior: Task 1
  - schema changes and backfill: Task 2
  - exact cleanup for existing rows: Task 2
  - lineage/scenario reference rewrite: Task 2
  - L1 prompt tightening: Task 3
  - pipeline-level regression: Task 3
  - broader-paraphrase non-goal guard: Task 1
  - reviewer false-positive follow-up: explicitly deferred because no repo-owned implementation was found locally

- Placeholder scan:
  - no TBD/TODO markers remain
  - every code-changing step includes concrete code
  - every verification step includes an exact command and expected result

- Type consistency:
  - helper names used consistently: `canonicalizeMemoryAtomText`, `mergeNumberSets`, `replaceMemoryAtomSearchRow`, `upsertMemoryAtomEmbedding`
  - persisted column name used consistently: `canonical_text`
  - no public `MemoryAtom` type change is required because `canonical_text` stays a storage detail
