# 2026-05-21 Verified Bug Audit

## Status

Verified against the current working tree on 2026-05-21.

Reviewed 14 previously documented bugs:
- 9 still appear open in the current tree
- 5 appear fixed in the current tree

Unless noted otherwise, the findings below are based on current control-flow inspection and targeted test evidence.

## Executive summary

The Phase 1 shared-chat trust-boundary issues are now fixed in the current tree:
- shared-chat Memory entrypoints are private-only,
- shared-chat autonomous job screens and detail flows are actor-scoped,
- active task-canvas recall is user-scoped in shared chats,
- `telegram_send_message` is constrained to the active chat.

The highest-priority remaining issues are now:
- completion-turn task ownership for tool evidence, and
- scheduler correctness across recurring job defaults, schedule edits, completion timestamps, and timezone handling.

## Bug entries

### 1. Completion-turn tool evidence loses task ownership

**Status:** Open  
**Severity:** Medium

**Impact:** Tool output produced while the user is completing a task can be stored outside that task, so final verification evidence may not stay attached to the completed task.

**Root cause:** `judgeTaskTurn()` preserves the completion `taskId`, but the final return value still gates `taskId` on `judgment.isLongTask`. `runReactAgent()` then forwards the dropped `taskId` into tool-result offload.

**Relevant code:** `src/memory/core/service.ts:566`, `src/memory/core/service.ts:594`, `src/memory/core/service.ts:602`, `src/agent/react-agent.ts:223`

---

### 2. Returning from Memory Update resets the displayed Skill Draft count to 0

**Status:** Open  
**Severity:** Low

**Impact:** The Memory summary can show `Generated drafts: 0` after returning from Memory Update even when drafts exist.

**Root cause:** the Memory Update back path rebuilds the summary without `generatedSkillCount`, and the renderer defaults the missing value to `0`.

**Relevant code:** `src/bot/bot.ts:106`, `src/bot/conversations/memory-update.ts:158`, `src/bot/ui/renderers.ts:53`

---

### 3. `tdai_create_job` silently turns recurring schedules into single-run jobs by default

**Status:** Open  
**Severity:** Medium

**Impact:** Interval and cron jobs created through the tool run once unless the caller explicitly knows to provide `max_runs`.

**Root cause:** the tool schema and parser default `max_runs` to `1`, overriding the safer recurring behavior the service would otherwise use.

**Relevant code:** `src/tools/local.ts:168`, `src/tools/local.ts:185`, `src/tools/local.ts:200`, `src/tools/local.ts:227`

---

### 4. Switching a one-shot job back to interval or cron keeps the old one-run cap

**Status:** Open  
**Severity:** Medium

**Impact:** A job can look recurring again after schedule edits but still self-delete after the next successful run.

**Root cause:** switching to `once` sets `max_runs = COALESCE(max_runs, 1)`, but switching back to `interval` or `cron` does not clear that value.

**Relevant code:** `src/services/autonomous-jobs.ts:226`, `src/services/autonomous-jobs.ts:232`, `src/services/autonomous-jobs.ts:258`, `src/bot/conversations/job-detail.ts:212`

---

### 5. Autonomous jobs stamp `last_finished_at` before the run actually finishes

**Status:** Open  
**Severity:** Medium

**Impact:** Recurrence timing drifts early by the runtime of the job, so longer jobs can be rescheduled too soon.

**Root cause:** `finishedAt` is captured at the beginning of `runOneAutonomousJob()` and reused later in both the success and error paths.

**Relevant code:** `src/cron/autonomous.ts:145`, `src/cron/autonomous.ts:189`, `src/cron/autonomous.ts:203`

---

### 6. Memory summary can leak a user's recall and persona data into shared chats

**Status:** Fixed in current tree  
**Severity:** Previously High

**Impact:** Shared-chat users no longer get Memory summary output, Memory Update entrypoints, or stale memory callbacks that could surface user-scoped memory content in a visible shared-chat message.

**Root cause:** Memory summary rendering and related memory callbacks were reachable from shared-chat UI paths even though the underlying data is user-scoped and should remain private-only.

**Fix summary:** Memory surfaces are now gated to private chats end-to-end. The main menu/help copy and keyboard stop advertising Memory in shared chats, `showMemorySummary()` refuses shared-chat access before loading recall data, and the stale `memory`, `memoryUpdate`, `memoryUpdate.runNow`, and `skillDrafts` callbacks all short-circuit back to the shared-chat-safe menu state.

**Changed code:** `src/bot/bot.ts`, `src/bot/ui/keyboards.ts`, `src/bot/ui/renderers.ts`

**Verification:** `tests/bot/ui.test.ts`, `tests/bot/shared-chat-boundaries.test.ts`

---

### 7. Autonomous job management is chat-scoped, so one member can edit or delete another member's jobs

**Status:** Fixed in current tree  
**Severity:** Previously High

**Impact:** Shared-chat users now only see and open their own jobs, and they cannot use foreign callbacks or text replies to mutate another member's already-open job-detail or job-create flow.

**Root cause:** job listing and detail lookup were keyed too broadly to the chat, and the interactive job conversations did not consistently validate that later callback/text actions came from the original actor.

**Fix summary:** Job listing and detail lookup are now actor-scoped through `listJobsForActor()` and `getJobForActor()`. The interactive job-detail and job-create flows also validate the acting user on every callback and free-text step, so the fix covers both the initial list/detail lookup and follow-up mutations inside open shared-chat job conversations.

**Changed code:** `src/bot/bot.ts`, `src/services/autonomous-jobs.ts`, `src/bot/conversations/job-create.ts`, `src/bot/conversations/job-detail.ts`

**Verification:** `tests/services/autonomous-jobs.test.ts`, `tests/bot/shared-chat-boundaries.test.ts`

---

### 8. Active task canvases can leak across users in the same chat

**Status:** Fixed in current tree  
**Severity:** Previously High

**Impact:** Shared-chat task recall now loads only the requesting user's active canvas, so one participant's task context no longer bleeds into another participant's recall. The task-judgment path is also aligned to the actor-scoped lookup in changed code, but that path is not directly covered by the cited tests.

**Root cause:** the active-canvas read path was still available as a chat-scoped lookup, so shared-chat recall could pick up whichever active canvas was newest for that chat instead of the caller's own canvas.

**Fix summary:** The SQLite backend now exposes a user-scoped active-canvas read, and both recall and memory-service callers use that user-scoped path when a `chatId` is present. That keeps active task-canvas injection aligned to the requesting actor in shared chats.

**Changed code:** `src/memory/backends/sqlite/backend.ts`, `src/memory/core/backend.ts`, `src/memory/core/service.ts`, `src/memory/recall/service.ts`

**Verification:** `tests/memory/sqlite-backend.test.ts`, `tests/memory/task-recall.test.ts`

---

### 9. Generated skill drafts can overwrite each other while the stored draft count keeps increasing

**Status:** Open  
**Severity:** Medium

**Impact:** Two draft generations with the same `skillName` overwrite the same `SKILL.md` file, but both still count as separate drafts in SQLite.

**Root cause:** draft file output is keyed only by `skillName`, while each generation always inserts a fresh database row and the displayed count is based on row count.

**Relevant code:** `src/memory/offload/l4.ts:107`, `src/memory/core/service.ts:669`, `src/memory/backends/sqlite/backend.ts:1462`, `src/memory/backends/sqlite/backend.ts:1509`

---

### 10. Store-backed memory maintenance can permanently skip turns that share the same millisecond timestamp

**Status:** Open  
**Severity:** Medium

**Impact:** Some L0 turns can be skipped forever if a batch checkpoint lands on one row while later rows share the same timestamp.

**Root cause:** store-backed maintenance advances the checkpoint using only the last processed timestamp, while the next query uses `timestamp > checkpoint` instead of a stable `(timestamp, record_id)` tie-breaker.

**Relevant code:** `src/memory/pipeline/coordinator.ts:101`, `src/memory/backends/sqlite/store.ts:859`, `src/memory/backends/sqlite/store.ts:865`

---

### 11. `telegram_send_message` is exposed in chat mode with arbitrary `chat_id`

**Status:** Fixed in current tree  
**Severity:** Previously High

**Impact:** Chat-mode tool calls can no longer redirect Telegram messages into a different chat. The tool now only sends into the active conversation.

**Root cause:** `telegram_send_message` accepted an optional `chat_id` without enforcing that it matched the current chat context, while chat mode still intentionally exposed the tool.

**Fix summary:** The tool contract is now current-chat-only: if `chat_id` is omitted it defaults to the active chat, and if it is provided it must be a string equal to `ctx.chatId` or the call is rejected. The runtime still hides the tool in autonomous mode, while chat mode keeps the safe current-chat-only version available.

**Changed code:** `src/tools/local.ts`, `src/agent/react-agent.ts`

**Verification:** `tests/memory/tools.test.ts`, `tests/memory/agent-runtime.test.ts`

---

### 12. Cron schedules are evaluated in host time, not `APP_TIMEZONE`

**Status:** Open  
**Severity:** Medium

**Impact:** Cron reminders can fire at the wrong wall-clock time whenever the host timezone differs from the configured app timezone.

**Root cause:** the app timezone is configured centrally, but cron parsing calculates next run times without passing a timezone option.

**Relevant code:** `src/config.ts:49`, `src/services/schedules.ts:110`

---

### 13. Hybrid one-shot jobs can resend the fixed reminder text after a partial send failure

**Status:** Open  
**Severity:** Medium

**Impact:** If fixed reminder text is partially delivered and the run later errors, the one-shot job stays due and can resend the already-delivered reminder text on the next scheduler tick.

**Root cause:** message chunks are sent before agent output; failures move the run into the error path without incrementing `runCount`, so the one-shot job remains eligible for another due pass.

**Relevant code:** `src/cron/autonomous.ts:81`, `src/cron/autonomous.ts:168`, `src/cron/autonomous.ts:189`, `src/cron/autonomous.ts:203`, `src/services/autonomous-jobs.ts:285`, `src/services/autonomous-jobs.ts:295`

## Bug entries (continued)

### 14. Reminder clarification replies losing access to `tdai_create_job`

**Status:** Fixed in current tree  
**Severity:** Previously Medium

**What changed:** chat-mode tool exposure no longer hides `tdai_create_job` for follow-up clarification turns.

**Evidence:** `runReactAgent()` now filters `tdai_create_job` only in autonomous mode, and current tests explicitly cover reminder clarification turns such as `jam 5`, `sekali saja`, and `besok jam 5`.

**Relevant code:** `src/agent/react-agent.ts:149`, `tests/memory/agent-runtime.test.ts:325`

## Suggested fix order

1. completion-turn task ownership for tool evidence
2. recurring job semantics (`max_runs`, schedule edits, `last_finished_at`, timezone)
3. generated-skill and store-checkpoint consistency bugs
4. Memory summary draft-count UI bug
