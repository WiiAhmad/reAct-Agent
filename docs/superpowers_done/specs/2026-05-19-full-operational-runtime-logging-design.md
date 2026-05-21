# Full operational runtime logging design

**Date:** 2026-05-19  
**Status:** Approved in conversation, written for user review  
**Target project:** `D:\Code\Test\yunus\grammy`

## Goal

Add a runtime CLI flag `--log 1|2|3` that controls runtime observability across the whole app:

- `--log 1`: important lifecycle events, warnings, and errors on the console
- `--log 2`: normal operational flow on the console across the full runtime
- `--log 3`: the same operational console flow plus a full structured JSONL trace written to disk for later inspection

The implementation must cover the entire runtime, while making it especially easy to trace the newer memory stack adopted in the last two commits.

## Requested behavior

The approved behavior from the design discussion is:

- `--log 2` stays console-only.
- `--log 3` writes a structured JSONL trace that can be inspected later.
- Coverage is the entire runtime, not only the memory subsystem.
- Level 3 stores full operational payloads, not truncated previews.
- The new memory flow introduced around the last two commits must be easy to isolate in the trace.
- Runtime telemetry must stay separate from domain memory exports and domain memory history.

## Non-goals

- Do not change the meaning of L0, L1, L2, L3, task canvases, offload refs, or autonomous jobs.
- Do not replace the existing memory event persistence in `src/memory/events/service.ts` with the new trace format.
- Do not merge runtime telemetry into `history/*.jsonl`, L1 evidence JSONL, or offload refs.
- Do not add a remote logging backend, dashboard, or streaming observability service.
- Do not remove full operational payloads at level 3 except for secret redaction.
- Do not redesign grammY internals; trace only application-controlled runtime behavior.

## Current baseline (2026-05-19)

The repository currently has ad hoc runtime logging through direct `console.log` and `console.error` calls:

- `src/index.ts:17-23` handles only `--migrate-only` and logs runtime config directly.
- `src/index.ts:81-95` logs shutdown, startup, and fatal errors directly.
- `src/agent/react-agent.ts:60-62` logs agent lifecycle events with `[agent:*]` console prefixes.
- `src/bot/bot.ts:30-32` logs Telegram events with `[telegram:*]` console prefixes.
- `src/cron/scheduler.ts:18-20` logs scheduler events with `[cron:*]` console prefixes.
- `src/cron/autonomous.ts:68-104` logs autonomous and memory-update events with direct console calls.

The repository already persists domain memory artifacts, but those paths are not operational telemetry sinks:

- `src/memory/events/service.ts:30-213` writes interaction events and optional JSONL exports for memory-related conversation history.
- `src/memory/offload/service.ts:228-246` writes L1 evidence JSONL when memory JSONL export is enabled.
- `src/memory/integration/factory.ts:102-160` wires the memory subsystem and is the cleanest injection point for tracing dependencies.
- `src/memory/pipeline/coordinator.ts:41-138` emits memory-progress callbacks but still relies on callers for console reporting.

The last two commits increase the need for richer runtime tracing around the newer memory stack:

- `339ad4a fix agent tool-call double`
- `a3d81e4 feat: add sqlite IMemoryStore migration`

`git diff --stat HEAD~2..HEAD` shows large changes in:

- `src/agent/react-agent.ts`
- `src/memory/backends/sqlite/store.ts`
- `src/memory/core/service.ts`
- `src/memory/pipeline/coordinator.ts`
- `src/memory/recall/service.ts`
- `src/memory/offload/service.ts`

That commit window should influence tagging and trace coverage, but it should not reduce the overall runtime scope.

## Chosen approach

Use a dedicated event-bus-style runtime telemetry layer.

This is heavier than simply wrapping existing `console.log` calls, but it is the right fit for the approved requirements:

- full-runtime coverage
- full operational payloads at level 3
- file-based JSONL tracing
- strong filtering for the newer memory stack
- clear separation between runtime telemetry and domain memory persistence

The design should avoid a global singleton. The runtime should create one `TraceBus` during startup and inject it into the subsystems that need to emit events.

## Architecture

The runtime logging stack should look like this:

```text
process.argv
  -> parse --log
  -> create TraceBus(runId, level)
  -> attach sinks
       - ConsoleSink(level 1/2/3)
       - JsonlSink(level 3 only)
  -> inject TraceBus into runtime services
       - app startup/shutdown
       - Telegram bot
       - agent loop
       - tool registry/tool execution boundary
       - scheduler/autonomous flows
       - memory service / recall / offload / pipeline
```

The bus should be the only place that knows:

- the selected log level
- the current `runId`
- sink fanout behavior
- redaction rules
- how sink failures are isolated

Application code should emit structured events and stop deciding on its own whether to print to console or write files.

## Event model

Each trace event should be represented as one structured envelope. A minimal shape is:

```ts
type RuntimeTraceEvent = {
  ts: string;
  seq: number;
  runId: string;
  pid: number;
  minLevel: 1 | 2 | 3;
  source: "app" | "bot" | "agent" | "tool" | "scheduler" | "autonomous" | "memory";
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
  error?: {
    message: string;
    name?: string;
    stack?: string;
  };
};
```

### Level semantics

- `minLevel = 1`: high-signal lifecycle, warnings, errors, and major transitions
- `minLevel = 2`: normal operational flow
- `minLevel = 3`: deep diagnostic detail only needed in full tracing mode

### Commit-window tracking tags

To satisfy the request to track the newer memory flow adopted in the last two commits, events from the newer stack should carry a stable tag such as:

- `new-memory-stack`

Use that tag for events emitted from or directly about:

- `src/agent/react-agent.ts`
- `src/memory/core/service.ts`
- `src/memory/integration/factory.ts`
- `src/memory/pipeline/coordinator.ts`
- `src/memory/offload/service.ts`
- `src/memory/recall/service.ts`
- `src/memory/backends/sqlite/store.ts` and related store files when instrumented

This keeps the full-runtime trace broad while making the recently adopted memory path easy to filter later.

## CLI behavior

Add a dedicated CLI parser for logging with these rules:

- accept `--log 1`
- accept `--log=1`
- support values `1`, `2`, and `3` only
- reject duplicates like `--log 2 --log 3`
- reject invalid values with a clear startup error
- preserve existing `--migrate-only` behavior

The logging flag should be parsed before `initDb()` so the runtime can emit trace events from the earliest startup steps.

If `--log` is omitted, preserve the current default console behavior as closely as possible and do not create a runtime JSONL trace file. The design does not require a new environment variable for logging.

## Sinks

### Console sink

The console sink is the operator-facing surface.

It should:

- print concise, human-readable lines
- include the source and event name
- include stable IDs when relevant (`chatId`, `userId`, `jobId`, `toolCallId`)
- include compact summaries rather than dumping full JSON for every event

At level 3, the console should still stay readable. The full payload belongs in JSONL. Console output can show key fields and short summaries while the JSONL sink retains the complete structured payload.

### JSONL sink

The JSONL sink is enabled only for `--log 3`.

It should:

- append exactly one JSON object per line
- persist the full structured event envelope after redaction
- use append-only writes
- avoid batching in the first version

#### File location

Write runtime traces under:

- `data/logs/`

More precisely, derive the directory from `config.storage.dataDir`:

- `${config.storage.dataDir}/logs`

This keeps runtime trace storage separate from:

- `config.storage.historyDir`
- `config.storage.memoryJsonlExportDir`
- offloaded refs and task-canvas files

#### File naming

Use a Windows-safe filename format such as:

- `runtime-20260519T143205Z-p1234.jsonl`

The filename should include the start timestamp and process ID so each run creates a separate trace file.

## Redaction

Level 3 is full operational tracing, but it must still protect secrets.

Redact before sending the event to any sink. The redactor should recursively handle common secret-bearing keys and values such as:

- `token`
- `apiKey`
- `api_key`
- `authorization`
- `secret`
- bearer tokens
- OpenAI-style and Anthropic-style API key strings

Examples:

- `BOT_TOKEN`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- raw `Authorization` headers

Do not redact normal runtime content such as:

- user prompts
- memory recall snapshots
- tool arguments/results
- stage progress payloads
- offload summaries and refs

unless those payloads themselves contain values that match the secret redaction rules.

## Runtime coverage

Trace the full application-controlled runtime.

### App startup and shutdown

Emit events for:

- CLI parse start/complete
- selected log level
- trace file path resolved
- DB init start/complete
- memory service creation start/complete
- tool registration complete
- scheduler start
- bot start
- graceful shutdown start/complete
- fatal top-level error

Primary provenance:

- `src/index.ts:14-97`
- `src/config.ts:176-224`

### Telegram bot

Emit events for application-level Telegram behavior:

- command handlers entered
- callback handlers entered
- text message received
- answer generation started/completed
- outbound message send attempt/completion/failure
- bot catch handler errors

This should cover the behavior implemented in `src/bot/bot.ts:126-278` and memory-update runner flows triggered from the bot. It does not need to trace grammY internals that the application does not control.

Primary provenance:

- `src/bot/bot.ts:126-278`
- `src/bot/conversations/memory-update-runner.ts`

### Agent loop

Emit events for:

- agent run start
- user message persisted
- L1.5 task judgment complete
- recent context/recall loaded
- system prompt + memory context assembly stats
- each LLM iteration start
- each LLM response received
- tool call start
- tool call persisted
- registry execution start/complete
- offload decision made
- tool result persisted
- final answer persisted
- max-iteration fallback

At level 3, include full operational payloads for:

- input text
- recall snapshot
- tool args
- tool results
- offload metadata
- answer content

Primary provenance:

- `src/agent/react-agent.ts:87-278`
- `src/tools/registry.ts:46-54`
- `src/tools/local.ts:50-260`

### Scheduler and autonomous flows

Emit events for:

- scheduler tick start/complete
- scheduler skip because busy
- due job counts
- due memory-update counts
- autonomous job start/complete/error
- hybrid message send attempt/result
- autonomous answer send attempt/result
- memory-update run start/complete/error when scheduled

Primary provenance:

- `src/cron/scheduler.ts:22-90`
- `src/cron/autonomous.ts:140-220`

### Memory services and pipeline

Emit events for:

- memory service creation and store initialization
- recall start/complete with counts
- interaction event writes
- offload decisions and fallback behavior
- task-graph node writes
- L1 evidence persistence
- pipeline `run`, `l1`, `l2`, and `l3` stage start/complete/skip/error
- checkpoint updates
- created atom counts
- scenario ID selection
- persona update result

These events should be particularly rich and tagged `new-memory-stack`.

Primary provenance:

- `src/memory/integration/factory.ts:102-160`
- `src/memory/core/service.ts:180-247`
- `src/memory/pipeline/coordinator.ts:41-138`
- `src/memory/events/service.ts:30-213`
- `src/memory/offload/service.ts:68-246`

## Component and file layout

### New files

#### `src/logging/cli.ts`

Parse `process.argv` for `--log` and return a small typed result:

- log level
- normalized raw argument form
- validation error text when invalid

#### `src/logging/types.ts`

Define:

- `RuntimeLogLevel`
- `RuntimeTraceEvent`
- `TraceSink`
- helper types for sink input and trace context

#### `src/logging/trace-bus.ts`

Implement the central bus.

Responsibilities:

- assign `seq`
- stamp `ts`, `runId`, and `pid`
- skip events below the active level
- redact payloads
- fan out to sinks
- isolate sink failures

#### `src/logging/console-sink.ts`

Format concise console output.

Responsibilities:

- human-readable line formatting
- stable event prefix rendering
- compact summaries for `payload`
- error formatting

#### `src/logging/jsonl-sink.ts`

Persist JSONL trace files.

Responsibilities:

- create the logs directory
- append one redacted JSON event per line
- expose the active trace file path for startup reporting

#### `src/logging/redaction.ts`

Provide recursive redaction helpers used by all sinks.

#### `src/logging/helpers.ts`

Provide narrow convenience helpers for common source categories so call sites stay readable without adding a large abstraction.

### Existing files to modify

#### `src/index.ts`

- parse `--log` before `initDb()`
- create the bus and sinks
- emit startup and shutdown events
- pass tracing into the bot, agent-related dependencies, scheduler, and memory service

#### `src/bot/bot.ts`

- replace `logTelegramEvent()` direct console calls with trace emits
- add outbound send attempt/result events around application-owned `presentScreen()`, `ctx.reply`, `ctx.api.sendMessage`, and chunked response sends
- emit bot error events from `bot.catch`

#### `src/agent/react-agent.ts`

- replace `logAgentEvent()` with structured emits
- carry `new-memory-stack` tagging for recall/offload/tool-result events that belong to the new memory-aware agent flow

#### `src/tools/registry.ts`

- emit registry-level execution boundary events so tool execution failures are traceable even when a tool returns a failure string

#### `src/cron/scheduler.ts`

- replace direct cron logging with scheduler trace events
- emit tick start/complete summary and busy skips

#### `src/cron/autonomous.ts`

- replace direct cron and memory-update console logging with trace events
- include job IDs, schedule info, send results, and memory-update stage summaries

#### `src/memory/integration/factory.ts`

- pass trace dependencies into `MemoryService`, `InteractionLogService`, `OffloadService`, and `PipelineCoordinator`
- emit initialization events for the store and backend

#### `src/memory/core/service.ts`

- emit recall lifecycle, persistence lifecycle, and maintenance lifecycle events

#### `src/memory/events/service.ts`

- emit interaction-persistence events while keeping current database/history/export writes unchanged

#### `src/memory/offload/service.ts`

- emit offload branch decisions, ref write attempts, fallback behavior, and JSONL evidence persistence events

#### `src/memory/pipeline/coordinator.ts`

- emit stage-level events directly instead of relying only on higher-level console reporters
- keep the current progress callback contract compatible so Telegram and scheduler code can still react to stage progress

## Data-flow details

The runtime flow should be:

1. Parse `process.argv`.
2. Resolve the active log level.
3. Create a per-process `runId`.
4. If level 3 is active, resolve the JSONL path and create the JSONL sink.
5. Create the `TraceBus`.
6. Initialize DB and services.
7. Pass the bus to runtime components.
8. Emit structured events throughout runtime execution.
9. On shutdown or fatal error, emit final events and flush best-effort writes.

The bus should be passed explicitly through constructor/dependency objects rather than imported as a hidden global.

## Failure handling

Tracing must never break the runtime.

Rules:

- a sink exception must not crash the bus
- a JSONL write failure must not crash the app
- if a sink fails repeatedly, the runtime can keep emitting to other sinks
- console fallback for sink failure should be concise and avoid recursive logging loops
- invalid `--log` values should fail fast before startup continues

If the JSONL sink cannot be created at level 3, startup should fail clearly. The user explicitly requested full operational trace mode, so silently downgrading to console-only would hide a misconfiguration.

## Performance

- level 1 should remain lightweight
- level 2 should remain operationally useful without excessive payload printing
- level 3 is intentionally heavier and should prioritize trace completeness over minimizing output volume
- JSONL writes should be append-only and simple in the first version
- no batching or secondary indexing is required in the first version

The main readability optimization should happen in the console sink, not by dropping data from the JSONL trace.

## Testing

Add focused tests in three groups.

### 1. CLI parsing

Add tests such as:

- accepts `--log 1`
- accepts `--log=2`
- accepts `--log 3`
- rejects invalid values
- rejects duplicates
- keeps `--migrate-only` compatible

Suggested file:

- `tests/logging/cli.test.ts`

### 2. Trace bus and sinks

Add tests for:

- event filtering by level
- `seq` assignment
- JSONL writes one valid JSON object per line
- sink failures do not crash emission
- secret redaction works on nested payloads
- level 3 file path is created under `data/logs`

Suggested files:

- `tests/logging/trace-bus.test.ts`
- `tests/logging/jsonl-sink.test.ts`
- `tests/logging/redaction.test.ts`

### 3. Runtime integration

Add or update tests for:

- agent run emits expected lifecycle events
- scheduler tick emits start/complete or busy-skip events
- memory pipeline emits `run`, `l1`, `l2`, and `l3` events
- offload path emits offloaded vs inline result decisions
- `--log 3` startup creates a trace file

Likely touchpoints:

- `tests/memory/agent-runtime.test.ts`
- `tests/cron/scheduler.test.ts`
- targeted new tests around memory pipeline and offload tracing behavior

Manual verification should also include one real app run with `--log 3` to confirm:

- console flow is readable
- `data/logs/runtime-*.jsonl` is created
- the JSONL file contains full payload events
- filtering by `tags` can isolate `new-memory-stack` events

## Acceptance criteria

- Running the app with `--log 1`, `--log 2`, or `--log 3` behaves deterministically and rejects invalid values.
- `--log 2` shows operational console flow across the full runtime.
- `--log 3` creates a runtime JSONL trace file under `data/logs/`.
- Level 3 JSONL contains full operational payloads after secret redaction.
- Runtime telemetry stays separate from memory history JSONL, L1 evidence JSONL, and offload refs.
- The newer memory stack can be filtered easily through a stable tag such as `new-memory-stack`.
- Bot, agent, scheduler, autonomous, and memory pipeline flows all emit structured events.
- Sink failures do not crash the application.
- Tests and typecheck pass.

## Source provenance

This design is based on the current repository state and the observed runtime seams in:

- `src/index.ts:14-97`
- `src/config.ts:176-224`
- `src/bot/bot.ts:126-278`
- `src/agent/react-agent.ts:87-278`
- `src/tools/registry.ts:46-54`
- `src/tools/local.ts:50-260`
- `src/cron/scheduler.ts:22-90`
- `src/cron/autonomous.ts:140-220`
- `src/memory/integration/factory.ts:102-160`
- `src/memory/core/service.ts:180-247`
- `src/memory/events/service.ts:30-213`
- `src/memory/offload/service.ts:68-246`
- `src/memory/pipeline/coordinator.ts:41-138`

It is also motivated by the recent memory-stack expansion in commits:

- `339ad4a fix agent tool-call double`
- `a3d81e4 feat: add sqlite IMemoryStore migration`
