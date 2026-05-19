# L1.5 Reminder Follow-up Routing Design

## Goal

Make reminder jobs capable of waiting for the user's reply, then route that reply back through normal chat mode with enough L1.5 context for the agent to ask a brief follow-up such as whether the user wants another reminder later.

This design keeps scheduled reminder delivery inside the existing autonomous jobs system, but moves reply-aware follow-up logic into the normal chat pipeline where L1.5 already judges the user's latest turn.

## Provenance

- Chat agent entry and L1.5 call site: `src/agent/react-agent.ts` logs the user message, calls `memory.judgeTaskTurn(...)`, then performs memory recall and the tool loop.
- Current L1.5 lifecycle: `src/memory/core/service.ts` loads recent user/assistant turns, active task canvas, historical task canvases, runs `runL15Judgment(...)`, persists the judgment, and returns only task-routing data.
- Current L1.5 contract: `src/memory/offload/l15.ts` and `src/memory/offload/types.ts` only classify `taskCompleted`, `isLongTask`, and `isContinuation`.
- Current hybrid reminder execution: `src/cron/autonomous.ts` always sends `messageText`, then immediately runs the hybrid `agentPrompt`, and sends the autonomous answer right away.
- Current job model and tool contract: `src/services/autonomous-jobs.ts` and `src/tools/local.ts` persist hybrid jobs with `messageText` and `agentPrompt`, but do not distinguish immediate follow-up from reply-deferred follow-up.
- Current scheduling gate in chat mode: `src/agent/react-agent.ts` exposes `tdai_create_job` when the latest user message contains reminder/scheduling language.
- Existing tests that show current behavior boundaries: `tests/memory/agent-runtime.test.ts`, `tests/memory/l15.test.ts`, `tests/cron/autonomous-helpers.test.ts`, `tests/services/autonomous-jobs.test.ts`, and `tests/memory/tools.test.ts`.

## Current Flow

### 1. Reminder creation in chat mode

1. The user asks for a reminder.
2. `runReactAgent(...)` decides whether to expose `tdai_create_job` based on the latest message.
3. If the model calls `tdai_create_job`, `src/tools/local.ts` creates a hybrid `autonomous_jobs` row with:
   - `message_text`
   - `agent_prompt`
   - schedule fields
   - `max_runs`
4. The bot sends only the final assistant answer from the chat loop. Tool results stay internal to the loop.

### 2. Reminder delivery at due time

When the scheduler runs a due hybrid job in `src/cron/autonomous.ts`:

1. Send `messageText` to Telegram.
2. Immediately run the agent with `agentPrompt` in autonomous mode.
3. Immediately send the autonomous agent answer back to Telegram.
4. Mark the run successful and increment `run_count`.

### 3. What L1.5 sees on the next user turn

On the next incoming chat message, L1.5 currently sees only:

- recent `user` and `assistant` turns from chat history
- the active task canvas, if any
- historical task canvases

L1.5 does **not** currently receive:

- a pending reminder-reply state
- the reminder text that was just sent
- the deferred follow-up instruction that should run only after the user replies

## Problem Statement

The current hybrid reminder contract assumes `agentPrompt` should run immediately at due time. That breaks prompts whose intent is explicitly reply-driven, such as:

- “Jika Terry membalas, tanyakan apakah sudah makan atau perlu diingatkan lagi nanti.”

With the current design:

1. The prompt runs before Terry replies.
2. No durable “waiting for reminder reply” state is stored.
3. L1.5 cannot tell that the next short user message (`sudah`, `belum`, `nanti`, `ingatkan lagi 10 menit`) is a reply to a reminder.
4. The normal chat loop treats that message as a generic short chat turn.

This is not a small bug inside the current L1.5 rules. It is a missing data flow between autonomous reminder delivery and the next chat-mode turn.

## Desired Behavior

For reply-aware reminders, the system should support this sequence:

1. User creates a reminder job from chat.
2. At due time, Telegram receives the fixed reminder text.
3. The system stores a pending reminder follow-up instruction instead of immediately running it.
4. The user replies.
5. L1.5 sees that there is an active pending reminder follow-up and judges whether the latest message looks like a reply to it.
6. If it matches, the normal chat agent receives a short system instruction such as:
   - reminder text
   - deferred follow-up prompt
   - keep the reply brief
   - if the user already asked for a new reminder with a concrete time, schedule it instead of asking again
7. After the matched turn is answered, the pending reminder follow-up is consumed.

### Example

Requested job intent:

- `message_text`: `Terry, ini pengingat untuk makan sekarang.`
- deferred follow-up prompt: `Jika Terry membalas, tanyakan singkat apakah sudah makan atau perlu diingatkan lagi nanti.`

Expected runtime sequence:

1. Scheduler sends `Terry, ini pengingat untuk makan sekarang.`
2. No autonomous follow-up message is sent yet.
3. Terry replies `belum nih`.
4. L1.5 matches that reply to the pending reminder context.
5. Chat-mode agent answers briefly, for example: `Oke, mau saya ingatkan lagi nanti?`
6. If Terry then says `iya, 15 menit lagi`, the normal scheduling gate exposes `tdai_create_job`, and the model schedules the next reminder.

## Architecture

### 1. Add a reply-deferred follow-up mode to hybrid jobs

Extend hybrid jobs with a new field:

- `follow_up_mode`: `"immediate" | "after_user_reply"`

Behavior:

- `immediate` keeps the current behavior.
- `after_user_reply` means:
  - send `messageText` when due
  - do **not** run the agent immediately
  - persist a pending reminder follow-up record containing the deferred follow-up prompt

This keeps backward compatibility for existing hybrid jobs while allowing reply-aware reminder flows.

### 2. Persist pending reminder follow-ups in the memory layer

Add a new memory table for pending reminder reply routing, for example `memory_reminder_followups`.

Recommended fields:

- `id`
- `job_id`
- `chat_id`
- `user_id`
- `reminder_text`
- `follow_up_prompt`
- `status` (`active`, `consumed`)
- `expires_at`
- `consumed_at`
- `created_at`

Why memory layer instead of autonomous job service:

- L1.5 already runs inside `MemoryService.judgeTaskTurn(...)`.
- The next user turn is judged from the memory side, not from the autonomous job service.
- Storing pending reminder follow-ups in memory keeps the read path local to L1.5.

### 3. Extend the L1.5 input/output contract

Add optional reminder context to L1.5 input:

- a compact summary of the active pending reminder follow-up
  - follow-up id
  - job id
  - reminder text

Add one boolean to the L1.5 judgment result:

- `matchesPendingReminderReply`

Task-routing semantics stay the same:

- reminder replies are still short turns unless the normal long-task rules match for another reason
- task canvas routing remains independent from reminder follow-up routing

### 4. Keep reminder-reply matching intentionally small

The goal is not to solve general conversational intent classification. The first version should match only cases that are common and low-risk when a pending reminder exists:

- short acknowledgements such as `ya`, `oke`, `siap`
- status replies such as `sudah`, `udah`, `belum`, `nanti`, `ntar`
- direct re-schedule requests that already contain reminder language or time language such as `ingatkan lagi 10 menit`

If L1.5 is uncertain, it should return `matchesPendingReminderReply = false` and leave the pending reminder active until it expires.

### 5. Inject reminder follow-up context into the normal chat agent

When `judgeTaskTurn(...)` returns a matched pending reminder follow-up:

- `runReactAgent(...)` should prepend an additional system message before the normal tool loop.
- That system message should include:
  - the reminder text
  - the deferred follow-up prompt
  - guidance to keep the reply brief
  - guidance to schedule immediately if the user already asked for another reminder with a concrete time

This keeps the final response in the normal chat loop, where tool access, memory recall, and language behavior already exist.

### 6. Consume pending reminder follow-ups only after a matched reply is answered

Consumption rule:

- if L1.5 did not match, leave the pending reminder follow-up active
- if L1.5 matched and the assistant produced a normal final answer, mark the reminder follow-up as consumed

This avoids dropping context for an unrelated user message while preventing the same reminder reply instruction from firing repeatedly.

## Component Changes

- `src/db/schema.ts`
  - add `autonomous_jobs.follow_up_mode`
- `src/services/autonomous-jobs.ts`
  - persist and expose `followUpMode`
- `src/cron/autonomous.ts`
  - branch hybrid execution by `followUpMode`
  - register pending reminder follow-ups for `after_user_reply`
- `src/memory/backends/sqlite/migrate.ts`
  - create `memory_reminder_followups`
- `src/memory/backends/sqlite/backend.ts`
  - CRUD methods for active/consumed reminder follow-ups
- `src/memory/core/backend.ts`
  - backend interface additions
- `src/memory/core/types.ts`
  - reminder follow-up record types and `JudgeTaskTurnResult` extension
- `src/memory/core/service.ts`
  - load pending reminder follow-up during `judgeTaskTurn(...)`
  - return matched reminder context
- `src/memory/offload/types.ts`
  - L1.5 input/output extension
- `src/memory/offload/l15.ts`
  - rules and LLM prompt support for `matchesPendingReminderReply`
- `src/agent/react-agent.ts`
  - inject matched reminder follow-up system context
  - consume matched follow-up after final assistant answer
- `src/tools/local.ts`
  - expose `follow_up_mode` on `tdai_create_job`
- `src/agent/prompts/system.ts`
  - document when to use `follow_up_mode = "after_user_reply"`

## Testing

Add or update tests for:

- backend create/read/consume of pending reminder follow-ups
- autonomous job persistence of `follow_up_mode`
- due-job behavior for `follow_up_mode = "after_user_reply"`
  - fixed reminder text is sent
  - no immediate autonomous answer is sent
  - pending reminder follow-up is recorded
  - run count still advances normally
- L1.5 rules matching a pending reminder reply
- L1.5 not matching an unrelated message despite a pending reminder existing
- `runReactAgent(...)` injecting reminder follow-up context on a matched reply
- `runReactAgent(...)` consuming the matched pending reminder follow-up after answering
- `tdai_create_job` accepting `follow_up_mode`
- system prompt mentioning reply-deferred reminder follow-up mode

## Out of Scope

- Changing the user-visible confirmation text after `tdai_create_job` succeeds.
- Reworking the Jobs menu UX.
- Supporting multiple simultaneous pending reminder follow-ups in one chat beyond “latest active row wins”.
- Building a general reminder analytics/reporting system.
- Turning L1.5 into a full conversational planner; it remains a narrow routing/judgment layer.
