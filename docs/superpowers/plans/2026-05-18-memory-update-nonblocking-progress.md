# Memory Update Non-Blocking Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Telegram Memory Update `Run now` non-blocking, add per-stage L1/L2/L3 progress messages, and add structured logs for manual and scheduled memory update runs.

**Architecture:** Add a small internal progress event interface used by the memory pipeline, runner, scheduler, and Telegram manual-run path. Telegram `Run now` starts a guarded background task and returns quickly, while scheduler runs keep their existing awaited dispatcher semantics. Progress events drive stable console logs and, for manual runs, separate Telegram messages.

**Tech Stack:** Bun, TypeScript, grammY, `@grammyjs/conversations`, node-cron, SQLite, Bun test runner.

---

## File structure

- Create `src/memory/pipeline/progress.ts`
  - Owns `MemoryUpdateProgressEvent`, source/stage/status types, reporter type, and a safe emit helper.
- Modify `src/memory/pipeline/coordinator.ts`
  - Emits L1/L2/L3 start, complete, and skip events while preserving existing return shape.
- Modify `src/memory/core/service.ts`
  - Threads progress options from `MemoryService.runMaintenanceForUser` into `PipelineCoordinator`.
- Modify `src/cron/autonomous.ts`
  - Adds runner-level lifecycle logs and passes source/progress options to memory maintenance.
- Create `src/bot/conversations/memory-update-runner.ts`
  - Starts manual Telegram Memory Update in the background, formats progress/final/error messages, and prevents duplicate active runs per user.
- Modify `src/bot/conversations/memory-update.ts`
  - Exports callback constants and uses the background runner for conversation `Run now` clicks.
- Modify `src/bot/bot.ts`
  - Adds a top-level fallback handler for stale `memory-update:run-now` callback queries.
- Modify `tests/memory/pipeline.test.ts`
  - Adds progress event regression tests.
- Modify `tests/cron/autonomous-helpers.test.ts`
  - Adds runner progress/source/error tests.
- Create `tests/bot/memory-update-runner.test.ts`
  - Adds non-blocking background and duplicate-run guard tests.

---

### Task 1: Add pipeline progress events

**Files:**
- Create: `src/memory/pipeline/progress.ts`
- Modify: `src/memory/pipeline/coordinator.ts:1-65`
- Modify: `src/memory/core/service.ts:9,266-269`
- Test: `tests/memory/pipeline.test.ts`

- [ ] **Step 1: Write the failing pipeline progress tests**

Append these tests to `tests/memory/pipeline.test.ts` after the existing `pipeline produces atoms, scenarios, persona, and lineage links` test:

```ts
test("pipeline emits progress events for L1, L2, and L3", async () => {
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
    const pipeline = new PipelineCoordinator(backend, fakeLlm);
    const events: string[] = [];

    await logs.logUserMessage({ chatId: "c1", userId: "u1", content: "Please use Bun for this bot.", mode: "chat" });
    const result = await pipeline.runMaintenanceForUser("u1", true, {
      source: "telegram",
      onProgress: async (event) => {
        events.push(`${event.stage}:${event.status}`);
      },
    });

    expect(result).toEqual({ l1Created: 1, l2ScenarioId: 1, personaUpdated: true });
    expect(events).toEqual([
      "l1:start",
      "l1:complete",
      "l2:start",
      "l2:complete",
      "l3:start",
      "l3:complete",
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("pipeline emits skip events when force maintenance has no atoms to aggregate", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-pipeline-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });
    const pipeline = new PipelineCoordinator(backend, fakeLlm);
    const events: string[] = [];

    const result = await pipeline.runMaintenanceForUser("u1", true, {
      source: "scheduler",
      onProgress: async (event) => {
        events.push(`${event.stage}:${event.status}:${event.reason ?? ""}`);
      },
    });

    expect(result).toEqual({ l1Created: 0, l2ScenarioId: undefined, personaUpdated: false });
    expect(events).toEqual([
      "l1:start:",
      "l1:complete:",
      "l2:skip:no_atoms",
      "l3:skip:no_scenario",
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:

```bash
bun test tests/memory/pipeline.test.ts --test-name-pattern "progress events"
bun test tests/memory/pipeline.test.ts --test-name-pattern "skip events"
```

Expected: both fail because `runMaintenanceForUser` does not accept progress options and no events are emitted.

- [ ] **Step 3: Create the progress event module**

Create `src/memory/pipeline/progress.ts` with this content:

```ts
export type MemoryUpdateSource = "telegram" | "scheduler";
export type MemoryUpdateStage = "run" | "l1" | "l2" | "l3";
export type MemoryUpdateProgressStatus = "start" | "complete" | "skip" | "error";

export type MemoryUpdateProgressEvent = {
  source: MemoryUpdateSource;
  userId: string;
  stage: MemoryUpdateStage;
  status: MemoryUpdateProgressStatus;
  startedAtUnix?: number;
  finishedAtUnix?: number;
  durationMs?: number;
  pendingTurns?: number;
  createdAtoms?: number;
  checkpointAdvanced?: boolean;
  atomCount?: number;
  scenarioId?: number;
  personaUpdated?: boolean;
  reason?: string;
  error?: string;
};

export type MemoryUpdateProgressReporter = (event: MemoryUpdateProgressEvent) => void | Promise<void>;

export type MemoryUpdateProgressOptions = {
  source?: MemoryUpdateSource;
  onProgress?: MemoryUpdateProgressReporter;
};

export async function emitMemoryUpdateProgress(
  reporter: MemoryUpdateProgressReporter | undefined,
  event: MemoryUpdateProgressEvent,
) {
  if (!reporter) return;
  await reporter(event);
}
```

- [ ] **Step 4: Update `PipelineCoordinator` to emit progress**

Modify imports at the top of `src/memory/pipeline/coordinator.ts`:

```ts
import type { LlmProvider } from "../../agent/types";
import type { MemoryBackend } from "../core/backend";
import { runL1Pipeline } from "./l1";
import { runL2Pipeline } from "./l2";
import { runL3Pipeline } from "./l3";
import { emitMemoryUpdateProgress, type MemoryUpdateProgressOptions } from "./progress";
```

Replace `runMaintenanceForUser` in `src/memory/pipeline/coordinator.ts` with this implementation:

```ts
  async runMaintenanceForUser(userId: string, force = false, options: MemoryUpdateProgressOptions = {}): Promise<PipelineMaintenanceResult> {
    const source = options.source ?? "scheduler";
    const lastCheckpoint = await this.backend.getCheckpoint(userId, L1_CHECKPOINT_KEY);
    const afterConversationId = typeof lastCheckpoint === "number"
      ? lastCheckpoint
      : Number.parseInt(String(lastCheckpoint ?? "0"), 10) || 0;

    const pendingTurns = await this.backend.listPendingConversationEvidence(userId, afterConversationId, DEFAULT_EVIDENCE_LIMIT);
    if (pendingTurns.length === 0 && !force) {
      await emitMemoryUpdateProgress(options.onProgress, {
        source,
        userId,
        stage: "l1",
        status: "skip",
        pendingTurns: 0,
        reason: "no_pending_turns",
      });
      await emitMemoryUpdateProgress(options.onProgress, {
        source,
        userId,
        stage: "l2",
        status: "skip",
        reason: "no_l1_work",
      });
      await emitMemoryUpdateProgress(options.onProgress, {
        source,
        userId,
        stage: "l3",
        status: "skip",
        reason: "no_scenario",
      });
      return { l1Created: 0, l2ScenarioId: undefined, personaUpdated: false };
    }

    await emitMemoryUpdateProgress(options.onProgress, {
      source,
      userId,
      stage: "l1",
      status: "start",
      pendingTurns: pendingTurns.length,
    });

    const l1Result = pendingTurns.length === 0
      ? { createdAtoms: 0, lastConversationId: afterConversationId, checkpointAdvanced: false }
      : await runL1Pipeline(this.backend, this.llm, userId, pendingTurns);

    if (l1Result.checkpointAdvanced) {
      await this.backend.setCheckpoint(userId, L1_CHECKPOINT_KEY, l1Result.lastConversationId);
    }

    await emitMemoryUpdateProgress(options.onProgress, {
      source,
      userId,
      stage: "l1",
      status: "complete",
      pendingTurns: pendingTurns.length,
      createdAtoms: l1Result.createdAtoms,
      checkpointAdvanced: l1Result.checkpointAdvanced,
    });

    if (!force && l1Result.createdAtoms === 0) {
      await emitMemoryUpdateProgress(options.onProgress, {
        source,
        userId,
        stage: "l2",
        status: "skip",
        reason: "no_new_atoms",
      });
      await emitMemoryUpdateProgress(options.onProgress, {
        source,
        userId,
        stage: "l3",
        status: "skip",
        reason: "no_scenario",
      });
      return { l1Created: 0, l2ScenarioId: undefined, personaUpdated: false };
    }

    const atoms = await this.backend.listMemoryAtoms(userId, DEFAULT_ATOM_LIMIT);
    if (atoms.length === 0) {
      await emitMemoryUpdateProgress(options.onProgress, {
        source,
        userId,
        stage: "l2",
        status: "skip",
        atomCount: 0,
        reason: "no_atoms",
      });
      await emitMemoryUpdateProgress(options.onProgress, {
        source,
        userId,
        stage: "l3",
        status: "skip",
        reason: "no_scenario",
      });
      return { l1Created: l1Result.createdAtoms, l2ScenarioId: undefined, personaUpdated: false };
    }

    await emitMemoryUpdateProgress(options.onProgress, {
      source,
      userId,
      stage: "l2",
      status: "start",
      atomCount: atoms.length,
    });
    const l2Result = await runL2Pipeline(this.backend, this.llm, userId, atoms);
    if (!l2Result) {
      await emitMemoryUpdateProgress(options.onProgress, {
        source,
        userId,
        stage: "l2",
        status: "skip",
        atomCount: atoms.length,
        reason: "no_scenario",
      });
      await emitMemoryUpdateProgress(options.onProgress, {
        source,
        userId,
        stage: "l3",
        status: "skip",
        reason: "no_scenario",
      });
      return { l1Created: l1Result.createdAtoms, l2ScenarioId: undefined, personaUpdated: false };
    }

    await emitMemoryUpdateProgress(options.onProgress, {
      source,
      userId,
      stage: "l2",
      status: "complete",
      atomCount: atoms.length,
      scenarioId: l2Result.scenarioId,
    });

    await emitMemoryUpdateProgress(options.onProgress, {
      source,
      userId,
      stage: "l3",
      status: "start",
      scenarioId: l2Result.scenarioId,
    });
    const personaUpdated = await runL3Pipeline(
      this.backend,
      this.llm,
      userId,
      l2Result.scenarioId,
      l2Result.bodyMarkdown,
    );
    await emitMemoryUpdateProgress(options.onProgress, {
      source,
      userId,
      stage: "l3",
      status: "complete",
      scenarioId: l2Result.scenarioId,
      personaUpdated,
    });

    return {
      l1Created: l1Result.createdAtoms,
      l2ScenarioId: l2Result.scenarioId,
      personaUpdated,
    };
  }
```

- [ ] **Step 5: Thread progress options through `MemoryService`**

Modify the import in `src/memory/core/service.ts`:

```ts
import { PipelineCoordinator, type PipelineMaintenanceResult } from "../pipeline/coordinator";
import type { MemoryUpdateProgressOptions } from "../pipeline/progress";
```

Replace `runMaintenanceForUser` in `src/memory/core/service.ts` with:

```ts
  async runMaintenanceForUser(userId: string, force = false, options: MemoryUpdateProgressOptions = {}): Promise<PipelineMaintenanceResult> {
    const { pipelineCoordinator } = getState(this);
    return pipelineCoordinator.runMaintenanceForUser(userId, force, options);
  }
```

- [ ] **Step 6: Run the targeted tests to verify they pass**

Run:

```bash
bun test tests/memory/pipeline.test.ts --test-name-pattern "progress events"
bun test tests/memory/pipeline.test.ts --test-name-pattern "skip events"
```

Expected: both pass.

- [ ] **Step 7: Run full memory pipeline tests**

Run:

```bash
bun test tests/memory/pipeline.test.ts
```

Expected: all tests in `tests/memory/pipeline.test.ts` pass.

- [ ] **Step 8: Commit if commits are explicitly authorized**

Only run this step if the user has explicitly authorized commits for this implementation session:

```bash
git add src/memory/pipeline/progress.ts src/memory/pipeline/coordinator.ts src/memory/core/service.ts tests/memory/pipeline.test.ts
git commit -m "feat: emit memory update pipeline progress"
```

Expected: commit succeeds and records the progress event foundation.

---

### Task 2: Add runner lifecycle logs and source-aware progress

**Files:**
- Modify: `src/cron/autonomous.ts:31-147`
- Test: `tests/cron/autonomous-helpers.test.ts`

- [ ] **Step 1: Write failing runner progress and error tests**

Append these tests to `tests/cron/autonomous-helpers.test.ts` after the existing `runOneMemoryUpdateNow runs maintenance and marks the settings as successful` test:

```ts
test("runOneMemoryUpdateNow forwards source and progress reporter to memory maintenance", async () => {
  const db = makeDb();
  const settings = new MemoryUpdateSettingsService(db);
  const setting = settings.getOrCreate("user-1");
  const progressEvents: string[] = [];
  const maintenanceCalls: Array<{ userId: string; force: boolean; source: string | undefined }> = [];

  const result = await runOneMemoryUpdateNow({
    memory: {
      runMaintenanceForUser: async (userId: string, force = false, options?: any) => {
        maintenanceCalls.push({ userId, force, source: options?.source });
        await options?.onProgress?.({ source: options.source, userId, stage: "l1", status: "complete", createdAtoms: 2 });
        return { l1Created: 2, l2ScenarioId: 18, personaUpdated: true };
      },
    } as any,
    settings,
    userId: setting.userId,
    source: "telegram",
    onProgress: async (event) => {
      progressEvents.push(`${event.source}:${event.stage}:${event.status}:${event.createdAtoms ?? ""}`);
    },
    nowUnix: 1_779_000_000,
    finishedUnix: 1_779_000_030,
  });

  expect(maintenanceCalls).toEqual([{ userId: "user-1", force: true, source: "telegram" }]);
  expect(progressEvents).toEqual(["telegram:l1:complete:2"]);
  expect(result.maintenanceResult).toEqual({ l1Created: 2, l2ScenarioId: 18, personaUpdated: true });
  expect(result.settings.lastStatus).toBe("success");
});

test("runOneMemoryUpdateNow marks settings as error and rethrows maintenance failures", async () => {
  const db = makeDb();
  const settings = new MemoryUpdateSettingsService(db);
  const setting = settings.getOrCreate("user-1");

  await expect(runOneMemoryUpdateNow({
    memory: {
      runMaintenanceForUser: async () => {
        throw new Error("LLM timeout");
      },
    } as any,
    settings,
    userId: setting.userId,
    source: "scheduler",
    nowUnix: 1_779_000_000,
    finishedUnix: 1_779_000_030,
  })).rejects.toThrow("LLM timeout");

  const refreshed = settings.getOrCreate("user-1");
  expect(refreshed.lastStatus).toBe("error");
  expect(refreshed.lastError).toBe("LLM timeout");
});
```

- [ ] **Step 2: Run targeted runner tests to verify they fail**

Run:

```bash
bun test tests/cron/autonomous-helpers.test.ts --test-name-pattern "runOneMemoryUpdateNow"
```

Expected: new tests fail because `source` and `onProgress` are not accepted or forwarded.

- [ ] **Step 3: Update `MemoryUpdateRunNowInput` and add structured logs**

Modify imports in `src/cron/autonomous.ts`:

```ts
import { emitMemoryUpdateProgress, type MemoryUpdateProgressReporter, type MemoryUpdateSource } from "../memory/pipeline/progress";
```

Replace `MemoryUpdateRunNowInput` with:

```ts
export type MemoryUpdateRunNowInput = {
  memory: MemoryService;
  settings: MemoryUpdateSettingsService;
  userId: string;
  source?: MemoryUpdateSource;
  onProgress?: MemoryUpdateProgressReporter;
  nowUnix?: number;
  finishedUnix?: number;
};
```

Add these helpers near `toErrorMessage` in `src/cron/autonomous.ts`:

```ts
function logMemoryUpdateEvent(event: string, details: Record<string, unknown>) {
  console.log(`[memory-update:${event}]`, details);
}

async function reportMemoryUpdateProgress(
  reporter: MemoryUpdateProgressReporter | undefined,
  event: Parameters<typeof emitMemoryUpdateProgress>[1],
) {
  logMemoryUpdateEvent(`${event.stage}-${event.status}`, event);
  await emitMemoryUpdateProgress(reporter, event);
}
```

- [ ] **Step 4: Replace `runOneMemoryUpdateNow` implementation**

Replace `runOneMemoryUpdateNow` in `src/cron/autonomous.ts` with:

```ts
export async function runOneMemoryUpdateNow(input: MemoryUpdateRunNowInput) {
  const source = input.source ?? "scheduler";
  const now = input.nowUnix ?? unixNow();
  const startedAtMs = Date.now();
  input.settings.markRunStarted(input.userId, now);

  await reportMemoryUpdateProgress(input.onProgress, {
    source,
    userId: input.userId,
    stage: "run",
    status: "start",
    startedAtUnix: now,
  });

  try {
    const maintenanceResult = await input.memory.runMaintenanceForUser(input.userId, true, {
      source,
      onProgress: (event) => reportMemoryUpdateProgress(input.onProgress, event),
    });
    const finishedAt = input.finishedUnix ?? unixNow();
    const finished = input.settings.markRunFinished(input.userId, finishedAt, "success", null);
    await reportMemoryUpdateProgress(input.onProgress, {
      source,
      userId: input.userId,
      stage: "run",
      status: "complete",
      startedAtUnix: now,
      finishedAtUnix: finishedAt,
      durationMs: Date.now() - startedAtMs,
      createdAtoms: maintenanceResult.l1Created,
      scenarioId: maintenanceResult.l2ScenarioId,
      personaUpdated: maintenanceResult.personaUpdated,
    });
    return { settings: finished, maintenanceResult };
  } catch (error) {
    const message = toErrorMessage(error);
    const finishedAt = input.finishedUnix ?? unixNow();
    input.settings.markRunFinished(input.userId, finishedAt, "error", message);
    await reportMemoryUpdateProgress(input.onProgress, {
      source,
      userId: input.userId,
      stage: "run",
      status: "error",
      startedAtUnix: now,
      finishedAtUnix: finishedAt,
      durationMs: Date.now() - startedAtMs,
      error: message,
    });
    throw error;
  }
}
```

- [ ] **Step 5: Run targeted runner tests**

Run:

```bash
bun test tests/cron/autonomous-helpers.test.ts --test-name-pattern "runOneMemoryUpdateNow"
```

Expected: all `runOneMemoryUpdateNow` tests pass.

- [ ] **Step 6: Run scheduler tests to check compatibility**

Run:

```bash
bun test tests/cron/scheduler.test.ts tests/cron/autonomous-helpers.test.ts
```

Expected: scheduler and autonomous helper tests pass.

- [ ] **Step 7: Commit if commits are explicitly authorized**

Only run this step if the user has explicitly authorized commits for this implementation session:

```bash
git add src/cron/autonomous.ts tests/cron/autonomous-helpers.test.ts
git commit -m "feat: log memory update run lifecycle"
```

Expected: commit succeeds and records runner lifecycle logging.

---

### Task 3: Add Telegram background runner helper

**Files:**
- Create: `src/bot/conversations/memory-update-runner.ts`
- Test: `tests/bot/memory-update-runner.test.ts`

- [ ] **Step 1: Write failing tests for non-blocking manual execution and duplicate guard**

Create `tests/bot/memory-update-runner.test.ts` with this content:

```ts
import { expect, test } from "bun:test";
import {
  formatMemoryUpdateFinalMessage,
  formatMemoryUpdateProgressMessage,
  resetActiveMemoryUpdateRunsForTest,
  startTelegramMemoryUpdateRun,
} from "../../src/bot/conversations/memory-update-runner";

test("formatMemoryUpdateProgressMessage renders stage messages", () => {
  expect(formatMemoryUpdateProgressMessage({ source: "telegram", userId: "u1", stage: "l1", status: "start" })).toBe("L1 dimulai...");
  expect(formatMemoryUpdateProgressMessage({ source: "telegram", userId: "u1", stage: "l1", status: "complete", createdAtoms: 3 })).toBe("L1 selesai: 3 atom dibuat.");
  expect(formatMemoryUpdateProgressMessage({ source: "telegram", userId: "u1", stage: "l2", status: "complete", scenarioId: 9 })).toBe("L2 selesai: scenario #9.");
  expect(formatMemoryUpdateProgressMessage({ source: "telegram", userId: "u1", stage: "l3", status: "complete", personaUpdated: true })).toBe("L3 selesai: persona updated.");
  expect(formatMemoryUpdateProgressMessage({ source: "telegram", userId: "u1", stage: "l2", status: "skip", reason: "no_atoms" })).toBe("L2 dilewati: tidak ada atom.");
});

test("formatMemoryUpdateFinalMessage summarizes L1, L2, and L3", () => {
  expect(formatMemoryUpdateFinalMessage({ l1Created: 2, l2ScenarioId: 7, personaUpdated: true })).toBe("Memory update selesai. L1=2 atom, L2=scenario #7, L3=updated.");
  expect(formatMemoryUpdateFinalMessage({ l1Created: 0, l2ScenarioId: undefined, personaUpdated: false })).toBe("Memory update selesai. L1=0 atom, L2=dilewati, L3=dilewati.");
});

test("startTelegramMemoryUpdateRun starts background work without waiting for pipeline completion", async () => {
  resetActiveMemoryUpdateRunsForTest();
  const sent: string[] = [];
  let resolveRun!: () => void;
  let runStarted = false;
  const runPromise = new Promise<{ maintenanceResult: { l1Created: number; l2ScenarioId?: number; personaUpdated: boolean } }>((resolve) => {
    resolveRun = () => resolve({ maintenanceResult: { l1Created: 1, l2ScenarioId: 4, personaUpdated: true } });
  });

  const result = await startTelegramMemoryUpdateRun({
    memory: {} as any,
    settings: {} as any,
    userId: "u1",
    sendMessage: async (text) => {
      sent.push(text);
    },
    runNow: async (input) => {
      runStarted = true;
      await input.onProgress?.({ source: "telegram", userId: "u1", stage: "l1", status: "start" });
      return runPromise as any;
    },
  });

  expect(result.status).toBe("started");
  expect(runStarted).toBe(true);
  expect(sent).toEqual(["Memory update dimulai...", "L1 dimulai..."]);

  resolveRun();
  if (result.status === "started") {
    await result.completion;
  }

  expect(sent).toContain("Memory update selesai. L1=1 atom, L2=scenario #4, L3=updated.");
});

test("startTelegramMemoryUpdateRun prevents duplicate active runs for the same user", async () => {
  resetActiveMemoryUpdateRunsForTest();
  const sent: string[] = [];
  let resolveRun!: () => void;
  const runPromise = new Promise<{ maintenanceResult: { l1Created: number; l2ScenarioId?: number; personaUpdated: boolean } }>((resolve) => {
    resolveRun = () => resolve({ maintenanceResult: { l1Created: 0, l2ScenarioId: undefined, personaUpdated: false } });
  });

  const first = await startTelegramMemoryUpdateRun({
    memory: {} as any,
    settings: {} as any,
    userId: "u1",
    sendMessage: async (text) => {
      sent.push(text);
    },
    runNow: async () => runPromise as any,
  });
  const second = await startTelegramMemoryUpdateRun({
    memory: {} as any,
    settings: {} as any,
    userId: "u1",
    sendMessage: async (text) => {
      sent.push(text);
    },
    runNow: async () => {
      throw new Error("second run should not start");
    },
  });

  expect(first.status).toBe("started");
  expect(second.status).toBe("already-running");
  expect(sent).toEqual(["Memory update dimulai..."]);

  resolveRun();
  if (first.status === "started") {
    await first.completion;
  }
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
bun test tests/bot/memory-update-runner.test.ts
```

Expected: FAIL because `src/bot/conversations/memory-update-runner.ts` does not exist.

- [ ] **Step 3: Implement the background runner helper**

Create `src/bot/conversations/memory-update-runner.ts` with this content:

```ts
import type { MemoryService } from "../../memory/core/service";
import { runOneMemoryUpdateNow } from "../../cron/autonomous";
import type { MemoryUpdateSettingsService } from "../../services/memory-update-settings";
import type { MemoryUpdateProgressEvent } from "../../memory/pipeline/progress";

export type TelegramMemoryUpdateRunInput = {
  memory: MemoryService;
  settings: MemoryUpdateSettingsService;
  userId: string;
  sendMessage: (text: string) => Promise<unknown>;
  runNow?: typeof runOneMemoryUpdateNow;
};

export type TelegramMemoryUpdateRunStartResult =
  | { status: "started"; completion: Promise<void> }
  | { status: "already-running" };

const activeMemoryUpdateUsers = new Set<string>();

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function resetActiveMemoryUpdateRunsForTest() {
  activeMemoryUpdateUsers.clear();
}

export function formatMemoryUpdateProgressMessage(event: MemoryUpdateProgressEvent) {
  if (event.stage === "run") return null;

  if (event.stage === "l1" && event.status === "start") return "L1 dimulai...";
  if (event.stage === "l1" && event.status === "complete") return `L1 selesai: ${event.createdAtoms ?? 0} atom dibuat.`;
  if (event.stage === "l1" && event.status === "skip") return "L1 dilewati: tidak ada percakapan baru.";

  if (event.stage === "l2" && event.status === "start") return "L2 dimulai...";
  if (event.stage === "l2" && event.status === "complete") return `L2 selesai: scenario #${event.scenarioId}.`;
  if (event.stage === "l2" && event.status === "skip") return event.reason === "no_atoms" ? "L2 dilewati: tidak ada atom." : "L2 dilewati.";

  if (event.stage === "l3" && event.status === "start") return "L3 dimulai...";
  if (event.stage === "l3" && event.status === "complete") return `L3 selesai: persona ${event.personaUpdated ? "updated" : "tidak berubah"}.`;
  if (event.stage === "l3" && event.status === "skip") return "L3 dilewati.";

  if (event.status === "error") return `Memory update gagal di ${event.stage.toUpperCase()}: ${event.error ?? "unknown error"}`;
  return null;
}

export function formatMemoryUpdateFinalMessage(result: { l1Created: number; l2ScenarioId?: number; personaUpdated: boolean }) {
  return [
    "Memory update selesai.",
    `L1=${result.l1Created} atom,`,
    `L2=${result.l2ScenarioId ? `scenario #${result.l2ScenarioId}` : "dilewati"},`,
    `L3=${result.personaUpdated ? "updated" : "dilewati"}.`,
  ].join(" ");
}

export async function startTelegramMemoryUpdateRun(input: TelegramMemoryUpdateRunInput): Promise<TelegramMemoryUpdateRunStartResult> {
  if (activeMemoryUpdateUsers.has(input.userId)) {
    console.log("[memory-update:run-skip]", {
      source: "telegram",
      userId: input.userId,
      reason: "already_running",
    });
    return { status: "already-running" };
  }

  activeMemoryUpdateUsers.add(input.userId);
  await input.sendMessage("Memory update dimulai...");

  const runNow = input.runNow ?? runOneMemoryUpdateNow;
  const completion = (async () => {
    try {
      const result = await runNow({
        memory: input.memory,
        settings: input.settings,
        userId: input.userId,
        source: "telegram",
        onProgress: async (event) => {
          const message = formatMemoryUpdateProgressMessage(event);
          if (message) await input.sendMessage(message);
        },
      });
      await input.sendMessage(formatMemoryUpdateFinalMessage(result.maintenanceResult));
    } catch (error) {
      await input.sendMessage(`Memory update gagal: ${toErrorMessage(error)}`);
    } finally {
      activeMemoryUpdateUsers.delete(input.userId);
    }
  })();

  completion.catch((error) => {
    console.error("Telegram memory update background task failed", error);
  });

  return { status: "started", completion };
}
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run:

```bash
bun test tests/bot/memory-update-runner.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit if commits are explicitly authorized**

Only run this step if the user has explicitly authorized commits for this implementation session:

```bash
git add src/bot/conversations/memory-update-runner.ts tests/bot/memory-update-runner.test.ts
git commit -m "feat: add telegram memory update background runner"
```

Expected: commit succeeds and records the background helper.

---

### Task 4: Wire Telegram conversation and stale callback fallback

**Files:**
- Modify: `src/bot/conversations/memory-update.ts:16-21,151-158`
- Modify: `src/bot/bot.ts:14,158-162`
- Test: `tests/bot/memory-update-runner.test.ts`

- [ ] **Step 1: Add a direct fallback test for already-running messaging behavior**

Append this test to `tests/bot/memory-update-runner.test.ts`:

```ts
test("startTelegramMemoryUpdateRun allows a new run after the previous completion settles", async () => {
  resetActiveMemoryUpdateRunsForTest();
  const sent: string[] = [];

  const first = await startTelegramMemoryUpdateRun({
    memory: {} as any,
    settings: {} as any,
    userId: "u1",
    sendMessage: async (text) => {
      sent.push(text);
    },
    runNow: async () => ({ maintenanceResult: { l1Created: 0, l2ScenarioId: undefined, personaUpdated: false } }) as any,
  });
  if (first.status === "started") await first.completion;

  const second = await startTelegramMemoryUpdateRun({
    memory: {} as any,
    settings: {} as any,
    userId: "u1",
    sendMessage: async (text) => {
      sent.push(text);
    },
    runNow: async () => ({ maintenanceResult: { l1Created: 1, l2ScenarioId: 2, personaUpdated: true } }) as any,
  });
  if (second.status === "started") await second.completion;

  expect(first.status).toBe("started");
  expect(second.status).toBe("started");
  expect(sent).toContain("Memory update selesai. L1=0 atom, L2=dilewati, L3=dilewati.");
  expect(sent).toContain("Memory update selesai. L1=1 atom, L2=scenario #2, L3=updated.");
});
```

- [ ] **Step 2: Run the helper tests**

Run:

```bash
bun test tests/bot/memory-update-runner.test.ts
```

Expected: tests pass before wiring, proving the helper behavior is stable.

- [ ] **Step 3: Export `memoryUpdateCallbacks` and use the background runner in the conversation**

In `src/bot/conversations/memory-update.ts`, add this import:

```ts
import { startTelegramMemoryUpdateRun } from "./memory-update-runner";
```

Change the callback constant from:

```ts
const memoryUpdateCallbacks = {
```

to:

```ts
export const memoryUpdateCallbacks = {
```

Replace the `memoryUpdateCallbacks.runNow` case with:

```ts
        case memoryUpdateCallbacks.runNow: {
          const chatId = String(action.chat?.id ?? ctx.chat?.id ?? "");
          const result = await startTelegramMemoryUpdateRun({
            memory: deps.memory,
            settings: deps.settings,
            userId,
            sendMessage: (text) => action.api.sendMessage(chatId, text),
          });
          note = result.status === "started"
            ? "Run now dimulai. Progress dikirim sebagai pesan baru."
            : "Memory update masih berjalan untuk user ini.";
          await render(action);
          break;
        }
```

- [ ] **Step 4: Add top-level fallback handler for stale `Run now` buttons**

In `src/bot/bot.ts`, change the memory update import to:

```ts
import { createMemoryUpdateConversation, memoryUpdateCallbacks, memoryUpdateConversationId } from "./conversations/memory-update";
```

Add this import:

```ts
import { startTelegramMemoryUpdateRun } from "./conversations/memory-update-runner";
```

Add this handler after the existing `bot.callbackQuery(uiCallbacks.memoryUpdate, ...)` block:

```ts
  bot.callbackQuery(memoryUpdateCallbacks.runNow, async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = resolveChatId(ctx);
    const userId = resolveUserId(ctx);
    const result = await startTelegramMemoryUpdateRun({
      memory: deps.memory,
      settings: deps.memoryUpdateSettings,
      userId,
      sendMessage: (text) => ctx.api.sendMessage(chatId, text),
    });
    if (result.status === "already-running") {
      await ctx.reply("Memory update masih berjalan untuk user ini.");
    }
  });
```

- [ ] **Step 5: Run bot and typecheck checks**

Run:

```bash
bun test tests/bot/memory-update-runner.test.ts tests/bot/ui.test.ts
bun run typecheck
```

Expected: bot tests pass and typecheck passes.

- [ ] **Step 6: Commit if commits are explicitly authorized**

Only run this step if the user has explicitly authorized commits for this implementation session:

```bash
git add src/bot/conversations/memory-update.ts src/bot/bot.ts tests/bot/memory-update-runner.test.ts
git commit -m "fix: run telegram memory updates in background"
```

Expected: commit succeeds and records Telegram wiring.

---

### Task 5: Verify full behavior and documentation consistency

**Files:**
- Modify: `README.md:43-58` if the current copy no longer describes the behavior precisely
- Modify: `docs/memory.md:18-31` if the current copy no longer describes progress/status precisely

- [ ] **Step 1: Run all focused tests**

Run:

```bash
bun test tests/memory/pipeline.test.ts tests/cron/autonomous-helpers.test.ts tests/cron/scheduler.test.ts tests/bot/memory-update-runner.test.ts tests/bot/ui.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run full test suite**

Run:

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 3: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: typecheck passes with no TypeScript errors.

- [ ] **Step 4: Update docs only if the behavior is not already documented**

If `README.md:49-55` and `docs/memory.md:24-30` already describe run-now, status, last result, and last error accurately, do not edit them.

If they need clarification, replace the Memory Update bullet list in `README.md` with:

```md
Memory Update can be used to:

- run memory maintenance now without blocking the Telegram conversation flow
- receive progress messages while L1, L2, and L3 complete
- enable or disable automatic updates
- choose a preset cadence
- enter a custom cron schedule when needed
- inspect status, last run, last result, and last error
```

If `docs/memory.md` needs the same clarification, replace its Memory Update bullet list with:

```md
It is accessed from the Telegram menu and can:

- run memory maintenance now without blocking the Telegram conversation flow
- send progress messages while L1, L2, and L3 complete
- enable or disable automatic updates
- choose a preset cadence
- accept a custom cron schedule when needed
- show status, last run, last result, and last error
```

- [ ] **Step 5: Inspect the final diff**

Run:

```bash
git diff -- src/memory/pipeline/progress.ts src/memory/pipeline/coordinator.ts src/memory/core/service.ts src/cron/autonomous.ts src/bot/conversations/memory-update-runner.ts src/bot/conversations/memory-update.ts src/bot/bot.ts tests/memory/pipeline.test.ts tests/cron/autonomous-helpers.test.ts tests/bot/memory-update-runner.test.ts README.md docs/memory.md
```

Expected: diff is limited to progress reporting, logging, non-blocking Telegram manual run, tests, and any necessary docs clarification.

- [ ] **Step 6: Manual runtime smoke test**

Run the bot locally:

```bash
bun run dev
```

Expected startup logs include runtime config, scheduler scheduling, and Telegram bot starting.

In Telegram:

1. Send `/menu`.
2. Open `Memory`.
3. Open `Memory Update`.
4. Press `Run now`.
5. Immediately send `/menu` again while the memory update is still running.

Expected Telegram behavior:

- The bot sends `Memory update dimulai...` quickly.
- The bot sends separate L1/L2/L3 progress messages as the run advances.
- `/menu` is handled without waiting for the full memory pipeline to finish.
- If `Run now` is pressed again before completion, the bot replies `Memory update masih berjalan untuk user ini.`

Expected console behavior:

- Logs include `[memory-update:run-start]`.
- Logs include L1/L2/L3 start, complete, or skip entries.
- Logs include `[memory-update:run-complete]` or `[memory-update:run-error]`.
- Existing `[cron:scheduler-tick]` logs continue to appear independently.

Stop the dev server with Ctrl+C after smoke testing.

- [ ] **Step 7: Commit if commits are explicitly authorized**

Only run this step if the user has explicitly authorized commits for this implementation session:

```bash
git add src/memory/pipeline/progress.ts src/memory/pipeline/coordinator.ts src/memory/core/service.ts src/cron/autonomous.ts src/bot/conversations/memory-update-runner.ts src/bot/conversations/memory-update.ts src/bot/bot.ts tests/memory/pipeline.test.ts tests/cron/autonomous-helpers.test.ts tests/bot/memory-update-runner.test.ts README.md docs/memory.md docs/superpowers/specs/2026-05-18-memory-update-nonblocking-progress-design.md docs/superpowers/plans/2026-05-18-memory-update-nonblocking-progress.md
git commit -m "fix: make telegram memory update non-blocking"
```

Expected: commit succeeds if commits were authorized.

---

## Self-review notes

- Spec coverage: Task 1 covers pipeline stage progress; Task 2 covers runner lifecycle logs and scheduler-compatible source handling; Task 3 covers background manual run and Telegram progress messages; Task 4 covers conversation wiring and stale callback fallback; Task 5 covers verification, docs, and manual smoke test.
- Placeholder scan: the plan does not use TBD/TODO placeholders and every code-changing step includes concrete code.
- Type consistency: `MemoryUpdateProgressOptions`, `MemoryUpdateProgressReporter`, `MemoryUpdateProgressEvent`, `source`, `onProgress`, `startTelegramMemoryUpdateRun`, and `memoryUpdateCallbacks` are named consistently across tasks.
