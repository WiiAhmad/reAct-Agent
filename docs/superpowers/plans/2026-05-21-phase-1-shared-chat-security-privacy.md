# Phase 1 Shared-Chat Security and Privacy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four Phase 1 shared-chat trust-boundary bugs: cross-chat Telegram sends from chat mode, chat-scoped job visibility, memory-summary exposure in shared chats, and active task-canvas leakage across users.

**Architecture:** Keep the current subsystem boundaries intact and fix the trust boundary at the narrowest layer that actually owns it. For tools, restrict the risky parameter at the tool itself; for jobs and memory screens, scope access by actor in the bot/service layer; for task-canvas recall, add a new user-scoped canvas read and switch the two leaking call sites to it.

**Tech Stack:** TypeScript, Bun test runner, grammY bot callbacks/conversations, Bun SQLite, project-owned memory services.

---

## Source references

- Approved roadmap spec: `docs/superpowers/specs/2026-05-21-bug-fix-roadmap-design.md`
- Live bug ledger to update in the same change: `docs/bugs/2026-05-21-verified-bug-audit.md`
- Chat-mode Telegram send tool: `src/tools/local.ts:242-260`
- Agent-mode tool filter reference: `src/agent/react-agent.ts:149-152`
- Memory summary and jobs menu entry points: `src/bot/bot.ts:38-44`, `src/bot/bot.ts:83-127`, `src/bot/bot.ts:173-181`, `src/bot/bot.ts:228-256`
- Memory Update conversation: `src/bot/conversations/memory-update.ts:131-175`
- Job detail conversation: `src/bot/conversations/job-detail.ts:41-43`, `src/bot/conversations/job-detail.ts:150-244`
- Autonomous job service queries: `src/services/autonomous-jobs.ts:192-215`
- Recall service task-canvas load: `src/memory/recall/service.ts:153-165`
- L1.5 task judgment task-canvas load: `src/memory/core/service.ts:546-551`
- SQLite task-canvas reads: `src/memory/backends/sqlite/backend.ts:906-1030`
- Existing tool tests: `tests/memory/tools.test.ts:45-308`
- Existing autonomous job service tests: `tests/services/autonomous-jobs.test.ts:12-186`
- Existing task recall tests: `tests/memory/task-recall.test.ts:10-60`
- Existing SQLite backend tests: `tests/memory/sqlite-backend.test.ts:57-150`
- Existing autonomous-mode tool exposure regression: `tests/memory/agent-runtime.test.ts:568-580`

## File structure

Modify these files:

- `src/tools/local.ts` — restrict `telegram_send_message` to the active chat so chat-mode tool use cannot target arbitrary `chat_id` values.
- `src/services/autonomous-jobs.ts` — add actor-scoped read queries for job list/detail without disturbing scheduler internals that still use `getJobById()`.
- `src/bot/bot.ts` — gate memory-sensitive UI to private chats and switch the jobs list screen to actor-scoped reads.
- `src/bot/conversations/job-detail.ts` — resolve the acting user and load job detail/back-list screens through actor-scoped service queries.
- `src/bot/conversations/memory-update.ts` — add a private-chat guard so the memory-update conversation cannot be entered as a back door from shared chats.
- `src/memory/backends/sqlite/backend.ts` — add a user-scoped active-canvas content reader while preserving the legacy chat-scoped method for existing non-Phase-1 callers/tests.
- `src/memory/recall/service.ts` — switch recall to the new user-scoped active-canvas reader.
- `src/memory/core/service.ts` — switch L1.5 task judgment to the new user-scoped active-canvas reader.
- `tests/memory/tools.test.ts` — add regression coverage for current-chat-only `telegram_send_message` behavior.
- `tests/services/autonomous-jobs.test.ts` — add regression coverage for actor-scoped job list/detail queries.
- `tests/memory/task-recall.test.ts` — add regression coverage that recall only sees the caller’s active canvas in a shared chat.
- `tests/memory/sqlite-backend.test.ts` — add regression coverage for the new `getTaskCanvasForUser()` backend method.
- `docs/bugs/2026-05-21-verified-bug-audit.md` — update bug status counts, executive summary, and the four fixed bug sections in the same change as the code.

Create this file:

- `tests/bot/shared-chat-boundaries.test.ts` — focused bot-level regressions for shared-chat memory gating, actor-scoped jobs screen/detail flows, and private-only memory entry.

Reference-only files (do not modify in this phase):

- `src/agent/react-agent.ts` — keep the existing autonomous-mode filter unchanged; rely on the existing regression that autonomous mode still hides `telegram_send_message`.
- `tests/memory/agent-runtime.test.ts` — reuse the existing autonomous-mode regression instead of rewriting it.

---

### Task 1: Lock `telegram_send_message` to the current chat

**Files:**
- Modify: `tests/memory/tools.test.ts:266-308`
- Modify: `src/tools/local.ts:242-260`
- Reference: `tests/memory/agent-runtime.test.ts:568-580`

- [ ] **Step 1: Write the failing tool regression tests**

Append these two tests near the end of `tests/memory/tools.test.ts`, immediately before the existing `memory-backed tools use ctx.memory instead of the factory capture` test:

```ts
test("telegram_send_message sends to the active chat when chat_id is omitted", async () => {
  const memory = createMemoryServiceDouble();
  const sent: Array<{ chatId: string; text: string }> = [];
  const tools = createLocalTools(memory as any, {
    sendMessage: async (chatId: string, text: string) => {
      sent.push({ chatId, text });
      return { message_id: sent.length } as any;
    },
  } as any);
  const send = tools.find((tool) => tool.name === "telegram_send_message");

  expect(send).toBeDefined();

  await expect(
    send!.execute(
      { text: "Halo dari chat aktif" },
      { chatId: "chat-1", userId: "user-1", memory: memory as any },
    ),
  ).resolves.toBe("Sent Telegram message to chat-1.");

  expect(sent).toEqual([{ chatId: "chat-1", text: "Halo dari chat aktif" }]);
});

test("telegram_send_message rejects cross-chat destinations in chat mode", async () => {
  const memory = createMemoryServiceDouble();
  const sent: Array<{ chatId: string; text: string }> = [];
  const tools = createLocalTools(memory as any, {
    sendMessage: async (chatId: string, text: string) => {
      sent.push({ chatId, text });
      return { message_id: sent.length } as any;
    },
  } as any);
  const send = tools.find((tool) => tool.name === "telegram_send_message");

  expect(send).toBeDefined();

  await expect(
    send!.execute(
      { text: "Jangan kirim lintas chat", chat_id: "chat-2" },
      { chatId: "chat-1", userId: "user-1", memory: memory as any },
    ),
  ).resolves.toBe("chat_id must match the current chat.");

  expect(sent).toEqual([]);
});
```

- [ ] **Step 2: Run the targeted tests and verify they fail**

Run:

```bash
bun test tests/memory/tools.test.ts
```

Expected: FAIL because the current implementation still sends to any `chat_id` and does not return `chat_id must match the current chat.`.

- [ ] **Step 3: Implement the current-chat restriction in the tool**

In `src/tools/local.ts`, replace the `telegram_send_message` tool block with this exact version:

```ts
    {
      name: "telegram_send_message",
      source: "local",
      description: "Send a Telegram message to the current chat only. Useful in chat mode for explicit follow-up messages in the active conversation.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          chat_id: { type: "string", description: "Optional current chat id; if provided it must match the active chat." },
        },
        required: ["text"],
        additionalProperties: false,
      },
      async execute(args, ctx) {
        const api = telegram ?? ctx.telegram;
        if (!api) return "Telegram API unavailable.";

        const requestedChatId = asString(args.chat_id, ctx.chatId);
        if (requestedChatId !== ctx.chatId) {
          return "chat_id must match the current chat.";
        }

        const text = truncateText(asString(args.text), 3900);
        await api.sendMessage(ctx.chatId, text);
        return `Sent Telegram message to ${ctx.chatId}.`;
      },
    },
```

Do not change the autonomous-mode filter in `src/agent/react-agent.ts`; the existing regression at `tests/memory/agent-runtime.test.ts:568-580` already locks that behavior.

- [ ] **Step 4: Run the targeted tests and confirm they pass**

Run:

```bash
bun test tests/memory/tools.test.ts tests/memory/agent-runtime.test.ts
```

Expected: PASS. `tools.test.ts` should cover current-chat restriction, and the existing autonomous-mode regression should still show `telegram_send_message` hidden in autonomous runs.

- [ ] **Step 5: Commit the tool hardening change**

Run:

```bash
git add tests/memory/tools.test.ts src/tools/local.ts tests/memory/agent-runtime.test.ts
git commit -m "fix: restrict telegram send tool to active chat"
```

---

### Task 2: Scope shared-chat bot surfaces by actor and keep memory UI private-only

**Files:**
- Create: `tests/bot/shared-chat-boundaries.test.ts`
- Modify: `tests/services/autonomous-jobs.test.ts:12-186`
- Modify: `src/services/autonomous-jobs.ts:192-215`
- Modify: `src/bot/bot.ts:38-44`
- Modify: `src/bot/bot.ts:106-127`
- Modify: `src/bot/bot.ts:173-181`
- Modify: `src/bot/bot.ts:228-256`
- Modify: `src/bot/conversations/job-detail.ts:41-43`
- Modify: `src/bot/conversations/job-detail.ts:150-244`
- Modify: `src/bot/conversations/memory-update.ts:131-148`

- [ ] **Step 1: Write the failing service and bot regressions**

Append these two tests to `tests/services/autonomous-jobs.test.ts` after the existing `creates autonomous jobs with a human-friendly schedule label` test:

```ts
test("lists jobs only for the acting user within the current chat", () => {
  const { service } = makeService();
  const owned = service.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Owned job",
    schedule: { scheduleMode: "interval", intervalSec: 600 },
  });
  service.createJob({
    chatId: "chat-1",
    userId: "user-2",
    prompt: "Other user's job",
    schedule: { scheduleMode: "interval", intervalSec: 600 },
  });
  service.createJob({
    chatId: "chat-2",
    userId: "user-1",
    prompt: "Same user, different chat",
    schedule: { scheduleMode: "interval", intervalSec: 600 },
  });

  expect(service.listJobsForActor("chat-1", "user-1").map((job) => job.id)).toEqual([owned.id]);
});

test("actor-scoped job detail lookup hides another user's job in the same chat", () => {
  const { service } = makeService();
  const otherUsersJob = service.createJob({
    chatId: "chat-1",
    userId: "user-2",
    prompt: "Other user's job",
    schedule: { scheduleMode: "interval", intervalSec: 600 },
  });

  expect(service.getJobForActor("chat-1", "user-1", otherUsersJob.id)).toBeNull();
});
```

Create `tests/bot/shared-chat-boundaries.test.ts` with this exact content:

```ts
import { expect, mock, test } from "bun:test";
import { createTelegramBot } from "../../src/bot/bot";
import { uiCallbacks } from "../../src/bot/ui/keyboards";

type ApiCall = { method: string; payload: Record<string, unknown> };

type HarnessJob = {
  id: number;
  chatId: string;
  userId: string;
  prompt: string;
  jobType: "prompt" | "hybrid";
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

function makeJob(id: number, userId: string, prompt: string): HarnessJob {
  return {
    id,
    chatId: "99",
    userId,
    prompt,
    jobType: "prompt",
    messageText: "",
    agentPrompt: "",
    enabled: true,
    scheduleMode: "interval",
    runAtUnix: null,
    intervalSec: 600,
    cronExpr: null,
    runCount: 0,
    maxRuns: null,
    lastRunAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z",
    scheduleLabel: "Every 10 minutes",
  };
}

function createHarness(options: { chatType?: "private" | "group"; jobs?: HarnessJob[] } = {}) {
  const chat = { id: 99, type: options.chatType ?? "private" } as const;
  const from = { id: 42, is_bot: false, first_name: "User" } as const;
  const jobs = options.jobs ?? [makeJob(1, "42", "Owned job"), makeJob(2, "7", "Other user's job")];
  const apiCalls: ApiCall[] = [];

  const memory = {
    memoryStatus: mock(async () => "status"),
    recall: mock(async () => ({ persona: "Persona", atoms: [], scenarios: [], conversations: [], taskCanvas: null, taskCanvases: [] })),
    countGeneratedSkills: mock(async () => 0),
    runMaintenanceForUser: mock(async () => ({ l1Created: 0, personaUpdated: false })),
  };

  const autonomousJobs = {
    listJobsForActor: mock((chatId: string, userId: string) => jobs.filter((job) => job.chatId === chatId && job.userId === userId)),
    getJobForActor: mock((chatId: string, userId: string, jobId: number) => jobs.find((job) => job.chatId === chatId && job.userId === userId && job.id === jobId) ?? null),
    updatePrompt: mock((jobId: number, prompt: string) => {
      const job = jobs.find((item) => item.id === jobId)!;
      Object.assign(job, { prompt });
      return job;
    }),
    updateSchedule: mock((jobId: number, schedule: Partial<HarnessJob>) => {
      const job = jobs.find((item) => item.id === jobId)!;
      Object.assign(job, schedule);
      return job;
    }),
    setEnabled: mock((jobId: number, enabled: boolean) => {
      const job = jobs.find((item) => item.id === jobId)!;
      Object.assign(job, { enabled });
      return job;
    }),
    deleteJob: mock((jobId: number) => {
      const index = jobs.findIndex((item) => item.id === jobId);
      if (index >= 0) jobs.splice(index, 1);
      return true;
    }),
  };

  const bot = createTelegramBot({
    memory,
    registry: { list: () => [] },
    llm: { complete: async () => ({ content: "", toolCalls: [] }) },
    autonomousJobs,
    memoryUpdateSettings: {
      getOrCreate: () => ({
        userId: "42",
        enabled: true,
        scheduleMode: "interval",
        intervalSec: 600,
        cronExpr: null,
        lastRunAt: null,
        lastFinishedAt: null,
        lastStatus: null,
        lastError: null,
        createdAt: "2026-05-18T00:00:00.000Z",
        updatedAt: "2026-05-18T00:00:00.000Z",
        scheduleLabel: "Every 10 minutes",
      }),
      renderSummary: () => "Memory update settings",
    },
  } as any);

  (bot as any).me = { id: 12345, is_bot: true, first_name: "Test Bot", username: "test_bot" };
  const recordApiCall = (method: string, payload: Record<string, unknown> = {}) => {
    apiCalls.push({ method, payload });
    if (method === "getMe") {
      return { id: 12345, is_bot: true, first_name: "Test Bot", username: "test_bot" };
    }
    if (method === "sendMessage") {
      return { message_id: apiCalls.length, date: 1, chat: { id: payload.chat_id, type: chat.type }, text: payload.text };
    }
    if (method === "editMessageText") {
      return true;
    }
    if (method === "answerCallbackQuery") {
      return true;
    }
    return true;
  };

  (bot as any).clientConfig = {
    ...(bot as any).clientConfig,
    fetch: async (url: string | URL, init?: RequestInit) => {
      const method = String(url).split("/").pop() ?? "unknown";
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      return new Response(JSON.stringify({ ok: true, result: recordApiCall(method, payload) }), {
        headers: { "content-type": "application/json" },
      });
    },
  };

  bot.api.config.use((async (_prev: unknown, method: string, payload: Record<string, unknown> = {}) => {
    return { ok: true, result: recordApiCall(method, payload) };
  }) as any);

  return { bot, apiCalls, memory, autonomousJobs, chat, from };
}

async function pressCallback(
  bot: ReturnType<typeof createTelegramBot>,
  chat: { id: number; type: "private" | "group" },
  from: { id: number; is_bot: false; first_name: string },
  updateId: number,
  data: string,
) {
  await bot.handleUpdate({
    update_id: updateId,
    callback_query: {
      id: `callback-${updateId}`,
      from,
      message: { message_id: 10, date: 1, chat },
      chat_instance: "chat-instance",
      data,
    },
  } as any);
}

test("group memory callback refuses to render memory data", async () => {
  const { bot, apiCalls, memory, chat, from } = createHarness({ chatType: "group" });

  await pressCallback(bot, chat, from, 1, uiCallbacks.memory);

  expect(memory.memoryStatus).not.toHaveBeenCalled();
  expect(memory.recall).not.toHaveBeenCalled();
  expect(memory.countGeneratedSkills).not.toHaveBeenCalled();
  expect(apiCalls).toContainEqual({
    method: "editMessageText",
    payload: {
      chat_id: 99,
      message_id: 10,
      text: "Memory hanya tersedia di private chat.",
      reply_markup: expect.any(Object),
    },
  });
});

test("group memory update callback refuses to enter the private-only memory flow", async () => {
  const { bot, apiCalls, chat, from } = createHarness({ chatType: "group" });

  await pressCallback(bot, chat, from, 2, uiCallbacks.memoryUpdate);

  expect(apiCalls).toContainEqual({
    method: "editMessageText",
    payload: {
      chat_id: 99,
      message_id: 10,
      text: "Memory hanya tersedia di private chat.",
      reply_markup: expect.any(Object),
    },
  });
});

test("jobs screen asks the service for actor-scoped jobs", async () => {
  const { bot, apiCalls, autonomousJobs, chat, from } = createHarness({ chatType: "group" });

  await pressCallback(bot, chat, from, 3, uiCallbacks.jobs);

  expect(autonomousJobs.listJobsForActor).toHaveBeenCalledWith("99", "42");
  const screen = apiCalls.find((call) => call.method === "editMessageText");
  expect(screen?.payload.text).toContain("#1 enabled");
  expect(screen?.payload.text).not.toContain("#2 enabled");
});

test("job detail callback cannot open another user's job in a shared chat", async () => {
  const { bot, apiCalls, autonomousJobs, chat, from } = createHarness({ chatType: "group" });

  await pressCallback(bot, chat, from, 4, "jobs:detail:2");

  expect(autonomousJobs.getJobForActor).toHaveBeenCalledWith("99", "42", 2);
  expect(apiCalls).toContainEqual({
    method: "sendMessage",
    payload: {
      chat_id: "99",
      text: "Autonomous job #2 tidak ditemukan.",
    },
  });
});
```

- [ ] **Step 2: Run the targeted tests and verify they fail**

Run:

```bash
bun test tests/services/autonomous-jobs.test.ts tests/bot/shared-chat-boundaries.test.ts
```

Expected: FAIL because `AutonomousJobService` does not yet expose `listJobsForActor()` / `getJobForActor()`, the jobs screen still uses chat-scoped reads, and memory callbacks still render shared-chat screens instead of the private-only notice.

- [ ] **Step 3: Implement actor-scoped job reads and private-only memory UI**

In `src/services/autonomous-jobs.ts`, insert these two methods immediately above the existing `getJobByChat()` method:

```ts
  getJobForActor(chatId: string, userId: string, id: number): AutonomousJobRow | null {
    const row = this.db
      .query(
        `SELECT${AUTONOMOUS_JOB_COLUMNS}
         FROM autonomous_jobs
         WHERE chat_id = ? AND user_id = ? AND id = ?`,
      )
      .get(chatId, userId, id) as AutonomousJobDbRow | undefined;

    return row ? mapRow(row) : null;
  }

  listJobsForActor(chatId: string, userId: string): AutonomousJobRow[] {
    const rows = this.db
      .query(
        `SELECT${AUTONOMOUS_JOB_COLUMNS}
         FROM autonomous_jobs
         WHERE chat_id = ? AND user_id = ?
         ORDER BY id DESC`,
      )
      .all(chatId, userId) as AutonomousJobDbRow[];

    return rows.map(mapRow);
  }
```

In `src/bot/bot.ts`, add this helper below `resolveUserId()`:

```ts
function isPrivateChat(ctx: BotContext) {
  return ctx.chat?.type === "private";
}
```

Then replace `showMemorySummary()` with this exact version:

```ts
async function showMemorySummary(ctx: BotContext, deps: BotDeps) {
  if (!isPrivateChat(ctx)) {
    await presentScreen(ctx, "Memory hanya tersedia di private chat.", buildMainMenuKeyboard());
    return;
  }

  const chatId = resolveChatId(ctx);
  const userId = resolveUserId(ctx);
  const [memoryStatus, recall, generatedSkillCount] = await Promise.all([
    deps.memory.memoryStatus(userId, chatId),
    deps.memory.recall(userId, "project preferences workflow coding", 5, chatId),
    deps.memory.countGeneratedSkills(userId),
  ]);
  const setting = deps.memoryUpdateSettings.getOrCreate(userId);
  const summary = buildRichMemorySummary({
    memoryStatus,
    recall,
    memoryUpdateSummary: deps.memoryUpdateSettings.renderSummary(setting),
    generatedSkillCount,
  });
  await presentScreen(ctx, renderMemorySummaryScreen(summary), buildMemorySummaryKeyboard());
}
```

Replace `showJobsScreen()` with this exact version:

```ts
async function showJobsScreen(ctx: BotContext, deps: BotDeps) {
  const chatId = resolveChatId(ctx);
  const userId = resolveUserId(ctx);
  const jobs = deps.autonomousJobs.listJobsForActor(chatId, userId);
  await presentScreen(ctx, renderJobsSummary(jobs), buildJobsListKeyboard(jobs));
}
```

Replace the `uiCallbacks.memoryUpdate` callback block in `src/bot/bot.ts` with this exact version:

```ts
  bot.callbackQuery(uiCallbacks.memoryUpdate, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isPrivateChat(ctx)) {
      await presentScreen(ctx, "Memory hanya tersedia di private chat.", buildMainMenuKeyboard());
      return;
    }
    await ctx.conversation.enter(memoryUpdateConversationId);
  });
```

In `src/bot/conversations/job-detail.ts`, add this helper directly below `resolveChatId()`:

```ts
function resolveUserId(ctx: Context) {
  return String(ctx.from?.id ?? ctx.chat?.id ?? "unknown");
}
```

Then replace the top of `jobDetailConversation()` with this exact version from the `chatId`/`userId` setup through the initial load:

```ts
  return async function jobDetailConversation(conversation: BotConversation, ctx: Context, jobId: number) {
    const chatId = resolveChatId(ctx);
    const userId = resolveUserId(ctx);
    let note: string | undefined;

    const loadedJob = await conversation.external(() => deps.autonomousJobs.getJobForActor(chatId, userId, jobId));
    if (!loadedJob) {
      await ctx.reply(`Autonomous job #${jobId} tidak ditemukan.`);
      return;
    }
    let currentJob = loadedJob;
```

Replace the `jobDetailCallbacks.back` branch with:

```ts
        case jobDetailCallbacks.back: {
          const jobs = await conversation.external(() => deps.autonomousJobs.listJobsForActor(chatId, userId));
          await action.editMessageText(renderJobsScreen(renderJobsSummary(jobs)), {
            reply_markup: buildJobsListKeyboard(jobs),
          });
          return;
        }
```

Replace the refresh after delete-cancel / stale reload at the bottom of the loop with:

```ts
          const refreshedJob = await conversation.external(() => deps.autonomousJobs.getJobForActor(chatId, userId, jobId));
          if (!refreshedJob) {
            await confirm.editMessageText("Autonomous job tidak lagi tersedia.");
            return;
          }
          currentJob = refreshedJob;
          note = "Delete cancelled.";
          await render(confirm);
```

In `src/bot/conversations/memory-update.ts`, add this helper near the top of the file with the other local helpers:

```ts
function isPrivateChat(ctx: Context) {
  return ctx.chat?.type === "private";
}
```

Then insert this guard at the very top of `memoryUpdateConversation()` immediately after `const userId = resolveUserId(ctx);`:

```ts
    if (!isPrivateChat(ctx)) {
      await ctx.reply("Memory hanya tersedia di private chat.");
      return;
    }
```

- [ ] **Step 4: Run the targeted tests and confirm they pass**

Run:

```bash
bun test tests/services/autonomous-jobs.test.ts tests/bot/shared-chat-boundaries.test.ts
```

Expected: PASS. The service tests should prove actor-scoped SQL selection, and the new bot test file should prove shared-chat memory gating plus actor-scoped jobs UI behavior.

- [ ] **Step 5: Commit the shared-chat bot boundary changes**

Run:

```bash
git add tests/services/autonomous-jobs.test.ts tests/bot/shared-chat-boundaries.test.ts src/services/autonomous-jobs.ts src/bot/bot.ts src/bot/conversations/job-detail.ts src/bot/conversations/memory-update.ts
git commit -m "fix: scope shared chat bot surfaces by actor"
```

---

### Task 3: Scope active task-canvas reads by user

**Files:**
- Modify: `tests/memory/sqlite-backend.test.ts:57-150`
- Modify: `tests/memory/task-recall.test.ts:10-60`
- Modify: `src/memory/backends/sqlite/backend.ts:906-1030`
- Modify: `src/memory/recall/service.ts:153-165`
- Modify: `src/memory/core/service.ts:546-551`

- [ ] **Step 1: Write the failing backend and recall regressions**

Append this test to `tests/memory/sqlite-backend.test.ts` after the existing `SQLite backend stores task offload pipeline records` test:

```ts
test("SQLite backend reads the active task canvas for the matching user only", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-memory-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);

    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
      taskCanvasDir: join(tempDir, "memory", "task-canvases"),
    });
    await backend.init();

    const taskA = await backend.createTaskCanvas({ chatId: "c1", userId: "u1", label: "user-one-task", status: "active" });
    const taskB = await backend.createTaskCanvas({ chatId: "c1", userId: "u2", label: "user-two-task", status: "active" });
    await Bun.write(join(tempDir, taskA.filePath), "flowchart TD\n  A[\"User one active canvas\"]\n");
    await Bun.write(join(tempDir, taskB.filePath), "flowchart TD\n  B[\"User two active canvas\"]\n");

    await expect(backend.getTaskCanvasForUser("u1", "c1")).resolves.toContain("User one active canvas");
    await expect(backend.getTaskCanvasForUser("u2", "c1")).resolves.toContain("User two active canvas");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

Append this second test to `tests/memory/task-recall.test.ts` after the existing `recall returns active and relevant historical task canvases` test:

```ts
test("recall uses only the requesting user's active canvas in a shared chat", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-task-recall-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
      taskCanvasDir: join(tempDir, "task-canvases"),
    });
    await backend.init();

    const userOne = await backend.createTaskCanvas({ chatId: "c1", userId: "u1", label: "active-user-one", status: "active" });
    const userTwo = await backend.createTaskCanvas({ chatId: "c1", userId: "u2", label: "active-user-two", status: "active" });
    await writeFile(join(tempDir, userOne.filePath), "flowchart TD\n  A[\"User one canvas\"]\n", "utf8");
    await writeFile(join(tempDir, userTwo.filePath), "flowchart TD\n  B[\"User two canvas\"]\n", "utf8");
    await backend.upsertTaskCanvasSearchText({
      taskId: userOne.id,
      chatId: "c1",
      userId: "u1",
      label: userOne.label,
      status: userOne.status,
      filePath: userOne.filePath,
      canvas: "flowchart TD\n  A[\"User one canvas\"]\n",
    });
    await backend.upsertTaskCanvasSearchText({
      taskId: userTwo.id,
      chatId: "c1",
      userId: "u2",
      label: userTwo.label,
      status: userTwo.status,
      filePath: userTwo.filePath,
      canvas: "flowchart TD\n  B[\"User two canvas\"]\n",
    });

    const recall = new RecallService(backend, { enabled: true, maxTasks: 3, maxCanvasChars: 2000 });
    const result = await recall.recall("u1", "canvas", 5, "c1");

    expect(result.taskCanvas).toContain("User one canvas");
    expect(result.taskCanvas).not.toContain("User two canvas");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the targeted tests and verify they fail**

Run:

```bash
bun test tests/memory/sqlite-backend.test.ts tests/memory/task-recall.test.ts
```

Expected: FAIL because `SqliteMemoryBackend` does not yet expose `getTaskCanvasForUser()`, and recall still reads the shared chat-scoped canvas.

- [ ] **Step 3: Implement the user-scoped active-canvas reader and swap the leaking call sites**

In `src/memory/backends/sqlite/backend.ts`, insert this method immediately below the existing `getActiveTaskCanvas()` method and above the legacy `getTaskCanvas(chatId)` method:

```ts
  async getTaskCanvasForUser(userId: string, chatId: string): Promise<string | undefined> {
    const active = this.db
      .query(`
        SELECT file_path
        FROM memory_task_canvases
        WHERE user_id = ? AND chat_id = ? AND status = 'active'
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `)
      .get(userId, chatId) as { file_path: string } | null;

    if (!active) {
      return undefined;
    }

    try {
      return await readFile(join(this.options.dataDir, active.file_path), "utf8");
    } catch {
      return undefined;
    }
  }
```

Do not remove the legacy `getTaskCanvas(chatId)` method in this phase; other existing tests still use it for non-Phase-1 paths.

In `src/memory/recall/service.ts`, replace the active-canvas part of the `Promise.all()` tuple with this exact line:

```ts
      chatId ? this.backend.getTaskCanvasForUser(userId, chatId) : Promise.resolve(undefined),
```

In `src/memory/core/service.ts`, replace the active-canvas load line with this exact version:

```ts
    const activeCanvas = activeTask ? await backend.getTaskCanvasForUser(input.userId, input.chatId) : undefined;
```

- [ ] **Step 4: Run the targeted tests and confirm they pass**

Run:

```bash
bun test tests/memory/sqlite-backend.test.ts tests/memory/task-recall.test.ts
```

Expected: PASS. The backend regression should prove per-user canvas reads, and the recall regression should prove a shared chat no longer injects another user’s active canvas.

- [ ] **Step 5: Commit the user-scoped task-canvas fix**

Run:

```bash
git add tests/memory/sqlite-backend.test.ts tests/memory/task-recall.test.ts src/memory/backends/sqlite/backend.ts src/memory/recall/service.ts src/memory/core/service.ts
git commit -m "fix: scope active task canvas reads by user"
```

---

### Task 4: Update the bug ledger and run the full Phase 1 verification set

**Files:**
- Modify: `docs/bugs/2026-05-21-verified-bug-audit.md:1-218`
- Reference: `src/tools/local.ts`
- Reference: `src/services/autonomous-jobs.ts`
- Reference: `src/bot/bot.ts`
- Reference: `src/bot/conversations/job-detail.ts`
- Reference: `src/bot/conversations/memory-update.ts`
- Reference: `src/memory/backends/sqlite/backend.ts`
- Reference: `src/memory/recall/service.ts`
- Reference: `src/memory/core/service.ts`

- [ ] **Step 1: Update the live bug ledger counts, summary, and four Phase 1 entries**

Apply these exact documentation updates to `docs/bugs/2026-05-21-verified-bug-audit.md`:

1. In the `## Status` section, change:

```md
Reviewed 14 previously documented bugs:
- 13 still appear open in the current tree
- 1 appears fixed in the current tree
```

to:

```md
Reviewed 14 previously documented bugs:
- 9 still appear open in the current tree
- 5 appear fixed in the current tree
```

2. Replace the `## Executive summary` body with:

```md
Phase 1 shared-chat trust-boundary issues are now fixed in the current tree:
- `telegram_send_message` no longer allows cross-chat sends from chat mode.
- Autonomous job list/detail access is scoped to the acting user inside the current chat.
- Memory summary and Memory Update entry are private-chat-only.
- Active task-canvas reads used by recall and task judgment are user-scoped.

The highest-priority remaining issues are now the correctness bugs in task/memory ownership and scheduler semantics:
- completion-turn tool evidence can still lose task ownership,
- hybrid reminders can resend fixed text after partial failure,
- recurring job defaults and schedule transitions still have `max_runs` semantics bugs,
- `last_finished_at` and cron timezone handling still need correction.
```

3. Replace bug **6**, **7**, **8**, and **11** with these exact updated sections:

```md
### 6. Memory summary can leak a user's recall and persona data into shared chats

**Status:** Fixed in current tree  
**Severity:** High

**Impact:** Opening the Memory screen in a shared chat no longer renders user-specific memory status, recall, persona, and atom/scenario summaries into that shared surface.

**Root cause:** `showMemorySummary()` used to fetch user-scoped memory and render it directly into the current chat regardless of chat type.

**Fix summary:** Memory summary rendering is now private-chat-only, and Memory Update entry is blocked from shared chats so the memory-sensitive UI cannot be reopened through that path.

**Changed code:** `src/bot/bot.ts`, `src/bot/conversations/memory-update.ts`

**Verification:** `tests/bot/shared-chat-boundaries.test.ts`
```

```md
### 7. Autonomous job management is chat-scoped, so one member can edit or delete another member's jobs

**Status:** Fixed in current tree  
**Severity:** High

**Impact:** In shared chats, a participant can now only see and open jobs owned by the acting user instead of every job in the chat.

**Root cause:** the jobs screen and job detail loader previously used chat-scoped queries only.

**Fix summary:** Added actor-scoped job list/detail queries in the service layer and switched the bot jobs screen plus job detail loader/back navigation to use the acting user and current chat together.

**Changed code:** `src/services/autonomous-jobs.ts`, `src/bot/bot.ts`, `src/bot/conversations/job-detail.ts`

**Verification:** `tests/services/autonomous-jobs.test.ts`, `tests/bot/shared-chat-boundaries.test.ts`
```

```md
### 8. Active task canvases can leak across users in the same chat

**Status:** Fixed in current tree  
**Severity:** High

**Impact:** Active task-canvas context used by recall and L1.5 task judgment no longer bleeds from one user to another inside a shared chat.

**Root cause:** one active-canvas content path still loaded by `chat_id` only.

**Fix summary:** Added a user-scoped active-canvas reader in the SQLite backend and switched both recall and task judgment to use it.

**Changed code:** `src/memory/backends/sqlite/backend.ts`, `src/memory/recall/service.ts`, `src/memory/core/service.ts`

**Verification:** `tests/memory/sqlite-backend.test.ts`, `tests/memory/task-recall.test.ts`
```

```md
### 11. `telegram_send_message` is exposed in chat mode with arbitrary `chat_id`

**Status:** Fixed in current tree  
**Severity:** High

**Impact:** Normal chat-mode tool use can no longer send Telegram messages to arbitrary destination chats.

**Root cause:** the tool accepted an optional `chat_id` and passed it directly to `api.sendMessage(...)`.

**Fix summary:** The tool now only sends to the active chat. If `chat_id` is provided, it must match the active chat id.

**Changed code:** `src/tools/local.ts`

**Verification:** `tests/memory/tools.test.ts`, `tests/memory/agent-runtime.test.ts`
```

4. Replace the `## Suggested fix order` section with this exact list:

```md
## Suggested fix order

1. completion-turn task ownership for tool evidence
2. recurring job semantics (`max_runs`, schedule edits, `last_finished_at`, timezone)
3. generated-skill and store-checkpoint consistency bugs
4. Memory summary draft-count UI bug
```

- [ ] **Step 2: Run the full Phase 1 verification suite**

Run:

```bash
bun test tests/memory/tools.test.ts tests/services/autonomous-jobs.test.ts tests/bot/shared-chat-boundaries.test.ts tests/memory/sqlite-backend.test.ts tests/memory/task-recall.test.ts tests/memory/agent-runtime.test.ts
```

Expected: PASS. This suite covers the new Phase 1 regressions plus the existing autonomous-mode tool hiding behavior.

- [ ] **Step 3: Verify the ledger matches the code you actually changed**

Manually confirm that the `Changed code` lines in `docs/bugs/2026-05-21-verified-bug-audit.md` reference only files touched by Tasks 1–3 and that the header counts now read `9 still appear open` and `5 appear fixed`.

- [ ] **Step 4: Commit the ledger update and final verification state**

Run:

```bash
git add docs/bugs/2026-05-21-verified-bug-audit.md tests/memory/tools.test.ts tests/services/autonomous-jobs.test.ts tests/bot/shared-chat-boundaries.test.ts tests/memory/sqlite-backend.test.ts tests/memory/task-recall.test.ts tests/memory/agent-runtime.test.ts src/tools/local.ts src/services/autonomous-jobs.ts src/bot/bot.ts src/bot/conversations/job-detail.ts src/bot/conversations/memory-update.ts src/memory/backends/sqlite/backend.ts src/memory/recall/service.ts src/memory/core/service.ts
git commit -m "docs: update phase 1 bug audit"
```

---

## Coverage check against the approved spec

- **Restrict `telegram_send_message` to the active chat:** Task 1
- **Scope jobs list/detail access to the acting user:** Task 2
- **Make memory-sensitive bot surfaces private-only:** Task 2
- **Scope active task-canvas reads by user:** Task 3
- **Update `docs/bugs/2026-05-21-verified-bug-audit.md` in the same change as the fixes:** Task 4
- **Run targeted regressions plus relevant suite verification:** Tasks 1–4

## Placeholder scan

- No `TODO`, `TBD`, or deferred implementation notes remain.
- All code-changing steps include explicit code blocks.
- All verification steps include exact `bun test` commands and expected outcomes.
- All commit steps use explicit file lists rather than `git add .`.

## Type and API consistency check

- Job-scoped service APIs introduced in this plan are consistently named `listJobsForActor(chatId, userId)` and `getJobForActor(chatId, userId, id)`.
- The new backend API is consistently named `getTaskCanvasForUser(userId, chatId)`.
- The private-chat refusal copy is consistently `Memory hanya tersedia di private chat.` across the bot and memory-update conversation.
