# Memory Port Phase 3 — Runtime & Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining runtime parity gaps with durable scene/persona behavior, harder offload/runtime semantics, cleanup, and the final verification pass.

**Architecture:** Build Phase 3 on top of the stronger recall and L1 behavior from earlier phases, then land the higher-memory and runtime work in dependency order so final verification measures the whole port rather than a partial subset.

**Tech Stack:** Bun, TypeScript, bun:test, bun:sqlite, sqlite-vec, project-owned memory services under `src/memory/`

[Previous: Phase 2](2026-05-21-memory-port-10-phase-roadmap-implementation-phase-2.md) | [Back to implementation plan index](2026-05-21-memory-port-10-phase-roadmap-implementation.md)

---
## Phase 3 — Runtime & acceptance

Covers Workstream 3.1 through Workstream 3.4 from `docs/ported/specs/2026-05-21-memory-port-10-phase-roadmap-design.md`. Execute Task 7 through Task 10 in order, then run the final verification sweep.

### Task 7 (Phase 3 / Workstream 3.1): Replace snapshot-only L2 with durable scene profiles

**Files:**
- Create: `src/memory/pipeline/l2-scenes.ts`
- Create: `tests/memory/l2-scenes.test.ts`
- Modify: `src/memory/pipeline/l2.ts:16-87`
- Test: `tests/memory/l2-scenes.test.ts`
- Test: `tests/memory/imemory-store-integration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import type { L1Record } from "../../src/memory/core/store/types";
import { buildSceneProfiles } from "../../src/memory/pipeline/l2-scenes";

test("buildSceneProfiles groups l1 records by scene name into durable l2 profiles", () => {
  const profiles = buildSceneProfiles("u1", [
    {
      recordId: "l1-1",
      userId: "u1",
      sessionKey: "chat:c1",
      sessionId: "c1",
      content: "Use Bun for local scripts",
      type: "L1",
      priority: 6,
      sceneName: "runtime",
      timestampStr: "2026-05-18T08:00:00.000Z",
      sourceConversationIds: [1],
      metadata: { source: "pipeline", memoryKind: "instruction" },
      createdTime: "2026-05-18T08:00:00.000Z",
      updatedTime: "2026-05-18T08:00:00.000Z",
    },
    {
      recordId: "l1-2",
      userId: "u1",
      sessionKey: "chat:c1",
      sessionId: "c1",
      content: "Keep package commands on Bun",
      type: "L1",
      priority: 5,
      sceneName: "runtime",
      timestampStr: "2026-05-18T08:01:00.000Z",
      sourceConversationIds: [2],
      metadata: { source: "pipeline", memoryKind: "instruction" },
      createdTime: "2026-05-18T08:01:00.000Z",
      updatedTime: "2026-05-18T08:01:00.000Z",
    },
  ] as L1Record[]);

  expect(profiles).toHaveLength(1);
  expect(profiles[0]?.filename).toBe("scene-runtime.md");
  expect(profiles[0]?.content).toContain("Use Bun for local scripts");
  expect(profiles[0]?.content).toContain("Keep package commands on Bun");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/memory/l2-scenes.test.ts`
Expected: FAIL with `Cannot find module '../../src/memory/pipeline/l2-scenes'`.

- [ ] **Step 3: Write minimal implementation**

`src/memory/pipeline/l2-scenes.ts`

```ts
import { createHash } from "node:crypto";
import type { L1Record, ProfileSyncRecord } from "../core/store/types";

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "general";
}

function md5(content: string) {
  return createHash("md5").update(content).digest("hex");
}

export function buildSceneProfiles(userId: string, records: L1Record[]): ProfileSyncRecord[] {
  const grouped = new Map<string, L1Record[]>();

  for (const record of records) {
    const key = record.sceneName?.trim() || "general";
    grouped.set(key, [...(grouped.get(key) ?? []), record]);
  }

  const nowMs = Date.now();
  return [...grouped.entries()].map(([sceneName, sceneRecords]) => {
    const sceneSlug = slug(sceneName);
    const content = [
      `# Scene: ${sceneName}`,
      "",
      ...sceneRecords.map((record) => `- [${record.priority}] ${record.content}`),
    ].join("\n");

    return {
      id: `scene:${userId}:${sceneSlug}`,
      type: "l2",
      userId,
      filename: `scene-${sceneSlug}.md`,
      content,
      contentMd5: md5(content),
      version: 1,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      metadata: {
        sceneName,
        recordIds: sceneRecords.map((record) => record.recordId),
        atomIds: sceneRecords.flatMap((record) => record.sourceConversationIds),
      },
    };
  });
}
```

`src/memory/pipeline/l2.ts:16-87`

```ts
import type { L1Record } from "../core/store/types";
import { buildSceneProfiles } from "./l2-scenes";

if (store?.syncProfiles) {
  const l1Records = await store.queryL1Records({ userId, type: "L1", limit: 200 }) as L1Record[];
  const sceneProfiles = buildSceneProfiles(userId, l1Records);
  if (sceneProfiles.length > 0) {
    await store.syncProfiles(sceneProfiles);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/memory/l2-scenes.test.ts tests/memory/imemory-store-integration.test.ts`
Expected: PASS with one durable scene profile per scene name and existing integration tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/memory/pipeline/l2-scenes.ts src/memory/pipeline/l2.ts tests/memory/l2-scenes.test.ts
git commit -m "feat: build durable l2 scene profiles"
```

---

### Task 8 (Phase 3 / Workstream 3.2): Make L3 persona updates incremental from scene profiles

**Files:**
- Create: `src/memory/pipeline/l3-scenes.ts`
- Create: `tests/memory/l3-persona-incremental.test.ts`
- Modify: `src/memory/pipeline/l3.ts:11-64`
- Test: `tests/memory/l3-persona-incremental.test.ts`
- Test: `tests/memory/imemory-store-integration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { computeSceneFingerprint } from "../../src/memory/pipeline/l3-scenes";

test("computeSceneFingerprint is stable for the same set of scene files", () => {
  const first = computeSceneFingerprint([
    { filename: "scene-runtime.md", contentMd5: "a" },
    { filename: "scene-build.md", contentMd5: "b" },
  ]);
  const second = computeSceneFingerprint([
    { filename: "scene-build.md", contentMd5: "b" },
    { filename: "scene-runtime.md", contentMd5: "a" },
  ]);

  expect(first).toBe(second);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/memory/l3-persona-incremental.test.ts`
Expected: FAIL with `Cannot find module '../../src/memory/pipeline/l3-scenes'`.

- [ ] **Step 3: Write minimal implementation**

`src/memory/pipeline/l3-scenes.ts`

```ts
import { createHash } from "node:crypto";

export function computeSceneFingerprint(scenes: Array<{ filename: string; contentMd5: string }>) {
  const stable = scenes
    .map((scene) => `${scene.filename}\0${scene.contentMd5}`)
    .sort()
    .join("\n");

  return createHash("sha256").update(stable).digest("hex");
}
```

`src/memory/pipeline/l3.ts:11-64`

```ts
import { computeSceneFingerprint } from "./l3-scenes";

async function latestProfile(store: IMemoryStore, userId: string, type: "l2" | "l3") {
  const profiles = await store.pullProfiles?.();
  return (profiles ?? [])
    .filter((profile) => profile.userId === userId && profile.type === type)
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs)[0];
}

export async function runL3Pipeline(
  backend: MemoryBackend,
  llm: LlmProvider,
  userId: string,
  scenarioId: number,
  scenarioMarkdown: string,
  store?: IMemoryStore,
): Promise<boolean> {
  if (store?.pullProfiles && store.syncProfiles) {
    const profiles = await store.pullProfiles();
    const sceneProfiles = profiles.filter((profile) => profile.userId === userId && profile.type === "l2");
    const fingerprint = computeSceneFingerprint(
      sceneProfiles.map((profile) => ({ filename: profile.filename, contentMd5: profile.contentMd5 })),
    );
    const currentPersona = profiles
      .filter((profile) => profile.userId === userId && profile.type === "l3")
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs)[0];

    if (currentPersona?.metadata?.sceneFingerprint === fingerprint) {
      return false;
    }

    const response = await llm.complete({
      messages: [
        { role: "system", content: buildL3SystemPrompt() },
        { role: "user", content: sceneProfiles.map((profile) => `## ${profile.filename}\n${profile.content}`).join("\n\n") || `scenario_id=${scenarioId}\n${scenarioMarkdown}` },
      ],
      tools: [],
      meta: { origin: "memory.l3" },
    });

    await store.syncProfiles([{
      id: `legacy:l3:${userId}`,
      type: "l3",
      userId,
      filename: `persona-${userId}.md`,
      content: response.content,
      contentMd5: md5(response.content),
      version: 1,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      metadata: { sourceScenarioIds: [scenarioId], sceneFingerprint: fingerprint },
    }]);

    await backend.upsertPersona({ userId, markdown: response.content, sourceScenarioIds: [scenarioId] });
    return true;
  }

  // existing fallback path stays in place
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/memory/l3-persona-incremental.test.ts tests/memory/imemory-store-integration.test.ts`
Expected: PASS with deterministic scene fingerprinting and persona refreshes only when scene profiles change.

- [ ] **Step 5: Commit**

```bash
git add src/memory/pipeline/l3-scenes.ts src/memory/pipeline/l3.ts tests/memory/l3-persona-incremental.test.ts
git commit -m "feat: make l3 persona updates incremental"
```

---

### Task 9 (Phase 3 / Workstream 3.3): Extract offload runtime flushing and retry patch generation once

**Files:**
- Create: `src/memory/offload/runtime.ts`
- Create: `tests/memory/offload-runtime.test.ts`
- Modify: `src/memory/offload/service.ts:293-358`
- Test: `tests/memory/offload-runtime.test.ts`
- Test: `tests/memory/offload.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { flushPendingTaskEvidence } from "../../src/memory/offload/runtime";

test("flushPendingTaskEvidence retries patch generation once before falling back", async () => {
  let attempts = 0;
  const result = await flushPendingTaskEvidence({
    currentMmd: "flowchart TD\n",
    fallbackMmd: "flowchart TD\n  Fallback[\"Run test\"]\n",
    generatePatch: async () => {
      attempts += 1;
      if (attempts === 1) {
        return undefined;
      }
      return {
        fileAction: "write",
        mmdContent: "flowchart TD\n  N1[\"Run test\"]\n",
        replaceBlocks: [],
        nodeMapping: { ref_test: "N1" },
      };
    },
  });

  expect(attempts).toBe(2);
  expect(result.mode).toBe("patched");
  expect(result.canvas).toContain("N1");
  expect(result.nodeMapping).toEqual({ ref_test: "N1" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/memory/offload-runtime.test.ts`
Expected: FAIL with `Cannot find module '../../src/memory/offload/runtime'`.

- [ ] **Step 3: Write minimal implementation**

`src/memory/offload/runtime.ts`

```ts
import { applyL2Patch } from "./l2";

export async function flushPendingTaskEvidence(input: {
  currentMmd: string;
  fallbackMmd: string;
  generatePatch: () => Promise<{
    fileAction: "write" | "replace";
    mmdContent: string | null;
    replaceBlocks: Array<{ startLine: number; endLine: number; content: string }>;
    nodeMapping: Record<string, string>;
  } | undefined>;
}) {
  const firstPatch = await input.generatePatch();
  const secondPatch = firstPatch ?? await input.generatePatch();

  if (!secondPatch) {
    return { mode: "fallback" as const, canvas: input.fallbackMmd, nodeMapping: {} as Record<string, string> };
  }

  const canvas = secondPatch.fileAction === "write"
    ? secondPatch.mmdContent ?? input.currentMmd
    : applyL2Patch(input.currentMmd, secondPatch);

  return { mode: "patched" as const, canvas, nodeMapping: secondPatch.nodeMapping };
}
```

`src/memory/offload/service.ts:293-358`

```ts
import { flushPendingTaskEvidence } from "./runtime";

const fallbackMmd = `${this.buildTaskCanvas(chatId, await this.backend.listTaskGraphNodesForTask(taskId, 80))}\n`;
const flushed = await flushPendingTaskEvidence({
  currentMmd,
  fallbackMmd,
  generatePatch: async () => {
    if (!task) return undefined;
    return generateL2MermaidPatch(this.llm, {
      taskLabel: task.label,
      currentMmd,
      entries: pending.map((entry) => ({
        nodeId: entry.nodeId,
        toolName: entry.toolName,
        summary: entry.summary,
        score: entry.score,
        resultRef: entry.resultRef,
      })),
      maxCanvasChars: this.options.l2.maxCanvasChars,
    });
  },
});

await mkdir(dirname(canvasPath.absolutePath), { recursive: true });
await this.writeTextFile(canvasPath.absolutePath, flushed.canvas);
if (Object.keys(flushed.nodeMapping).length > 0) {
  await this.backend.updateL1EvidenceNodeMapping(taskId, flushed.nodeMapping);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/memory/offload-runtime.test.ts tests/memory/offload.test.ts`
Expected: PASS with the new retry/fallback behavior and existing offload tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/memory/offload/runtime.ts src/memory/offload/service.ts tests/memory/offload-runtime.test.ts
git commit -m "feat: harden offload runtime flushing"
```

---

### Task 10 (Phase 3 / Workstream 3.4): Add cleanup parity and final verification gates

**Files:**
- Create: `src/memory/pipeline/cleanup.ts`
- Create: `tests/memory/cleanup.test.ts`
- Modify: `src/config.ts:85-126,213-221`
- Modify: `src/memory/integration/app-config.ts`
- Modify: `src/memory/integration/factory.ts:12-63,131-155`
- Modify: `src/memory/core/service.ts:46-86`
- Modify: `src/memory/pipeline/coordinator.ts:11-18,65-177`
- Test: `tests/memory/cleanup.test.ts`
- Test: `tests/memory/pipeline.test.ts`
- Test: `tests/memory/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { computeRetentionCutoffIso } from "../../src/memory/pipeline/cleanup";

test("computeRetentionCutoffIso subtracts retention days from the current time", () => {
  expect(computeRetentionCutoffIso(30, new Date("2026-05-21T12:00:00.000Z"))).toBe(
    "2026-04-21T12:00:00.000Z",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/memory/cleanup.test.ts`
Expected: FAIL with `Cannot find module '../../src/memory/pipeline/cleanup'`.

- [ ] **Step 3: Write minimal implementation**

`src/memory/pipeline/cleanup.ts`

```ts
import type { IMemoryStore } from "../core/store/types";

export function computeRetentionCutoffIso(retentionDays: number, now = new Date()) {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  return cutoff.toISOString();
}

export async function pruneExpiredMemory(store: IMemoryStore | undefined, retentionDays: number) {
  if (!store || retentionDays <= 0) {
    return { l0Deleted: 0, l1Deleted: 0 };
  }

  const cutoffIso = computeRetentionCutoffIso(retentionDays);
  const [l0Deleted, l1Deleted] = await Promise.all([
    store.deleteL0Expired(cutoffIso),
    store.deleteL1Expired(cutoffIso),
  ]);

  return { l0Deleted, l1Deleted, cutoffIso };
}
```

`src/config.ts:85-126,213-221`

```ts
memory: {
  maintenanceCron: env(source, "MEMORY_MAINTENANCE_CRON", "*/10 * * * *"),
  retentionDays: intEnv(source, "MEMORY_RETENTION_DAYS", 30),
  recallMaxResults: intEnv(source, "MEMORY_RECALL_MAX_RESULTS", 5),
  // existing fields stay in place
}
```

```ts
memory: {
  maintenanceCron: config.memory.maintenanceCron,
  retentionDays: config.memory.retentionDays,
  sqliteVecEnabled: config.memory.sqliteVecEnabled,
  jsonlExportEnabled: config.memory.jsonlExportEnabled,
  l15: config.memory.l15,
  l1: config.memory.l1,
  l2: config.memory.l2,
  taskRecall: config.memory.taskRecall,
  l4: config.memory.l4,
},
```

`src/memory/core/service.ts:46-86`

```ts
retentionDays: number;
```

`src/memory/integration/app-config.ts`

```ts
retentionDays: runtime.memory.retentionDays,
```

`src/memory/integration/factory.ts:12-63,131-155`

```ts
type MemoryServiceFactoryConfig = {
  // existing storage fields
  memory: {
    maintenanceCron: string;
    retentionDays: number;
    offloadEnabled: boolean;
    offloadMinChars: number;
    offloadSummaryChars: number;
    sqliteVecEnabled: boolean;
    jsonlExportEnabled: boolean;
    // existing l15/l1/l2/taskRecall/l4 fields
  };
};

const pipelineCoordinator = new PipelineCoordinator(
  backend,
  llm,
  trace,
  store,
  config.memory.retentionDays,
);

return new MemoryService(
  backend,
  llm,
  {
    dataDir: config.storage.dataDir,
    backendName: "sqlite",
    backendOwner: "project-owned memory backend",
    maintenanceCron: config.memory.maintenanceCron,
    retentionDays: config.memory.retentionDays,
    offloadEnabled: config.memory.offloadEnabled,
    l15: config.memory.l15 ?? defaultL15,
    l1,
    l2,
    taskRecall,
    l4: config.memory.l4 ?? defaultL4,
    generatedSkillsDir,
  },
  recallService,
  offloadService,
  pipelineCoordinator,
  interactionLogService,
  store,
  trace,
);
```

`src/memory/pipeline/coordinator.ts:11-18,65-177`

```ts
import { pruneExpiredMemory } from "./cleanup";

export class PipelineCoordinator {
  constructor(
    private readonly backend: MemoryBackend,
    private readonly llm: LlmProvider,
    traceOrStore?: RuntimeTraceEmitter | IMemoryStore,
    store?: IMemoryStore,
    private readonly retentionDays = 30,
  ) {
    // existing constructor branching stays in place
  }
}
```

```ts
const cleanup = await pruneExpiredMemory(this.store, this.retentionDays);
this.emitStage(userId, "l3", "complete", {
  source,
  scenarioId: l2Result.scenarioId,
  personaUpdated,
  l0Deleted: cleanup.l0Deleted,
  l1Deleted: cleanup.l1Deleted,
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/memory/cleanup.test.ts tests/memory/pipeline.test.ts tests/memory/config.test.ts`
Expected: PASS with cleanup math verified, config carrying retention days, and pipeline tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/memory/integration/app-config.ts src/memory/core/service.ts src/memory/pipeline/cleanup.ts src/memory/pipeline/coordinator.ts tests/memory/cleanup.test.ts
git commit -m "feat: add memory cleanup parity and verification gates"
```

---

## Final verification sweep

After Phase 3 / Task 10, run the full focused memory verification set before claiming the port complete.

- [ ] Run: `bun test tests/memory`
- [ ] Run: `bun test tests/cron/scheduler.test.ts tests/services/memory-update-settings.test.ts`
- [ ] Run: `bun test tests/runtime/agent-prompt.test.ts tests/agent/traced-provider.test.ts`
- [ ] Run: `bunx tsc --noEmit`
- [ ] Run: `bun scripts/inspect-memory.ts`

Expected:
- all memory, runtime, cron, and service tests pass
- typecheck passes with no errors
- inspect script prints current status without crashing

