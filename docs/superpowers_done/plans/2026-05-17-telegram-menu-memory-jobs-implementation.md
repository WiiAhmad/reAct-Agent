# Telegram Menu and Scheduled Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the command-heavy Telegram UX with a button-first menu built on `@grammyjs/conversations`, move autonomous job and memory-update cadence into SQLite-backed per-item settings, and extract the agent prompt plus current-date-time tool without changing the protected L0/L1/L2/L3 memory model.

**Architecture:** The Telegram layer becomes a thin grammY entrypoint plus small UI renderer helpers and conversation modules for multi-step flows. Autonomous jobs and memory updates move behind focused services and a unified scheduler tick that selects due work from SQLite. The agent runtime keeps its current ReAct loop and memory integration, but its system prompt moves into a dedicated module and gains a deterministic current-date-time tool.

**Tech Stack:** Bun, TypeScript, grammY, `@grammyjs/conversations`, `bun:sqlite`, `node-cron`, `cron-parser`, `bun:test`

---

> Commit steps are included for teams that checkpoint each task. If the execution session does **not** have explicit permission to create git commits, skip the commit step and continue.

## File structure

### Runtime and persistence
- Modify: `package.json` — add the cron parsing dependency used for validating and scheduling custom cron expressions.
- Modify: `src/config.ts` — add internal scheduler settings and update the runtime summary to describe Telegram-managed scheduling.
- Modify: `src/db/schema.ts` — expand `autonomous_jobs` with per-item schedule columns and create `memory_update_settings`.
- Create: `src/services/schedules.ts` — normalize schedules, validate cron expressions, compute due times, and format schedule labels.
- Create: `src/services/autonomous-jobs.ts` — CRUD, due-job selection, and run-status tracking for autonomous jobs.
- Create: `src/services/memory-update-settings.ts` — per-user defaults, schedule editing, due-user selection, and status summaries for Memory Update.

### Agent runtime
- Create: `src/agent/prompts/system.ts` — extracted agent system prompt builder.
- Modify: `src/agent/react-agent.ts` — import the prompt builder instead of embedding the prompt inline.
- Modify: `src/tools/local.ts` — add `tdai_current_datetime`.
- Modify: `src/utils/time.ts` — add a reusable current-date-time snapshot helper.

### Telegram UI
- Create: `src/bot/context.ts` — typed grammY context with `ConversationFlavor`.
- Create: `src/bot/ui/keyboards.ts` — inline keyboard builders for start, menu, memory, jobs, and schedule presets.
- Create: `src/bot/ui/renderers.ts` — pure message/summary renderers for start, help, memory, jobs, and Memory Update.
- Create: `src/bot/conversations/memory-update.ts` — run-now, preset schedule, custom cron, and enable/disable flow.
- Create: `src/bot/conversations/job-create.ts` — prompt capture plus schedule capture for new jobs.
- Create: `src/bot/conversations/job-detail.ts` — edit prompt, edit schedule, toggle, and delete flow.
- Modify: `src/bot/bot.ts` — register conversations, simplify commands to `/start`, `/menu`, `/help`, and route callback buttons.

### Scheduling and app wiring
- Modify: `src/cron/autonomous.ts` — convert this file into shared execution helpers for job runs and memory-update runs.
- Create: `src/cron/scheduler.ts` — unified dispatcher tick that pulls due jobs and due memory updates.
- Modify: `src/index.ts` — construct the new services, pass them into the bot, and start the unified scheduler.

### Documentation and tests
- Create: `tests/services/schedules.test.ts`
- Create: `tests/services/autonomous-jobs.test.ts`
- Create: `tests/services/memory-update-settings.test.ts`
- Create: `tests/runtime/agent-prompt.test.ts`
- Create: `tests/bot/ui.test.ts`
- Create: `tests/bot/command-surface.test.ts`
- Create: `tests/cron/scheduler.test.ts`
- Modify: `tests/memory/config.test.ts`
- Modify: `tests/memory/sqlite-backend.test.ts`
- Modify: `tests/memory/tools.test.ts`
- Modify: `tests/memory/agent-runtime.test.ts`
- Modify: `tests/memory/readme.test.ts`
- Modify: `README.md`
- Create: `docs/architecture.md`
- Create: `docs/telegram-flow.md`
- Create: `docs/memory.md`
- Create: `docs/autonomous-jobs.md`

## Task 1: Add schedule primitives and persistence schema

**Files:**
- Modify: `package.json`
- Modify: `src/config.ts`
- Modify: `src/db/schema.ts`
- Create: `src/services/schedules.ts`
- Create: `tests/services/schedules.test.ts`
- Modify: `tests/memory/config.test.ts`
- Modify: `tests/memory/sqlite-backend.test.ts`

- [ ] **Step 1: Write the failing schedule, config, and schema tests**

```ts
// tests/services/schedules.test.ts
import { expect, test } from "bun:test";
import {
  describeSchedule,
  getNextDueAtUnix,
  isScheduleDue,
  normalizeSchedule,
} from "../../src/services/schedules";

test("interval schedules become due after their interval", () => {
  const schedule = normalizeSchedule({ scheduleMode: "interval", intervalSec: 600 });

  expect(getNextDueAtUnix(schedule, 1_715_904_000)).toBe(1_715_904_600);
  expect(isScheduleDue(schedule, 1_715_904_000, 1_715_904_599)).toBe(false);
  expect(isScheduleDue(schedule, 1_715_904_000, 1_715_904_600)).toBe(true);
  expect(describeSchedule(schedule)).toBe("Every 10 minutes");
});

test("cron schedules validate and compute their next run", () => {
  const schedule = normalizeSchedule({ scheduleMode: "cron", cronExpr: "*/15 * * * *" });

  expect(getNextDueAtUnix(schedule, 1_715_904_000)).toBe(1_715_904_900);
  expect(describeSchedule(schedule)).toBe("Cron: */15 * * * *");
});

test("invalid cron schedules throw a useful error", () => {
  expect(() => normalizeSchedule({ scheduleMode: "cron", cronExpr: "not-a-cron" })).toThrow(
    "Invalid cron expression",
  );
});
```

```ts
// tests/memory/config.test.ts (add)
test("parseConfig exposes internal scheduler defaults", () => {
  const runtime = parseConfig({
    BOT_TOKEN: "123:abc",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
  });

  expect(runtime.scheduler.tickCron).toBe("* * * * *");
  expect(runtime.scheduler.maxItemsPerTick).toBe(20);
});
```

```ts
// tests/memory/sqlite-backend.test.ts (add)
test("migrate adds schedule columns and memory update settings storage", () => {
  const db = new Database(":memory:");
  migrate(db);

  const autonomousColumns = new Set(
    (db.query(`PRAGMA table_info(autonomous_jobs)`).all() as Array<{ name: string }>).map((row) => row.name),
  );
  const tableNames = new Set(
    (db.query(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );

  expect(autonomousColumns.has("schedule_mode")).toBe(true);
  expect(autonomousColumns.has("interval_sec")).toBe(true);
  expect(autonomousColumns.has("cron_expr")).toBe(true);
  expect(autonomousColumns.has("last_finished_at")).toBe(true);
  expect(autonomousColumns.has("last_status")).toBe(true);
  expect(autonomousColumns.has("last_error")).toBe(true);
  expect(tableNames.has("memory_update_settings")).toBe(true);
});
```

- [ ] **Step 2: Run the targeted tests and verify they fail**

Run:
```bash
bun test tests/services/schedules.test.ts tests/memory/config.test.ts tests/memory/sqlite-backend.test.ts
```

Expected: FAIL because `src/services/schedules.ts` does not exist yet, `parseConfig` has no `scheduler` object, and the schema has no schedule columns or `memory_update_settings` table.

- [ ] **Step 3: Add the dependency, scheduler config, schema migration, and schedule helpers**

```json
// package.json (dependencies excerpt)
{
  "dependencies": {
    "@anthropic-ai/sdk": "latest",
    "@grammyjs/conversations": "^2.1.1",
    "cron-parser": "latest",
    "grammy": "latest",
    "node-cron": "latest",
    "openai": "latest",
    "sqlite-vec": "latest",
    "yaml": "latest",
    "zod": "latest"
  }
}
```

```ts
// src/config.ts (parseConfig excerpt)
return {
  telegram: {
    botToken: env(source, "BOT_TOKEN"),
  },
  llm: {
    // unchanged
  },
  agent: {
    maxToolIterations: intEnv(source, "MAX_TOOL_ITERATIONS", 6),
    maxRecentMessages: intEnv(source, "MAX_RECENT_MESSAGES", 12),
  },
  storage: {
    dataDir,
    dbPath,
    historyDir,
    memoryDir,
    memoryScenarioDir,
    memoryRefsDir,
    memoryCanvasDir,
    memoryJsonlExportDir,
  },
  memory: {
    maintenanceCron: env(source, "MEMORY_MAINTENANCE_CRON", "*/10 * * * *"),
    recallMaxResults: intEnv(source, "MEMORY_RECALL_MAX_RESULTS", 5),
    offloadEnabled: boolEnv(source, "MEMORY_OFFLOAD_ENABLED", true),
    offloadMinChars: intEnv(source, "MEMORY_OFFLOAD_MIN_CHARS", 2500),
    offloadSummaryChars: intEnv(source, "MEMORY_OFFLOAD_SUMMARY_CHARS", 900),
    sqliteVecEnabled: boolEnv(source, "MEMORY_SQLITE_VEC_ENABLED", true),
    jsonlExportEnabled: boolEnv(source, "MEMORY_JSONL_EXPORT_ENABLED", false),
  },
  autonomous: {
    cron: env(source, "AUTONOMOUS_CRON", "*/10 * * * *"),
    minIntervalSec: intEnv(source, "AUTONOMOUS_MIN_INTERVAL_SEC", 600),
    maxJobsPerTick: intEnv(source, "AUTONOMOUS_MAX_JOBS_PER_TICK", 20),
  },
  scheduler: {
    tickCron: env(source, "SCHEDULER_TICK_CRON", "* * * * *"),
    maxItemsPerTick: intEnv(source, "SCHEDULER_MAX_ITEMS_PER_TICK", 20),
  },
};
```

```ts
// src/db/schema.ts (migration excerpt)
if (!hasColumn(db, "autonomous_jobs", "schedule_mode")) {
  db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN schedule_mode TEXT NOT NULL DEFAULT 'interval'`);
}
if (!hasColumn(db, "autonomous_jobs", "interval_sec")) {
  db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN interval_sec INTEGER NOT NULL DEFAULT 600`);
}
if (!hasColumn(db, "autonomous_jobs", "cron_expr")) {
  db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN cron_expr TEXT`);
}
if (!hasColumn(db, "autonomous_jobs", "last_finished_at")) {
  db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN last_finished_at INTEGER`);
}
if (!hasColumn(db, "autonomous_jobs", "last_status")) {
  db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN last_status TEXT`);
}
if (!hasColumn(db, "autonomous_jobs", "last_error")) {
  db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN last_error TEXT`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS memory_update_settings (
    user_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    schedule_mode TEXT NOT NULL DEFAULT 'interval',
    interval_sec INTEGER NOT NULL DEFAULT 86400,
    cron_expr TEXT,
    last_run_at INTEGER,
    last_finished_at INTEGER,
    last_status TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);
```

```ts
// src/services/schedules.ts
import { CronExpressionParser } from "cron-parser";

export type ScheduleMode = "interval" | "cron";

export type ScheduleInput = {
  scheduleMode: ScheduleMode;
  intervalSec?: number | null;
  cronExpr?: string | null;
};

export type NormalizedSchedule = {
  scheduleMode: ScheduleMode;
  intervalSec: number | null;
  cronExpr: string | null;
};

const presetLabels: Record<number, string> = {
  600: "Every 10 minutes",
  1800: "Every 30 minutes",
  3600: "Every 1 hour",
  21600: "Every 6 hours",
  43200: "Every 12 hours",
  86400: "Every 24 hours",
};

export function normalizeSchedule(input: ScheduleInput): NormalizedSchedule {
  if (input.scheduleMode === "interval") {
    const intervalSec = Number(input.intervalSec ?? 0);
    if (!Number.isInteger(intervalSec) || intervalSec < 60) {
      throw new Error("Interval schedules require intervalSec >= 60.");
    }
    return { scheduleMode: "interval", intervalSec, cronExpr: null };
  }

  const cronExpr = (input.cronExpr ?? "").trim();
  try {
    CronExpressionParser.parse(cronExpr);
  } catch (error) {
    throw new Error(`Invalid cron expression: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { scheduleMode: "cron", intervalSec: null, cronExpr };
}

export function getNextDueAtUnix(schedule: NormalizedSchedule, anchorUnix: number): number {
  if (schedule.scheduleMode === "interval") {
    return anchorUnix + schedule.intervalSec!;
  }

  const next = CronExpressionParser.parse(schedule.cronExpr!, {
    currentDate: new Date(anchorUnix * 1000),
  }).next();
  return Math.floor(next.getTime() / 1000);
}

export function isScheduleDue(schedule: NormalizedSchedule, anchorUnix: number, nowUnix: number): boolean {
  return getNextDueAtUnix(schedule, anchorUnix) <= nowUnix;
}

export function describeSchedule(schedule: NormalizedSchedule): string {
  if (schedule.scheduleMode === "interval") {
    return presetLabels[schedule.intervalSec!] ?? `Every ${schedule.intervalSec} seconds`;
  }
  return `Cron: ${schedule.cronExpr}`;
}
```

- [ ] **Step 4: Run the targeted tests and typecheck**

Run:
```bash
bun test tests/services/schedules.test.ts tests/memory/config.test.ts tests/memory/sqlite-backend.test.ts && bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

If commits are authorized for this execution session, run:
```bash
git add package.json src/config.ts src/db/schema.ts src/services/schedules.ts tests/services/schedules.test.ts tests/memory/config.test.ts tests/memory/sqlite-backend.test.ts
git commit -m "feat: add schedule primitives for telegram automation"
```

## Task 2: Add autonomous job and memory update services

**Files:**
- Create: `src/services/autonomous-jobs.ts`
- Create: `src/services/memory-update-settings.ts`
- Create: `tests/services/autonomous-jobs.test.ts`
- Create: `tests/services/memory-update-settings.test.ts`

- [ ] **Step 1: Write the failing service tests**

```ts
// tests/services/autonomous-jobs.test.ts
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { migrate } from "../../src/db/schema";
import { AutonomousJobService } from "../../src/services/autonomous-jobs";

test("autonomous job service creates jobs with a schedule label", async () => {
  const db = new Database(":memory:");
  migrate(db);
  const jobs = new AutonomousJobService(db);

  const created = await jobs.createJob({
    chatId: "c1",
    userId: "u1",
    prompt: "cek memory saya",
    schedule: { scheduleMode: "interval", intervalSec: 600 },
  });

  expect(created.prompt).toBe("cek memory saya");
  expect(created.scheduleLabel).toBe("Every 10 minutes");
  expect(created.enabled).toBe(true);
});

test("autonomous job service finds due jobs from created_at or last_finished_at", async () => {
  const db = new Database(":memory:");
  migrate(db);
  const jobs = new AutonomousJobService(db);

  const created = await jobs.createJob({
    chatId: "c1",
    userId: "u1",
    prompt: "ringkas aktivitas",
    schedule: { scheduleMode: "interval", intervalSec: 600 },
  });

  const dueSoon = await jobs.listDueJobs(Math.floor(Date.parse(created.createdAt) / 1000) + 599, 10);
  const dueLater = await jobs.listDueJobs(Math.floor(Date.parse(created.createdAt) / 1000) + 600, 10);

  expect(dueSoon).toHaveLength(0);
  expect(dueLater.map((job) => job.id)).toEqual([created.id]);
});
```

```ts
// tests/services/memory-update-settings.test.ts
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { migrate } from "../../src/db/schema";
import { MemoryUpdateSettingsService } from "../../src/services/memory-update-settings";

test("memory update settings default to enabled every 24 hours", async () => {
  const db = new Database(":memory:");
  migrate(db);
  const settings = new MemoryUpdateSettingsService(db);

  const row = await settings.getOrCreate("u1");

  expect(row.enabled).toBe(true);
  expect(row.scheduleMode).toBe("interval");
  expect(row.intervalSec).toBe(86400);
  expect(row.scheduleLabel).toBe("Every 24 hours");
});

test("memory update settings accept custom cron expressions", async () => {
  const db = new Database(":memory:");
  migrate(db);
  const settings = new MemoryUpdateSettingsService(db);

  await settings.updateSchedule("u1", { scheduleMode: "cron", cronExpr: "0 9 * * *" });
  const row = await settings.getOrCreate("u1");

  expect(row.scheduleMode).toBe("cron");
  expect(row.cronExpr).toBe("0 9 * * *");
  expect(row.scheduleLabel).toBe("Cron: 0 9 * * *");
});
```

- [ ] **Step 2: Run the service tests and verify they fail**

Run:
```bash
bun test tests/services/autonomous-jobs.test.ts tests/services/memory-update-settings.test.ts
```

Expected: FAIL because the service files do not exist yet.

- [ ] **Step 3: Implement the two services with focused CRUD and due-selection APIs**

```ts
// src/services/autonomous-jobs.ts
import type { Database } from "bun:sqlite";
import { nowIso } from "../utils/time";
import { describeSchedule, isScheduleDue, normalizeSchedule, type ScheduleInput } from "./schedules";

export type AutonomousJobRecord = {
  id: number;
  chatId: string;
  userId: string;
  prompt: string;
  enabled: boolean;
  scheduleMode: "interval" | "cron";
  intervalSec: number | null;
  cronExpr: string | null;
  scheduleLabel: string;
  lastRunAt: number | null;
  lastFinishedAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type JobRow = {
  id: number;
  chat_id: string;
  user_id: string;
  prompt: string;
  enabled: number;
  schedule_mode: "interval" | "cron";
  interval_sec: number | null;
  cron_expr: string | null;
  last_run_at: number | null;
  last_finished_at: number | null;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function mapJob(row: JobRow): AutonomousJobRecord {
  const schedule = normalizeSchedule({
    scheduleMode: row.schedule_mode,
    intervalSec: row.interval_sec,
    cronExpr: row.cron_expr,
  });
  return {
    id: row.id,
    chatId: row.chat_id,
    userId: row.user_id,
    prompt: row.prompt,
    enabled: row.enabled === 1,
    scheduleMode: row.schedule_mode,
    intervalSec: row.interval_sec,
    cronExpr: row.cron_expr,
    scheduleLabel: describeSchedule(schedule),
    lastRunAt: row.last_run_at,
    lastFinishedAt: row.last_finished_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AutonomousJobService {
  constructor(private readonly db: Database) {}

  async createJob(input: { chatId: string; userId: string; prompt: string; schedule: ScheduleInput }) {
    const schedule = normalizeSchedule(input.schedule);
    const now = nowIso();
    const result = this.db.query(`
      INSERT INTO autonomous_jobs (
        chat_id, user_id, prompt, enabled, schedule_mode, interval_sec, cron_expr, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
    `).run(
      input.chatId,
      input.userId,
      input.prompt.trim(),
      schedule.scheduleMode,
      schedule.intervalSec,
      schedule.cronExpr,
      now,
      now,
    );
    return this.getJob(Number(result.lastInsertRowid), input.chatId);
  }

  async getJob(id: number, chatId: string) {
    const row = this.db.query(`SELECT * FROM autonomous_jobs WHERE id = ? AND chat_id = ?`).get(id, chatId) as JobRow | undefined;
    if (!row) throw new Error(`Autonomous job ${id} not found.`);
    return mapJob(row);
  }

  async listJobs(chatId: string, limit = 20) {
    const rows = this.db
      .query(`SELECT * FROM autonomous_jobs WHERE chat_id = ? ORDER BY id DESC LIMIT ?`)
      .all(chatId, limit) as JobRow[];
    return rows.map(mapJob);
  }

  async updatePrompt(id: number, chatId: string, prompt: string) {
    this.db.query(`UPDATE autonomous_jobs SET prompt = ?, updated_at = ? WHERE id = ? AND chat_id = ?`).run(
      prompt.trim(),
      nowIso(),
      id,
      chatId,
    );
    return this.getJob(id, chatId);
  }

  async updateSchedule(id: number, chatId: string, scheduleInput: ScheduleInput) {
    const schedule = normalizeSchedule(scheduleInput);
    this.db.query(`
      UPDATE autonomous_jobs
      SET schedule_mode = ?, interval_sec = ?, cron_expr = ?, updated_at = ?
      WHERE id = ? AND chat_id = ?
    `).run(schedule.scheduleMode, schedule.intervalSec, schedule.cronExpr, nowIso(), id, chatId);
    return this.getJob(id, chatId);
  }

  async setEnabled(id: number, chatId: string, enabled: boolean) {
    this.db.query(`UPDATE autonomous_jobs SET enabled = ?, updated_at = ? WHERE id = ? AND chat_id = ?`).run(
      enabled ? 1 : 0,
      nowIso(),
      id,
      chatId,
    );
    return this.getJob(id, chatId);
  }

  async deleteJob(id: number, chatId: string) {
    this.db.query(`DELETE FROM autonomous_jobs WHERE id = ? AND chat_id = ?`).run(id, chatId);
  }

  async listDueJobs(nowUnix: number, limit: number) {
    const rows = this.db
      .query(`SELECT * FROM autonomous_jobs WHERE enabled = 1 ORDER BY COALESCE(last_finished_at, 0) ASC, id ASC`)
      .all() as JobRow[];
    return rows
      .map(mapJob)
      .filter((job) => {
        const anchorUnix = job.lastFinishedAt ?? Math.floor(Date.parse(job.createdAt) / 1000);
        return isScheduleDue(
          normalizeSchedule({
            scheduleMode: job.scheduleMode,
            intervalSec: job.intervalSec,
            cronExpr: job.cronExpr,
          }),
          anchorUnix,
          nowUnix,
        );
      })
      .slice(0, limit);
  }

  async markRunStarted(id: number, startedAtUnix: number) {
    this.db.query(`UPDATE autonomous_jobs SET last_run_at = ?, updated_at = ? WHERE id = ?`).run(startedAtUnix, nowIso(), id);
  }

  async markRunFinished(id: number, input: { finishedAtUnix: number; status: "success" | "error"; error?: string | null }) {
    this.db.query(`
      UPDATE autonomous_jobs
      SET last_finished_at = ?, last_status = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(input.finishedAtUnix, input.status, input.error ?? null, nowIso(), id);
  }
}
```

```ts
// src/services/memory-update-settings.ts
import type { Database } from "bun:sqlite";
import { nowIso } from "../utils/time";
import { describeSchedule, isScheduleDue, normalizeSchedule, type ScheduleInput } from "./schedules";

export type MemoryUpdateSettingRecord = {
  userId: string;
  enabled: boolean;
  scheduleMode: "interval" | "cron";
  intervalSec: number | null;
  cronExpr: string | null;
  scheduleLabel: string;
  lastRunAt: number | null;
  lastFinishedAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type SettingRow = {
  user_id: string;
  enabled: number;
  schedule_mode: "interval" | "cron";
  interval_sec: number | null;
  cron_expr: string | null;
  last_run_at: number | null;
  last_finished_at: number | null;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function mapSetting(row: SettingRow): MemoryUpdateSettingRecord {
  const schedule = normalizeSchedule({
    scheduleMode: row.schedule_mode,
    intervalSec: row.interval_sec,
    cronExpr: row.cron_expr,
  });
  return {
    userId: row.user_id,
    enabled: row.enabled === 1,
    scheduleMode: row.schedule_mode,
    intervalSec: row.interval_sec,
    cronExpr: row.cron_expr,
    scheduleLabel: describeSchedule(schedule),
    lastRunAt: row.last_run_at,
    lastFinishedAt: row.last_finished_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class MemoryUpdateSettingsService {
  constructor(private readonly db: Database) {}

  async getOrCreate(userId: string) {
    const existing = this.db.query(`SELECT * FROM memory_update_settings WHERE user_id = ?`).get(userId) as SettingRow | undefined;
    if (existing) return mapSetting(existing);

    const now = nowIso();
    this.db.query(`
      INSERT INTO memory_update_settings (
        user_id, enabled, schedule_mode, interval_sec, cron_expr, created_at, updated_at
      ) VALUES (?, 1, 'interval', 86400, NULL, ?, ?)
    `).run(userId, now, now);
    return this.getOrCreate(userId);
  }

  async updateSchedule(userId: string, input: ScheduleInput) {
    const schedule = normalizeSchedule(input);
    await this.getOrCreate(userId);
    this.db.query(`
      UPDATE memory_update_settings
      SET schedule_mode = ?, interval_sec = ?, cron_expr = ?, updated_at = ?
      WHERE user_id = ?
    `).run(schedule.scheduleMode, schedule.intervalSec, schedule.cronExpr, nowIso(), userId);
    return this.getOrCreate(userId);
  }

  async setEnabled(userId: string, enabled: boolean) {
    await this.getOrCreate(userId);
    this.db.query(`UPDATE memory_update_settings SET enabled = ?, updated_at = ? WHERE user_id = ?`).run(
      enabled ? 1 : 0,
      nowIso(),
      userId,
    );
    return this.getOrCreate(userId);
  }

  async listDueUsers(nowUnix: number, limit: number) {
    const rows = this.db.query(`SELECT * FROM memory_update_settings WHERE enabled = 1 ORDER BY COALESCE(last_finished_at, 0) ASC, user_id ASC`).all() as SettingRow[];
    return rows
      .map(mapSetting)
      .filter((setting) => {
        const anchorUnix = setting.lastFinishedAt ?? Math.floor(Date.parse(setting.createdAt) / 1000);
        return isScheduleDue(
          normalizeSchedule({
            scheduleMode: setting.scheduleMode,
            intervalSec: setting.intervalSec,
            cronExpr: setting.cronExpr,
          }),
          anchorUnix,
          nowUnix,
        );
      })
      .slice(0, limit);
  }

  async markRunStarted(userId: string, startedAtUnix: number) {
    await this.getOrCreate(userId);
    this.db.query(`UPDATE memory_update_settings SET last_run_at = ?, updated_at = ? WHERE user_id = ?`).run(
      startedAtUnix,
      nowIso(),
      userId,
    );
  }

  async markRunFinished(userId: string, input: { finishedAtUnix: number; status: "success" | "error"; error?: string | null }) {
    await this.getOrCreate(userId);
    this.db.query(`
      UPDATE memory_update_settings
      SET last_finished_at = ?, last_status = ?, last_error = ?, updated_at = ?
      WHERE user_id = ?
    `).run(input.finishedAtUnix, input.status, input.error ?? null, nowIso(), userId);
  }

  renderSummary(setting: MemoryUpdateSettingRecord) {
    return [
      `enabled=${setting.enabled ? "yes" : "no"}`,
      `schedule=${setting.scheduleLabel}`,
      `last_run=${setting.lastRunAt ?? "never"}`,
      `last_status=${setting.lastStatus ?? "never"}`,
      `last_error=${setting.lastError ?? "none"}`,
    ].join("\n");
  }
}
```

- [ ] **Step 4: Run the service tests and typecheck**

Run:
```bash
bun test tests/services/autonomous-jobs.test.ts tests/services/memory-update-settings.test.ts && bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

If commits are authorized for this execution session, run:
```bash
git add src/services/autonomous-jobs.ts src/services/memory-update-settings.ts tests/services/autonomous-jobs.test.ts tests/services/memory-update-settings.test.ts
git commit -m "feat: add telegram-managed automation services"
```

## Task 3: Extract the agent prompt and add the current-date-time tool

**Files:**
- Create: `src/agent/prompts/system.ts`
- Modify: `src/agent/react-agent.ts`
- Modify: `src/tools/local.ts`
- Modify: `src/utils/time.ts`
- Create: `tests/runtime/agent-prompt.test.ts`
- Modify: `tests/memory/tools.test.ts`
- Modify: `tests/memory/agent-runtime.test.ts`

- [ ] **Step 1: Write the failing prompt and tool tests**

```ts
// tests/runtime/agent-prompt.test.ts
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildAgentSystemPrompt } from "../../src/agent/prompts/system";

test("react-agent imports the system prompt builder instead of embedding the prompt", () => {
  const source = readFileSync(new URL("../../src/agent/react-agent.ts", import.meta.url), "utf8");

  expect(source.includes("buildAgentSystemPrompt")).toBe(true);
  expect(source.includes("Use a ReAct-style loop internally:")).toBe(false);
});

test("system prompt documents the new telegram runtime", () => {
  const prompt = buildAgentSystemPrompt();

  expect(prompt).toContain("/start, /menu, and /help");
  expect(prompt).toContain("Memory Update");
  expect(prompt).toContain("tdai_current_datetime");
});
```

```ts
// tests/memory/tools.test.ts (replace the tool list expectation)
expect(tools.map((tool) => tool.name)).toEqual([
  "tdai_memory_search",
  "tdai_conversation_search",
  "tdai_context_ref_read",
  "tdai_memory_status",
  "tdai_current_datetime",
  "save_memory",
  "telegram_send_message",
]);
```

```ts
// tests/memory/tools.test.ts (add)
test("current datetime tool returns timestamp fields", async () => {
  const memory = createMemoryServiceDouble();
  const tools = createLocalTools(memory as any);
  const currentDateTime = tools.find((tool) => tool.name === "tdai_current_datetime");

  expect(currentDateTime).toBeDefined();
  await expect(
    currentDateTime!.execute({}, { chatId: "c1", userId: "u1", memory: memory as any }),
  ).resolves.toContain("iso=");
});
```

```ts
// tests/memory/agent-runtime.test.ts (add after registry registration)
expect(registry.list().some((tool) => tool.name === "tdai_current_datetime")).toBe(true);
```

- [ ] **Step 2: Run the targeted tests and verify they fail**

Run:
```bash
bun test tests/runtime/agent-prompt.test.ts tests/memory/tools.test.ts tests/memory/agent-runtime.test.ts
```

Expected: FAIL because the prompt module does not exist yet and the tool registry does not include `tdai_current_datetime`.

- [ ] **Step 3: Extract the prompt and add the tool**

```ts
// src/utils/time.ts
export type DateTimeSnapshot = {
  iso: string;
  unix: number;
  local: string;
  timezone: string;
  offsetMinutes: number;
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

export function currentDateTimeSnapshot(now = new Date()): DateTimeSnapshot {
  return {
    iso: now.toISOString(),
    unix: Math.floor(now.getTime() / 1000),
    local: now.toLocaleString("sv-SE", { hour12: false }),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    offsetMinutes: -now.getTimezoneOffset(),
  };
}
```

```ts
// src/agent/prompts/system.ts
export function buildAgentSystemPrompt() {
  return [
    "You are a Telegram AI agent running on grammY with built-in local tools and a project-owned local memory backend.",
    "",
    "The Telegram UX is menu-driven. Public commands are only /start, /menu, and /help.",
    "Memory Update and Jobs are managed through Telegram buttons and structured flows.",
    "The protected L0/L1/L2/L3 memory model, offload refs, and Mermaid canvas must stay conceptually unchanged.",
    "",
    "Use a ReAct-style loop internally:",
    "1. Understand the user goal.",
    "2. Recall memory first, especially L3 Persona and L2 Scenarios.",
    "3. Decide whether a tool is needed.",
    "4. Call tools when useful.",
    "5. Observe tool results. If a result was offloaded, use tdai_context_ref_read only when raw details are needed.",
    "6. Use tdai_current_datetime when accurate current timestamps matter.",
    "7. Answer clearly in the user's language.",
    "",
    "Rules:",
    "- Do not reveal hidden chain-of-thought. Give concise reasoning summaries only when useful.",
    "- Prefer tools for fresh/private/actionable data.",
    "- Use save_memory only for durable preferences, stable project context, or reusable workflow facts.",
    "- If a tool fails, recover or explain the limitation.",
    "- For Telegram, keep the final answer practical and not too long.",
  ].join("\n");
}
```

```ts
// src/agent/react-agent.ts (imports and system prompt excerpt)
import { buildAgentSystemPrompt } from "./prompts/system";

// ...
const system = buildAgentSystemPrompt();
```

```ts
// src/tools/local.ts (new tool entry excerpt)
import { currentDateTimeSnapshot } from "../utils/time";

{
  name: "tdai_current_datetime",
  source: "local",
  description: "Return the current ISO timestamp, Unix timestamp, local datetime string, timezone, and offset.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async execute() {
    const now = currentDateTimeSnapshot();
    return [
      `iso=${now.iso}`,
      `unix=${now.unix}`,
      `local=${now.local}`,
      `timezone=${now.timezone}`,
      `offset_minutes=${now.offsetMinutes}`,
    ].join("\n");
  },
},
```

- [ ] **Step 4: Run the targeted tests and typecheck**

Run:
```bash
bun test tests/runtime/agent-prompt.test.ts tests/memory/tools.test.ts tests/memory/agent-runtime.test.ts && bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

If commits are authorized for this execution session, run:
```bash
git add src/agent/prompts/system.ts src/agent/react-agent.ts src/tools/local.ts src/utils/time.ts tests/runtime/agent-prompt.test.ts tests/memory/tools.test.ts tests/memory/agent-runtime.test.ts
git commit -m "refactor: extract agent prompt and add current datetime tool"
```

## Task 4: Add pure Telegram UI renderers and keyboards

**Files:**
- Create: `src/bot/ui/keyboards.ts`
- Create: `src/bot/ui/renderers.ts`
- Create: `tests/bot/ui.test.ts`

- [ ] **Step 1: Write the failing UI tests**

```ts
// tests/bot/ui.test.ts
import { expect, test } from "bun:test";
import {
  renderHelpScreen,
  renderMainMenuScreen,
  renderStartScreen,
} from "../../src/bot/ui/renderers";

test("start screen shows Menu and Help buttons and only public commands", () => {
  const screen = renderStartScreen();

  expect(screen.text).toContain("/menu");
  expect(screen.text).toContain("/help");
  expect(screen.text).not.toContain("/memory_force");
  expect(screen.text).not.toContain("/tools");
  expect(screen.replyMarkup.inline_keyboard[0]?.map((button) => button.text)).toEqual(["Menu", "Help"]);
});

test("main menu shows memory jobs and help entries", () => {
  const screen = renderMainMenuScreen();
  expect(screen.replyMarkup.inline_keyboard.flat().map((button) => button.text)).toEqual([
    "Memory",
    "Jobs",
    "Help",
  ]);
});

test("help screen documents the reduced command surface", () => {
  const screen = renderHelpScreen();
  expect(screen.text).toContain("/start");
  expect(screen.text).toContain("/menu");
  expect(screen.text).toContain("/help");
  expect(screen.text).not.toContain("/job ");
  expect(screen.text).not.toContain("/memory_force");
});
```

- [ ] **Step 2: Run the UI tests and verify they fail**

Run:
```bash
bun test tests/bot/ui.test.ts
```

Expected: FAIL because the renderer files do not exist yet.

- [ ] **Step 3: Create the keyboard builders and screen renderers**

```ts
// src/bot/ui/keyboards.ts
import { InlineKeyboard } from "grammy";

export function startKeyboard() {
  return new InlineKeyboard().text("Menu", "menu:open").text("Help", "help:open");
}

export function mainMenuKeyboard() {
  return new InlineKeyboard().text("Memory", "memory:open").row().text("Jobs", "jobs:open").row().text("Help", "help:open");
}

export function memorySummaryKeyboard() {
  return new InlineKeyboard().text("Memory Update", "memory:update:open").row().text("Back", "menu:open");
}

export function memoryUpdateKeyboard(enabled: boolean) {
  return new InlineKeyboard()
    .text("Run now", "memory:update:run-now")
    .text(enabled ? "Disable" : "Enable", enabled ? "memory:update:disable" : "memory:update:enable")
    .row()
    .text("6h", "memory:update:preset:21600")
    .text("12h", "memory:update:preset:43200")
    .text("24h", "memory:update:preset:86400")
    .row()
    .text("Custom cron", "memory:update:custom")
    .row()
    .text("Cancel", "memory:update:cancel");
}

export function jobsKeyboard(jobIds: number[]) {
  const keyboard = new InlineKeyboard().text("Add Job", "jobs:create").row();
  for (const id of jobIds) {
    keyboard.text(`Job #${id}`, `jobs:detail:${id}`).row();
  }
  return keyboard.text("Refresh Jobs", "jobs:open").row().text("Back", "menu:open");
}

export function jobDetailKeyboard(jobId: number, enabled: boolean) {
  return new InlineKeyboard()
    .text("Edit Prompt", `job:${jobId}:edit-prompt`)
    .text("Change Schedule", `job:${jobId}:change-schedule`)
    .row()
    .text(enabled ? "Disable" : "Enable", enabled ? `job:${jobId}:disable` : `job:${jobId}:enable`)
    .text("Delete", `job:${jobId}:delete`)
    .row()
    .text("Cancel", `job:${jobId}:cancel`);
}

export function helpKeyboard() {
  return new InlineKeyboard().text("Menu", "menu:open");
}

export function schedulePresetKeyboard(prefix: string) {
  return new InlineKeyboard()
    .text("10m", `${prefix}:preset:600`)
    .text("30m", `${prefix}:preset:1800`)
    .text("1h", `${prefix}:preset:3600`)
    .row()
    .text("6h", `${prefix}:preset:21600`)
    .text("12h", `${prefix}:preset:43200`)
    .text("24h", `${prefix}:preset:86400`)
    .row()
    .text("Custom cron", `${prefix}:custom`)
    .row()
    .text("Cancel", `${prefix}:cancel`);
}
```

```ts
// src/bot/ui/renderers.ts
import {
  helpKeyboard,
  jobDetailKeyboard,
  jobsKeyboard,
  mainMenuKeyboard,
  memorySummaryKeyboard,
  memoryUpdateKeyboard,
  startKeyboard,
} from "./keyboards";

export function renderStartScreen() {
  return {
    text: [
      "Halo. Bot siap.",
      "Gunakan tombol di bawah atau /menu kapan saja.",
      "Command publik: /start, /menu, /help",
    ].join("\n"),
    replyMarkup: startKeyboard(),
  };
}

export function renderMainMenuScreen() {
  return {
    text: "Menu utama\n\nPilih Memory, Jobs, atau Help.",
    replyMarkup: mainMenuKeyboard(),
  };
}

export function renderHelpScreen() {
  return {
    text: [
      "Bantuan singkat",
      "- /start: onboarding awal",
      "- /menu: buka menu utama",
      "- /help: tampilkan bantuan ini",
      "",
      "Memory Update dan Jobs dikelola lewat tombol menu.",
    ].join("\n"),
    replyMarkup: helpKeyboard(),
  };
}

export function renderMemorySummaryScreen(input: { status: string; persona: string; scenarios: string[]; atoms: string[]; hasCanvas: boolean; memoryUpdateSummary: string }) {
  return {
    text: [
      "# Memory",
      input.status,
      "",
      "# Memory Update",
      input.memoryUpdateSummary,
      "",
      "# L3 Persona",
      input.persona,
      "",
      "# L2 Scenarios",
      input.scenarios.length ? input.scenarios.map((title) => `- ${title}`).join("\n") : "Belum ada scenario.",
      "",
      "# Top L1 atoms",
      input.atoms.length ? input.atoms.map((atom) => `- ${atom}`).join("\n") : "Belum ada memory atom.",
      "",
      `# Active canvas\n${input.hasCanvas ? "Ada di data/memory/canvases/." : "Belum ada canvas."}`,
    ].join("\n"),
    replyMarkup: memorySummaryKeyboard(),
  };
}

export function renderMemoryUpdateScreen(summary: string, enabled: boolean) {
  return {
    text: [
      "Memory Update",
      summary,
      "",
      "Pilih Run now, Enable/Disable, preset, atau custom cron.",
    ].join("\n"),
    replyMarkup: memoryUpdateKeyboard(enabled),
  };
}

export function renderJobsScreen(lines: string[], jobIds: number[]) {
  return {
    text: lines.length ? ["# Jobs", ...lines].join("\n\n") : "# Jobs\n\nBelum ada autonomous jobs.",
    replyMarkup: jobsKeyboard(jobIds),
  };
}

export function renderJobDetailScreen(job: {
  id: number;
  enabled: boolean;
  prompt: string;
  scheduleLabel: string;
  lastRunAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
}) {
  return {
    text: [
      `Job #${job.id}`,
      `enabled=${job.enabled ? "yes" : "no"}`,
      `schedule=${job.scheduleLabel}`,
      `last_run=${job.lastRunAt ?? "never"}`,
      `last_status=${job.lastStatus ?? "never"}`,
      `last_error=${job.lastError ?? "none"}`,
      "",
      job.prompt,
    ].join("\n"),
    replyMarkup: jobDetailKeyboard(job.id, job.enabled),
  };
}
```

- [ ] **Step 4: Run the UI tests and typecheck**

Run:
```bash
bun test tests/bot/ui.test.ts && bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

If commits are authorized for this execution session, run:
```bash
git add src/bot/ui/keyboards.ts src/bot/ui/renderers.ts tests/bot/ui.test.ts
git commit -m "feat: add telegram menu renderers"
```

## Task 5: Replace the command surface and wire button-driven conversations

**Files:**
- Create: `src/bot/context.ts`
- Create: `src/bot/conversations/memory-update.ts`
- Create: `src/bot/conversations/job-create.ts`
- Create: `src/bot/conversations/job-detail.ts`
- Modify: `src/bot/bot.ts`
- Modify: `src/index.ts`
- Modify: `src/cron/autonomous.ts`
- Create: `tests/bot/command-surface.test.ts`

- [ ] **Step 1: Write the failing command-surface test**

```ts
// tests/bot/command-surface.test.ts
import { expect, test } from "bun:test";
import { PUBLIC_COMMANDS } from "../../src/bot/bot";

test("public telegram commands are limited to start menu and help", () => {
  expect(PUBLIC_COMMANDS).toEqual(["start", "menu", "help"]);
});
```

- [ ] **Step 2: Run the command-surface test and verify it fails**

Run:
```bash
bun test tests/bot/command-surface.test.ts
```

Expected: FAIL because `PUBLIC_COMMANDS` is not exported and the bot still defines the old commands.

- [ ] **Step 3: Add typed conversation context, execution helpers, and the new bot flows**

```ts
// src/bot/context.ts
import type { Context } from "grammy";
import type { Conversation, ConversationFlavor } from "@grammyjs/conversations";

export type BotContext = ConversationFlavor<Context>;
export type BotConversation = Conversation<BotContext, Context>;
```

```ts
// src/cron/autonomous.ts
import type { Bot } from "grammy";
import type { LlmProvider } from "../agent/types";
import { runReactAgent } from "../agent/react-agent";
import type { MemoryService } from "../memory/core/service";
import type { ToolRegistry } from "../tools/registry";
import { splitTelegramMessage, truncateText } from "../utils/text";
import { unixNow } from "../utils/time";
import { AutonomousJobService, type AutonomousJobRecord } from "../services/autonomous-jobs";
import { MemoryUpdateSettingsService } from "../services/memory-update-settings";

export async function runAutonomousJobOnce(input: {
  bot: Bot;
  job: AutonomousJobRecord;
  jobs: AutonomousJobService;
  memory: MemoryService;
  registry: ToolRegistry;
  llm: LlmProvider;
}) {
  const startedAt = unixNow();
  await input.jobs.markRunStarted(input.job.id, startedAt);

  try {
    const answer = await runReactAgent({
      chatId: input.job.chatId,
      userId: input.job.userId,
      input: `[AUTONOMOUS_JOB #${input.job.id}] ${input.job.prompt}`,
      memory: input.memory,
      registry: input.registry,
      llm: input.llm,
      mode: "autonomous",
    });

    await input.jobs.markRunFinished(input.job.id, {
      finishedAtUnix: unixNow(),
      status: "success",
      error: null,
    });

    const text = `🤖 Autonomous job #${input.job.id}\n\n${truncateText(answer, 3500)}`;
    for (const chunk of splitTelegramMessage(text)) {
      await input.bot.api.sendMessage(input.job.chatId, chunk);
    }
  } catch (error) {
    await input.jobs.markRunFinished(input.job.id, {
      finishedAtUnix: unixNow(),
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function runMemoryUpdateOnce(input: {
  userId: string;
  memory: MemoryService;
  settings: MemoryUpdateSettingsService;
}) {
  const startedAt = unixNow();
  await input.settings.markRunStarted(input.userId, startedAt);

  try {
    await input.memory.runMaintenanceForUser(input.userId, true);
    await input.settings.markRunFinished(input.userId, {
      finishedAtUnix: unixNow(),
      status: "success",
      error: null,
    });
  } catch (error) {
    await input.settings.markRunFinished(input.userId, {
      finishedAtUnix: unixNow(),
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
```

```ts
// src/bot/conversations/memory-update.ts
import type { MemoryService } from "../../memory/core/service";
import { runMemoryUpdateOnce } from "../../cron/autonomous";
import { MemoryUpdateSettingsService } from "../../services/memory-update-settings";
import type { BotConversation, BotContext } from "../context";
import { renderMemoryUpdateScreen } from "../ui/renderers";

export function createMemoryUpdateConversation(input: {
  memory: MemoryService;
  settings: MemoryUpdateSettingsService;
}) {
  return async function memoryUpdateConversation(conversation: BotConversation, ctx: BotContext) {
    const userId = String(ctx.from?.id ?? ctx.chat.id);
    let current = await conversation.external(() => input.settings.getOrCreate(userId));
    let screen = renderMemoryUpdateScreen(input.settings.renderSummary(current), current.enabled);

    await ctx.reply(screen.text, { reply_markup: screen.replyMarkup });

    const action = await conversation
      .waitForCallbackQuery(/^memory:update:(run-now|enable|disable|preset:\d+|custom|cancel)$/)
      .andFrom(ctx.from?.id ?? 0);
    await action.answerCallbackQuery();

    if (action.callbackQuery.data === "memory:update:cancel") {
      await action.reply("Memory Update dibatalkan.");
      return;
    }

    if (action.callbackQuery.data === "memory:update:run-now") {
      await conversation.external(() =>
        runMemoryUpdateOnce({
          userId,
          memory: input.memory,
          settings: input.settings,
        }),
      );
      current = await conversation.external(() => input.settings.getOrCreate(userId));
      await action.reply(`Memory Update selesai.\n${input.settings.renderSummary(current)}`);
      return;
    }

    if (action.callbackQuery.data === "memory:update:enable" || action.callbackQuery.data === "memory:update:disable") {
      current = await conversation.external(() => input.settings.setEnabled(userId, action.callbackQuery.data.endsWith("enable")));
      await action.reply(`Memory Update diubah.\n${input.settings.renderSummary(current)}`);
      return;
    }

    if (action.callbackQuery.data === "memory:update:custom") {
      await action.reply("Kirim cron expression, misalnya: 0 9 * * *");
      const cronMessage = await conversation.waitFor("message:text").andFrom(ctx.from?.id ?? 0);
      current = await conversation.external(() =>
        input.settings.updateSchedule(userId, {
          scheduleMode: "cron",
          cronExpr: cronMessage.message.text.trim(),
        }),
      );
      await cronMessage.reply(`Memory Update diubah.\n${input.settings.renderSummary(current)}`);
      return;
    }

    current = await conversation.external(() =>
      input.settings.updateSchedule(userId, {
        scheduleMode: "interval",
        intervalSec: Number(action.callbackQuery.data.split(":").at(-1)),
      }),
    );
    screen = renderMemoryUpdateScreen(input.settings.renderSummary(current), current.enabled);
    await action.reply(screen.text, { reply_markup: screen.replyMarkup });
  };
}
```

```ts
// src/bot/conversations/job-create.ts
import { AutonomousJobService } from "../../services/autonomous-jobs";
import type { BotConversation, BotContext } from "../context";
import { schedulePresetKeyboard } from "../ui/keyboards";

export function createJobCreateConversation(input: { jobs: AutonomousJobService }) {
  return async function jobCreateConversation(conversation: BotConversation, ctx: BotContext) {
    const chatId = String(ctx.chat.id);
    const userId = String(ctx.from?.id ?? ctx.chat.id);

    await ctx.reply("Kirim prompt autonomous job.");
    const promptMessage = await conversation.waitFor("message:text").andFrom(ctx.from?.id ?? 0);
    const prompt = promptMessage.message.text.trim();

    await promptMessage.reply("Pilih jadwal preset atau custom cron.", {
      reply_markup: schedulePresetKeyboard("job:create"),
    });

    const action = await conversation.waitForCallbackQuery(/^job:create:(preset:\d+|custom|cancel)$/).andFrom(ctx.from?.id ?? 0);
    await action.answerCallbackQuery();

    if (action.callbackQuery.data === "job:create:cancel") {
      await action.reply("Pembuatan job dibatalkan.");
      return;
    }

    if (action.callbackQuery.data === "job:create:custom") {
      await action.reply("Kirim cron expression, misalnya: */30 * * * *");
      const cronMessage = await conversation.waitFor("message:text").andFrom(ctx.from?.id ?? 0);
      const created = await conversation.external(() =>
        input.jobs.createJob({
          chatId,
          userId,
          prompt,
          schedule: { scheduleMode: "cron", cronExpr: cronMessage.message.text.trim() },
        }),
      );
      await cronMessage.reply(`Autonomous job #${created.id} dibuat.\n${created.scheduleLabel}`);
      return;
    }

    const created = await conversation.external(() =>
      input.jobs.createJob({
        chatId,
        userId,
        prompt,
        schedule: {
          scheduleMode: "interval",
          intervalSec: Number(action.callbackQuery.data.split(":").at(-1)),
        },
      }),
    );

    await action.reply(`Autonomous job #${created.id} dibuat.\n${created.scheduleLabel}`);
  };
}
```

```ts
// src/bot/conversations/job-detail.ts
import { AutonomousJobService } from "../../services/autonomous-jobs";
import type { BotConversation, BotContext } from "../context";
import { renderJobDetailScreen } from "../ui/renderers";
import { schedulePresetKeyboard } from "../ui/keyboards";

export function createJobDetailConversation(input: { jobs: AutonomousJobService }) {
  return async function jobDetailConversation(conversation: BotConversation, ctx: BotContext, jobId: number) {
    const chatId = String(ctx.chat.id);
    let job = await conversation.external(() => input.jobs.getJob(jobId, chatId));
    let screen = renderJobDetailScreen(job);

    await ctx.reply(screen.text, { reply_markup: screen.replyMarkup });

    const action = await conversation
      .waitForCallbackQuery(new RegExp(`^job:${job.id}:(edit-prompt|change-schedule|enable|disable|delete|cancel)$`))
      .andFrom(ctx.from?.id ?? 0);
    await action.answerCallbackQuery();

    if (action.callbackQuery.data === `job:${job.id}:cancel`) {
      await action.reply("Perubahan job dibatalkan.");
      return;
    }

    if (action.callbackQuery.data === `job:${job.id}:edit-prompt`) {
      await action.reply("Kirim prompt baru untuk job ini.");
      const promptMessage = await conversation.waitFor("message:text").andFrom(ctx.from?.id ?? 0);
      job = await conversation.external(() => input.jobs.updatePrompt(job.id, chatId, promptMessage.message.text.trim()));
      await promptMessage.reply(`Prompt job diperbarui.\n${job.prompt}`);
      return;
    }

    if (action.callbackQuery.data === `job:${job.id}:enable` || action.callbackQuery.data === `job:${job.id}:disable`) {
      job = await conversation.external(() => input.jobs.setEnabled(job.id, chatId, action.callbackQuery.data.endsWith("enable")));
      await action.reply(`Status job diperbarui.\nenabled=${job.enabled ? "yes" : "no"}`);
      return;
    }

    if (action.callbackQuery.data === `job:${job.id}:delete`) {
      await conversation.external(() => input.jobs.deleteJob(job.id, chatId));
      await action.reply(`Job #${job.id} dihapus.`);
      return;
    }

    await action.reply("Pilih preset baru atau custom cron.", {
      reply_markup: schedulePresetKeyboard(`job:${job.id}`),
    });

    const scheduleAction = await conversation
      .waitForCallbackQuery(new RegExp(`^job:${job.id}:(preset:\\d+|custom|cancel)$`))
      .andFrom(ctx.from?.id ?? 0);
    await scheduleAction.answerCallbackQuery();

    if (scheduleAction.callbackQuery.data === `job:${job.id}:cancel`) {
      await scheduleAction.reply("Perubahan jadwal dibatalkan.");
      return;
    }

    if (scheduleAction.callbackQuery.data === `job:${job.id}:custom`) {
      await scheduleAction.reply("Kirim cron expression baru.");
      const cronMessage = await conversation.waitFor("message:text").andFrom(ctx.from?.id ?? 0);
      job = await conversation.external(() =>
        input.jobs.updateSchedule(job.id, chatId, {
          scheduleMode: "cron",
          cronExpr: cronMessage.message.text.trim(),
        }),
      );
      await cronMessage.reply(`Jadwal job diperbarui.\n${job.scheduleLabel}`);
      return;
    }

    job = await conversation.external(() =>
      input.jobs.updateSchedule(job.id, chatId, {
        scheduleMode: "interval",
        intervalSec: Number(scheduleAction.callbackQuery.data.split(":").at(-1)),
      }),
    );
    screen = renderJobDetailScreen(job);
    await scheduleAction.reply(screen.text, { reply_markup: screen.replyMarkup });
  };
}
```

```ts
// src/bot/bot.ts (shape excerpt)
import { Bot } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import type { MemoryService } from "../memory/core/service";
import { AutonomousJobService } from "../services/autonomous-jobs";
import { MemoryUpdateSettingsService } from "../services/memory-update-settings";
import type { BotContext } from "./context";
import { createJobCreateConversation } from "./conversations/job-create";
import { createJobDetailConversation } from "./conversations/job-detail";
import { createMemoryUpdateConversation } from "./conversations/memory-update";
import {
  renderHelpScreen,
  renderJobsScreen,
  renderMainMenuScreen,
  renderMemorySummaryScreen,
  renderStartScreen,
} from "./ui/renderers";

export const PUBLIC_COMMANDS = ["start", "menu", "help"] as const;

export type BotDeps = {
  db: Database;
  memory: MemoryService;
  registry: ToolRegistry;
  llm: LlmProvider;
  jobs: AutonomousJobService;
  memoryUpdates: MemoryUpdateSettingsService;
};

export function createTelegramBot(deps: BotDeps) {
  const bot = new Bot<BotContext>(config.telegram.botToken);

  bot.use(conversations());
  bot.use(createConversation(createMemoryUpdateConversation({ memory: deps.memory, settings: deps.memoryUpdates }), { id: "memory-update" }));
  bot.use(createConversation(createJobCreateConversation({ jobs: deps.jobs }), { id: "job-create" }));
  bot.use(createConversation(createJobDetailConversation({ jobs: deps.jobs }), { id: "job-detail" }));

  bot.command("start", async (ctx) => {
    const screen = renderStartScreen();
    await ctx.reply(screen.text, { reply_markup: screen.replyMarkup });
  });

  bot.command("menu", async (ctx) => {
    const screen = renderMainMenuScreen();
    await ctx.reply(screen.text, { reply_markup: screen.replyMarkup });
  });

  bot.command("help", async (ctx) => {
    const screen = renderHelpScreen();
    await ctx.reply(screen.text, { reply_markup: screen.replyMarkup });
  });

  bot.callbackQuery("menu:open", async (ctx) => {
    await ctx.answerCallbackQuery();
    const screen = renderMainMenuScreen();
    await ctx.editMessageText(screen.text, { reply_markup: screen.replyMarkup });
  });

  bot.callbackQuery("help:open", async (ctx) => {
    await ctx.answerCallbackQuery();
    const screen = renderHelpScreen();
    await ctx.editMessageText(screen.text, { reply_markup: screen.replyMarkup });
  });

  bot.callbackQuery("memory:open", async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = String(ctx.chat.id);
    const userId = String(ctx.from?.id ?? ctx.chat.id);
    const [recall, status, memoryUpdate] = await Promise.all([
      deps.memory.recall(userId, "project preferences workflow coding", 5, chatId),
      deps.memory.memoryStatus(userId, chatId),
      deps.memoryUpdates.getOrCreate(userId),
    ]);

    const screen = renderMemorySummaryScreen({
      status,
      persona: recall.persona ?? "Belum ada L3 persona.",
      scenarios: recall.scenarios.map((scenario) => scenario.title),
      atoms: recall.atoms.map((atom) => atom.text),
      hasCanvas: Boolean(recall.taskCanvas),
      memoryUpdateSummary: deps.memoryUpdates.renderSummary(memoryUpdate),
    });
    await ctx.editMessageText(screen.text, { reply_markup: screen.replyMarkup });
  });

  bot.callbackQuery("memory:update:open", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("memory-update");
  });

  bot.callbackQuery("jobs:open", async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = String(ctx.chat.id);
    const jobs = await deps.jobs.listJobs(chatId);
    const screen = renderJobsScreen(
      jobs.map((job) => `#${job.id} ${job.enabled ? "enabled" : "disabled"}\n${job.scheduleLabel}\n${job.prompt}`),
      jobs.map((job) => job.id),
    );
    await ctx.editMessageText(screen.text, { reply_markup: screen.replyMarkup });
  });

  bot.callbackQuery(/^jobs:detail:\d+$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const jobId = Number(ctx.callbackQuery.data.split(":").at(-1));
    await ctx.conversation.enter("job-detail", jobId);
  });

  bot.callbackQuery("jobs:create", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("job-create");
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return;

    const chatId = String(ctx.chat.id);
    const userId = String(ctx.from?.id ?? ctx.chat.id);
    await ctx.replyWithChatAction("typing");

    const answer = await runReactAgent({
      chatId,
      userId,
      input: text,
      memory: deps.memory,
      registry: deps.registry,
      llm: deps.llm,
      mode: "chat",
    });

    for (const chunk of splitTelegramMessage(answer)) {
      await ctx.reply(chunk);
    }
  });

  return bot;
}
```

```ts
// src/index.ts (service construction excerpt)
const jobs = new AutonomousJobService(db);
const memoryUpdates = new MemoryUpdateSettingsService(db);
const bot = createTelegramBot({ db, memory, registry, llm, jobs, memoryUpdates });
```

- [ ] **Step 4: Run the bot tests and typecheck**

Run:
```bash
bun test tests/bot/command-surface.test.ts tests/bot/ui.test.ts && bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

If commits are authorized for this execution session, run:
```bash
git add src/bot/context.ts src/bot/conversations/memory-update.ts src/bot/conversations/job-create.ts src/bot/conversations/job-detail.ts src/bot/bot.ts src/index.ts src/cron/autonomous.ts tests/bot/command-surface.test.ts
git commit -m "feat: move telegram ux to button-driven conversations"
```

## Task 6: Replace the old cron loops with a unified scheduler dispatcher

**Files:**
- Create: `src/cron/scheduler.ts`
- Modify: `src/index.ts`
- Modify: `src/config.ts`
- Create: `tests/cron/scheduler.test.ts`
- Modify: `tests/memory/config.test.ts`

- [ ] **Step 1: Write the failing scheduler tests**

```ts
// tests/cron/scheduler.test.ts
import { expect, mock, test } from "bun:test";
import { dispatchSchedulerTick } from "../../src/cron/scheduler";

test("scheduler runs due jobs first and then due memory updates within the limit", async () => {
  const executeJob = mock(async () => undefined);
  const executeMemoryUpdate = mock(async () => undefined);

  const result = await dispatchSchedulerTick({
    maxItemsPerTick: 3,
    nowUnix: 1_715_904_600,
    jobs: {
      listDueJobs: mock(async () => [
        { id: 1, chatId: "c1", userId: "u1", prompt: "job one" },
        { id: 2, chatId: "c2", userId: "u2", prompt: "job two" },
      ]),
    },
    memoryUpdates: {
      listDueUsers: mock(async () => [{ userId: "u3" }]),
    },
    executeJob,
    executeMemoryUpdate,
  });

  expect(result).toEqual({ jobsRun: 2, memoryUpdatesRun: 1 });
  expect(executeJob).toHaveBeenCalledTimes(2);
  expect(executeMemoryUpdate).toHaveBeenCalledTimes(1);
});
```

```ts
// tests/memory/config.test.ts (add)
test("parseConfig exposes scheduler overrides", () => {
  const runtime = parseConfig({
    BOT_TOKEN: "123:abc",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
    SCHEDULER_TICK_CRON: "*/2 * * * *",
    SCHEDULER_MAX_ITEMS_PER_TICK: "7",
  });

  expect(runtime.scheduler.tickCron).toBe("*/2 * * * *");
  expect(runtime.scheduler.maxItemsPerTick).toBe(7);
});
```

- [ ] **Step 2: Run the scheduler tests and verify they fail**

Run:
```bash
bun test tests/cron/scheduler.test.ts tests/memory/config.test.ts
```

Expected: FAIL because the scheduler module does not exist yet.

- [ ] **Step 3: Implement the dispatcher tick and wire it into app startup**

```ts
// src/cron/scheduler.ts
import cron from "node-cron";
import { runAutonomousJobOnce, runMemoryUpdateOnce } from "./autonomous";

let schedulerBusy = false;

export async function dispatchSchedulerTick(input: {
  maxItemsPerTick: number;
  nowUnix: number;
  jobs: { listDueJobs(nowUnix: number, limit: number): Promise<Array<any>> };
  memoryUpdates: { listDueUsers(nowUnix: number, limit: number): Promise<Array<any>> };
  executeJob(job: any): Promise<void>;
  executeMemoryUpdate(setting: any): Promise<void>;
}) {
  const dueJobs = await input.jobs.listDueJobs(input.nowUnix, input.maxItemsPerTick);
  const remaining = Math.max(input.maxItemsPerTick - dueJobs.length, 0);
  const dueMemoryUpdates = remaining > 0
    ? await input.memoryUpdates.listDueUsers(input.nowUnix, remaining)
    : [];

  for (const job of dueJobs) {
    await input.executeJob(job);
  }
  for (const setting of dueMemoryUpdates) {
    await input.executeMemoryUpdate(setting);
  }

  return {
    jobsRun: dueJobs.length,
    memoryUpdatesRun: dueMemoryUpdates.length,
  };
}

export function startSchedulerLoop(input: {
  tickCron: string;
  maxItemsPerTick: number;
  bot: any;
  jobs: any;
  memoryUpdates: any;
  memory: any;
  registry: any;
  llm: any;
  nowUnix(): number;
}) {
  cron.schedule(input.tickCron, async () => {
    if (schedulerBusy) return;
    schedulerBusy = true;
    try {
      await dispatchSchedulerTick({
        maxItemsPerTick: input.maxItemsPerTick,
        nowUnix: input.nowUnix(),
        jobs: input.jobs,
        memoryUpdates: input.memoryUpdates,
        executeJob: (job) =>
          runAutonomousJobOnce({
            bot: input.bot,
            job,
            jobs: input.jobs,
            memory: input.memory,
            registry: input.registry,
            llm: input.llm,
          }),
        executeMemoryUpdate: (setting) =>
          runMemoryUpdateOnce({
            userId: setting.userId,
            memory: input.memory,
            settings: input.memoryUpdates,
          }),
      });
    } finally {
      schedulerBusy = false;
    }
  });
}
```

```ts
// src/index.ts (scheduler wiring excerpt)
import { startSchedulerLoop } from "./cron/scheduler";
import { unixNow } from "./utils/time";

startSchedulerLoop({
  tickCron: config.scheduler.tickCron,
  maxItemsPerTick: config.scheduler.maxItemsPerTick,
  bot,
  jobs,
  memoryUpdates,
  memory,
  registry,
  llm,
  nowUnix: unixNow,
});
```

```ts
// src/config.ts (runtime summary excerpt)
return {
  // ... existing summary
  scheduler: {
    tickCron: config.scheduler.tickCron,
    maxItemsPerTick: config.scheduler.maxItemsPerTick,
  },
  memory: {
    sqliteVecEnabled: config.memory.sqliteVecEnabled,
    jsonlExportEnabled: config.memory.jsonlExportEnabled,
    updateMode: "telegram-managed",
  },
};
```

Remove the old startup calls from `src/index.ts`:
```ts
// delete these old calls
startAutonomousLoop({ db, bot, memory, registry, llm });
startMemoryMaintenanceLoop({ db, memory, llm });
```

- [ ] **Step 4: Run the scheduler tests and typecheck**

Run:
```bash
bun test tests/cron/scheduler.test.ts tests/memory/config.test.ts tests/services/autonomous-jobs.test.ts tests/services/memory-update-settings.test.ts && bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

If commits are authorized for this execution session, run:
```bash
git add src/cron/scheduler.ts src/index.ts src/config.ts tests/cron/scheduler.test.ts tests/memory/config.test.ts
git commit -m "feat: dispatch telegram automation from unified scheduler"
```

## Task 7: Update README, add architecture docs, and lock in regressions

**Files:**
- Modify: `README.md`
- Create: `docs/architecture.md`
- Create: `docs/telegram-flow.md`
- Create: `docs/memory.md`
- Create: `docs/autonomous-jobs.md`
- Modify: `tests/memory/readme.test.ts`

- [ ] **Step 1: Write the failing README/docs regression test**

```ts
// tests/memory/readme.test.ts
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

test("README documents the menu-driven telegram runtime", () => {
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");

  expect(readme.includes("/start          onboarding awal")).toBe(true);
  expect(readme.includes("/menu           buka menu utama")).toBe(true);
  expect(readme.includes("/help           bantuan singkat")).toBe(true);
  expect(readme.includes("/memory_force")).toBe(false);
  expect(readme.includes("/job <prompt>")).toBe(false);
  expect(readme.includes("@grammyjs/conversations")).toBe(true);
});

test("new architecture docs exist", () => {
  expect(existsSync(new URL("../../docs/architecture.md", import.meta.url))).toBe(true);
  expect(existsSync(new URL("../../docs/telegram-flow.md", import.meta.url))).toBe(true);
  expect(existsSync(new URL("../../docs/memory.md", import.meta.url))).toBe(true);
  expect(existsSync(new URL("../../docs/autonomous-jobs.md", import.meta.url))).toBe(true);
});
```

- [ ] **Step 2: Run the docs test and verify it fails**

Run:
```bash
bun test tests/memory/readme.test.ts
```

Expected: FAIL because the README still documents `/tools`, `/memory_force`, `/job`, and `/jobs`, and the new docs do not exist yet.

- [ ] **Step 3: Rewrite the README and add the four docs**

```md
<!-- README.md command section excerpt -->
## 8. Commands

```text
/start          onboarding awal
/menu           buka menu utama
/help           bantuan singkat
```

## 9. Telegram flow

- `/start` menampilkan tombol `Menu` dan `Help`
- `Memory` dibuka dari menu tombol, bukan slash command
- `Memory Update` mengatur auto-update per user dengan default 24 jam
- `Jobs` dibuat dan diubah dari menu tombol dengan preset interval atau custom cron
- Multi-step flow memakai `@grammyjs/conversations`
```

```md
<!-- docs/architecture.md -->
# Architecture

## Runtime layers
- `src/bot/*` handles Telegram rendering, callback routing, and conversations.
- `src/services/*` owns schedules, job persistence, and memory-update settings.
- `src/cron/*` owns due-work dispatch and execution.
- `src/agent/*` owns LLM orchestration and internal tools.
- `src/memory/*` keeps the protected L0/L1/L2/L3 model intact.

## Protected boundary
The L0/L1/L2/L3 memory model, offload refs, and Mermaid canvas are not redesigned here. This feature only changes how they are accessed, triggered, scheduled, and rendered.
```

```md
<!-- docs/telegram-flow.md -->
# Telegram Flow

## Public commands
- `/start`
- `/menu`
- `/help`

## Menu flow
1. `/start` shows `Menu` and `Help` buttons.
2. `Menu` opens Memory, Jobs, and Help.
3. `Memory Update` opens a conversation for preset interval or custom cron.
4. `Add Job` opens a conversation for prompt capture plus schedule capture.
```

```md
<!-- docs/memory.md -->
# Memory

## Protected model
- L0 conversations
- L1 atoms
- L2 scenarios
- L3 persona
- offload refs
- Mermaid canvas

This feature does not rename, merge, split, or replace those layers.

## Memory Update
Memory Update is a Telegram-managed per-user schedule with a default interval of 24 hours and a manual `Run now` action.
```

```md
<!-- docs/autonomous-jobs.md -->
# Autonomous Jobs

## Schedule modes
- interval presets such as 10m, 30m, 1h, 6h, 12h, and 24h
- custom cron expressions validated before save

## Execution
A unified scheduler tick checks due jobs from SQLite and runs them through `runReactAgent` in autonomous mode.
```

- [ ] **Step 4: Run the docs test, targeted regression tests, and typecheck**

Run:
```bash
bun test tests/memory/readme.test.ts tests/runtime/agent-prompt.test.ts tests/bot/ui.test.ts tests/bot/command-surface.test.ts && bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

If commits are authorized for this execution session, run:
```bash
git add README.md docs/architecture.md docs/telegram-flow.md docs/memory.md docs/autonomous-jobs.md tests/memory/readme.test.ts
git commit -m "docs: describe telegram menu automation architecture"
```

## Task 8: Run the final automated and manual verification

**Files:**
- No code changes expected unless a failing test or Telegram smoke test reveals a real bug.

- [ ] **Step 1: Run the full targeted automated suite**

Run:
```bash
bun test \
  tests/services/schedules.test.ts \
  tests/services/autonomous-jobs.test.ts \
  tests/services/memory-update-settings.test.ts \
  tests/runtime/agent-prompt.test.ts \
  tests/bot/ui.test.ts \
  tests/bot/command-surface.test.ts \
  tests/cron/scheduler.test.ts \
  tests/memory/config.test.ts \
  tests/memory/sqlite-backend.test.ts \
  tests/memory/tools.test.ts \
  tests/memory/agent-runtime.test.ts \
  tests/memory/readme.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the typechecker**

Run:
```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Start the bot locally and smoke-test the Telegram flows**

Run:
```bash
bun src/index.ts
```

Expected startup logs include:
```text
Runtime config
Telegram bot starting...
```

Manual Telegram checks:
- `/start` shows only Menu and Help buttons
- `/menu` opens Memory, Jobs, and Help
- Memory screen shows current memory summary plus Memory Update summary
- Memory Update can switch to 24h, 12h, or custom cron
- Memory Update run-now succeeds without changing the protected memory model
- Add Job accepts both preset interval and custom cron
- A created job appears in Jobs and keeps its last status fields
- A due job still sends a Telegram notification after the scheduler tick runs

- [ ] **Step 4: Fix any real failures before claiming completion**

If any automated test or Telegram smoke test fails, make the smallest fix in the relevant file and rerun the exact failing command before rerunning the broader suite.

Example rerun commands:
```bash
bun test tests/cron/scheduler.test.ts
bun test tests/bot/ui.test.ts
bun test tests/services/autonomous-jobs.test.ts
```

Expected: PASS for each repaired failure before rerunning the full suite.

- [ ] **Step 5: Final commit**

If commits are authorized for this execution session, run:
```bash
git add package.json src/config.ts src/db/schema.ts src/services src/agent src/tools src/utils src/bot src/cron src/index.ts README.md docs tests
git commit -m "feat: add telegram menu-driven automation controls"
```
