# L1.5 Reminder Follow-up Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let reminder jobs defer their follow-up prompt until the user replies, then let L1.5 route that reply back into the normal chat agent with enough context to ask whether another reminder is needed.

**Architecture:** Keep the existing autonomous job scheduler for due reminders, but add `follow_up_mode` so hybrid jobs can choose between immediate follow-up and reply-deferred follow-up. Persist reply-deferred reminder context in the memory layer, extend L1.5 with a narrow `matchesPendingReminderReply` signal, and inject the matched reminder follow-up prompt into the normal chat loop before the agent decides whether to answer or schedule a new reminder.

**Tech Stack:** Bun, TypeScript, grammY, bun:sqlite, existing memory backend, Bun test.

---

## File Structure

- Modify: `src/db/schema.ts` — add `autonomous_jobs.follow_up_mode`.
- Modify: `src/services/autonomous-jobs.ts` — persist and expose `followUpMode` on autonomous jobs.
- Modify: `src/cron/autonomous.ts` — branch hybrid execution between immediate follow-up and reply-deferred follow-up.
- Modify: `src/memory/backends/sqlite/migrate.ts` — create `memory_reminder_followups`.
- Modify: `src/memory/backends/sqlite/backend.ts` — add reminder follow-up CRUD methods.
- Modify: `src/memory/core/backend.ts` — add reminder follow-up backend interface methods.
- Modify: `src/memory/core/types.ts` — add reminder follow-up record types and extend `JudgeTaskTurnResult`.
- Modify: `src/memory/core/service.ts` — load active reminder follow-up during L1.5 judgment and surface matched reminder context.
- Modify: `src/memory/offload/types.ts` — extend L1.5 input/output types.
- Modify: `src/memory/offload/l15.ts` — add rules/LLM support for `matchesPendingReminderReply`.
- Modify: `src/agent/react-agent.ts` — inject matched reminder follow-up context and consume it after the answer is logged.
- Modify: `src/agent/prompts/system.ts` — teach the model when to use reply-deferred reminder follow-up mode.
- Modify: `src/tools/local.ts` — accept `follow_up_mode` in `tdai_create_job`.
- Modify: `docs/autonomous-jobs.md` — document reply-deferred reminder follow-up jobs.
- Modify tests: `tests/services/autonomous-jobs.test.ts`, `tests/cron/autonomous-helpers.test.ts`, `tests/memory/l15.test.ts`, `tests/memory/agent-runtime.test.ts`, `tests/memory/tools.test.ts`, `tests/runtime/agent-prompt.test.ts`.
- Create test: `tests/memory/reminder-followups.test.ts` — focused persistence tests for reminder follow-up records.

---

### Task 1: Add reminder follow-up persistence in the memory layer

**Files:**
- Create: `tests/memory/reminder-followups.test.ts`
- Modify: `src/memory/core/types.ts`
- Modify: `src/memory/core/backend.ts`
- Modify: `src/memory/backends/sqlite/migrate.ts`
- Modify: `src/memory/backends/sqlite/backend.ts`
- Modify: `src/memory/core/service.ts`

- [ ] **Step 1: Write the failing persistence test**

Create `tests/memory/reminder-followups.test.ts` with this content:

```ts
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrateSqliteMemory } from "../../src/memory/backends/sqlite/migrate";
import { SqliteMemoryBackend } from "../../src/memory/backends/sqlite/backend";

test("SQLite backend stores and consumes pending reminder follow-ups", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-reminder-followup-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);

    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });
    await backend.init();

    const created = await backend.createReminderFollowUp({
      jobId: 7,
      chatId: "c1",
      userId: "u1",
      reminderText: "Terry, ini pengingat untuk makan sekarang.",
      followUpPrompt: "Jika Terry membalas, tanyakan singkat apakah sudah makan atau perlu diingatkan lagi nanti.",
      expiresAt: "2026-05-20T02:00:00.000Z",
    });

    expect(created).toMatchObject({
      jobId: 7,
      chatId: "c1",
      userId: "u1",
      status: "active",
      reminderText: "Terry, ini pengingat untuk makan sekarang.",
    });

    expect(await backend.getActiveReminderFollowUp("u1", "c1")).toEqual(
      expect.objectContaining({ id: created.id, jobId: 7, status: "active" }),
    );

    await backend.consumeReminderFollowUp(created.id);

    expect(await backend.getActiveReminderFollowUp("u1", "c1")).toBeUndefined();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the new persistence test and verify it fails**

Run:

```powershell
bun test tests/memory/reminder-followups.test.ts
```

Expected: FAIL with TypeScript/runtime errors because `createReminderFollowUp`, `getActiveReminderFollowUp`, and `consumeReminderFollowUp` do not exist yet.

- [ ] **Step 3: Add reminder follow-up types**

In `src/memory/core/types.ts`, insert these definitions near the other memory record types:

```ts
export type ReminderFollowUpStatus = "active" | "consumed";

export type ReminderFollowUp = {
  id: number;
  jobId: number;
  chatId: string;
  userId: string;
  reminderText: string;
  followUpPrompt: string;
  status: ReminderFollowUpStatus;
  expiresAt: string;
  consumedAt?: string;
  createdAt: string;
};

export type NewReminderFollowUp = {
  jobId: number;
  chatId: string;
  userId: string;
  reminderText: string;
  followUpPrompt: string;
  expiresAt: string;
  status?: ReminderFollowUpStatus;
  consumedAt?: string;
  createdAt?: string;
};
```

Then extend `JudgeTaskTurnResult`:

```ts
export type JudgeTaskTurnResult = {
  judgment: L15JudgmentResult;
  taskId?: number;
  reminderFollowUp?: ReminderFollowUp;
};
```

- [ ] **Step 4: Extend the backend interface**

In `src/memory/core/backend.ts`, add these methods to `MemoryBackend`:

```ts
  createReminderFollowUp(input: NewReminderFollowUp): Promise<ReminderFollowUp>;
  getActiveReminderFollowUp(userId: string, chatId: string): Promise<ReminderFollowUp | undefined>;
  consumeReminderFollowUp(id: number): Promise<void>;
```

Also add `ReminderFollowUp` and `NewReminderFollowUp` to the import list at the top of the file.

- [ ] **Step 5: Add the SQLite table for pending reminder follow-ups**

In `src/memory/backends/sqlite/migrate.ts`, add this table and index after `memory_l15_judgments`:

```sql
CREATE TABLE IF NOT EXISTS memory_reminder_followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  reminder_text TEXT NOT NULL,
  follow_up_prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_reminder_followups_active
ON memory_reminder_followups (user_id, chat_id, status, created_at DESC);
```

- [ ] **Step 6: Implement backend CRUD for reminder follow-ups**

In `src/memory/backends/sqlite/backend.ts`, add row mapping plus these methods:

```ts
function mapReminderFollowUpRow(row: {
  id: number;
  job_id: number;
  chat_id: string;
  user_id: string;
  reminder_text: string;
  follow_up_prompt: string;
  status: "active" | "consumed";
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}): ReminderFollowUp {
  return {
    id: row.id,
    jobId: row.job_id,
    chatId: row.chat_id,
    userId: row.user_id,
    reminderText: row.reminder_text,
    followUpPrompt: row.follow_up_prompt,
    status: row.status,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at ?? undefined,
    createdAt: row.created_at,
  };
}

async createReminderFollowUp(input: NewReminderFollowUp): Promise<ReminderFollowUp> {
  const createdAt = input.createdAt ?? nowIso();
  const status = input.status ?? "active";
  const result = this.db
    .query(`
      INSERT INTO memory_reminder_followups (
        job_id, chat_id, user_id, reminder_text, follow_up_prompt,
        status, expires_at, consumed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.jobId,
      input.chatId,
      input.userId,
      input.reminderText,
      input.followUpPrompt,
      status,
      input.expiresAt,
      input.consumedAt ?? null,
      createdAt,
    );

  const row = this.db
    .query(`
      SELECT id, job_id, chat_id, user_id, reminder_text, follow_up_prompt,
             status, expires_at, consumed_at, created_at
      FROM memory_reminder_followups
      WHERE id = ?
    `)
    .get(Number(result.lastInsertRowid)) as Parameters<typeof mapReminderFollowUpRow>[0] | null;

  if (!row) throw new Error("Failed to load created reminder follow-up");
  return mapReminderFollowUpRow(row);
}

async getActiveReminderFollowUp(userId: string, chatId: string): Promise<ReminderFollowUp | undefined> {
  const row = this.db
    .query(`
      SELECT id, job_id, chat_id, user_id, reminder_text, follow_up_prompt,
             status, expires_at, consumed_at, created_at
      FROM memory_reminder_followups
      WHERE user_id = ?
        AND chat_id = ?
        AND status = 'active'
        AND expires_at > ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `)
    .get(userId, chatId, nowIso()) as Parameters<typeof mapReminderFollowUpRow>[0] | null;

  return row ? mapReminderFollowUpRow(row) : undefined;
}

async consumeReminderFollowUp(id: number): Promise<void> {
  this.db
    .query(`UPDATE memory_reminder_followups SET status = 'consumed', consumed_at = ? WHERE id = ?`)
    .run(nowIso(), id);
}
```

- [ ] **Step 7: Expose the new methods through `MemoryService`**

In `src/memory/core/service.ts`, add these methods near the other backend pass-through methods:

```ts
  async createReminderFollowUp(input: NewReminderFollowUp): Promise<ReminderFollowUp> {
    const { backend } = getState(this);
    return backend.createReminderFollowUp(input);
  }

  async getActiveReminderFollowUp(userId: string, chatId: string): Promise<ReminderFollowUp | undefined> {
    const { backend } = getState(this);
    return backend.getActiveReminderFollowUp(userId, chatId);
  }

  async consumeReminderFollowUp(id: number): Promise<void> {
    const { backend } = getState(this);
    await backend.consumeReminderFollowUp(id);
  }
```

Add the imported types at the top of the file.

- [ ] **Step 8: Run the persistence test and verify it passes**

Run:

```powershell
bun test tests/memory/reminder-followups.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add tests/memory/reminder-followups.test.ts src/memory/core/types.ts src/memory/core/backend.ts src/memory/backends/sqlite/migrate.ts src/memory/backends/sqlite/backend.ts src/memory/core/service.ts
git commit -m "feat: persist pending reminder follow-ups"
```

---

### Task 2: Add reply-deferred follow-up mode to autonomous jobs

**Files:**
- Modify: `tests/services/autonomous-jobs.test.ts`
- Modify: `tests/cron/autonomous-helpers.test.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/services/autonomous-jobs.ts`
- Modify: `src/cron/autonomous.ts`

- [ ] **Step 1: Write failing tests for `follow_up_mode` persistence and due execution**

Append this test to `tests/services/autonomous-jobs.test.ts`:

```ts
test("persists follow_up_mode on reply-deferred hybrid reminder jobs", () => {
  const { service } = makeService();
  const runAtUnix = Math.floor(Date.UTC(2026, 4, 20, 0, 12, 33) / 1000);

  const job = service.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Jika Terry membalas, tanyakan singkat apakah sudah makan atau perlu diingatkan lagi nanti.",
    jobType: "hybrid",
    messageText: "Terry, ini pengingat untuk makan sekarang.",
    agentPrompt: "Jika Terry membalas, tanyakan singkat apakah sudah makan atau perlu diingatkan lagi nanti.",
    followUpMode: "after_user_reply",
    schedule: { scheduleMode: "once", runAtUnix },
    maxRuns: 1,
  });

  expect(job.followUpMode).toBe("after_user_reply");
  expect(service.getJobById(job.id)?.followUpMode).toBe("after_user_reply");
});
```

Append this test to `tests/cron/autonomous-helpers.test.ts`:

```ts
test("runOneAutonomousJob stores a pending reminder follow-up instead of sending an immediate autonomous answer", async () => {
  const db = makeDb();
  const jobs = new AutonomousJobService(db);
  const job = jobs.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Jika Terry membalas, tanyakan singkat apakah sudah makan atau perlu diingatkan lagi nanti.",
    jobType: "hybrid",
    messageText: "Terry, ini pengingat untuk makan sekarang.",
    agentPrompt: "Jika Terry membalas, tanyakan singkat apakah sudah makan atau perlu diingatkan lagi nanti.",
    followUpMode: "after_user_reply",
    schedule: { scheduleMode: "once", runAtUnix: 1_779_000_000 },
    maxRuns: 1,
  });

  const sent: Array<{ chatId: string; text: string }> = [];
  const createdFollowUps: Array<Record<string, unknown>> = [];
  let runAgentCalls = 0;

  const result = await runOneAutonomousJob({
    db,
    bot: {
      api: {
        sendMessage: async (chatId: string, text: string) => {
          sent.push({ chatId, text });
        },
      },
    } as any,
    memory: {
      createReminderFollowUp: async (input: Record<string, unknown>) => {
        createdFollowUps.push(input);
        return { id: 1, status: "active", createdAt: "2026-05-20T00:12:33.000Z", ...input };
      },
    } as any,
    registry: {} as any,
    llm: {} as any,
    job,
    runAgent: async () => {
      runAgentCalls += 1;
      return "should not run";
    },
    nowUnix: 1_779_000_000,
    finishedUnix: 1_779_000_037,
  });

  expect(sent).toEqual([{ chatId: "chat-1", text: "Terry, ini pengingat untuk makan sekarang." }]);
  expect(createdFollowUps).toEqual([
    expect.objectContaining({
      jobId: job.id,
      chatId: "chat-1",
      userId: "user-1",
      reminderText: "Terry, ini pengingat untuk makan sekarang.",
      followUpPrompt: "Jika Terry membalas, tanyakan singkat apakah sudah makan atau perlu diingatkan lagi nanti.",
    }),
  ]);
  expect(runAgentCalls).toBe(0);
  expect(result.answer).toBe("");
  expect(result.deleted).toBe(true);
});
```

- [ ] **Step 2: Run the job tests and verify they fail**

Run:

```powershell
bun test tests/services/autonomous-jobs.test.ts tests/cron/autonomous-helpers.test.ts
```

Expected: FAIL because `followUpMode` is missing on the job model and `runOneAutonomousJob` always sends the immediate autonomous answer.

- [ ] **Step 3: Add `follow_up_mode` to the autonomous jobs schema**

In `src/db/schema.ts`, update the `autonomous_jobs` table and migration block:

```sql
CREATE TABLE IF NOT EXISTS autonomous_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'agent',
  message_text TEXT NOT NULL DEFAULT '',
  agent_prompt TEXT NOT NULL DEFAULT '',
  follow_up_mode TEXT NOT NULL DEFAULT 'immediate',
  run_at_unix INTEGER,
  run_count INTEGER NOT NULL DEFAULT 0,
  max_runs INTEGER,
  schedule_mode TEXT NOT NULL DEFAULT 'interval',
  interval_sec INTEGER,
  cron_expr TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  last_finished_at INTEGER,
  last_status TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

And add the migration guard:

```ts
  if (!hasColumn(db, "autonomous_jobs", "follow_up_mode")) {
    db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN follow_up_mode TEXT NOT NULL DEFAULT 'immediate'`);
  }
```

- [ ] **Step 4: Persist `followUpMode` on autonomous jobs**

In `src/services/autonomous-jobs.ts`, update the types and SQL mapping:

```ts
export type AutonomousFollowUpMode = "immediate" | "after_user_reply";

export type AutonomousJobRow = {
  id: number;
  chatId: string;
  userId: string;
  prompt: string;
  jobType: AutonomousJobType;
  messageText: string;
  agentPrompt: string;
  followUpMode: AutonomousFollowUpMode;
  runAtUnix: number | null;
  runCount: number;
  maxRuns: number | null;
  enabled: boolean;
  scheduleMode: ScheduleMode;
  intervalSec: number | null;
  cronExpr: string | null;
  lastRunAt: number | null;
  lastFinishedAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  scheduleLabel: string;
};

type AutonomousJobDbRow = {
  id: number;
  chat_id: string;
  user_id: string;
  prompt: string;
  job_type: AutonomousJobType;
  message_text: string;
  agent_prompt: string;
  follow_up_mode: AutonomousFollowUpMode;
  run_at_unix: number | null;
  run_count: number;
  max_runs: number | null;
  enabled: number;
  schedule_mode: ScheduleMode;
  interval_sec: number | null;
  cron_expr: string | null;
  last_run_at: number | null;
  last_finished_at: number | null;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateAutonomousJobInput = {
  chatId: string;
  userId: string;
  prompt: string;
  jobType?: AutonomousJobType;
  messageText?: string;
  agentPrompt?: string;
  followUpMode?: AutonomousFollowUpMode;
  schedule: ScheduleInput;
  maxRuns?: number | null;
};
```

Update `AUTONOMOUS_JOB_COLUMNS`, `mapRow(...)`, and `createJob(...)` so the field is selected, mapped, and inserted with `input.followUpMode ?? "immediate"`.

- [ ] **Step 5: Branch the autonomous runtime by `followUpMode`**

In `src/cron/autonomous.ts`, update the local row type and `runOneAutonomousJob(...)`:

```ts
type AutonomousJobDbRow = {
  id: number;
  chat_id: string;
  user_id: string;
  prompt: string;
  job_type: "agent" | "hybrid";
  message_text: string;
  agent_prompt: string;
  follow_up_mode: "immediate" | "after_user_reply";
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

Then, inside `runOneAutonomousJob(...)`, replace the current hybrid block with this structure:

```ts
    if (input.job.jobType === "hybrid" && input.job.messageText.trim()) {
      const sent = await sendTelegramText(input.bot, input.job.chatId, input.job.messageText, `Failed to send hybrid job text #${input.job.id}`);
      if (!sent) throw new Error(`Failed to send hybrid job text #${input.job.id}`);
    }

    if (input.job.jobType === "hybrid" && input.job.followUpMode === "after_user_reply") {
      await input.memory.createReminderFollowUp({
        jobId: input.job.id,
        chatId: input.job.chatId,
        userId: input.job.userId,
        reminderText: input.job.messageText,
        followUpPrompt: input.job.agentPrompt.trim() || input.job.prompt,
        expiresAt: new Date((finishedAt + 6 * 3600) * 1000).toISOString(),
      });

      jobService.markRunFinished(input.job.id, finishedAt, "success", null);
      const completion = jobService.recordSuccessfulRun(input.job.id);
      emitTrace(input.trace, {
        minLevel: 1,
        source: "autonomous",
        event: "job.complete",
        chatId: input.job.chatId,
        userId: input.job.userId,
        jobId: String(input.job.id),
        payload: { finishedAtUnix: finishedAt, answerLength: 0, deleted: completion.deleted, runCount: completion.runCount },
      });

      return { job: completion.job, answer: "", deleted: completion.deleted, runCount: completion.runCount };
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
      trace: input.trace,
    });
```

- [ ] **Step 6: Run the job tests and verify they pass**

Run:

```powershell
bun test tests/services/autonomous-jobs.test.ts tests/cron/autonomous-helpers.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/services/autonomous-jobs.test.ts tests/cron/autonomous-helpers.test.ts src/db/schema.ts src/services/autonomous-jobs.ts src/cron/autonomous.ts
git commit -m "feat: add reply-deferred reminder follow-up mode"
```

---

### Task 3: Extend L1.5 with pending reminder reply matching

**Files:**
- Modify: `tests/memory/l15.test.ts`
- Modify: `src/memory/offload/types.ts`
- Modify: `src/memory/offload/l15.ts`
- Modify: `src/memory/core/service.ts`

- [ ] **Step 1: Write the failing L1.5 tests**

Append these tests to `tests/memory/l15.test.ts`:

```ts
test("rules match a pending reminder reply without opening a task canvas", () => {
  expect(
    judgeTaskByRules({
      latestUserMessage: "belum nih",
      historicalTasks: [],
      pendingReminder: {
        id: 3,
        jobId: 7,
        reminderText: "Terry, ini pengingat untuk makan sekarang.",
      },
    }),
  ).toEqual({
    taskCompleted: false,
    isLongTask: false,
    isContinuation: false,
    matchesPendingReminderReply: true,
    source: "rules",
  });
});

test("rules do not match unrelated chat just because a pending reminder exists", async () => {
  const llm: LlmProvider = {
    async complete() {
      throw new Error("LLM should not be called in rules mode");
    },
  };

  await expect(
    runL15Judgment({
      latestUserMessage: "siapa nama kamu",
      historicalTasks: [],
      pendingReminder: {
        id: 4,
        jobId: 8,
        reminderText: "Terry, ini pengingat untuk makan sekarang.",
      },
      llm,
      mode: "rules",
      recentMessages: [],
      maxCanvasChars: 1000,
    }),
  ).resolves.toEqual({
    taskCompleted: false,
    isLongTask: false,
    isContinuation: false,
    source: "fallback",
  });
});
```

- [ ] **Step 2: Run the L1.5 tests and verify they fail**

Run:

```powershell
bun test tests/memory/l15.test.ts
```

Expected: FAIL because `pendingReminder` and `matchesPendingReminderReply` do not exist yet.

- [ ] **Step 3: Extend the L1.5 input/output types**

In `src/memory/offload/types.ts`, replace the current type block with this version:

```ts
export type L15PendingReminderSummary = {
  id: number;
  jobId: number;
  reminderText: string;
};

export type L15Input = {
  latestUserMessage: string;
  activeTask?: L15TaskSummary;
  historicalTasks: L15TaskSummary[];
  pendingReminder?: L15PendingReminderSummary;
};

export type L15JudgmentResult = {
  taskCompleted: boolean;
  isLongTask: boolean;
  isContinuation: boolean;
  matchesPendingReminderReply?: boolean;
  selectedTaskId?: number;
  newTaskLabel?: string;
  source: "rules" | "llm" | "fallback";
};
```

- [ ] **Step 4: Add reminder-reply matching to the rules and JSON parser**

In `src/memory/offload/l15.ts`, update the fallback and parser:

```ts
const fallbackResult: L15JudgmentResult = {
  taskCompleted: false,
  isLongTask: false,
  isContinuation: false,
  source: "fallback",
};
```

Add this helper section:

```ts
function hasScheduleLanguage(lower: string): boolean {
  return [
    /\bingatkan\b/u,
    /\bpengingat\b/u,
    /\bjadwalkan\b/u,
    /\bjadwal\b/u,
    /\bsetiap\b/u,
    /\btiap\b/u,
    /\bevery\b/u,
    /\bbesok\b/u,
    /\btomorrow\b/u,
    /\b(\d+)\s*(detik|menit|jam|hari|seconds?|minutes?|hours?|days?)\b/u,
  ].some((pattern) => pattern.test(lower));
}

function isPendingReminderReply(lower: string): boolean {
  if (hasScheduleLanguage(lower)) return true;
  if (/\b(sudah|udah|belum|nanti|ntar|bentar|ya|iya|ok|oke|siap|sip)\b/u.test(lower)) return true;
  return lower.trim().split(/\s+/).filter(Boolean).length <= 4 && /\b(done|beres|kelar)\b/u.test(lower);
}
```

Then, near the top of `judgeTaskByRules(...)`, add:

```ts
  if (input.pendingReminder && isPendingReminderReply(lower)) {
    return {
      taskCompleted: false,
      isLongTask: false,
      isContinuation: false,
      matchesPendingReminderReply: true,
      source: "rules",
    };
  }
```

Update `parseL15Json(...)` so it reads an optional boolean:

```ts
  if (value.matchesPendingReminderReply !== undefined) {
    if (typeof value.matchesPendingReminderReply !== "boolean") return undefined;
    result.matchesPendingReminderReply = value.matchesPendingReminderReply;
  }
```

Update `buildPrompt(...)` so the LLM sees the pending reminder summary and the JSON contract includes `matchesPendingReminderReply`:

```ts
      content: [
        "Judge whether the latest user message completes, continues, or starts a long task.",
        "Return only strict JSON with booleans: taskCompleted, isLongTask, isContinuation.",
        "When a pending reminder exists, also return matchesPendingReminderReply as true or false.",
        "Optionally include selectedTaskId or continuationTaskId and newTaskLabel.",
        "Prefer safe short/no-canvas when uncertain.",
      ].join(" "),
```

And include `pendingReminder: input.pendingReminder` in the final JSON payload.

- [ ] **Step 5: Load pending reminder follow-ups during `judgeTaskTurn(...)`**

In `src/memory/core/service.ts`, change the `Promise.all([...])` call to load the active reminder follow-up too:

```ts
    const [turns, activeTask, historicalTasks, pendingReminder] = await Promise.all([
      interactionLogService.recentMessages(input.userId, input.chatId, options.l15.recentMessages),
      backend.getActiveTaskCanvas(input.userId, input.chatId),
      backend.listTaskCanvases(input.userId, input.chatId, options.l15.historyTaskLimit),
      backend.getActiveReminderFollowUp(input.userId, input.chatId),
    ]);
```

Pass the reminder summary into `runL15Judgment(...)`:

```ts
      pendingReminder: pendingReminder
        ? {
            id: pendingReminder.id,
            jobId: pendingReminder.jobId,
            reminderText: pendingReminder.reminderText,
          }
        : undefined,
```

And change the return statement to surface the matched reminder context:

```ts
    return {
      judgment,
      taskId: judgment.isLongTask ? taskId : undefined,
      reminderFollowUp: judgment.matchesPendingReminderReply ? pendingReminder : undefined,
    };
```

- [ ] **Step 6: Run the L1.5 tests and verify they pass**

Run:

```powershell
bun test tests/memory/l15.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/memory/l15.test.ts src/memory/offload/types.ts src/memory/offload/l15.ts src/memory/core/service.ts
git commit -m "feat: teach l1.5 to match reminder replies"
```

---

### Task 4: Inject matched reminder follow-up context into the chat agent

**Files:**
- Modify: `tests/memory/agent-runtime.test.ts`
- Modify: `src/agent/react-agent.ts`

- [ ] **Step 1: Write the failing runtime integration test**

Append this test to `tests/memory/agent-runtime.test.ts`:

```ts
test("agent runtime injects matched reminder follow-up context and consumes it after replying", async () => {
  let seenMessages: Array<{ role: string; content?: string }> = [];
  const llm = {
    async complete({ messages }: { messages: Array<{ role: string; content?: string }> }) {
      seenMessages = messages;
      return { content: "Oke, mau saya ingatkan lagi nanti?", toolCalls: [] };
    },
  };

  const tempDir = await mkdtemp(join(tmpdir(), "grammy-agent-runtime-"));

  try {
    const db = new Database(":memory:");
    migrate(db);
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
        offloadMinChars: 2500,
        offloadSummaryChars: 900,
        sqliteVecEnabled: true,
        jsonlExportEnabled: false,
        l15: { enabled: true, mode: "rules", recentMessages: 6, historyTaskLimit: 10, maxCanvasChars: 12000, safeFallback: "short" },
        l1: { enabled: true, mode: "local", maxSummaryChars: 900, defaultScore: 5 },
        l2: { enabled: false, mode: "local", triggerMinEntries: 1, maxCanvasChars: 12000 },
        taskRecall: { enabled: true, maxTasks: 3, maxCanvasChars: 2200 },
        l4: { enabled: true, mode: "local", requireCompletedTask: false, maxEvidenceEntries: 80, maxCanvasChars: 20000, maxSkillChars: 20000 },
      },
    });
    await memory.createReminderFollowUp({
      jobId: 7,
      chatId: "c1",
      userId: "u1",
      reminderText: "Terry, ini pengingat untuk makan sekarang.",
      followUpPrompt: "Jika Terry membalas, tanyakan singkat apakah sudah makan atau perlu diingatkan lagi nanti.",
      expiresAt: "2026-05-20T02:00:00.000Z",
    });
    const registry = new ToolRegistry(db);
    registry.registerMany(createLocalTools(memory));

    await runReactAgent({ chatId: "c1", userId: "u1", input: "belum nih", memory, registry, llm: llm as any, mode: "chat" });

    expect(
      seenMessages.some(
        (message) =>
          message.role === "system" &&
          message.content?.includes("Pending reminder follow-up") &&
          message.content.includes("Terry, ini pengingat untuk makan sekarang."),
      ),
    ).toBe(true);
    expect(await memory.getActiveReminderFollowUp("u1", "c1")).toBeUndefined();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}, 20000);
```

- [ ] **Step 2: Run the runtime test and verify it fails**

Run:

```powershell
bun test tests/memory/agent-runtime.test.ts
```

Expected: FAIL because `runReactAgent(...)` never injects reminder follow-up context and never consumes the pending reminder follow-up.

- [ ] **Step 3: Inject matched reminder follow-up context before the tool loop**

In `src/agent/react-agent.ts`, build an extra system message when `taskRouting.reminderFollowUp` exists:

```ts
  const reminderContext = taskRouting.reminderFollowUp
    ? [
        "Pending reminder follow-up matched for the latest user reply.",
        `job_id=${taskRouting.reminderFollowUp.jobId}`,
        `reminder_text=${taskRouting.reminderFollowUp.reminderText}`,
        `follow_up_prompt=${taskRouting.reminderFollowUp.followUpPrompt}`,
        "Keep the reply brief.",
        "If the user already asks for another reminder with a concrete time, create it instead of asking again.",
      ].join("\n")
    : undefined;
```

Then include it in the `messages` array:

```ts
  const messages: AgentMessage[] = [
    { role: "system", content: system },
    { role: "system", content: memoryContext },
    ...(reminderContext ? [{ role: "system", content: `Pending reminder follow-up\n${reminderContext}` } satisfies AgentMessage] : []),
    ...recent
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }) as AgentMessage),
  ];
```

- [ ] **Step 4: Consume the matched reminder follow-up after a final assistant answer**

In the `response.toolCalls.length === 0` branch, consume the reminder follow-up before returning:

```ts
      if (taskRouting.reminderFollowUp) {
        await input.memory.consumeReminderFollowUp(taskRouting.reminderFollowUp.id);
      }
```

In the max-iteration fallback branch near the end of the file, do the same before returning `fallback`:

```ts
  if (taskRouting.reminderFollowUp) {
    await input.memory.consumeReminderFollowUp(taskRouting.reminderFollowUp.id);
  }
```

- [ ] **Step 5: Run the runtime test and verify it passes**

Run:

```powershell
bun test tests/memory/agent-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/memory/agent-runtime.test.ts src/agent/react-agent.ts
git commit -m "feat: route reminder replies through chat mode"
```

---

### Task 5: Update the tool contract and prompt guidance for reply-deferred reminder follow-up

**Files:**
- Modify: `tests/memory/tools.test.ts`
- Modify: `tests/runtime/agent-prompt.test.ts`
- Modify: `src/tools/local.ts`
- Modify: `src/agent/prompts/system.ts`
- Modify: `docs/autonomous-jobs.md`

- [ ] **Step 1: Write the failing tool and prompt tests**

Append this test to `tests/memory/tools.test.ts`:

```ts
test("tdai_create_job passes follow_up_mode through to hybrid reminder jobs", async () => {
  const memory = createMemoryServiceDouble();
  const autonomousJobs = createAutonomousJobsDouble();
  const tools = createLocalTools(memory as any, undefined, autonomousJobs as any);
  const createJob = tools.find((tool) => tool.name === "tdai_create_job");

  await createJob!.execute(
    {
      message_text: "Terry, ini pengingat untuk makan sekarang.",
      agent_prompt: "Jika Terry membalas, tanyakan singkat apakah sudah makan atau perlu diingatkan lagi nanti.",
      follow_up_mode: "after_user_reply",
      schedule: { mode: "once", run_at: "2026-05-20T00:12:33+07:00" },
    },
    { chatId: "chat-1", userId: "user-1", memory: memory as any },
  );

  expect(autonomousJobs.createJob).toHaveBeenCalledWith({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Jika Terry membalas, tanyakan singkat apakah sudah makan atau perlu diingatkan lagi nanti.",
    jobType: "hybrid",
    messageText: "Terry, ini pengingat untuk makan sekarang.",
    agentPrompt: "Jika Terry membalas, tanyakan singkat apakah sudah makan atau perlu diingatkan lagi nanti.",
    followUpMode: "after_user_reply",
    schedule: {
      scheduleMode: "once",
      runAtUnix: Math.floor(Date.parse("2026-05-20T00:12:33+07:00") / 1000),
    },
    maxRuns: 1,
  });
});
```

Update `tests/runtime/agent-prompt.test.ts` with these assertions:

```ts
  expect(prompt).toContain("follow_up_mode");
  expect(prompt).toContain("after_user_reply");
```

- [ ] **Step 2: Run the tool and prompt tests and verify they fail**

Run:

```powershell
bun test tests/memory/tools.test.ts tests/runtime/agent-prompt.test.ts
```

Expected: FAIL because `tdai_create_job` does not accept `follow_up_mode` and the system prompt does not mention reply-deferred reminder follow-up mode.

- [ ] **Step 3: Extend `tdai_create_job` with `follow_up_mode`**

In `src/tools/local.ts`, add the schema field:

```ts
          follow_up_mode: {
            type: "string",
            enum: ["immediate", "after_user_reply"],
            description: "Whether agent_prompt runs immediately when the reminder is due or waits for the user's reply.",
          },
```

Then parse and pass it through:

```ts
        const followUpModeRaw = asString(args.follow_up_mode, "immediate").trim();
        if (followUpModeRaw !== "immediate" && followUpModeRaw !== "after_user_reply") {
          return "follow_up_mode must be one of: immediate, after_user_reply.";
        }
        const followUpMode = followUpModeRaw as "immediate" | "after_user_reply";
```

And update the job creation call:

```ts
        const job = jobs.createJob({
          chatId: ctx.chatId,
          userId: ctx.userId,
          prompt: agentPrompt,
          jobType: "hybrid",
          messageText,
          agentPrompt,
          followUpMode,
          schedule,
          maxRuns,
        });
```

- [ ] **Step 4: Update the system prompt guidance**

In `src/agent/prompts/system.ts`, add these rules:

```ts
- Use tdai_create_job for reminders and scheduled tasks. For relative times, call tdai_current_datetime first, compute an ISO run_at, then create the job.
- tdai_create_job jobs send fixed text first, then either run the agent prompt immediately or defer it until the user replies, depending on follow_up_mode.
- Use follow_up_mode = after_user_reply when the follow-up instruction should happen only after the user responds to the reminder.
- When reply-deferred reminder context is provided in a later chat turn, use the stored follow-up instruction and keep the answer brief.
```

- [ ] **Step 5: Update the reminder jobs doc**

In `docs/autonomous-jobs.md`, replace the current hybrid job sentence with this version:

```md
Hybrid jobs send fixed text first. With `follow_up_mode = immediate`, the scheduler runs the agent prompt right away and sends the autonomous answer. With `follow_up_mode = after_user_reply`, the scheduler stores a pending reminder follow-up and the next matched user reply is handled in normal chat mode.
```

- [ ] **Step 6: Run the tool and prompt tests and verify they pass**

Run:

```powershell
bun test tests/memory/tools.test.ts tests/runtime/agent-prompt.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run the focused verification suite**

Run:

```powershell
bun test tests/memory/reminder-followups.test.ts tests/services/autonomous-jobs.test.ts tests/cron/autonomous-helpers.test.ts tests/memory/l15.test.ts tests/memory/agent-runtime.test.ts tests/memory/tools.test.ts tests/runtime/agent-prompt.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add tests/memory/tools.test.ts tests/runtime/agent-prompt.test.ts src/tools/local.ts src/agent/prompts/system.ts docs/autonomous-jobs.md
git commit -m "feat: expose reply-deferred reminder follow-up routing"
```

---

## Self-Review

### Spec coverage

- Reply-deferred hybrid job mode: covered by Task 2.
- Pending reminder follow-up persistence: covered by Task 1.
- L1.5 reminder-reply matching: covered by Task 3.
- Chat-agent reminder follow-up context injection and consumption: covered by Task 4.
- Tool contract and prompt guidance: covered by Task 5.

### Placeholder scan

- No `TODO`, `TBD`, or “implement later” markers remain.
- Each code-changing step includes exact code blocks.
- Each test step includes exact commands and expected failure/pass behavior.

### Type consistency

- `followUpMode` is used consistently across schema, service, runtime, and tool contract.
- `matchesPendingReminderReply` is used consistently across L1.5 types, rules, and `JudgeTaskTurnResult`.
- Reminder follow-up persistence uses one type family: `ReminderFollowUp` / `NewReminderFollowUp`.

Plan complete and saved to `docs/superpowers/plans/2026-05-20-l15-reminder-follow-up-routing.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
