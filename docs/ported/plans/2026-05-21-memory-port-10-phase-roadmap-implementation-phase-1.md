# Memory Port Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize config forwarding, store contract, and L0 capture semantics so later phases can rely on trustworthy runtime inputs.

**Architecture:** Keep the current app-integrated memory stack intact while tightening config propagation, clarifying the shared store contract, and mirroring tool events into IMemoryStore. Do not pull forward L1 semantic or runtime-layer behavior from later phases.

**Tech Stack:** Bun, TypeScript, bun:test, bun:sqlite, sqlite-vec, project-owned memory services under `src/memory/`

[Back to implementation plan index](2026-05-21-memory-port-10-phase-roadmap-implementation.md) | [Next: Phase 2](2026-05-21-memory-port-10-phase-roadmap-implementation-phase-2.md)

---
## Phase 1 — Foundation

Covers Workstream 1.1 through Workstream 1.3 from `docs/ported/specs/2026-05-21-memory-port-10-phase-roadmap-design.md`. Execute Task 1 through Task 3 in order before moving to Phase 2.

### Task 1 (Phase 1 / Workstream 1.1): Forward full memory config into the factory

**Files:**
- Create: `src/memory/integration/app-config.ts`
- Create: `tests/memory/factory-config-forwarding.test.ts`
- Modify: `src/index.ts:52-73`
- Test: `tests/memory/config.test.ts`
- Test: `tests/memory/factory-config-forwarding.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { parseConfig } from "../../src/config";
import { buildMemoryServiceFactoryConfig } from "../../src/memory/integration/app-config";

test("buildMemoryServiceFactoryConfig forwards semantic memory settings", () => {
  const runtime = parseConfig({
    BOT_TOKEN: "123:abc",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
    MEMORY_L1_ENABLED: "false",
    MEMORY_L2_ENABLED: "false",
    MEMORY_TASK_RECALL_ENABLED: "false",
  });

  const factoryConfig = buildMemoryServiceFactoryConfig(runtime);

  expect(factoryConfig.memory.l1).toEqual(runtime.memory.l1);
  expect(factoryConfig.memory.l2).toEqual(runtime.memory.l2);
  expect(factoryConfig.memory.taskRecall).toEqual(runtime.memory.taskRecall);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/memory/factory-config-forwarding.test.ts`
Expected: FAIL with `Cannot find module '../../src/memory/integration/app-config'` or missing export.

- [ ] **Step 3: Write minimal implementation**

`src/memory/integration/app-config.ts`

```ts
import { parseConfig } from "../../config";

export type RuntimeConfig = ReturnType<typeof parseConfig>;

export function buildMemoryServiceFactoryConfig(runtime: RuntimeConfig) {
  return {
    storage: {
      dataDir: runtime.storage.dataDir,
      memoryRefsDir: runtime.storage.memoryRefsDir,
      memoryCanvasDir: runtime.storage.memoryCanvasDir,
      memoryJsonlExportDir: runtime.storage.memoryJsonlExportDir,
      historyDir: runtime.storage.historyDir,
      memoryTaskCanvasDir: runtime.storage.memoryTaskCanvasDir,
      memoryGeneratedSkillsDir: runtime.storage.memoryGeneratedSkillsDir,
    },
    memory: {
      maintenanceCron: runtime.memory.maintenanceCron,
      offloadEnabled: runtime.memory.offloadEnabled,
      offloadMinChars: runtime.memory.offloadMinChars,
      offloadSummaryChars: runtime.memory.offloadSummaryChars,
      sqliteVecEnabled: runtime.memory.sqliteVecEnabled,
      jsonlExportEnabled: runtime.memory.jsonlExportEnabled,
      l15: runtime.memory.l15,
      l1: runtime.memory.l1,
      l2: runtime.memory.l2,
      taskRecall: runtime.memory.taskRecall,
      l4: runtime.memory.l4,
    },
  };
}
```

`src/index.ts:52-73`

```ts
import { buildMemoryServiceFactoryConfig } from "./memory/integration/app-config";

const llm = createLlmProvider(runtimeTrace);
const memory = await createMemoryService(
  db,
  llm,
  buildMemoryServiceFactoryConfig(config),
  runtimeTrace,
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/memory/config.test.ts tests/memory/factory-config-forwarding.test.ts`
Expected: PASS with the new forwarding test and the existing config tests green.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/memory/integration/app-config.ts tests/memory/factory-config-forwarding.test.ts
git commit -m "feat: forward full memory config into factory"
```

---

### Task 2 (Phase 1 / Workstream 1.2): Define normalized store metadata for richer memory records

**Files:**
- Create: `src/memory/core/store/record-metadata.ts`
- Create: `tests/memory/store-record-metadata.test.ts`
- Modify: `src/memory/core/store/types.ts:17-22,51-67`
- Modify: `tests/memory/imemory-store-types.test.ts:17-55`
- Test: `tests/memory/store-record-metadata.test.ts`
- Test: `tests/memory/imemory-store-types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import {
  buildL1RecordMetadata,
  normalizeL1RecordMetadata,
} from "../../src/memory/core/store/record-metadata";

test("normalizeL1RecordMetadata preserves TencentDB-style semantic fields", () => {
  const metadata = normalizeL1RecordMetadata(
    buildL1RecordMetadata({
      source: "pipeline",
      canonicalText: "use bun for local scripts",
      memoryKind: "instruction",
      sourceMessageIds: ["msg-1", "msg-2", "msg-1"],
      timestamps: ["2026-05-18T08:00:00.000Z", "2026-05-18T08:00:00.000Z"],
    }),
  );

  expect(metadata).toEqual({
    source: "pipeline",
    canonicalText: "use bun for local scripts",
    memoryKind: "instruction",
    sourceMessageIds: ["msg-1", "msg-2"],
    timestamps: ["2026-05-18T08:00:00.000Z"],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/memory/store-record-metadata.test.ts`
Expected: FAIL with `Cannot find module '../../src/memory/core/store/record-metadata'`.

- [ ] **Step 3: Write minimal implementation**

`src/memory/core/store/record-metadata.ts`

```ts
import type { EventMeta } from "../types";

export type L1MemoryKind = "persona" | "episodic" | "instruction";

export type L1RecordMetadata = EventMeta & {
  source?: "pipeline" | "MemoryService.saveMemory" | "offload";
  canonicalText?: string;
  memoryKind?: L1MemoryKind;
  sourceMessageIds?: string[];
  timestamps?: string[];
};

export function normalizeL1RecordMetadata(metadata: L1RecordMetadata): L1RecordMetadata {
  return {
    ...metadata,
    sourceMessageIds: [...new Set((metadata.sourceMessageIds ?? []).filter(Boolean))],
    timestamps: [...new Set((metadata.timestamps ?? []).filter(Boolean))],
  };
}

export function buildL1RecordMetadata(input: {
  source: NonNullable<L1RecordMetadata["source"]>;
  canonicalText?: string;
  memoryKind?: L1MemoryKind;
  sourceMessageIds?: string[];
  timestamps?: string[];
}): L1RecordMetadata {
  return normalizeL1RecordMetadata({
    source: input.source,
    canonicalText: input.canonicalText,
    memoryKind: input.memoryKind,
    sourceMessageIds: input.sourceMessageIds,
    timestamps: input.timestamps,
  });
}
```

`src/memory/core/store/types.ts:17-22,51-67`

```ts
import type { L1RecordMetadata } from "./record-metadata";

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
  metadata?: L1RecordMetadata;
  createdTime: string;
  updatedTime: string;
};
```

`tests/memory/imemory-store-types.test.ts:29-55`

```ts
const l1: L1Record = {
  recordId: "l1-1",
  userId: "u1",
  sessionKey: "telegram:c1:u1",
  sessionId: "c1",
  content: "User prefers Bun runtime",
  type: "L1",
  priority: 8,
  sceneName: "runtime",
  timestampStr: "2026-05-18T00:00:00.000Z",
  sourceConversationIds: [1],
  metadata: {
    source: "pipeline",
    memoryKind: "instruction",
    sourceMessageIds: ["msg-1"],
    timestamps: ["2026-05-18T00:00:00.000Z"],
  },
  createdTime: "2026-05-18T00:00:00.000Z",
  updatedTime: "2026-05-18T00:00:00.000Z",
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/memory/store-record-metadata.test.ts tests/memory/imemory-store-types.test.ts`
Expected: PASS with normalized metadata deduping arrays and type coverage updated.

- [ ] **Step 5: Commit**

```bash
git add src/memory/core/store/record-metadata.ts src/memory/core/store/types.ts tests/memory/store-record-metadata.test.ts tests/memory/imemory-store-types.test.ts
git commit -m "refactor: define normalized memory record metadata"
```

---

### Task 3 (Phase 1 / Workstream 1.3): Mirror tool events into L0 store records

**Files:**
- Create: `tests/memory/l0-capture.test.ts`
- Modify: `src/memory/core/service.ts:453-476`
- Test: `tests/memory/l0-capture.test.ts`
- Test: `tests/memory/agent-runtime.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { migrateSqliteMemory } from "../../src/memory/backends/sqlite/migrate";
import { SqliteMemoryBackend } from "../../src/memory/backends/sqlite/backend";
import { SqliteMemoryStore } from "../../src/memory/backends/sqlite/store";
import { MemoryService } from "../../src/memory/core/service";

const fakeLlm = { async complete() { return { content: "ok", toolCalls: [] }; } };

test("logToolCall and logToolResult mirror tool events into IMemoryStore L0", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-l0-capture-"));
  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });
    const store = new SqliteMemoryStore(db, { sqliteVecEnabled: false, bm25Enabled: false });
    await store.init();

    const service = new MemoryService(backend, fakeLlm as any, {
      dataDir: tempDir,
      backendName: "sqlite",
      backendOwner: "test",
      maintenanceCron: "0 * * * *",
      offloadEnabled: true,
      l15: { enabled: true, mode: "hybrid", recentMessages: 6, historyTaskLimit: 10, maxCanvasChars: 12000, safeFallback: "short" },
      l1: { enabled: true, mode: "local", maxSummaryChars: 900, defaultScore: 5 },
      l2: { enabled: true, mode: "local", triggerMinEntries: 1, maxCanvasChars: 12000 },
      taskRecall: { enabled: true, maxTasks: 3, maxCanvasChars: 2200 },
      l4: { enabled: true, mode: "local", requireCompletedTask: false, maxEvidenceEntries: 80, maxCanvasChars: 20000, maxSkillChars: 20000 },
      generatedSkillsDir: join(tempDir, "skills"),
    }, undefined, undefined, undefined, undefined, store);

    await service.logToolCall({
      chatId: "c1",
      userId: "u1",
      toolName: "bun_test",
      toolCallId: "call-1",
      content: "CALL bun_test({\"file\":\"tests/memory/recall.test.ts\"})",
    });
    await service.logToolResult({
      chatId: "c1",
      userId: "u1",
      toolName: "bun_test",
      toolCallId: "call-1",
      offloaded: false,
      content: "RESULT bun_test: PASS",
    });

    const rows = await store.queryL0ForL1("telegram:c1:u1", 0, 10);

    expect(rows.map((row) => [row.role, row.metadata?.eventType, row.metadata?.toolName])).toEqual([
      ["tool", "tool_call", "bun_test"],
      ["tool", "tool_result", "bun_test"],
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/memory/l0-capture.test.ts`
Expected: FAIL because `logToolCall()` and `logToolResult()` only write interaction events today and do not mirror into `IMemoryStore`.

- [ ] **Step 3: Write minimal implementation**

`src/memory/core/service.ts:453-476`

```ts
async logToolCall(input: {
  chatId: string;
  userId: string;
  toolName: string;
  toolCallId?: string;
  content: string;
  meta?: EventMeta;
}): Promise<number> {
  const { interactionLogService, store } = getState(this);
  const eventId = await interactionLogService.logToolCall(input);

  if (store) {
    const recordedAt = new Date().toISOString();
    await store.upsertL0({
      recordId: `interaction:l0:${eventId}:tool_call`,
      sessionKey: sessionKey(input.chatId, input.userId),
      sessionId: input.chatId,
      chatId: input.chatId,
      userId: input.userId,
      role: "tool",
      messageText: input.content,
      recordedAt,
      timestamp: Date.parse(recordedAt) || eventId,
      metadata: {
        ...(input.meta ?? {}),
        eventType: "tool_call",
        toolName: input.toolName,
        toolCallId: input.toolCallId ?? null,
      },
    });
  }

  return eventId;
}

async logToolResult(input: {
  chatId: string;
  userId: string;
  toolName: string;
  toolCallId?: string;
  content: string;
  offloaded: boolean;
  meta?: EventMeta;
}): Promise<number> {
  const { interactionLogService, store } = getState(this);
  const eventId = await interactionLogService.logToolResult(input);

  if (store) {
    const recordedAt = new Date().toISOString();
    await store.upsertL0({
      recordId: `interaction:l0:${eventId}:tool_result`,
      sessionKey: sessionKey(input.chatId, input.userId),
      sessionId: input.chatId,
      chatId: input.chatId,
      userId: input.userId,
      role: "tool",
      messageText: input.content,
      recordedAt,
      timestamp: Date.parse(recordedAt) || eventId,
      metadata: {
        ...(input.meta ?? {}),
        eventType: "tool_result",
        toolName: input.toolName,
        toolCallId: input.toolCallId ?? null,
        offloaded: input.offloaded,
      },
    });
  }

  return eventId;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/memory/l0-capture.test.ts tests/memory/agent-runtime.test.ts`
Expected: PASS with the new store mirroring test and existing agent runtime coverage still green.

- [ ] **Step 5: Commit**

```bash
git add src/memory/core/service.ts tests/memory/l0-capture.test.ts
git commit -m "feat: mirror tool events into l0 store records"
```

---

