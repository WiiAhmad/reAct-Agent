# 2026-05-20 Code Audit

## 1. Hybrid one-shot jobs can resend the fixed reminder after a partial send failure

**Impact:** A hybrid reminder can send its fixed reminder text successfully, fail while sending the follow-up agent response, and then stay due for retry. On the next scheduler tick, the same fixed reminder text is sent again, so users can receive duplicate reminders for a single one-shot job.

**Code evidence:**
- `src/cron/autonomous.ts:160-179` sends `messageText` first, then sends the agent answer.
- `src/cron/autonomous.ts:194-209` marks the run as `error` on failure, but does not disable the job or increment `runCount`.
- `src/services/autonomous-jobs.ts:285-299` only excludes jobs that already reached `maxRuns`; errored jobs remain eligible.
- `src/services/schedules.ts:102-118` keeps a one-shot job due forever once `runAtUnix <= nowUnix`.

**Observed repro:**
A local in-memory run where the fixed text send succeeds but the agent-response send fails produced:

```json
{
  "lastStatus": "error",
  "runCount": 0,
  "dueIds": [1]
}
```

That means the failed one-shot job is immediately due again and will resend the fixed reminder on the next scheduler tick.

**Expected behavior:**
After the fixed reminder text has already been delivered, retries should not resend that same fixed text, or the job should persist enough state to resume only the unfinished part.

---

## 2. Balasan klarifikasi reminder bisa kehilangan akses ke `tdai_create_job`

**Dampak:** Alur reminder multi-turn bisa gagal ketika pesan pertama user sudah jelas berniat membuat reminder, lalu assistant meminta klarifikasi, dan user membalas hanya dengan detail yang kurang. Pada turn lanjutan itu, job terjadwal tidak bisa dibuat karena tool scheduling disembunyikan kecuali pesan **terakhir** cocok dengan heuristik reminder.

**Bukti di kode:**
- `src/agent/react-agent.ts:86-103` menentukan apakah scheduling diizinkan hanya dari `input` saat ini.
- `src/agent/react-agent.ts:168-173` menghapus `tdai_create_job` kecuali heuristik turn saat ini bernilai true.

**Repro yang teramati:**
Dengan riwayat sebelumnya:
- user: `ingatkan saya untuk meeting`
- assistant: `Ini pengingatnya sekali saja atau berulang? Meetingnya kapan?`

Turn klarifikasi lanjutan berikut dijalankan lewat `runReactAgent(...)` dan menghasilkan:

```json
{
  "jam 5": false,
  "sekali saja": false,
  "besok jam 5": true
}
```

Artinya, konteks reminder sebelumnya masih ada di riwayat percakapan, tetapi agent tidak bisa memanggil `tdai_create_job` pada balasan klarifikasi seperti `jam 5` atau `sekali saja`. Kalau user mengulang lagi sinyal scheduling yang eksplisit seperti `besok jam 5`, tool tersebut muncul lagi.

**Catatan ruang lingkup:**
Permintaan turn pertama seperti `ingatkan saya untuk meeting` **bukan** bug ini. Pada trace live kamu, turn itu menunjukkan `toolCount: 8`, yang berarti `tdai_create_job` memang tersedia; agent hanya memilih bertanya dulu karena detail jadwalnya belum cukup, dan itu perilaku yang benar.

**Contoh trace JSONL live:**
Potongan trace berikut menunjukkan bahwa pada turn pertama tool scheduling **tersedia**, dan agent benar-benar memanggil tool — tetapi tool yang dipilih adalah `tdai_memory_search`, bukan `tdai_create_job`:

```jsonl
{"minLevel":2,"source":"agent","event":"iteration.start","tags":["new-memory-stack"],"chatId":"5980836755","userId":"5980836755","payload":{"mode":"chat","chatId":"5980836755","userId":"5980836755","iteration":1,"messageCount":8,"toolCount":8},"ts":"2026-05-20T07:03:48.974Z","seq":10,"runId":"20260520T070328Z-p9460","pid":9460}
{"minLevel":2,"source":"agent","event":"response.received","tags":["new-memory-stack"],"chatId":"5980836755","userId":"5980836755","payload":{"mode":"chat","chatId":"5980836755","userId":"5980836755","iteration":1,"toolCalls":1,"contentPreview":""},"ts":"2026-05-20T07:03:52.120Z","seq":11,"runId":"20260520T070328Z-p9460","pid":9460}
{"minLevel":2,"source":"agent","event":"tool.call","tags":["new-memory-stack"],"chatId":"5980836755","userId":"5980836755","toolName":"tdai_memory_search","toolCallId":"call_pO4cK2PsQNUTvc47vHzOigcD","payload":{"mode":"chat","chatId":"5980836755","userId":"5980836755","toolName":"tdai_memory_search","toolCallId":"call_pO4cK2PsQNUTvc47vHzOigcD","args":{"query":"meeting reminder preferences or last meeting time","maxResults":5},"argsPreview":"{\"query\":\"meeting reminder preferences or last meeting time\",\"maxResults\":5}"},"ts":"2026-05-20T07:03:52.121Z","seq":12,"runId":"20260520T070328Z-p9460","pid":9460}
```

Trace ini memperjelas bahwa masalah pada bug #2 bukan hilangnya tool di turn pertama, melainkan risiko hilangnya `tdai_create_job` pada **turn klarifikasi lanjutan** seperti `jam 5` atau `sekali saja`.

**Perilaku yang diharapkan:**
Eksposur tool reminder/scheduling seharusnya mempertimbangkan konteks percakapan terbaru, bukan hanya isi pesan user terakhir secara terpisah.

---

## 3. Returning from Memory Update resets the displayed Skill Draft count to 0

**Impact:** The Memory summary screen can show the correct generated-skill draft count when opened from the main menu, but after entering **Memory Update** and pressing **Back**, the same summary is rebuilt without the draft count and falls back to `0`. Users can be shown that they have no drafts even when drafts exist.

**Code evidence:**
- `src/bot/bot.ts:108-119` calls `deps.memory.countGeneratedSkills(userId)` and passes the real `generatedSkillCount` into `buildRichMemorySummary(...)`.
- `src/bot/conversations/memory-update.ts:158-169` rebuilds the Memory summary on **Back**, but omits `countGeneratedSkills(...)` entirely and calls `buildRichMemorySummary(...)` without `generatedSkillCount`.
- `src/bot/ui/renderers.ts:53-55` renders `Generated drafts: ${input.generatedSkillCount ?? 0}`, so the omitted value becomes `0`.

**Observable consequence:**
The Skill Draft count depends on which navigation path the user used, not on actual stored drafts.

**Expected behavior:**
Both Memory summary entry points should fetch and render the same generated-skill draft count.

---

## 4. `tdai_create_job` silently turns recurring schedules into single-run jobs by default

**Impact:** Users who create interval or cron jobs through `tdai_create_job` only get one successful run unless they explicitly know to pass `max_runs`. The tool advertises recurring schedules, but its default behavior deletes them after the first success.

**Code evidence:**
- `src/tools/local.ts:185-200` parses `max_runs` with `asPositiveInteger(args.max_runs, 1, "max_runs")`, so omitted `max_runs` becomes `1`.
- `src/tools/local.ts:211-236` applies that same default to `interval` and `cron` schedules before calling `createJob(...)`.
- `src/services/autonomous-jobs.ts:131-133` would otherwise default recurring jobs to unlimited runs (`null`), so the tool overrides the safer service behavior.
- `src/services/autonomous-jobs.ts:258-261` deletes the job once the next successful run reaches `maxRuns`.

**Observed repro:**
A tool-created payload like:

```json
{
  "message_text": "Ping",
  "agent_prompt": "Ping",
  "schedule": { "mode": "interval", "interval_sec": 600 }
}
```

is resolved with `maxRuns = 1`, so the stored recurring job is deleted after its first successful run.

**Expected behavior:**
Interval and cron jobs created via `tdai_create_job` should default to unlimited runs unless the caller explicitly sets a cap.

---

## 5. Switching a one-shot job back to interval or cron keeps the old one-run cap

**Impact:** Editing a reminder from one-shot back to recurring can still leave it capped at one successful run. The job looks recurring again, but it can self-delete after the next success.

**Code evidence:**
- `src/services/autonomous-jobs.ts:228-231` sets `max_runs = COALESCE(max_runs, 1)` when a job is changed to `once`.
- `src/services/autonomous-jobs.ts:232-235` updates `interval` and `cron` schedules without clearing `max_runs`.
- `src/services/autonomous-jobs.ts:258-261` later deletes the job solely from the persisted `maxRuns` value.

**Observed repro:**
A job created as `interval`, then changed to `once`, then changed back to `interval` still keeps `maxRuns = 1`. After its next successful run, `recordSuccessfulRun()` deletes it instead of leaving it recurring.

**Expected behavior:**
Changing a job to `interval` or `cron` should clear one-shot caps unless the user explicitly asked to preserve a run limit.

---

## 6. Autonomous jobs stamp `last_finished_at` before the run actually finishes

**Impact:** Recurrence timing and job telemetry drift earlier by the job runtime. Long-running interval or cron jobs are rescheduled too soon because the next-run anchor is captured at the beginning of the job rather than the end.

**Code evidence:**
- `src/cron/autonomous.ts:144-147` computes `finishedAt` before any Telegram sends or agent work occur.
- `src/cron/autonomous.ts:181` and `src/cron/autonomous.ts:196` persist that same early timestamp as `last_finished_at` in both success and error paths.
- `src/services/autonomous-jobs.ts:288-296` and `src/services/schedules.ts:99-118` use `lastFinishedAt` as the anchor for future due-time calculation.

**Observed repro:**
If a 10-minute interval job starts at 10:00 and spends 2 minutes sending messages and generating the agent reply, the persisted `last_finished_at` is still about 10:00. The next run therefore becomes due around 10:10 instead of 10:12.

**Expected behavior:**
`last_finished_at` should be captured after the run completes, so recurrence timing and telemetry reflect the real finish time.

---

## 7. Memory summary can leak a user’s recall and persona data into shared chats

**Impact:** In group chats, opening the Memory screen can render one member’s memory status, recalled scenarios, persona, and generated-skill count into a message visible to everyone in that chat.

**Code evidence:**
- `src/bot/bot.ts:105-121` builds the Memory summary from `resolveUserId(ctx)`, `memoryStatus(...)`, `recall(...)`, and `countGeneratedSkills(...)`.
- `src/bot/bot.ts:82-95` renders that summary directly back into the current chat with `editMessageText(...)` or `reply(...)`.
- There is no guard in this path that limits the Memory UI to private chats.

**Observed repro:**
In any non-private chat where the bot is present, one member can press the Memory button and the resulting message is posted into the shared chat rather than a private surface.

**Expected behavior:**
Per-user memory summaries should be shown only in private chats, or the bot should refuse to open that screen outside a private conversation.

---

## 8. Autonomous job management is chat-scoped, so one member can edit or delete another member’s jobs

**Impact:** In shared chats, the Jobs screen exposes all jobs for the chat and the detail actions let any participant update prompts, change schedules, disable jobs, or delete jobs created by someone else.

**Code evidence:**
- `src/bot/bot.ts:123-126` loads the Jobs screen with `listJobsForChat(chatId)`.
- `src/services/autonomous-jobs.ts:192-215` implements both `getJobByChat(...)` and `listJobsForChat(...)` using `chat_id` only, not `user_id`.
- `src/bot/conversations/job-detail.ts:155-160` opens job details from `getJobByChat(chatId, jobId)`.
- `src/bot/conversations/job-detail.ts:197-218` and `src/bot/conversations/job-detail.ts:235-236` mutate jobs by bare job id with no ownership check.

**Observed repro:**
If two users share the same chat, the second user can open the Jobs screen, select the first user’s job, then change its prompt/schedule, disable it, or delete it.

**Expected behavior:**
Autonomous jobs should either be private to their creator or every mutation path should verify that the acting user owns the job.

---

## 9. Active task canvases can leak across users in the same chat

**Impact:** Task-canvas context can bleed from one user to another in shared chats. A user’s recall snapshot or task-judgment input can include another user’s active canvas, which can distort memory recall and task-completion decisions.

**Code evidence:**
- `src/memory/backends/sqlite/backend.ts:998-1007` loads the active task canvas by `chat_id` only.
- `src/memory/recall/service.ts:155-163` includes `getTaskCanvas(chatId)` in the recall bundle.
- `src/memory/core/service.ts:546-559` fetches the active task for the current `userId`, but then loads its canvas content through `getTaskCanvas(input.chatId)` instead of a user-scoped lookup.

**Observed repro:**
When multiple users in the same chat have active long-running tasks, the most recently updated active canvas for that chat can be returned regardless of which user is currently being recalled or judged.

**Expected behavior:**
Task-canvas retrieval should be scoped by both `chatId` and `userId`, so each user only sees their own active canvas content.

---

## 10. Generated skill drafts can overwrite each other while the stored draft count keeps increasing

**Impact:** Two generated drafts with the same `skillName` overwrite the same `SKILL.md` file, but both still create database rows. Users can lose earlier draft contents while the UI count continues to rise as if all drafts still existed separately.

**Code evidence:**
- `src/memory/offload/l4.ts:106-117` always writes a generated draft to `<generatedSkillsDir>/<skillName>/SKILL.md`.
- `src/memory/core/service.ts:669-684` writes the draft first, then unconditionally inserts a generated-skill record.
- `src/memory/backends/sqlite/backend.ts:1462-1487` inserts a fresh `memory_generated_skills` row for every generated draft.
- `src/memory/core/service.ts:528-535` counts drafts from the database, not from unique files on disk.

**Observed repro:**
If two draft generations produce the same `skillName`, the later generation overwrites the earlier file path, but both drafts remain counted in `memory_generated_skills`.

**Expected behavior:**
Generated drafts should be uniquely namespaced per generation, or duplicate `skillName` collisions should be detected and handled without silently overwriting prior draft files.

---

## 11. Store-backed memory maintenance can permanently skip turns that share the same millisecond timestamp

**Impact:** In store mode, some L0 turns can be lost forever during maintenance. If multiple rows share the same millisecond timestamp and a batch ends partway through them, the remaining rows at that timestamp are never picked up in later runs.

**Code evidence:**
- `src/memory/pipeline/coordinator.ts:72-85` loads pending store-backed turns through `queryL0ForUser(userId, afterConversationId, ...)`.
- `src/memory/pipeline/coordinator.ts:101-105` advances the checkpoint to `Date.parse(pendingTurns.at(-1)?.createdAt ?? "")` in store mode.
- `src/memory/backends/sqlite/store.ts:859-868` queries future work with `timestamp > ?` and orders by `timestamp ASC, record_id ASC`.

**Observed repro:**
If a batch stops after processing one row at timestamp `T` while later rows with the same `T` still exist, the next checkpoint is set to `T` and the next query asks for `timestamp > T`, permanently excluding the remaining same-timestamp rows.

**Expected behavior:**
Store checkpoints should preserve a stable tie-breaker such as `(timestamp, record_id)` so later rows at the same timestamp are not skipped.

---

## 12. `telegram_send_message` is exposed in chat mode with arbitrary `chat_id`, enabling unintended cross-chat sends

**Impact:** Normal chat-mode tool use can send Telegram messages to arbitrary chat IDs the bot can access, not just to the current conversation. This creates an authorization gap and a high-risk misdelivery path.

**Code evidence:**
- `src/tools/local.ts:242-260` defines `telegram_send_message` and honors an arbitrary `chat_id` argument.
- `src/agent/react-agent.ts:168-172` filters `telegram_send_message` only out of autonomous mode; in normal chat mode it remains exposed.
- `src/tools/local.ts:257-260` passes the resolved `chat_id` directly to `api.sendMessage(...)` with no scope or ownership check.

**Observed repro:**
A chat-mode tool call can provide a different `chat_id` than the current chat, and the tool will send to that destination if the bot has access.

**Expected behavior:**
Cross-chat sends should be disallowed by default, or restricted to explicit admin-only flows with destination authorization checks.

---

## 13. Cron schedules are evaluated in host time, not the configured app timezone

**Impact:** Cron-based reminders can fire at the wrong wall-clock time whenever the server timezone differs from `APP_TIMEZONE`. The agent sees Jakarta-local time, but the scheduler interprets cron expressions using the host default timezone.

**Code evidence:**
- `src/config.ts:49-53` defines an explicit app timezone (`APP_TIMEZONE`, default `Asia/Jakarta`).
- `src/tools/local.ts:153-163` returns current time snapshots in that configured timezone.
- `src/services/schedules.ts:110-114` parses cron expressions without passing any timezone option.

**Observed repro:**
On a host that is not using `Asia/Jakarta`, a cron like `0 9 * * *` is scheduled for 9:00 host-local time rather than 9:00 app-local time.

**Expected behavior:**
Cron parsing should use the configured application timezone so the scheduler matches the time semantics shown to users and to the agent.
