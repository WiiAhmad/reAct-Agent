# TencentDB Semantic Offload Completion Design

## Source

This spec is derived from `docs/superpowers/plans/2026-05-18-tencentdb-semantic-offload-completion.md` and extends the earlier design in `docs/superpowers/specs/2026-05-18-tencentdb-l15-offload-adaptation-design.md`.

The requested addition is that raw chat logs become JSONL-only using the existing `data/history/<chatId>.jsonl` format, while SQLite remains authoritative for memory and offload indexes.

## Goal

Complete the TencentDB-style short-term memory adaptation by adding canonical chat-history JSONL, L1 semantic evidence summaries, L2 semantic Mermaid patching, and task-aware recall without replacing the existing durable memory pipeline.

## Non-goals

- Do not replace the durable memory pipeline: `L0 JSONL conversations -> L1 atoms -> L2 scenarios -> L3 persona`.
- Do not expose L4 as a public Telegram slash command.
- Do not auto-install generated L4 skills into global Claude Code skill directories.
- Do not store secrets, API keys, chat IDs, user IDs, or raw private transcripts inside generated skills.
- Do not make SQLite the canonical raw chat transcript store.

## Reference provenance

### TencentDB-Agent-Memory references

These files are the source of the adaptation concepts. The project should adapt the behavior, not copy implementation blindly.

| Adapted concept | Source file | Reason |
|---|---|---|
| Tool/turn evidence capture | `TencentDB-Agent-Memory/src/offload/hooks/after-tool-call.ts` | Shows hook-based capture of tool call/result pairs before offload. |
| L1 evidence entry shape | `TencentDB-Agent-Memory/src/offload/types.ts` | Defines traceable offload entries with `result_ref`, `tool_call_id`, and `score`. |
| L1 semantic summary contract | `TencentDB-Agent-Memory/src/offload/local-llm/prompts/l1-prompt.ts` | Requires strict L1 summary output tied back to the original tool call. |
| L1.5 task judgment | `TencentDB-Agent-Memory/src/offload/local-llm/prompts/l15-prompt.ts` | Defines task completion, continuation, and long-task judgment behavior. |
| L2 Mermaid patching | `TencentDB-Agent-Memory/src/offload/local-llm/prompts/l2-prompt.ts` | Defines `write`/`replace` patching and node mapping from evidence to Mermaid nodes. |
| L2 pipeline trigger | `TencentDB-Agent-Memory/src/offload/pipelines/l2-mermaid.ts` | Shows that L2 can run independently over eligible task-bound evidence. |
| Backend L1/L1.5/L2/L4 endpoints | `TencentDB-Agent-Memory/src/offload/backend-client.ts` | Documents backend-capable layer boundaries; this project keeps local `LlmProvider` mode. |
| L4 skill generation | `TencentDB-Agent-Memory/src/offload/index.ts` | Shows command-triggered skill generation from task/MMD evidence. |

### Current project references

These files are the project-local sources and targets for the design.

| Project file | Role in this design |
|---|---|
| `data/history/5980836755.jsonl` | Existing source example for canonical chat JSONL row shape: `{id, chat_id, user_id, role, content, meta, created_at}`. |
| `src/config.ts` | Existing `storage.historyDir` points to `data/history`; new config keeps that as canonical chat-history root. |
| `src/memory/events/service.ts` | Current chat/tool logging path; will write canonical transcript rows to `data/history/<chatId>.jsonl`. |
| `src/memory/events/jsonl-export.ts` | Existing optional interaction-event export; remains diagnostic and is not the canonical transcript. |
| `src/memory/jsonl.ts` | Existing append/read JSONL helpers reused by the new chat-history writer. |
| `src/agent/react-agent.ts` | Runtime call site for L1.5 routing, recall context, tool calls, tool results, and offload. |
| `src/memory/offload/service.ts` | Current truncate-only offload summary and deterministic `.mmd` writer; becomes L1+L2 orchestrator. |
| `src/memory/offload/l15.ts` | Existing local L1.5 rules/LLM hybrid judgment implementation that stays in the pipeline. |
| `src/memory/offload/l4.ts` | Existing draft-only L4 skill generation implementation that remains menu-gated. |
| `src/memory/core/service.ts` | Main memory orchestration service; will route chat-history reads to JSONL and expose richer status. |
| `src/memory/core/backend.ts` | Backend interface for memory/offload indexes, L1 evidence, task nodes, and task canvas search. |
| `src/memory/backends/sqlite/migrate.ts` | SQLite schema migration target for L1 evidence and task canvas FTS. |
| `src/memory/backends/sqlite/backend.ts` | SQLite implementation target for L1 evidence, mapping, task canvas search, and generated-skill metadata. |
| `src/memory/recall/service.ts` | Recall aggregation target for active and historical task canvases. |
| `src/bot/conversations/skill-draft.ts` | Menu-gated L4 draft generation UI; public slash command surface remains unchanged. |
| `src/bot/bot.ts` | Public Telegram commands remain `/start`, `/menu`, and `/help`. |

## Architecture

The completed short-term context pipeline is:

```text
chat turn/tool result
-> canonical chat JSONL in data/history/<chatId>.jsonl
-> L1 semantic evidence summary in SQLite + JSONL mirror
-> existing L1.5 judgeTaskTurn()
-> L2 semantic Mermaid patching into task-scoped .mmd files
-> task-aware recall for active and historical task canvases
-> existing menu-gated L4 draft SKILL.md generation
```

SQLite remains the source of truth for memory and offload indexes: memory atoms, scenarios, persona, L1 evidence, L1.5 judgments, task boundaries, task graph nodes, task canvas search, offload refs, and generated skill metadata.

Raw chat transcript history is not canonical in SQLite. It is canonical only in `data/history/<chatId>.jsonl`.

## Canonical chat-history JSONL

Raw chat logs live under:

```text
data/history/<chatId>.jsonl
```

Each line is a role-based transcript row:

```json
{"id":1,"chat_id":"5980836755","user_id":"5980836755","role":"user","content":"test","meta":{"mode":"chat"},"created_at":"2026-05-16T17:11:04.080Z"}
```

Rules:

- `id` is monotonically increasing within one chat JSONL file.
- `role` is one of `user`, `assistant`, `system`, or `tool`.
- Tool calls and tool results are transcript rows with `role: "tool"`.
- Tool metadata such as `tool_name`, `tool_call_id`, and `offloaded` lives inside `meta`.
- `content` remains the human-readable transcript text, such as user text, assistant answer, `CALL ...`, or `RESULT ...`.
- Optional interaction-event JSONL export remains diagnostic and uses a different event-shaped format; it must not be treated as the canonical chat transcript.

## L1 semantic evidence

Tool results produce L1 semantic evidence entries with:

- `nodeId`
- `toolCallId`
- `toolName`
- `args`
- `summary`
- `resultRef`
- `score`
- `taskId`
- `mmdNodeId`
- `status`

The L1 summary is generated through the existing local `LlmProvider`. If the LLM response is malformed, the system falls back to a bounded deterministic summary and the configured default score.

L1 is stored in SQLite for indexing and traceability, and mirrored as inspectable JSONL under:

```text
data/memory/jsonl/l1/<chat>.jsonl
```

## L1.5 task judgment

The existing L1.5 implementation remains responsible for deciding whether a user turn is:

- short/tool-assisted QA,
- a new long task,
- a continuation of an active/historical task,
- or completion of the current task.

Short one-shot questions such as current date/time/day checks should not create or update a task canvas. They may create L1 evidence with `taskId` unset, but L2 should not consume them.

## L2 semantic Mermaid patching

Task-routed L1 evidence is consumed by an L2 Mermaid patcher. L2 returns strict JSON containing:

- `fileAction`: `write` or `replace`
- `mmdContent`
- `replaceBlocks`
- `nodeMapping`

The `.mmd` task canvas remains a project-local artifact under the existing task canvas directory. SQLite FTS indexes task labels and canvas content for task-aware recall. Node mapping links L1 evidence rows and compatibility task graph nodes to semantic Mermaid node IDs.

If L2 output is invalid, the existing deterministic graph fallback remains available so the task canvas is still inspectable.

## Task-aware recall

Recall expands beyond the active canvas. It should include:

- durable persona/atom/scenario recall from SQLite,
- canonical raw chat search through JSONL history helpers,
- the active task canvas,
- relevant historical task canvases from SQLite FTS.

Agent prompt context should show relevant historical Mermaid snippets with task ID, label, status, and file path so the model can orient itself without reading raw transcripts.

## L4 skill generation safety

L4 remains draft-only and menu-gated. It uses selected task canvases and node-linked evidence to generate project-local draft `SKILL.md` artifacts. The bot must not add a public `/skill` or `/create-skill` command for this. Drafts require review before any export or installation.

## User-facing behavior

- `/start`, `/menu`, and `/help` remain the only public commands.
- Memory UI shows canonical chat JSONL, L1 semantic evidence, L2 semantic Mermaid, task-aware recall, and generated skill draft counts.
- Skill Drafts remains available from the menu.
- Current date/time/day questions return explicit weekday/timezone data and do not pollute task canvases.

## Test strategy

The implementation plan requires tests for:

1. Canonical chat JSONL format, monotonic per-chat IDs, recent reads, and search.
2. `InteractionLogService` writing transcript rows to `data/history/<chatId>.jsonl` without using SQLite as raw transcript storage.
3. Config defaults and overrides for L1, L2, and task-aware recall.
4. SQLite schema and backend methods for L1 evidence, node mapping, and task canvas FTS.
5. L1 semantic summary parsing, fallback, and local LLM generation.
6. L2 Mermaid response parsing, patch application, validation, and local LLM generation.
7. Runtime propagation of `toolCallId` into L1 evidence.
8. End-to-end offload writing L1 SQLite rows, L1 JSONL mirror rows, semantic `.mmd` canvases, and FTS indexes.
9. Task-aware recall of active and historical task canvases.
10. Bot summary, README, architecture docs, and prompt guidance.

## Implementation plan

Execute `docs/superpowers/plans/2026-05-18-tencentdb-semantic-offload-completion.md` task-by-task. That plan contains the exact file list, test code, implementation snippets, commands, and expected outputs for this design.
