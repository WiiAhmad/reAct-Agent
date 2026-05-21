# LLM Call Count Runtime Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add request-scoped LLM call counting so each inbound Telegram message, autonomous job, and memory-update run logs an accurate `llmCalls=N` total in both console output and level-3 JSONL traces.

**Architecture:** Extend the existing runtime trace envelope with request metadata, add an `AsyncLocalStorage` request context under `src/logging/`, and wrap the concrete Anthropic/OpenAI providers with a traced `LlmProvider` that increments counts at the provider boundary. Then annotate every `llm.complete(...)` call site with an origin string, open request contexts at the Telegram/autonomous/memory-update entry points, and format `llm.request.summary` as a compact operator-facing console line.

**Tech Stack:** TypeScript, Bun, bun:test, Node `AsyncLocalStorage`, grammY, Anthropic SDK, OpenAI SDK

---

## Provenance

This plan implements the approved design in:

- `docs/superpowers/specs/2026-05-20-llm-call-count-runtime-logging-design.md`
- `docs/superpowers/specs/2026-05-19-full-operational-runtime-logging-design.md`

The concrete source locations that drive this plan are:

- `src/logging/types.ts:8-45` — current runtime trace envelope
- `src/logging/console-sink.ts:4-20` — current console formatter
- `src/agent/types.ts:23-36` — `LlmCompleteRequest` / `LlmProvider`
- `src/agent/providers/index.ts:6-20` — provider assembly point
- `src/agent/providers/anthropic.ts:56-69` — Anthropic API boundary
- `src/agent/providers/openai.ts:44-58` — OpenAI API boundary
- `src/bot/bot.ts:258-293` — inbound Telegram text handler
- `src/cron/autonomous.ts:144-260` — autonomous job + memory-update entry points
- `src/agent/react-agent.ts:175-214` — main agent loop
- `src/memory/offload/l15.ts:107-123` — L15 LLM routing
- `src/memory/pipeline/l1.ts:121-139` — L1 extraction
- `src/memory/pipeline/l2.ts:36-54` — L2 scenario synthesis
- `src/memory/pipeline/l3.ts:27-41` — L3 persona synthesis
- `src/memory/offload/l1.ts:54-77` — L1 summarization
- `src/memory/offload/l2.ts:99-121` — L2 Mermaid patch generation
- `src/memory/offload/l4.ts:95-100` — L4 skill generation

## File structure

### New files

- `src/logging/llm-request-context.ts` — request-scoped LLM call counters, `AsyncLocalStorage`, and request-summary emission
- `src/agent/providers/traced.ts` — traced provider wrapper that increments counts and emits `llm.call.complete` / `llm.call.error`
- `tests/logging/llm-request-context.test.ts` — summary emission and counting behavior
- `tests/agent/traced-provider.test.ts` — provider-boundary call tracing behavior

### Existing files to modify

- `src/logging/types.ts` — add `RuntimeRequestType`, `requestId`, `requestType`, and `source: "llm"`
- `src/logging/console-sink.ts` — compact summary formatting for `llm.request.summary`
- `src/agent/types.ts` — add `meta.origin` to `LlmCompleteRequest`
- `src/agent/providers/index.ts` — wrap concrete providers in `TracedLlmProvider`
- `src/index.ts` — pass `runtimeTrace` into `createLlmProvider(...)`
- `src/agent/react-agent.ts` — tag provider calls with `origin: "agent"`
- `src/memory/offload/l15.ts` — tag provider calls with `origin: "memory.l15"`
- `src/memory/pipeline/l1.ts` — tag provider calls with `origin: "memory.l1"`
- `src/memory/pipeline/l2.ts` — tag provider calls with `origin: "memory.l2"`
- `src/memory/pipeline/l3.ts` — tag provider calls with `origin: "memory.l3"`
- `src/memory/offload/l1.ts` — tag provider calls with `origin: "offload.l1"`
- `src/memory/offload/l2.ts` — tag provider calls with `origin: "offload.l2"`
- `src/memory/offload/l4.ts` — tag provider calls with `origin: "offload.l4"`
- `src/bot/bot.ts` — open `telegram_message` request contexts
- `src/cron/autonomous.ts` — open `autonomous_job` and `memory_update` request contexts
- `tests/logging/console-sink.test.ts` — summary formatting coverage
- `tests/memory/agent-runtime.test.ts` — direct agent-origin coverage
- `tests/memory/l15.test.ts` — direct L15-origin coverage
- `tests/memory/pipeline.test.ts` — direct L1/L2/L3-origin coverage
- `tests/memory/offload.test.ts` — direct offload-origin coverage
- `tests/bot/conversation-pass-through.test.ts` — Telegram request-summary coverage
- `tests/cron/autonomous-helpers.test.ts` — autonomous + memory-update request-summary coverage

## Task 1: Add request-scoped LLM context and extend trace types

**Files:**
- Create: `src/logging/llm-request-context.ts`
- Modify: `src/logging/types.ts`
- Test: `tests/logging/llm-request-context.test.ts`

- [ ] **Step 1: Write the failing request-context tests**

```ts
import { expect, test } from "bun:test";
import { recordLlmCall, runWithLlmRequestContext } from "../../src/logging/llm-request-context";
import type { RuntimeTraceInput } from "../../src/logging/types";

test("runWithLlmRequestContext emits one summary with total and byOrigin after success", async () => {
  const events: RuntimeTraceInput[] = [];

  await runWithLlmRequestContext({
    trace: { emit: (event) => events.push(event) },
    requestType: "telegram_message",
    chatId: "c1",
    userId: "u1",
    requestId: "req-1",
  }, async () => {
    expect(recordLlmCall("agent")).toMatchObject({
      requestId: "req-1",
      requestType: "telegram_message",
      chatId: "c1",
      userId: "u1",
      callIndex: 1,
      originCount: 1,
    });
    expect(recordLlmCall("memory.l1")).toMatchObject({
      requestId: "req-1",
      requestType: "telegram_message",
      callIndex: 2,
      originCount: 1,
    });
  });

  expect(events).toContainEqual(expect.objectContaining({
    source: "llm",
    event: "request.summary",
    requestId: "req-1",
    requestType: "telegram_message",
    chatId: "c1",
    userId: "u1",
    payload: expect.objectContaining({
      outcome: "success",
      llmCallCount: 2,
      byOrigin: { agent: 1, "memory.l1": 1 },
    }),
  }));
});

test("runWithLlmRequestContext emits error summaries and leaves unscoped calls ungrouped", async () => {
  const events: RuntimeTraceInput[] = [];

  await expect(runWithLlmRequestContext({
    trace: { emit: (event) => events.push(event) },
    requestType: "memory_update",
    userId: "u1",
    requestId: "req-2",
  }, async () => {
    expect(recordLlmCall("memory.l2")).toMatchObject({
      requestId: "req-2",
      requestType: "memory_update",
      callIndex: 1,
      originCount: 1,
    });
    throw new Error("boom");
  })).rejects.toThrow("boom");

  expect(recordLlmCall("agent")).toMatchObject({
    requestId: undefined,
    requestType: "unscoped",
    callIndex: 1,
    originCount: 1,
  });

  expect(events).toContainEqual(expect.objectContaining({
    source: "llm",
    event: "request.summary",
    requestId: "req-2",
    requestType: "memory_update",
    payload: expect.objectContaining({
      outcome: "error",
      llmCallCount: 1,
      byOrigin: { "memory.l2": 1 },
    }),
  }));
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `bun test tests/logging/llm-request-context.test.ts`

Expected: FAIL with `Cannot find module '../../src/logging/llm-request-context'` and missing `RuntimeRequestType` / `requestId` / `requestType` support.

- [ ] **Step 3: Extend the runtime trace types**

Modify `src/logging/types.ts` so request metadata is part of the shared trace envelope without narrowing existing accepted `source` values.

```ts
export type RuntimeLogLevel = 1 | 2 | 3;

export type RuntimeRequestType = "telegram_message" | "autonomous_job" | "memory_update" | "unscoped";

export interface RuntimeTraceInput {
  minLevel: RuntimeLogLevel;
  source: string;
  event: string;
  tags?: string[];
  chatId?: string;
  userId?: string;
  taskId?: string;
  jobId?: string;
  requestId?: string;
  requestType?: RuntimeRequestType;
  toolName?: string;
  toolCallId?: string;
  durationMs?: number;
  payload?: unknown;
  error?: unknown;
}

export interface RuntimeTraceEvent extends RuntimeTraceInput {
  ts: string;
  seq: number;
  runId: string;
  pid: number;
  tags: string[];
}
```

- [ ] **Step 4: Create the request-context helper**

Create `src/logging/llm-request-context.ts`.

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { emitTrace } from "./helpers";
import type { RuntimeRequestType, RuntimeTraceEmitter } from "./types";

export type LlmRequestContext = {
  requestId: string;
  requestType: Exclude<RuntimeRequestType, "unscoped">;
  chatId?: string;
  userId?: string;
  jobId?: string;
  startedAtMs: number;
  llmCallCount: number;
  byOrigin: Record<string, number>;
};

type LlmRequestContextState = LlmRequestContext & {
  trace?: RuntimeTraceEmitter;
};

export type RecordedLlmCall = {
  requestId?: string;
  requestType: RuntimeRequestType;
  chatId?: string;
  userId?: string;
  jobId?: string;
  callIndex: number;
  originCount: number;
};

const storage = new AsyncLocalStorage<LlmRequestContextState>();

export function recordLlmCall(origin: string): RecordedLlmCall {
  const context = storage.getStore();
  if (!context) {
    return {
      requestId: undefined,
      requestType: "unscoped",
      chatId: undefined,
      userId: undefined,
      jobId: undefined,
      callIndex: 1,
      originCount: 1,
    };
  }

  context.llmCallCount += 1;
  context.byOrigin[origin] = (context.byOrigin[origin] ?? 0) + 1;

  return {
    requestId: context.requestId,
    requestType: context.requestType,
    chatId: context.chatId,
    userId: context.userId,
    jobId: context.jobId,
    callIndex: context.llmCallCount,
    originCount: context.byOrigin[origin],
  };
}

export async function runWithLlmRequestContext<T>(
  input: {
    trace?: RuntimeTraceEmitter;
    requestType: Exclude<RuntimeRequestType, "unscoped">;
    requestId?: string;
    chatId?: string;
    userId?: string;
    jobId?: string;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const context: LlmRequestContextState = {
    requestId: input.requestId ?? randomUUID(),
    requestType: input.requestType,
    chatId: input.chatId,
    userId: input.userId,
    jobId: input.jobId,
    startedAtMs: Date.now(),
    llmCallCount: 0,
    byOrigin: {},
    trace: input.trace,
  };

  return storage.run(context, async () => {
    let outcome: "success" | "error" = "success";
    try {
      return await fn();
    } catch (error) {
      outcome = "error";
      throw error;
    } finally {
      const durationMs = Date.now() - context.startedAtMs;
      emitTrace(context.trace, {
        minLevel: 1,
        source: "llm",
        event: "request.summary",
        requestId: context.requestId,
        requestType: context.requestType,
        chatId: context.chatId,
        userId: context.userId,
        jobId: context.jobId,
        durationMs,
        payload: {
          outcome,
          durationMs,
          llmCallCount: context.llmCallCount,
          byOrigin: context.byOrigin,
        },
      });
    }
  });
}
```

- [ ] **Step 5: Run the request-context tests to verify they pass**

Run: `bun test tests/logging/llm-request-context.test.ts`

Expected: PASS with both summary tests green.

- [ ] **Step 6: Commit**

```bash
git add src/logging/types.ts src/logging/llm-request-context.ts tests/logging/llm-request-context.test.ts
git commit -m "feat: add llm request trace context"
```

### Task 2: Add a traced provider wrapper and wire it into provider creation

**Files:**
- Create: `src/agent/providers/traced.ts`
- Modify: `src/agent/types.ts`, `src/agent/providers/index.ts`, `src/index.ts`
- Test: `tests/agent/traced-provider.test.ts`

- [ ] **Step 1: Write the failing traced-provider tests**

```ts
import { expect, test } from "bun:test";
import { TracedLlmProvider } from "../../src/agent/providers/traced";
import { runWithLlmRequestContext } from "../../src/logging/llm-request-context";
import type { RuntimeTraceInput } from "../../src/logging/types";

test("TracedLlmProvider emits llm.call.complete and request summary for scoped success", async () => {
  const events: RuntimeTraceInput[] = [];
  const provider = new TracedLlmProvider({
    async complete() {
      return { content: "ok", toolCalls: [{ id: "tool-1", name: "clock", arguments: {} }] };
    },
  }, {
    provider: "openai",
    model: "gpt-test",
    trace: { emit: (event) => events.push(event) },
  });

  const response = await runWithLlmRequestContext({
    trace: { emit: (event) => events.push(event) },
    requestType: "telegram_message",
    requestId: "req-provider-1",
    chatId: "c1",
    userId: "u1",
  }, async () => provider.complete({
    messages: [{ role: "user", content: "hello" }],
    tools: [],
    temperature: 0.2,
    meta: { origin: "agent" },
  }));

  expect(response.content).toBe("ok");
  expect(events).toContainEqual(expect.objectContaining({
    source: "llm",
    event: "call.complete",
    requestId: "req-provider-1",
    requestType: "telegram_message",
    payload: expect.objectContaining({
      provider: "openai",
      model: "gpt-test",
      origin: "agent",
      callIndex: 1,
      responseToolCalls: 1,
      responseContentLength: 2,
    }),
  }));
  expect(events).toContainEqual(expect.objectContaining({
    source: "llm",
    event: "request.summary",
    payload: expect.objectContaining({ llmCallCount: 1, byOrigin: { agent: 1 } }),
  }));
});

test("TracedLlmProvider counts failed attempts and emits llm.call.error", async () => {
  const events: RuntimeTraceInput[] = [];
  const provider = new TracedLlmProvider({
    async complete() {
      throw new Error("provider down");
    },
  }, {
    provider: "anthropic",
    model: "claude-test",
    trace: { emit: (event) => events.push(event) },
  });

  await expect(runWithLlmRequestContext({
    trace: { emit: (event) => events.push(event) },
    requestType: "autonomous_job",
    requestId: "req-provider-2",
    chatId: "c2",
    userId: "u2",
    jobId: "7",
  }, async () => provider.complete({
    messages: [{ role: "user", content: "hello" }],
    tools: [],
    meta: { origin: "agent" },
  }))).rejects.toThrow("provider down");

  expect(events).toContainEqual(expect.objectContaining({
    source: "llm",
    event: "call.error",
    requestType: "autonomous_job",
    jobId: "7",
    payload: expect.objectContaining({ provider: "anthropic", origin: "agent", callIndex: 1 }),
  }));
  expect(events).toContainEqual(expect.objectContaining({
    source: "llm",
    event: "request.summary",
    payload: expect.objectContaining({ outcome: "error", llmCallCount: 1, byOrigin: { agent: 1 } }),
  }));
});

test("TracedLlmProvider emits unscoped call events without a request summary", async () => {
  const events: RuntimeTraceInput[] = [];
  const provider = new TracedLlmProvider({
    async complete() {
      return { content: "ok", toolCalls: [] };
    },
  }, {
    provider: "openai",
    model: "gpt-test",
    trace: { emit: (event) => events.push(event) },
  });

  await provider.complete({
    messages: [{ role: "user", content: "hello" }],
    tools: [],
  });

  expect(events).toContainEqual(expect.objectContaining({
    source: "llm",
    event: "call.complete",
    requestType: "unscoped",
    payload: expect.objectContaining({ origin: "unknown", callIndex: 1 }),
  }));
  expect(events.some((event) => event.source === "llm" && event.event === "request.summary")).toBe(false);
});
```

- [ ] **Step 2: Run the new provider test to verify it fails**

Run: `bun test tests/agent/traced-provider.test.ts`

Expected: FAIL with `Cannot find module '../../src/agent/providers/traced'` and missing `meta` support on `LlmCompleteRequest`.

- [ ] **Step 3: Extend `LlmCompleteRequest` with origin metadata**

Modify `src/agent/types.ts`.

```ts
export type LlmCompleteRequest = {
  messages: AgentMessage[];
  tools: ToolDefinition[];
  temperature?: number;
  meta?: {
    origin?: string;
  };
};
```

- [ ] **Step 4: Create the traced provider wrapper**

Create `src/agent/providers/traced.ts`.

```ts
import { emitTrace } from "../../logging/helpers";
import { recordLlmCall } from "../../logging/llm-request-context";
import type { RuntimeTraceEmitter } from "../../logging/types";
import type { LlmCompleteRequest, LlmCompleteResponse, LlmProvider } from "../types";

export class TracedLlmProvider implements LlmProvider {
  constructor(
    private readonly delegate: LlmProvider,
    private readonly options: {
      provider: "anthropic" | "openai";
      model: string;
      trace?: RuntimeTraceEmitter;
    },
  ) {}

  async complete(request: LlmCompleteRequest): Promise<LlmCompleteResponse> {
    const startedAtMs = Date.now();
    const origin = request.meta?.origin ?? "unknown";
    const call = recordLlmCall(origin);

    try {
      const response = await this.delegate.complete(request);
      emitTrace(this.options.trace, {
        minLevel: 3,
        source: "llm",
        event: "call.complete",
        requestId: call.requestId,
        requestType: call.requestType,
        chatId: call.chatId,
        userId: call.userId,
        jobId: call.jobId,
        durationMs: Date.now() - startedAtMs,
        payload: {
          provider: this.options.provider,
          model: this.options.model,
          origin,
          callIndex: call.callIndex,
          messageCount: request.messages.length,
          toolCount: request.tools.length,
          temperature: request.temperature,
          responseToolCalls: response.toolCalls.length,
          responseContentLength: response.content.length,
        },
      });
      return response;
    } catch (error) {
      emitTrace(this.options.trace, {
        minLevel: 1,
        source: "llm",
        event: "call.error",
        requestId: call.requestId,
        requestType: call.requestType,
        chatId: call.chatId,
        userId: call.userId,
        jobId: call.jobId,
        durationMs: Date.now() - startedAtMs,
        payload: {
          provider: this.options.provider,
          model: this.options.model,
          origin,
          callIndex: call.callIndex,
          messageCount: request.messages.length,
          toolCount: request.tools.length,
          temperature: request.temperature,
        },
        error,
      });
      throw error;
    }
  }
}
```

- [ ] **Step 5: Wrap the concrete providers during provider creation**

Modify `src/agent/providers/index.ts` and `src/index.ts`.

```ts
// src/agent/providers/index.ts
import { config } from "../../config";
import type { RuntimeTraceEmitter } from "../../logging/types";
import type { LlmProvider } from "../types";
import { AnthropicProvider } from "./anthropic";
import { OpenAiProvider } from "./openai";
import { TracedLlmProvider } from "./traced";

export function createLlmProvider(trace?: RuntimeTraceEmitter): LlmProvider {
  switch (config.llm.provider) {
    case "anthropic":
      return new TracedLlmProvider(new AnthropicProvider({
        apiKey: config.llm.anthropic.apiKey,
        model: config.llm.anthropic.model,
      }), {
        provider: "anthropic",
        model: config.llm.anthropic.model,
        trace,
      });
    case "openai":
      return new TracedLlmProvider(new OpenAiProvider({
        apiKey: config.llm.openai.apiKey,
        baseURL: config.llm.openai.baseURL,
        model: config.llm.openai.model,
      }), {
        provider: "openai",
        model: config.llm.openai.model,
        trace,
      });
    default:
      throw new Error(`Unsupported LLM_PROVIDER="${config.llm.provider}"`);
  }
}

// src/index.ts
const llm = createLlmProvider(runtimeTrace);
```

- [ ] **Step 6: Run the provider tests to verify they pass**

Run: `bun test tests/agent/traced-provider.test.ts`

Expected: PASS with success, error, and unscoped cases green.

- [ ] **Step 7: Commit**

```bash
git add src/agent/types.ts src/agent/providers/traced.ts src/agent/providers/index.ts src/index.ts tests/agent/traced-provider.test.ts
git commit -m "feat: trace provider-level llm calls"
```

### Task 3: Tag agent and L15 provider calls with origin metadata

**Files:**
- Modify: `src/agent/react-agent.ts`, `src/memory/offload/l15.ts`
- Test: `tests/memory/agent-runtime.test.ts`, `tests/memory/l15.test.ts`

- [ ] **Step 1: Add failing tests for agent and L15 origins**

```ts
// tests/memory/agent-runtime.test.ts

test("runReactAgent tags provider calls with agent origin metadata", async () => {
  const seenOrigins: string[] = [];
  const llm = {
    async complete(request: any) {
      seenOrigins.push(request.meta?.origin ?? "missing");
      return { content: "Done.", toolCalls: [] };
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
    const registry = new ToolRegistry(db);
    registry.registerMany(createLocalTools(memory));

    await runReactAgent({ chatId: "c1", userId: "u1", input: "hello", memory, registry, llm: llm as any, mode: "chat" });

    expect(seenOrigins).toEqual(["agent"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}, 20000);

// tests/memory/l15.test.ts

test("runL15Judgment tags llm-mode calls with memory.l15 origin metadata", async () => {
  const llm: LlmProvider = {
    async complete(request: any) {
      expect(request.meta).toEqual({ origin: "memory.l15" });
      return { content: '{"taskCompleted":false,"isLongTask":true,"isContinuation":false}', toolCalls: [] };
    },
  };

  await expect(runL15Judgment({
    latestUserMessage: "implement the runtime logger",
    historicalTasks: [],
    llm,
    mode: "llm",
    recentMessages: [],
    maxCanvasChars: 1000,
  })).resolves.toMatchObject({ source: "llm", isLongTask: true });
});
```

- [ ] **Step 2: Run the agent/L15 tests to verify they fail**

Run: `bun test tests/memory/agent-runtime.test.ts tests/memory/l15.test.ts`

Expected: FAIL because `request.meta?.origin` is currently `undefined`.

- [ ] **Step 3: Tag the agent and L15 `llm.complete(...)` calls**

Modify `src/agent/react-agent.ts` and `src/memory/offload/l15.ts`.

```ts
// src/agent/react-agent.ts
const response = await input.llm.complete({
  messages,
  tools,
  meta: { origin: "agent" },
});

// src/memory/offload/l15.ts
const response = await input.llm.complete({
  messages: buildPrompt(input),
  tools: [],
  temperature: 0,
  meta: { origin: "memory.l15" },
});
```

- [ ] **Step 4: Run the agent/L15 tests to verify they pass**

Run: `bun test tests/memory/agent-runtime.test.ts tests/memory/l15.test.ts`

Expected: PASS with the new origin assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/agent/react-agent.ts src/memory/offload/l15.ts tests/memory/agent-runtime.test.ts tests/memory/l15.test.ts
git commit -m "feat: tag agent and l15 llm origins"
```

### Task 4: Tag pipeline and offload helper provider calls with origin metadata

**Files:**
- Modify: `src/memory/pipeline/l1.ts`, `src/memory/pipeline/l2.ts`, `src/memory/pipeline/l3.ts`, `src/memory/offload/l1.ts`, `src/memory/offload/l2.ts`, `src/memory/offload/l4.ts`
- Test: `tests/memory/pipeline.test.ts`, `tests/memory/offload.test.ts`

- [ ] **Step 1: Add failing tests for pipeline and offload origins**

```ts
// tests/memory/pipeline.test.ts

test("pipeline tags provider calls with L1/L2/L3 origin metadata", async () => {
  const origins: string[] = [];
  const llm: LlmProvider = {
    async complete(request: any) {
      origins.push(request.meta?.origin ?? "missing");
      const system = String(request.messages[0]?.content ?? "");
      if (system.includes("L1 extractor")) {
        return { content: JSON.stringify([{ text: "User prefers Bun runtime", importance: 4, source_turn_ids: [1] }]), toolCalls: [] };
      }
      if (system.includes("L2 Scenario aggregator")) {
        return { content: "## Runtime choices\n- atom_id=1 User prefers Bun runtime", toolCalls: [] };
      }
      return { content: "- scenario_id=1 Prefers Bun runtime\n- atom_id=1 User prefers Bun runtime", toolCalls: [] };
    },
  };

  const tempDir = await mkdtemp(join(tmpdir(), "grammy-pipeline-"));
  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });
    const pipeline = new PipelineCoordinator(backend, llm);

    await backend.insertConversationTurn({ chatId: "c1", userId: "u1", role: "user", content: "Please use Bun for this bot.", meta: { mode: "chat" } });
    await pipeline.runMaintenanceForUser("u1", true);

    expect(origins).toEqual(["memory.l1", "memory.l2", "memory.l3"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// tests/memory/offload.test.ts
import { generateL1EvidenceSummary } from "../../src/memory/offload/l1";
import { generateL2MermaidPatch } from "../../src/memory/offload/l2";
import { generateL4Skill } from "../../src/memory/offload/l4";

test("offload helpers tag provider calls with helper-specific origin metadata", async () => {
  const origins: string[] = [];
  const llm = {
    async complete(request: any) {
      origins.push(request.meta?.origin ?? "missing");
      if (request.meta?.origin === "offload.l1") {
        return { content: JSON.stringify({ summary: "semantic summary", score: 5 }), toolCalls: [] };
      }
      if (request.meta?.origin === "offload.l2") {
        return {
          content: JSON.stringify({
            fileAction: "replace",
            mmdContent: "graph TD\n  A[Start] --> B[Done]\n",
            replaceBlocks: [],
            nodeMapping: { node_1: "A" },
          }),
          toolCalls: [],
        };
      }
      return {
        content: JSON.stringify({
          skillName: "demo-skill",
          skillDescription: "Demo",
          skillContent: "# Demo Skill\n\nDo the thing.\n",
        }),
        toolCalls: [],
      };
    },
  };

  await expect(generateL1EvidenceSummary(llm as any, {
    toolName: "demo_tool",
    toolCallId: "call-1",
    args: { city: "Bandung" },
    rawResult: "x".repeat(120),
    maxSummaryChars: 80,
    defaultScore: 5,
  })).resolves.toEqual({ summary: "semantic summary", score: 5 });

  await expect(generateL2MermaidPatch(llm as any, {
    taskLabel: "demo-task",
    currentMmd: "graph TD\n  A[Start]\n",
    entries: [{ nodeId: "node_1", toolName: "demo_tool", summary: "Done", createdAt: "2026-05-20T00:00:00.000Z" }],
    maxCanvasChars: 1000,
  })).resolves.toEqual(expect.objectContaining({ fileAction: "replace" }));

  await expect(generateL4Skill(llm as any, {
    taskId: 1,
    mmdFilename: "memory/task-canvases/c1/task-1.mmd",
    mmdContent: "graph TD\n  A[Start] --> B[Done]\n",
    offloadEntries: [],
    skillFocus: null,
    maxCanvasChars: 1000,
    maxSkillChars: 4000,
  })).resolves.toEqual(expect.objectContaining({ skillName: "demo-skill" }));

  expect(origins).toEqual(["offload.l1", "offload.l2", "offload.l4"]);
});
```

- [ ] **Step 2: Run the pipeline/offload tests to verify they fail**

Run: `bun test tests/memory/pipeline.test.ts tests/memory/offload.test.ts`

Expected: FAIL because the helper and pipeline requests currently do not set `meta.origin`.

- [ ] **Step 3: Tag each pipeline and offload helper call site**

Modify the request objects in the pipeline and offload helpers.

```ts
// src/memory/pipeline/l1.ts
const response = await llm.complete({
  messages: [
    { role: "system", content: buildL1SystemPrompt() },
    { role: "user", content: buildTranscript(turns) },
  ],
  tools: [],
  meta: { origin: "memory.l1" },
});

// src/memory/pipeline/l2.ts
const response = await llm.complete({
  messages: [
    { role: "system", content: buildL2SystemPrompt() },
    { role: "user", content: buildAtomDigest(atoms) },
  ],
  tools: [],
  meta: { origin: "memory.l2" },
});

// src/memory/pipeline/l3.ts
const response = await llm.complete({
  messages: [
    { role: "system", content: buildL3SystemPrompt() },
    { role: "user", content: `scenario_id=${scenarioId}\n${scenarioMarkdown}` },
  ],
  tools: [],
  meta: { origin: "memory.l3" },
});

// src/memory/offload/l1.ts
const response = await llm.complete({
  messages: [
    {
      role: "system",
      content: [
        "Create a semantic L1 evidence summary for a tool result.",
        "Return only strict JSON with fields summary and score.",
        "summary must explain how the result moves, blocks, or verifies the current task.",
        "score is an integer 0-10 where higher means the summary can replace the raw result for planning.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({
        toolName: input.toolName,
        toolCallId: input.toolCallId ?? null,
        args: input.args,
        rawResult: boundedText(input.rawResult, Math.max(input.maxSummaryChars * 8, 2000)),
      }),
    },
  ],
  tools: [],
  meta: { origin: "offload.l1" },
});

// src/memory/offload/l2.ts
const response = await llm.complete({
  messages: [
    {
      role: "system",
      content: [
        "You generate compact semantic Mermaid task canvases from L1 evidence.",
        "Return only strict JSON with fileAction, mmdContent, replaceBlocks, and nodeMapping.",
        "Every input nodeId must appear exactly once in nodeMapping.",
        "Prefer semantic stages over chronological logs.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({
        taskLabel: input.taskLabel,
        currentMmd: truncateText(input.currentMmd, input.maxCanvasChars),
        entries: input.entries,
      }),
    },
  ],
  tools: [],
  meta: { origin: "offload.l2" },
});

// src/memory/offload/l4.ts
const response = await llm.complete({
  messages: buildPrompt(input),
  tools: [],
  temperature: 0,
  meta: { origin: "offload.l4" },
});
```

- [ ] **Step 4: Run the pipeline/offload tests to verify they pass**

Run: `bun test tests/memory/pipeline.test.ts tests/memory/offload.test.ts`

Expected: PASS with the origin-order assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/memory/pipeline/l1.ts src/memory/pipeline/l2.ts src/memory/pipeline/l3.ts src/memory/offload/l1.ts src/memory/offload/l2.ts src/memory/offload/l4.ts tests/memory/pipeline.test.ts tests/memory/offload.test.ts
git commit -m "feat: tag pipeline and offload llm origins"
```

### Task 5: Open request contexts at runtime entry points and verify request summaries

**Files:**
- Modify: `src/bot/bot.ts`, `src/cron/autonomous.ts`
- Test: `tests/bot/conversation-pass-through.test.ts`, `tests/cron/autonomous-helpers.test.ts`

- [ ] **Step 1: Add failing runtime-entry tests for Telegram, autonomous jobs, and memory updates**

```ts
// tests/bot/conversation-pass-through.test.ts
import { TracedLlmProvider } from "../../src/agent/providers/traced";

// inside createBotHarness(...)
const trace = options.trace;

// replace the existing llm + trace fields in deps with:
llm: new TracedLlmProvider({
  async complete() {
    return { content: "agent answer", toolCalls: [] };
  },
}, {
  provider: "openai",
  model: "gpt-test",
  trace,
}),
trace,

test("plain Telegram messages emit one llm request summary", async () => {
  const events: RuntimeTraceInput[] = [];
  const { bot } = createBotHarness({ trace: { emit: (event) => events.push(event) } });

  await sendText(bot, 30, "hello agent");

  expect(events).toContainEqual(expect.objectContaining({
    source: "llm",
    event: "request.summary",
    requestType: "telegram_message",
    chatId: "99",
    userId: "42",
    payload: expect.objectContaining({ llmCallCount: 1, byOrigin: { agent: 1 } }),
  }));
});

// tests/cron/autonomous-helpers.test.ts
import { TracedLlmProvider } from "../../src/agent/providers/traced";

test("runOneAutonomousJob emits one llm request summary for provider work inside the job", async () => {
  const db = makeDb();
  const jobs = new AutonomousJobService(db);
  const job = jobs.createJob({
    chatId: "chat-1",
    userId: "user-1",
    prompt: "Check in with the team",
    schedule: { scheduleMode: "interval", intervalSec: 3600 },
  });
  const traceEvents: any[] = [];
  const trace = { emit: (event: any) => traceEvents.push(event) };
  const llm = new TracedLlmProvider({
    async complete() {
      return { content: "Autonomous answer", toolCalls: [] };
    },
  }, {
    provider: "openai",
    model: "gpt-test",
    trace,
  });

  await runOneAutonomousJob({
    db,
    bot: { api: { sendMessage: async () => ({}) } } as any,
    memory: {} as any,
    registry: {} as any,
    llm,
    job,
    trace,
    runAgent: async ({ llm }) => {
      const response = await llm.complete({
        messages: [{ role: "user", content: "hello" }],
        tools: [],
        meta: { origin: "agent" },
      });
      return response.content;
    },
    nowUnix: 1_779_000_000,
    finishedUnix: 1_779_000_030,
  });

  expect(traceEvents).toContainEqual(expect.objectContaining({
    source: "llm",
    event: "request.summary",
    requestType: "autonomous_job",
    jobId: String(job.id),
    chatId: "chat-1",
    userId: "user-1",
    payload: expect.objectContaining({ llmCallCount: 1, byOrigin: { agent: 1 } }),
  }));
});

test("runOneMemoryUpdateNow emits one llm request summary for maintenance provider work", async () => {
  const db = makeDb();
  const settings = new MemoryUpdateSettingsService(db);
  const traceEvents: any[] = [];
  const trace = { emit: (event: any) => traceEvents.push(event) };
  const llm = new TracedLlmProvider({
    async complete() {
      return { content: JSON.stringify([{ text: "summary", importance: 3, source_turn_ids: [1] }]), toolCalls: [] };
    },
  }, {
    provider: "anthropic",
    model: "claude-test",
    trace,
  });

  await runOneMemoryUpdateNow({
    memory: {
      runMaintenanceForUser: async () => {
        await llm.complete({
          messages: [{ role: "user", content: "maintenance" }],
          tools: [],
          meta: { origin: "memory.l1" },
        });
        return { l1Created: 1, l2ScenarioId: 17, personaUpdated: true };
      },
    } as any,
    settings,
    userId: "user-1",
    trace,
    nowUnix: 1_779_000_000,
    finishedUnix: 1_779_000_030,
  });

  expect(traceEvents).toContainEqual(expect.objectContaining({
    source: "llm",
    event: "request.summary",
    requestType: "memory_update",
    userId: "user-1",
    payload: expect.objectContaining({ llmCallCount: 1, byOrigin: { "memory.l1": 1 } }),
  }));
});
```

- [ ] **Step 2: Run the runtime-entry tests to verify they fail**

Run: `bun test tests/bot/conversation-pass-through.test.ts tests/cron/autonomous-helpers.test.ts`

Expected: FAIL because the top-level handlers do not yet open request contexts, so no `llm.request.summary` event is emitted.

- [ ] **Step 3: Wrap the inbound Telegram handler in a request context**

Modify `src/bot/bot.ts`.

```ts
import { runWithLlmRequestContext } from "../logging/llm-request-context";

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return;

  const chatId = resolveChatId(ctx);
  const userId = resolveUserId(ctx);

  await runWithLlmRequestContext({
    trace: deps.trace,
    requestType: "telegram_message",
    chatId,
    userId,
  }, async () => {
    logTelegramEvent("message:received", {
      chatId,
      userId,
      text: truncateText(text, 200),
      length: text.length,
    });
    await ctx.replyWithChatAction("typing");

    const answer = await runReactAgent({
      chatId,
      userId,
      input: text,
      memory: deps.memory,
      registry: deps.registry,
      llm: deps.llm,
      mode: "chat",
      trace: deps.trace,
    });

    logTelegramEvent("message:answered", {
      chatId,
      userId,
      answerLength: answer.length,
      answerPreview: truncateText(answer, 200),
    });

    for (const chunk of splitTelegramMessage(answer)) {
      await ctx.reply(chunk);
    }
  });
});
```

- [ ] **Step 4: Wrap autonomous jobs and memory updates in request contexts**

Modify `src/cron/autonomous.ts`.

```ts
import { runWithLlmRequestContext } from "../logging/llm-request-context";

export async function runOneAutonomousJob(input: AutonomousRunInput) {
  const now = input.nowUnix ?? unixNow();
  const finishedAt = input.finishedUnix ?? unixNow();
  const jobService = new AutonomousJobService(input.db);
  jobService.markRunStarted(input.job.id, now);
  emitTrace(input.trace, {
    minLevel: 1,
    source: "autonomous",
    event: "job.start",
    chatId: input.job.chatId,
    userId: input.job.userId,
    jobId: String(input.job.id),
    payload: { nowUnix: now, jobType: input.job.jobType, runCount: input.job.runCount },
  });

  return runWithLlmRequestContext({
    trace: input.trace,
    requestType: "autonomous_job",
    chatId: input.job.chatId,
    userId: input.job.userId,
    jobId: String(input.job.id),
  }, async () => {
    try {
      if (input.job.jobType === "hybrid" && input.job.messageText.trim()) {
        const sent = await sendTelegramText(input.bot, input.job.chatId, input.job.messageText, `Failed to send hybrid job text #${input.job.id}`);
        if (!sent) throw new Error(`Failed to send hybrid job text #${input.job.id}`);
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

      const text = `🤖 Autonomous job #${input.job.id}\n\n${truncateText(answer, 3500)}`;
      const sent = await sendTelegramText(input.bot, input.job.chatId, text, `Failed to send autonomous job #${input.job.id}`);
      if (!sent) throw new Error(`Failed to send autonomous job #${input.job.id}`);

      jobService.markRunFinished(input.job.id, finishedAt, "success", null);
      const completion = jobService.recordSuccessfulRun(input.job.id);
      emitTrace(input.trace, {
        minLevel: 1,
        source: "autonomous",
        event: "job.complete",
        chatId: input.job.chatId,
        userId: input.job.userId,
        jobId: String(input.job.id),
        payload: { finishedAtUnix: finishedAt, answerLength: answer.length, deleted: completion.deleted, runCount: completion.runCount },
      });

      return { job: completion.job, answer, deleted: completion.deleted, runCount: completion.runCount };
    } catch (error) {
      const message = toErrorMessage(error);
      jobService.markRunFinished(input.job.id, finishedAt, "error", message);
      emitTrace(input.trace, {
        minLevel: 1,
        source: "autonomous",
        event: "job.error",
        chatId: input.job.chatId,
        userId: input.job.userId,
        jobId: String(input.job.id),
        payload: { finishedAtUnix: finishedAt },
        error,
      });
      const failureText = `🤖 Autonomous job #${input.job.id} failed\n\n${truncateText(message, 3500)}`;
      await sendTelegramText(input.bot, input.job.chatId, failureText, `Failed to send autonomous job failure #${input.job.id}`);
      throw error;
    }
  });
}

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

  return runWithLlmRequestContext({
    trace: input.trace,
    requestType: "memory_update",
    userId: input.userId,
  }, async () => {
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
  });
}
```

- [ ] **Step 5: Run the runtime-entry tests to verify they pass**

Run: `bun test tests/bot/conversation-pass-through.test.ts tests/cron/autonomous-helpers.test.ts`

Expected: PASS with the three request-summary assertions green.

- [ ] **Step 6: Commit**

```bash
git add src/bot/bot.ts src/cron/autonomous.ts tests/bot/conversation-pass-through.test.ts tests/cron/autonomous-helpers.test.ts
git commit -m "feat: scope llm counts to runtime requests"
```

### Task 6: Format `llm.request.summary` as a compact console line

**Files:**
- Modify: `src/logging/console-sink.ts`
- Test: `tests/logging/console-sink.test.ts`

- [ ] **Step 1: Add the failing console-summary formatting test**

```ts
import { expect, test } from "bun:test";
import { createConsoleTraceSink } from "../../src/logging/console-sink";

test("createConsoleTraceSink formats llm request summaries compactly", () => {
  const lines: string[] = [];
  const sink = createConsoleTraceSink((line) => lines.push(line));

  sink({
    ts: "2026-05-20T09:00:00.000Z",
    seq: 2,
    runId: "run-1",
    pid: 1234,
    minLevel: 1,
    source: "llm",
    event: "request.summary",
    requestType: "telegram_message",
    chatId: "c1",
    userId: "u1",
    tags: [],
    payload: { outcome: "success", llmCallCount: 4, byOrigin: { agent: 2, "memory.l1": 2 } },
  });

  expect(lines).toEqual([
    "[2026-05-20T09:00:00.000Z] #2 L1 llm.request.summary type=telegram_message chatId=c1 userId=u1 llmCalls=4 outcome=success",
  ]);
});
```

- [ ] **Step 2: Run the console-sink test to verify it fails**

Run: `bun test tests/logging/console-sink.test.ts`

Expected: FAIL because the sink still prints the generic JSON payload format.

- [ ] **Step 3: Add compact formatting for request summaries**

Modify `src/logging/console-sink.ts`.

```ts
import { truncateText } from "../utils/text";
import type { RuntimeTraceEvent } from "./types";

function formatRequestSummary(event: RuntimeTraceEvent): string | undefined {
  if (event.source !== "llm" || event.event !== "request.summary") {
    return undefined;
  }

  const payload = (event.payload ?? {}) as {
    llmCallCount?: unknown;
    outcome?: unknown;
  };

  const parts = [
    `[${event.ts}] #${event.seq} L${event.minLevel} llm.request.summary`,
    `type=${event.requestType ?? "unknown"}`,
    event.chatId ? `chatId=${event.chatId}` : undefined,
    event.userId ? `userId=${event.userId}` : undefined,
    event.jobId ? `jobId=${event.jobId}` : undefined,
    `llmCalls=${typeof payload.llmCallCount === "number" ? payload.llmCallCount : 0}`,
    typeof payload.outcome === "string" ? `outcome=${payload.outcome}` : undefined,
  ].filter(Boolean);

  return parts.join(" ");
}

function formatDetails(event: RuntimeTraceEvent): string {
  const details: Record<string, unknown> = {};
  if (event.tags.length > 0) details.tags = event.tags;
  if (event.payload !== undefined) details.payload = event.payload;
  if (event.error !== undefined) details.error = event.error;

  if (Object.keys(details).length === 0) {
    return "";
  }

  return ` ${truncateText(JSON.stringify(details), 1000)}`;
}

export function createConsoleTraceSink(write: (line: string) => void = console.log) {
  return (event: RuntimeTraceEvent) => {
    const summary = formatRequestSummary(event);
    if (summary) {
      write(summary);
      return;
    }

    write(`[${event.ts}] #${event.seq} L${event.minLevel} ${event.source}.${event.event}${formatDetails(event)}`);
  };
}
```

- [ ] **Step 4: Run the console-sink test to verify it passes**

Run: `bun test tests/logging/console-sink.test.ts`

Expected: PASS with both the original generic-format test and the new summary-format test green.

- [ ] **Step 5: Commit**

```bash
git add src/logging/console-sink.ts tests/logging/console-sink.test.ts
git commit -m "feat: format llm request summaries in console logs"
```

### Task 7: Run the focused verification suite and confirm spec coverage

**Files:**
- Verify only: `tests/logging/llm-request-context.test.ts`, `tests/agent/traced-provider.test.ts`, `tests/logging/console-sink.test.ts`, `tests/memory/agent-runtime.test.ts`, `tests/memory/l15.test.ts`, `tests/memory/pipeline.test.ts`, `tests/memory/offload.test.ts`, `tests/bot/conversation-pass-through.test.ts`, `tests/cron/autonomous-helpers.test.ts`

- [ ] **Step 1: Run the focused verification suite**

Run:

```bash
bun test tests/logging/llm-request-context.test.ts tests/agent/traced-provider.test.ts tests/logging/console-sink.test.ts tests/memory/agent-runtime.test.ts tests/memory/l15.test.ts tests/memory/pipeline.test.ts tests/memory/offload.test.ts tests/bot/conversation-pass-through.test.ts tests/cron/autonomous-helpers.test.ts
```

Expected: PASS with all request-summary, origin-tagging, and provider-boundary tests green.

- [ ] **Step 2: Run the full test suite if the focused suite is green**

Run:

```bash
bun test
```

Expected: PASS, or if there are unrelated pre-existing failures, document them before merging.

- [ ] **Step 3: Review the implementation against the approved spec**

Check these items directly against `docs/superpowers/specs/2026-05-20-llm-call-count-runtime-logging-design.md`:

```text
- request summaries exist for telegram_message, autonomous_job, and memory_update
- totals count every provider attempt, including failures
- console output shows compact llmCalls=N summaries
- JSONL receives llm.call.complete, llm.call.error, and llm.request.summary events
- origin buckets include agent, memory.l15, memory.l1, memory.l2, memory.l3, offload.l1, offload.l2, offload.l4
- unscoped provider calls emit per-call events without a synthetic request summary
```

Expected: Every bullet maps to finished code and a test or direct runtime assertion.

- [ ] **Step 4: Commit the verification pass**

```bash
git add src/logging/types.ts src/logging/llm-request-context.ts src/agent/types.ts src/agent/providers/traced.ts src/agent/providers/index.ts src/index.ts src/agent/react-agent.ts src/memory/offload/l15.ts src/memory/pipeline/l1.ts src/memory/pipeline/l2.ts src/memory/pipeline/l3.ts src/memory/offload/l1.ts src/memory/offload/l2.ts src/memory/offload/l4.ts src/bot/bot.ts src/cron/autonomous.ts src/logging/console-sink.ts tests/logging/llm-request-context.test.ts tests/agent/traced-provider.test.ts tests/logging/console-sink.test.ts tests/memory/agent-runtime.test.ts tests/memory/l15.test.ts tests/memory/pipeline.test.ts tests/memory/offload.test.ts tests/bot/conversation-pass-through.test.ts tests/cron/autonomous-helpers.test.ts
git commit -m "feat: add request-scoped llm call runtime logging"
```

## Self-review

### Spec coverage

- **Request-scoped totals** — covered in Task 1 request context, Task 5 runtime entry points, Task 7 verification.
- **Provider-boundary counting** — covered in Task 2 traced provider.
- **Origin buckets** — covered in Task 3 and Task 4.
- **Console summary readability** — covered in Task 6.
- **JSONL structured detail** — covered by Task 2 events flowing through the existing trace bus and validated in Task 7.
- **Failure counting** — covered in Task 1 error-summary test and Task 2 failed-call provider test.
- **Unscoped-call rule** — covered in Task 2 unscoped provider test.

### Placeholder scan

- No `TBD`, `TODO`, or implied follow-up placeholders remain.
- Every code-changing step includes an explicit code block.
- Every verification step includes an exact command and expected outcome.

### Type consistency

- `RuntimeRequestType` is defined once in `src/logging/types.ts` and reused everywhere.
- `meta.origin` is the only new `LlmCompleteRequest` metadata field used in provider traces and call-site annotations.
- Event names stay consistent: `llm.call.complete`, `llm.call.error`, and `llm.request.summary`.
