# LLM call count runtime logging design

**Date:** 2026-05-20  
**Status:** Approved in conversation, written for user review  
**Target project:** `D:\Code\Test\yunus\grammy`

## Goal

Add reliable end-to-end LLM call counting per top-level runtime operation so operators can immediately see how many provider round-trips were triggered while the server handled one request or job.

The first target is count visibility, not token accounting. The new logging must make it easy to answer questions like:

- one inbound Telegram message caused how many LLM calls?
- one autonomous job caused how many LLM calls?
- one memory-update run caused how many LLM calls?
- did those calls come only from the agent loop, or also from routing / memory / offload paths?

The count must be visible both:

- live in normal runtime console output
- in structured level-3 JSONL trace output for later inspection

## Requested behavior

The approved behavior from the design discussion is:

- The first new signal is the **total LLM call count** per top-level request or job.
- The count should include **every** `llm.complete(...)` round-trip triggered while handling that request or job, not only the main agent loop.
- Console output should show a concise summary that is easy to read while the server is running.
- Level-3 JSONL should also include the summary in structured form.
- The implementation should preserve room for deeper per-call diagnostics, but total count is the primary requirement for this change.

## Non-goals

- Do not add token counting, pricing, or cost estimation in this change.
- Do not log raw prompt bodies or raw model output bodies as the primary new behavior.
- Do not add a remote observability backend, metrics exporter, or dashboard.
- Do not merge runtime telemetry into `data/history/*.jsonl`, L1 evidence JSONL, or offload refs.
- Do not count unrelated background work under the wrong parent request. Each top-level job or request should own only its own LLM-call total.
- Do not redesign the existing runtime trace bus or log levels beyond the fields needed to correlate LLM events back to one request.

## Provenance

This design extends the runtime-logging architecture already introduced in:

- `docs/superpowers/specs/2026-05-19-full-operational-runtime-logging-design.md`
- `docs/superpowers/plans/2026-05-19-full-operational-runtime-logging.md`

The design is grounded in the current runtime code at these locations:

### Existing logging envelope and sinks

- `src/logging/types.ts:8-45` — current trace envelope fields and sink interfaces.
- `src/logging/trace-bus.ts:9-33` — event emission, sequencing, and payload redaction.
- `src/logging/console-sink.ts:4-20` — concise operator-facing console formatting.
- `src/logging/jsonl-sink.ts:24-35` — level-3 JSONL persistence.
- `src/logging/setup.ts:29-55` — runtime logger setup and `--log 1|2|3` behavior.

### Provider boundary and LLM abstraction

- `src/agent/types.ts:23-36` — `LlmCompleteRequest`, `LlmCompleteResponse`, and `LlmProvider`.
- `src/agent/providers/index.ts:6-20` — single provider-construction boundary.
- `src/agent/providers/anthropic.ts:56-69` — Anthropic API call boundary.
- `src/agent/providers/openai.ts:44-58` — OpenAI API call boundary.

### Top-level runtime entry points that should own totals

- `src/bot/bot.ts:258-293` — inbound Telegram text message handling.
- `src/cron/autonomous.ts:144-210` — autonomous job execution.
- `src/cron/autonomous.ts:213-260` — memory-update execution.

### Request-scoped LLM call sites that must be included in totals

- `src/agent/react-agent.ts:175-214` — main agent loop.
- `src/memory/core/service.ts:538-603` — request-time L15 orchestration that leads into the direct LLM boundary in `src/memory/offload/l15.ts:107-123`.
- `src/memory/offload/l15.ts:107-123` — L15 LLM routing judgment.
- `src/memory/pipeline/l1.ts:121-139` — L1 extraction pipeline.
- `src/memory/pipeline/l2.ts:36-54` — L2 scenario synthesis.
- `src/memory/pipeline/l3.ts:27-41` — L3 persona synthesis.
- `src/memory/offload/l1.ts:54-77` — L1 evidence summarization.
- `src/memory/offload/l2.ts:99-121` — L2 Mermaid patch generation.
- `src/memory/offload/l4.ts:95-100` — L4 skill generation.

## Current baseline

The runtime logger already provides a good transport for this feature:

- `src/logging/trace-bus.ts:9-33` can fan out structured events to console and JSONL.
- `src/logging/console-sink.ts:17-20` already prints any structured event.
- `src/logging/jsonl-sink.ts:31-33` already writes full structured events to disk.

What is missing is not sink capability. The missing piece is **LLM-specific emission at the provider boundary**.

Today, the runtime can show surrounding flow such as:

- app startup and shutdown
- agent iteration start / response received
- tool execution boundaries
- scheduler and autonomous job boundaries
- memory recall / offload / pipeline events

But it cannot directly answer how many provider round-trips happened, because the actual SDK calls are made here with no dedicated trace boundary:

- `src/agent/providers/anthropic.ts:56-69`
- `src/agent/providers/openai.ts:44-58`

This produces a blind spot. For example, one inbound Telegram message can trigger:

- one L15 judgment call
- multiple main agent calls
- one or more offload summarization calls
- one or more L1/L2/L3 maintenance calls in other paths

and the current logs show pieces of the surrounding control flow without a trustworthy end-to-end LLM call total.

## Chosen approach

Use a **request-scoped async counting context** plus a **traced provider wrapper** around the existing `LlmProvider`.

This is the recommended approach because it solves the counting problem at the narrowest reliable boundary:

- every real provider round-trip already passes through `LlmProvider.complete(...)`
- the concrete providers are built in one place in `src/agent/providers/index.ts:6-20`
- top-level runtime operations are easy to identify in `src/bot/bot.ts:258-293` and `src/cron/autonomous.ts:144-260`

This is better than counting only inside `runReactAgent(...)` because `runReactAgent` is not the only request-time caller. It would undercount memory and offload flows.

This is also better than teaching the console or JSONL sinks how to infer LLM calls, because sinks only see emitted events; they do not see uninstrumented provider round-trips.

## Architecture

The new counting flow should look like this:

```text
Top-level request/job starts
  -> open async LLM request context
       requestId
       requestType
       chatId/userId/jobId
       llmCallCount = 0
       byOrigin = {}
  -> nested code calls llm.complete(...)
       traced provider wrapper intercepts call
       increments llmCallCount
       increments byOrigin[origin]
       emits llm.call.complete or llm.call.error
  -> top-level request/job finishes
       emit llm.request.summary
       close context
```

### Why async request context is needed

The total must include nested calls several layers below the request entry point. Those calls cross multiple function boundaries and service layers:

- bot handler -> `runReactAgent(...)`
- `runReactAgent(...)` -> memory judgment / recall / tools / offload
- memory services -> `llm.complete(...)`

Passing a mutable counter through every function signature would create broad API churn for a logging-only concern. A request-scoped async context keeps the implementation local to tracing while still covering nested async work.

### Proposed mechanism

Use Node `AsyncLocalStorage` in a new helper module at:

- `src/logging/llm-request-context.ts`

The helper should expose a small API such as:

- `runWithLlmRequestContext(context, fn)`
- `getCurrentLlmRequestContext()`
- `recordLlmCall(...)`
- `emitLlmRequestSummary(...)`

## Request ownership model

The LLM total belongs to the **top-level runtime operation**, not to an arbitrary lower-level component.

### Request types to support now

1. `telegram_message`
   - owned by the handler in `src/bot/bot.ts:258-293`
   - covers one inbound non-command Telegram message and all LLM work triggered while answering it

2. `autonomous_job`
   - owned by `src/cron/autonomous.ts:144-210`
   - covers one autonomous job run and all LLM work triggered during that run

3. `memory_update`
   - owned by `src/cron/autonomous.ts:213-260`
   - covers one memory maintenance run and all LLM work triggered during that run

### Important boundary rule

The Telegram button flow that starts a memory update should **not** own the memory-update count itself. The actual LLM work belongs to the `memory_update` operation inside `runOneMemoryUpdateNow(...)`, not the short callback handler that triggered it.

## Event model changes

### Extend the trace envelope

Add these optional fields to `RuntimeTraceInput` / `RuntimeTraceEvent` in `src/logging/types.ts:8-30`:

- `requestId?: string`
- `requestType?: "telegram_message" | "autonomous_job" | "memory_update" | "unscoped"`

These fields let every per-call event and summary event be correlated back to one top-level operation in both console and JSONL.

### Add `llm` as a trace source

Add `source: "llm"` as a newly emitted runtime source value.

This change must not narrow or exclude any existing source values already emitted elsewhere in the repo, including non-core values such as `telegram` or `local`. Keep current source handling backward-compatible and simply add `llm` events on top.

### New LLM event names

Use these new events:

- `source: "llm", event: "call.complete"`
- `source: "llm", event: "call.error"`
- `source: "llm", event: "request.summary"`

`call.complete` and `call.error` are per-provider-round-trip events.

`request.summary` is the operator-facing total for the whole request or job.

## Request context shape

The async context should hold at least:

```ts
type LlmRequestContext = {
  requestId: string;
  requestType: "telegram_message" | "autonomous_job" | "memory_update";
  chatId?: string;
  userId?: string;
  jobId?: string;
  startedAtMs: number;
  llmCallCount: number;
  byOrigin: Record<string, number>;
};
```

### Why keep `byOrigin`

The user asked for total count first, so `llmCallCount` is the primary surfaced signal.

Still, keeping `byOrigin` in the request context is valuable because it gives level-3 JSONL immediate diagnostic usefulness without changing the main console experience. It will make it easy to answer follow-up questions like:

- were the extra calls from L15?
- were they from offload summarization?
- did the agent loop itself call twice, or did memory create the extra traffic?

## Provider wrapper design

### Where the wrapper lives

Add a traced wrapper around the existing provider in:

- `src/agent/providers/traced.ts`

`src/agent/providers/index.ts:6-20` should become the single assembly point:

- construct the real provider (`AnthropicProvider` or `OpenAiProvider`)
- wrap it in `TracedLlmProvider`
- return the wrapped instance

### Wrapper responsibilities

For every `complete(request)` call:

1. read the current request context, if present
2. increment `llmCallCount` before awaiting the real provider call
3. increment the correct `byOrigin` bucket
4. measure elapsed time
5. emit `llm.call.complete` on success
6. emit `llm.call.error` on error
7. preserve the original return value or throw behavior

### Failure counting rule

A failed provider attempt still counts as one LLM call.

That means the wrapper must increment the count **before** awaiting the delegated provider call. Otherwise failed attempts would disappear from totals.

## Call-site metadata for origin attribution

### Extend the LLM request type

Add optional metadata to `LlmCompleteRequest` in `src/agent/types.ts:23-27`:

```ts
meta?: {
  origin?: string;
};
```

The wrapper will use `meta.origin` to fill `byOrigin` and per-call event payloads.

### Origins to annotate now

- `src/agent/react-agent.ts:185` -> `origin: "agent"`
- `src/memory/offload/l15.ts:114` -> `origin: "memory.l15"`
- `src/memory/pipeline/l1.ts:132` -> `origin: "memory.l1"`
- `src/memory/pipeline/l2.ts:47` -> `origin: "memory.l2"`
- `src/memory/pipeline/l3.ts:35` -> `origin: "memory.l3"`
- `src/memory/offload/l1.ts:55` -> `origin: "offload.l1"`
- `src/memory/offload/l2.ts:100` -> `origin: "offload.l2"`
- `src/memory/offload/l4.ts:96` -> `origin: "offload.l4"`

If a caller omits `meta.origin`, the wrapper should fall back to `origin: "unknown"`.

## Top-level context boundaries

### Telegram inbound message

Wrap the request body in `src/bot/bot.ts:258-293` with `runWithLlmRequestContext(...)`.

Context fields:

- `requestType: "telegram_message"`
- `requestId`: generated per inbound message
- `chatId`
- `userId`

The summary should be emitted in `finally` for the whole handler. Reply-send failures must not suppress the summary, and the total should still reflect only the LLM calls made while handling that message.

### Autonomous job

Wrap the request body in `src/cron/autonomous.ts:144-210`.

Context fields:

- `requestType: "autonomous_job"`
- `requestId`: generated per job run
- `chatId`
- `userId`
- `jobId`

The summary should be emitted in `finally`, so both success and failure runs show `llmCalls=N`.

### Memory update

Wrap the maintenance body in `src/cron/autonomous.ts:213-260`.

Context fields:

- `requestType: "memory_update"`
- `requestId`: generated per maintenance run
- `userId`

`chatId` is optional here because the maintenance API is keyed by user and may run from scheduler or Telegram-triggered paths.

## Per-call event payloads

The new per-call events should stay metadata-focused and lightweight.

### `llm.call.complete` payload

```ts
{
  provider: "anthropic" | "openai";
  model: string;
  origin: string;
  callIndex: number;
  durationMs: number;
  messageCount: number;
  toolCount: number;
  temperature?: number;
  responseToolCalls: number;
  responseContentLength: number;
}
```

### `llm.call.error` payload

```ts
{
  provider: "anthropic" | "openai";
  model: string;
  origin: string;
  callIndex: number;
  durationMs: number;
  messageCount: number;
  toolCount: number;
  temperature?: number;
}
```

The structured `error` field on the trace envelope should carry the exception details.

### Why not log raw prompts and raw responses here

The user asked for counting and request-level visibility first. Raw prompt/response logging would create much larger traces, raise privacy concerns, and make console output noisy. For this change, metadata and counts are enough.

## Summary event payload

Emit exactly one `llm.request.summary` event per top-level request or job.

Suggested payload:

```ts
{
  outcome: "success" | "error";
  durationMs: number;
  llmCallCount: number;
  byOrigin: Record<string, number>;
}
```

This event should also carry `requestId`, `requestType`, `chatId`, `userId`, and `jobId` on the top-level trace envelope when available.

## Console output behavior

`src/logging/console-sink.ts:4-20` should special-case `source: "llm", event: "request.summary"` so the count is easy to spot live.

Recommended console shape:

```text
[ts] #seq L1 llm.request.summary type=telegram_message chatId=... userId=... llmCalls=4 outcome=success
```

Equivalent examples:

- `llm.request.summary type=autonomous_job jobId=12 llmCalls=2 outcome=success`
- `llm.request.summary type=memory_update userId=123 llmCalls=3 outcome=error`

The console sink should stay concise. The detailed `byOrigin` map can remain in JSONL payloads.

## JSONL behavior

Level-3 JSONL should receive:

- every `llm.call.complete`
- every `llm.call.error`
- every `llm.request.summary`

This lets operators answer both:

- quick live question: how many calls did this request use?
- deeper audit question: which nested subsystem created those calls?

## Unscoped-call rule

If some future code path calls `llm.complete(...)` with no active request context, the wrapper should still emit per-call events.

In that case:

- use `requestType: "unscoped"`
- do not emit a synthetic request summary
- make the missing scope visible in JSONL rather than silently dropping the event

This prevents instrumentation gaps from becoming invisible.

## Exact file changes

### New files

- `src/logging/llm-request-context.ts` — async request context helpers and summary emission.
- `src/agent/providers/traced.ts` — traced provider wrapper.
- `tests/logging/llm-request-context.test.ts` — request-context accounting coverage.
- `tests/agent/traced-provider.test.ts` — success/error counting and event emission coverage.

### Existing files to modify

- `src/logging/types.ts` — add `requestId`, `requestType`, and `source: "llm"` support.
- `src/logging/console-sink.ts` — special-case `llm.request.summary` formatting.
- `src/agent/types.ts` — add optional `meta.origin` to `LlmCompleteRequest`.
- `src/agent/providers/index.ts` — assemble and return a traced provider.
- `src/index.ts:52-108` — pass `runtimeTrace` into provider creation.
- `src/bot/bot.ts:258-293` — open `telegram_message` request context.
- `src/cron/autonomous.ts:144-260` — open `autonomous_job` and `memory_update` request contexts.
- `src/agent/react-agent.ts:185` — annotate `llm.complete(...)` with `origin: "agent"`.
- `src/memory/offload/l15.ts:114` — annotate with `origin: "memory.l15"`.
- `src/memory/pipeline/l1.ts:132` — annotate with `origin: "memory.l1"`.
- `src/memory/pipeline/l2.ts:47` — annotate with `origin: "memory.l2"`.
- `src/memory/pipeline/l3.ts:35` — annotate with `origin: "memory.l3"`.
- `src/memory/offload/l1.ts:55` — annotate with `origin: "offload.l1"`.
- `src/memory/offload/l2.ts:100` — annotate with `origin: "offload.l2"`.
- `src/memory/offload/l4.ts:96` — annotate with `origin: "offload.l4"`.

## Testing strategy

### Unit tests

1. **Traced provider counts success calls**
   - wrapper increments `llmCallCount`
   - emits `llm.call.complete`
   - preserves response data

2. **Traced provider counts failed calls**
   - wrapper increments `llmCallCount` before awaiting delegate
   - emits `llm.call.error`
   - rethrows the original error

3. **Request summary emits in finally**
   - success path emits `llm.request.summary`
   - error path also emits `llm.request.summary`

4. **Unknown origin fallback**
   - omitted `meta.origin` goes to `unknown`

5. **Unscoped call behavior**
   - per-call event still emits
   - no request summary emits

### Integration-style tests

1. **Telegram message path**
   - one inbound message can produce multiple nested LLM calls
   - final summary shows the exact total

2. **Autonomous job path**
   - one job run emits its own independent summary

3. **Memory update path**
   - one maintenance run emits its own independent summary

4. **Console sink formatting**
   - `llm.request.summary` shows compact `llmCalls=N` output

## Rollout and compatibility

This change is additive:

- existing runtime log levels remain `1 | 2 | 3`
- existing sources and event names remain valid
- existing JSONL sink behavior remains valid
- existing agent and memory business logic remain unchanged apart from adding `meta.origin`

The only schema expansion is extra optional trace metadata plus a new `llm` source.

## Success criteria

The change is successful when all of the following are true:

1. One inbound Telegram message that triggers multiple nested LLM paths produces one final request-summary log with the correct total.
2. One autonomous job produces one final request-summary log with the correct total.
3. One memory update produces one final request-summary log with the correct total.
4. Failed LLM attempts still contribute to the total.
5. Level-3 JSONL makes it possible to inspect both the top-level total and the per-origin distribution.
6. Operators can answer the original question, "how many LLM calls did this request cause?", directly from runtime logs.
