# Inspect Memory L2/L3 Full Dump Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update `scripts/inspect-memory.ts` so it keeps the current status summary and also prints a full L2/L3 content dump plus pretty JSON for the selected user.

**Architecture:** Keep `scripts/inspect-memory.ts` as a thin CLI entrypoint. Move filtering and formatting into a new pure helper under `src/memory/debug/` so the observable report can be tested without executing the script. Read L2/L3 from `SqliteMemoryStore.pullProfiles()` instead of `memory.recall(...)` so the output is exhaustive rather than query-ranked.

**Tech Stack:** Bun, TypeScript, Bun test, Bun SQLite, existing `SqliteMemoryStore`

---

## File structure

- Create: `src/memory/debug/inspect-memory-report.ts`
  - Pure helper module for building the content-only L2/L3 dump and formatting the full final report string.
- Create: `tests/memory/inspect-memory-report.test.ts`
  - Targeted unit tests for dump filtering, empty states, summary-first formatting, and JSON output.
- Modify: `scripts/inspect-memory.ts`
  - Replace the recall-based scenario/persona printing with store-backed full dump output.

## Implementation notes

- Keep the current `memoryStatus(...)` summary in the final report.
- Do not add a new `MemoryService` API.
- Use `SqliteMemoryStore` with the same init settings as `createMemoryService(...)`:
  - `sqliteVecEnabled: config.memory.sqliteVecEnabled`
  - `bm25Enabled: true`
  - `bm25Language: "en"`
  - `await store.init({ provider: "local", model: "deterministic-local", dimensions: 64 })`
- JSON output must be content-only:
  - `userId`
  - `chatId` (`null` when absent)
  - `l2: Array<{ content: string }>`
  - `l3: Array<{ content: string }>`

### Task 1: Add a pure report builder with failing tests first

**Files:**
- Create: `src/memory/debug/inspect-memory-report.ts`
- Create: `tests/memory/inspect-memory-report.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/memory/inspect-memory-report.test.ts` with:

```ts
import { expect, test } from "bun:test";
import type { ProfileRecord } from "../../src/memory/core/store/types";
import { buildInspectMemoryDump, formatInspectMemoryReport } from "../../src/memory/debug/inspect-memory-report";

function profile(overrides: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    id: "profile-1",
    type: "l2",
    userId: "user-1",
    filename: "scenario-1.md",
    content: "# Scenario\nDiscussed Bun runtime.",
    contentMd5: "md5-v1",
    version: 1,
    createdAtMs: 1710000000000,
    updatedAtMs: 1710000000000,
    metadata: {},
    ...overrides,
  };
}

test("buildInspectMemoryDump keeps only the selected user's L2 and L3 content", () => {
  const dump = buildInspectMemoryDump(
    [
      profile({ id: "l2-a", type: "l2", content: "# Scenario\nFirst scenario." }),
      profile({ id: "l3-a", type: "l3", filename: "persona-user-1.md", content: "# Persona\nPrefers Bun." }),
      profile({ id: "l2-b", userId: "user-2", type: "l2", content: "# Scenario\nOther user." }),
    ],
    "user-1",
  );

  expect(dump).toEqual({
    userId: "user-1",
    chatId: null,
    l2: [{ content: "# Scenario\nFirst scenario." }],
    l3: [{ content: "# Persona\nPrefers Bun." }],
  });
});

test("formatInspectMemoryReport prints summary first, full sections, and raw json", () => {
  const report = formatInspectMemoryReport("backend=sqlite\nL2 scenarios=1\nL3 persona=yes", {
    userId: "user-1",
    chatId: "chat-9",
    l2: [{ content: "# Scenario\nMorning planning." }],
    l3: [{ content: "# Persona\nPrefers concise replies." }],
  });

  expect(report).toContain("backend=sqlite\nL2 scenarios=1\nL3 persona=yes");
  expect(report).toContain("--- L2 scenarios ---\n\n#1\n# Scenario\nMorning planning.");
  expect(report).toContain("--- L3 persona ---\n\n# Persona\nPrefers concise replies.");
  expect(report).toContain(`--- raw json ---\n{\n  \"userId\": \"user-1\",\n  \"chatId\": \"chat-9\"`);
});

test("formatInspectMemoryReport prints explicit empty states", () => {
  const report = formatInspectMemoryReport("backend=sqlite", {
    userId: "user-1",
    chatId: null,
    l2: [],
    l3: [],
  });

  expect(report).toContain("No L2 scenarios found.");
  expect(report).toContain("No L3 persona found.");
  expect(report).toContain(`\"chatId\": null`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/memory/inspect-memory-report.test.ts
```

Expected: FAIL with a module resolution error for `../../src/memory/debug/inspect-memory-report`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/memory/debug/inspect-memory-report.ts` with:

```ts
import type { ProfileRecord } from "../core/store/types";

export type InspectMemoryDump = {
  userId: string;
  chatId: string | null;
  l2: Array<{ content: string }>;
  l3: Array<{ content: string }>;
};

export function buildInspectMemoryDump(
  profiles: ProfileRecord[],
  userId: string,
  chatId?: string,
): InspectMemoryDump {
  return {
    userId,
    chatId: chatId ?? null,
    l2: profiles
      .filter((profile) => profile.userId === userId && profile.type === "l2")
      .map((profile) => ({ content: profile.content })),
    l3: profiles
      .filter((profile) => profile.userId === userId && profile.type === "l3")
      .map((profile) => ({ content: profile.content })),
  };
}

export function formatInspectMemoryReport(status: string, dump: InspectMemoryDump): string {
  const l2Section = dump.l2.length === 0
    ? "No L2 scenarios found."
    : dump.l2.map((scenario, index) => `#${index + 1}\n${scenario.content}`).join("\n\n");

  const l3Section = dump.l3.length === 0
    ? "No L3 persona found."
    : dump.l3.map((persona) => persona.content).join("\n\n");

  return [
    status,
    "",
    "--- L2 scenarios ---",
    "",
    l2Section,
    "",
    "--- L3 persona ---",
    "",
    l3Section,
    "",
    "--- raw json ---",
    JSON.stringify(dump, null, 2),
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
bun test tests/memory/inspect-memory-report.test.ts
```

Expected: PASS with `3 pass` and `0 fail`.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/memory/debug/inspect-memory-report.ts tests/memory/inspect-memory-report.test.ts
git commit -m "test: cover inspect-memory full dump output"
```

Expected: commit succeeds and includes only the new helper and test files.

### Task 2: Replace recall output in the script with store-backed full dump output

**Files:**
- Modify: `scripts/inspect-memory.ts`
- Reuse: `src/memory/debug/inspect-memory-report.ts`

- [ ] **Step 1: Add the new imports and store initialization**

Update `scripts/inspect-memory.ts` so the imports and store setup include:

```ts
#!/usr/bin/env bun
import { db, initDb } from "../src/db";
import { config } from "../src/config";
import { SqliteMemoryStore } from "../src/memory/backends/sqlite/store";
import { buildInspectMemoryDump, formatInspectMemoryReport } from "../src/memory/debug/inspect-memory-report";
import { createMemoryService } from "../src/memory/integration/factory";

const llm = {
  async complete() {
    throw new Error("inspect-memory does not execute LLM calls");
  },
};

initDb();
const userId = process.argv[2] ?? "";
const chatId = process.argv[3] ?? "";
const memory = await createMemoryService(db, llm as any, {
  storage: {
    dataDir: config.storage.dataDir,
    memoryRefsDir: config.storage.memoryRefsDir,
    memoryCanvasDir: config.storage.memoryCanvasDir,
    memoryJsonlExportDir: config.storage.memoryJsonlExportDir,
    historyDir: config.storage.historyDir,
  },
  memory: {
    maintenanceCron: config.memory.maintenanceCron,
    offloadEnabled: config.memory.offloadEnabled,
    offloadMinChars: config.memory.offloadMinChars,
    offloadSummaryChars: config.memory.offloadSummaryChars,
    sqliteVecEnabled: config.memory.sqliteVecEnabled,
    jsonlExportEnabled: config.memory.jsonlExportEnabled,
  },
});

const store = new SqliteMemoryStore(db, {
  sqliteVecEnabled: config.memory.sqliteVecEnabled,
  bm25Enabled: true,
  bm25Language: "en",
});
await store.init({ provider: "local", model: "deterministic-local", dimensions: 64 });
```

- [ ] **Step 2: Replace the recall-based output block with the report builder**

Replace the current lines after the `if (!userId) { ... }` block with:

```ts
const status = await memory.memoryStatus(userId, chatId || undefined);
const profiles = await store.pullProfiles();
const dump = buildInspectMemoryDump(profiles, userId, chatId || undefined);
console.log(formatInspectMemoryReport(status, dump));
```

Delete this old block entirely:

```ts
console.log(await memory.memoryStatus(userId, chatId || undefined));
const recall = await memory.recall(userId, "persona preferences project memory", 5, chatId || undefined);
if (recall.persona) console.log(`\n--- persona ---\n${recall.persona}`);
if (recall.scenarios.length) console.log(`\n--- scenarios ---\n${recall.scenarios.map((scenario) => `#${scenario.id} ${scenario.title}`).join("\n")}`);
```

- [ ] **Step 3: Run the focused automated verification**

Run:

```bash
bun test tests/memory/inspect-memory-report.test.ts && bunx tsc --noEmit
```

Expected: the report test passes and TypeScript exits cleanly with no errors.

- [ ] **Step 4: Run the script smoke checks**

Run:

```powershell
bun scripts/inspect-memory.ts; $first = bun scripts/inspect-memory.ts | Select-Object -First 1; if ($first -and $first -ne "No users yet. Pass a user_id to inspect.") { bun scripts/inspect-memory.ts $first }
```

Expected:
- First command prints either newline-delimited user IDs or `No users yet. Pass a user_id to inspect.`
- If at least one user exists, the second command prints a report that starts with `backend=` and contains all three markers:
  - `--- L2 scenarios ---`
  - `--- L3 persona ---`
  - `--- raw json ---`

- [ ] **Step 5: Commit**

Run:

```bash
git add scripts/inspect-memory.ts
git commit -m "feat: dump full L2/L3 memory in inspect script"
```

Expected: commit succeeds and contains only the script wiring change.

## Verification checklist

Run these before marking the work done:

```bash
bun test tests/memory/inspect-memory-report.test.ts
bunx tsc --noEmit
```

If the local DB has at least one user, also run the PowerShell smoke command from Task 2 Step 4 and confirm the output includes the section markers and pretty JSON.
