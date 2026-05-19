# Full Operational Runtime Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--log 1|2|3` runtime logging, with full-runtime structured JSONL tracing at level 3 and easy filtering for the new memory stack.

**Architecture:** Build a small logging subsystem under `src/logging/` with a typed CLI parser, trace bus, secret redaction, console sink, and JSONL sink. Then thread an optional trace emitter through startup, bot, agent, tool registry, scheduler/autonomous flows, and memory services, preserving current console output when `--log` is omitted.

**Tech Stack:** TypeScript, Bun, bun:test, bun:sqlite, Node `fs/promises`, grammY

---

## File structure

### New files

- `src/logging/types.ts` — shared log levels, trace event types, sink types, and emitter interface.
- `src/logging/cli.ts` — parse `--log 1|2|3` and `--migrate-only` from CLI args.
- `src/logging/redaction.ts` — recursively redact secrets before console or JSONL writes.
- `src/logging/trace-bus.ts` — assign `seq`, `ts`, `runId`, filter by level, and isolate sink failures.
- `src/logging/console-sink.ts` — format concise operator-facing console output.
- `src/logging/jsonl-sink.ts` — create `${dataDir}/logs/runtime-*.jsonl` and append events.
- `src/logging/helpers.ts` — tiny helpers for optional trace emission and stable tag reuse.
- `src/logging/setup.ts` — compose parser + sink creation for startup.
- `tests/logging/cli.test.ts` — CLI parser coverage.
- `tests/logging/redaction.test.ts` — secret masking coverage.
- `tests/logging/trace-bus.test.ts` — level filtering, sequencing, sink-failure isolation.
- `tests/logging/jsonl-sink.test.ts` — file-path and JSONL append coverage.
- `tests/logging/setup.test.ts` — startup logging setup coverage.

### Existing files to modify

- `src/index.ts` — parse logging flags, create the runtime logger, emit startup/shutdown/fatal events.
- `src/bot/bot.ts` — emit Telegram lifecycle and outbound-send events.
- `src/bot/conversations/memory-update-runner.ts` — emit duplicate-run and background-failure events.
- `src/tools/registry.ts` — emit tool execution boundary events.
- `src/agent/react-agent.ts` — emit agent, recall, tool-call, and answer events.
- `src/cron/scheduler.ts` — emit scheduler tick/dispatch events.
- `src/cron/autonomous.ts` — emit autonomous job and scheduled memory-update events.
- `src/memory/integration/factory.ts` — thread the trace emitter into memory services.
- `src/memory/core/service.ts` — emit recall and service-level memory events.
- `src/memory/events/service.ts` — emit interaction-persistence events.
- `src/memory/offload/service.ts` — emit inline/offloaded/fallback offload events.
- `src/memory/pipeline/coordinator.ts` — emit `l1`/`l2`/`l3` pipeline events.
- `tests/tools/registry.test.ts` — tool trace assertions.
- `tests/memory/agent-runtime.test.ts` — agent trace assertions.
- `tests/cron/scheduler.test.ts` — scheduler trace assertions.
- `tests/cron/autonomous-helpers.test.ts` — autonomous and memory-update trace assertions.
- `tests/bot/memory-update-callback.test.ts` — Telegram callback trace assertions.
- `tests/memory/pipeline.test.ts` — pipeline trace assertions.
- `tests/memory/offload.test.ts` — offload trace assertions.
- `tests/memory/history-jsonl.test.ts` — interaction-log trace assertions.

## Event naming and tags

Use `source` plus short event names consistently:

- `source: "app"` → `startup.begin`, `migration.only`, `config.ready`, `shutdown.begin`, `shutdown.complete`, `fatal`
- `source: "bot"` → `command.start`, `command.menu`, `command.help`, `message.received`, `message.answered`, `callback.memory_update.run_now`, `outbound.reply.complete`, `outbound.edit.complete`, `outbound.send.complete`, `error`
- `source: "agent"` → `run.start`, `l15.complete`, `context.loaded`, `iteration.start`, `response.received`, `tool.call`, `tool.result`, `run.complete`, `max_iterations`
- `source: "tool"` → `execute.start`, `execute.complete`, `execute.error`
- `source: "scheduler"` → `tick.start`, `tick.complete`, `tick.busy_skip`, `dispatch.job.error`, `dispatch.memory_update.error`
- `source: "autonomous"` → `job.start`, `job.complete`, `job.error`, `hybrid_message.send_error`, `answer.send_error`
- `source: "memory"` → `recall.start`, `recall.complete`, `interaction.user_message.logged`, `interaction.assistant_message.logged`, `interaction.tool_call.logged`, `interaction.tool_result.logged`, `offload.inline`, `offload.ref_written`, `offload.fallback`, `pipeline.l1.start`, `pipeline.l1.complete`, `pipeline.l1.skip`, `pipeline.l2.start`, `pipeline.l2.complete`, `pipeline.l2.skip`, `pipeline.l3.start`, `pipeline.l3.complete`, `pipeline.l3.skip`

Use one stable tag for the new memory flow:

- `new-memory-stack`

Apply that tag to events emitted from the memory-aware agent path and the newer store/recall/offload/pipeline code.

## Task 1: Add logging types and CLI parsing

**Files:**
- Create: `src/logging/types.ts`
- Create: `src/logging/cli.ts`
- Test: `tests/logging/cli.test.ts`

- [ ] **Step 1: Write the failing CLI parser test**

```ts
import { expect, test } from "bun:test";
import { parseRuntimeCliArgs } from "../../src/logging/cli";

test("parseRuntimeCliArgs accepts omitted log flag and migrate-only", () => {
  expect(parseRuntimeCliArgs([])).toEqual({ logLevel: undefined, migrateOnly: false });
  expect(parseRuntimeCliArgs(["--migrate-only"])).toEqual({ logLevel: undefined, migrateOnly: true });
});

test("parseRuntimeCliArgs accepts spaced and equals log syntax", () => {
  expect(parseRuntimeCliArgs(["--log", "1"])).toEqual({ logLevel: 1, migrateOnly: false });
  expect(parseRuntimeCliArgs(["--log=2", "--migrate-only"])).toEqual({ logLevel: 2, migrateOnly: true });
  expect(parseRuntimeCliArgs(["--migrate-only", "--log", "3"])).toEqual({ logLevel: 3, migrateOnly: true });
});

test("parseRuntimeCliArgs rejects invalid and duplicate log values", () => {
  expect(() => parseRuntimeCliArgs(["--log"])).toThrow('Missing value after "--log". Use 1, 2, or 3.');
  expect(() => parseRuntimeCliArgs(["--log", "9"])).toThrow('Invalid --log value "9". Use 1, 2, or 3.');
  expect(() => parseRuntimeCliArgs(["--log", "2", "--log", "3"])).toThrow("Use --log only once.");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test tests/logging/cli.test.ts
```

Expected: FAIL with `Cannot find module '../../src/logging/cli'` or `parseRuntimeCliArgs` not found.

- [ ] **Step 3: Create the shared logging types**

```ts
export type RuntimeLogLevel = 1 | 2 | 3;

export type RuntimeTraceSource =
  | "app"
  | "bot"
  | "agent"
  | "tool"
  | "scheduler"
  | "autonomous"
  | "memory";

export type RuntimeTraceError = {
  message: string;
  name?: string;
  stack?: string;
};

export type RuntimeTraceEventInput = {
  minLevel: RuntimeLogLevel;
  source: RuntimeTraceSource;
  event: string;
  tags?: string[];
  chatId?: string;
  userId?: string;
  taskId?: number;
  jobId?: number;
  toolName?: string;
  toolCallId?: string;
  durationMs?: number;
  payload?: Record<string, unknown>;
  error?: RuntimeTraceError;
};

export type RuntimeTraceEvent = RuntimeTraceEventInput & {
  ts: string;
  seq: number;
  runId: string;
  pid: number;
};

export type RuntimeCliOptions = {
  logLevel?: RuntimeLogLevel;
  migrateOnly: boolean;
};

export interface RuntimeTraceSink {
  write(event: RuntimeTraceEvent): void | Promise<void>;
}

export interface RuntimeTraceEmitter {
  emit(event: RuntimeTraceEventInput): Promise<void>;
}
```

- [ ] **Step 4: Implement the CLI parser**

```ts
import type { RuntimeCliOptions, RuntimeLogLevel } from "./types";

function parseLogLevel(raw: string): RuntimeLogLevel {
  if (raw === "1" || raw === "2" || raw === "3") {
    return Number(raw) as RuntimeLogLevel;
  }
  throw new Error(`Invalid --log value "${raw}". Use 1, 2, or 3.`);
}

export function parseRuntimeCliArgs(argv: string[]): RuntimeCliOptions {
  let logLevel: RuntimeLogLevel | undefined;
  let migrateOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--migrate-only") {
      migrateOnly = true;
      continue;
    }

    if (arg === "--log") {
      if (logLevel !== undefined) {
        throw new Error("Use --log only once.");
      }
      const next = argv[i + 1];
      if (!next) {
        throw new Error('Missing value after "--log". Use 1, 2, or 3.');
      }
      logLevel = parseLogLevel(next);
      i += 1;
      continue;
    }

    if (arg.startsWith("--log=")) {
      if (logLevel !== undefined) {
        throw new Error("Use --log only once.");
      }
      logLevel = parseLogLevel(arg.slice("--log=".length));
    }
  }

  return { logLevel, migrateOnly };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
bun test tests/logging/cli.test.ts
```

Expected: PASS with 3 passing tests.

- [ ] **Step 6: Commit the CLI parser**

```bash
git add src/logging/types.ts src/logging/cli.ts tests/logging/cli.test.ts
git commit -m "feat: add runtime logging cli parser"
```

### Task 2: Build redaction, trace bus, and sinks

**Files:**
- Create: `src/logging/redaction.ts`
- Create: `src/logging/trace-bus.ts`
- Create: `src/logging/console-sink.ts`
- Create: `src/logging/jsonl-sink.ts`
- Create: `src/logging/helpers.ts`
- Test: `tests/logging/redaction.test.ts`
- Test: `tests/logging/trace-bus.test.ts`
- Test: `tests/logging/jsonl-sink.test.ts`

- [ ] **Step 1: Write the failing redaction, bus, and sink tests**

```ts
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { redactSecrets } from "../../src/logging/redaction";
import { RuntimeTraceBus } from "../../src/logging/trace-bus";
import { createJsonlTraceSink } from "../../src/logging/jsonl-sink";

test("redactSecrets masks nested keys and bearer tokens", () => {
  const redacted = redactSecrets({
    token: "123:telegram-token",
    headers: { authorization: "Bearer super-secret-token" },
    nested: { apiKey: "sk-ant-secret-value" },
  });

  expect(redacted).toEqual({
    token: "[REDACTED]",
    headers: { authorization: "[REDACTED]" },
    nested: { apiKey: "[REDACTED]" },
  });
});

test("RuntimeTraceBus filters by level, increments seq, and survives sink failure", async () => {
  const seen: Array<{ event: string; seq: number }> = [];
  const bus = new RuntimeTraceBus({
    level: 2,
    runId: "run-1",
    pid: 1234,
    now: () => new Date("2026-05-19T14:32:05.000Z"),
    sinks: [
      {
        async write(event) {
          seen.push({ event: event.event, seq: event.seq });
        },
      },
      {
        async write() {
          throw new Error("sink failed");
        },
      },
    ],
  });

  await bus.emit({ minLevel: 1, source: "app", event: "startup.begin" });
  await bus.emit({ minLevel: 3, source: "app", event: "startup.verbose" });
  await bus.emit({ minLevel: 2, source: "app", event: "config.ready" });

  expect(seen).toEqual([
    { event: "startup.begin", seq: 1 },
    { event: "config.ready", seq: 2 },
  ]);
});

test("createJsonlTraceSink creates a runtime log file under dataDir/logs", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-trace-"));

  try {
    const created = await createJsonlTraceSink({
      dataDir: tempDir,
      startedAt: new Date("2026-05-19T14:32:05.000Z"),
      pid: 1234,
    });

    expect(created.filePath.replace(/\\/g, "/")).toContain("/logs/runtime-20260519T143205Z-p1234.jsonl");
    await created.sink.write({
      ts: "2026-05-19T14:32:05.000Z",
      seq: 1,
      runId: "run-1",
      pid: 1234,
      minLevel: 3,
      source: "agent",
      event: "run.start",
      payload: { input: "remember this" },
    });

    const contents = await Bun.file(created.filePath).text();
    expect(contents).toContain('"event":"run.start"');
    expect(contents.trim().split("\n")).toHaveLength(1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun test tests/logging/redaction.test.ts tests/logging/trace-bus.test.ts tests/logging/jsonl-sink.test.ts
```

Expected: FAIL because the logging modules do not exist yet.

- [ ] **Step 3: Implement secret redaction**

```ts
const SECRET_KEYS = new Set(["token", "apiKey", "api_key", "authorization", "secret"]);

function redactString(value: string): string {
  return value
    .replace(/Bearer\s+[^\s]+/gi, "[REDACTED]")
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/sk-(?:proj-)?[A-Za-z0-9_-]+/g, "[REDACTED]");
}

function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key) || key.toLowerCase().endsWith("token") || key.toLowerCase().endsWith("apikey");
}

export function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => {
      if (isSecretKey(key)) {
        return [key, "[REDACTED]"];
      }
      return [key, redactSecrets(nestedValue)];
    }),
  );
}
```

- [ ] **Step 4: Implement the trace bus**

```ts
import { redactSecrets } from "./redaction";
import type {
  RuntimeLogLevel,
  RuntimeTraceEmitter,
  RuntimeTraceEvent,
  RuntimeTraceEventInput,
  RuntimeTraceSink,
} from "./types";

type RuntimeTraceBusOptions = {
  level: RuntimeLogLevel;
  runId: string;
  pid?: number;
  now?: () => Date;
  sinks: RuntimeTraceSink[];
  onSinkError?: (message: string) => void;
};

export class RuntimeTraceBus implements RuntimeTraceEmitter {
  private seq = 0;

  constructor(private readonly options: RuntimeTraceBusOptions) {}

  async emit(input: RuntimeTraceEventInput): Promise<void> {
    if (input.minLevel > this.options.level) {
      return;
    }

    const event: RuntimeTraceEvent = {
      ...input,
      ts: (this.options.now ?? (() => new Date()))().toISOString(),
      seq: this.seq + 1,
      runId: this.options.runId,
      pid: this.options.pid ?? process.pid,
      tags: input.tags ?? [],
      payload: input.payload ? redactSecrets(input.payload) as Record<string, unknown> : undefined,
      error: input.error ? redactSecrets(input.error) as RuntimeTraceEvent["error"] : undefined,
    };

    this.seq = event.seq;

    for (const sink of this.options.sinks) {
      try {
        await sink.write(event);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.options.onSinkError?.(`[trace:sink-error] ${message}`);
      }
    }
  }
}
```

- [ ] **Step 5: Implement the console sink, JSONL sink, and helpers**

```ts
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { truncateText } from "../utils/text";
import type { RuntimeTraceEvent, RuntimeTraceSink } from "./types";

export const NEW_MEMORY_STACK_TAG = "new-memory-stack";

export async function emitTrace(trace: { emit(event: any): Promise<void> } | undefined, event: any) {
  if (!trace) return;
  await trace.emit(event);
}

export class ConsoleTraceSink implements RuntimeTraceSink {
  constructor(private readonly writeLine: (line: string) => void = (line) => console.log(line)) {}

  async write(event: RuntimeTraceEvent): Promise<void> {
    const ids = [event.chatId, event.userId, event.jobId, event.toolCallId].filter(Boolean).join(" ");
    const payload = event.payload ? truncateText(JSON.stringify(event.payload), 240) : "";
    const error = event.error?.message ? ` error=${event.error.message}` : "";
    this.writeLine(`[${event.source}:${event.event}] ${ids} ${payload}${error}`.trim());
  }
}

function formatFileStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function buildRuntimeLogFilePath(dataDir: string, startedAt: Date, pid = process.pid): string {
  return join(resolve(dataDir), "logs", `runtime-${formatFileStamp(startedAt)}-p${pid}.jsonl`);
}

export async function createJsonlTraceSink(input: {
  dataDir: string;
  startedAt?: Date;
  pid?: number;
}): Promise<{ filePath: string; sink: RuntimeTraceSink }> {
  const startedAt = input.startedAt ?? new Date();
  const filePath = buildRuntimeLogFilePath(input.dataDir, startedAt, input.pid ?? process.pid);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, "", "utf8");

  return {
    filePath,
    sink: {
      async write(event: RuntimeTraceEvent) {
        await appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
      },
    },
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run:

```bash
bun test tests/logging/redaction.test.ts tests/logging/trace-bus.test.ts tests/logging/jsonl-sink.test.ts
```

Expected: PASS with 3 passing test files.

- [ ] **Step 7: Commit the logging core**

```bash
git add src/logging/redaction.ts src/logging/trace-bus.ts src/logging/console-sink.ts src/logging/jsonl-sink.ts src/logging/helpers.ts tests/logging/redaction.test.ts tests/logging/trace-bus.test.ts tests/logging/jsonl-sink.test.ts
git commit -m "feat: add runtime trace bus and sinks"
```

### Task 3: Wire startup logging and runtime setup

**Files:**
- Create: `src/logging/setup.ts`
- Modify: `src/index.ts`
- Test: `tests/logging/setup.test.ts`

- [ ] **Step 1: Write the failing runtime setup test**

```ts
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setupRuntimeLogging } from "../../src/logging/setup";

test("setupRuntimeLogging skips file tracing when --log is absent", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-logging-"));

  try {
    const setup = await setupRuntimeLogging({ argv: ["--migrate-only"], dataDir: tempDir });
    expect(setup.cli).toEqual({ logLevel: undefined, migrateOnly: true });
    expect(setup.trace).toBeUndefined();
    expect(setup.traceFilePath).toBeUndefined();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("setupRuntimeLogging creates a level-3 trace file", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-logging-"));

  try {
    const setup = await setupRuntimeLogging({
      argv: ["--log", "3"],
      dataDir: tempDir,
      startedAt: new Date("2026-05-19T14:32:05.000Z"),
      pid: 1234,
      consoleWrite: () => undefined,
    });

    expect(setup.cli.logLevel).toBe(3);
    expect(setup.traceFilePath?.replace(/\\/g, "/")).toContain("/logs/runtime-20260519T143205Z-p1234.jsonl");
    expect(await Bun.file(setup.traceFilePath!).exists()).toBe(true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test tests/logging/setup.test.ts
```

Expected: FAIL because `setupRuntimeLogging` does not exist yet.

- [ ] **Step 3: Implement startup logging setup**

```ts
import { parseRuntimeCliArgs } from "./cli";
import { ConsoleTraceSink } from "./console-sink";
import { createJsonlTraceSink } from "./jsonl-sink";
import { RuntimeTraceBus } from "./trace-bus";

export async function setupRuntimeLogging(input: {
  argv: string[];
  dataDir: string;
  startedAt?: Date;
  pid?: number;
  consoleWrite?: (line: string) => void;
}) {
  const cli = parseRuntimeCliArgs(input.argv);
  if (cli.logLevel === undefined) {
    return { cli, trace: undefined, traceFilePath: undefined };
  }

  const sinks = [new ConsoleTraceSink(input.consoleWrite)];
  let traceFilePath: string | undefined;

  if (cli.logLevel === 3) {
    const jsonl = await createJsonlTraceSink({
      dataDir: input.dataDir,
      startedAt: input.startedAt,
      pid: input.pid,
    });
    sinks.push(jsonl.sink);
    traceFilePath = jsonl.filePath;
  }

  const startedAt = input.startedAt ?? new Date();
  const runId = `run-${startedAt.getTime()}-${input.pid ?? process.pid}`;
  const trace = new RuntimeTraceBus({
    level: cli.logLevel,
    runId,
    pid: input.pid,
    sinks,
    onSinkError: (line) => (input.consoleWrite ?? console.error)(line),
  });

  return { cli, trace, traceFilePath };
}
```

- [ ] **Step 4: Modify startup and shutdown wiring in `src/index.ts`**

```ts
import { emitTrace } from "./logging/helpers";
import { setupRuntimeLogging } from "./logging/setup";

async function main() {
  const logging = await setupRuntimeLogging({
    argv: process.argv.slice(2),
    dataDir: config.storage.dataDir,
  });
  const trace = logging.trace;

  try {
    await emitTrace(trace, {
      minLevel: 1,
      source: "app",
      event: "startup.begin",
      payload: {
        argv: process.argv.slice(2),
        logLevel: logging.cli.logLevel,
      },
    });

    initDb();

    if (logging.cli.migrateOnly) {
      await emitTrace(trace, {
        minLevel: 1,
        source: "app",
        event: "migration.only",
        payload: {
          dbPath: config.storage.dbPath,
          traceFilePath: logging.traceFilePath,
        },
      });
      console.log(`Migration done: ${config.storage.dbPath}`);
      return;
    }

    assertRuntimeConfig();
    await emitTrace(trace, {
      minLevel: 1,
      source: "app",
      event: "config.ready",
      payload: {
        runtimeConfig: getRuntimeConfigSummary(),
        traceFilePath: logging.traceFilePath,
      },
    });

    const llm = createLlmProvider();
    const memory = await createMemoryService(db, llm, {
      storage: {
        dataDir: config.storage.dataDir,
        memoryRefsDir: config.storage.memoryRefsDir,
        memoryCanvasDir: config.storage.memoryCanvasDir,
        memoryJsonlExportDir: config.storage.memoryJsonlExportDir,
        historyDir: config.storage.historyDir,
        memoryTaskCanvasDir: config.storage.memoryTaskCanvasDir,
        memoryGeneratedSkillsDir: config.storage.memoryGeneratedSkillsDir,
      },
      memory: {
        maintenanceCron: config.memory.maintenanceCron,
        offloadEnabled: config.memory.offloadEnabled,
        offloadMinChars: config.memory.offloadMinChars,
        offloadSummaryChars: config.memory.offloadSummaryChars,
        sqliteVecEnabled: config.memory.sqliteVecEnabled,
        jsonlExportEnabled: config.memory.jsonlExportEnabled,
        l15: config.memory.l15,
        l4: config.memory.l4,
      },
    });

    const registry = new ToolRegistry(db);
    const autonomousJobs = new AutonomousJobService(db);
    const memoryUpdateSettings = new MemoryUpdateSettingsService(db);
    const bot = createTelegramBot({ memory, registry, llm, autonomousJobs, memoryUpdateSettings });

    const stop = async () => {
      await emitTrace(trace, { minLevel: 1, source: "app", event: "shutdown.begin" });
      console.log("Shutting down...");
      await bot.stop().catch(() => undefined);
      db.close();
      await emitTrace(trace, { minLevel: 1, source: "app", event: "shutdown.complete" });
      process.exit(0);
    };

    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);

    await emitTrace(trace, { minLevel: 1, source: "app", event: "bot.starting" });
    console.log("Telegram bot starting...");
    await bot.start();
  } catch (error) {
    await emitTrace(trace, {
      minLevel: 1,
      source: "app",
      event: "fatal",
      error: error instanceof Error
        ? { message: error.message, name: error.name, stack: error.stack }
        : { message: String(error) },
    });
    console.error(error);
    process.exit(1);
  }
}

void main();
```

- [ ] **Step 5: Run the startup setup tests**

Run:

```bash
bun test tests/logging/setup.test.ts tests/logging/cli.test.ts tests/logging/jsonl-sink.test.ts
```

Expected: PASS with the setup, CLI, and JSONL tests all green.

- [ ] **Step 6: Commit the startup wiring**

```bash
git add src/logging/setup.ts src/index.ts tests/logging/setup.test.ts
git commit -m "feat: wire runtime logging startup"
```

### Task 4: Trace agent runs and tool execution boundaries

**Files:**
- Modify: `src/agent/react-agent.ts`
- Modify: `src/tools/registry.ts`
- Test: `tests/memory/agent-runtime.test.ts`
- Test: `tests/tools/registry.test.ts`

- [ ] **Step 1: Write the failing tool-registry and agent trace tests**

```ts
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { migrate } from "../../src/db/schema";
import { RuntimeTraceBus } from "../../src/logging/trace-bus";
import { ToolRegistry } from "../../src/tools/registry";

function recorder() {
  const events: Array<{ source: string; event: string; toolName?: string }> = [];
  const trace = new RuntimeTraceBus({
    level: 3,
    runId: "run-1",
    sinks: [{ async write(event) { events.push({ source: event.source, event: event.event, toolName: event.toolName }); } }],
  });
  return { trace, events };
}

test("ToolRegistry emits start, complete, and error events", async () => {
  const db = new Database(":memory:");
  migrate(db);
  const { trace, events } = recorder();
  const registry = new ToolRegistry(db, trace);

  registry.register({
    name: "ok_tool",
    source: "local",
    description: "ok",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      return "ok";
    },
  });
  registry.register({
    name: "bad_tool",
    source: "local",
    description: "bad",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      throw new Error("boom");
    },
  });

  await registry.call("ok_tool", {}, { chatId: "c1", userId: "u1", memory: {} as any });
  await registry.call("bad_tool", {}, { chatId: "c1", userId: "u1", memory: {} as any });

  expect(events).toEqual([
    { source: "tool", event: "execute.start", toolName: "ok_tool" },
    { source: "tool", event: "execute.complete", toolName: "ok_tool" },
    { source: "tool", event: "execute.start", toolName: "bad_tool" },
    { source: "tool", event: "execute.error", toolName: "bad_tool" },
  ]);
});
```

Add this agent assertion to `tests/memory/agent-runtime.test.ts`:

```ts
test("agent runtime emits full trace events when a trace bus is provided", async () => {
  const events: Array<{ source: string; event: string; tags?: string[]; payload?: Record<string, unknown> }> = [];
  const trace = new RuntimeTraceBus({
    level: 3,
    runId: "run-1",
    sinks: [{ async write(event) { events.push({ source: event.source, event: event.event, tags: event.tags, payload: event.payload }); } }],
  });

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
      l4: { enabled: true, mode: "local", requireCompletedTask: false, maxEvidenceEntries: 80, maxCanvasChars: 20000, maxSkillChars: 20000 },
    },
  }, trace);
  const registry = new ToolRegistry(db, trace);
  registry.registerMany(createLocalTools(memory));

  await runReactAgent({
    chatId: "c1",
    userId: "u1",
    input: "remember that we use Bun",
    memory,
    registry,
    llm: llm as any,
    mode: "chat",
    trace,
  });

  expect(events.map((event) => `${event.source}:${event.event}`)).toEqual(expect.arrayContaining([
    "agent:run.start",
    "agent:l15.complete",
    "agent:context.loaded",
    "agent:run.complete",
  ]));
  expect(events.some((event) => event.tags?.includes("new-memory-stack"))).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun test tests/tools/registry.test.ts tests/memory/agent-runtime.test.ts
```

Expected: FAIL because `ToolRegistry` and `runReactAgent` do not accept a trace emitter yet.

- [ ] **Step 3: Modify the tool registry to emit execution boundary events**

```ts
import { emitTrace } from "../logging/helpers";
import type { RuntimeTraceEmitter } from "../logging/types";

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  constructor(
    private readonly db: Database,
    private readonly trace?: RuntimeTraceEmitter,
  ) {}

  async call(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return `Tool not found: ${name}`;

    await emitTrace(this.trace, {
      minLevel: 2,
      source: "tool",
      event: "execute.start",
      toolName: name,
      chatId: ctx.chatId,
      userId: ctx.userId,
      payload: { args },
    });

    try {
      const result = await tool.execute(args, ctx);
      await emitTrace(this.trace, {
        minLevel: 3,
        source: "tool",
        event: "execute.complete",
        toolName: name,
        chatId: ctx.chatId,
        userId: ctx.userId,
        payload: { args, result },
      });
      return result;
    } catch (error) {
      await emitTrace(this.trace, {
        minLevel: 1,
        source: "tool",
        event: "execute.error",
        toolName: name,
        chatId: ctx.chatId,
        userId: ctx.userId,
        payload: { args },
        error: error instanceof Error
          ? { message: error.message, name: error.name, stack: error.stack }
          : { message: String(error) },
      });
      return `Tool ${name} failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
```

- [ ] **Step 4: Modify `runReactAgent` to emit agent trace events and tag the new memory flow**

```ts
import { NEW_MEMORY_STACK_TAG, emitTrace } from "../logging/helpers";
import type { RuntimeTraceEmitter } from "../logging/types";

export type RunAgentInput = {
  chatId: string;
  userId: string;
  input: string;
  memory: MemoryService;
  registry: ToolRegistry;
  llm: LlmProvider;
  mode?: "chat" | "autonomous";
  trace?: RuntimeTraceEmitter;
};

async function logAgentEvent(
  trace: RuntimeTraceEmitter | undefined,
  event: string,
  details: Record<string, unknown>,
  minLevel: 1 | 2 | 3 = 2,
  tags?: string[],
) {
  if (trace) {
    await emitTrace(trace, {
      minLevel,
      source: "agent",
      event,
      tags,
      chatId: typeof details.chatId === "string" ? details.chatId : undefined,
      userId: typeof details.userId === "string" ? details.userId : undefined,
      payload: details,
    });
    return;
  }
  console.log(`[agent:${event}]`, details);
}

await logAgentEvent(input.trace, "run.start", {
  mode: input.mode ?? "chat",
  chatId: input.chatId,
  userId: input.userId,
  input: input.input,
}, 2, [NEW_MEMORY_STACK_TAG]);

await logAgentEvent(input.trace, "l15.complete", {
  mode: input.mode ?? "chat",
  chatId: input.chatId,
  userId: input.userId,
  isLongTask: taskRouting.judgment.isLongTask,
  isContinuation: taskRouting.judgment.isContinuation,
  taskCompleted: taskRouting.judgment.taskCompleted,
  taskId: taskRouting.taskId,
  source: taskRouting.judgment.source,
}, 3, [NEW_MEMORY_STACK_TAG]);

await logAgentEvent(input.trace, "context.loaded", {
  mode: input.mode ?? "chat",
  chatId: input.chatId,
  userId: input.userId,
  recentMessages: recent.length,
  recall,
}, 3, [NEW_MEMORY_STACK_TAG]);

await logAgentEvent(input.trace, "run.complete", {
  mode: input.mode ?? "chat",
  chatId: input.chatId,
  userId: input.userId,
  answer,
  iterations: i + 1,
}, 2, [NEW_MEMORY_STACK_TAG]);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
bun test tests/tools/registry.test.ts tests/memory/agent-runtime.test.ts
```

Expected: PASS with the new trace assertions green.

- [ ] **Step 6: Commit the agent and tool tracing**

```bash
git add src/tools/registry.ts src/agent/react-agent.ts tests/tools/registry.test.ts tests/memory/agent-runtime.test.ts
git commit -m "feat: trace agent and tool execution"
```

### Task 5: Trace Telegram, scheduler, and autonomous runtime flows

**Files:**
- Modify: `src/bot/bot.ts`
- Modify: `src/bot/conversations/memory-update-runner.ts`
- Modify: `src/cron/scheduler.ts`
- Modify: `src/cron/autonomous.ts`
- Modify: `src/index.ts`
- Test: `tests/cron/scheduler.test.ts`
- Test: `tests/cron/autonomous-helpers.test.ts`
- Test: `tests/bot/memory-update-callback.test.ts`

- [ ] **Step 1: Write the failing bot, scheduler, and autonomous trace tests**

Add this scheduler assertion to `tests/cron/scheduler.test.ts`:

```ts
test("dispatchSchedulerTick emits scheduler trace summaries", async () => {
  const events: string[] = [];
  const trace = new RuntimeTraceBus({
    level: 3,
    runId: "run-1",
    sinks: [{ async write(event) { events.push(`${event.source}:${event.event}`); } }],
  });

  await dispatchSchedulerTick({
    jobs,
    memoryUpdateSettings: settings,
    maxItemsPerTick: 3,
    nowUnix,
    trace,
    runOneAutonomousJob: async ({ job }) => {
      calls.push(`job:${job.id}`);
      return { answer: "ok" } as any;
    },
    runOneMemoryUpdateNow: async ({ userId }) => {
      calls.push(`memory:${userId}`);
      return { maintenanceResult: { l1Created: 0, l2ScenarioId: null, personaUpdated: false } } as any;
    },
  });

  expect(events).toEqual(expect.arrayContaining([
    "scheduler:tick.start",
    "scheduler:tick.complete",
  ]));
});
```

Add this autonomous assertion to `tests/cron/autonomous-helpers.test.ts`:

```ts
const events: string[] = [];
const trace = new RuntimeTraceBus({
  level: 3,
  runId: "run-1",
  sinks: [{ async write(event) { events.push(`${event.source}:${event.event}`); } }],
});

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
  trace,
  runAgent: async () => "Autonomous answer",
  nowUnix: startedAt,
  finishedUnix: finishedAt,
});

expect(events).toEqual(expect.arrayContaining([
  "autonomous:job.start",
  "autonomous:job.complete",
]));
```

Add this bot assertion to `tests/bot/memory-update-callback.test.ts`:

```ts
const events: string[] = [];
const trace = new RuntimeTraceBus({
  level: 3,
  runId: "run-1",
  sinks: [{ async write(event) { events.push(`${event.source}:${event.event}`); } }],
});
const bot = createTelegramBot({
  memory: deps.memory,
  registry: deps.registry,
  llm: deps.llm,
  autonomousJobs: deps.autonomousJobs,
  memoryUpdateSettings: deps.memoryUpdateSettings,
  trace,
} as any);

await bot.handleUpdate(update as any);

expect(events).toEqual(expect.arrayContaining([
  "bot:callback.memory_update.run_now",
  "bot:outbound.send.complete",
]));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun test tests/cron/scheduler.test.ts tests/cron/autonomous-helpers.test.ts tests/bot/memory-update-callback.test.ts
```

Expected: FAIL because the bot and cron helpers do not accept `trace` yet.

- [ ] **Step 3: Modify the Telegram runtime code to emit lifecycle and outbound-send events**

```ts
import { emitTrace } from "../logging/helpers";
import type { RuntimeTraceEmitter } from "../logging/types";

export type BotDeps = {
  memory: MemoryService;
  registry: ToolRegistry;
  llm: LlmProvider;
  autonomousJobs: AutonomousJobService;
  memoryUpdateSettings: MemoryUpdateSettingsService;
  trace?: RuntimeTraceEmitter;
};

async function logTelegramEvent(
  trace: RuntimeTraceEmitter | undefined,
  event: string,
  details: Record<string, unknown>,
  minLevel: 1 | 2 | 3 = 2,
) {
  if (trace) {
    await emitTrace(trace, {
      minLevel,
      source: "bot",
      event,
      chatId: typeof details.chatId === "string" ? details.chatId : undefined,
      userId: typeof details.userId === "string" ? details.userId : undefined,
      payload: details,
    });
    return;
  }
  console.log(`[telegram:${event}]`, details);
}

async function presentScreen(ctx: BotContext, text: string, keyboard: InlineKeyboard, trace?: RuntimeTraceEmitter) {
  const chatId = resolveChatId(ctx);
  const userId = resolveUserId(ctx);

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { reply_markup: keyboard });
      await emitTrace(trace, {
        minLevel: 2,
        source: "bot",
        event: "outbound.edit.complete",
        chatId,
        userId,
        payload: { text },
      });
    } catch (error) {
      if (!isUnchangedMessageError(error)) {
        throw error;
      }
    }
    return;
  }

  await ctx.reply(text, { reply_markup: keyboard });
  await emitTrace(trace, {
    minLevel: 2,
    source: "bot",
    event: "outbound.reply.complete",
    chatId,
    userId,
    payload: { text },
  });
}

const result = await startTelegramMemoryUpdateRun({
  memory: deps.memory,
  settings: deps.memoryUpdateSettings,
  userId: target.userId,
  trace: deps.trace,
  sendMessage: async (text) => {
    const sent = await ctx.api.sendMessage(target.chatId, text);
    await emitTrace(deps.trace, {
      minLevel: 2,
      source: "bot",
      event: "outbound.send.complete",
      chatId: target.chatId,
      userId: target.userId,
      payload: { text },
    });
    return sent;
  },
});
```

Update `src/bot/conversations/memory-update-runner.ts` with this input change and trace emits:

```ts
import { emitTrace } from "../../logging/helpers";
import type { RuntimeTraceEmitter } from "../../logging/types";

export type TelegramMemoryUpdateRunInput = {
  memory: MemoryService;
  settings: MemoryUpdateSettingsService;
  userId: string;
  sendMessage: (text: string) => Promise<unknown>;
  runNow?: typeof runOneMemoryUpdateNow;
  trace?: RuntimeTraceEmitter;
};

if (activeMemoryUpdateUsers.has(input.userId)) {
  await emitTrace(input.trace, {
    minLevel: 1,
    source: "bot",
    event: "callback.memory_update.run_now",
    userId: input.userId,
    payload: { status: "already-running" },
  });
  console.log("[memory-update:run-skip]", {
    source: "telegram",
    userId: input.userId,
    reason: "already_running",
  });
  return { status: "already-running" };
}

completion.catch(async (error) => {
  await emitTrace(input.trace, {
    minLevel: 1,
    source: "bot",
    event: "error",
    userId: input.userId,
    error: error instanceof Error
      ? { message: error.message, name: error.name, stack: error.stack }
      : { message: String(error) },
  });
  console.error("Telegram memory update background task failed", error);
});
```

- [ ] **Step 4: Modify the scheduler and autonomous runtime code to emit trace events**

```ts
import { emitTrace } from "../logging/helpers";
import type { RuntimeTraceEmitter } from "../logging/types";

export type SchedulerDispatchInput = {
  jobs: AutonomousJobService;
  memoryUpdateSettings: MemoryUpdateSettingsService;
  maxItemsPerTick: number;
  nowUnix?: number;
  trace?: RuntimeTraceEmitter;
  runOneAutonomousJob: RunOneAutonomousJob;
  runOneMemoryUpdateNow: RunOneMemoryUpdateNow;
};

async function logSchedulerEvent(trace: RuntimeTraceEmitter | undefined, event: string, details: Record<string, unknown>) {
  if (trace) {
    await emitTrace(trace, { minLevel: 2, source: "scheduler", event, payload: details });
    return;
  }
  console.log(`[cron:${event}]`, details);
}

await logSchedulerEvent(input.trace, "tick.start", {
  nowUnix,
  maxItemsPerTick: input.maxItemsPerTick,
  dueJobs: dueJobs.length,
});

await logSchedulerEvent(input.trace, "tick.complete", {
  nowUnix,
  jobsRun,
  memoryUpdatesRun,
  maxItemsPerTick: input.maxItemsPerTick,
});
```

```ts
export type AutonomousRunInput = AutonomousDeps & {
  job: AutonomousJobRow;
  nowUnix?: number;
  finishedUnix?: number;
  runAgent?: typeof runReactAgent;
  trace?: RuntimeTraceEmitter;
};

await emitTrace(input.trace, {
  minLevel: 2,
  source: "autonomous",
  event: "job.start",
  chatId: input.job.chatId,
  userId: input.job.userId,
  jobId: input.job.id,
  payload: {
    jobType: input.job.jobType,
    scheduleMode: input.job.scheduleMode,
  },
});

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

await emitTrace(input.trace, {
  minLevel: 2,
  source: "autonomous",
  event: "job.complete",
  chatId: input.job.chatId,
  userId: input.job.userId,
  jobId: input.job.id,
  payload: {
    deleted: completion.deleted,
    runCount: completion.runCount,
  },
});
```

- [ ] **Step 5: Pass the trace emitter through `src/index.ts`**

```ts
const memory = await createMemoryService(db, llm, {
  storage: {
    dataDir: config.storage.dataDir,
    memoryRefsDir: config.storage.memoryRefsDir,
    memoryCanvasDir: config.storage.memoryCanvasDir,
    memoryJsonlExportDir: config.storage.memoryJsonlExportDir,
    historyDir: config.storage.historyDir,
    memoryTaskCanvasDir: config.storage.memoryTaskCanvasDir,
    memoryGeneratedSkillsDir: config.storage.memoryGeneratedSkillsDir,
  },
  memory: {
    maintenanceCron: config.memory.maintenanceCron,
    offloadEnabled: config.memory.offloadEnabled,
    offloadMinChars: config.memory.offloadMinChars,
    offloadSummaryChars: config.memory.offloadSummaryChars,
    sqliteVecEnabled: config.memory.sqliteVecEnabled,
    jsonlExportEnabled: config.memory.jsonlExportEnabled,
    l15: config.memory.l15,
    l4: config.memory.l4,
  },
}, trace);

const registry = new ToolRegistry(db, trace);
const bot = createTelegramBot({ memory, registry, llm, autonomousJobs, memoryUpdateSettings, trace });

startSchedulerLoop({
  tickCron: config.scheduler.tickCron,
  maxItemsPerTick: config.scheduler.maxItemsPerTick,
  jobs: autonomousJobs,
  memoryUpdateSettings,
  nowUnixFn: unixNow,
  trace,
  runOneAutonomousJob: ({ job, nowUnix }) =>
    runOneAutonomousJob({
      db,
      bot,
      memory,
      registry,
      llm,
      job,
      nowUnix,
      trace,
    }),
  runOneMemoryUpdateNow: ({ userId, nowUnix }) =>
    runOneMemoryUpdateNow({
      memory,
      settings: memoryUpdateSettings,
      userId,
      nowUnix,
      trace,
    }),
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run:

```bash
bun test tests/cron/scheduler.test.ts tests/cron/autonomous-helpers.test.ts tests/bot/memory-update-callback.test.ts
```

Expected: PASS with scheduler, autonomous, and bot callback traces asserted.

- [ ] **Step 7: Commit the Telegram and scheduler tracing**

```bash
git add src/bot/bot.ts src/bot/conversations/memory-update-runner.ts src/cron/scheduler.ts src/cron/autonomous.ts src/index.ts tests/cron/scheduler.test.ts tests/cron/autonomous-helpers.test.ts tests/bot/memory-update-callback.test.ts
git commit -m "feat: trace telegram and scheduler runtime"
```

### Task 6: Trace the memory service, interaction log, offload, and pipeline

**Files:**
- Modify: `src/memory/integration/factory.ts`
- Modify: `src/memory/core/service.ts`
- Modify: `src/memory/events/service.ts`
- Modify: `src/memory/offload/service.ts`
- Modify: `src/memory/pipeline/coordinator.ts`
- Test: `tests/memory/pipeline.test.ts`
- Test: `tests/memory/offload.test.ts`
- Test: `tests/memory/history-jsonl.test.ts`

- [ ] **Step 1: Write the failing memory trace tests**

Add this pipeline assertion to `tests/memory/pipeline.test.ts`:

```ts
test("pipeline emits structured memory trace events", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-pipeline-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });
    const events: string[] = [];
    const trace = new RuntimeTraceBus({
      level: 3,
      runId: "run-1",
      sinks: [{ async write(event) { events.push(`${event.source}:${event.event}`); } }],
    });
    const pipeline = new PipelineCoordinator(backend, fakeLlm, undefined, trace);

    await backend.insertConversationTurn({ chatId: "c1", userId: "u1", role: "user", content: "Please use Bun for this bot.", meta: { mode: "chat" } });
    await pipeline.runMaintenanceForUser("u1", true, { source: "telegram" });

    expect(events).toEqual(expect.arrayContaining([
      "memory:pipeline.l1.start",
      "memory:pipeline.l1.complete",
      "memory:pipeline.l2.start",
      "memory:pipeline.l2.complete",
      "memory:pipeline.l3.start",
      "memory:pipeline.l3.complete",
    ]));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

Add this offload assertion to `tests/memory/offload.test.ts`:

```ts
const traceEvents: string[] = [];
const trace = new RuntimeTraceBus({
  level: 3,
  runId: "run-1",
  sinks: [{ async write(event) { traceEvents.push(`${event.source}:${event.event}`); } }],
});
const ok = new OffloadService(backend, offloadOptions({ offloadMinChars: 10, offloadSummaryChars: 80 }), noopLlm as any, undefined, trace);
await ok.offloadToolResult({
  chatId: "c1",
  userId: "u1",
  toolName: "demo_tool",
  args: { city: "Bandung" },
  rawResult: "x".repeat(200),
});
expect(traceEvents).toEqual(expect.arrayContaining([
  "memory:offload.ref_written",
]));
```

Add this interaction-log assertion to `tests/memory/history-jsonl.test.ts`:

```ts
const events: string[] = [];
const trace = new RuntimeTraceBus({
  level: 3,
  runId: "run-1",
  sinks: [{ async write(event) { events.push(`${event.source}:${event.event}`); } }],
});
const service = new InteractionLogService(backend as any, { enabled: false, historyDir }, trace);
await service.logUserMessage({ chatId: "chat-1", userId: "user-1", content: "hello", mode: "chat" });
await service.logAssistantMessage({ chatId: "chat-1", userId: "user-1", content: "hi" });
await service.logToolResult({
  chatId: "chat-1",
  userId: "user-1",
  toolName: "demo",
  toolCallId: "call_1",
  content: "tool output",
  offloaded: false,
});
expect(events).toEqual(expect.arrayContaining([
  "memory:interaction.user_message.logged",
  "memory:interaction.assistant_message.logged",
  "memory:interaction.tool_result.logged",
]));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun test tests/memory/pipeline.test.ts tests/memory/offload.test.ts tests/memory/history-jsonl.test.ts
```

Expected: FAIL because the memory services do not accept `trace` yet.

- [ ] **Step 3: Thread the trace emitter into the memory factory, service, and interaction log**

```ts
import { NEW_MEMORY_STACK_TAG, emitTrace } from "../../logging/helpers";
import type { RuntimeTraceEmitter } from "../../logging/types";

export async function createMemoryService(
  db: Database,
  llm: LlmProvider,
  config: MemoryServiceFactoryConfig,
  trace?: RuntimeTraceEmitter,
): Promise<MemoryService> {
  const interactionLogService = new InteractionLogService(backend, {
    enabled: config.memory.jsonlExportEnabled,
    exportDir: config.storage.memoryJsonlExportDir,
    historyDir: config.storage.historyDir,
  }, trace);
  const offloadService = new OffloadService(
    backend,
    {
      offloadMinChars: config.memory.offloadEnabled ? config.memory.offloadMinChars : Number.MAX_SAFE_INTEGER,
      offloadSummaryChars: config.memory.offloadSummaryChars,
      l1,
      l2,
      jsonlEnabled: config.memory.jsonlExportEnabled,
    },
    llm,
    undefined,
    trace,
  );
  const pipelineCoordinator = new PipelineCoordinator(backend, llm, store, trace);

  return new MemoryService(
    backend,
    llm,
    {
      dataDir: config.storage.dataDir,
      backendName: "sqlite",
      backendOwner: "project-owned memory backend",
      maintenanceCron: config.memory.maintenanceCron,
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
}
```

```ts
type MemoryServiceState = {
  backend: MemoryBackend;
  recallService: RecallService;
  interactionLogService: InteractionLogService;
  offloadService: OffloadService;
  pipelineCoordinator: PipelineCoordinator;
  store?: IMemoryStore;
  llm: LlmProvider;
  options: MemoryServiceOptions;
  trace?: RuntimeTraceEmitter;
};

await emitTrace(state.trace, {
  minLevel: 2,
  source: "memory",
  event: "recall.start",
  tags: [NEW_MEMORY_STACK_TAG],
  userId,
  chatId,
  payload: { query, maxResults },
});

await emitTrace(state.trace, {
  minLevel: 3,
  source: "memory",
  event: "recall.complete",
  tags: [NEW_MEMORY_STACK_TAG],
  userId,
  chatId,
  payload: {
    atoms: recall.atoms.length,
    scenarios: recall.scenarios.length,
    conversations: conversations.length,
    hasPersona: Boolean(recall.persona),
  },
});
```

```ts
export class InteractionLogService {
  constructor(
    private readonly backend: MemoryBackend,
    private readonly options: InteractionLogServiceOptions,
    private readonly trace?: RuntimeTraceEmitter,
  ) {}

  async logUserMessage(input: { chatId: string; userId: string; content: string; mode?: string }): Promise<number> {
    const createdAt = nowIso();
    const meta: EventMeta = input.mode ? { mode: input.mode } : {};
    const eventId = await this.backend.insertInteractionEvent({
      chatId: input.chatId,
      userId: input.userId,
      type: "user_message",
      content: input.content,
      meta,
      createdAt,
    });

    await appendChatHistoryTurn(this.options.historyDir, {
      chatId: input.chatId,
      userId: input.userId,
      role: "user",
      content: input.content,
      meta,
      createdAt,
    });

    await this.exportIfEnabled({
      id: eventId,
      chatId: input.chatId,
      userId: input.userId,
      type: "user_message",
      content: input.content,
      meta,
      createdAt,
    });

    await emitTrace(this.trace, {
      minLevel: 3,
      source: "memory",
      event: "interaction.user_message.logged",
      tags: [NEW_MEMORY_STACK_TAG],
      chatId: input.chatId,
      userId: input.userId,
      payload: { eventId, mode: input.mode, createdAt },
    });

    return eventId;
  }
}
```

- [ ] **Step 4: Emit offload and pipeline events tagged `new-memory-stack`**

```ts
export class OffloadService {
  constructor(
    private readonly backend: MemoryBackend,
    private readonly options: OffloadServiceOptions,
    private readonly llm: LlmProvider,
    private readonly writeTextFile: FileWriter = (path, content) => writeFile(path, content, "utf8"),
    private readonly trace?: RuntimeTraceEmitter,
  ) {}

  async offloadToolResult(input: OffloadToolResultInput): Promise<OffloadToolResult> {
    const shouldOffload = input.rawResult.length >= this.options.offloadMinChars;

    if (!shouldOffload) {
      await emitTrace(this.trace, {
        minLevel: 3,
        source: "memory",
        event: "offload.inline",
        tags: [NEW_MEMORY_STACK_TAG],
        chatId: input.chatId,
        userId: input.userId,
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        payload: {
          rawLength: input.rawResult.length,
          summary,
        },
      });
      return { content: input.rawResult, offloaded: false, nodeId, summary };
    }

    await emitTrace(this.trace, {
      minLevel: 3,
      source: "memory",
      event: "offload.ref_written",
      tags: [NEW_MEMORY_STACK_TAG],
      chatId: input.chatId,
      userId: input.userId,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      payload: {
        nodeId,
        resultRef: relativePath,
        summary,
      },
    });

    return {
      content: [
        "[memory-offload]",
        `node_id=${nodeId}`,
        `result_ref=${relativePath}`,
        `tool=${input.toolName}`,
        `summary=${summary}`,
      ].join("\n"),
      offloaded: true,
      nodeId,
      resultRef: relativePath,
      summary,
    };
  }
}
```

```ts
export class PipelineCoordinator {
  constructor(
    private readonly backend: MemoryBackend,
    private readonly llm: LlmProvider,
    private readonly store?: IMemoryStore,
    private readonly trace?: RuntimeTraceEmitter,
  ) {}

  async runMaintenanceForUser(userId: string, force = false, options: MemoryUpdateProgressOptions = {}): Promise<PipelineMaintenanceResult> {
    const source = options.source ?? "scheduler";

    await emitTrace(this.trace, {
      minLevel: 2,
      source: "memory",
      event: "pipeline.l1.start",
      tags: [NEW_MEMORY_STACK_TAG],
      userId,
      payload: { source, force, pendingTurns: pendingTurns.length },
    });

    await emitTrace(this.trace, {
      minLevel: 2,
      source: "memory",
      event: "pipeline.l1.complete",
      tags: [NEW_MEMORY_STACK_TAG],
      userId,
      payload: {
        source,
        createdAtoms: l1Result.createdAtoms,
        checkpointAdvanced: l1Result.checkpointAdvanced,
      },
    });

    await emitTrace(this.trace, {
      minLevel: 2,
      source: "memory",
      event: "pipeline.l2.complete",
      tags: [NEW_MEMORY_STACK_TAG],
      userId,
      payload: {
        source,
        scenarioId: l2Result.scenarioId,
        atomCount: atoms.length,
      },
    });

    await emitTrace(this.trace, {
      minLevel: 2,
      source: "memory",
      event: "pipeline.l3.complete",
      tags: [NEW_MEMORY_STACK_TAG],
      userId,
      payload: {
        source,
        scenarioId: l2Result.scenarioId,
        personaUpdated,
      },
    });

    return {
      l1Created: l1Result.createdAtoms,
      l2ScenarioId: l2Result.scenarioId,
      personaUpdated,
    };
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
bun test tests/memory/pipeline.test.ts tests/memory/offload.test.ts tests/memory/history-jsonl.test.ts
```

Expected: PASS with the new memory trace assertions green.

- [ ] **Step 6: Commit the memory tracing**

```bash
git add src/memory/integration/factory.ts src/memory/core/service.ts src/memory/events/service.ts src/memory/offload/service.ts src/memory/pipeline/coordinator.ts tests/memory/pipeline.test.ts tests/memory/offload.test.ts tests/memory/history-jsonl.test.ts
git commit -m "feat: trace memory pipeline operations"
```

### Task 7: Run final verification and manual level-3 tracing

**Files:**
- Test: `tests/logging/cli.test.ts`
- Test: `tests/logging/redaction.test.ts`
- Test: `tests/logging/trace-bus.test.ts`
- Test: `tests/logging/jsonl-sink.test.ts`
- Test: `tests/logging/setup.test.ts`
- Test: `tests/tools/registry.test.ts`
- Test: `tests/memory/agent-runtime.test.ts`
- Test: `tests/cron/scheduler.test.ts`
- Test: `tests/cron/autonomous-helpers.test.ts`
- Test: `tests/bot/memory-update-callback.test.ts`
- Test: `tests/memory/pipeline.test.ts`
- Test: `tests/memory/offload.test.ts`
- Test: `tests/memory/history-jsonl.test.ts`

- [ ] **Step 1: Run the focused test suite for the new logging work**

Run:

```bash
bun test tests/logging/cli.test.ts tests/logging/redaction.test.ts tests/logging/trace-bus.test.ts tests/logging/jsonl-sink.test.ts tests/logging/setup.test.ts tests/tools/registry.test.ts tests/memory/agent-runtime.test.ts tests/cron/scheduler.test.ts tests/cron/autonomous-helpers.test.ts tests/bot/memory-update-callback.test.ts tests/memory/pipeline.test.ts tests/memory/offload.test.ts tests/memory/history-jsonl.test.ts
```

Expected: PASS with all logging-focused test files green.

- [ ] **Step 2: Run the typechecker**

Run:

```bash
bunx tsc --noEmit
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Manually start the app with level-3 logging**

Run:

```bash
bun src/index.ts --log 3
```

Expected:

- console lines such as `[app:startup.begin]`, `[app:config.ready]`, and later `[bot:message.received]` / `[agent:run.start]` when traffic arrives
- a new file under `data/logs/` named like `runtime-20260519T143205Z-p1234.jsonl`
- JSONL lines that include `source`, `event`, `runId`, `seq`, and full redacted payloads

- [ ] **Step 4: Verify `new-memory-stack` filtering works on the JSONL trace**

Run:

```bash
python - <<'PY'
import json
from pathlib import Path
latest = sorted(Path('data/logs').glob('runtime-*.jsonl'))[-1]
count = 0
for line in latest.read_text(encoding='utf-8').splitlines():
    event = json.loads(line)
    if 'new-memory-stack' in event.get('tags', []):
        count += 1
print({'file': str(latest), 'new_memory_stack_events': count})
PY
```

Expected: output like `{'file': 'data/logs/runtime-20260519T143205Z-p1234.jsonl', 'new_memory_stack_events': 5}` with a count greater than zero after a memory-aware agent run.

## Self-review checklist

- Spec coverage: Tasks 1-3 cover CLI, sink creation, and startup. Tasks 4-5 cover agent/tool, Telegram, scheduler, and autonomous runtime. Task 6 covers memory service, interaction logging, offload, and pipeline tracing. Task 7 covers final verification and manual level-3 validation.
- Placeholder scan: This plan intentionally contains no `TODO`, `TBD`, `implement later`, or `similar to task N` shortcuts.
- Type consistency: `RuntimeTraceEmitter`, `RuntimeTraceBus`, `NEW_MEMORY_STACK_TAG`, `parseRuntimeCliArgs`, `setupRuntimeLogging`, and the event names are used consistently across tasks.
