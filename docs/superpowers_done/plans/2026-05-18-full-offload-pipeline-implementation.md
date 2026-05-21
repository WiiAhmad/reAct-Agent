# Full Offload Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the new TencentDB-inspired context-offload pipeline: deterministic timezone-aware datetime output, L1.5 task judgment, task-scoped Mermaid canvases, and L4 draft skill generation from grounded task evidence.

**Architecture:** Keep durable memory `L0 -> L1 -> L2 -> L3` unchanged. Add a separate offload pipeline under `src/memory/offload/` where each user turn is judged by L1.5 before tool results are routed to task-scoped canvases, and L4 can later generate draft `SKILL.md` files from one selected task canvas plus node-linked evidence.

**Tech Stack:** Bun, TypeScript, grammY, `@grammyjs/conversations`, SQLite via `bun:sqlite`, existing `LlmProvider`, existing project-owned memory backend.

---

## Scope note

This spec spans several connected subsystems, but they form one pipeline and should be implemented sequentially. Do not start L4 until config, datetime, task-canvas storage, L1.5 judgment, and task-scoped canvas routing are passing tests.

---

## File structure

### Existing files to modify

- `src/config.ts` — parse app timezone/locale, L1.5 config, L4 config, task-canvas directory, generated-skills directory, and runtime summary.
- `.env.example` — document the new environment variables.
- `src/utils/time.ts` — make `currentDateTimeSnapshot` timezone/locale-aware and return explicit weekday fields.
- `src/tools/local.ts` — call `currentDateTimeSnapshot` with configured app timezone/locale.
- `tests/memory/config.test.ts` — add config default/override tests.
- `tests/memory/tools.test.ts` — assert datetime tool exposes weekday and locale fields.
- `src/memory/core/types.ts` — add task canvas, L1.5 judgment, task boundary, generated skill, and task routing types.
- `src/memory/core/backend.ts` — add backend methods for task canvases, judgments, boundaries, task node assignment, and generated skill records.
- `src/memory/backends/sqlite/migrate.ts` — add SQLite tables and forward-only columns.
- `src/memory/backends/sqlite/backend.ts` — implement new backend methods.
- `src/memory/integration/factory.ts` — pass new config into `OffloadService` and `MemoryService`.
- `src/memory/core/service.ts` — expose L1.5 judgment, task routing, L4 generation, task listing, and generated skill status methods.
- `src/memory/offload/service.ts` — accept a routing target and write task-scoped canvases instead of per-chat canvases when a task id exists.
- `src/memory/recall/service.ts` — keep recall compatible by returning active task canvas content for a chat.
- `src/agent/react-agent.ts` — run L1.5 after logging the user message and pass the returned routing target into tool-result offload.
- `src/bot/ui/keyboards.ts` — add menu callbacks/buttons for draft skill generation.
- `src/bot/ui/renderers.ts` — render generated-skill summary text.
- `src/bot/bot.ts` — register the skill draft conversation and callbacks.
- `tests/memory/offload.test.ts` — update offload tests for task-scoped canvas routing and short-task non-pollution.
- `tests/memory/agent-runtime.test.ts` — assert one-shot tool QA does not update task canvases.
- `tests/bot/ui.test.ts` — assert new menu-driven skill draft UI without adding public slash commands.
- `tests/bot/memory-summary.test.ts` — assert memory summary includes skill draft counts/status.

### New files to create

- `src/memory/offload/types.ts` — offload pipeline-local types and constants.
- `src/memory/offload/l15.ts` — deterministic L1.5 rules, LLM prompt, JSON parser, and judgment runner.
- `src/memory/offload/l4.ts` — L4 prompt, response parser, validation, privacy checks, draft file writer helper.
- `src/bot/conversations/skill-draft.ts` — Telegram conversation to choose a task, collect optional focus, and generate a draft skill.
- `tests/memory/l15.test.ts` — unit tests for rules, parser, and safe fallback.
- `tests/memory/l4.test.ts` — unit tests for L4 evidence selection, validation, privacy checks, and metadata persistence.

---

## Task 1: Config and deterministic datetime

**Files:**
- Modify: `src/config.ts`
- Modify: `.env.example`
- Modify: `src/utils/time.ts`
- Modify: `src/tools/local.ts`
- Test: `tests/memory/config.test.ts`
- Test: `tests/memory/tools.test.ts`

- [ ] **Step 1: Add failing config tests**

Add these tests to `tests/memory/config.test.ts`:

```ts
test("parseConfig exposes app timezone and locale defaults and overrides", () => {
  const defaults = parseConfig({
    BOT_TOKEN: "123:abc",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
  });

  expect(defaults.app.timezone).toBe("Asia/Jakarta");
  expect(defaults.app.locale).toBe("id-ID");

  const overridden = parseConfig({
    BOT_TOKEN: "123:abc",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
    APP_TIMEZONE: "UTC",
    APP_LOCALE: "en-US",
  });

  expect(overridden.app.timezone).toBe("UTC");
  expect(overridden.app.locale).toBe("en-US");
});

test("parseConfig exposes L1.5 and L4 defaults and overrides", () => {
  const defaults = parseConfig({
    BOT_TOKEN: "123:abc",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
  });

  expect(defaults.memory.l15).toEqual({
    enabled: true,
    mode: "hybrid",
    recentMessages: 6,
    historyTaskLimit: 10,
    maxCanvasChars: 12000,
    safeFallback: "short",
  });
  expect(defaults.memory.l4).toEqual({
    enabled: true,
    mode: "local",
    requireCompletedTask: false,
    maxEvidenceEntries: 80,
    maxCanvasChars: 20000,
    maxSkillChars: 20000,
  });
  expect(defaults.storage.memoryTaskCanvasDir.endsWith("data/memory/task-canvases")).toBe(true);
  expect(defaults.storage.memoryGeneratedSkillsDir.endsWith("data/memory/skills")).toBe(true);

  const overridden = parseConfig({
    BOT_TOKEN: "123:abc",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
    MEMORY_L15_ENABLED: "false",
    MEMORY_L15_MODE: "rules",
    MEMORY_L15_RECENT_MESSAGES: "4",
    MEMORY_L15_HISTORY_TASK_LIMIT: "3",
    MEMORY_L15_MAX_CANVAS_CHARS: "5000",
    MEMORY_L15_SAFE_FALLBACK: "short",
    MEMORY_TASK_CANVAS_DIR: "./tmp/task-canvases",
    MEMORY_L4_ENABLED: "false",
    MEMORY_L4_MODE: "local",
    MEMORY_L4_SKILLS_DIR: "./tmp/skills",
    MEMORY_L4_REQUIRE_COMPLETED_TASK: "true",
    MEMORY_L4_MAX_EVIDENCE_ENTRIES: "12",
    MEMORY_L4_MAX_CANVAS_CHARS: "7000",
    MEMORY_L4_MAX_SKILL_CHARS: "9000",
  });

  expect(overridden.memory.l15).toEqual({
    enabled: false,
    mode: "rules",
    recentMessages: 4,
    historyTaskLimit: 3,
    maxCanvasChars: 5000,
    safeFallback: "short",
  });
  expect(overridden.memory.l4).toEqual({
    enabled: false,
    mode: "local",
    requireCompletedTask: true,
    maxEvidenceEntries: 12,
    maxCanvasChars: 7000,
    maxSkillChars: 9000,
  });
  expect(overridden.storage.memoryTaskCanvasDir.endsWith("tmp/task-canvases")).toBe(true);
  expect(overridden.storage.memoryGeneratedSkillsDir.endsWith("tmp/skills")).toBe(true);
});
```

- [ ] **Step 2: Add failing datetime tool assertions**

In `tests/memory/tools.test.ts`, extend the existing `expect(parsed).toMatchObject(...)` block with:

```ts
expect(parsed).toMatchObject({
  iso_timestamp: expect.any(String),
  unix_timestamp: expect.any(Number),
  readable_local_datetime: expect.any(String),
  timezone: expect.any(String),
  offset_minutes: expect.any(Number),
  locale: expect.any(String),
  local_date: expect.any(String),
  local_time: expect.any(String),
  weekday_local: expect.any(String),
  weekday_en: expect.any(String),
  iso_weekday: expect.any(Number),
});
```

Add a direct utility test at the bottom of `tests/memory/tools.test.ts`:

```ts
import { currentDateTimeSnapshot } from "../../src/utils/time";

test("currentDateTimeSnapshot formats weekday in configured timezone and locale", () => {
  const snapshot = currentDateTimeSnapshot(new Date("2026-05-17T18:14:45.815Z"), {
    timezone: "Asia/Jakarta",
    locale: "id-ID",
  });

  expect(snapshot.local_date).toBe("2026-05-18");
  expect(snapshot.local_time).toBe("01:14:45");
  expect(snapshot.weekday_local.toLowerCase()).toBe("senin");
  expect(snapshot.weekday_en).toBe("Monday");
  expect(snapshot.iso_weekday).toBe(1);
  expect(snapshot.offset_minutes).toBe(420);
  expect(snapshot.readable_local_datetime.toLowerCase()).toContain("senin");
});
```

If adding the import at the bottom violates lint or style, move it to the existing imports at the top of the file.

- [ ] **Step 3: Run failing tests**

Run:

```bash
bun test tests/memory/config.test.ts tests/memory/tools.test.ts
```

Expected: FAIL because `app`, `memory.l15`, `memory.l4`, task skill directories, and weekday fields do not exist yet.

- [ ] **Step 4: Implement config parsing**

In `src/config.ts`, add helper functions near `boolEnv` and `intEnv`:

```ts
function enumEnv<T extends string>(source: ConfigSource, name: string, allowed: readonly T[], fallback: T): T {
  const raw = env(source, name, fallback);
  return allowed.includes(raw as T) ? raw as T : fallback;
}
```

Inside `parseConfig`, after `memoryCanvasDir`, add:

```ts
const memoryTaskCanvasDir = resolvePath(env(source, "MEMORY_TASK_CANVAS_DIR", `${memoryDir}/task-canvases`));
const memoryGeneratedSkillsDir = resolvePath(env(source, "MEMORY_L4_SKILLS_DIR", `${memoryDir}/skills`));
```

Add an `app` section to the returned object:

```ts
app: {
  timezone: env(source, "APP_TIMEZONE", "Asia/Jakarta"),
  locale: env(source, "APP_LOCALE", "id-ID"),
},
```

Add the new storage fields:

```ts
memoryTaskCanvasDir,
memoryGeneratedSkillsDir,
```

Inside the existing `memory` object, add:

```ts
l15: {
  enabled: boolEnv(source, "MEMORY_L15_ENABLED", true),
  mode: enumEnv(source, "MEMORY_L15_MODE", ["rules", "llm", "hybrid"] as const, "hybrid"),
  recentMessages: intEnv(source, "MEMORY_L15_RECENT_MESSAGES", 6),
  historyTaskLimit: intEnv(source, "MEMORY_L15_HISTORY_TASK_LIMIT", 10),
  maxCanvasChars: intEnv(source, "MEMORY_L15_MAX_CANVAS_CHARS", 12000),
  safeFallback: enumEnv(source, "MEMORY_L15_SAFE_FALLBACK", ["short"] as const, "short"),
},
l4: {
  enabled: boolEnv(source, "MEMORY_L4_ENABLED", true),
  mode: enumEnv(source, "MEMORY_L4_MODE", ["local"] as const, "local"),
  requireCompletedTask: boolEnv(source, "MEMORY_L4_REQUIRE_COMPLETED_TASK", false),
  maxEvidenceEntries: intEnv(source, "MEMORY_L4_MAX_EVIDENCE_ENTRIES", 80),
  maxCanvasChars: intEnv(source, "MEMORY_L4_MAX_CANVAS_CHARS", 20000),
  maxSkillChars: intEnv(source, "MEMORY_L4_MAX_SKILL_CHARS", 20000),
},
```

Add both new storage directories to the `mkdirSync` array:

```ts
config.storage.memoryTaskCanvasDir,
config.storage.memoryGeneratedSkillsDir,
```

Update `getRuntimeConfigSummary().memory` with:

```ts
l15: {
  enabled: config.memory.l15.enabled,
  mode: config.memory.l15.mode,
},
l4: {
  enabled: config.memory.l4.enabled,
  mode: config.memory.l4.mode,
  skillsDir: config.storage.memoryGeneratedSkillsDir,
},
app: {
  timezone: config.app.timezone,
  locale: config.app.locale,
},
```

- [ ] **Step 5: Implement timezone-aware datetime utility**

Replace `src/utils/time.ts` with this content:

```ts
export type CurrentDateTimeSnapshot = {
  iso_timestamp: string;
  unix_timestamp: number;
  readable_local_datetime: string;
  timezone: string;
  offset_minutes: number;
  locale: string;
  local_date: string;
  local_time: string;
  weekday_local: string;
  weekday_en: string;
  iso_weekday: number;
};

export type CurrentDateTimeOptions = {
  timezone?: string;
  locale?: string;
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function getPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "0";
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function getZonedParts(date: Date, timezone: string, locale: string): ZonedParts {
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);

  return {
    year: Number(getPart(parts, "year")),
    month: Number(getPart(parts, "month")),
    day: Number(getPart(parts, "day")),
    hour: Number(getPart(parts, "hour")),
    minute: Number(getPart(parts, "minute")),
    second: Number(getPart(parts, "second")),
  };
}

function getOffsetMinutes(date: Date, timezone: string, locale: string): number {
  const parts = getZonedParts(date, timezone, locale);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

function getIsoWeekday(parts: ZonedParts): number {
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function currentDateTimeSnapshot(date = new Date(), options: CurrentDateTimeOptions = {}): CurrentDateTimeSnapshot {
  const timezone = options.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const locale = options.locale || Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
  const parts = getZonedParts(date, timezone, locale);
  const localDate = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
  const localTime = `${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;

  return {
    iso_timestamp: date.toISOString(),
    unix_timestamp: Math.floor(date.getTime() / 1000),
    readable_local_datetime: new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      dateStyle: "full",
      timeStyle: "medium",
    }).format(date),
    timezone,
    offset_minutes: getOffsetMinutes(date, timezone, locale),
    locale,
    local_date: localDate,
    local_time: localTime,
    weekday_local: new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: "long" }).format(date),
    weekday_en: new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(date),
    iso_weekday: getIsoWeekday(parts),
  };
}

export function nowIso(): string {
  return currentDateTimeSnapshot().iso_timestamp;
}

export function unixNow(): number {
  return currentDateTimeSnapshot().unix_timestamp;
}
```

- [ ] **Step 6: Pass configured timezone/locale to the tool**

In `src/tools/local.ts`, add this import:

```ts
import { config } from "../config";
```

Replace the `tdai_current_datetime` execute body with:

```ts
async execute() {
  return JSON.stringify(currentDateTimeSnapshot(new Date(), {
    timezone: config.app.timezone,
    locale: config.app.locale,
  }));
},
```

- [ ] **Step 7: Document new env vars**

Append this block after the memory offload settings in `.env.example`:

```dotenv
# App-local formatting
APP_TIMEZONE=Asia/Jakarta
APP_LOCALE=id-ID

# L1.5 task judgment and task-scoped canvas routing
MEMORY_L15_ENABLED=true
MEMORY_L15_MODE=hybrid
MEMORY_L15_RECENT_MESSAGES=6
MEMORY_L15_HISTORY_TASK_LIMIT=10
MEMORY_L15_MAX_CANVAS_CHARS=12000
MEMORY_L15_SAFE_FALLBACK=short
MEMORY_TASK_CANVAS_DIR=./data/memory/task-canvases

# L4 draft skill generation
MEMORY_L4_ENABLED=true
MEMORY_L4_MODE=local
MEMORY_L4_SKILLS_DIR=./data/memory/skills
MEMORY_L4_REQUIRE_COMPLETED_TASK=false
MEMORY_L4_MAX_EVIDENCE_ENTRIES=80
MEMORY_L4_MAX_CANVAS_CHARS=20000
MEMORY_L4_MAX_SKILL_CHARS=20000
```

- [ ] **Step 8: Run tests**

Run:

```bash
bun test tests/memory/config.test.ts tests/memory/tools.test.ts
bun run typecheck
```

Expected: both commands pass.

- [ ] **Step 9: Commit**

```bash
git add .env.example src/config.ts src/utils/time.ts src/tools/local.ts tests/memory/config.test.ts tests/memory/tools.test.ts
git commit -m "feat: add offload config and deterministic datetime"
```

---

## Task 2: Offload storage schema and backend methods

**Files:**
- Modify: `src/memory/core/types.ts`
- Modify: `src/memory/core/backend.ts`
- Modify: `src/memory/backends/sqlite/migrate.ts`
- Modify: `src/memory/backends/sqlite/backend.ts`
- Test: `tests/memory/offload.test.ts`
- Test: `tests/memory/sqlite-backend.test.ts`

- [ ] **Step 1: Add failing backend storage test**

Append this test to `tests/memory/sqlite-backend.test.ts`:

```ts
test("sqlite backend stores task canvases, boundaries, and generated skill records", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-task-canvas-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
      taskCanvasDir: join(tempDir, "task-canvases"),
      generatedSkillsDir: join(tempDir, "skills"),
    });
    await backend.init();

    const task = await backend.createTaskCanvas({
      chatId: "c1",
      userId: "u1",
      label: "adapt-l15",
      status: "active",
    });

    expect(task.id).toBeGreaterThan(0);
    expect(task.filePath).toContain("task-canvases/c1/");
    expect(task.filePath).toContain("adapt-l15.mmd");

    await backend.insertTaskBoundary({
      chatId: "c1",
      userId: "u1",
      startNodeSequence: 0,
      result: "long",
      taskId: task.id,
    });

    await backend.recordL15Judgment({
      chatId: "c1",
      userId: "u1",
      sourceConversationId: 7,
      taskCompleted: false,
      isLongTask: true,
      isContinuation: false,
      selectedTaskId: task.id,
      newTaskLabel: "adapt-l15",
      source: "rules",
    });

    const active = await backend.getActiveTaskCanvas("u1", "c1");
    expect(active?.id).toBe(task.id);

    const nodeId = "task_node_1";
    await backend.insertTaskGraphNode({
      chatId: "c1",
      userId: "u1",
      taskId: task.id,
      nodeId,
      toolName: "demo_tool",
      args: { ok: true },
      summary: "Demo summary",
      status: "ok",
    });

    const nodes = await backend.listTaskGraphNodesForTask(task.id, 10);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.taskId).toBe(task.id);

    const skill = await backend.insertGeneratedSkill({
      sourceTaskId: task.id,
      chatId: "c1",
      userId: "u1",
      skillName: "adapt-l15-workflow",
      skillDescription: "Use when adapting L1.5 task routing from evidence",
      skillFocus: "routing",
      skillFilePath: "memory/skills/adapt-l15-workflow/SKILL.md",
      sourceCanvasFilePath: task.filePath,
      sourceNodeIds: [nodeId],
      sourceEvidenceIds: [nodeId],
      status: "draft",
    });

    expect(skill.id).toBeGreaterThan(0);
    expect(await backend.countGeneratedSkills("u1")).toBe(1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

If `tests/memory/sqlite-backend.test.ts` does not already import `mkdtemp`, `rm`, `join`, `tmpdir`, `Database`, `migrateSqliteMemory`, and `SqliteMemoryBackend`, add those imports at the top.

- [ ] **Step 2: Run failing test**

Run:

```bash
bun test tests/memory/sqlite-backend.test.ts
```

Expected: FAIL because the backend types, constructor options, tables, and methods do not exist.

- [ ] **Step 3: Add core types**

In `src/memory/core/types.ts`, add these type definitions after `TaskGraphNode` / `NewTaskGraphNode`:

```ts
export type TaskCanvasStatus = "active" | "completed" | "inactive";

export type TaskCanvas = {
  id: number;
  chatId: string;
  userId: string;
  label: string;
  filePath: string;
  status: TaskCanvasStatus;
  createdAt: string;
  updatedAt: string;
};

export type NewTaskCanvas = {
  chatId: string;
  userId: string;
  label: string;
  filePath?: string;
  status?: TaskCanvasStatus;
};

export type L15JudgmentSource = "rules" | "llm" | "fallback";

export type L15Judgment = {
  id: number;
  chatId: string;
  userId: string;
  sourceConversationId?: number;
  taskCompleted: boolean;
  isLongTask: boolean;
  isContinuation: boolean;
  selectedTaskId?: number;
  newTaskLabel?: string;
  source: L15JudgmentSource;
  createdAt: string;
};

export type NewL15Judgment = {
  chatId: string;
  userId: string;
  sourceConversationId?: number;
  taskCompleted: boolean;
  isLongTask: boolean;
  isContinuation: boolean;
  selectedTaskId?: number;
  newTaskLabel?: string;
  source: L15JudgmentSource;
};

export type TaskBoundaryResult = "long" | "short" | "pending";

export type TaskBoundary = {
  id: number;
  chatId: string;
  userId: string;
  startNodeSequence: number;
  result: TaskBoundaryResult;
  taskId?: number;
  createdAt: string;
};

export type NewTaskBoundary = {
  chatId: string;
  userId: string;
  startNodeSequence: number;
  result: TaskBoundaryResult;
  taskId?: number;
};

export type GeneratedSkillStatus = "draft" | "reviewed" | "rejected" | "exported";

export type GeneratedSkill = {
  id: number;
  sourceTaskId: number;
  chatId: string;
  userId: string;
  skillName: string;
  skillDescription: string;
  skillFocus?: string;
  skillFilePath: string;
  sourceCanvasFilePath: string;
  sourceNodeIds: string[];
  sourceEvidenceIds: string[];
  status: GeneratedSkillStatus;
  createdAt: string;
  updatedAt: string;
};

export type NewGeneratedSkill = {
  sourceTaskId: number;
  chatId: string;
  userId: string;
  skillName: string;
  skillDescription: string;
  skillFocus?: string;
  skillFilePath: string;
  sourceCanvasFilePath: string;
  sourceNodeIds: string[];
  sourceEvidenceIds: string[];
  status?: GeneratedSkillStatus;
};
```

Update `TaskGraphNode` with:

```ts
taskId?: number;
```

Update `NewTaskGraphNode` with:

```ts
taskId?: number;
```

- [ ] **Step 4: Add backend interface methods**

In `src/memory/core/backend.ts`, import the new types and add these methods to `MemoryBackend`:

```ts
createTaskCanvas(task: NewTaskCanvas): Promise<TaskCanvas>;
getTaskCanvasById(userId: string, taskId: number): Promise<TaskCanvas | undefined>;
getActiveTaskCanvas(userId: string, chatId: string): Promise<TaskCanvas | undefined>;
listTaskCanvases(userId: string, chatId: string, limit: number): Promise<TaskCanvas[]>;
updateTaskCanvasStatus(taskId: number, status: TaskCanvasStatus): Promise<void>;
recordL15Judgment(judgment: NewL15Judgment): Promise<L15Judgment>;
insertTaskBoundary(boundary: NewTaskBoundary): Promise<TaskBoundary>;
listTaskGraphNodesForTask(taskId: number, limit: number): Promise<TaskGraphNode[]>;
insertGeneratedSkill(skill: NewGeneratedSkill): Promise<GeneratedSkill>;
countGeneratedSkills(userId: string): Promise<number>;
listGeneratedSkills(userId: string, limit: number): Promise<GeneratedSkill[]>;
```

- [ ] **Step 5: Add SQLite schema**

In `src/memory/backends/sqlite/migrate.ts`, add tables inside the existing `db.exec` block:

```sql
CREATE TABLE IF NOT EXISTS memory_task_canvases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  file_path TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_task_canvases_user_chat_status
ON memory_task_canvases(user_id, chat_id, status, updated_at);

CREATE TABLE IF NOT EXISTS memory_l15_judgments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source_conversation_id INTEGER,
  task_completed INTEGER NOT NULL,
  is_long_task INTEGER NOT NULL,
  is_continuation INTEGER NOT NULL,
  selected_task_id INTEGER,
  new_task_label TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_task_boundaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  start_node_sequence INTEGER NOT NULL,
  result TEXT NOT NULL,
  task_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_generated_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_task_id INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  skill_description TEXT NOT NULL,
  skill_focus TEXT,
  skill_file_path TEXT NOT NULL,
  source_canvas_file_path TEXT NOT NULL,
  source_node_ids_json TEXT NOT NULL DEFAULT '[]',
  source_evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

After the existing scenario column migration, add:

```ts
const taskNodeColumns = new Set(
  (db.query(`PRAGMA table_info(memory_task_nodes)`).all() as Array<{ name: string }>).map((row) => row.name),
);
if (!taskNodeColumns.has("task_id")) {
  db.exec(`ALTER TABLE memory_task_nodes ADD COLUMN task_id INTEGER`);
}
```

- [ ] **Step 6: Update SQLite backend constructor options**

In `src/memory/backends/sqlite/backend.ts`, extend `SqliteMemoryBackendOptions`:

```ts
taskCanvasDir?: string;
generatedSkillsDir?: string;
```

In `init()`, add directories with fallbacks:

```ts
mkdir(this.options.taskCanvasDir ?? this.options.canvasDir, { recursive: true }),
mkdir(this.options.generatedSkillsDir ?? this.options.dataDir, { recursive: true }),
```

Add helper methods near the other private helpers:

```ts
private taskCanvasDir(): string {
  return this.options.taskCanvasDir ?? this.options.canvasDir;
}

private generatedSkillsDir(): string {
  return this.options.generatedSkillsDir ?? this.options.dataDir;
}

private makeTaskCanvasRelativePath(chatId: string, label: string, id: number): string {
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "task";
  return relative(this.options.dataDir, join(this.taskCanvasDir(), chatId, `${String(id).padStart(4, "0")}-${safeLabel}.mmd`)).replace(/\\/g, "/");
}
```

- [ ] **Step 7: Persist task id on task nodes**

Update `insertTaskGraphNode` SQL to include `task_id`:

```ts
INSERT INTO memory_task_nodes (chat_id, user_id, task_id, node_id, tool_name, args_json, summary, result_ref, status, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

Update `.run(...)` args to include:

```ts
node.taskId ?? null,
```

Update `insertOffloadRefWithTaskGraphNode` similarly.

Update `listTaskGraphNodes` SELECT and row mapping to include `task_id` and return `taskId: row.task_id ?? undefined`.

- [ ] **Step 8: Implement task canvas and generated skill backend methods**

Add these method bodies inside `SqliteMemoryBackend`:

```ts
async createTaskCanvas(task: NewTaskCanvas): Promise<TaskCanvas> {
  const createdAt = nowIso();
  const initial = this.db
    .query(`
      INSERT INTO memory_task_canvases (chat_id, user_id, label, file_path, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(task.chatId, task.userId, task.label, task.filePath ?? "", task.status ?? "active", createdAt, createdAt);
  const id = Number(initial.lastInsertRowid);
  const filePath = task.filePath ?? this.makeTaskCanvasRelativePath(task.chatId, task.label, id);
  this.db.query(`UPDATE memory_task_canvases SET file_path = ? WHERE id = ?`).run(filePath, id);

  return {
    id,
    chatId: task.chatId,
    userId: task.userId,
    label: task.label,
    filePath,
    status: task.status ?? "active",
    createdAt,
    updatedAt: createdAt,
  };
}

async getTaskCanvasById(userId: string, taskId: number): Promise<TaskCanvas | undefined> {
  const row = this.db
    .query(`SELECT id, chat_id, user_id, label, file_path, status, created_at, updated_at FROM memory_task_canvases WHERE user_id = ? AND id = ?`)
    .get(userId, taskId) as any;
  return row ? this.mapTaskCanvasRow(row) : undefined;
}

async getActiveTaskCanvas(userId: string, chatId: string): Promise<TaskCanvas | undefined> {
  const row = this.db
    .query(`
      SELECT id, chat_id, user_id, label, file_path, status, created_at, updated_at
      FROM memory_task_canvases
      WHERE user_id = ? AND chat_id = ? AND status = 'active'
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `)
    .get(userId, chatId) as any;
  return row ? this.mapTaskCanvasRow(row) : undefined;
}

async listTaskCanvases(userId: string, chatId: string, limit: number): Promise<TaskCanvas[]> {
  const rows = this.db
    .query(`
      SELECT id, chat_id, user_id, label, file_path, status, created_at, updated_at
      FROM memory_task_canvases
      WHERE user_id = ? AND chat_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `)
    .all(userId, chatId, limit) as any[];
  return rows.map((row) => this.mapTaskCanvasRow(row));
}

async updateTaskCanvasStatus(taskId: number, status: TaskCanvasStatus): Promise<void> {
  this.db.query(`UPDATE memory_task_canvases SET status = ?, updated_at = ? WHERE id = ?`).run(status, nowIso(), taskId);
}
```

Add this private mapper:

```ts
private mapTaskCanvasRow(row: any): TaskCanvas {
  return {
    id: row.id,
    chatId: row.chat_id,
    userId: row.user_id,
    label: row.label,
    filePath: row.file_path,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

Add judgment, boundary, task-node, and skill methods:

```ts
async recordL15Judgment(judgment: NewL15Judgment): Promise<L15Judgment> {
  const createdAt = nowIso();
  const result = this.db
    .query(`
      INSERT INTO memory_l15_judgments (chat_id, user_id, source_conversation_id, task_completed, is_long_task, is_continuation, selected_task_id, new_task_label, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      judgment.chatId,
      judgment.userId,
      judgment.sourceConversationId ?? null,
      judgment.taskCompleted ? 1 : 0,
      judgment.isLongTask ? 1 : 0,
      judgment.isContinuation ? 1 : 0,
      judgment.selectedTaskId ?? null,
      judgment.newTaskLabel ?? null,
      judgment.source,
      createdAt,
    );
  return {
    id: Number(result.lastInsertRowid),
    chatId: judgment.chatId,
    userId: judgment.userId,
    sourceConversationId: judgment.sourceConversationId,
    taskCompleted: judgment.taskCompleted,
    isLongTask: judgment.isLongTask,
    isContinuation: judgment.isContinuation,
    selectedTaskId: judgment.selectedTaskId,
    newTaskLabel: judgment.newTaskLabel,
    source: judgment.source,
    createdAt,
  };
}

async insertTaskBoundary(boundary: NewTaskBoundary): Promise<TaskBoundary> {
  const createdAt = nowIso();
  const result = this.db
    .query(`
      INSERT INTO memory_task_boundaries (chat_id, user_id, start_node_sequence, result, task_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(boundary.chatId, boundary.userId, boundary.startNodeSequence, boundary.result, boundary.taskId ?? null, createdAt);
  return {
    id: Number(result.lastInsertRowid),
    chatId: boundary.chatId,
    userId: boundary.userId,
    startNodeSequence: boundary.startNodeSequence,
    result: boundary.result,
    taskId: boundary.taskId,
    createdAt,
  };
}

async listTaskGraphNodesForTask(taskId: number, limit: number): Promise<TaskGraphNode[]> {
  const rows = this.db
    .query(`
      SELECT id, chat_id, user_id, task_id, node_id, tool_name, args_json, summary, result_ref, status, created_at
      FROM memory_task_nodes
      WHERE task_id = ?
      ORDER BY id DESC
      LIMIT ?
    `)
    .all(taskId, limit) as any[];
  return rows.reverse().map((row) => ({
    id: row.id,
    chatId: row.chat_id,
    userId: row.user_id,
    taskId: row.task_id ?? undefined,
    nodeId: row.node_id,
    toolName: row.tool_name ?? undefined,
    args: parseEventMeta(row.args_json),
    summary: row.summary,
    resultRef: row.result_ref ?? undefined,
    status: row.status,
    createdAt: row.created_at,
  }));
}

async insertGeneratedSkill(skill: NewGeneratedSkill): Promise<GeneratedSkill> {
  const createdAt = nowIso();
  const status = skill.status ?? "draft";
  const result = this.db
    .query(`
      INSERT INTO memory_generated_skills (source_task_id, chat_id, user_id, skill_name, skill_description, skill_focus, skill_file_path, source_canvas_file_path, source_node_ids_json, source_evidence_ids_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      skill.sourceTaskId,
      skill.chatId,
      skill.userId,
      skill.skillName,
      skill.skillDescription,
      skill.skillFocus ?? null,
      skill.skillFilePath,
      skill.sourceCanvasFilePath,
      JSON.stringify(skill.sourceNodeIds),
      JSON.stringify(skill.sourceEvidenceIds),
      status,
      createdAt,
      createdAt,
    );
  return {
    id: Number(result.lastInsertRowid),
    sourceTaskId: skill.sourceTaskId,
    chatId: skill.chatId,
    userId: skill.userId,
    skillName: skill.skillName,
    skillDescription: skill.skillDescription,
    skillFocus: skill.skillFocus,
    skillFilePath: skill.skillFilePath,
    sourceCanvasFilePath: skill.sourceCanvasFilePath,
    sourceNodeIds: skill.sourceNodeIds,
    sourceEvidenceIds: skill.sourceEvidenceIds,
    status,
    createdAt,
    updatedAt: createdAt,
  };
}

async countGeneratedSkills(userId: string): Promise<number> {
  const row = this.db.query(`SELECT COUNT(*) AS count FROM memory_generated_skills WHERE user_id = ?`).get(userId) as { count: number } | null;
  return row?.count ?? 0;
}

async listGeneratedSkills(userId: string, limit: number): Promise<GeneratedSkill[]> {
  const rows = this.db
    .query(`
      SELECT id, source_task_id, chat_id, user_id, skill_name, skill_description, skill_focus, skill_file_path, source_canvas_file_path, source_node_ids_json, source_evidence_ids_json, status, created_at, updated_at
      FROM memory_generated_skills
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT ?
    `)
    .all(userId, limit) as any[];
  return rows.map((row) => ({
    id: row.id,
    sourceTaskId: row.source_task_id,
    chatId: row.chat_id,
    userId: row.user_id,
    skillName: row.skill_name,
    skillDescription: row.skill_description,
    skillFocus: row.skill_focus ?? undefined,
    skillFilePath: row.skill_file_path,
    sourceCanvasFilePath: row.source_canvas_file_path,
    sourceNodeIds: JSON.parse(row.source_node_ids_json),
    sourceEvidenceIds: JSON.parse(row.source_evidence_ids_json),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
```

- [ ] **Step 9: Update getTaskCanvas for active task canvases**

In `SqliteMemoryBackend.getTaskCanvas(chatId)`, before legacy file reading, add:

```ts
const active = this.db
  .query(`
    SELECT file_path
    FROM memory_task_canvases
    WHERE chat_id = ? AND status = 'active'
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `)
  .get(chatId) as { file_path: string } | null;

if (active?.file_path) {
  try {
    return await readFile(join(this.options.dataDir, active.file_path), "utf8");
  } catch {
    return undefined;
  }
}
```

Keep the existing legacy per-chat canvas fallback after this block.

- [ ] **Step 10: Run tests**

Run:

```bash
bun test tests/memory/sqlite-backend.test.ts tests/memory/offload.test.ts
bun run typecheck
```

Expected: PASS after updating constructor call sites that need `taskCanvasDir` and `generatedSkillsDir`.

- [ ] **Step 11: Commit**

```bash
git add src/memory/core/types.ts src/memory/core/backend.ts src/memory/backends/sqlite/migrate.ts src/memory/backends/sqlite/backend.ts tests/memory/sqlite-backend.test.ts tests/memory/offload.test.ts
git commit -m "feat: add task canvas and generated skill storage"
```

---

## Task 3: L1.5 judgment module

**Files:**
- Create: `src/memory/offload/types.ts`
- Create: `src/memory/offload/l15.ts`
- Test: `tests/memory/l15.test.ts`

- [ ] **Step 1: Write failing L1.5 tests**

Create `tests/memory/l15.test.ts`:

```ts
import { expect, test } from "bun:test";
import { judgeTaskByRules, parseL15Json, runL15Judgment } from "../../src/memory/offload/l15";
import type { LlmProvider } from "../../src/agent/types";

test("rules classify current datetime question as short tool-assisted QA", () => {
  const judgment = judgeTaskByRules({
    latestUserMessage: "sekarang Hari apa dan jam berapa",
    activeTask: undefined,
    historicalTasks: [],
  });

  expect(judgment).toEqual({
    taskCompleted: false,
    isLongTask: false,
    isContinuation: false,
    source: "rules",
  });
});

test("rules classify implementation requests as new long tasks", () => {
  const judgment = judgeTaskByRules({
    latestUserMessage: "tambahkan L1.5 judging dan task canvas routing",
    activeTask: undefined,
    historicalTasks: [],
  });

  expect(judgment).toEqual({
    taskCompleted: true,
    isLongTask: true,
    isContinuation: false,
    newTaskLabel: "tambahkan-l15-judging-dan-task",
    source: "rules",
  });
});

test("rules mark explicit completion on active task", () => {
  const judgment = judgeTaskByRules({
    latestUserMessage: "sudah selesai dan test passing",
    activeTask: { id: 12, label: "adapt-l15", status: "active", canvas: "graph LR" },
    historicalTasks: [],
  });

  expect(judgment).toEqual({
    taskCompleted: true,
    isLongTask: false,
    isContinuation: false,
    selectedTaskId: 12,
    source: "rules",
  });
});

test("parseL15Json accepts fenced JSON and normalizes labels", () => {
  const parsed = parseL15Json("```json\n{\"taskCompleted\":true,\"isLongTask\":true,\"isContinuation\":false,\"newTaskLabel\":\"Add L1.5 Router!\"}\n```");

  expect(parsed).toEqual({
    taskCompleted: true,
    isLongTask: true,
    isContinuation: false,
    newTaskLabel: "add-l15-router",
    source: "llm",
  });
});

test("runL15Judgment falls back to short when LLM returns malformed JSON", async () => {
  const llm: LlmProvider = {
    async complete() {
      return { content: "not json", toolCalls: [] };
    },
  };

  const judgment = await runL15Judgment({
    llm,
    mode: "llm",
    latestUserMessage: "ini ambiguous",
    recentMessages: [],
    activeTask: undefined,
    historicalTasks: [],
    maxCanvasChars: 12000,
  });

  expect(judgment).toEqual({
    taskCompleted: false,
    isLongTask: false,
    isContinuation: false,
    source: "fallback",
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
bun test tests/memory/l15.test.ts
```

Expected: FAIL because `src/memory/offload/l15.ts` does not exist.

- [ ] **Step 3: Add offload pipeline types**

Create `src/memory/offload/types.ts`:

```ts
export type L15Mode = "rules" | "llm" | "hybrid";

export type L15TaskSummary = {
  id: number;
  label: string;
  status: "active" | "completed" | "inactive";
  canvas?: string;
};

export type L15Input = {
  latestUserMessage: string;
  activeTask?: L15TaskSummary;
  historicalTasks: L15TaskSummary[];
};

export type L15JudgmentResult = {
  taskCompleted: boolean;
  isLongTask: boolean;
  isContinuation: boolean;
  selectedTaskId?: number;
  newTaskLabel?: string;
  source: "rules" | "llm" | "fallback";
};

export type L15RunInput = L15Input & {
  llm: import("../../agent/types").LlmProvider;
  mode: L15Mode;
  recentMessages: Array<{ role: string; content: string }>;
  maxCanvasChars: number;
};
```

- [ ] **Step 4: Implement L1.5 module**

Create `src/memory/offload/l15.ts`:

```ts
import type { AgentMessage, LlmProvider } from "../../agent/types";
import { truncateText } from "../../utils/text";
import type { L15Input, L15JudgmentResult, L15Mode, L15RunInput } from "./types";

const SHORT_PATTERNS = [
  /^(sekarang\s+)?hari apa/i,
  /jam berapa/i,
  /current\s+(date|time|day)/i,
  /what\s+(day|time|date)/i,
  /^(hi|hello|halo|thanks|terima kasih)\b/i,
];

const COMPLETION_PATTERNS = [
  /\b(selesai|done|fixed|beres|kelar)\b/i,
  /test(s)?\s+(passing|pass|lolos)/i,
];

const LONG_TASK_PATTERNS = [
  /\b(implement|tambahkan|add|build|buat|fix|betulkan|debug|refactor|adaptasi|migrasi|update|ubah|rancang|planning|plan)\b/i,
];

export function normalizeTaskLabel(input: string): string {
  return input
    .toLowerCase()
    .replace(/l1\.5/g, "l15")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 5)
    .join("-") || "new-task";
}

export function judgeTaskByRules(input: L15Input): L15JudgmentResult | undefined {
  const message = input.latestUserMessage.trim();
  if (!message) {
    return { taskCompleted: false, isLongTask: false, isContinuation: false, source: "rules" };
  }

  if (input.activeTask && COMPLETION_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      taskCompleted: true,
      isLongTask: false,
      isContinuation: false,
      selectedTaskId: input.activeTask.id,
      source: "rules",
    };
  }

  if (SHORT_PATTERNS.some((pattern) => pattern.test(message))) {
    return { taskCompleted: false, isLongTask: false, isContinuation: false, source: "rules" };
  }

  const matchingHistorical = input.historicalTasks.find((task) => {
    const labelTokens = task.label.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
    const lower = message.toLowerCase();
    return labelTokens.length > 0 && labelTokens.every((token) => lower.includes(token));
  });
  if (matchingHistorical) {
    return {
      taskCompleted: false,
      isLongTask: true,
      isContinuation: true,
      selectedTaskId: matchingHistorical.id,
      source: "rules",
    };
  }

  if (input.activeTask && /\b(continue|lanjut|lanjutkan|masih|itu|tersebut)\b/i.test(message)) {
    return {
      taskCompleted: false,
      isLongTask: true,
      isContinuation: true,
      selectedTaskId: input.activeTask.id,
      source: "rules",
    };
  }

  if (LONG_TASK_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      taskCompleted: input.activeTask ? false : true,
      isLongTask: true,
      isContinuation: Boolean(input.activeTask),
      selectedTaskId: input.activeTask?.id,
      newTaskLabel: input.activeTask ? undefined : normalizeTaskLabel(message),
      source: "rules",
    };
  }

  return undefined;
}

function extractJson(content: string): string | undefined {
  return content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? content.match(/\{[\s\S]*\}/)?.[0];
}

export function parseL15Json(content: string): L15JudgmentResult | undefined {
  const raw = extractJson(content);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.taskCompleted !== "boolean") return undefined;
    if (typeof parsed.isLongTask !== "boolean") return undefined;
    if (typeof parsed.isContinuation !== "boolean") return undefined;

    const selectedTaskId = typeof parsed.selectedTaskId === "number" && Number.isFinite(parsed.selectedTaskId)
      ? parsed.selectedTaskId
      : undefined;
    const newTaskLabel = typeof parsed.newTaskLabel === "string" && parsed.newTaskLabel.trim()
      ? normalizeTaskLabel(parsed.newTaskLabel)
      : undefined;

    return {
      taskCompleted: parsed.taskCompleted,
      isLongTask: parsed.isLongTask,
      isContinuation: parsed.isContinuation,
      ...(selectedTaskId ? { selectedTaskId } : {}),
      ...(newTaskLabel ? { newTaskLabel } : {}),
      source: "llm",
    };
  } catch {
    return undefined;
  }
}

function buildL15Messages(input: L15RunInput): AgentMessage[] {
  const activeTask = input.activeTask
    ? `id=${input.activeTask.id}\nlabel=${input.activeTask.label}\nstatus=${input.activeTask.status}\ncanvas=${truncateText(input.activeTask.canvas ?? "", input.maxCanvasChars)}`
    : "none";
  const history = input.historicalTasks
    .map((task) => `id=${task.id}\nlabel=${task.label}\nstatus=${task.status}\ncanvas=${truncateText(task.canvas ?? "", 2000)}`)
    .join("\n\n---\n\n") || "none";
  const recent = input.recentMessages.map((message) => `${message.role}: ${message.content}`).join("\n");

  return [
    {
      role: "system",
      content: [
        "You are the L1.5 task lifecycle judge for a Telegram coding agent.",
        "Return only strict JSON with boolean fields taskCompleted, isLongTask, isContinuation and optional numeric selectedTaskId and string newTaskLabel.",
        "Classify one-shot questions and current date/time requests as short non-long tasks even when tools are useful.",
        "Do not mark an active task completed unless the user explicitly says it is finished.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Latest user message:\n${input.latestUserMessage}`,
        `Recent messages:\n${recent}`,
        `Active task:\n${activeTask}`,
        `Historical tasks:\n${history}`,
      ].join("\n\n"),
    },
  ];
}

async function judgeByLlm(llm: LlmProvider, input: L15RunInput): Promise<L15JudgmentResult | undefined> {
  const response = await llm.complete({
    messages: buildL15Messages(input),
    tools: [],
    temperature: 0.1,
  });
  return parseL15Json(response.content);
}

export async function runL15Judgment(input: L15RunInput): Promise<L15JudgmentResult> {
  const mode: L15Mode = input.mode;
  if (mode === "rules" || mode === "hybrid") {
    const rules = judgeTaskByRules(input);
    if (rules || mode === "rules") {
      return rules ?? { taskCompleted: false, isLongTask: false, isContinuation: false, source: "fallback" };
    }
  }

  const llm = await judgeByLlm(input.llm, input).catch(() => undefined);
  return llm ?? { taskCompleted: false, isLongTask: false, isContinuation: false, source: "fallback" };
}
```

- [ ] **Step 5: Run L1.5 tests**

Run:

```bash
bun test tests/memory/l15.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/memory/offload/types.ts src/memory/offload/l15.ts tests/memory/l15.test.ts
git commit -m "feat: add L1.5 task judgment"
```

---

## Task 4: Agent integration and task-scoped canvas routing

**Files:**
- Modify: `src/memory/core/service.ts`
- Modify: `src/memory/integration/factory.ts`
- Modify: `src/memory/offload/service.ts`
- Modify: `src/agent/react-agent.ts`
- Modify: `tests/memory/offload.test.ts`
- Modify: `tests/memory/agent-runtime.test.ts`

- [ ] **Step 1: Add failing offload routing tests**

Append these tests to `tests/memory/offload.test.ts`:

```ts
test("short task tool results create nodes without updating a task canvas", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-offload-short-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
      taskCanvasDir: join(tempDir, "task-canvases"),
      generatedSkillsDir: join(tempDir, "skills"),
    });
    await backend.init();

    const offload = new OffloadService(backend, { offloadMinChars: 1000, offloadSummaryChars: 80 });
    const result = await offload.offloadToolResult({
      chatId: "c1",
      userId: "u1",
      toolName: "tdai_current_datetime",
      args: {},
      rawResult: "{\"weekday_local\":\"Senin\"}",
    });

    expect(result.offloaded).toBe(false);
    expect(result.nodeId).toBeDefined();
    expect(await backend.getTaskCanvas("c1")).toBeUndefined();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("long task tool results update the selected task canvas", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-offload-long-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
      taskCanvasDir: join(tempDir, "task-canvases"),
      generatedSkillsDir: join(tempDir, "skills"),
    });
    await backend.init();

    const task = await backend.createTaskCanvas({ chatId: "c1", userId: "u1", label: "adapt-l15", status: "active" });
    const offload = new OffloadService(backend, { offloadMinChars: 1000, offloadSummaryChars: 80 });
    const result = await offload.offloadToolResult({
      chatId: "c1",
      userId: "u1",
      taskId: task.id,
      toolName: "demo_tool",
      args: { step: 1 },
      rawResult: "demo result",
    });

    const canvas = await backend.getTaskCanvas("c1");
    expect(canvas).toContain("graph LR");
    expect(canvas).toContain(String(result.nodeId));
    expect(canvas).toContain("demo_tool");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run failing offload tests**

Run:

```bash
bun test tests/memory/offload.test.ts
```

Expected: FAIL because `OffloadToolResultInput` does not accept `taskId` and canvas writing is still per-chat.

- [ ] **Step 3: Extend factory config**

In `src/memory/integration/factory.ts`, extend `MemoryServiceFactoryConfig.storage` with:

```ts
memoryTaskCanvasDir: string;
memoryGeneratedSkillsDir: string;
```

Extend `MemoryServiceFactoryConfig.memory` with:

```ts
l15: {
  enabled: boolean;
  mode: "rules" | "llm" | "hybrid";
  recentMessages: number;
  historyTaskLimit: number;
  maxCanvasChars: number;
  safeFallback: "short";
};
l4: {
  enabled: boolean;
  mode: "local";
  requireCompletedTask: boolean;
  maxEvidenceEntries: number;
  maxCanvasChars: number;
  maxSkillChars: number;
};
```

Pass the new storage dirs to `SqliteMemoryBackend`:

```ts
taskCanvasDir: config.storage.memoryTaskCanvasDir,
generatedSkillsDir: config.storage.memoryGeneratedSkillsDir,
```

Pass the new options into `MemoryService` by extending its options object:

```ts
l15: config.memory.l15,
l4: config.memory.l4,
generatedSkillsDir: config.storage.memoryGeneratedSkillsDir,
```

Update `src/index.ts` `createMemoryService` call by adding:

```ts
memoryTaskCanvasDir: config.storage.memoryTaskCanvasDir,
memoryGeneratedSkillsDir: config.storage.memoryGeneratedSkillsDir,
```

and:

```ts
l15: config.memory.l15,
l4: config.memory.l4,
```

- [ ] **Step 4: Extend MemoryService options and routing methods**

In `src/memory/core/service.ts`, import:

```ts
import { runL15Judgment } from "../offload/l15";
import type { L15JudgmentResult } from "../offload/types";
```

Extend `MemoryServiceOptions` with:

```ts
l15: {
  enabled: boolean;
  mode: "rules" | "llm" | "hybrid";
  recentMessages: number;
  historyTaskLimit: number;
  maxCanvasChars: number;
  safeFallback: "short";
};
l4: {
  enabled: boolean;
  mode: "local";
  requireCompletedTask: boolean;
  maxEvidenceEntries: number;
  maxCanvasChars: number;
  maxSkillChars: number;
};
generatedSkillsDir: string;
```

Add this return type near `LogTurnInput`:

```ts
export type TaskRoutingResult = {
  judgment: L15JudgmentResult;
  taskId?: number;
};
```

Add this method to `MemoryService`:

```ts
async judgeTaskTurn(input: { chatId: string; userId: string; latestUserMessage: string; sourceConversationId?: number }): Promise<TaskRoutingResult> {
  const { backend, options, llm } = getState(this) as MemoryServiceState & { llm: LlmProvider };
  if (!options.l15.enabled) {
    return { judgment: { taskCompleted: false, isLongTask: false, isContinuation: false, source: "fallback" } };
  }

  const [recent, activeTask, historical] = await Promise.all([
    backend.listConversationTurns(input.userId, input.chatId, options.l15.recentMessages),
    backend.getActiveTaskCanvas(input.userId, input.chatId),
    backend.listTaskCanvases(input.userId, input.chatId, options.l15.historyTaskLimit),
  ]);

  const activeCanvas = activeTask ? await backend.getTaskCanvas(input.chatId) : undefined;
  const judgment = await runL15Judgment({
    llm,
    mode: options.l15.mode,
    latestUserMessage: input.latestUserMessage,
    recentMessages: recent.map((turn) => ({ role: turn.role, content: turn.content })),
    activeTask: activeTask ? { id: activeTask.id, label: activeTask.label, status: activeTask.status, canvas: activeCanvas } : undefined,
    historicalTasks: historical.map((task) => ({ id: task.id, label: task.label, status: task.status })),
    maxCanvasChars: options.l15.maxCanvasChars,
  });

  let taskId = judgment.selectedTaskId;
  if (judgment.taskCompleted && activeTask && !judgment.isLongTask) {
    await backend.updateTaskCanvasStatus(activeTask.id, "completed");
  }
  if (judgment.isLongTask && !taskId && judgment.newTaskLabel) {
    const task = await backend.createTaskCanvas({
      chatId: input.chatId,
      userId: input.userId,
      label: judgment.newTaskLabel,
      status: "active",
    });
    taskId = task.id;
  }

  await backend.recordL15Judgment({
    chatId: input.chatId,
    userId: input.userId,
    sourceConversationId: input.sourceConversationId,
    taskCompleted: judgment.taskCompleted,
    isLongTask: judgment.isLongTask,
    isContinuation: judgment.isContinuation,
    selectedTaskId: taskId,
    newTaskLabel: judgment.newTaskLabel,
    source: judgment.source,
  });

  await backend.insertTaskBoundary({
    chatId: input.chatId,
    userId: input.userId,
    startNodeSequence: 0,
    result: taskId && judgment.isLongTask ? "long" : "short",
    taskId,
  });

  return { judgment, taskId: judgment.isLongTask ? taskId : undefined };
}
```

Also update `MemoryServiceState` to store `llm`:

```ts
llm: LlmProvider;
```

and include `llm` in `memoryServiceState.set`.

- [ ] **Step 5: Update OffloadService input and canvas writing**

In `src/memory/offload/service.ts`, add `taskId?: number` to `OffloadToolResultInput`.

When inserting non-offloaded nodes, include:

```ts
taskId: input.taskId,
```

Replace `await this.tryWriteTaskCanvas(input.chatId);` with:

```ts
if (input.taskId) {
  await this.tryWriteTaskCanvas(input.chatId, input.taskId);
}
```

Make the same change in offloaded and fallback paths.

Change `writeTaskCanvas` signature:

```ts
private async writeTaskCanvas(chatId: string, taskId: number): Promise<void> {
  const nodes = await this.backend.listTaskGraphNodesForTask(taskId, 80);
  const task = await this.backend.getTaskCanvasById(nodes[0]?.userId ?? "", taskId);
  if (!task) return;
  const canvasPath = resolve((this.backend as any).options?.dataDir ?? process.cwd(), task.filePath);
  await mkdir(dirname(canvasPath), { recursive: true });
  await this.writeTextFile(canvasPath, `${this.buildTaskCanvas(chatId, nodes)}\n`);
}
```

If direct access to backend private options is not possible, add a backend method `getTaskCanvasAbsolutePath(taskId: number): Promise<string | undefined>` instead of using `(this.backend as any).options`. Prefer the backend method if TypeScript rejects the private access.

Change `tryWriteTaskCanvas` to accept `taskId` and call `writeTaskCanvas(chatId, taskId)`.

- [ ] **Step 6: Wire L1.5 into the agent loop**

In `src/agent/react-agent.ts`, replace the user logging block:

```ts
await input.memory.logUserMessage({
  chatId: input.chatId,
  userId: input.userId,
  content: input.input,
  mode: input.mode ?? "chat",
});
```

with:

```ts
const sourceConversationId = await input.memory.logUserMessage({
  chatId: input.chatId,
  userId: input.userId,
  content: input.input,
  mode: input.mode ?? "chat",
});

const taskRouting = await input.memory.judgeTaskTurn({
  chatId: input.chatId,
  userId: input.userId,
  latestUserMessage: input.input,
  sourceConversationId,
});
```

In the `offloadToolResult` call, add:

```ts
taskId: taskRouting.taskId,
```

Add a context log after judgment:

```ts
logAgentEvent("l15", {
  mode: input.mode ?? "chat",
  chatId: input.chatId,
  isLongTask: taskRouting.judgment.isLongTask,
  isContinuation: taskRouting.judgment.isContinuation,
  taskCompleted: taskRouting.judgment.taskCompleted,
  taskId: taskRouting.taskId,
  source: taskRouting.judgment.source,
});
```

- [ ] **Step 7: Update agent runtime test**

In `tests/memory/agent-runtime.test.ts`, update `createMemoryService` config with new storage/memory fields:

```ts
memoryTaskCanvasDir: join(tempDir, "memory", "task-canvases"),
memoryGeneratedSkillsDir: join(tempDir, "memory", "skills"),
```

and:

```ts
l15: {
  enabled: true,
  mode: "hybrid",
  recentMessages: 6,
  historyTaskLimit: 10,
  maxCanvasChars: 12000,
  safeFallback: "short",
},
l4: {
  enabled: true,
  mode: "local",
  requireCompletedTask: false,
  maxEvidenceEntries: 80,
  maxCanvasChars: 20000,
  maxSkillChars: 20000,
},
```

Add a new test in `tests/memory/agent-runtime.test.ts`:

```ts
test("current datetime one-shot question does not create a task canvas", async () => {
  const llm = {
    calls: 0,
    async complete() {
      this.calls += 1;
      if (this.calls === 1) {
        return { content: "", toolCalls: [{ id: "call-1", name: "tdai_current_datetime", arguments: {} }] };
      }
      return { content: "Sekarang Senin.", toolCalls: [] };
    },
  };
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-agent-datetime-"));

  try {
    const db = new Database(":memory:");
    migrate(db);
    const memory = await createMemoryService(db, llm as any, {
      storage: {
        dataDir: tempDir,
        memoryRefsDir: join(tempDir, "memory", "refs"),
        memoryCanvasDir: join(tempDir, "memory", "canvases"),
        memoryTaskCanvasDir: join(tempDir, "memory", "task-canvases"),
        memoryGeneratedSkillsDir: join(tempDir, "memory", "skills"),
        memoryJsonlExportDir: join(tempDir, "memory", "jsonl"),
      },
      memory: {
        maintenanceCron: "*/10 * * * *",
        offloadEnabled: true,
        offloadMinChars: 2500,
        offloadSummaryChars: 900,
        sqliteVecEnabled: true,
        jsonlExportEnabled: false,
        l15: { enabled: true, mode: "hybrid", recentMessages: 6, historyTaskLimit: 10, maxCanvasChars: 12000, safeFallback: "short" },
        l4: { enabled: true, mode: "local", requireCompletedTask: false, maxEvidenceEntries: 80, maxCanvasChars: 20000, maxSkillChars: 20000 },
      },
    });
    const registry = new ToolRegistry(db);
    registry.registerMany(createLocalTools(memory));

    await runReactAgent({
      chatId: "c1",
      userId: "u1",
      input: "sekarang Hari apa dan jam berapa",
      memory,
      registry,
      llm: llm as any,
      mode: "chat",
    });

    await expect(memory.recall("u1", "time", 5, "c1")).resolves.toMatchObject({ taskCanvas: undefined });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 8: Run tests**

Run:

```bash
bun test tests/memory/offload.test.ts tests/memory/agent-runtime.test.ts tests/memory/l15.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/memory/core/service.ts src/memory/integration/factory.ts src/memory/offload/service.ts src/agent/react-agent.ts tests/memory/offload.test.ts tests/memory/agent-runtime.test.ts
git commit -m "feat: route offload canvas updates through L1.5"
```

---

## Task 5: L4 draft skill generation service

**Files:**
- Create: `src/memory/offload/l4.ts`
- Modify: `src/memory/core/service.ts`
- Test: `tests/memory/l4.test.ts`

- [ ] **Step 1: Write failing L4 tests**

Create `tests/memory/l4.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseL4Json, validateGeneratedSkill, writeDraftSkill } from "../../src/memory/offload/l4";

test("parseL4Json parses generated skill JSON", () => {
  const parsed = parseL4Json(JSON.stringify({
    skillName: "debugging-l15-routing",
    skillDescription: "Use when debugging L1.5 task routing decisions",
    skillContent: "---\nname: debugging-l15-routing\ndescription: Use when debugging L1.5 task routing decisions\n---\n\n# Debugging L1.5 Routing\n",
  }));

  expect(parsed).toEqual({
    skillName: "debugging-l15-routing",
    skillDescription: "Use when debugging L1.5 task routing decisions",
    skillContent: "---\nname: debugging-l15-routing\ndescription: Use when debugging L1.5 task routing decisions\n---\n\n# Debugging L1.5 Routing\n",
  });
});

test("validateGeneratedSkill rejects unsafe or structurally invalid skills", () => {
  expect(validateGeneratedSkill({
    skillName: "Bad Name!",
    skillDescription: "Use when debugging",
    skillContent: "---\nname: Bad Name!\ndescription: Use when debugging\n---\n",
  }, { chatId: "5980836755", userId: "5980836755" })).toEqual({ ok: false, reason: "Invalid skill name." });

  expect(validateGeneratedSkill({
    skillName: "debugging-routing",
    skillDescription: "Debug routing",
    skillContent: "---\nname: debugging-routing\ndescription: Debug routing\n---\n",
  }, { chatId: "c1", userId: "u1" })).toEqual({ ok: false, reason: "Skill description must start with Use when." });

  expect(validateGeneratedSkill({
    skillName: "debugging-routing",
    skillDescription: "Use when debugging routing",
    skillContent: "---\nname: debugging-routing\ndescription: Use when debugging routing\n---\nsecret sk-test\n",
  }, { chatId: "c1", userId: "u1" })).toEqual({ ok: false, reason: "Skill content appears to contain a secret." });
});

test("writeDraftSkill writes SKILL.md under generated skills directory", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-l4-"));

  try {
    const result = await writeDraftSkill(tempDir, {
      skillName: "debugging-routing",
      skillDescription: "Use when debugging routing",
      skillContent: "---\nname: debugging-routing\ndescription: Use when debugging routing\n---\n\n# Debugging Routing\n",
    });

    expect(result.relativePath).toBe("debugging-routing/SKILL.md");
    expect(await readFile(join(tempDir, result.relativePath), "utf8")).toContain("# Debugging Routing");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
bun test tests/memory/l4.test.ts
```

Expected: FAIL because `src/memory/offload/l4.ts` does not exist.

- [ ] **Step 3: Implement L4 helpers**

Create `src/memory/offload/l4.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentMessage, LlmProvider } from "../../agent/types";
import { truncateText } from "../../utils/text";

export type L4EvidenceEntry = {
  nodeId: string;
  toolName?: string;
  args: Record<string, unknown>;
  summary: string;
  resultRef?: string;
  createdAt: string;
};

export type L4Request = {
  taskId: number;
  mmdFilename: string;
  mmdContent: string;
  offloadEntries: L4EvidenceEntry[];
  skillFocus: string | null;
  maxCanvasChars: number;
  maxSkillChars: number;
};

export type L4Response = {
  skillName: string;
  skillDescription: string;
  skillContent: string;
};

export type ValidationResult = { ok: true } | { ok: false; reason: string };

function extractJson(content: string): string | undefined {
  return content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? content.match(/\{[\s\S]*\}/)?.[0];
}

export function parseL4Json(content: string): L4Response | undefined {
  const raw = extractJson(content);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.skillName !== "string") return undefined;
    if (typeof parsed.skillDescription !== "string") return undefined;
    if (typeof parsed.skillContent !== "string") return undefined;
    return {
      skillName: parsed.skillName.trim(),
      skillDescription: parsed.skillDescription.trim(),
      skillContent: parsed.skillContent,
    };
  } catch {
    return undefined;
  }
}

export function validateGeneratedSkill(skill: L4Response, identity: { chatId: string; userId: string }): ValidationResult {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(skill.skillName)) {
    return { ok: false, reason: "Invalid skill name." };
  }
  if (!skill.skillDescription.startsWith("Use when")) {
    return { ok: false, reason: "Skill description must start with Use when." };
  }
  if (!skill.skillContent.startsWith("---\n")) {
    return { ok: false, reason: "Skill content must include YAML frontmatter." };
  }
  if (!skill.skillContent.includes(`name: ${skill.skillName}`)) {
    return { ok: false, reason: "Skill frontmatter name does not match skillName." };
  }
  if (!skill.skillContent.includes("description: Use when")) {
    return { ok: false, reason: "Skill frontmatter description must start with Use when." };
  }
  if (/sk-(ant-|proj-)?[a-zA-Z0-9_-]{8,}/.test(skill.skillContent) || /BOT_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY/.test(skill.skillContent)) {
    return { ok: false, reason: "Skill content appears to contain a secret." };
  }
  if (identity.chatId && skill.skillContent.includes(identity.chatId)) {
    return { ok: false, reason: "Skill content contains raw chat id." };
  }
  if (identity.userId && skill.skillContent.includes(identity.userId)) {
    return { ok: false, reason: "Skill content contains raw user id." };
  }
  return { ok: true };
}

function buildL4Messages(input: L4Request): AgentMessage[] {
  const evidence = input.offloadEntries.map((entry) => {
    return [
      `node_id=${entry.nodeId}`,
      `tool=${entry.toolName ?? "unknown"}`,
      `created_at=${entry.createdAt}`,
      `summary=${entry.summary}`,
      `result_ref=${entry.resultRef ?? "none"}`,
    ].join("\n");
  }).join("\n\n---\n\n");

  return [
    {
      role: "system",
      content: [
        "You generate draft Claude Code skills from grounded task evidence.",
        "Return only JSON with skillName, skillDescription, and skillContent.",
        "The skillName must use letters, numbers, and hyphens only.",
        "The skillDescription must start with Use when and describe triggering conditions, not a workflow summary.",
        "The skillContent must be a complete SKILL.md with YAML frontmatter containing name and description.",
        "Do not include secrets, chat ids, user ids, raw private logs, or long transcripts.",
        "Create a reusable technique or workflow, not a narrative of one past task.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Task id: ${input.taskId}`,
        `MMD filename: ${input.mmdFilename}`,
        `Skill focus: ${input.skillFocus ?? "none"}`,
        `Mermaid canvas:\n${truncateText(input.mmdContent, input.maxCanvasChars)}`,
        `Node-linked evidence:\n${evidence}`,
      ].join("\n\n"),
    },
  ];
}

export async function generateL4Skill(llm: LlmProvider, input: L4Request): Promise<L4Response | undefined> {
  const response = await llm.complete({
    messages: buildL4Messages(input),
    tools: [],
    temperature: 0.2,
  });
  const parsed = parseL4Json(response.content);
  if (!parsed) return undefined;
  return {
    ...parsed,
    skillContent: truncateText(parsed.skillContent, input.maxSkillChars),
  };
}

export async function writeDraftSkill(skillsDir: string, skill: L4Response): Promise<{ absolutePath: string; relativePath: string }> {
  const relativePath = `${skill.skillName}/SKILL.md`;
  const absolutePath = join(skillsDir, relativePath);
  await mkdir(join(skillsDir, skill.skillName), { recursive: true });
  await writeFile(absolutePath, skill.skillContent, "utf8");
  return { absolutePath, relativePath: relativePath.replace(/\\/g, "/") };
}
```

- [ ] **Step 4: Run L4 helper tests**

Run:

```bash
bun test tests/memory/l4.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Add MemoryService L4 method**

In `src/memory/core/service.ts`, import:

```ts
import { generateL4Skill, validateGeneratedSkill, writeDraftSkill } from "../offload/l4";
```

Add method:

```ts
async generateSkillDraft(input: { chatId: string; userId: string; taskId: number; skillFocus?: string }): Promise<{ ok: true; skillName: string; filePath: string } | { ok: false; reason: string }> {
  const { backend, options, llm } = getState(this) as MemoryServiceState & { llm: LlmProvider };
  if (!options.l4.enabled) {
    return { ok: false, reason: "L4 skill generation is disabled." };
  }

  const task = await backend.getTaskCanvasById(input.userId, input.taskId);
  if (!task || task.chatId !== input.chatId) {
    return { ok: false, reason: "Task canvas not found." };
  }
  if (options.l4.requireCompletedTask && task.status !== "completed") {
    return { ok: false, reason: "Task must be completed before skill generation." };
  }

  const canvasPath = resolve(options.dataDir, task.filePath);
  const canvas = await readFile(canvasPath, "utf8").catch(() => "");
  if (!canvas.trim()) {
    return { ok: false, reason: "Task canvas is empty." };
  }

  const nodes = await backend.listTaskGraphNodesForTask(task.id, options.l4.maxEvidenceEntries);
  const skill = await generateL4Skill(llm, {
    taskId: task.id,
    mmdFilename: task.filePath,
    mmdContent: canvas,
    offloadEntries: nodes.map((node) => ({
      nodeId: node.nodeId,
      toolName: node.toolName,
      args: node.args,
      summary: node.summary,
      resultRef: node.resultRef,
      createdAt: node.createdAt,
    })),
    skillFocus: input.skillFocus?.trim() || null,
    maxCanvasChars: options.l4.maxCanvasChars,
    maxSkillChars: options.l4.maxSkillChars,
  });
  if (!skill) {
    return { ok: false, reason: "L4 response could not be parsed." };
  }

  const validation = validateGeneratedSkill(skill, { chatId: input.chatId, userId: input.userId });
  if (!validation.ok) {
    return { ok: false, reason: validation.reason };
  }

  const written = await writeDraftSkill(options.generatedSkillsDir, skill);
  await backend.insertGeneratedSkill({
    sourceTaskId: task.id,
    chatId: input.chatId,
    userId: input.userId,
    skillName: skill.skillName,
    skillDescription: skill.skillDescription,
    skillFocus: input.skillFocus,
    skillFilePath: written.relativePath,
    sourceCanvasFilePath: task.filePath,
    sourceNodeIds: nodes.map((node) => node.nodeId),
    sourceEvidenceIds: nodes.map((node) => node.nodeId),
    status: "draft",
  });

  return { ok: true, skillName: skill.skillName, filePath: written.relativePath };
}
```

Add imports at top:

```ts
import { readFile } from "node:fs/promises";
```

`resolve` is already imported in this file.

- [ ] **Step 6: Run targeted tests**

Run:

```bash
bun test tests/memory/l4.test.ts tests/memory/sqlite-backend.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/memory/offload/l4.ts src/memory/core/service.ts tests/memory/l4.test.ts
git commit -m "feat: generate draft skills from task evidence"
```

---

## Task 6: Telegram menu flow for L4 draft skills

**Files:**
- Create: `src/bot/conversations/skill-draft.ts`
- Modify: `src/bot/ui/keyboards.ts`
- Modify: `src/bot/ui/renderers.ts`
- Modify: `src/bot/bot.ts`
- Test: `tests/bot/ui.test.ts`
- Test: `tests/bot/memory-summary.test.ts`

- [ ] **Step 1: Add failing UI tests**

In `tests/bot/ui.test.ts`, update imports:

```ts
buildSkillDraftKeyboard,
```

Add test:

```ts
test("memory menu exposes skill drafts without adding public slash commands", () => {
  expect(buildMemorySummaryKeyboard().inline_keyboard.flat().map((button) => button.text)).toEqual([
    "Memory Update",
    "Skill Drafts",
    "Back",
  ]);
  expect(buildSkillDraftKeyboard().inline_keyboard.flat().map((button) => button.text)).toEqual([
    "Generate Draft Skill",
    "Back",
  ]);
  expect(renderHelpScreen()).toContain("Memory Update, Skill Drafts, dan Jobs tersedia dari menu");
  expect(renderHelpScreen()).not.toContain("/create-skill");
});
```

Update the existing expected `buildMemorySummaryKeyboard()` labels in the older test to include `Skill Drafts`.

- [ ] **Step 2: Add failing memory summary test**

In `tests/bot/memory-summary.test.ts`, update `buildRichMemorySummary` input with:

```ts
generatedSkillCount: 2,
```

Add assertions:

```ts
expect(summary).toContain("# Skill drafts");
expect(summary).toContain("Generated drafts: 2");
```

- [ ] **Step 3: Run failing bot tests**

Run:

```bash
bun test tests/bot/ui.test.ts tests/bot/memory-summary.test.ts
```

Expected: FAIL because skill draft UI does not exist.

- [ ] **Step 4: Update keyboard callbacks**

In `src/bot/ui/keyboards.ts`, add callbacks:

```ts
skillDrafts: "ui:memory:skill-drafts",
generateSkillDraft: "ui:memory:skill-drafts:generate",
```

Change `buildMemorySummaryKeyboard()` to:

```ts
export function buildMemorySummaryKeyboard() {
  return new InlineKeyboard()
    .text("Memory Update", uiCallbacks.memoryUpdate)
    .text("Skill Drafts", uiCallbacks.skillDrafts)
    .row()
    .text("Back", uiCallbacks.back);
}
```

Add:

```ts
export function buildSkillDraftKeyboard() {
  return new InlineKeyboard()
    .text("Generate Draft Skill", uiCallbacks.generateSkillDraft)
    .row()
    .text("Back", uiCallbacks.memory);
}
```

- [ ] **Step 5: Update renderers**

In `src/bot/ui/renderers.ts`, extend `buildRichMemorySummary` input:

```ts
generatedSkillCount?: number;
```

Add after active canvas:

```ts
const generatedSkillCount = input.generatedSkillCount ?? 0;
```

Add section before Memory Update summary:

```ts
"# Skill drafts",
`Generated drafts: ${generatedSkillCount}`,
"",
```

Update `renderHelpScreen()` line:

```ts
"Memory Update, Skill Drafts, dan Jobs tersedia dari menu, bukan lewat command tambahan.",
```

Add renderer:

```ts
export function renderSkillDraftScreen(summary: string): string {
  return normalizeLines([
    "Skill Drafts",
    "",
    "Generate Draft Skill membuat draft SKILL.md dari task canvas dan evidence yang terkait.",
    "Draft tidak otomatis di-install atau di-commit.",
    "",
    summary.trim(),
  ]);
}
```

- [ ] **Step 6: Create skill draft conversation**

Create `src/bot/conversations/skill-draft.ts`:

```ts
import { InlineKeyboard, type Context } from "grammy";
import type { BotConversation } from "../context";
import type { MemoryService } from "../../memory/core/service";
import { buildMemorySummaryKeyboard, buildSkillDraftKeyboard, uiCallbacks } from "../ui/keyboards";
import { renderMemorySummaryScreen, renderSkillDraftScreen } from "../ui/renderers";

export const skillDraftConversationId = "skill-draft";

export type SkillDraftConversationDeps = {
  memory: MemoryService;
};

function resolveChatId(ctx: Context) {
  return String(ctx.chat?.id ?? "unknown");
}

function resolveUserId(ctx: Context) {
  return String(ctx.from?.id ?? ctx.chat?.id ?? "unknown");
}

function taskKeyboard(tasks: Array<{ id: number; label: string }>) {
  const keyboard = new InlineKeyboard();
  for (const task of tasks) {
    keyboard.text(`#${task.id} ${task.label}`, `skill-draft:task:${task.id}`).row();
  }
  return keyboard.text("Back", uiCallbacks.skillDrafts);
}

export function createSkillDraftConversation(deps: SkillDraftConversationDeps) {
  return async function skillDraftConversation(conversation: BotConversation, ctx: Context) {
    const chatId = resolveChatId(ctx);
    const userId = resolveUserId(ctx);
    let note = "Pilih Generate Draft Skill untuk membuat draft dari task canvas.";

    const render = async (messageCtx: Context) => {
      const count = await conversation.external(() => deps.memory.countGeneratedSkills(userId));
      const text = renderSkillDraftScreen([`Generated drafts: ${count}`, note].join("\n"));
      if (messageCtx.callbackQuery) {
        await messageCtx.editMessageText(text, { reply_markup: buildSkillDraftKeyboard() });
      } else {
        await messageCtx.reply(text, { reply_markup: buildSkillDraftKeyboard() });
      }
    };

    await render(ctx);

    while (true) {
      const action = await conversation.waitFor("callback_query:data");
      await action.answerCallbackQuery();

      switch (action.callbackQuery.data) {
        case uiCallbacks.memory: {
          await action.editMessageText(renderMemorySummaryScreen("Kembali ke Memory summary."), {
            reply_markup: buildMemorySummaryKeyboard(),
          });
          return;
        }
        case uiCallbacks.generateSkillDraft: {
          const tasks = await conversation.external(() => deps.memory.listTaskCanvases(userId, chatId, 10));
          if (tasks.length === 0) {
            note = "Belum ada task canvas untuk dijadikan skill.";
            await render(action);
            break;
          }
          await action.editMessageText("Pilih task canvas untuk skill draft:", { reply_markup: taskKeyboard(tasks) });
          break;
        }
        default: {
          const match = action.callbackQuery.data.match(/^skill-draft:task:(\d+)$/);
          if (!match) {
            note = "Action tidak dikenal.";
            await render(action);
            break;
          }
          const taskId = Number(match[1]);
          await action.reply("Kirim fokus skill, atau kirim '-' untuk tanpa fokus.");
          const focusCtx = await conversation.waitFor("message:text");
          const rawFocus = focusCtx.message.text.trim();
          const skillFocus = rawFocus === "-" ? undefined : rawFocus;
          const result = await conversation.external(() => deps.memory.generateSkillDraft({ chatId, userId, taskId, skillFocus }));
          note = result.ok
            ? `Draft dibuat: ${result.skillName}\nPath: ${result.filePath}`
            : `Gagal membuat draft: ${result.reason}`;
          await render(focusCtx);
          break;
        }
      }
    }
  };
}
```

- [ ] **Step 7: Wire bot callbacks**

In `src/bot/bot.ts`, update imports:

```ts
import { buildHelpKeyboard, buildMainMenuKeyboard, buildMemorySummaryKeyboard, buildSkillDraftKeyboard, buildStartKeyboard, uiCallbacks } from "./ui/keyboards";
import { buildRichMemorySummary, renderHelpScreen, renderJobsScreen, renderMainMenuScreen, renderMemorySummaryScreen, renderSkillDraftScreen, renderStartScreen } from "./ui/renderers";
import { createSkillDraftConversation, skillDraftConversationId } from "./conversations/skill-draft";
```

Register conversation after memory update:

```ts
bot.use(createConversation(createSkillDraftConversation({ memory: deps.memory }), { id: skillDraftConversationId } as never));
```

In `showMemorySummary`, include generated skill count:

```ts
generatedSkillCount: await deps.memory.countGeneratedSkills(userId),
```

Add callback:

```ts
bot.callbackQuery(uiCallbacks.skillDrafts, async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter(skillDraftConversationId);
});
```

- [ ] **Step 8: Expose MemoryService listing/counting methods**

In `src/memory/core/service.ts`, add:

```ts
async listTaskCanvases(userId: string, chatId: string, limit: number) {
  const { backend } = getState(this);
  return backend.listTaskCanvases(userId, chatId, limit);
}

async countGeneratedSkills(userId: string): Promise<number> {
  const { backend } = getState(this);
  return backend.countGeneratedSkills(userId);
}
```

- [ ] **Step 9: Run bot tests**

Run:

```bash
bun test tests/bot/ui.test.ts tests/bot/memory-summary.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/bot/conversations/skill-draft.ts src/bot/ui/keyboards.ts src/bot/ui/renderers.ts src/bot/bot.ts src/memory/core/service.ts tests/bot/ui.test.ts tests/bot/memory-summary.test.ts
git commit -m "feat: add skill draft generation menu"
```

---

## Task 7: Status output, docs, and full verification

**Files:**
- Modify: `src/memory/core/service.ts`
- Modify: `README.md`
- Modify: `docs/memory.md`
- Modify: `docs/architecture.md`
- Test: `tests/memory/readme.test.ts`
- Test: `tests/runtime/agent-prompt.test.ts`

- [ ] **Step 1: Add status output expectation**

In `tests/memory/readme.test.ts`, add assertions matching the existing style:

```ts
expect(readme).toContain("L1.5 task judgment");
expect(readme).toContain("L4 draft skill generation");
expect(readme).toContain("Skill Drafts");
```

If this file reads `docs/memory.md` too, add:

```ts
expect(memoryDoc).toContain("L1.5");
expect(memoryDoc).toContain("L4");
expect(memoryDoc).toContain("draft skills");
```

- [ ] **Step 2: Run failing docs tests**

Run:

```bash
bun test tests/memory/readme.test.ts tests/runtime/agent-prompt.test.ts
```

Expected: FAIL because docs do not mention the new pipeline yet.

- [ ] **Step 3: Update memory status**

In `src/memory/core/service.ts` `memoryStatus`, add `generatedSkillCount` to the `Promise.all`:

```ts
backend.countGeneratedSkills(userId),
```

Add status lines:

```ts
`L1.5 enabled=${options.l15.enabled}`,
`L1.5 mode=${options.l15.mode}`,
`L4 enabled=${options.l4.enabled}`,
`generated_skill_drafts=${generatedSkillCount}`,
```

- [ ] **Step 4: Update README**

In `README.md`, update the feature list under “What this project does” with:

```md
- judges active work with L1.5 task routing before writing task canvases
- can generate L4 draft skills from selected task canvases and node-linked evidence
```

Update “Telegram UX” / menu sections to mention:

```md
- Skill Drafts
```

Update the memory model section to include:

```md
- L1.5 task judgment for active task routing
- task-scoped Mermaid canvases
- L4 draft skill generation from task evidence
```

- [ ] **Step 5: Update docs/memory.md**

Add a section after “Offload refs and canvas”:

```md
## Context offload task pipeline

The durable memory model remains `L0 -> L1 -> L2 -> L3`.

The active context-offload pipeline is separate:

```text
offload L1 evidence summaries -> L1.5 task judgment -> task-scoped L2 Mermaid canvas -> L4 draft skill generation
```

L1.5 decides whether the current interaction is short, a continuation, a new long task, or a completion signal before canvas writing. Short one-shot tool use, such as asking for the current date/time, does not update task canvases.

L4 is user-triggered from the menu. It creates draft skills under project-owned storage from a selected task canvas and node-linked offload evidence. Draft skills are not auto-installed into global skill directories.
```

- [ ] **Step 6: Update docs/architecture.md**

Update the memory/runtime boundaries with:

```md
The context-offload path is intentionally separate from durable memory maintenance. L1.5 owns task routing, task-scoped L2 owns Mermaid canvas updates, and L4 owns draft skill synthesis from selected task evidence.
```

- [ ] **Step 7: Update agent prompt if needed**

In `src/agent/prompts/system.ts`, update the memory layers section with:

```ts
- Short-term context offload: L1 evidence summaries route through L1.5 task judgment into task-scoped Mermaid canvases.
- L4 draft skills can be generated from selected task canvases and grounded evidence, but only through menu-managed review flows.
```

Keep the prompt concise.

- [ ] **Step 8: Run full verification**

Run:

```bash
bun test
bun run typecheck
```

Expected: PASS.

- [ ] **Step 9: Manual smoke test**

Start the bot locally:

```bash
bun run dev
```

Manual Telegram checks:

1. Send `sekarang Hari apa dan jam berapa`.
2. Expected reply includes `Senin` for the pinned real date case when run at that time, and the tool output includes explicit weekday fields in logs.
3. Expected logs include `[agent:l15]` with `isLongTask: false` and no new task canvas write.
4. Send a long task request such as `tambahkan test kecil untuk routing L1.5`.
5. Expected logs include `[agent:l15]` with `isLongTask: true` and a task id.
6. Trigger a tool result during that task.
7. Expected task canvas file appears under `data/memory/task-canvases/<chat>/`.
8. Open Menu -> Memory -> Skill Drafts -> Generate Draft Skill.
9. Expected draft `SKILL.md` appears under `data/memory/skills/<skill-name>/SKILL.md` and is not installed globally.

Stop the dev server with Ctrl-C after the smoke test.

- [ ] **Step 10: Commit**

```bash
git add README.md docs/memory.md docs/architecture.md src/memory/core/service.ts src/agent/prompts/system.ts tests/memory/readme.test.ts tests/runtime/agent-prompt.test.ts
git commit -m "docs: document full offload pipeline"
```

---

## Self-review checklist

- [ ] Spec coverage: config, datetime, L1.5, task-scoped L2 canvas, L4 draft skills, Telegram menu, validation, migration, status, docs, and tests are covered.
- [ ] Placeholder scan: plan contains no `TBD`, `TODO`, or “implement later” markers.
- [ ] Type consistency: use `taskId`, `TaskCanvas`, `GeneratedSkill`, `L15JudgmentResult`, `MEMORY_L15_*`, and `MEMORY_L4_*` consistently.
- [ ] Execution safety: generated skills remain draft artifacts under project storage and are not installed globally.
- [ ] Verification: final task includes `bun test`, `bun run typecheck`, and a Telegram smoke test.
