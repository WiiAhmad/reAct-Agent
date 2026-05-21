# 2026-05-21 Verified Bug Audit

## Status

Verified against the current working tree on 2026-05-21.

Reviewed 14 previously documented bugs:
- 2 still appear open in the current tree
- 12 appear fixed in the current tree

Unless noted otherwise, the findings below are based on current control-flow inspection and targeted test evidence.

## Executive summary

Phase 1 and Phase 2 bugs are now fixed in the current tree.

The remaining open issues are now limited to consistency/integrity bugs:
- generated skill drafts can still overwrite each other while the stored draft count increases,
- store-backed maintenance can still skip rows that share the same millisecond timestamp.

Task ownership and scheduler correctness are now aligned with the intended semantics:
- completion-turn tool evidence stays attached to the completed task,
- Memory Update back navigation preserves the generated draft count,
- recurring jobs created through `tdai_create_job` are unlimited unless `max_runs` is explicit,
- schedule edits clear stale one-shot caps,
- one-shot hybrid retries do not resend already-delivered fixed reminder text,
- `last_finished_at` reflects the true finish time,
- cron schedules honor `APP_TIMEZONE`.

## Bug entries

### 1. Completion-turn tool evidence loses task ownership

**Status:** Fixed in current tree  
**Severity:** Medium

**Impact:** Tool output produced while the user completes a task now stays attached to that task, so final verification evidence is not orphaned outside the completed task.

**Root cause:** `judgeTaskTurn()` used to preserve the completion task id internally but dropped it in the returned `taskId` and task-boundary write unless `judgment.isLongTask` was true.

**Fix summary:** Completion and continuation turns that are attached to an existing task are now treated as task-scoped for both the returned `taskId` and the inserted task boundary.

**Changed code:** `src/memory/core/service.ts`

**Verification:** `tests/memory/task-routing.test.ts`

---

### 2. Returning from Memory Update resets the displayed Skill Draft count to 0

**Status:** Fixed in current tree  
**Severity:** Low

**Impact:** The Memory summary now preserves the real generated-skill draft count when the user returns from Memory Update.

**Root cause:** the Memory Update back path rebuilt the summary without `generatedSkillCount`, so the renderer fell back to `0`.

**Fix summary:** the back-navigation path now fetches and passes `generatedSkillCount` before rebuilding the summary.

**Changed code:** `src/bot/conversations/memory-update.ts`

**Verification:** `tests/bot/memory-update-callback.test.ts`

---

### 3. `tdai_create_job` silently turns recurring schedules into single-run jobs by default

**Status:** Fixed in current tree  
**Severity:** Medium

**Impact:** Interval and cron jobs created through the tool are now unlimited unless the caller explicitly sets `max_runs`.

**Root cause:** the tool contract and parser previously hard-defaulted `max_runs` to `1` for every schedule mode.

**Fix summary:** the tool now defaults `max_runs` to `1` only for one-shot jobs and reports `max_runs=unlimited` for recurring schedules unless an explicit cap is supplied.

**Changed code:** `src/tools/local.ts`, `src/agent/prompts/system.ts`

**Verification:** `tests/memory/tools.test.ts`, `tests/runtime/agent-prompt.test.ts`

---

### 4. Switching a one-shot job back to interval or cron keeps the old one-run cap

**Status:** Fixed in current tree  
**Severity:** Medium

**Impact:** Jobs switched from `once` back to `interval` or `cron` no longer self-delete after the next successful run unless the caller explicitly reapplies a run cap.

**Root cause:** recurring schedule edits reused the existing row and left the old one-shot `max_runs = 1` value in place.

**Fix summary:** recurring schedule edits now clear stale one-shot caps before saving the new schedule mode.

**Changed code:** `src/services/autonomous-jobs.ts`

**Verification:** `tests/services/autonomous-jobs.test.ts`

---

### 5. Autonomous jobs stamp `last_finished_at` before the run actually finishes

**Status:** Fixed in current tree  
**Severity:** Medium

**Impact:** Recurrence timing and job telemetry now anchor to the real finish time instead of a timestamp captured at run start.

**Root cause:** `runOneAutonomousJob()` captured `finishedAt` before any Telegram sends or agent work started and reused that early value in both success and error paths.

**Fix summary:** finish timestamps are now captured at the point the run actually completes or errors.

**Changed code:** `src/cron/autonomous.ts`

**Verification:** `tests/cron/autonomous-helpers.test.ts`

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

**Status:** Fixed in current tree  
**Severity:** Medium

**Impact:** Cron-based reminders now use the configured application timezone instead of the host machine timezone.

**Root cause:** cron parsing validated and computed next-run times without passing `config.app.timezone`.

**Fix summary:** cron validation and next-run calculation now both use `APP_TIMEZONE`.

**Changed code:** `src/services/schedules.ts`

**Verification:** `tests/services/schedules.test.ts`

---

### 13. Hybrid one-shot jobs can resend the fixed reminder text after a partial send failure

**Status:** Fixed in current tree  
**Severity:** Medium

**Impact:** If a one-shot hybrid job delivers its fixed reminder text and later fails while sending the follow-up response, the retry path no longer sends the same fixed reminder text again.

**Root cause:** the runtime had no persisted notion that the one-shot fixed text had already been delivered, so retries replayed the full hybrid send path.

**Fix summary:** one-shot hybrid jobs now persist fixed-text delivery state and skip resending the fixed text on the retry path while continuing the unfinished follow-up work.

**Changed code:** `src/db/schema.ts`, `src/services/autonomous-jobs.ts`, `src/cron/autonomous.ts`

**Verification:** `tests/cron/autonomous-helpers.test.ts`

## Bug entries (continued)

### 14. Reminder clarification replies losing access to `tdai_create_job`

**Status:** Fixed in current tree  
**Severity:** Previously Medium

**What changed:** chat-mode tool exposure no longer hides `tdai_create_job` for follow-up clarification turns.

**Evidence:** `runReactAgent()` now filters `tdai_create_job` only in autonomous mode, and current tests explicitly cover reminder clarification turns such as `jam 5`, `sekali saja`, and `besok jam 5`.

**Relevant code:** `src/agent/react-agent.ts:149`, `tests/memory/agent-runtime.test.ts:325`

## Suggested fix order

1. generated-skill draft path collisions
2. store-backed same-timestamp checkpoint skipping
