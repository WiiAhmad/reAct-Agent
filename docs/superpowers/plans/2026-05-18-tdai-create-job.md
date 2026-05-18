# tdai_create_job Hybrid Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `tdai_create_job` so the Telegram agent can create one-shot or limited recurring hybrid scheduled jobs directly from chat.

**Architecture:** Reuse the existing `autonomous_jobs` table, `AutonomousJobService`, and unified scheduler. Add hybrid job fields so due jobs send fixed text first, then run an agent prompt, count successful executions, and delete themselves when their run limit is reached.

**Tech Stack:** Bun, TypeScript, grammY, bun:sqlite, node-cron, cron-parser, Bun test.

---

## File Structure

- Modify: `src/db/schema.ts` — add backward-compatible columns for hybrid jobs and one-shot due timestamps.
- Modify: `src/services/schedules.ts` — support `once` schedules with `runAtUnix` while preserving interval and cron behavior.
- Modify: `src/services/autonomous-jobs.ts` — map/store hybrid fields, create hybrid jobs, list due one-shot jobs, and record successful runs.
- Modify: `src/cron/autonomous.ts` — send `messageText`, run `agentPrompt`, and delete completed limited jobs.
- Modify: `src/tools/types.ts` — expose optional `autonomousJobs` on tool context.
- Modify: `src/tools/local.ts` — register and implement `tdai_create_job`.
- Modify: `src/index.ts` — pass `autonomousJobs` into `createLocalTools()`.
- Modify: `src/agent/prompts/system.ts` — teach the agent when and how to use `tdai_create_job`.
- Modify: `docs/autonomous-jobs.md` — document chat-created hybrid scheduled jobs.
- Modify tests: `tests/services/autonomous-jobs.test.ts`, `tests/cron/autonomous-helpers.test.ts`, `tests/memory/tools.test.ts`, `tests/runtime/agent-prompt.test.ts`.

---

### Task 1: Extend schedule and job persistence model

**Files:**
- Modify: `src/services/schedules.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/services/autonomous-jobs.ts`
- Test: `tests/services/autonomous-jobs.test.ts`

- [ ] **Step 1: Write failing service tests for hybrid fields and one-shot due selection**

Append these tests to `tests/services/autonomous-jobs.test.ts`:

```ts
test("creates hybrid one-shot jobs with a run limit", () => {
  const { service } = makeService();
  const runAtUnix = Math.floor(Date.UTC(2026, 4, 18, 6, 30, 0) / 1000);

  const job = service.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Berikan respons singkat bahwa ini pengingat minum air.",
    jobType: "hybrid",
    messageText: "Pengingat: minum air",
    agentPrompt: "Berikan respons singkat bahwa ini pengingat minum air.",
    schedule: { scheduleMode: "once", runAtUnix },
    maxRuns: 1,
  });

  expect(job).toMatchObject({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Berikan respons singkat bahwa ini pengingat minum air.",
    jobType: "hybrid",
    messageText: "Pengingat: minum air",
    agentPrompt: "Berikan respons singkat bahwa ini pengingat minum air.",
    scheduleMode: "once",
    runAtUnix,
    runCount: 0,
    maxRuns: 1,
  });
  expect(job.scheduleLabel).toBe("Once at 2026-05-18T06:30:00.000Z");
});

test("lists one-shot jobs only when run_at_unix is due", () => {
  const { service } = makeService();
  const runAtUnix = Math.floor(Date.UTC(2026, 4, 18, 6, 30, 0) / 1000);
  const job = service.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Reminder follow-up",
    jobType: "hybrid",
    messageText: "Pengingat: minum air",
    agentPrompt: "Reminder follow-up",
    schedule: { scheduleMode: "once", runAtUnix },
    maxRuns: 1,
  });

  expect(service.listDueJobs(runAtUnix - 1, 10)).toEqual([]);
  expect(service.listDueJobs(runAtUnix, 10).map((dueJob) => dueJob.id)).toEqual([job.id]);
});

test("records successful runs and deletes jobs that reach max_runs", () => {
  const { service } = makeService();
  const job = service.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Reminder follow-up",
    jobType: "hybrid",
    messageText: "Pengingat: minum air",
    agentPrompt: "Reminder follow-up",
    schedule: { scheduleMode: "interval", intervalSec: 600 },
    maxRuns: 1,
  });

  const result = service.recordSuccessfulRun(job.id);

  expect(result).toEqual({ deleted: true, job: null, runCount: 1 });
  expect(service.getJobById(job.id)).toBeNull();
});
```

- [ ] **Step 2: Run service tests and verify they fail**

Run:

```powershell
bun test tests/services/autonomous-jobs.test.ts
```

Expected: FAIL with TypeScript/runtime errors for missing `once`, `jobType`, `messageText`, `agentPrompt`, `runAtUnix`, `runCount`, `maxRuns`, and `recordSuccessfulRun`.

- [ ] **Step 3: Extend schedule types and helpers**

In `src/services/schedules.ts`, replace the schedule type definitions and helper implementations with this version:

```ts
import { CronExpressionParser } from "cron-parser";
import { unixNow } from "../utils/time";

export type ScheduleMode = "once" | "interval" | "cron";

export type ScheduleInput = {
  scheduleMode: ScheduleMode;
  runAtUnix?: number | null;
  intervalSec?: number | null;
  cronExpr?: string | null;
  lastFinishedAt?: number | null;
};

export type Schedule = {
  scheduleMode: ScheduleMode;
  runAtUnix: number | null;
  intervalSec: number | null;
  cronExpr: string | null;
  lastFinishedAt: number | null;
};

export type ScheduleAnchor = number | null | undefined;

export type ScheduleDueClock = {
  now?: number;
};

function assertPositiveInteger(value: number | null | undefined, fieldName: string): number {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return value as number;
}

function describeInterval(seconds: number): string {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

export function validateCronExpression(cronExpr: string): string {
  const normalized = cronExpr.trim();
  if (!normalized) {
    throw new Error("cronExpr is required");
  }

  try {
    CronExpressionParser.parse(normalized);
  } catch (error) {
    throw new Error(`Invalid cron expression: ${normalized}`);
  }

  return normalized;
}

export function normalizeSchedule(input: ScheduleInput): Schedule {
  if (input.scheduleMode === "once") {
    return {
      scheduleMode: "once",
      runAtUnix: assertPositiveInteger(input.runAtUnix ?? null, "runAtUnix"),
      intervalSec: null,
      cronExpr: null,
      lastFinishedAt: input.lastFinishedAt ?? null,
    };
  }

  if (input.scheduleMode === "interval") {
    return {
      scheduleMode: "interval",
      runAtUnix: null,
      intervalSec: assertPositiveInteger(input.intervalSec ?? null, "intervalSec"),
      cronExpr: null,
      lastFinishedAt: input.lastFinishedAt ?? null,
    };
  }

  if (input.scheduleMode === "cron") {
    return {
      scheduleMode: "cron",
      runAtUnix: null,
      intervalSec: null,
      cronExpr: validateCronExpression(input.cronExpr ?? ""),
      lastFinishedAt: input.lastFinishedAt ?? null,
    };
  }

  throw new Error(`Unsupported schedule mode: ${String(input.scheduleMode)}`);
}

export function getNextDueAtUnix(schedule: Schedule, anchorUnix: ScheduleAnchor = schedule.lastFinishedAt): number {
  if (schedule.scheduleMode === "once") {
    return schedule.runAtUnix!;
  }

  const nowUnix = anchorUnix ?? unixNow();

  if (schedule.scheduleMode === "interval") {
    return anchorUnix == null ? nowUnix : anchorUnix + schedule.intervalSec!;
  }

  const currentDate = new Date(nowUnix * 1000);
  const parsed = CronExpressionParser.parse(schedule.cronExpr ?? "", { currentDate });
  const next = parsed.next() as { toDate?: () => Date; getTime?: () => number };
  const nextDate = typeof next.toDate === "function" ? next.toDate() : new Date(next.getTime?.() ?? currentDate.getTime());
  return Math.floor(nextDate.getTime() / 1000);
}

export function isScheduleDue(schedule: Schedule, anchorUnix: ScheduleAnchor = schedule.lastFinishedAt, nowUnix: number = unixNow()): boolean {
  return getNextDueAtUnix(schedule, anchorUnix) <= nowUnix;
}

export function describeSchedule(schedule: Schedule): string {
  if (schedule.scheduleMode === "once") {
    return `Once at ${new Date(schedule.runAtUnix! * 1000).toISOString()}`;
  }

  if (schedule.scheduleMode === "interval") {
    return `Every ${describeInterval(schedule.intervalSec!)}`;
  }

  return `Cron: ${schedule.cronExpr}`;
}
```

- [ ] **Step 4: Add database columns for hybrid jobs**

In `src/db/schema.ts`, update the `CREATE TABLE IF NOT EXISTS autonomous_jobs` block so it includes these columns after `prompt TEXT NOT NULL` and before `enabled`:

```sql
      job_type TEXT NOT NULL DEFAULT 'agent',
      message_text TEXT NOT NULL DEFAULT '',
      agent_prompt TEXT NOT NULL DEFAULT '',
      run_at_unix INTEGER,
      run_count INTEGER NOT NULL DEFAULT 0,
      max_runs INTEGER,
```

Then add these migration checks after the existing autonomous job column migrations:

```ts
  if (!hasColumn(db, "autonomous_jobs", "job_type")) {
    db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN job_type TEXT NOT NULL DEFAULT 'agent'`);
  }
  if (!hasColumn(db, "autonomous_jobs", "message_text")) {
    db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN message_text TEXT NOT NULL DEFAULT ''`);
  }
  if (!hasColumn(db, "autonomous_jobs", "agent_prompt")) {
    db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN agent_prompt TEXT NOT NULL DEFAULT ''`);
  }
  if (!hasColumn(db, "autonomous_jobs", "run_at_unix")) {
    db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN run_at_unix INTEGER`);
  }
  if (!hasColumn(db, "autonomous_jobs", "run_count")) {
    db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN run_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasColumn(db, "autonomous_jobs", "max_runs")) {
    db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN max_runs INTEGER`);
  }
```

- [ ] **Step 5: Extend `AutonomousJobService` types and row mapping**

In `src/services/autonomous-jobs.ts`, replace `AutonomousJobRow` with:

```ts
export type AutonomousJobType = "agent" | "hybrid";

export type AutonomousJobRow = {
  id: number;
  chatId: string;
  userId: string;
  prompt: string;
  jobType: AutonomousJobType;
  messageText: string;
  agentPrompt: string;
  enabled: boolean;
  scheduleMode: "once" | "interval" | "cron";
  runAtUnix: number | null;
  intervalSec: number | null;
  cronExpr: string | null;
  runCount: number;
  maxRuns: number | null;
  lastRunAt: number | null;
  lastFinishedAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  scheduleLabel: string;
};
```

Replace `AutonomousJobDbRow` with:

```ts
type AutonomousJobDbRow = {
  id: number;
  chat_id: string;
  user_id: string;
  prompt: string;
  job_type: AutonomousJobType;
  message_text: string;
  agent_prompt: string;
  enabled: number;
  schedule_mode: "once" | "interval" | "cron";
  run_at_unix: number | null;
  interval_sec: number | null;
  cron_expr: string | null;
  run_count: number;
  max_runs: number | null;
  last_run_at: number | null;
  last_finished_at: number | null;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};
```

Replace `toSchedule()` with:

```ts
function toSchedule(row: Pick<AutonomousJobDbRow, "schedule_mode" | "run_at_unix" | "interval_sec" | "cron_expr" | "last_finished_at">) {
  return normalizeSchedule({
    scheduleMode: row.schedule_mode,
    runAtUnix: row.run_at_unix,
    intervalSec: row.interval_sec,
    cronExpr: row.cron_expr,
    lastFinishedAt: row.last_finished_at,
  });
}
```

Update `mapRow()` so the returned object includes:

```ts
    jobType: row.job_type,
    messageText: row.message_text,
    agentPrompt: row.agent_prompt,
    runAtUnix: schedule.runAtUnix,
    runCount: row.run_count,
    maxRuns: row.max_runs,
```

- [ ] **Step 6: Extend `createJob()` to store hybrid fields**

In `src/services/autonomous-jobs.ts`, add this input type above the class:

```ts
export type CreateAutonomousJobInput = {
  chatId: string;
  userId: string;
  prompt: string;
  schedule: ScheduleInput;
  jobType?: AutonomousJobType;
  messageText?: string;
  agentPrompt?: string;
  maxRuns?: number | null;
};
```

Replace the `createJob` signature and insert query with:

```ts
  createJob(input: CreateAutonomousJobInput): AutonomousJobRow {
    const schedule = normalizeSchedule(input.schedule);
    const now = nowIso();
    const result = this.db
      .query(
        `INSERT INTO autonomous_jobs (
          chat_id,
          user_id,
          prompt,
          job_type,
          message_text,
          agent_prompt,
          schedule_mode,
          run_at_unix,
          interval_sec,
          cron_expr,
          run_count,
          max_runs,
          enabled,
          last_run_at,
          last_finished_at,
          last_status,
          last_error,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, NULL, NULL, NULL, NULL, ?, ?)`,
      )
      .run(
        input.chatId,
        input.userId,
        input.prompt,
        input.jobType ?? "agent",
        input.messageText ?? "",
        input.agentPrompt ?? "",
        schedule.scheduleMode,
        schedule.runAtUnix,
        schedule.intervalSec,
        schedule.cronExpr,
        input.maxRuns ?? null,
        now,
        now,
      );

    const job = this.getJobById(Number(result.lastInsertRowid));
    if (!job) throw new Error("Failed to load created autonomous job");
    return job;
  }
```

- [ ] **Step 7: Update all service SELECT statements**

In `src/services/autonomous-jobs.ts`, update every SELECT list from `autonomous_jobs` to include these columns after `prompt`:

```sql
          job_type,
          message_text,
          agent_prompt,
```

and these columns after `schedule_mode`:

```sql
          run_at_unix,
```

and these columns after `cron_expr`:

```sql
          run_count,
          max_runs,
```

- [ ] **Step 8: Add run-limit accounting and due filtering**

In `src/services/autonomous-jobs.ts`, add this method inside the class after `deleteJob()`:

```ts
  recordSuccessfulRun(id: number): { deleted: boolean; job: AutonomousJobRow | null; runCount: number } {
    const job = this.getJobById(id);
    if (!job) throw new Error(`Autonomous job not found: ${id}`);

    const nextRunCount = job.runCount + 1;
    if (job.maxRuns !== null && nextRunCount >= job.maxRuns) {
      this.deleteJob(id);
      return { deleted: true, job: null, runCount: nextRunCount };
    }

    this.db.query(`UPDATE autonomous_jobs SET run_count = ?, updated_at = ? WHERE id = ?`).run(nextRunCount, nowIso(), id);
    const updated = this.getJobById(id);
    if (!updated) throw new Error(`Autonomous job not found after run update: ${id}`);
    return { deleted: false, job: updated, runCount: nextRunCount };
  }
```

In `listDueJobs()`, add this skip before building the schedule:

```ts
      if (job.maxRuns !== null && job.runCount >= job.maxRuns) {
        continue;
      }
```

Also include `runAtUnix: job.runAtUnix` in the `normalizeSchedule()` call in `listDueJobs()`.

- [ ] **Step 9: Run service tests and verify they pass**

Run:

```powershell
bun test tests/services/autonomous-jobs.test.ts
```

Expected: PASS for all tests in `tests/services/autonomous-jobs.test.ts`.

- [ ] **Step 10: Commit Task 1 if commits are authorized**

Run only if the user has explicitly authorized commits for this implementation session:

```powershell
git add src/services/schedules.ts src/db/schema.ts src/services/autonomous-jobs.ts tests/services/autonomous-jobs.test.ts
git commit -m @'
feat: extend autonomous job persistence for hybrid jobs

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 2: Execute hybrid jobs as fixed text followed by agent response

**Files:**
- Modify: `src/cron/autonomous.ts`
- Test: `tests/cron/autonomous-helpers.test.ts`

- [ ] **Step 1: Write failing cron tests for hybrid execution order and deletion**

In `tests/cron/autonomous-helpers.test.ts`, update the `mapAutonomousJobRow` test input to include the new snake_case fields:

```ts
    job_type: "agent",
    message_text: "",
    agent_prompt: "",
    run_at_unix: null,
    run_count: 0,
    max_runs: null,
```

and add these expected fields:

```ts
    jobType: "agent",
    messageText: "",
    agentPrompt: "",
    runAtUnix: null,
    runCount: 0,
    maxRuns: null,
```

Append this test:

```ts
test("runOneAutonomousJob sends hybrid fixed text before agent response and deletes after max_runs", async () => {
  const db = makeDb();
  const jobs = new AutonomousJobService(db);
  const job = jobs.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Kirim tindak lanjut singkat.",
    jobType: "hybrid",
    messageText: "Pengingat: minum air",
    agentPrompt: "Kirim tindak lanjut singkat.",
    schedule: { scheduleMode: "interval", intervalSec: 600 },
    maxRuns: 1,
  });
  const sent: Array<{ chatId: string; text: string }> = [];
  const agentInputs: string[] = [];

  const result = await runOneAutonomousJob({
    db,
    bot: {
      api: {
        sendMessage: async (chatId: string, text: string) => {
          sent.push({ chatId, text });
        },
      },
    } as any,
    memory: {} as any,
    registry: {} as any,
    llm: {} as any,
    job,
    runAgent: async ({ input }) => {
      agentInputs.push(input);
      return "Agent follow-up";
    },
    nowUnix: 1_779_000_000,
    finishedUnix: 1_779_000_037,
  });

  expect(result.answer).toBe("Agent follow-up");
  expect(agentInputs).toEqual(["[AUTONOMOUS_JOB #1] Kirim tindak lanjut singkat."]);
  expect(sent).toEqual([
    { chatId: "chat-1", text: "Pengingat: minum air" },
    { chatId: "chat-1", text: expect.stringContaining("Agent follow-up") },
  ]);
  expect(jobs.getJobById(job.id)).toBeNull();
});
```

- [ ] **Step 2: Run cron helper tests and verify they fail**

Run:

```powershell
bun test tests/cron/autonomous-helpers.test.ts
```

Expected: FAIL because `mapAutonomousJobRow` and `runOneAutonomousJob` do not yet understand hybrid fields or delete completed limited jobs.

- [ ] **Step 3: Update cron row mapping type**

In `src/cron/autonomous.ts`, replace the local `AutonomousJobDbRow` type with:

```ts
type AutonomousJobDbRow = {
  id: number;
  chat_id: string;
  user_id: string;
  prompt: string;
  job_type: "agent" | "hybrid";
  message_text: string;
  agent_prompt: string;
  enabled: number;
  schedule_mode: "once" | "interval" | "cron";
  run_at_unix: number | null;
  interval_sec: number | null;
  cron_expr: string | null;
  run_count: number;
  max_runs: number | null;
  last_run_at: number | null;
  last_finished_at: number | null;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 4: Update `mapAutonomousJobRow()`**

In `src/cron/autonomous.ts`, update the `normalizeSchedule()` call to include `runAtUnix: row.run_at_unix`, and update the return object with:

```ts
    jobType: row.job_type,
    messageText: row.message_text,
    agentPrompt: row.agent_prompt,
    runAtUnix: schedule.runAtUnix,
    runCount: row.run_count,
    maxRuns: row.max_runs,
```

- [ ] **Step 5: Add a helper for sending Telegram chunks**

In `src/cron/autonomous.ts`, add this helper below `toErrorMessage()`:

```ts
async function sendTelegramText(bot: Bot<BotContext>, chatId: string, text: string, errorLabel: string) {
  for (const chunk of splitTelegramMessage(text)) {
    await bot.api.sendMessage(chatId, chunk).catch((error) => {
      console.error(errorLabel, error);
    });
  }
}
```

- [ ] **Step 6: Update `runOneAutonomousJob()` for hybrid execution**

Replace the success path in `runOneAutonomousJob()` with this structure:

```ts
  try {
    if (input.job.jobType === "hybrid" && input.job.messageText.trim()) {
      await sendTelegramText(input.bot, input.job.chatId, input.job.messageText, `Failed to send hybrid job text #${input.job.id}`);
    }

    const agentPrompt = input.job.jobType === "hybrid" && input.job.agentPrompt.trim() ? input.job.agentPrompt : input.job.prompt;
    const answer = await (input.runAgent ?? runReactAgent)({
      chatId: input.job.chatId,
      userId: input.job.userId,
      input: `[AUTONOMOUS_JOB #${input.job.id}] ${agentPrompt}`,
      memory: input.memory,
      registry: input.registry,
      llm: input.llm,
      mode: "autonomous",
    });

    const finished = jobService.markRunFinished(input.job.id, finishedAt, "success", null);
    const completion = jobService.recordSuccessfulRun(input.job.id);
    const text = `🤖 Autonomous job #${input.job.id}\n\n${truncateText(answer, 3500)}`;
    await sendTelegramText(input.bot, input.job.chatId, text, `Failed to send autonomous job #${input.job.id}`);

    return { job: completion.job ?? finished, answer, deleted: completion.deleted, runCount: completion.runCount };
  } catch (error) {
```

Keep the existing catch block, but replace its repeated send loop with:

```ts
    await sendTelegramText(input.bot, input.job.chatId, failureText, `Failed to send autonomous job failure #${input.job.id}`);
```

- [ ] **Step 7: Update legacy autonomous loop SELECT if needed**

In `src/cron/autonomous.ts`, update the raw SELECT in `startAutonomousLoop()` to include the new columns:

```sql
          SELECT id, chat_id, user_id, prompt, job_type, message_text, agent_prompt, enabled, schedule_mode, run_at_unix, interval_sec, cron_expr, run_count, max_runs, last_run_at, last_finished_at, last_status, last_error, created_at, updated_at
```

This legacy loop is not the primary scheduler path, but keeping it mapped correctly prevents runtime breakage if it is used.

- [ ] **Step 8: Run cron helper tests and verify they pass**

Run:

```powershell
bun test tests/cron/autonomous-helpers.test.ts
```

Expected: PASS for all tests in `tests/cron/autonomous-helpers.test.ts`.

- [ ] **Step 9: Commit Task 2 if commits are authorized**

Run only if the user has explicitly authorized commits for this implementation session:

```powershell
git add src/cron/autonomous.ts tests/cron/autonomous-helpers.test.ts
git commit -m @'
feat: execute hybrid scheduled jobs

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 3: Add `tdai_create_job` local tool

**Files:**
- Modify: `src/tools/types.ts`
- Modify: `src/tools/local.ts`
- Modify: `src/index.ts`
- Test: `tests/memory/tools.test.ts`

- [ ] **Step 1: Write failing tool tests**

In `tests/memory/tools.test.ts`, add this helper below `createMemoryServiceDouble()`:

```ts
function createAutonomousJobsDouble() {
  return {
    createJob: mock((input: any) => ({
      id: 9,
      chatId: input.chatId,
      userId: input.userId,
      prompt: input.prompt,
      jobType: input.jobType,
      messageText: input.messageText,
      agentPrompt: input.agentPrompt,
      scheduleMode: input.schedule.scheduleMode,
      runAtUnix: input.schedule.runAtUnix ?? null,
      intervalSec: input.schedule.intervalSec ?? null,
      cronExpr: input.schedule.cronExpr ?? null,
      runCount: 0,
      maxRuns: input.maxRuns ?? null,
      scheduleLabel: input.schedule.scheduleMode === "once" ? "Once at 2026-05-18T06:30:00.000Z" : "Every 10 minutes",
    })),
  };
}
```

In the existing `tool surface stays stable while calling MemoryService` test, create the jobs double and pass it to `createLocalTools()`:

```ts
  const autonomousJobs = createAutonomousJobsDouble();
  const tools = createLocalTools(memory as any, undefined, autonomousJobs as any);
```

Update the expected tool names array to include `tdai_create_job` before `telegram_send_message`:

```ts
    "tdai_create_job",
```

Append these tests:

```ts
test("tdai_create_job creates one-shot hybrid jobs with default max_runs", async () => {
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

test("tdai_create_job creates interval jobs with caller supplied max_runs", async () => {
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

test("tdai_create_job returns validation errors for incomplete input", async () => {
  const memory = createMemoryServiceDouble();
  const autonomousJobs = createAutonomousJobsDouble();
  const tools = createLocalTools(memory as any, undefined, autonomousJobs as any);
  const createJob = tools.find((tool) => tool.name === "tdai_create_job");

  await expect(
    createJob!.execute(
      {
        message_text: "",
        agent_prompt: "Prompt",
        schedule: { mode: "interval", interval_sec: 600 },
      },
      { chatId: "chat-1", userId: "user-1", memory: memory as any },
    ),
  ).resolves.toBe("message_text is required.");

  expect(autonomousJobs.createJob).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tool tests and verify they fail**

Run:

```powershell
bun test tests/memory/tools.test.ts
```

Expected: FAIL because `createLocalTools()` does not accept `autonomousJobs` and `tdai_create_job` is not registered.

- [ ] **Step 3: Add `autonomousJobs` to tool context**

In `src/tools/types.ts`, add this import:

```ts
import type { AutonomousJobService } from "../services/autonomous-jobs";
```

Then add this field to `ToolContext`:

```ts
  autonomousJobs?: AutonomousJobService;
```

- [ ] **Step 4: Add tool helpers to `src/tools/local.ts`**

In `src/tools/local.ts`, add this import:

```ts
import type { AutonomousJobService } from "../services/autonomous-jobs";
```

Add these helpers below `asNumber()`:

```ts
function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asPositiveInteger(value: unknown, fallback: number, fieldName: string): number | string {
  const resolved = value === undefined || value === null ? fallback : value;
  if (!Number.isInteger(resolved) || (resolved as number) <= 0) {
    return `${fieldName} must be a positive integer.`;
  }
  return resolved as number;
}

function parseRunAtUnix(value: unknown): number | string {
  const runAt = asString(value).trim();
  if (!runAt) return "schedule.run_at is required for one-shot jobs.";
  const timestamp = Date.parse(runAt);
  if (!Number.isFinite(timestamp)) return "schedule.run_at must be a valid ISO datetime.";
  return Math.floor(timestamp / 1000);
}
```

- [ ] **Step 5: Update `createLocalTools()` signature**

Change the function signature in `src/tools/local.ts` to:

```ts
export function createLocalTools(memory: MemoryService, telegram?: Api, autonomousJobs?: AutonomousJobService): RegisteredTool[] {
```

- [ ] **Step 6: Register `tdai_create_job`**

In `src/tools/local.ts`, add this tool after `tdai_current_datetime` and before `telegram_send_message`:

```ts
    {
      name: "tdai_create_job",
      source: "local",
      description: "Create a hybrid scheduled Telegram job that sends fixed text first, then runs an agent prompt. Supports one-shot, interval, and cron schedules. Defaults max_runs to 1.",
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
          max_runs: { type: "number", description: "Positive maximum execution count. Defaults to 1." },
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

        const maxRuns = asPositiveInteger(args.max_runs, 1, "max_runs");
        if (typeof maxRuns === "string") return maxRuns;

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
          schedule = { scheduleMode: "cron" as const, cronExpr };
        } else {
          return "schedule.mode must be one of: once, interval, cron.";
        }

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

        return `Created job #${job.id}. Schedule: ${job.scheduleLabel}. max_runs=${maxRuns}.`;
      },
    },
```

- [ ] **Step 7: Pass `autonomousJobs` into local tools**

In `src/index.ts`, change:

```ts
  registry.registerMany(createLocalTools(memory, bot.api));
```

to:

```ts
  registry.registerMany(createLocalTools(memory, bot.api, autonomousJobs));
```

- [ ] **Step 8: Run tool tests and verify they pass**

Run:

```powershell
bun test tests/memory/tools.test.ts
```

Expected: PASS for all tests in `tests/memory/tools.test.ts`.

- [ ] **Step 9: Commit Task 3 if commits are authorized**

Run only if the user has explicitly authorized commits for this implementation session:

```powershell
git add src/tools/types.ts src/tools/local.ts src/index.ts tests/memory/tools.test.ts
git commit -m @'
feat: add tdai_create_job tool

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 4: Teach the agent prompt about scheduled jobs

**Files:**
- Modify: `src/agent/prompts/system.ts`
- Test: `tests/runtime/agent-prompt.test.ts`

- [ ] **Step 1: Write failing prompt assertions**

In `tests/runtime/agent-prompt.test.ts`, add these assertions to the `shared system prompt reflects the Telegram menu runtime` test:

```ts
  expect(prompt).toContain("tdai_create_job");
  expect(prompt).toContain("max_runs defaults to 1");
  expect(prompt).toContain("send fixed text first, then run the agent prompt");
```

- [ ] **Step 2: Run prompt test and verify it fails**

Run:

```powershell
bun test tests/runtime/agent-prompt.test.ts
```

Expected: FAIL because the system prompt does not mention `tdai_create_job` or its default run limit.

- [ ] **Step 3: Update system prompt**

In `src/agent/prompts/system.ts`, replace line 5:

```ts
Use Memory Update as the Telegram feature for durable memory changes, and use tdai_current_datetime when you need an accurate current timestamp before answering.
```

with:

```ts
Use Memory Update as the Telegram feature for durable memory changes. Use tdai_current_datetime when you need an accurate current timestamp, and use tdai_create_job when the user asks for a reminder or scheduled task.
```

Add these rules after the existing `Use tdai_current_datetime` rule:

```ts
- Use tdai_create_job for reminders and scheduled tasks. For relative times, call tdai_current_datetime first, compute an ISO run_at, then create the job.
- tdai_create_job jobs send fixed text first, then run the agent prompt when due.
- max_runs defaults to 1. Only set a larger max_runs when the user explicitly asks for repeated runs such as "3 times".
```

- [ ] **Step 4: Run prompt test and verify it passes**

Run:

```powershell
bun test tests/runtime/agent-prompt.test.ts
```

Expected: PASS for all tests in `tests/runtime/agent-prompt.test.ts`.

- [ ] **Step 5: Commit Task 4 if commits are authorized**

Run only if the user has explicitly authorized commits for this implementation session:

```powershell
git add src/agent/prompts/system.ts tests/runtime/agent-prompt.test.ts
git commit -m @'
docs: teach agent prompt about scheduled job tool

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 5: Update docs for hybrid chat-created jobs

**Files:**
- Modify: `docs/autonomous-jobs.md`
- Modify: `README.md`
- Test: `tests/memory/readme.test.ts`

- [ ] **Step 1: Write failing docs assertions**

In `tests/memory/readme.test.ts`, add these assertions to the existing autonomous jobs section test:

```ts
  expect(autonomousJobs).toContain("The agent can create hybrid scheduled jobs through tdai_create_job.");
  expect(autonomousJobs).toContain("Hybrid jobs send fixed text first, then run an agent prompt.");
  expect(memory).toContain("tdai_create_job");
```

- [ ] **Step 2: Run docs test and verify it fails**

Run:

```powershell
bun test tests/memory/readme.test.ts
```

Expected: FAIL because README/docs do not document `tdai_create_job` yet.

- [ ] **Step 3: Update `docs/autonomous-jobs.md`**

Add this section after `## Scheduling options`:

```md
## Chat-created hybrid jobs

The agent can create hybrid scheduled jobs through tdai_create_job.

Hybrid jobs send fixed text first, then run an agent prompt. They can be one-shot, interval-based, or cron-based. If the user does not specify a repeat count, max_runs defaults to 1, so the job runs once and is deleted after a successful run.
```

- [ ] **Step 4: Update `README.md`**

In the `## Autonomous jobs` section, add this paragraph after the existing schedule paragraph:

```md
The agent can also create hybrid scheduled jobs through `tdai_create_job`. These jobs send fixed text first, then run an agent prompt. If no repeat count is specified, `max_runs` defaults to 1.
```

In the `## Agent prompt and tools` section, add `tdai_create_job` to the local tool description:

```md
The agent also has internal local tools for accurate time and scheduling: `tdai_current_datetime` for timestamp-aware reasoning, and `tdai_create_job` for reminder or scheduled-task creation.
```

- [ ] **Step 5: Run docs test and verify it passes**

Run:

```powershell
bun test tests/memory/readme.test.ts
```

Expected: PASS for all tests in `tests/memory/readme.test.ts`.

- [ ] **Step 6: Commit Task 5 if commits are authorized**

Run only if the user has explicitly authorized commits for this implementation session:

```powershell
git add docs/autonomous-jobs.md README.md tests/memory/readme.test.ts
git commit -m @'
docs: document hybrid scheduled jobs

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 6: Full verification and integration cleanup

**Files:**
- Modify only files required by failing tests found in this task.
- Test: whole repository.

- [ ] **Step 1: Run focused test suite**

Run:

```powershell
bun test tests/services/autonomous-jobs.test.ts tests/cron/autonomous-helpers.test.ts tests/memory/tools.test.ts tests/runtime/agent-prompt.test.ts tests/memory/readme.test.ts
```

Expected: PASS for all focused tests.

- [ ] **Step 2: Run full test suite**

Run:

```powershell
bun test
```

Expected: PASS for the full test suite.

- [ ] **Step 3: Run TypeScript typecheck**

Run:

```powershell
bunx tsc --noEmit
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Run build**

Run:

```powershell
bun run build
```

Expected: PASS and create/update `dist/index.js` through Bun build output.

- [ ] **Step 5: Review git diff**

Run:

```powershell
git diff -- src/db/schema.ts src/services/schedules.ts src/services/autonomous-jobs.ts src/cron/autonomous.ts src/tools/types.ts src/tools/local.ts src/index.ts src/agent/prompts/system.ts docs/autonomous-jobs.md README.md tests/services/autonomous-jobs.test.ts tests/cron/autonomous-helpers.test.ts tests/memory/tools.test.ts tests/runtime/agent-prompt.test.ts tests/memory/readme.test.ts
```

Expected: diff only contains the hybrid scheduled-job implementation, tests, and docs.

- [ ] **Step 6: Final commit if commits are authorized and previous tasks were not committed**

Run only if the user has explicitly authorized commits for this implementation session and the changes are not already committed:

```powershell
git add src/db/schema.ts src/services/schedules.ts src/services/autonomous-jobs.ts src/cron/autonomous.ts src/tools/types.ts src/tools/local.ts src/index.ts src/agent/prompts/system.ts docs/autonomous-jobs.md README.md tests/services/autonomous-jobs.test.ts tests/cron/autonomous-helpers.test.ts tests/memory/tools.test.ts tests/runtime/agent-prompt.test.ts tests/memory/readme.test.ts
git commit -m @'
feat: add hybrid scheduled job creation tool

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Self-Review Notes

- Spec coverage: The plan covers `tdai_create_job`, one-shot/interval/cron schedules, default `max_runs = 1`, fixed-text-then-agent execution, run counting, deletion after `max_runs`, prompt guidance, docs, and tests.
- Scope: This remains one subsystem: extending the existing autonomous job scheduler and local tool surface.
- Type consistency: The plan consistently uses `jobType`, `messageText`, `agentPrompt`, `runAtUnix`, `runCount`, and `maxRuns` in TypeScript, with matching snake_case database columns.
