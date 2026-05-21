# Phase 2 Task-Memory Ownership and Scheduler Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the remaining Phase 2 bugs in task ownership, Memory summary draft counts, hybrid job retry semantics, recurring job defaults, schedule mode transitions, finish timestamps, and cron timezone handling.

**Architecture:** Keep the existing bot, memory, and scheduler layers in place and correct the smallest boundary that owns each bug. For task ownership, fix the task-routing decision in `MemoryService`; for the Memory summary count bug, fix the one back-navigation path that drops the field; for scheduler bugs, split the work between tool-facing defaults, persisted job state, runtime delivery state, and timezone-aware schedule calculation.

**Tech Stack:** TypeScript, Bun test runner, grammY conversations, Bun SQLite, project-owned memory services, cron-parser.

---

## Source references

- Approved roadmap spec: `docs/superpowers/specs/2026-05-21-bug-fix-roadmap-design.md`
- Live bug ledger to update in the same change: `docs/bugs/2026-05-21-verified-bug-audit.md`
- Task routing and completion handling: `src/memory/core/service.ts:566-602`
- Agent offload forwarding: `src/agent/react-agent.ts:223-231`
- Memory summary back-navigation path: `src/bot/conversations/memory-update.ts:156-174`
- Memory summary renderer fallback: `src/bot/ui/renderers.ts:5-24`, `src/bot/ui/renderers.ts:53-55`
- `tdai_create_job` tool contract: `src/tools/local.ts:166-239`
- Agent prompt wording for scheduling semantics: `src/agent/prompts/system.ts:33-40`
- Autonomous job state model and schedule edits: `src/services/autonomous-jobs.ts:5-126`, `src/services/autonomous-jobs.ts:131-240`, `src/services/autonomous-jobs.ts:305-320`
- Autonomous job runtime execution: `src/cron/autonomous.ts:81-90`, `src/cron/autonomous.ts:145-219`
- Cron schedule calculation: `src/services/schedules.ts:1-131`
- App timezone source: `src/config.ts:49-53`, `src/config.ts:139`
- Existing routing and offload tests to extend or mirror: `tests/memory/offload.test.ts:207-270`, `tests/memory/agent-runtime.test.ts:1-652`
- Existing Memory Update bot harness: `tests/bot/memory-update-callback.test.ts:1-240`
- Existing tool tests: `tests/memory/tools.test.ts:131-224`
- Existing autonomous job service tests: `tests/services/autonomous-jobs.test.ts:72-186`
- Existing autonomous runtime helper tests: `tests/cron/autonomous-helpers.test.ts:64-395`
- Existing schedule tests: `tests/services/schedules.test.ts:1-31`
- Existing prompt contract test: `tests/runtime/agent-prompt.test.ts:16-40`
- Autonomous job schema: `src/db/schema.ts:42-63`, `src/db/schema.ts:175-209`

## File structure

Create this file:

- `tests/memory/task-routing.test.ts` — focused regression for completion-turn task routing and follow-up tool-result attachment.

Modify these files:

- `src/memory/core/service.ts` — keep completion-turn task ids attached to task-scoped offload and task boundaries.
- `tests/bot/memory-update-callback.test.ts` — add a regression for the generated-draft count on the Memory Update back path.
- `src/bot/conversations/memory-update.ts` — include `generatedSkillCount` when rebuilding the Memory summary on back.
- `src/tools/local.ts` — change `tdai_create_job` defaults and user-visible output so recurring jobs are unlimited unless `max_runs` is explicit.
- `src/agent/prompts/system.ts` — update the prompt contract so it matches the new recurring default semantics.
- `tests/memory/tools.test.ts` — update `tdai_create_job` default/max-runs expectations.
- `tests/runtime/agent-prompt.test.ts` — lock the new prompt wording.
- `src/db/schema.ts` — add persisted state for one-shot hybrid fixed-text delivery.
- `src/services/autonomous-jobs.ts` — add `fixedTextSentAt`, clear stale run caps on recurring schedule edits, and expose the new persisted field.
- `src/cron/autonomous.ts` — resume one-shot hybrid jobs without resending fixed text and stamp `last_finished_at` at the true finish point.
- `tests/services/autonomous-jobs.test.ts` — cover direct service-level run-cap semantics.
- `tests/cron/autonomous-helpers.test.ts` — cover one-shot retry-without-duplicate-text plus actual-finish timestamp stamping.
- `src/services/schedules.ts` — use `config.app.timezone` when validating and computing cron schedules.
- `tests/services/schedules.test.ts` — cover timezone-aware next-run computation.
- `docs/bugs/2026-05-21-verified-bug-audit.md` — update status counts, executive summary, suggested fix order, and all seven Phase 2 bug entries in the same change.

Reference-only files:

- `src/agent/react-agent.ts` — keep the forwarder unchanged; once `MemoryService.judgeTaskTurn()` returns the right task id, the existing forward path is sufficient.
- `src/bot/ui/renderers.ts` — no logic change needed; its existing `generatedSkillCount ?? 0` fallback is correct once the back path supplies the field.

---

### Task 1: Keep completion-turn tool evidence attached to the completed task

**Files:**
- Create: `tests/memory/task-routing.test.ts`
- Modify: `src/memory/core/service.ts:566-602`
- Reference: `src/agent/react-agent.ts:223-231`

- [ ] **Step 1: Write the failing routing regression**

Create `tests/memory/task-routing.test.ts` with this exact content:

```ts
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { migrate } from "../../src/db/schema";
import { createMemoryService } from "../../src/memory/integration/factory";

test("completion turns keep task ownership for follow-up tool offload", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-task-routing-"));

  try {
    const db = new Database(":memory:");
    migrate(db);
    const llm = {
      async complete() {
        return { content: "", toolCalls: [] };
      },
    };
    const memory = await createMemoryService(db, llm as any, {
      storage: {
        dataDir: tempDir,
        memoryRefsDir: join(tempDir, "memory", "refs"),
        memoryCanvasDir: join(tempDir, "memory", "canvases"),
        memoryJsonlExportDir: join(tempDir, "memory", "jsonl"),
        historyDir: join(tempDir, "history"),
        memoryTaskCanvasDir: join(tempDir, "memory", "task-canvases"),
        memoryGeneratedSkillsDir: join(tempDir, "memory", "skills"),
      },
      memory: {
        maintenanceCron: "*/10 * * * *",
        offloadEnabled: true,
        offloadMinChars: 1000,
        offloadSummaryChars: 80,
        sqliteVecEnabled: true,
        jsonlExportEnabled: false,
        l15: { enabled: true, mode: "rules", recentMessages: 6, historyTaskLimit: 10, maxCanvasChars: 12000, safeFallback: "short" },
        l1: { enabled: true, mode: "local", maxSummaryChars: 900, defaultScore: 5 },
        l2: { enabled: false, mode: "local", triggerMinEntries: 1, maxCanvasChars: 12000 },
        taskRecall: { enabled: true, maxTasks: 3, maxCanvasChars: 2200 },
        l4: { enabled: true, mode: "local", requireCompletedTask: false, maxEvidenceEntries: 80, maxCanvasChars: 20000, maxSkillChars: 20000 },
      },
    });

    const createdAt = "2026-05-18T00:00:00.000Z";
    const insert = db.query(`
      INSERT INTO memory_task_canvases (chat_id, user_id, label, file_path, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("c1", "u1", "demo-task", "memory/task-canvases/c1/task-1.mmd", "active", createdAt, createdAt) as {
      lastInsertRowid: number | bigint;
    };
    const taskId = Number(insert.lastInsertRowid);

    const routing = await memory.judgeTaskTurn({
      chatId: "c1",
      userId: "u1",
      latestUserMessage: "sudah selesai, tests passing",
      sourceConversationId: 1,
    });

    expect(routing.judgment.taskCompleted).toBe(true);
    expect(routing.taskId).toBe(taskId);

    await memory.offloadToolResult({
      chatId: "c1",
      userId: "u1",
      taskId: routing.taskId,
      toolName: "bun_test",
      args: { file: "tests/app.test.ts" },
      rawResult: "All targeted tests passed.",
    });

    const boundaries = db.query(`SELECT result, task_id FROM memory_task_boundaries ORDER BY id ASC`).all() as Array<{
      result: string;
      task_id: number | null;
    }>;
    const nodes = db.query(`SELECT task_id, tool_name FROM memory_task_nodes ORDER BY id ASC`).all() as Array<{
      task_id: number | null;
      tool_name: string;
    }>;

    expect(boundaries).toEqual([{ result: "long", task_id: taskId }]);
    expect(nodes).toEqual([{ task_id: taskId, tool_name: "bun_test" }]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
bun test tests/memory/task-routing.test.ts
```

Expected: FAIL because `judgeTaskTurn()` currently returns `taskId: undefined` for completion turns and writes a short boundary with `task_id = NULL`.

- [ ] **Step 3: Implement completion-turn task scoping in `MemoryService`**

In `src/memory/core/service.ts`, replace the `insertTaskBoundary(...)` and return block inside `judgeTaskTurn()` with this exact code:

```ts
    const taskScopedTurn = Boolean(taskId && (judgment.isLongTask || judgment.isContinuation || judgment.taskCompleted));

    await backend.insertTaskBoundary({
      chatId: input.chatId,
      userId: input.userId,
      startNodeSequence: 0,
      result: taskScopedTurn ? "long" : "short",
      taskId: taskScopedTurn ? taskId : undefined,
    });

    return { judgment, taskId: taskScopedTurn ? taskId : undefined };
```

Do not change `runReactAgent()` in this task; once `judgeTaskTurn()` returns the correct `taskId`, the existing `memory.offloadToolResult(...)` forward path already attaches tool evidence correctly.

- [ ] **Step 4: Run the test again and confirm it passes**

Run:

```bash
bun test tests/memory/task-routing.test.ts
```

Expected: PASS. The returned `taskId`, task boundary row, and task node row should all stay attached to the completed task.

- [ ] **Step 5: Commit the task-routing fix**

Run:

```bash
git add tests/memory/task-routing.test.ts src/memory/core/service.ts
git commit -m "fix: keep completion-turn evidence on the active task"
```

---

### Task 2: Preserve generated draft count when returning from Memory Update

**Files:**
- Modify: `tests/bot/memory-update-callback.test.ts:20-65`
- Modify: `tests/bot/memory-update-callback.test.ts:173-240`
- Modify: `src/bot/conversations/memory-update.ts:156-174`
- Reference: `src/bot/ui/renderers.ts:53-55`

- [ ] **Step 1: Write the failing back-navigation regression**

In `tests/bot/memory-update-callback.test.ts`, extend `createMemoryUpdateDeps()` so the `memory` double includes `memoryStatus`, `recall`, and `countGeneratedSkills`, then add a helper and regression test after `pressMemoryUpdateRunNow()`.

Replace the `memory` object inside `createMemoryUpdateDeps()` with this exact block:

```ts
      memory: {
        runMaintenanceForUser: async (userId: string, force: boolean, options?: { source?: string; onProgress?: (event: any) => Promise<void> | void }) => {
          maintenanceCalls.push({ userId, force, source: options?.source });
          const result = await maintenance.promise;
          await options?.onProgress?.({ source: "telegram", userId, stage: "l1", status: "complete", createdAtoms: result.l1Created });
          return result;
        },
        memoryStatus: async () => "status",
        recall: async () => ({ persona: "Persona", atoms: [], scenarios: [], conversations: [], taskCanvas: null, taskCanvases: [] }),
        countGeneratedSkills: async () => 3,
      },
```

Then add this helper and test after `pressMemoryUpdateRunNow()`:

```ts
async function pressMemoryUpdateBack(bot: ReturnType<typeof createTelegramBot>) {
  await bot.handleUpdate({
    update_id: 5,
    callback_query: {
      id: "callback-back",
      from: { id: 42, is_bot: false, first_name: "User" },
      message: { message_id: 10, date: 1, chat: { id: 99, type: "private" } },
      chat_instance: "chat-instance",
      data: memoryUpdateCallbacks.back,
    },
  } as any);
}

test("memory update back rebuilds the summary with the generated draft count", async () => {
  const { bot, apiCalls } = createBotHarness();

  await enterMemoryUpdateConversation(bot);
  await pressMemoryUpdateBack(bot);

  expect(apiCalls).toContainEqual({
    method: "editMessageText",
    payload: expect.objectContaining({
      chat_id: 99,
      message_id: 10,
      text: expect.stringContaining("Generated drafts: 3"),
    }),
  });
});
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
bun test tests/bot/memory-update-callback.test.ts
```

Expected: FAIL because the current back path rebuilds the Memory summary without passing `generatedSkillCount`, so the screen still renders `Generated drafts: 0`.

- [ ] **Step 3: Pass `generatedSkillCount` through the back-navigation rebuild**

In `src/bot/conversations/memory-update.ts`, replace the `Promise.all([...])` and `buildRichMemorySummary(...)` block inside `memoryUpdateCallbacks.back` with this exact code:

```ts
            const [memoryStatus, recall, generatedSkillCount, freshSetting] = await Promise.all([
              deps.memory.memoryStatus(userId, chatId),
              deps.memory.recall(userId, "project preferences workflow coding", 5, chatId),
              deps.memory.countGeneratedSkills(userId),
              deps.settings.getOrCreate(userId),
            ]);
            return buildRichMemorySummary({
              memoryStatus,
              recall,
              memoryUpdateSummary: deps.settings.renderSummary(freshSetting),
              generatedSkillCount,
            });
```

- [ ] **Step 4: Run the test again and confirm it passes**

Run:

```bash
bun test tests/bot/memory-update-callback.test.ts
```

Expected: PASS. The rebuilt summary should keep `Generated drafts: 3` on the back path.

- [ ] **Step 5: Commit the Memory Update summary fix**

Run:

```bash
git add tests/bot/memory-update-callback.test.ts src/bot/conversations/memory-update.ts
git commit -m "fix: preserve draft count when leaving memory update"
```

---

### Task 3: Make recurring job defaults unlimited in the tool contract and prompt

**Files:**
- Modify: `tests/memory/tools.test.ts:131-224`
- Modify: `tests/runtime/agent-prompt.test.ts:27-39`
- Modify: `src/tools/local.ts:166-239`
- Modify: `src/agent/prompts/system.ts:37-40`

- [ ] **Step 1: Rewrite the tool-surface tests around recurring defaults**

In `tests/memory/tools.test.ts`, replace the three tests from `tdai_create_job creates one-shot hybrid jobs with default max_runs` through `tdai_create_job creates cron jobs` with this exact block:

```ts
test("tdai_create_job keeps one-shot hybrid jobs at max_runs=1 by default", async () => {
  const memory = createMemoryServiceDouble();
  const autonomousJobs = createAutonomousJobsDouble();
  const tools = createLocalTools(memory as any, undefined, autonomousJobs as any);
  const createJob = tools.find((tool) => tool.name === "tdai_create_job");

  expect(createJob).toBeDefined();

  const output = await createJob!.execute(
    {
      message_text: "Pengingat: minum air",
      agent_prompt: "Kirim respons singkat bahwa ini pengingat minum air.",
      schedule: { mode: "once", run_at: "2026-05-18T06:30:00.000Z" },
    },
    { chatId: "chat-1", userId: "user-1", memory: memory as any },
  );

  expect(output).toContain("Created job #9");
  expect(output).toContain("max_runs=1");
  expect(autonomousJobs.createJob).toHaveBeenCalledWith({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Kirim respons singkat bahwa ini pengingat minum air.",
    jobType: "hybrid",
    messageText: "Pengingat: minum air",
    agentPrompt: "Kirim respons singkat bahwa ini pengingat minum air.",
    schedule: {
      scheduleMode: "once",
      runAtUnix: 1779085800,
    },
    maxRuns: 1,
  });
});

test("tdai_create_job leaves interval jobs unlimited when max_runs is omitted", async () => {
  const memory = createMemoryServiceDouble();
  const autonomousJobs = createAutonomousJobsDouble();
  const tools = createLocalTools(memory as any, undefined, autonomousJobs as any);
  const createJob = tools.find((tool) => tool.name === "tdai_create_job");

  const output = await createJob!.execute(
    {
      message_text: "Pengingat: cek deploy",
      agent_prompt: "Berikan follow-up cek deploy.",
      schedule: { mode: "interval", interval_sec: 600 },
    },
    { chatId: "chat-1", userId: "user-1", memory: memory as any },
  );

  expect(output).toContain("max_runs=unlimited");
  expect(autonomousJobs.createJob).toHaveBeenCalledWith({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Berikan follow-up cek deploy.",
    jobType: "hybrid",
    messageText: "Pengingat: cek deploy",
    agentPrompt: "Berikan follow-up cek deploy.",
    schedule: {
      scheduleMode: "interval",
      intervalSec: 600,
    },
    maxRuns: null,
  });
});

test("tdai_create_job still accepts an explicit recurring max_runs override", async () => {
  const memory = createMemoryServiceDouble();
  const autonomousJobs = createAutonomousJobsDouble();
  const tools = createLocalTools(memory as any, undefined, autonomousJobs as any);
  const createJob = tools.find((tool) => tool.name === "tdai_create_job");

  await createJob!.execute(
    {
      message_text: "Pengingat: cek deploy",
      agent_prompt: "Berikan follow-up cek deploy.",
      schedule: { mode: "interval", interval_sec: 600 },
      max_runs: 3,
    },
    { chatId: "chat-1", userId: "user-1", memory: memory as any },
  );

  expect(autonomousJobs.createJob).toHaveBeenCalledWith({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Berikan follow-up cek deploy.",
    jobType: "hybrid",
    messageText: "Pengingat: cek deploy",
    agentPrompt: "Berikan follow-up cek deploy.",
    schedule: {
      scheduleMode: "interval",
      intervalSec: 600,
    },
    maxRuns: 3,
  });
});

test("tdai_create_job leaves cron jobs unlimited when max_runs is omitted", async () => {
  const memory = createMemoryServiceDouble();
  const autonomousJobs = createAutonomousJobsDouble();
  const tools = createLocalTools(memory as any, undefined, autonomousJobs as any);
  const createJob = tools.find((tool) => tool.name === "tdai_create_job");

  const output = await createJob!.execute(
    {
      message_text: "Pengingat: cek deploy",
      agent_prompt: "Berikan follow-up cek deploy.",
      schedule: { mode: "cron", cron_expr: "*/10 * * * *" },
    },
    { chatId: "chat-1", userId: "user-1", memory: memory as any },
  );

  expect(output).toContain("max_runs=unlimited");
  expect(autonomousJobs.createJob).toHaveBeenCalledWith({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Berikan follow-up cek deploy.",
    jobType: "hybrid",
    messageText: "Pengingat: cek deploy",
    agentPrompt: "Berikan follow-up cek deploy.",
    schedule: {
      scheduleMode: "cron",
      cronExpr: "*/10 * * * *",
    },
    maxRuns: null,
  });
});
```

In `tests/runtime/agent-prompt.test.ts`, replace the single `max_runs defaults to 1` assertion with these two assertions:

```ts
  expect(prompt).toContain("One-shot tdai_create_job jobs default max_runs to 1.");
  expect(prompt).toContain("Interval and cron tdai_create_job jobs are unlimited unless max_runs is set explicitly.");
```

- [ ] **Step 2: Run the targeted tests and verify they fail**

Run:

```bash
bun test tests/memory/tools.test.ts tests/runtime/agent-prompt.test.ts
```

Expected: FAIL because the tool still defaults recurring jobs to `maxRuns = 1` and the system prompt still says `max_runs defaults to 1` unconditionally.

- [ ] **Step 3: Implement the new recurring default semantics in the tool and prompt**

In `src/tools/local.ts`, replace the `tdai_create_job` block with this exact version:

```ts
    {
      name: "tdai_create_job",
      source: "local",
      description: "Create a hybrid scheduled Telegram job that sends fixed text first, then runs an agent prompt. One-shot jobs default max_runs to 1; interval and cron jobs are unlimited unless max_runs is provided.",
      inputSchema: {
        type: "object",
        properties: {
          message_text: { type: "string", description: "Fixed Telegram text sent first when the job is due." },
          agent_prompt: { type: "string", description: "Prompt run by the agent after message_text is sent." },
          schedule: {
            type: "object",
            properties: {
              mode: { type: "string", enum: ["once", "interval", "cron"] },
              run_at: { type: "string", description: "ISO datetime for one-shot jobs." },
              interval_sec: { type: "number", description: "Positive interval in seconds for interval jobs." },
              cron_expr: { type: "string", description: "Cron expression for cron jobs." },
            },
            required: ["mode"],
            additionalProperties: false,
          },
          max_runs: { type: "number", description: "Optional positive maximum execution count. One-shot defaults to 1; recurring schedules default to unlimited." },
        },
        required: ["message_text", "agent_prompt", "schedule"],
        additionalProperties: false,
      },
      async execute(args, ctx) {
        const jobs = ctx.autonomousJobs ?? autonomousJobs;
        if (!jobs) return "Job service unavailable.";

        const messageText = asString(args.message_text).trim();
        if (!messageText) return "message_text is required.";

        const agentPrompt = asString(args.agent_prompt).trim();
        if (!agentPrompt) return "agent_prompt is required.";

        const scheduleInput = asObject(args.schedule);
        const mode = asString(scheduleInput.mode).trim();
        let schedule;

        if (mode === "once") {
          const runAtUnix = parseRunAtUnix(scheduleInput.run_at);
          if (typeof runAtUnix === "string") return runAtUnix;
          schedule = { scheduleMode: "once" as const, runAtUnix };
        } else if (mode === "interval") {
          const intervalSec = asPositiveInteger(scheduleInput.interval_sec, 0, "schedule.interval_sec");
          if (typeof intervalSec === "string") return intervalSec;
          schedule = { scheduleMode: "interval" as const, intervalSec };
        } else if (mode === "cron") {
          const cronExpr = asString(scheduleInput.cron_expr).trim();
          if (!cronExpr) return "schedule.cron_expr is required for cron jobs.";
          try {
            schedule = { scheduleMode: "cron" as const, cronExpr: validateCronExpression(cronExpr) };
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        } else {
          return "schedule.mode must be one of: once, interval, cron.";
        }

        const explicitMaxRuns = args.max_runs === undefined ? null : asPositiveInteger(args.max_runs, 0, "max_runs");
        if (typeof explicitMaxRuns === "string") return explicitMaxRuns;
        const maxRuns = explicitMaxRuns ?? (schedule.scheduleMode === "once" ? 1 : null);

        const job = jobs.createJob({
          chatId: ctx.chatId,
          userId: ctx.userId,
          prompt: agentPrompt,
          jobType: "hybrid",
          messageText,
          agentPrompt,
          schedule,
          maxRuns,
        });

        return `Created job #${job.id}. Schedule: ${job.scheduleLabel}. max_runs=${maxRuns ?? "unlimited"}.`;
      },
    },
```

In `src/agent/prompts/system.ts`, replace the two scheduling bullets at the end of the `Tool-use rules:` section with this exact snippet:

```ts
- tdai_create_job jobs send fixed text first, then run the agent prompt when due.
- One-shot tdai_create_job jobs default max_runs to 1.
- Interval and cron tdai_create_job jobs are unlimited unless max_runs is set explicitly.
```

- [ ] **Step 4: Run the tests again and confirm they pass**

Run:

```bash
bun test tests/memory/tools.test.ts tests/runtime/agent-prompt.test.ts
```

Expected: PASS. One-shot jobs should still default to `1`, recurring jobs should be `unlimited` unless explicitly capped, and the prompt contract should match the new semantics.

- [ ] **Step 5: Commit the tool-contract and prompt updates**

Run:

```bash
git add tests/memory/tools.test.ts tests/runtime/agent-prompt.test.ts src/tools/local.ts src/agent/prompts/system.ts
git commit -m "fix: make recurring job defaults unlimited"
```

---

### Task 4: Repair persisted job-state semantics for schedule edits and one-shot retries

**Files:**
- Modify: `src/db/schema.ts:42-63`
- Modify: `src/db/schema.ts:175-209`
- Modify: `src/services/autonomous-jobs.ts:5-126`
- Modify: `src/services/autonomous-jobs.ts:131-240`
- Modify: `src/services/autonomous-jobs.ts:305-320`
- Modify: `src/cron/autonomous.ts:81-90`
- Modify: `src/cron/autonomous.ts:145-219`
- Modify: `tests/services/autonomous-jobs.test.ts:72-186`
- Modify: `tests/cron/autonomous-helpers.test.ts:15-395`

- [ ] **Step 1: Write the failing service/runtime regressions**

Append these two tests to `tests/services/autonomous-jobs.test.ts` after the existing `defaults one-shot jobs to a single successful run` test:

```ts
test("interval jobs created directly through the service default to unlimited runs", () => {
  const { service } = makeService();
  const job = service.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Recurring follow-up",
    schedule: { scheduleMode: "interval", intervalSec: 600 },
  });

  expect(job.maxRuns).toBeNull();
  expect(service.recordSuccessfulRun(job.id)).toEqual({
    deleted: false,
    job: expect.objectContaining({ id: job.id, runCount: 1, maxRuns: null }),
    runCount: 1,
  });
});

test("switching a one-shot job back to interval clears the stale one-run cap", () => {
  const { service } = makeService();
  const runAtUnix = Math.floor(Date.UTC(2026, 4, 18, 6, 30, 0) / 1000);
  const job = service.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Reminder follow-up",
    schedule: { scheduleMode: "interval", intervalSec: 600 },
  });

  service.updateSchedule(job.id, { scheduleMode: "once", runAtUnix });
  const updated = service.updateSchedule(job.id, { scheduleMode: "interval", intervalSec: 600 });

  expect(updated.maxRuns).toBeNull();
  expect(service.recordSuccessfulRun(job.id)).toEqual({
    deleted: false,
    job: expect.objectContaining({ id: job.id, runCount: 1, maxRuns: null }),
    runCount: 1,
  });
});
```

Then append these two tests to `tests/cron/autonomous-helpers.test.ts` after the existing `runOneAutonomousJob does not count or delete hybrid jobs when fixed text fails` test:

```ts
test("runOneAutonomousJob retries one-shot hybrid jobs without resending fixed text after delivery", async () => {
  const db = makeDb();
  const jobs = new AutonomousJobService(db);
  const runAtUnix = Math.floor(Date.UTC(2026, 4, 18, 6, 30, 0) / 1000);
  const job = jobs.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Kirim tindak lanjut singkat.",
    jobType: "hybrid",
    messageText: "Pengingat: minum air",
    agentPrompt: "Kirim tindak lanjut singkat.",
    schedule: { scheduleMode: "once", runAtUnix },
    maxRuns: 1,
  });

  const firstAttemptSent: string[] = [];
  await expect(runOneAutonomousJob({
    db,
    bot: {
      api: {
        sendMessage: async (_chatId: string, text: string) => {
          firstAttemptSent.push(text);
          if (text.includes("Agent follow-up")) throw new Error("telegram down");
        },
      },
    } as any,
    memory: {} as any,
    registry: {} as any,
    llm: {} as any,
    job,
    runAgent: async () => "Agent follow-up",
    nowUnix: runAtUnix,
    finishedUnix: runAtUnix + 30,
  })).rejects.toThrow("Failed to send autonomous job #1");

  const afterFailure = jobs.getJobById(job.id);
  expect(firstAttemptSent).toEqual([
    "Pengingat: minum air",
    expect.stringContaining("Autonomous job #1 failed"),
  ]);
  expect(afterFailure?.fixedTextSentAt).not.toBeNull();

  const retrySent: string[] = [];
  await runOneAutonomousJob({
    db,
    bot: {
      api: {
        sendMessage: async (_chatId: string, text: string) => {
          retrySent.push(text);
        },
      },
    } as any,
    memory: {} as any,
    registry: {} as any,
    llm: {} as any,
    job: afterFailure!,
    runAgent: async () => "Agent follow-up",
    nowUnix: runAtUnix + 60,
    finishedUnix: runAtUnix + 90,
  });

  expect(retrySent).toEqual([
    expect.stringContaining("Agent follow-up"),
  ]);
  expect(retrySent).not.toContain("Pengingat: minum air");
  expect(jobs.getJobById(job.id)).toBeNull();
});

test("runOneAutonomousJob stamps last_finished_at from the actual finish time when finishedUnix is omitted", async () => {
  const db = makeDb();
  const jobs = new AutonomousJobService(db);
  const job = jobs.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Check in with the team",
    schedule: { scheduleMode: "interval", intervalSec: 3600 },
  });

  const RealDate = Date;
  let currentMs = Date.UTC(2026, 4, 17, 11, 25, 0);
  class FakeDate extends RealDate {
    constructor(value?: string | number | Date) {
      super(value ?? currentMs);
    }
    static now() {
      return currentMs;
    }
  }
  (globalThis as { Date: DateConstructor }).Date = FakeDate as unknown as DateConstructor;

  try {
    await runOneAutonomousJob({
      db,
      bot: { api: { sendMessage: async () => ({}) } } as any,
      memory: {} as any,
      registry: {} as any,
      llm: {} as any,
      job,
      runAgent: async () => {
        currentMs = Date.UTC(2026, 4, 17, 11, 27, 0);
        return "Autonomous answer";
      },
      nowUnix: Math.floor(Date.UTC(2026, 4, 17, 11, 25, 0) / 1000),
    });
  } finally {
    (globalThis as { Date: DateConstructor }).Date = RealDate;
  }

  expect(jobs.getJobById(job.id)?.lastFinishedAt).toBe(Math.floor(Date.UTC(2026, 4, 17, 11, 27, 0) / 1000));
});
```

- [ ] **Step 2: Run the targeted tests and verify they fail**

Run:

```bash
bun test tests/services/autonomous-jobs.test.ts tests/cron/autonomous-helpers.test.ts
```

Expected: FAIL because recurring schedule edits still preserve stale one-shot caps, one-shot retries still resend fixed text after the first delivery, and `last_finished_at` is still captured at job start when `finishedUnix` is omitted.

- [ ] **Step 3: Add persisted one-shot delivery state and fix the scheduler runtime**

In `src/db/schema.ts`, update the `autonomous_jobs` table definition so it includes `fixed_text_sent_at INTEGER` immediately after `last_finished_at INTEGER`, and add this migration guard after the existing `last_finished_at` guard:

```ts
  if (!hasColumn(db, "autonomous_jobs", "fixed_text_sent_at")) {
    db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN fixed_text_sent_at INTEGER`);
  }
```

In `src/services/autonomous-jobs.ts`, make these exact structural changes:

1. Add `fixedTextSentAt: number | null;` to `AutonomousJobRow`.
2. Add `fixed_text_sent_at: number | null;` to `AutonomousJobDbRow`.
3. Add `fixed_text_sent_at` to `AUTONOMOUS_JOB_COLUMNS` immediately after `last_finished_at`.
4. In `mapRow(...)`, add:

```ts
    fixedTextSentAt: row.fixed_text_sent_at,
```

5. In `createJob(...)`, add `fixed_text_sent_at` to the INSERT column list and pass `null` for that value.
6. Replace `updateSchedule(...)` with this exact implementation:

```ts
  updateSchedule(id: number, scheduleInput: ScheduleInput): AutonomousJobRow {
    const schedule = normalizeSchedule(scheduleInput);
    if (schedule.scheduleMode === "once") {
      this.db
        .query(`UPDATE autonomous_jobs SET schedule_mode = ?, run_at_unix = ?, interval_sec = ?, cron_expr = ?, max_runs = COALESCE(max_runs, 1), fixed_text_sent_at = NULL, updated_at = ? WHERE id = ?`)
        .run(schedule.scheduleMode, schedule.runAtUnix, schedule.intervalSec, schedule.cronExpr, nowIso(), id);
    } else {
      this.db
        .query(`UPDATE autonomous_jobs SET schedule_mode = ?, run_at_unix = ?, interval_sec = ?, cron_expr = ?, max_runs = NULL, fixed_text_sent_at = NULL, updated_at = ? WHERE id = ?`)
        .run(schedule.scheduleMode, schedule.runAtUnix, schedule.intervalSec, schedule.cronExpr, nowIso(), id);
    }
    const job = this.getJobById(id);
    if (!job) throw new Error(`Autonomous job not found: ${id}`);
    return job;
  }
```

7. Add these two methods immediately after `markRunStarted(...)`:

```ts
  markFixedTextSent(id: number, nowUnix: number): AutonomousJobRow {
    this.db
      .query(`UPDATE autonomous_jobs SET fixed_text_sent_at = ?, updated_at = ? WHERE id = ?`)
      .run(nowUnix, nowIso(), id);
    const job = this.getJobById(id);
    if (!job) throw new Error(`Autonomous job not found: ${id}`);
    return job;
  }

  clearFixedTextSent(id: number): AutonomousJobRow {
    this.db
      .query(`UPDATE autonomous_jobs SET fixed_text_sent_at = NULL, updated_at = ? WHERE id = ?`)
      .run(nowIso(), id);
    const job = this.getJobById(id);
    if (!job) throw new Error(`Autonomous job not found: ${id}`);
    return job;
  }
```

In `src/cron/autonomous.ts`, replace the top of `runOneAutonomousJob(...)` through the hybrid fixed-text send block with this exact code:

```ts
export async function runOneAutonomousJob(input: AutonomousRunInput) {
  const now = input.nowUnix ?? unixNow();
  const jobService = new AutonomousJobService(input.db);
  let currentJob = jobService.markRunStarted(input.job.id, now);
  emitTrace(input.trace, {
    minLevel: 1,
    source: "autonomous",
    event: "job.start",
    chatId: currentJob.chatId,
    userId: currentJob.userId,
    jobId: String(currentJob.id),
    payload: { nowUnix: now, jobType: currentJob.jobType, runCount: currentJob.runCount },
  });

  return runWithLlmRequestContext({
    trace: input.trace,
    requestType: "autonomous_job",
    chatId: currentJob.chatId,
    userId: currentJob.userId,
    jobId: String(currentJob.id),
  }, async () => {
    try {
      const shouldSendFixedText =
        currentJob.jobType === "hybrid" &&
        currentJob.messageText.trim().length > 0 &&
        !(currentJob.scheduleMode === "once" && currentJob.fixedTextSentAt != null);

      if (shouldSendFixedText) {
        const sent = await sendTelegramText(input.bot, currentJob.chatId, currentJob.messageText, `Failed to send hybrid job text #${currentJob.id}`);
        if (!sent) throw new Error(`Failed to send hybrid job text #${currentJob.id}`);
        if (currentJob.scheduleMode === "once") {
          currentJob = jobService.markFixedTextSent(currentJob.id, now);
        }
      }
```

Then replace the success and error `finishedAt` usage later in the same function with this exact code:

```ts
      const finishedAt = input.finishedUnix ?? unixNow();
      jobService.markRunFinished(currentJob.id, finishedAt, "success", null);
      const completion = jobService.recordSuccessfulRun(currentJob.id);
      emitTrace(input.trace, {
        minLevel: 1,
        source: "autonomous",
        event: "job.complete",
        chatId: currentJob.chatId,
        userId: currentJob.userId,
        jobId: String(currentJob.id),
        payload: { finishedAtUnix: finishedAt, answerLength: answer.length, deleted: completion.deleted, runCount: completion.runCount },
      });
```

```ts
      const finishedAt = input.finishedUnix ?? unixNow();
      const message = toErrorMessage(error);
      jobService.markRunFinished(currentJob.id, finishedAt, "error", message);
      emitTrace(input.trace, {
        minLevel: 1,
        source: "autonomous",
        event: "job.error",
        chatId: currentJob.chatId,
        userId: currentJob.userId,
        jobId: String(currentJob.id),
        payload: { finishedAtUnix: finishedAt },
        error,
      });
```

- [ ] **Step 4: Run the tests again and confirm they pass**

Run:

```bash
bun test tests/services/autonomous-jobs.test.ts tests/cron/autonomous-helpers.test.ts
```

Expected: PASS. Recurring schedule edits should clear stale caps, one-shot retries should not resend fixed reminder text after the first delivery, and `last_finished_at` should reflect the actual finish time when `finishedUnix` is omitted.

- [ ] **Step 5: Commit the persisted scheduler-state fixes**

Run:

```bash
git add src/db/schema.ts src/services/autonomous-jobs.ts src/cron/autonomous.ts tests/services/autonomous-jobs.test.ts tests/cron/autonomous-helpers.test.ts
git commit -m "fix: persist one-shot job delivery state"
```

---

### Task 5: Make cron schedules honor `APP_TIMEZONE`

**Files:**
- Modify: `tests/services/schedules.test.ts:1-31`
- Modify: `src/services/schedules.ts:1-131`
- Reference: `src/config.ts:49-53`, `src/config.ts:139`

- [ ] **Step 1: Add the failing timezone regression**

In `tests/services/schedules.test.ts`, add the config import and append this test after `cron schedules compute the next run time from the current timestamp`:

```ts
import { config } from "../../src/config";
```

```ts
test("cron schedules compute the next run time in APP_TIMEZONE", () => {
  const previousTimezone = config.app.timezone;
  config.app.timezone = "Asia/Jakarta";

  try {
    const schedule = normalizeSchedule({ scheduleMode: "cron", cronExpr: "0 9 * * *" });
    const anchorUnix = Math.floor(Date.UTC(2026, 0, 1, 1, 30, 0) / 1000);

    expect(getNextDueAtUnix(schedule, anchorUnix)).toBe(Math.floor(Date.UTC(2026, 0, 1, 2, 0, 0) / 1000));
  } finally {
    config.app.timezone = previousTimezone;
  }
});
```

- [ ] **Step 2: Run the targeted schedule tests and verify they fail**

Run:

```bash
bun test tests/services/schedules.test.ts
```

Expected: FAIL on hosts that are not already using `Asia/Jakarta`, because cron parsing still uses the host timezone rather than `config.app.timezone`.

- [ ] **Step 3: Use the configured app timezone in schedule validation and next-run computation**

In `src/services/schedules.ts`, add this import at the top of the file:

```ts
import { config } from "../config";
```

Then replace `validateCronExpression(...)` with this exact version:

```ts
export function validateCronExpression(cronExpr: string): string {
  const normalized = cronExpr.trim();
  if (!normalized) {
    throw new Error("cronExpr is required");
  }

  try {
    CronExpressionParser.parse(normalized, { tz: config.app.timezone });
  } catch (error) {
    throw new Error(`Invalid cron expression: ${normalized}`);
  }

  return normalized;
}
```

Replace the cron branch of `getNextDueAtUnix(...)` with this exact code:

```ts
  const currentDate = new Date(nowUnix * 1000);
  const parsed = CronExpressionParser.parse(schedule.cronExpr ?? "", {
    currentDate,
    tz: config.app.timezone,
  });
  const next = parsed.next() as { toDate?: () => Date; getTime?: () => number };
  const nextDate = typeof next.toDate === "function" ? next.toDate() : new Date(next.getTime?.() ?? currentDate.getTime());
  return Math.floor(nextDate.getTime() / 1000);
```

- [ ] **Step 4: Run the schedule tests again and confirm they pass**

Run:

```bash
bun test tests/services/schedules.test.ts
```

Expected: PASS. The new regression should show that `0 9 * * *` means 9:00 in `APP_TIMEZONE`, not 9:00 in the host timezone.

- [ ] **Step 5: Commit the timezone-aware cron fix**

Run:

```bash
git add tests/services/schedules.test.ts src/services/schedules.ts src/config.ts
git commit -m "fix: honor app timezone for cron schedules"
```

---

### Task 6: Update the live bug ledger and run the full Phase 2 verification suite

**Files:**
- Modify: `docs/bugs/2026-05-21-verified-bug-audit.md:1-218`
- Reference: all files changed in Tasks 1–5

- [ ] **Step 1: Update the header counts and executive summary**

In `docs/bugs/2026-05-21-verified-bug-audit.md`, change the `## Status` counts to:

```md
Reviewed 14 previously documented bugs:
- 2 still appear open in the current tree
- 12 appear fixed in the current tree
```

Replace the `## Executive summary` body with this exact text:

```md
Phase 1 and Phase 2 bugs are now fixed in the current tree.

The remaining open issues are now limited to consistency/integrity bugs:
- generated skill drafts can still overwrite each other while the stored draft count increases,
- store-backed maintenance can still skip rows that share the same millisecond timestamp.

Task ownership and scheduler correctness are now aligned with the intended semantics:
- completion-turn tool evidence stays attached to the completed task,
- Memory Update back navigation preserves the generated draft count,
- recurring jobs created through `tdai_create_job` are unlimited unless `max_runs` is explicit,
- schedule edits clear stale one-shot caps,
- one-shot hybrid retries do not resend already-delivered fixed reminder text,
- `last_finished_at` reflects the true finish time,
- cron schedules honor `APP_TIMEZONE`.
```

- [ ] **Step 2: Replace the seven Phase 2 bug entries with fixed-current-tree summaries**

Replace bug sections **1**, **2**, **3**, **4**, **5**, **12**, and **13** with these exact versions:

```md
### 1. Completion-turn tool evidence loses task ownership

**Status:** Fixed in current tree  
**Severity:** Medium

**Impact:** Tool output produced while the user completes a task now stays attached to that task, so final verification evidence is not orphaned outside the completed task.

**Root cause:** `judgeTaskTurn()` used to preserve the completion task id internally but dropped it in the returned `taskId` and task-boundary write unless `judgment.isLongTask` was true.

**Fix summary:** Completion and continuation turns that are attached to an existing task are now treated as task-scoped for both the returned `taskId` and the inserted task boundary.

**Changed code:** `src/memory/core/service.ts`

**Verification:** `tests/memory/task-routing.test.ts`
```

```md
### 2. Returning from Memory Update resets the displayed Skill Draft count to 0

**Status:** Fixed in current tree  
**Severity:** Low

**Impact:** The Memory summary now preserves the real generated-skill draft count when the user returns from Memory Update.

**Root cause:** the Memory Update back path rebuilt the summary without `generatedSkillCount`, so the renderer fell back to `0`.

**Fix summary:** the back-navigation path now fetches and passes `generatedSkillCount` before rebuilding the summary.

**Changed code:** `src/bot/conversations/memory-update.ts`

**Verification:** `tests/bot/memory-update-callback.test.ts`
```

```md
### 3. `tdai_create_job` silently turns recurring schedules into single-run jobs by default

**Status:** Fixed in current tree  
**Severity:** Medium

**Impact:** Interval and cron jobs created through the tool are now unlimited unless the caller explicitly sets `max_runs`.

**Root cause:** the tool contract and parser previously hard-defaulted `max_runs` to `1` for every schedule mode.

**Fix summary:** the tool now defaults `max_runs` to `1` only for one-shot jobs and reports `max_runs=unlimited` for recurring schedules unless an explicit cap is supplied.

**Changed code:** `src/tools/local.ts`, `src/agent/prompts/system.ts`

**Verification:** `tests/memory/tools.test.ts`, `tests/runtime/agent-prompt.test.ts`
```

```md
### 4. Switching a one-shot job back to interval or cron keeps the old one-run cap

**Status:** Fixed in current tree  
**Severity:** Medium

**Impact:** Jobs switched from `once` back to `interval` or `cron` no longer self-delete after the next successful run unless the caller explicitly reapplies a run cap.

**Root cause:** recurring schedule edits reused the existing row and left the old one-shot `max_runs = 1` value in place.

**Fix summary:** recurring schedule edits now clear stale one-shot caps before saving the new schedule mode.

**Changed code:** `src/services/autonomous-jobs.ts`

**Verification:** `tests/services/autonomous-jobs.test.ts`
```

```md
### 5. Autonomous jobs stamp `last_finished_at` before the run actually finishes

**Status:** Fixed in current tree  
**Severity:** Medium

**Impact:** Recurrence timing and job telemetry now anchor to the real finish time instead of a timestamp captured at run start.

**Root cause:** `runOneAutonomousJob()` captured `finishedAt` before any Telegram sends or agent work started and reused that early value in both success and error paths.

**Fix summary:** finish timestamps are now captured at the point the run actually completes or errors.

**Changed code:** `src/cron/autonomous.ts`

**Verification:** `tests/cron/autonomous-helpers.test.ts`
```

```md
### 12. Cron schedules are evaluated in host time, not `APP_TIMEZONE`

**Status:** Fixed in current tree  
**Severity:** Medium

**Impact:** Cron-based reminders now use the configured application timezone instead of the host machine timezone.

**Root cause:** cron parsing validated and computed next-run times without passing `config.app.timezone`.

**Fix summary:** cron validation and next-run calculation now both use `APP_TIMEZONE`.

**Changed code:** `src/services/schedules.ts`

**Verification:** `tests/services/schedules.test.ts`
```

```md
### 13. Hybrid one-shot jobs can resend the fixed reminder text after a partial send failure

**Status:** Fixed in current tree  
**Severity:** Medium

**Impact:** If a one-shot hybrid job delivers its fixed reminder text and later fails while sending the follow-up response, the retry path no longer sends the same fixed reminder text again.

**Root cause:** the runtime had no persisted notion that the one-shot fixed text had already been delivered, so retries replayed the full hybrid send path.

**Fix summary:** one-shot hybrid jobs now persist fixed-text delivery state and skip resending the fixed text on the retry path while continuing the unfinished follow-up work.

**Changed code:** `src/db/schema.ts`, `src/services/autonomous-jobs.ts`, `src/cron/autonomous.ts`

**Verification:** `tests/cron/autonomous-helpers.test.ts`
```

- [ ] **Step 3: Replace the suggested fix order with the remaining Phase 3 backlog**

Replace the `## Suggested fix order` section with this exact list:

```md
## Suggested fix order

1. generated-skill draft path collisions
2. store-backed same-timestamp checkpoint skipping
```

- [ ] **Step 4: Run the full Phase 2 verification suite**

Run:

```bash
bun test tests/memory/task-routing.test.ts tests/bot/memory-update-callback.test.ts tests/memory/tools.test.ts tests/runtime/agent-prompt.test.ts tests/services/autonomous-jobs.test.ts tests/cron/autonomous-helpers.test.ts tests/services/schedules.test.ts
```

Expected: PASS. This suite covers every Phase 2 regression plus the user-visible prompt/tool contract updates.

- [ ] **Step 5: Verify the ledger matches the code you actually changed and commit**

Manually confirm that the updated `Changed code` and `Verification` lines mention only the files touched in Tasks 1–5 and that the header counts now read `2 still appear open` and `12 appear fixed`.

Then run:

```bash
git add docs/bugs/2026-05-21-verified-bug-audit.md tests/memory/task-routing.test.ts tests/bot/memory-update-callback.test.ts tests/memory/tools.test.ts tests/runtime/agent-prompt.test.ts tests/services/autonomous-jobs.test.ts tests/cron/autonomous-helpers.test.ts tests/services/schedules.test.ts src/memory/core/service.ts src/bot/conversations/memory-update.ts src/tools/local.ts src/agent/prompts/system.ts src/db/schema.ts src/services/autonomous-jobs.ts src/cron/autonomous.ts src/services/schedules.ts
git commit -m "docs: update phase 2 bug audit"
```

---

## Coverage check against the approved roadmap

- **Completion-turn task ownership:** Task 1
- **Memory Update back-path generated draft count:** Task 2
- **Recurring tool defaults and prompt contract:** Task 3
- **Stale one-shot caps, one-shot retry duplication, and actual finish timestamps:** Task 4
- **Timezone-aware cron behavior:** Task 5
- **Ledger updates in the same change as the fixes:** Task 6

## Placeholder scan

- No `TODO`, `TBD`, or deferred implementation notes remain.
- Every code-changing step includes concrete code blocks.
- Every verification step includes exact `bun test` commands and expected outcomes.
- Every commit step uses explicit file lists rather than `git add .`.

## Type and API consistency check

- The task-routing fix consistently uses `taskScopedTurn` as the gate for both the task boundary and the returned `taskId`.
- The recurring-job surface consistently uses `maxRuns: null` to mean unlimited.
- The persisted one-shot delivery state is consistently named `fixedTextSentAt` in TypeScript and `fixed_text_sent_at` in SQLite.
- The prompt contract and tool contract both use the same semantics: one-shot defaults to `1`, recurring defaults to unlimited.
