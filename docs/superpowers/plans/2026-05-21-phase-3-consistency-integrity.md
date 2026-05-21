# Phase 3 Consistency and Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the last two open bugs by giving generated skill drafts stable unique paths and by making store-backed L0 checkpoints stable across same-timestamp rows.

**Architecture:** Fix each remaining integrity bug at the identity layer that causes it. Generated skill drafts should use a deterministic per-generation revision path instead of a shared `skillName/SKILL.md` target, while store-backed maintenance should advance with a composite `(timestamp, recordId)` cursor instead of a bare timestamp so pagination and checkpointing share the same tie-breaker.

**Tech Stack:** TypeScript, Bun test runner, Bun SQLite, project-owned memory services, IMemoryStore-backed L0 pipeline.

---

## Source references

- Approved roadmap spec: `docs/superpowers/specs/2026-05-21-bug-fix-roadmap-design.md`
- Live bug ledger to update in the same change: `docs/bugs/2026-05-21-verified-bug-audit.md`
- Generated draft file writer: `src/memory/offload/l4.ts:107-119`
- Generated draft orchestration: `src/memory/core/service.ts:618-684`
- Generated skill persistence reads/writes: `src/memory/backends/sqlite/backend.ts:1462-1538`
- Generic store interface types: `src/memory/core/store/types.ts:23-144`
- Store-backed L0 queries: `src/memory/backends/sqlite/store.ts:859-896`
- Store-backed coordinator checkpoint logic: `src/memory/pipeline/coordinator.ts:65-105`
- Existing L4 tests: `tests/memory/l4.test.ts:116-226`
- Existing generated-skill backend test: `tests/memory/sqlite-backend.test.ts:125-146`
- Existing store L0 query tests: `tests/memory/sqlite-store-l0.test.ts:62-74`
- Existing store-backed integration tests: `tests/memory/imemory-store-integration.test.ts:417-475`
- Existing checkpoint round-trip test: `tests/memory/sqlite-backend.test.ts:184-207`

## File structure

Modify these files:

- `src/memory/offload/l4.ts` — accept an explicit draft directory / revision when writing a generated skill.
- `src/memory/core/service.ts` — assign a deterministic per-skill revision before writing a generated draft.
- `src/memory/backends/sqlite/backend.ts` — add a helper to count generated drafts for a specific `skillName` and keep the existing global count/list behavior intact.
- `tests/memory/l4.test.ts` — lock the new revisioned draft-path behavior and repeated-skill generation semantics.
- `tests/memory/sqlite-backend.test.ts` — verify the backend revision counter helper and checkpoint object round-trip.
- `src/memory/core/store/types.ts` — define the composite L0 cursor type and update the store interface signatures.
- `src/memory/backends/sqlite/store.ts` — page L0 rows by `(timestamp, record_id)` instead of `timestamp` alone.
- `src/memory/pipeline/coordinator.ts` — store and reuse the composite cursor for store-backed maintenance checkpoints.
- `tests/memory/sqlite-store-l0.test.ts` — verify same-timestamp paging by `record_id`.
- `tests/memory/imemory-store-integration.test.ts` — verify coordinator checkpoints keep same-timestamp rows reachable across batches.
- `docs/bugs/2026-05-21-verified-bug-audit.md` — update counts, executive summary, suggested fix order, and the final two bug entries in the same change.

No schema migration is required in this phase because:
- generated draft uniqueness can be derived from existing rows,
- checkpoint values already persist through `JsonValue` in `memory_pipeline_state`.

---

### Task 1: Give generated skill drafts deterministic unique paths per generation

**Files:**
- Modify: `tests/memory/l4.test.ts:116-226`
- Modify: `tests/memory/sqlite-backend.test.ts:125-146`
- Modify: `src/memory/offload/l4.ts:107-119`
- Modify: `src/memory/core/service.ts:664-684`
- Modify: `src/memory/backends/sqlite/backend.ts:1462-1538`

- [ ] **Step 1: Write the failing repeated-skill regressions**

In `tests/memory/l4.test.ts`, replace the existing `writeDraftSkill writes SKILL.md under given temp dir` test with this exact version:

```ts
test("writeDraftSkill writes a revisioned SKILL.md path under the given temp dir", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-l4-"));

  try {
    const result = await writeDraftSkill(tempDir, {
      skillName: "debugging-routing",
      skillDescription: "Use when debugging route selection issues",
      skillContent: validSkillContent,
    }, "draft-001");

    expect(result.relativePath).toBe("debugging-routing/draft-001/SKILL.md");
    expect(await readFile(join(tempDir, result.relativePath), "utf8")).toBe(validSkillContent);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

Then append this new regression test after `MemoryService.generateSkillDraft writes draft and records metadata`:

```ts
test("MemoryService.generateSkillDraft keeps repeated skill names in separate draft paths", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-l4-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
      taskCanvasDir: join(tempDir, "memory", "task-canvases"),
      generatedSkillsDir: join(tempDir, "generated-skills"),
    });
    await backend.init();
    const task = await backend.createTaskCanvas({ chatId: "chat-1", userId: "user-1", label: "Debug routing", status: "completed" });
    await Bun.write(join(tempDir, task.filePath), "graph LR\n  A[route bug] --> B[fix]\n");
    await backend.insertTaskGraphNode({
      chatId: "chat-1",
      userId: "user-1",
      taskId: task.id,
      nodeId: "node-1",
      toolName: "Read",
      args: { file: "src/router.ts" },
      summary: "Found route mismatch",
      resultRef: "memory/refs/node-1.md",
      status: "offloaded",
    });
    await mkdir(join(tempDir, "generated-skills"), { recursive: true });
    const service = new MemoryService(
      backend,
      fakeLlm(JSON.stringify({
        skillName: "debugging-routing",
        skillDescription: "Use when debugging route selection issues with grounded evidence",
        skillContent: validSkillContent,
      })),
      makeOptions(tempDir),
    );

    const first = await service.generateSkillDraft({ chatId: "chat-1", userId: "user-1", taskId: task.id, skillFocus: "routing" });
    const second = await service.generateSkillDraft({ chatId: "chat-1", userId: "user-1", taskId: task.id, skillFocus: "routing" });

    expect(first).toEqual({ ok: true, skillName: "debugging-routing", filePath: "debugging-routing/draft-001/SKILL.md" });
    expect(second).toEqual({ ok: true, skillName: "debugging-routing", filePath: "debugging-routing/draft-002/SKILL.md" });
    expect(await Bun.file(join(tempDir, "generated-skills", "debugging-routing", "draft-001", "SKILL.md")).exists()).toBe(true);
    expect(await Bun.file(join(tempDir, "generated-skills", "debugging-routing", "draft-002", "SKILL.md")).exists()).toBe(true);
    expect(await backend.countGeneratedSkills("user-1")).toBe(2);
    expect(await backend.countGeneratedSkillsByName("user-1", "debugging-routing")).toBe(2);
    expect((await backend.listGeneratedSkills("user-1", 10)).map((skill) => skill.skillFilePath).sort()).toEqual([
      "debugging-routing/draft-001/SKILL.md",
      "debugging-routing/draft-002/SKILL.md",
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

In `tests/memory/sqlite-backend.test.ts`, add this assertion after the existing `countGeneratedSkills("u1")` expectation in `SQLite backend stores task offload pipeline records`:

```ts
    expect(await backend.countGeneratedSkillsByName("u1", "demo-skill")).toBe(1);
```

- [ ] **Step 2: Run the targeted tests and verify they fail**

Run:

```bash
bun test tests/memory/l4.test.ts tests/memory/sqlite-backend.test.ts
```

Expected: FAIL because `writeDraftSkill()` still writes to the shared `skillName/SKILL.md` path, repeated generations overwrite the same file, and the backend does not yet expose `countGeneratedSkillsByName()`.

- [ ] **Step 3: Implement revisioned draft paths and a per-skill draft counter**

In `src/memory/backends/sqlite/backend.ts`, add this method immediately above `countGeneratedSkills(...)`:

```ts
  async countGeneratedSkillsByName(userId: string, skillName: string): Promise<number> {
    const row = this.db
      .query(`SELECT COUNT(*) AS count FROM memory_generated_skills WHERE user_id = ? AND skill_name = ?`)
      .get(userId, skillName) as { count: number } | null;

    return row?.count ?? 0;
  }
```

In `src/memory/offload/l4.ts`, replace `writeDraftSkill(...)` with this exact signature and implementation:

```ts
export async function writeDraftSkill(
  skillsDir: string,
  skill: L4Response,
  draftDirectory: string,
): Promise<{ absolutePath: string; relativePath: string }> {
  const relativePath = `${skill.skillName}/${draftDirectory}/SKILL.md`;
  const directory = resolve(skillsDir, skill.skillName, draftDirectory);
  const absolutePath = resolve(directory, "SKILL.md");
  const root = resolve(skillsDir);
  if (!absolutePath.startsWith(root)) {
    throw new Error("Invalid skill path.");
  }

  await mkdir(directory, { recursive: true });
  await writeFile(absolutePath, skill.skillContent, "utf8");
  return { absolutePath, relativePath };
}
```

In `src/memory/core/service.ts`, replace the `writeDraftSkill(...)` call inside `generateSkillDraft(...)` with this exact block:

```ts
    const existingCount = await backend.countGeneratedSkillsByName(input.userId, generated.skillName);
    const draftDirectory = `draft-${String(existingCount + 1).padStart(3, "0")}`;
    const draft = await writeDraftSkill(options.generatedSkillsDir, generated, draftDirectory);
```

- [ ] **Step 4: Run the tests again and confirm they pass**

Run:

```bash
bun test tests/memory/l4.test.ts tests/memory/sqlite-backend.test.ts
```

Expected: PASS. Repeated generations with the same `skillName` should produce `draft-001` and `draft-002` paths, both files should exist, and backend counts/listing should stay aligned with the stored files.

- [ ] **Step 5: Commit the revisioned draft-path fix**

Run:

```bash
git add tests/memory/l4.test.ts tests/memory/sqlite-backend.test.ts src/memory/offload/l4.ts src/memory/core/service.ts src/memory/backends/sqlite/backend.ts
git commit -m "fix: version generated skill draft paths"
```

---

### Task 2: Use a composite `(timestamp, recordId)` cursor for store-backed L0 checkpoints

**Files:**
- Modify: `tests/memory/sqlite-backend.test.ts:184-207`
- Modify: `tests/memory/sqlite-store-l0.test.ts:62-74`
- Modify: `tests/memory/imemory-store-integration.test.ts:417-475`
- Modify: `src/memory/core/store/types.ts:36-144`
- Modify: `src/memory/backends/sqlite/store.ts:859-896`
- Modify: `src/memory/pipeline/coordinator.ts:65-105`

- [ ] **Step 1: Write the failing same-timestamp cursor regressions**

In `tests/memory/sqlite-backend.test.ts`, append this extra checkpoint case inside the existing `cases` array in `SQLite backend round-trips checkpoint values including numbers`:

```ts
    ["cursor", { timestamp: 1710000000000, recordId: "legacy:l0:079" }],
```

In `tests/memory/sqlite-store-l0.test.ts`, append this new query regression after `queryL0ForL1 returns session rows ordered by timestamp`:

```ts
test("queryL0ForUser pages identical timestamps by record_id", async () => {
  const { store } = await createStore();
  const first = createRecord({ recordId: "l0-a", userId: "user-1", timestamp: 1000, recordedAt: "2026-05-18T08:01:00.000Z", messageText: "first row" });
  const second = createRecord({ recordId: "l0-b", userId: "user-1", timestamp: 1000, recordedAt: "2026-05-18T08:01:00.000Z", messageText: "second row" });
  const third = createRecord({ recordId: "l0-c", userId: "user-1", timestamp: 2000, recordedAt: "2026-05-18T08:02:00.000Z", messageText: "third row" });
  await store.upsertL0(third);
  await store.upsertL0(second);
  await store.upsertL0(first);

  await expect(store.queryL0ForUser?.("user-1", { timestamp: 1000, recordId: "l0-a" }, 10)).resolves.toEqual([
    second,
    third,
  ]);
});
```

In `tests/memory/imemory-store-integration.test.ts`, append this integration regression after `PipelineCoordinator can source pending L0 turns from IMemoryStore`:

```ts
test("PipelineCoordinator stores a composite cursor so same-timestamp rows remain reachable across batches", async () => {
  const { tempDir, backend, store } = await createMemory();

  try {
    const recordedAt = "2026-05-18T08:00:00.000Z";
    const timestamp = Date.parse(recordedAt);
    for (let index = 0; index < 81; index += 1) {
      await store.upsertL0({
        recordId: `legacy:l0:${String(index).padStart(3, "0")}`,
        sessionKey: "telegram:c1:u1",
        sessionId: "c1",
        chatId: "c1",
        userId: "u1",
        role: "user",
        messageText: `Please remember Bun runtime ${index}.`,
        recordedAt,
        timestamp,
        metadata: { mode: "chat" },
      });
    }

    const pipeline = new PipelineCoordinator(backend, fakeLlm, store);
    await pipeline.runMaintenanceForUser("u1");

    const checkpoint = await backend.getCheckpoint("u1", "l1_last_conversation_id");
    expect(checkpoint).toEqual({ timestamp, recordId: "legacy:l0:079" });
    await expect(store.queryL0ForUser?.("u1", checkpoint as any, 10)).resolves.toEqual([
      expect.objectContaining({ recordId: "legacy:l0:080" }),
    ]);

    await pipeline.runMaintenanceForUser("u1");
    const finalCheckpoint = await backend.getCheckpoint("u1", "l1_last_conversation_id");
    await expect(store.queryL0ForUser?.("u1", finalCheckpoint as any, 10)).resolves.toEqual([]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the targeted tests and verify they fail**

Run:

```bash
bun test tests/memory/sqlite-backend.test.ts tests/memory/sqlite-store-l0.test.ts tests/memory/imemory-store-integration.test.ts
```

Expected: FAIL because the store interface still expects numeric cursors only, the SQL still filters with `timestamp > ?`, and the coordinator still stores a timestamp-only checkpoint.

- [ ] **Step 3: Implement the composite cursor across the interface, store, and coordinator**

In `src/memory/core/store/types.ts`, add this type immediately below `export type L0QueryRow = L0Record;`:

```ts
export type L0Cursor = number | {
  timestamp: number;
  recordId: string;
};
```

Then replace the three L0 query signatures in `IMemoryStore` with this exact block:

```ts
  queryL0ForUser?(userId: string, after?: L0Cursor, limit?: number): MaybePromise<L0QueryRow[]>;
  queryL0ForL1(sessionKey: string, after?: L0Cursor, limit?: number): MaybePromise<L0QueryRow[]>;
  queryL0GroupedBySessionId(sessionKey: string, after?: L0Cursor, limit?: number): MaybePromise<L0SessionGroup[]>;
```

In `src/memory/backends/sqlite/store.ts`, add this helper above `queryL0ForUser(...)`:

```ts
function normalizeL0Cursor(after: L0Cursor | undefined): { timestamp: number; recordId: string } {
  if (typeof after === "number") {
    return { timestamp: after, recordId: "" };
  }
  return {
    timestamp: after?.timestamp ?? 0,
    recordId: after?.recordId ?? "",
  };
}
```

Then replace `queryL0ForUser(...)` with this exact version:

```ts
  async queryL0ForUser(userId: string, after: L0Cursor = 0, limit = 80): Promise<L0QueryRow[]> {
    const cursor = normalizeL0Cursor(after);

    try {
      const rows = this.db.query(`
        SELECT record_id, session_key, session_id, chat_id, user_id, role, message_text,
          recorded_at, timestamp, metadata_json
        FROM memory_store_l0
        WHERE user_id = ?
          AND role IN ('user', 'assistant')
          AND (timestamp > ? OR (timestamp = ? AND record_id > ?))
        ORDER BY timestamp ASC, record_id ASC
        LIMIT ?
      `).all(userId, cursor.timestamp, cursor.timestamp, cursor.recordId, limit) as L0DbRow[];

      return rows.map(mapL0Row);
    } catch {
      this.markRecoverableFailure();
      return [];
    }
  }
```

Replace `queryL0ForL1(...)` with this exact version:

```ts
  async queryL0ForL1(sessionKey: string, after: L0Cursor = 0, limit = 80): Promise<L0QueryRow[]> {
    const cursor = normalizeL0Cursor(after);

    try {
      const rows = this.db.query(`
        SELECT record_id, session_key, session_id, chat_id, user_id, role, message_text,
          recorded_at, timestamp, metadata_json
        FROM memory_store_l0
        WHERE session_key = ?
          AND (timestamp > ? OR (timestamp = ? AND record_id > ?))
        ORDER BY timestamp ASC, record_id ASC
        LIMIT ?
      `).all(sessionKey, cursor.timestamp, cursor.timestamp, cursor.recordId, limit) as L0DbRow[];

      return rows.map(mapL0Row);
    } catch {
      this.markRecoverableFailure();
      return [];
    }
  }
```

In `src/memory/pipeline/coordinator.ts`, replace the checkpoint parsing plus store-row load at the top of `runMaintenanceForUser(...)` with this exact code:

```ts
    const afterStoreCursor = typeof lastCheckpoint === "number"
      ? lastCheckpoint
      : lastCheckpoint && typeof lastCheckpoint === "object" && !Array.isArray(lastCheckpoint)
        ? {
            timestamp: Number((lastCheckpoint as { timestamp?: unknown }).timestamp ?? 0),
            recordId: String((lastCheckpoint as { recordId?: unknown }).recordId ?? ""),
          }
        : Number.parseInt(String(lastCheckpoint ?? "0"), 10) || 0;

    const storeRows = this.store?.queryL0ForUser
      ? await this.store.queryL0ForUser(userId, afterStoreCursor, DEFAULT_EVIDENCE_LIMIT)
      : undefined;
    const storePendingTurns = storeRows?.map((row) => ({
      id: numericRecordId(row.recordId, row.timestamp),
      chatId: row.chatId,
      userId: row.userId,
      role: row.role,
      content: row.messageText,
      meta: row.metadata ?? {},
      createdAt: row.recordedAt,
    }));
```

Then replace the store-backed checkpoint write inside `if (l1Result.checkpointAdvanced)` with this exact code:

```ts
      const nextCheckpoint = this.store?.queryL0ForUser
        ? {
            timestamp: storeRows?.at(-1)?.timestamp ?? 0,
            recordId: storeRows?.at(-1)?.recordId ?? "",
          }
        : l1Result.lastConversationId;
      await this.backend.setCheckpoint(userId, L1_CHECKPOINT_KEY, nextCheckpoint);
```

- [ ] **Step 4: Run the tests again and confirm they pass**

Run:

```bash
bun test tests/memory/sqlite-backend.test.ts tests/memory/sqlite-store-l0.test.ts tests/memory/imemory-store-integration.test.ts
```

Expected: PASS. The backend should round-trip an object checkpoint, the store query should page same-timestamp rows by `record_id`, and the coordinator should leave the last same-timestamp row reachable after the first batch.

- [ ] **Step 5: Commit the composite-cursor fix**

Run:

```bash
git add tests/memory/sqlite-backend.test.ts tests/memory/sqlite-store-l0.test.ts tests/memory/imemory-store-integration.test.ts src/memory/core/store/types.ts src/memory/backends/sqlite/store.ts src/memory/pipeline/coordinator.ts
git commit -m "fix: use composite cursors for store-backed l0 checkpoints"
```

---

### Task 3: Update the live bug ledger and run the final verification suite

**Files:**
- Modify: `docs/bugs/2026-05-21-verified-bug-audit.md:1-218`
- Reference: all files changed in Tasks 1–2

- [ ] **Step 1: Update the final header counts and executive summary**

In `docs/bugs/2026-05-21-verified-bug-audit.md`, change the `## Status` counts to:

```md
Reviewed 14 previously documented bugs:
- 0 still appear open in the current tree
- 14 appear fixed in the current tree
```

Replace the `## Executive summary` body with this exact text:

```md
All previously documented bugs verified in this audit are now fixed in the current tree.

The last consistency/integrity issues are resolved:
- generated skill drafts now use deterministic per-generation revision paths instead of overwriting the same `skillName/SKILL.md` file,
- store-backed maintenance now advances checkpoints with a composite `(timestamp, recordId)` cursor, so same-timestamp rows remain reachable across batches.

The bug ledger below now reflects the completed state of the campaign.
```

- [ ] **Step 2: Replace the final two bug entries and retire the suggested fix order**

Replace bug sections **9** and **10** with these exact versions:

```md
### 9. Generated skill drafts can overwrite each other while the stored draft count keeps increasing

**Status:** Fixed in current tree  
**Severity:** Medium

**Impact:** Repeated draft generations with the same `skillName` now keep separate files instead of overwriting the same path while the database count keeps growing.

**Root cause:** the file path was keyed only by `skillName` while the database created a fresh row for every generation.

**Fix summary:** generated skill drafts now use deterministic per-generation revision directories under the `skillName`, and the service derives the next revision from existing rows before writing the file.

**Changed code:** `src/memory/offload/l4.ts`, `src/memory/core/service.ts`, `src/memory/backends/sqlite/backend.ts`

**Verification:** `tests/memory/l4.test.ts`, `tests/memory/sqlite-backend.test.ts`
```

```md
### 10. Store-backed memory maintenance can permanently skip turns that share the same millisecond timestamp

**Status:** Fixed in current tree  
**Severity:** Medium

**Impact:** Store-backed maintenance no longer loses later rows that share the same timestamp with the last row in a previous batch.

**Root cause:** store-backed pagination and checkpointing used a bare timestamp instead of a stable `(timestamp, recordId)` tie-breaker.

**Fix summary:** the IMemoryStore interface, SQLite store queries, and PipelineCoordinator now all use a composite cursor with `timestamp` and `recordId`.

**Changed code:** `src/memory/core/store/types.ts`, `src/memory/backends/sqlite/store.ts`, `src/memory/pipeline/coordinator.ts`

**Verification:** `tests/memory/sqlite-store-l0.test.ts`, `tests/memory/imemory-store-integration.test.ts`, `tests/memory/sqlite-backend.test.ts`
```

Replace the `## Suggested fix order` section with this exact line:

```md
## Suggested fix order

All verified bugs in this audit are fixed in the current tree.
```

- [ ] **Step 3: Run the full Phase 3 verification suite**

Run:

```bash
bun test tests/memory/l4.test.ts tests/memory/sqlite-backend.test.ts tests/memory/sqlite-store-l0.test.ts tests/memory/imemory-store-integration.test.ts
```

Expected: PASS. This suite covers revisioned draft paths, backend count consistency, checkpoint object round-trips, same-timestamp store paging, and coordinator-level batch continuation.

- [ ] **Step 4: Verify the ledger matches the code you actually changed and commit**

Manually confirm that the header counts read `0 still appear open` and `14 appear fixed`, the `Changed code` lines mention only the files touched in Tasks 1–2, and the `Verification` lines mention the exact Phase 3 test files.

Then run:

```bash
git add docs/bugs/2026-05-21-verified-bug-audit.md tests/memory/l4.test.ts tests/memory/sqlite-backend.test.ts tests/memory/sqlite-store-l0.test.ts tests/memory/imemory-store-integration.test.ts src/memory/offload/l4.ts src/memory/core/service.ts src/memory/backends/sqlite/backend.ts src/memory/core/store/types.ts src/memory/backends/sqlite/store.ts src/memory/pipeline/coordinator.ts
git commit -m "docs: update final bug audit"
```

---

## Coverage check against the approved roadmap

- **Generated skill draft overwrite/count mismatch:** Task 1
- **Store-backed same-timestamp checkpoint skipping:** Task 2
- **Final ledger update and end-of-campaign verification:** Task 3

## Placeholder scan

- No `TODO`, `TBD`, or deferred implementation notes remain.
- Every code-changing step includes concrete code blocks.
- Every verification step includes exact `bun test` commands and expected outcomes.
- Every commit step uses explicit file lists rather than `git add .`.

## Type and API consistency check

- Generated draft revision directories are consistently named `draft-001`, `draft-002`, and so on.
- The per-skill backend helper is consistently named `countGeneratedSkillsByName(userId, skillName)`.
- The store cursor type is consistently named `L0Cursor` and uses the same `{ timestamp, recordId }` shape across interface, store queries, and coordinator checkpoints.
