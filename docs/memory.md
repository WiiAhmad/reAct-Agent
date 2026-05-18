# Memory

This project uses a project-owned memory backend with a protected layered model.

## Protected model boundary

The memory model is unchanged and must remain as-is:

- L0 conversations
- L1 atoms
- L2 scenarios
- L3 persona
- offload refs
- task-scoped Mermaid canvases

The durable memory path remains L0 -> L1 -> L2 -> L3. Those layers keep their existing meanings and responsibilities.

The context-offload path is separate from durable memory maintenance:

`offload L1 evidence summaries -> L1.5 task judgment -> task-scoped L2 Mermaid canvas -> L4 draft skill generation`

L1.5 decides whether a turn belongs to a long-running task, continues an existing task, closes one, or should stay short-term only. Task-scoped L2 Mermaid canvases summarize evidence for active tasks without changing durable L1/L2/L3 maintenance semantics.

### TencentDB-style semantic offload completion

Short-term task context now uses four inspectable layers:

1. **Canonical chat JSONL** stores raw transcript rows in `data/history/<chatId>.jsonl` using `{id, chat_id, user_id, role, content, meta, created_at}`.
2. **L1 semantic evidence** stores each tool result as a compact progress/blocker/verification summary in SQLite and mirrors it to `data/memory/jsonl/l1/<chat>.jsonl`.
3. **L2 semantic Mermaid patching** consumes task-routed L1 evidence and writes task-scoped `.mmd` canvases under `data/memory/task-canvases/`.
4. **Task-aware recall** searches active and historical task canvases and injects relevant Mermaid snippets into the chat context.

SQLite remains authoritative for memory/offload indexes, while raw chat transcript history is JSONL-only. The durable memory pipeline remains `L0 JSONL conversations -> L1 atoms -> L2 scenarios -> L3 persona`.

## What Memory Update means

Memory Update is the Telegram-managed workflow for durable memory maintenance.

It is not a public slash command.

It is accessed from the Telegram menu and can:

- run memory maintenance now without blocking the Telegram conversation flow
- send progress messages while L1, L2, and L3 complete
- enable or disable automatic updates
- choose a preset cadence
- accept a custom cron schedule when needed
- show status, last run, last result, and last error

## Per-user scheduling

Memory Update scheduling is stored per user.

The default behavior for a new user is:

- enabled
- every 24 hours

That makes memory maintenance a Telegram-managed setting rather than a `.env`-driven user-facing behavior.

## Offload refs and task canvases

When the agent offloads heavy tool output, the raw result is stored in an offload ref file.

The task-scoped Mermaid canvas provides a compact navigational summary of the active task context. The agent can read the offloaded reference later if it needs the raw details.

short one-shot tool use like current date/time does not update task canvases. These short interactions can answer directly without creating or changing a long-running task canvas.

## L4 draft skills

L4 draft skill generation is menu/user-triggered from Skill Drafts. It uses a selected task canvas and linked evidence to write draft skills under project storage.

L4 does not auto-install globally. A generated skill remains a reviewable draft until a user explicitly handles it outside this pipeline.

## Why this matters

The memory runtime can evolve around the edges, but the semantics of the underlying layers must not change. This documentation exists to keep that boundary explicit for future work.