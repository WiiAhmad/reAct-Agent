# TencentDB Semantic Offload Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the TencentDB-style adaptation by adding JSONL-only canonical chat logs, L1 semantic evidence summaries, L2 semantic Mermaid patching, and task-aware recall while keeping SQLite authoritative for memory/offload indexes and JSONL/`.mmd` files inspectable.

**Architecture:** Chat logs are written canonically to `data/history/<chatId>.jsonl` using the existing role-based JSONL format; SQLite keeps derived memory/offload indexes, not the primary chat transcript. Tool results become L1 semantic evidence entries stored in both SQLite and JSONL. Task-routed evidence is then consumed by an L2 Mermaid patcher that writes semantic `.mmd` task canvases and persists node mappings. Recall expands from active-canvas-only to task-aware retrieval that can surface active and historical task canvases with drill-down evidence references.

**Tech Stack:** Bun, TypeScript, SQLite/FTS5 via `bun:sqlite`, local `LlmProvider`, canonical chat JSONL in `data/history`, L1 evidence JSONL, Mermaid `.mmd` task canvases, grammY bot runtime.

**Design Spec:** `docs/superpowers/specs/2026-05-18-tencentdb-semantic-offload-completion-design.md`

---

## Scope

This plan implements only the missing short-term offload layers:

```text
chat turn/tool result
-> canonical chat JSONL in data/history/<chatId>.jsonl
-> L1 semantic evidence summary in SQLite + JSONL
-> existing L1.5 judgeTaskTurn()
-> L2 semantic Mermaid patching into task-scoped .mmd files
-> task-aware recall for active and historical task canvases
```

It does not change the durable memory maintenance pipeline:

```text
L0 conversations -> L1 memory atoms -> L2 scenarios -> L3 persona
```

It does not expose L4 as a public tool or auto-install generated skills.

Chat logs must be JSONL-only at the transcript layer. The canonical raw chat transcript is `data/history/<chatId>.jsonl`, matching the existing line format:

```json
{"id":1,"chat_id":"5980836755","user_id":"5980836755","role":"user","content":"test","meta":{"mode":"chat"},"created_at":"2026-05-16T17:11:04.080Z"}
```

SQLite remains authoritative for memory and offload indexes: atoms, scenarios, persona, L1 semantic evidence, L1.5 judgments, task boundaries, task nodes, task canvas search, offload refs, and generated skill metadata. SQLite should not be treated as the canonical raw chat transcript after this plan.

---

## Adaptation Reference Map

This work intentionally completes the TencentDB-style short-term memory adaptation while keeping the project-owned runtime, SQLite backend, Telegram UI, and safer L4 review gate.

### End-to-end pipeline comparison

```text
TencentDB-Agent-Memory
runtime hook evidence
-> L1 LLM summary with tool_call_id/result_ref/score
-> L1.5 task judgment over recent messages + current MMD + available MMDs
-> L2 LLM Mermaid generator/patcher with node_mapping
-> L4 backend skill generation via /create-skill, SKILL.md write, context injection

This project after this plan
Telegram agent-loop evidence
-> canonical role-based chat JSONL in data/history/<chatId>.jsonl
-> L1 semantic evidence summary with tool_call_id/result_ref/score in SQLite + JSONL
-> existing L1.5 judgeTaskTurn() task routing
-> L2 local LLM Mermaid patcher with node_mapping into task-scoped .mmd files
-> task-aware recall of active and historical task canvases
-> existing menu-gated L4 draft SKILL.md generation
```

### TencentDB source references

| Layer | TencentDB reference | What it proves |
|---|---|---|
| Evidence capture | `TencentDB-Agent-Memory/src/offload/hooks/after-tool-call.ts:1` | `after_tool_call` hook captures tool call/result pairs. |
| Evidence buffering | `TencentDB-Agent-Memory/src/offload/hooks/after-tool-call.ts:176` | Captured tool calls become `ToolPair` records. |
| Active MMD injection | `TencentDB-Agent-Memory/src/offload/hooks/after-tool-call.ts:195` | Active Mermaid context is injected only after L1.5 settles task routing. |
| MMD context payload | `TencentDB-Agent-Memory/src/offload/hooks/after-tool-call.ts:216` | Injected context names active task MMD and includes Mermaid content. |
| Offload entry model | `TencentDB-Agent-Memory/src/offload/types.ts:11` | L1 evidence is represented as `OffloadEntry`. |
| Evidence traceability | `TencentDB-Agent-Memory/src/offload/types.ts:21` | `result_ref` points from compact summary back to raw result. |
| Provider call identity | `TencentDB-Agent-Memory/src/offload/types.ts:23` | `tool_call_id` is preserved for traceability and L2 mapping. |
| Replaceability score | `TencentDB-Agent-Memory/src/offload/types.ts:26` | L1 entries include `score` for summary/raw-result replacement value. |
| L1 prompt contract | `TencentDB-Agent-Memory/src/offload/local-llm/prompts/l1-prompt.ts:24` | L1 must return original `tool_call_id`. |
| L1 score contract | `TencentDB-Agent-Memory/src/offload/local-llm/prompts/l1-prompt.ts:26` | L1 score is required and ranges from 0 to 10. |
| L1.5 lifecycle | `TencentDB-Agent-Memory/src/offload/local-llm/prompts/l15-prompt.ts:4` | L1.5 decides task completion, continuation, and new task detection. |
| L1.5 result shape | `TencentDB-Agent-Memory/src/offload/local-llm/prompts/l15-prompt.ts:21` | L1.5 returns `isLongTask` and `isContinuation`. |
| Historical MMD reactivation | `TencentDB-Agent-Memory/src/offload/local-llm/prompts/l15-prompt.ts:23` | L1.5 can pick `continuationMmdFile` from available MMDs. |
| L2 write/replace mode | `TencentDB-Agent-Memory/src/offload/local-llm/prompts/l2-prompt.ts:23` | L2 chooses incremental `replace` or full `write`. |
| L2 node format | `TencentDB-Agent-Memory/src/offload/local-llm/prompts/l2-prompt.ts:28` | Mermaid nodes encode stage, status, summary, and timestamp. |
| L2 mapping invariant | `TencentDB-Agent-Memory/src/offload/local-llm/prompts/l2-prompt.ts:29` | Every new `tool_call_id` must map to a Mermaid node. |
| L2 response shape | `TencentDB-Agent-Memory/src/offload/local-llm/prompts/l2-prompt.ts:39` | L2 returns JSON with `file_action`, Mermaid content, replace blocks, and mapping. |
| L2 independent trigger | `TencentDB-Agent-Memory/src/offload/pipelines/l2-mermaid.ts:4` | L2 runs independently from L1 after enough unmapped entries or timeout. |
| Boundary-filtered L2 | `TencentDB-Agent-Memory/src/offload/pipelines/l2-mermaid.ts:121` | L2 groups eligible entries by L1.5 task boundary/MMD. |
| Backend L1 endpoint | `TencentDB-Agent-Memory/src/offload/backend-client.ts:140` | Backend mode can call `/offload/v1/l1/summarize`. |
| Backend L1.5 endpoint | `TencentDB-Agent-Memory/src/offload/backend-client.ts:168` | Backend mode can call `/offload/v1/l15/judge`. |
| Backend L2 endpoint | `TencentDB-Agent-Memory/src/offload/backend-client.ts:196` | Backend mode can call `/offload/v1/l2/generate`. |
| Backend L4 endpoint | `TencentDB-Agent-Memory/src/offload/backend-client.ts:225` | Backend mode can call `/offload/v1/l4/generate`. |
| L4 trigger | `TencentDB-Agent-Memory/src/offload/index.ts:102` | TencentDB L4 is command-triggered through `/create-skill`. |
| L4 evidence filter | `TencentDB-Agent-Memory/src/offload/index.ts:803` | L4 filters offload entries by MMD node IDs before generation. |
| L4 skill write | `TencentDB-Agent-Memory/src/offload/index.ts:814` | Generated skill is written under `skills/<skillName>/SKILL.md`. |
| L4 result injection | `TencentDB-Agent-Memory/src/offload/index.ts:817` | Generated skill result is injected back as context. |

### Current project references before this plan

| Layer | Current project reference | Current behavior |
|---|---|---|
| Agent-loop evidence capture | `src/agent/react-agent.ts:69` | User turns are logged before routing. |
| Existing history directory | `src/config.ts:40` | `historyDir` already resolves to `data/history`. |
| Existing chat JSONL example | `data/history/5980836755.jsonl:1` | Existing canonical-looking chat log line uses `id`, `chat_id`, `user_id`, `role`, `content`, `meta`, `created_at`. |
| Current optional JSONL export | `src/memory/events/service.ts:179` | Current interaction JSONL export is optional and writes event `type`, not role-based chat transcript format. |
| Current DB transcript write | `src/memory/events/service.ts:33` | User messages are currently duplicated into SQLite `conversations`. |
| Current DB assistant write | `src/memory/events/service.ts:66` | Assistant messages are currently duplicated into SQLite `conversations`. |
| Current DB tool write | `src/memory/events/service.ts:108` | Tool calls are currently duplicated into SQLite `conversations`. |
| L1.5 call site | `src/agent/react-agent.ts:75` | Runtime calls `memory.judgeTaskTurn()` before recall/tool use. |
| Recall context injection | `src/agent/react-agent.ts:43` | Active task canvas is inserted into memory context when present. |
| Tool offload call site | `src/agent/react-agent.ts:187` | Tool results are passed into `memory.offloadToolResult()`. |
| Current offload summary | `src/memory/offload/service.ts:50` | Summary is currently generated inside `OffloadService`. |
| Current truncate fallback | `src/memory/offload/service.ts:39` | Current summary behavior is deterministic truncation. |
| Current task canvas write | `src/memory/offload/service.ts:173` | Task canvas is written only when `taskId` exists. |
| Current deterministic graph | `src/memory/offload/service.ts:210` | Current `.mmd` is a deterministic node sequence, not semantic L2 topology. |
| L1.5 service method | `src/memory/core/service.ts:340` | `judgeTaskTurn()` orchestrates L1.5 routing. |
| L1.5 LLM/rules dispatch | `src/memory/core/service.ts:358` | `runL15Judgment()` receives active/historical task context. |
| L1.5 persistence | `src/memory/core/service.ts:385` | L1.5 judgments are stored in SQLite. |
| Task boundary persistence | `src/memory/core/service.ts:396` | Task boundaries are stored after L1.5 judgment. |
| L4 service entrypoint | `src/memory/core/service.ts:419` | L4 draft generation is exposed as `generateSkillDraft()`. |
| L4 evidence source | `src/memory/core/service.ts:443` | L4 reads task graph nodes for selected task. |
| L4 local generator | `src/memory/offload/l4.ts:95` | L4 uses local `LlmProvider`, not TencentDB backend. |
| L4 safety validation | `src/memory/offload/l4.ts:56` | Generated skills are validated before write. |
| L4 draft write | `src/memory/offload/l4.ts:106` | Generated skill is written as a draft file. |
| Telegram L4 menu | `src/bot/conversations/skill-draft.ts:95` | Skill Drafts are menu-triggered, not public slash commands. |
| Active task recall | `src/memory/recall/service.ts:28` | Recall currently aggregates persona, atoms, scenarios, conversations, and active canvas. |
| Active canvas lookup | `src/memory/recall/service.ts:35` | Recall only asks backend for current chat's active canvas. |
| Recall return shape | `src/memory/recall/service.ts:73` | Recall currently returns one `taskCanvas`, not relevant historical canvases. |
| Backend task evidence | `src/memory/core/backend.ts:71` | Backend stores task graph nodes. |
| Backend task nodes by task | `src/memory/core/backend.ts:75` | Backend can list task graph nodes for one task. |
| SQLite task node query | `src/memory/backends/sqlite/backend.ts:1211` | SQLite can list task graph nodes for selected task. |
| Generated skill metadata | `src/memory/backends/sqlite/backend.ts:1249` | SQLite stores generated skill traceability metadata. |

### Gaps this plan closes

| Gap | Current limitation | Planned implementation |
|---|---|---|
| Canonical chat logs | Chat turns are currently duplicated into SQLite `conversations` and optional interaction JSONL uses event `type` format. | Make `data/history/<chatId>.jsonl` the canonical role-based transcript; keep SQLite for memory/offload indexes and derived lookup only. |
| Chat log format | Current optional export writes `type`, `tool_name`, `tool_call_id`, and `offloaded`; existing history JSONL uses `role` transcript rows. | Add/standardize a history JSONL writer that emits `{id, chat_id, user_id, role, content, meta, created_at}` for user/assistant/tool rows. |
| L1 semantic summary | `OffloadService` stores truncated summaries without score. | Add `src/memory/offload/l1.ts`, `memory_l1_evidence_entries`, and JSONL mirror. |
| Tool call traceability | `toolCallId` is logged in events but not passed into offload evidence. | Pass `toolCallId` from `src/agent/react-agent.ts` into `offloadToolResult()`. |
| Replaceability scoring | No `score` field exists on task evidence. | Add `score` to SQLite L1 evidence and compatibility task nodes. |
| L2 semantic topology | `.mmd` is currently a deterministic sequence. | Add `src/memory/offload/l2.ts` with write/replace patching and `nodeMapping`. |
| MMD node mapping | Evidence nodes are not mapped to semantic Mermaid nodes. | Persist `mmdNodeId` for L1 evidence and task nodes. |
| JSONL inspectability for L1 | Existing JSONL logs interaction events, not semantic L1 entries. | Write `data/memory/jsonl/l1/<chat>.jsonl` for L1 evidence. |
| Historical task recall | Recall returns only active task canvas. | Add task canvas FTS and `taskCanvases` recall results. |
| Task canvas search | `.mmd` files exist but are not searchable by query. | Index task labels + canvas content into SQLite FTS. |

---

## File Structure

### New files

- `src/memory/history/jsonl.ts` — canonical role-based chat history JSONL writer/reader/search helpers for `data/history/<chatId>.jsonl`.
- `tests/memory/history-jsonl.test.ts` — canonical chat JSONL format, recent-message, and search tests.
- `src/memory/offload/l1.ts` — L1 semantic evidence prompt, parser, fallback summarizer, and LLM runner.
- `src/memory/offload/l2.ts` — L2 Mermaid response parser, patch applier, Mermaid validation, and LLM runner.
- `tests/memory/l1.test.ts` — parser, fallback, and LLM-runner tests for L1 semantic summaries.
- `tests/memory/l2.test.ts` — parser, replace/write patch, validation, and LLM-runner tests for L2 Mermaid patching.
- `tests/memory/task-recall.test.ts` — task-aware recall tests.

### Modified files

- `src/config.ts` — keep `storage.historyDir` as canonical chat JSONL directory and add `memory.l1`, `memory.l2`, and `memory.taskRecall` config.
- `.env.example` — document new L1/L2/task recall environment variables.
- `src/memory/core/types.ts` — add `L1EvidenceEntry`, L2 response/mapping types, and task recall result types.
- `src/memory/core/backend.ts` — add backend interface methods for L1 evidence, JSONL path resolution, task canvas FTS/search, and L2 node mapping.
- `src/memory/backends/sqlite/migrate.ts` — add SQLite tables/FTS for L1 evidence and task canvas search; add forward-only columns to `memory_task_nodes`.
- `src/memory/backends/sqlite/backend.ts` — implement new backend methods.
- `src/memory/events/service.ts` — write all chat turns to canonical `data/history/<chatId>.jsonl` and stop treating optional interaction-event JSONL as the chat transcript.
- `src/memory/integration/factory.ts` — pass `storage.historyDir` into `InteractionLogService`, pass LLM/config/JSONL directory into `OffloadService`, and pass task recall config into `RecallService`.
- `src/memory/offload/service.ts` — replace truncate-only summary path with L1 semantic summary + JSONL/SQLite persistence; call L2 patching for task-routed evidence.
- `src/memory/recall/service.ts` — include task-aware recall results.
- `src/memory/core/service.ts` — expose richer recall status and pass config through service state.
- `src/agent/react-agent.ts` — pass `toolCallId` to offload and render relevant historical task canvases in memory context.
- `src/tools/local.ts` — include task-aware recall in `tdai_memory_search` output.
- `src/bot/ui/renderers.ts` — show task recall/L1/L2 status in memory summary.
- `tests/memory/config.test.ts` — config default/override tests.
- `tests/memory/sqlite-backend.test.ts` — SQLite schema and backend method tests.
- `tests/memory/offload.test.ts` — integrated L1+L2 offload tests.
- `tests/memory/agent-runtime.test.ts` — end-to-end runtime tests.
- `tests/runtime/agent-prompt.test.ts` — prompt/status tests.
- `docs/memory.md`, `docs/architecture.md`, `README.md` — document L1 semantic evidence, L2 patching, JSONL, SQLite, `.mmd`, and task-aware recall.

---

## Data Model

### Canonical chat history JSONL

The raw chat transcript is JSONL-only and lives under the existing history directory:

```text
data/history/<chatId>.jsonl
```

Each line is one role-based chat turn and must match the existing `data/history/5980836755.jsonl` shape:

```json
{"id":1,"chat_id":"5980836755","user_id":"5980836755","role":"user","content":"test","meta":{"mode":"chat"},"created_at":"2026-05-16T17:11:04.080Z"}
```

Rules:

- `id` is monotonically increasing within that chat JSONL file.
- `role` is one of `user`, `assistant`, `system`, or `tool`.
- Tool calls and tool results are chat transcript rows with `role: "tool"`; `tool_call_id`, `tool_name`, and `offloaded` stay inside `meta`.
- `content` stores the human-readable transcript text exactly like the current file: `CALL ...`, `RESULT ...`, user text, or assistant answer.
- This file is canonical for raw L0 chat history.
- SQLite may keep derived memory/offload indexes, but it is not the canonical raw chat transcript.

### SQLite remains authoritative for memory/offload indexes

Add `memory_l1_evidence_entries` as the source of truth for semantic offload entries:

```sql
CREATE TABLE IF NOT EXISTS memory_l1_evidence_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  task_id INTEGER,
  node_id TEXT NOT NULL UNIQUE,
  tool_call_id TEXT,
  tool_name TEXT NOT NULL,
  args_json TEXT NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL,
  result_ref TEXT,
  score INTEGER NOT NULL DEFAULT 5,
  mmd_node_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
```

Add FTS for task-aware recall:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS memory_task_canvas_fts USING fts5(
  label,
  canvas,
  task_id UNINDEXED,
  chat_id UNINDEXED,
  user_id UNINDEXED,
  status UNINDEXED,
  file_path UNINDEXED,
  tokenize = 'unicode61'
);
```

Extend `memory_task_nodes` for compatibility with existing code and L4:

```ts
if (!hasColumn(db, "memory_task_nodes", "tool_call_id")) {
  db.exec(`ALTER TABLE memory_task_nodes ADD COLUMN tool_call_id TEXT`);
}
if (!hasColumn(db, "memory_task_nodes", "score")) {
  db.exec(`ALTER TABLE memory_task_nodes ADD COLUMN score INTEGER NOT NULL DEFAULT 5`);
}
if (!hasColumn(db, "memory_task_nodes", "mmd_node_id")) {
  db.exec(`ALTER TABLE memory_task_nodes ADD COLUMN mmd_node_id TEXT`);
}
```

### JSONL is the inspectable mirror

Write one append-only JSONL record per L1 evidence entry under the existing JSONL export root:

```text
data/memory/jsonl/l1/<safe-chat-id>.jsonl
```

Each line mirrors the SQLite entry:

```json
{"type":"l1_evidence","chatId":"c1","userId":"u1","taskId":1,"nodeId":"ref_abc","toolCallId":"call_1","toolName":"demo_tool","summary":"Validated failing test and identified missing config branch.","resultRef":"refs/c1/ref_abc.md","score":8,"createdAt":"2026-05-18T00:00:00.000Z"}
```

### `.mmd` remains the task canvas artifact

L2 writes semantic Mermaid into the existing task canvas file path from `memory_task_canvases.file_path`:

```text
data/memory/task-canvases/<safe-chat-id>/<task-id>-<label>.mmd
```

SQLite stores/searches the same canvas content via FTS for task-aware recall.

---

### Task 1: Make canonical chat history JSONL-only

**Files:**
- Create: `src/memory/history/jsonl.ts`
- Create: `tests/memory/history-jsonl.test.ts`
- Modify: `src/memory/events/service.ts`
- Modify: `src/memory/integration/factory.ts`
- Modify: `src/memory/core/service.ts`
- Modify: `tests/memory/agent-runtime.test.ts`

- [ ] **Step 1: Write failing JSONL history tests**

Create `tests/memory/history-jsonl.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendChatHistoryTurn, readChatHistoryTail, searchChatHistory } from "../../src/memory/history/jsonl";
import { InteractionLogService } from "../../src/memory/events/service";

test("chat history JSONL uses canonical role-based format with monotonic per-chat ids", async () => {
  const historyDir = await mkdtemp(join(tmpdir(), "grammy-history-"));

  try {
    await appendChatHistoryTurn(historyDir, {
      chatId: "5980836755",
      userId: "5980836755",
      role: "user",
      content: "test",
      meta: { mode: "chat" },
      createdAt: "2026-05-16T17:11:04.080Z",
    });
    await appendChatHistoryTurn(historyDir, {
      chatId: "5980836755",
      userId: "5980836755",
      role: "tool",
      content: "CALL tdai_current_datetime {}",
      meta: { tool_name: "tdai_current_datetime", tool_call_id: "call_1" },
      createdAt: "2026-05-16T17:11:05.000Z",
    });

    const rows = await readChatHistoryTail(historyDir, "5980836755", 10);
    expect(rows).toEqual([
      {
        id: 1,
        chat_id: "5980836755",
        user_id: "5980836755",
        role: "user",
        content: "test",
        meta: { mode: "chat" },
        created_at: "2026-05-16T17:11:04.080Z",
      },
      {
        id: 2,
        chat_id: "5980836755",
        user_id: "5980836755",
        role: "tool",
        content: "CALL tdai_current_datetime {}",
        meta: { tool_name: "tdai_current_datetime", tool_call_id: "call_1" },
        created_at: "2026-05-16T17:11:05.000Z",
      },
    ]);
  } finally {
    await rm(historyDir, { recursive: true, force: true });
  }
});

test("chat history JSONL can return recent rows and search rows by content", async () => {
  const historyDir = await mkdtemp(join(tmpdir(), "grammy-history-"));

  try {
    await appendChatHistoryTurn(historyDir, { chatId: "c1", userId: "u1", role: "user", content: "investigate token refresh", createdAt: "2026-05-18T00:00:00.000Z" });
    await appendChatHistoryTurn(historyDir, { chatId: "c1", userId: "u1", role: "assistant", content: "I will inspect auth files", createdAt: "2026-05-18T00:00:01.000Z" });
    await appendChatHistoryTurn(historyDir, { chatId: "c2", userId: "u1", role: "user", content: "unrelated", createdAt: "2026-05-18T00:00:02.000Z" });

    expect((await readChatHistoryTail(historyDir, "c1", 1)).map((row) => row.content)).toEqual(["I will inspect auth files"]);
    expect((await searchChatHistory({ historyDir, userId: "u1", query: "token refresh", limit: 5 })).map((row) => row.chat_id)).toEqual(["c1"]);
  } finally {
    await rm(historyDir, { recursive: true, force: true });
  }
});

test("InteractionLogService writes canonical chat history and does not store raw transcript in SQLite", async () => {
  const historyDir = await mkdtemp(join(tmpdir(), "grammy-history-"));
  const events: unknown[] = [];
  let sqliteConversationWrites = 0;
  const backend = {
    async insertInteractionEvent(event: unknown) {
      events.push(event);
      return events.length;
    },
    async insertConversationTurn() {
      sqliteConversationWrites += 1;
      throw new Error("raw chat transcript must be written to JSONL, not SQLite conversations");
    },
    async listInteractionEvents() {
      return [];
    },
  };

  try {
    const service = new InteractionLogService(backend as any, { enabled: false, historyDir });
    await service.logUserMessage({ chatId: "c1", userId: "u1", content: "hello", mode: "chat" });
    await service.logAssistantMessage({ chatId: "c1", userId: "u1", content: "hi" });
    await service.logToolResult({ chatId: "c1", userId: "u1", toolName: "demo", toolCallId: "call_1", content: "RESULT demo ok", offloaded: false });

    const rows = await readChatHistoryTail(historyDir, "c1", 10);
    expect(rows.map((row) => row.role)).toEqual(["user", "assistant", "tool"]);
    expect(rows[0]).toEqual(expect.objectContaining({ id: 1, chat_id: "c1", user_id: "u1", content: "hello", meta: { mode: "chat" } }));
    expect(rows[2]?.meta).toEqual({ tool_name: "demo", tool_call_id: "call_1", offloaded: false });
    expect(sqliteConversationWrites).toBe(0);
  } finally {
    await rm(historyDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
bun test tests/memory/history-jsonl.test.ts
```

Expected: FAIL because `src/memory/history/jsonl.ts` does not exist and `InteractionLogService` still writes raw chat turns into SQLite `conversations`.

- [ ] **Step 3: Implement canonical chat history JSONL helpers**

Create `src/memory/history/jsonl.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { appendJsonl } from "../jsonl";
import type { EventMeta } from "../core/types";

export type ChatHistoryRole = "user" | "assistant" | "system" | "tool";

export type ChatHistoryRow = {
  id: number;
  chat_id: string;
  user_id: string;
  role: ChatHistoryRole;
  content: string;
  meta: EventMeta;
  created_at: string;
};

export type NewChatHistoryRow = {
  chatId: string;
  userId: string;
  role: ChatHistoryRole;
  content: string;
  meta?: EventMeta;
  createdAt?: string;
};

export function safeChatHistorySegment(chatId: string): string {
  return chatId.replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown";
}

export function getChatHistoryPath(historyDir: string, chatId: string): string {
  return join(historyDir, `${safeChatHistorySegment(chatId)}.jsonl`);
}

async function readRowsFromPath(path: string): Promise<ChatHistoryRow[]> {
  try {
    const raw = await readFile(path, "utf8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ChatHistoryRow);
  } catch {
    return [];
  }
}

export async function appendChatHistoryTurn(historyDir: string, input: NewChatHistoryRow): Promise<ChatHistoryRow> {
  const path = getChatHistoryPath(historyDir, input.chatId);
  const existing = await readRowsFromPath(path);
  const nextId = existing.reduce((max, row) => Math.max(max, row.id), 0) + 1;
  const row: ChatHistoryRow = {
    id: nextId,
    chat_id: input.chatId,
    user_id: input.userId,
    role: input.role,
    content: input.content,
    meta: input.meta ?? {},
    created_at: input.createdAt ?? new Date().toISOString(),
  };
  await appendJsonl(path, row);
  return row;
}

export async function readChatHistoryTail(historyDir: string, chatId: string, limit = 50): Promise<ChatHistoryRow[]> {
  return (await readRowsFromPath(getChatHistoryPath(historyDir, chatId))).slice(-limit);
}

async function historyPaths(historyDir: string, chatId?: string): Promise<string[]> {
  if (chatId) {
    return [getChatHistoryPath(historyDir, chatId)];
  }
  try {
    const files = await readdir(historyDir);
    return files.filter((file) => file.endsWith(".jsonl")).map((file) => join(historyDir, file));
  } catch {
    return [];
  }
}

export async function searchChatHistory(input: { historyDir: string; userId: string; query: string; limit: number; chatId?: string }): Promise<ChatHistoryRow[]> {
  const needle = input.query.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  const rows = (await Promise.all((await historyPaths(input.historyDir, input.chatId)).map((path) => readRowsFromPath(path)))).flat();
  return rows
    .filter((row) => row.user_id === input.userId)
    .filter((row) => `${row.content}\n${JSON.stringify(row.meta ?? {})}`.toLowerCase().includes(needle))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-input.limit)
    .reverse();
}

export async function countChatHistoryRows(historyDir: string, userId: string, chatId?: string): Promise<number> {
  const rows = (await Promise.all((await historyPaths(historyDir, chatId)).map((path) => readRowsFromPath(path)))).flat();
  return rows.filter((row) => row.user_id === userId).length;
}
```

- [ ] **Step 4: Update InteractionLogService to write transcript rows to JSONL only**

In `src/memory/events/service.ts`, import the history helpers:

```ts
import { appendChatHistoryTurn, countChatHistoryRows, readChatHistoryTail, searchChatHistory } from "../history/jsonl";
```

Extend `InteractionLogServiceOptions`:

```ts
type InteractionLogServiceOptions = {
  enabled?: boolean;
  exportDir?: string;
  historyDir: string;
};
```

In `logUserMessage`, keep `insertInteractionEvent`, remove the `backend.insertConversationTurn(...)` block, and add:

```ts
const meta = input.mode ? { mode: input.mode } : {};
await appendChatHistoryTurn(this.options.historyDir, {
  chatId: input.chatId,
  userId: input.userId,
  role: "user",
  content: input.content,
  meta,
  createdAt,
});
```

In `logAssistantMessage`, keep `insertInteractionEvent`, remove the `backend.insertConversationTurn(...)` block, and add:

```ts
await appendChatHistoryTurn(this.options.historyDir, {
  chatId: input.chatId,
  userId: input.userId,
  role: "assistant",
  content: input.content,
  meta: input.meta ?? {},
  createdAt,
});
```

In `logToolCall`, keep `insertInteractionEvent`, remove the `backend.insertConversationTurn(...)` block, and add:

```ts
await appendChatHistoryTurn(this.options.historyDir, {
  chatId: input.chatId,
  userId: input.userId,
  role: "tool",
  content: input.content,
  meta: { ...(input.meta ?? {}), tool_name: input.toolName, tool_call_id: input.toolCallId },
  createdAt,
});
```

In `logToolResult`, keep `insertInteractionEvent`, remove the `backend.insertConversationTurn(...)` block, and add:

```ts
await appendChatHistoryTurn(this.options.historyDir, {
  chatId: input.chatId,
  userId: input.userId,
  role: "tool",
  content: input.content,
  meta: { ...(input.meta ?? {}), tool_name: input.toolName, tool_call_id: input.toolCallId, offloaded: input.offloaded },
  createdAt,
});
```

Add read/search/count methods to `InteractionLogService`:

```ts
async recentMessages(userId: string, chatId: string, limit: number) {
  return (await readChatHistoryTail(this.options.historyDir, chatId, limit))
    .filter((row) => row.user_id === userId)
    .map((row) => ({ role: row.role, content: row.content, created_at: row.created_at, meta: row.meta }));
}

async searchConversations(userId: string, query: string, limit: number, chatId?: string) {
  return searchChatHistory({ historyDir: this.options.historyDir, userId, query, limit, chatId });
}

async countConversations(userId: string, chatId?: string) {
  return countChatHistoryRows(this.options.historyDir, userId, chatId);
}
```

Keep `exportIfEnabled()` unchanged; it remains an optional interaction-event diagnostic export and is not the canonical chat transcript.

- [ ] **Step 5: Pass `storage.historyDir` through the factory**

In `src/memory/integration/factory.ts`, extend `MemoryServiceFactoryConfig.storage`:

```ts
historyDir: string;
```

Construct `InteractionLogService` as:

```ts
const interactionLogService = new InteractionLogService(backend, {
  enabled: config.memory.jsonlExportEnabled,
  exportDir: config.storage.memoryJsonlExportDir,
  historyDir: config.storage.historyDir,
});
```

- [ ] **Step 6: Read recent/searchable chat context from JSONL**

In `src/memory/core/service.ts`, update the default `InteractionLogService` constructor argument:

```ts
interactionLogService = new InteractionLogService(backend, {
  enabled: false,
  historyDir: resolve(options.dataDir, "history"),
}),
```

In `memoryStatus()`, replace the conversation count call:

```ts
interactionLogService.countConversations(userId, chatId),
```

and keep the output label as:

```ts
`L0 conversations=${conversationCount}`,
```

In `recall()`, read raw conversation matches from JSONL and use them instead of `RecallService`'s SQLite conversation rows:

```ts
const { recallService, interactionLogService } = getState(this);
const [recall, conversationRows] = await Promise.all([
  recallService.recall(userId, query, maxResults, chatId),
  interactionLogService.searchConversations(userId, query, maxResults, chatId),
]);
return {
  persona: recall.persona,
  atoms: recall.atoms,
  scenarios: recall.scenarios.map((scenario) => ({
    id: scenario.id,
    title: scenario.title,
    bodyMarkdown: scenario.bodyMarkdown,
    body_markdown: scenario.bodyMarkdown,
  })),
  conversations: conversationRows.map((conversation) => ({
    id: conversation.id,
    role: conversation.role,
    content: conversation.content,
    createdAt: conversation.created_at,
    created_at: conversation.created_at,
  })),
  taskCanvas: recall.taskCanvas,
};
```

In `searchConversations()`, replace the backend search with JSONL search:

```ts
const { interactionLogService } = getState(this);
const conversations = await interactionLogService.searchConversations(userId, query, limit);
```

Format rows from JSONL with:

```ts
return conversations
  .map((conversation) => `#${conversation.id} [${conversation.created_at}] ${conversation.role}: ${truncateText(conversation.content, 800)}`)
  .join("\n\n");
```

In `recentMessages()`, replace the backend read with:

```ts
const { interactionLogService } = getState(this);
return interactionLogService.recentMessages(userId, chatId, limit);
```

In `judgeTaskTurn()`, replace `backend.listConversationTurns(...)` with:

```ts
interactionLogService.recentMessages(input.userId, input.chatId, options.l15.recentMessages),
```

and map `created_at` rows to `AgentMessage` the same way the existing turn mapping does.

- [ ] **Step 7: Update runtime factory test config**

Where tests call `createMemoryService(...)`, add `historyDir` to `storage`:

```ts
historyDir: join(tempDir, "history"),
```

Add this assertion to `tests/memory/agent-runtime.test.ts` after a normal chat run:

```ts
const history = await Bun.file(join(tempDir, "history", "c-time.jsonl")).text();
expect(history).toContain('"role":"user"');
expect(history).toContain('"role":"assistant"');
expect(db.query(`SELECT COUNT(*) AS count FROM conversations`).get()).toEqual({ count: 0 });
```

- [ ] **Step 8: Run focused tests**

Run:

```bash
bun test tests/memory/history-jsonl.test.ts tests/memory/agent-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/memory/history/jsonl.ts src/memory/events/service.ts src/memory/integration/factory.ts src/memory/core/service.ts tests/memory/history-jsonl.test.ts tests/memory/agent-runtime.test.ts
git commit -m "feat: use JSONL-only chat history"
```

---

### Task 2: Add config, types, and SQLite storage for L1/L2/task recall

**Files:**
- Modify: `src/config.ts`
- Modify: `.env.example`
- Modify: `src/memory/core/types.ts`
- Modify: `src/memory/core/backend.ts`
- Modify: `src/memory/backends/sqlite/migrate.ts`
- Modify: `src/memory/backends/sqlite/backend.ts`
- Modify: `tests/memory/config.test.ts`
- Modify: `tests/memory/sqlite-backend.test.ts`

- [ ] **Step 1: Write failing config tests**

Append this test to `tests/memory/config.test.ts`:

```ts
test("parseConfig exposes semantic offload defaults and overrides", () => {
  const defaults = parseConfig({
    BOT_TOKEN: "123:abc",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
  });

  expect(defaults.memory.l1).toEqual({
    enabled: true,
    mode: "local",
    maxSummaryChars: 900,
    defaultScore: 5,
  });
  expect(defaults.memory.l2).toEqual({
    enabled: true,
    mode: "local",
    triggerMinEntries: 1,
    maxCanvasChars: 12000,
  });
  expect(defaults.memory.taskRecall).toEqual({
    enabled: true,
    maxTasks: 3,
    maxCanvasChars: 2200,
  });

  const overridden = parseConfig({
    BOT_TOKEN: "123:abc",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
    MEMORY_L1_ENABLED: "false",
    MEMORY_L1_MODE: "local",
    MEMORY_L1_MAX_SUMMARY_CHARS: "700",
    MEMORY_L1_DEFAULT_SCORE: "4",
    MEMORY_L2_ENABLED: "false",
    MEMORY_L2_MODE: "local",
    MEMORY_L2_TRIGGER_MIN_ENTRIES: "3",
    MEMORY_L2_MAX_CANVAS_CHARS: "8000",
    MEMORY_TASK_RECALL_ENABLED: "false",
    MEMORY_TASK_RECALL_MAX_TASKS: "2",
    MEMORY_TASK_RECALL_MAX_CANVAS_CHARS: "1500",
  });

  expect(overridden.memory.l1).toEqual({
    enabled: false,
    mode: "local",
    maxSummaryChars: 700,
    defaultScore: 4,
  });
  expect(overridden.memory.l2).toEqual({
    enabled: false,
    mode: "local",
    triggerMinEntries: 3,
    maxCanvasChars: 8000,
  });
  expect(overridden.memory.taskRecall).toEqual({
    enabled: false,
    maxTasks: 2,
    maxCanvasChars: 1500,
  });
});
```

- [ ] **Step 2: Write failing SQLite backend tests**

Append this test to `tests/memory/sqlite-backend.test.ts`:

```ts
test("SQLite backend stores L1 evidence and indexes task canvases for recall", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-memory-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);

    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
      taskCanvasDir: join(tempDir, "memory", "task-canvases"),
    });
    await backend.init();

    const task = await backend.createTaskCanvas({ chatId: "c1", userId: "u1", label: "fix-login-flow" });
    const evidence = await backend.insertL1EvidenceEntry({
      chatId: "c1",
      userId: "u1",
      taskId: task.id,
      nodeId: "ref_l1_1",
      toolCallId: "call_1",
      toolName: "read_file",
      args: { path: "src/login.ts" },
      summary: "Read login flow and found missing token refresh branch.",
      resultRef: "refs/c1/ref_l1_1.md",
      score: 8,
      status: "pending",
    });

    expect(evidence.id).toBeNumber();
    expect(evidence.toolCallId).toBe("call_1");
    expect(evidence.score).toBe(8);

    const pending = await backend.listPendingL1EvidenceEntriesForTask(task.id, 10);
    expect(pending.map((entry) => entry.nodeId)).toEqual(["ref_l1_1"]);

    await backend.updateL1EvidenceNodeMapping(task.id, { ref_l1_1: "N1" });
    const mapped = await backend.listL1EvidenceEntriesForTask(task.id, 10);
    expect(mapped[0]).toEqual(expect.objectContaining({ nodeId: "ref_l1_1", mmdNodeId: "N1", status: "mapped" }));

    const canvas = "flowchart TD\n  N1[\"Inspect login flow<br/>status: done<br/>summary: Missing token refresh branch\"]\n";
    await backend.upsertTaskCanvasSearchText({
      taskId: task.id,
      chatId: "c1",
      userId: "u1",
      label: task.label,
      status: "active",
      filePath: task.filePath,
      canvas,
    });

    const results = await backend.searchTaskCanvases("u1", "token refresh", 5, "c1");
    expect(results).toEqual([
      expect.objectContaining({
        id: task.id,
        label: "fix-login-flow",
        filePath: task.filePath,
        canvas,
      }),
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
bun test tests/memory/config.test.ts tests/memory/sqlite-backend.test.ts
```

Expected: FAIL because `runtime.memory.l1`, `runtime.memory.l2`, `runtime.memory.taskRecall`, `insertL1EvidenceEntry`, `listPendingL1EvidenceEntriesForTask`, `updateL1EvidenceNodeMapping`, `listL1EvidenceEntriesForTask`, `upsertTaskCanvasSearchText`, and `searchTaskCanvases` do not exist yet.

- [ ] **Step 4: Add config fields**

In `src/config.ts`, add config parsing near the existing `l15` and `l4` config:

```ts
l1: {
  enabled: boolEnv(source, "MEMORY_L1_ENABLED", true),
  mode: enumEnv(source, "MEMORY_L1_MODE", "local", ["local"]),
  maxSummaryChars: intEnv(source, "MEMORY_L1_MAX_SUMMARY_CHARS", 900),
  defaultScore: intEnv(source, "MEMORY_L1_DEFAULT_SCORE", 5),
},
l2: {
  enabled: boolEnv(source, "MEMORY_L2_ENABLED", true),
  mode: enumEnv(source, "MEMORY_L2_MODE", "local", ["local"]),
  triggerMinEntries: intEnv(source, "MEMORY_L2_TRIGGER_MIN_ENTRIES", 1),
  maxCanvasChars: intEnv(source, "MEMORY_L2_MAX_CANVAS_CHARS", 12000),
},
taskRecall: {
  enabled: boolEnv(source, "MEMORY_TASK_RECALL_ENABLED", true),
  maxTasks: intEnv(source, "MEMORY_TASK_RECALL_MAX_TASKS", 3),
  maxCanvasChars: intEnv(source, "MEMORY_TASK_RECALL_MAX_CANVAS_CHARS", 2200),
},
```

Update `getRuntimeConfigSummary()` to include:

```ts
`memory.l1=${config.memory.l1.enabled ? config.memory.l1.mode : "disabled"}`,
`memory.l2=${config.memory.l2.enabled ? config.memory.l2.mode : "disabled"}`,
`memory.taskRecall=${config.memory.taskRecall.enabled ? config.memory.taskRecall.maxTasks : "disabled"}`,
```

Add to `.env.example`:

```dotenv
MEMORY_L1_ENABLED=true
MEMORY_L1_MODE=local
MEMORY_L1_MAX_SUMMARY_CHARS=900
MEMORY_L1_DEFAULT_SCORE=5
MEMORY_L2_ENABLED=true
MEMORY_L2_MODE=local
MEMORY_L2_TRIGGER_MIN_ENTRIES=1
MEMORY_L2_MAX_CANVAS_CHARS=12000
MEMORY_TASK_RECALL_ENABLED=true
MEMORY_TASK_RECALL_MAX_TASKS=3
MEMORY_TASK_RECALL_MAX_CANVAS_CHARS=2200
```

- [ ] **Step 5: Add core types**

In `src/memory/core/types.ts`, extend `TaskGraphNode` and `NewTaskGraphNode`:

```ts
toolCallId?: string;
score?: number;
mmdNodeId?: string;
```

Add these types after `NewTaskGraphNode`:

```ts
export type L1EvidenceStatus = "pending" | "mapped" | "fallback";

export type L1EvidenceEntry = {
  id: number;
  chatId: string;
  userId: string;
  taskId?: number;
  nodeId: string;
  toolCallId?: string;
  toolName: string;
  args: EventMeta;
  summary: string;
  resultRef?: string;
  score: number;
  mmdNodeId?: string;
  status: L1EvidenceStatus;
  createdAt: string;
};

export type NewL1EvidenceEntry = {
  chatId: string;
  userId: string;
  taskId?: number;
  nodeId: string;
  toolCallId?: string;
  toolName: string;
  args?: EventMeta;
  summary: string;
  resultRef?: string;
  score?: number;
  mmdNodeId?: string;
  status?: L1EvidenceStatus;
  createdAt?: string;
};

export type TaskCanvasRecall = TaskCanvas & {
  canvas: string;
};
```

Extend `MemoryRecall`:

```ts
taskCanvases: TaskCanvasRecall[];
```

- [ ] **Step 6: Add backend interface methods**

In `src/memory/core/backend.ts`, import `L1EvidenceEntry`, `NewL1EvidenceEntry`, and `TaskCanvasRecall`, then add these methods to `MemoryBackend`:

```ts
insertL1EvidenceEntry(entry: NewL1EvidenceEntry): Promise<L1EvidenceEntry>;
listL1EvidenceEntriesForTask(taskId: number, limit: number): Promise<L1EvidenceEntry[]>;
listPendingL1EvidenceEntriesForTask(taskId: number, limit: number): Promise<L1EvidenceEntry[]>;
updateL1EvidenceNodeMapping(taskId: number, mapping: Record<string, string>): Promise<void>;
getL1EvidenceJsonlPath(chatId: string): Promise<{ absolutePath: string; relativePath: string }>;
upsertTaskCanvasSearchText(input: { taskId: number; chatId: string; userId: string; label: string; status: TaskCanvasStatus; filePath: string; canvas: string }): Promise<void>;
searchTaskCanvases(userId: string, query: string, limit: number, chatId?: string): Promise<TaskCanvasRecall[]>;
```

- [ ] **Step 7: Add SQLite schema and methods**

In `src/memory/backends/sqlite/migrate.ts`, add the SQL and forward-only column migrations described in the Data Model section.

In `src/memory/backends/sqlite/backend.ts`, add a helper:

```ts
function mapL1EvidenceRow(row: {
  id: number;
  chat_id: string;
  user_id: string;
  task_id: number | null;
  node_id: string;
  tool_call_id: string | null;
  tool_name: string;
  args_json: string;
  summary: string;
  result_ref: string | null;
  score: number;
  mmd_node_id: string | null;
  status: string;
  created_at: string;
}): L1EvidenceEntry {
  return {
    id: row.id,
    chatId: row.chat_id,
    userId: row.user_id,
    taskId: row.task_id ?? undefined,
    nodeId: row.node_id,
    toolCallId: row.tool_call_id ?? undefined,
    toolName: row.tool_name,
    args: parseEventMeta(row.args_json),
    summary: row.summary,
    resultRef: row.result_ref ?? undefined,
    score: row.score,
    mmdNodeId: row.mmd_node_id ?? undefined,
    status: row.status as L1EvidenceStatus,
    createdAt: row.created_at,
  };
}
```

Implement `insertL1EvidenceEntry`:

```ts
async insertL1EvidenceEntry(entry: NewL1EvidenceEntry): Promise<L1EvidenceEntry> {
  const createdAt = entry.createdAt ?? nowIso();
  const status = entry.status ?? "pending";
  const score = entry.score ?? 5;
  const result = this.db
    .query(`
      INSERT INTO memory_l1_evidence_entries (
        chat_id, user_id, task_id, node_id, tool_call_id, tool_name, args_json,
        summary, result_ref, score, mmd_node_id, status, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      entry.chatId,
      entry.userId,
      entry.taskId ?? null,
      entry.nodeId,
      entry.toolCallId ?? null,
      entry.toolName,
      JSON.stringify(entry.args ?? {}),
      entry.summary,
      entry.resultRef ?? null,
      score,
      entry.mmdNodeId ?? null,
      status,
      createdAt,
    );

  return {
    id: Number(result.lastInsertRowid),
    chatId: entry.chatId,
    userId: entry.userId,
    taskId: entry.taskId,
    nodeId: entry.nodeId,
    toolCallId: entry.toolCallId,
    toolName: entry.toolName,
    args: entry.args ?? {},
    summary: entry.summary,
    resultRef: entry.resultRef,
    score,
    mmdNodeId: entry.mmdNodeId,
    status,
    createdAt,
  };
}
```

Implement `updateL1EvidenceNodeMapping` so both the new table and compatibility table stay aligned:

```ts
async updateL1EvidenceNodeMapping(taskId: number, mapping: Record<string, string>): Promise<void> {
  const updateEvidence = this.db.query(`
    UPDATE memory_l1_evidence_entries
    SET mmd_node_id = ?, status = 'mapped'
    WHERE task_id = ? AND node_id = ?
  `);
  const updateNode = this.db.query(`
    UPDATE memory_task_nodes
    SET mmd_node_id = ?
    WHERE task_id = ? AND node_id = ?
  `);

  const tx = this.db.transaction(() => {
    for (const [nodeId, mmdNodeId] of Object.entries(mapping)) {
      updateEvidence.run(mmdNodeId, taskId, nodeId);
      updateNode.run(mmdNodeId, taskId, nodeId);
    }
  });
  tx();
}
```

Implement `getL1EvidenceJsonlPath` using the same safe chat segment convention as refs/canvases:

```ts
async getL1EvidenceJsonlPath(chatId: string): Promise<{ absolutePath: string; relativePath: string }> {
  const relativePath = join("memory", "jsonl", "l1", `${safeChatSegment(chatId)}.jsonl`);
  return {
    absolutePath: join(this.options.dataDir, relativePath),
    relativePath,
  };
}
```

Implement task canvas FTS upsert/search:

```ts
async upsertTaskCanvasSearchText(input: { taskId: number; chatId: string; userId: string; label: string; status: TaskCanvasStatus; filePath: string; canvas: string }): Promise<void> {
  this.db.query(`DELETE FROM memory_task_canvas_fts WHERE task_id = ?`).run(String(input.taskId));
  this.db.query(`
    INSERT INTO memory_task_canvas_fts (label, canvas, task_id, chat_id, user_id, status, file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(input.label, input.canvas, String(input.taskId), input.chatId, input.userId, input.status, input.filePath);
}

async searchTaskCanvases(userId: string, query: string, limit: number, chatId?: string): Promise<TaskCanvasRecall[]> {
  const rows = this.db
    .query(`
      SELECT task_id, chat_id, user_id, label, status, file_path, canvas
      FROM memory_task_canvas_fts
      WHERE user_id = ?
        AND (? IS NULL OR chat_id = ?)
        AND memory_task_canvas_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `)
    .all(userId, chatId ?? null, chatId ?? null, query, limit) as Array<{
      task_id: string;
      chat_id: string;
      user_id: string;
      label: string;
      status: TaskCanvasStatus;
      file_path: string;
      canvas: string;
    }>;

  return rows.map((row) => ({
    id: Number(row.task_id),
    chatId: row.chat_id,
    userId: row.user_id,
    label: row.label,
    filePath: row.file_path,
    status: row.status,
    createdAt: "",
    updatedAt: "",
    canvas: row.canvas,
  }));
}
```

- [ ] **Step 8: Run tests and verify they pass**

Run:

```bash
bun test tests/memory/config.test.ts tests/memory/sqlite-backend.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add .env.example src/config.ts src/memory/core/types.ts src/memory/core/backend.ts src/memory/backends/sqlite/migrate.ts src/memory/backends/sqlite/backend.ts tests/memory/config.test.ts tests/memory/sqlite-backend.test.ts
git commit -m "feat: add semantic offload storage"
```

---

### Task 3: Implement L1 semantic evidence summarizer

**Files:**
- Create: `src/memory/offload/l1.ts`
- Create: `tests/memory/l1.test.ts`

- [ ] **Step 1: Write failing L1 tests**

Create `tests/memory/l1.test.ts`:

```ts
import { expect, test } from "bun:test";
import { buildFallbackL1Summary, generateL1EvidenceSummary, parseL1EvidenceJson } from "../../src/memory/offload/l1";

test("parseL1EvidenceJson accepts strict semantic evidence JSON", () => {
  const parsed = parseL1EvidenceJson(JSON.stringify({
    summary: "Read auth middleware and found token refresh missing from retry branch.",
    score: 8,
  }));

  expect(parsed).toEqual({
    summary: "Read auth middleware and found token refresh missing from retry branch.",
    score: 8,
  });
});

test("parseL1EvidenceJson rejects malformed summaries", () => {
  expect(parseL1EvidenceJson("not json")).toBeUndefined();
  expect(parseL1EvidenceJson(JSON.stringify({ summary: "", score: 8 }))).toBeUndefined();
  expect(parseL1EvidenceJson(JSON.stringify({ summary: "ok", score: 99 }))).toBeUndefined();
});

test("buildFallbackL1Summary produces bounded deterministic summary", () => {
  const fallback = buildFallbackL1Summary("a\n".repeat(100), 30, 4);
  expect(fallback.summary.length).toBeLessThanOrEqual(30);
  expect(fallback.score).toBe(4);
});

test("generateL1EvidenceSummary uses local LLM response", async () => {
  const calls: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  const llm = {
    async complete(input: { messages: Array<{ role: string; content: string }> }) {
      calls.push(input);
      return {
        content: JSON.stringify({
          summary: "Ran targeted test and confirmed task-aware recall currently misses completed task canvas.",
          score: 9,
        }),
        toolCalls: [],
      };
    },
  };

  const summary = await generateL1EvidenceSummary(llm as any, {
    toolName: "bun_test",
    toolCallId: "call_1",
    args: { file: "tests/memory/task-recall.test.ts" },
    rawResult: "FAIL task-aware recall currently returns only active canvas",
    maxSummaryChars: 120,
    defaultScore: 5,
  });

  expect(summary).toEqual({
    summary: "Ran targeted test and confirmed task-aware recall currently misses completed task canvas.",
    score: 9,
  });
  expect(calls[0]?.messages[0]?.content).toContain("semantic L1 evidence summary");
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
bun test tests/memory/l1.test.ts
```

Expected: FAIL because `src/memory/offload/l1.ts` does not exist.

- [ ] **Step 3: Implement L1 module**

Create `src/memory/offload/l1.ts`:

```ts
import type { LlmProvider } from "../../agent/types";
import { truncateText } from "../../utils/text";
import type { EventMeta } from "../core/types";

export type L1EvidenceSummary = {
  summary: string;
  score: number;
};

export type L1EvidenceInput = {
  toolName: string;
  toolCallId?: string;
  args: EventMeta;
  rawResult: string;
  maxSummaryChars: number;
  defaultScore: number;
};

export function parseL1EvidenceJson(content: string): L1EvidenceSummary | undefined {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const summary = (parsed as { summary?: unknown }).summary;
    const score = (parsed as { score?: unknown }).score;
    if (typeof summary !== "string" || summary.trim().length === 0) {
      return undefined;
    }
    if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 10) {
      return undefined;
    }
    return { summary: summary.trim(), score };
  } catch {
    return undefined;
  }
}

export function buildFallbackL1Summary(rawResult: string, maxSummaryChars: number, defaultScore: number): L1EvidenceSummary {
  return {
    summary: truncateText(rawResult.replace(/\s+/g, " ").trim(), maxSummaryChars),
    score: defaultScore,
  };
}

export async function generateL1EvidenceSummary(llm: LlmProvider, input: L1EvidenceInput): Promise<L1EvidenceSummary> {
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
          rawResult: truncateText(input.rawResult, Math.max(input.maxSummaryChars * 8, 2000)),
        }),
      },
    ],
    tools: [],
  });

  const parsed = parseL1EvidenceJson(response.content);
  if (!parsed) {
    return buildFallbackL1Summary(input.rawResult, input.maxSummaryChars, input.defaultScore);
  }

  return {
    summary: truncateText(parsed.summary, input.maxSummaryChars),
    score: parsed.score,
  };
}
```

- [ ] **Step 4: Run L1 tests**

Run:

```bash
bun test tests/memory/l1.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/memory/offload/l1.ts tests/memory/l1.test.ts
git commit -m "feat: add L1 semantic evidence summarizer"
```

---

### Task 4: Wire L1 semantic summaries into offload with SQLite and JSONL

**Files:**
- Modify: `src/memory/offload/service.ts`
- Modify: `src/memory/core/service.ts`
- Modify: `src/memory/integration/factory.ts`
- Modify: `src/agent/react-agent.ts`
- Modify: `tests/memory/offload.test.ts`
- Modify: `tests/memory/agent-runtime.test.ts`

- [ ] **Step 1: Write failing offload integration test**

Append to `tests/memory/offload.test.ts`:

```ts
test("offload writes semantic L1 evidence to SQLite and JSONL", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-offload-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
      taskCanvasDir: join(tempDir, "task-canvases"),
    });
    await backend.init();
    const task = await backend.createTaskCanvas({ chatId: "c1", userId: "u1", label: "semantic-task" });

    const llm = {
      async complete() {
        return {
          content: JSON.stringify({ summary: "Confirmed the failing recall test targets missing historical canvas retrieval.", score: 9 }),
          toolCalls: [],
        };
      },
    };

    const service = new OffloadService(backend, {
      offloadMinChars: 1000,
      offloadSummaryChars: 80,
      l1: { enabled: true, mode: "local", maxSummaryChars: 160, defaultScore: 5 },
      l2: { enabled: false, mode: "local", triggerMinEntries: 1, maxCanvasChars: 12000 },
      jsonlEnabled: true,
    }, llm as any);

    const result = await service.offloadToolResult({
      chatId: "c1",
      userId: "u1",
      taskId: task.id,
      toolCallId: "call_1",
      toolName: "bun_test",
      args: { file: "tests/memory/task-recall.test.ts" },
      rawResult: "FAIL recall did not include completed canvas",
    });

    expect(result.summary).toBe("Confirmed the failing recall test targets missing historical canvas retrieval.");

    const evidenceRows = await backend.listL1EvidenceEntriesForTask(task.id, 10);
    expect(evidenceRows).toEqual([
      expect.objectContaining({
        nodeId: result.nodeId,
        toolCallId: "call_1",
        summary: "Confirmed the failing recall test targets missing historical canvas retrieval.",
        score: 9,
      }),
    ]);

    const jsonlPath = join(tempDir, "memory", "jsonl", "l1", "c1.jsonl");
    const jsonl = await Bun.file(jsonlPath).text();
    expect(jsonl).toContain('"type":"l1_evidence"');
    expect(jsonl).toContain('"toolCallId":"call_1"');
    expect(jsonl).toContain('"score":9');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Write failing runtime toolCallId test**

Append to `tests/memory/agent-runtime.test.ts`:

```ts
test("agent runtime passes tool call id into semantic L1 offload", async () => {
  const llmCalls: Array<Array<{ role: string; content?: string }>> = [];
  const llm = {
    async complete({ messages }: { messages: Array<{ role: string; content?: string }> }) {
      llmCalls.push(messages);
      if (llmCalls.length === 1) {
        return { content: "I will inspect time.", toolCalls: [{ id: "call_time", name: "tdai_current_datetime", arguments: {} }] };
      }
      if (messages.some((message) => message.content?.includes("semantic L1 evidence summary"))) {
        return { content: JSON.stringify({ summary: "Resolved current datetime with explicit weekday fields.", score: 8 }), toolCalls: [] };
      }
      return { content: "Done", toolCalls: [] };
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
        memoryTaskCanvasDir: join(tempDir, "memory", "task-canvases"),
        memoryGeneratedSkillsDir: join(tempDir, "memory", "skills"),
      },
      memory: {
        maintenanceCron: "*/10 * * * *",
        offloadEnabled: true,
        offloadMinChars: 2500,
        offloadSummaryChars: 900,
        sqliteVecEnabled: true,
        jsonlExportEnabled: true,
        l15: { enabled: true, mode: "rules", recentMessages: 6, historyTaskLimit: 10, maxCanvasChars: 12000, safeFallback: "short" },
        l4: { enabled: true, mode: "local", requireCompletedTask: false, maxEvidenceEntries: 80, maxCanvasChars: 20000, maxSkillChars: 20000 },
        l1: { enabled: true, mode: "local", maxSummaryChars: 900, defaultScore: 5 },
        l2: { enabled: false, mode: "local", triggerMinEntries: 1, maxCanvasChars: 12000 },
        taskRecall: { enabled: true, maxTasks: 3, maxCanvasChars: 2200 },
      },
    });
    const registry = new ToolRegistry(db);
    registry.registerMany(createLocalTools(memory));

    await runReactAgent({ chatId: "c-time", userId: "u1", input: "sekarang hari apa?", memory, registry, llm: llm as any, mode: "chat" });

    const rows = db.query(`SELECT tool_call_id FROM memory_l1_evidence_entries ORDER BY id ASC`).all() as Array<{ tool_call_id: string | null }>;
    expect(rows).toEqual([{ tool_call_id: "call_time" }]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
bun test tests/memory/offload.test.ts tests/memory/agent-runtime.test.ts
```

Expected: FAIL because `OffloadService` does not accept L1/L2/jsonl options or `toolCallId`, and agent runtime does not pass `toolCallId` into offload.

- [ ] **Step 4: Update OffloadService types and constructor**

In `src/memory/offload/service.ts`, import `appendFile`, `LlmProvider`, and L1 helper:

```ts
import { appendFile, mkdir, unlink, writeFile } from "node:fs/promises";
import type { LlmProvider } from "../../agent/types";
import { generateL1EvidenceSummary } from "./l1";
```

Replace `OffloadServiceOptions` with:

```ts
type OffloadServiceOptions = {
  offloadMinChars: number;
  offloadSummaryChars: number;
  l1: {
    enabled: boolean;
    mode: "local";
    maxSummaryChars: number;
    defaultScore: number;
  };
  l2: {
    enabled: boolean;
    mode: "local";
    triggerMinEntries: number;
    maxCanvasChars: number;
  };
  jsonlEnabled: boolean;
};
```

Extend `OffloadToolResultInput`:

```ts
toolCallId?: string;
```

Change the constructor:

```ts
constructor(
  private readonly backend: MemoryBackend,
  private readonly options: OffloadServiceOptions,
  private readonly llm: LlmProvider,
  private readonly writeTextFile: FileWriter = (path, content) => writeFile(path, content, "utf8"),
) {}
```

- [ ] **Step 5: Persist L1 evidence and JSONL**

Add this method to `OffloadService`:

```ts
private async writeL1Jsonl(input: {
  chatId: string;
  userId: string;
  taskId?: number;
  nodeId: string;
  toolCallId?: string;
  toolName: string;
  summary: string;
  resultRef?: string;
  score: number;
  createdAt: string;
}): Promise<void> {
  if (!this.options.jsonlEnabled) {
    return;
  }
  const jsonlPath = await this.backend.getL1EvidenceJsonlPath(input.chatId);
  await mkdir(dirname(jsonlPath.absolutePath), { recursive: true });
  await appendFile(
    jsonlPath.absolutePath,
    `${JSON.stringify({ type: "l1_evidence", ...input })}\n`,
    "utf8",
  );
}
```

In `offloadToolResult`, replace the initial `summary` assignment:

```ts
const semantic = this.options.l1.enabled
  ? await generateL1EvidenceSummary(this.llm, {
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      args: input.args,
      rawResult: input.rawResult,
      maxSummaryChars: this.options.l1.maxSummaryChars,
      defaultScore: this.options.l1.defaultScore,
    })
  : { summary: summarize(input.rawResult, this.options.offloadSummaryChars), score: this.options.l1.defaultScore };
const summary = semantic.summary;
const score = semantic.score;
const createdAt = new Date().toISOString();
```

Whenever `insertTaskGraphNode` or `insertOffloadRefWithTaskGraphNode` is called, include:

```ts
toolCallId: input.toolCallId,
score,
```

After node/ref metadata is committed, call:

```ts
await this.backend.insertL1EvidenceEntry({
  chatId: input.chatId,
  userId: input.userId,
  taskId: input.taskId,
  nodeId,
  toolCallId: input.toolCallId,
  toolName: input.toolName,
  args: input.args,
  summary,
  resultRef: shouldOffload ? relativePath : undefined,
  score,
  status: input.taskId ? "pending" : "mapped",
  createdAt,
});
await this.writeL1Jsonl({
  chatId: input.chatId,
  userId: input.userId,
  taskId: input.taskId,
  nodeId,
  toolCallId: input.toolCallId,
  toolName: input.toolName,
  summary,
  resultRef: shouldOffload ? relativePath : undefined,
  score,
  createdAt,
});
```

For non-task short QA, status is `mapped` because L2 should not process it.

- [ ] **Step 6: Pass config and LLM through factory/service**

In `src/memory/integration/factory.ts`, add defaults:

```ts
const defaultL1 = { enabled: true, mode: "local" as const, maxSummaryChars: 900, defaultScore: 5 };
const defaultL2 = { enabled: true, mode: "local" as const, triggerMinEntries: 1, maxCanvasChars: 12000 };
const defaultTaskRecall = { enabled: true, maxTasks: 3, maxCanvasChars: 2200 };
```

Extend `MemoryServiceFactoryConfig.memory` with optional `l1`, `l2`, and `taskRecall` matching Task 2.

Construct `OffloadService` as:

```ts
const offloadService = new OffloadService(backend, {
  offloadMinChars: config.memory.offloadEnabled ? config.memory.offloadMinChars : Number.MAX_SAFE_INTEGER,
  offloadSummaryChars: config.memory.offloadSummaryChars,
  l1: config.memory.l1 ?? defaultL1,
  l2: config.memory.l2 ?? defaultL2,
  jsonlEnabled: config.memory.jsonlExportEnabled,
}, llm);
```

Pass `l1`, `l2`, and `taskRecall` into `MemoryServiceOptions`.

- [ ] **Step 7: Pass toolCallId from agent runtime**

In `src/agent/react-agent.ts`, update the call at `offloadToolResult`:

```ts
const offload = await input.memory.offloadToolResult({
  chatId: input.chatId,
  userId: input.userId,
  taskId: taskRouting.taskId,
  toolCallId: call.id,
  toolName: call.name,
  args: asEventMeta(call.arguments ?? {}),
  rawResult,
});
```

Update `MemoryService.offloadToolResult` input type in `src/memory/core/service.ts` to include `toolCallId?: string`, and forward it to `offloadService.offloadToolResult`.

- [ ] **Step 8: Run tests**

Run:

```bash
bun test tests/memory/l1.test.ts tests/memory/offload.test.ts tests/memory/agent-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/memory/offload/service.ts src/memory/core/service.ts src/memory/integration/factory.ts src/agent/react-agent.ts tests/memory/offload.test.ts tests/memory/agent-runtime.test.ts
git commit -m "feat: persist L1 semantic evidence"
```

---

### Task 5: Implement L2 semantic Mermaid parser and patcher

**Files:**
- Create: `src/memory/offload/l2.ts`
- Create: `tests/memory/l2.test.ts`

- [ ] **Step 1: Write failing L2 tests**

Create `tests/memory/l2.test.ts`:

```ts
import { expect, test } from "bun:test";
import { applyL2Patch, generateL2MermaidPatch, parseL2MermaidJson, validateMermaidCanvas } from "../../src/memory/offload/l2";

test("parseL2MermaidJson accepts write response with node mapping", () => {
  const parsed = parseL2MermaidJson(JSON.stringify({
    fileAction: "write",
    mmdContent: "flowchart TD\n  N1[\"Inspect tests<br/>status: done<br/>summary: Found missing recall\"]\n",
    replaceBlocks: [],
    nodeMapping: { ref_a: "N1" },
  }));

  expect(parsed).toEqual({
    fileAction: "write",
    mmdContent: "flowchart TD\n  N1[\"Inspect tests<br/>status: done<br/>summary: Found missing recall\"]\n",
    replaceBlocks: [],
    nodeMapping: { ref_a: "N1" },
  });
});

test("applyL2Patch applies replace blocks with 1-based line numbers", () => {
  const current = "flowchart TD\n  N1[\"Old\"]\n  N2[\"Keep\"]\n";
  const patched = applyL2Patch(current, {
    fileAction: "replace",
    mmdContent: null,
    replaceBlocks: [{ startLine: 2, endLine: 2, content: "  N1[\"New\"]" }],
    nodeMapping: { ref_a: "N1" },
  });

  expect(patched).toBe("flowchart TD\n  N1[\"New\"]\n  N2[\"Keep\"]\n");
});

test("validateMermaidCanvas rejects non-flowchart content", () => {
  expect(validateMermaidCanvas("flowchart TD\n  N1[\"ok\"]\n")).toBe(true);
  expect(validateMermaidCanvas("console.log('not mermaid')")).toBe(false);
});

test("generateL2MermaidPatch uses local LLM response", async () => {
  const llm = {
    async complete() {
      return {
        content: JSON.stringify({
          fileAction: "write",
          mmdContent: "flowchart TD\n  N1[\"Run test<br/>status: done<br/>summary: Recall failure reproduced\"]\n",
          replaceBlocks: [],
          nodeMapping: { ref_test: "N1" },
        }),
        toolCalls: [],
      };
    },
  };

  const patch = await generateL2MermaidPatch(llm as any, {
    taskLabel: "task-aware-recall",
    currentMmd: "flowchart TD\n",
    entries: [{ nodeId: "ref_test", toolName: "bun_test", summary: "Recall failure reproduced", score: 9, resultRef: "refs/c1/ref_test.md" }],
    maxCanvasChars: 12000,
  });

  expect(patch?.nodeMapping).toEqual({ ref_test: "N1" });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
bun test tests/memory/l2.test.ts
```

Expected: FAIL because `src/memory/offload/l2.ts` does not exist.

- [ ] **Step 3: Implement L2 module**

Create `src/memory/offload/l2.ts`:

```ts
import type { LlmProvider } from "../../agent/types";
import { truncateText } from "../../utils/text";

export type L2EvidenceEntry = {
  nodeId: string;
  toolName?: string;
  summary: string;
  score: number;
  resultRef?: string;
};

export type L2ReplaceBlock = {
  startLine: number;
  endLine: number;
  content: string;
};

export type L2MermaidPatch = {
  fileAction: "write" | "replace";
  mmdContent: string | null;
  replaceBlocks: L2ReplaceBlock[];
  nodeMapping: Record<string, string>;
};

export type L2Input = {
  taskLabel: string;
  currentMmd: string;
  entries: L2EvidenceEntry[];
  maxCanvasChars: number;
};

export function parseL2MermaidJson(content: string): L2MermaidPatch | undefined {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const value = parsed as Record<string, unknown>;
    if (value.fileAction !== "write" && value.fileAction !== "replace") {
      return undefined;
    }
    const replaceBlocks = Array.isArray(value.replaceBlocks)
      ? value.replaceBlocks.map((block) => ({
          startLine: Number((block as { startLine?: unknown }).startLine),
          endLine: Number((block as { endLine?: unknown }).endLine),
          content: String((block as { content?: unknown }).content ?? ""),
        }))
      : [];
    if (replaceBlocks.some((block) => !Number.isInteger(block.startLine) || !Number.isInteger(block.endLine) || block.startLine < 1 || block.endLine < block.startLine)) {
      return undefined;
    }
    if (!value.nodeMapping || typeof value.nodeMapping !== "object" || Array.isArray(value.nodeMapping)) {
      return undefined;
    }
    const nodeMapping = Object.fromEntries(
      Object.entries(value.nodeMapping as Record<string, unknown>)
        .filter(([key, val]) => key && typeof val === "string" && val.trim())
        .map(([key, val]) => [key, String(val).trim()]),
    );
    if (Object.keys(nodeMapping).length === 0) {
      return undefined;
    }
    const mmdContent = typeof value.mmdContent === "string" ? value.mmdContent : null;
    if (value.fileAction === "write" && !mmdContent) {
      return undefined;
    }
    if (value.fileAction === "replace" && replaceBlocks.length === 0) {
      return undefined;
    }
    return { fileAction: value.fileAction, mmdContent, replaceBlocks, nodeMapping };
  } catch {
    return undefined;
  }
}

export function validateMermaidCanvas(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith("flowchart TD") || trimmed.startsWith("graph TD") || trimmed.startsWith("graph LR") || trimmed.startsWith("flowchart LR");
}

export function applyL2Patch(currentMmd: string, patch: L2MermaidPatch): string {
  if (patch.fileAction === "write") {
    return `${patch.mmdContent!.trimEnd()}\n`;
  }

  const lines = currentMmd.replace(/\r\n/g, "\n").split("\n");
  const ordered = [...patch.replaceBlocks].sort((a, b) => b.startLine - a.startLine);
  for (const block of ordered) {
    lines.splice(block.startLine - 1, block.endLine - block.startLine + 1, ...block.content.replace(/\r\n/g, "\n").split("\n"));
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function generateL2MermaidPatch(llm: LlmProvider, input: L2Input): Promise<L2MermaidPatch | undefined> {
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
  });

  const parsed = parseL2MermaidJson(response.content);
  if (!parsed) {
    return undefined;
  }
  const candidate = applyL2Patch(input.currentMmd, parsed);
  if (!validateMermaidCanvas(candidate) || candidate.length > input.maxCanvasChars) {
    return undefined;
  }
  return parsed;
}
```

- [ ] **Step 4: Run L2 tests**

Run:

```bash
bun test tests/memory/l2.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/memory/offload/l2.ts tests/memory/l2.test.ts
git commit -m "feat: add L2 Mermaid patcher"
```

---

### Task 6: Wire L2 semantic Mermaid patching into task-scoped `.mmd` files

**Files:**
- Modify: `src/memory/offload/service.ts`
- Modify: `src/memory/backends/sqlite/backend.ts`
- Modify: `tests/memory/offload.test.ts`
- Modify: `tests/memory/agent-runtime.test.ts`

- [ ] **Step 1: Write failing offload L2 integration test**

Append to `tests/memory/offload.test.ts`:

```ts
test("task-scoped offload patches semantic Mermaid canvas and records node mapping", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-offload-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
      taskCanvasDir: join(tempDir, "task-canvases"),
    });
    await backend.init();
    const task = await backend.createTaskCanvas({ chatId: "c1", userId: "u1", label: "semantic-mermaid" });

    let callCount = 0;
    const llm = {
      async complete() {
        callCount += 1;
        if (callCount === 1) {
          return { content: JSON.stringify({ summary: "Ran failing test and found missing semantic canvas patch.", score: 9 }), toolCalls: [] };
        }
        return {
          content: JSON.stringify({
            fileAction: "write",
            mmdContent: "flowchart TD\n  N1[\"Test failure<br/>status: done<br/>summary: Missing semantic canvas patch\"]\n",
            replaceBlocks: [],
            nodeMapping: { semanticNode: "N1" },
          }).replace("semanticNode", ""),
          toolCalls: [],
        };
      },
    };

    const service = new OffloadService(backend, {
      offloadMinChars: 1000,
      offloadSummaryChars: 80,
      l1: { enabled: true, mode: "local", maxSummaryChars: 160, defaultScore: 5 },
      l2: { enabled: true, mode: "local", triggerMinEntries: 1, maxCanvasChars: 12000 },
      jsonlEnabled: false,
    }, llm as any);

    const result = await service.offloadToolResult({
      chatId: "c1",
      userId: "u1",
      taskId: task.id,
      toolCallId: "call_1",
      toolName: "bun_test",
      args: {},
      rawResult: "FAIL Missing semantic canvas patch",
    });

    const canvas = await backend.getTaskCanvas("c1");
    expect(canvas).toContain("flowchart TD");
    expect(canvas).toContain("Test failure");
    expect(canvas).toContain("Missing semantic canvas patch");

    const evidence = await backend.listL1EvidenceEntriesForTask(task.id, 10);
    expect(evidence[0]).toEqual(expect.objectContaining({ nodeId: result.nodeId, mmdNodeId: "N1", status: "mapped" }));

    const taskNodes = await backend.listTaskGraphNodesForTask(task.id, 10);
    expect(taskNodes[0]).toEqual(expect.objectContaining({ nodeId: result.nodeId, mmdNodeId: "N1" }));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

Before running this test, replace the intentionally awkward JSON generation with a dynamic object after `result.nodeId` is known by configuring the test LLM to capture the user prompt and map the input node id:

```ts
const llm = {
  async complete({ messages }: { messages: Array<{ content: string }> }) {
    callCount += 1;
    if (callCount === 1) {
      return { content: JSON.stringify({ summary: "Ran failing test and found missing semantic canvas patch.", score: 9 }), toolCalls: [] };
    }
    const payload = JSON.parse(messages[1]!.content) as { entries: Array<{ nodeId: string }> };
    return {
      content: JSON.stringify({
        fileAction: "write",
        mmdContent: "flowchart TD\n  N1[\"Test failure<br/>status: done<br/>summary: Missing semantic canvas patch\"]\n",
        replaceBlocks: [],
        nodeMapping: { [payload.entries[0]!.nodeId]: "N1" },
      }),
      toolCalls: [],
    };
  },
};
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
bun test tests/memory/offload.test.ts
```

Expected: FAIL because OffloadService still writes deterministic `graph LR` canvas and never runs L2.

- [ ] **Step 3: Add L2 patching to OffloadService**

In `src/memory/offload/service.ts`, import L2 helpers:

```ts
import { applyL2Patch, generateL2MermaidPatch } from "./l2";
```

Replace `writeTaskCanvas` with semantic L2 logic:

```ts
private async writeTaskCanvas(chatId: string, taskId: number | undefined): Promise<void> {
  if (!taskId) {
    return;
  }
  const canvasPath = await this.backend.getTaskCanvasFilePath(taskId);
  if (!canvasPath) {
    return;
  }

  const pending = await this.backend.listPendingL1EvidenceEntriesForTask(taskId, this.options.l2.triggerMinEntries);
  if (this.options.l2.enabled && pending.length >= this.options.l2.triggerMinEntries) {
    const currentMmd = await this.readExistingCanvas(canvasPath.absolutePath);
    const task = await this.backend.getTaskCanvasById(pending[0]!.userId, taskId);
    const patch = task
      ? await generateL2MermaidPatch(this.llm, {
          taskLabel: task.label,
          currentMmd,
          entries: pending.map((entry) => ({
            nodeId: entry.nodeId,
            toolName: entry.toolName,
            summary: entry.summary,
            score: entry.score,
            resultRef: entry.resultRef,
          })),
          maxCanvasChars: this.options.l2.maxCanvasChars,
        })
      : undefined;

    if (patch) {
      const nextMmd = applyL2Patch(currentMmd, patch);
      await mkdir(dirname(canvasPath.absolutePath), { recursive: true });
      await this.writeTextFile(canvasPath.absolutePath, nextMmd);
      await this.backend.updateL1EvidenceNodeMapping(taskId, patch.nodeMapping);
      if (task) {
        await this.backend.upsertTaskCanvasSearchText({
          taskId,
          chatId,
          userId: task.userId,
          label: task.label,
          status: task.status,
          filePath: task.filePath,
          canvas: nextMmd,
        });
      }
      return;
    }
  }

  const nodes = await this.backend.listTaskGraphNodesForTask(taskId, 80);
  const fallbackMmd = `${this.buildTaskCanvas(chatId, nodes)}\n`;
  await mkdir(dirname(canvasPath.absolutePath), { recursive: true });
  await this.writeTextFile(canvasPath.absolutePath, fallbackMmd);
  const task = nodes[0]?.userId ? await this.backend.getTaskCanvasById(nodes[0].userId, taskId) : undefined;
  if (task) {
    await this.backend.upsertTaskCanvasSearchText({
      taskId,
      chatId,
      userId: task.userId,
      label: task.label,
      status: task.status,
      filePath: task.filePath,
      canvas: fallbackMmd,
    });
  }
}
```

Add helper:

```ts
private async readExistingCanvas(path: string): Promise<string> {
  try {
    return await Bun.file(path).text();
  } catch {
    return "flowchart TD\n";
  }
}
```

- [ ] **Step 4: Keep compatibility canvas behavior**

Ensure `buildTaskCanvas` stays in `OffloadService`; it is still used when L2 is disabled, LLM output is malformed, or validation rejects the patch.

- [ ] **Step 5: Run focused tests**

Run:

```bash
bun test tests/memory/l2.test.ts tests/memory/offload.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/memory/offload/service.ts src/memory/backends/sqlite/backend.ts tests/memory/offload.test.ts tests/memory/agent-runtime.test.ts
git commit -m "feat: patch task canvases with L2 Mermaid"
```

---

### Task 7: Add task-aware recall for active and historical task canvases

**Files:**
- Modify: `src/memory/recall/service.ts`
- Modify: `src/memory/core/types.ts`
- Modify: `src/memory/core/service.ts`
- Modify: `src/agent/react-agent.ts`
- Modify: `src/tools/local.ts`
- Create: `tests/memory/task-recall.test.ts`
- Modify: `tests/memory/agent-runtime.test.ts`

- [ ] **Step 1: Write failing task recall tests**

Create `tests/memory/task-recall.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { migrateSqliteMemory } from "../../src/memory/backends/sqlite/migrate";
import { SqliteMemoryBackend } from "../../src/memory/backends/sqlite/backend";
import { RecallService } from "../../src/memory/recall/service";

test("recall returns active and relevant historical task canvases", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-task-recall-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
      taskCanvasDir: join(tempDir, "task-canvases"),
    });
    await backend.init();

    const active = await backend.createTaskCanvas({ chatId: "c1", userId: "u1", label: "active-login-task", status: "active" });
    const activeCanvas = "flowchart TD\n  A[\"Active login task\"]\n";
    await writeFile(join(tempDir, active.filePath), activeCanvas, "utf8");
    await backend.upsertTaskCanvasSearchText({ taskId: active.id, chatId: "c1", userId: "u1", label: active.label, status: active.status, filePath: active.filePath, canvas: activeCanvas });

    const completed = await backend.createTaskCanvas({ chatId: "c1", userId: "u1", label: "token-refresh-investigation", status: "completed" });
    await backend.updateTaskCanvasStatus(completed.id, "completed");
    const completedCanvas = "flowchart TD\n  T[\"Token refresh branch fixed\"]\n";
    await writeFile(join(tempDir, completed.filePath), completedCanvas, "utf8");
    await backend.upsertTaskCanvasSearchText({ taskId: completed.id, chatId: "c1", userId: "u1", label: completed.label, status: "completed", filePath: completed.filePath, canvas: completedCanvas });

    const recall = new RecallService(backend, { enabled: true, maxTasks: 3, maxCanvasChars: 2000 });
    const result = await recall.recall("u1", "token refresh", 5, "c1");

    expect(result.taskCanvas).toContain("Active login task");
    expect(result.taskCanvases.map((task) => task.label)).toContain("token-refresh-investigation");
    expect(result.taskCanvases.find((task) => task.label === "token-refresh-investigation")?.canvas).toContain("Token refresh branch fixed");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
bun test tests/memory/task-recall.test.ts
```

Expected: FAIL because `RecallService` constructor does not accept task recall options and `MemoryRecall.taskCanvases` is not returned.

- [ ] **Step 3: Update RecallService**

In `src/memory/recall/service.ts`, change constructor:

```ts
type TaskRecallOptions = {
  enabled: boolean;
  maxTasks: number;
  maxCanvasChars: number;
};

export class RecallService {
  constructor(
    private readonly backend: MemoryBackend,
    private readonly taskRecall: TaskRecallOptions = { enabled: true, maxTasks: 3, maxCanvasChars: 2200 },
  ) {}
```

In `recall()`, add task search to the `Promise.all`:

```ts
const [personaProfile, keywordAtoms, vectorAtoms, scenarios, conversations, taskCanvas, taskCanvases] = await Promise.all([
  this.backend.getPersona(userId),
  this.backend.searchMemoryAtoms(userId, query, maxResults),
  this.backend.searchMemoryAtomsByVector(userId, query, maxResults),
  this.backend.searchMemoryScenarios(userId, query, maxResults),
  this.backend.searchConversationTurns(userId, query, maxResults),
  chatId ? this.backend.getTaskCanvas(chatId) : Promise.resolve(undefined),
  this.taskRecall.enabled ? this.backend.searchTaskCanvases(userId, query, this.taskRecall.maxTasks, chatId) : Promise.resolve([]),
]);
```

Return:

```ts
taskCanvases: taskCanvases.map((task) => ({
  ...task,
  canvas: truncateText(task.canvas, this.taskRecall.maxCanvasChars),
})),
```

Import `truncateText` from `../../utils/text`.

- [ ] **Step 4: Wire task recall config through factory**

In `src/memory/integration/factory.ts`, construct recall service as:

```ts
const recallService = new RecallService(backend, config.memory.taskRecall ?? defaultTaskRecall);
```

- [ ] **Step 5: Render task-aware recall in agent context**

In `src/agent/react-agent.ts`, extend `formatRecall` after active canvas:

```ts
if (recall.taskCanvases.length) {
  sections.push(
    `## Relevant historical task canvases\n${recall.taskCanvases
      .map((task) => [
        `### Task #${task.id}: ${task.label} (${task.status})`,
        `file_path=${task.filePath}`,
        "```mermaid",
        truncateText(task.canvas, 2200),
        "```",
      ].join("\n"))
      .join("\n\n")}`,
  );
}
```

Update the context log:

```ts
taskCanvases: recall.taskCanvases.length,
```

- [ ] **Step 6: Render task-aware recall in local memory search tool**

In `src/tools/local.ts`, when building memory search output, append:

```ts
if (recall.taskCanvases.length) {
  parts.push(`## Relevant Task Canvases\n${recall.taskCanvases
    .map((task) => `### #${task.id} ${task.label} (${task.status})\nfile_path=${task.filePath}\n\`\`\`mermaid\n${truncateText(task.canvas, 1800)}\n\`\`\``)
    .join("\n\n")}`);
}
```

- [ ] **Step 7: Run task recall tests**

Run:

```bash
bun test tests/memory/task-recall.test.ts tests/memory/agent-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/memory/recall/service.ts src/memory/core/types.ts src/memory/integration/factory.ts src/agent/react-agent.ts src/tools/local.ts tests/memory/task-recall.test.ts tests/memory/agent-runtime.test.ts
git commit -m "feat: add task-aware recall"
```

---

### Task 8: Update status, docs, and bot summary for completed adaptation

**Files:**
- Modify: `src/memory/core/service.ts`
- Modify: `src/bot/ui/renderers.ts`
- Modify: `src/agent/prompts/system.ts`
- Modify: `README.md`
- Modify: `docs/memory.md`
- Modify: `docs/architecture.md`
- Modify: `tests/bot/memory-summary.test.ts`
- Modify: `tests/runtime/agent-prompt.test.ts`
- Modify: `tests/memory/readme.test.ts`

- [ ] **Step 1: Write failing status and docs tests**

In `tests/bot/memory-summary.test.ts`, add expectations to the existing rich memory summary test:

```ts
expect(summary).toContain("Canonical chat JSONL");
expect(summary).toContain("L1 semantic evidence");
expect(summary).toContain("L2 semantic Mermaid");
expect(summary).toContain("Task-aware recall");
```

In `tests/runtime/agent-prompt.test.ts`, add:

```ts
expect(prompt).toContain("canonical chat JSONL");
expect(prompt).toContain("L1 semantic evidence summaries");
expect(prompt).toContain("L2 Mermaid task canvases");
expect(prompt).toContain("task-aware recall");
```

In `tests/memory/readme.test.ts`, add:

```ts
expect(readme).toContain("canonical chat JSONL");
expect(readme).toContain("L1 semantic evidence");
expect(readme).toContain("L2 semantic Mermaid patching");
expect(readme).toContain("task-aware recall");
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
bun test tests/bot/memory-summary.test.ts tests/runtime/agent-prompt.test.ts tests/memory/readme.test.ts
```

Expected: FAIL because the new phrases are not documented yet.

- [ ] **Step 3: Update memory status**

In `src/memory/core/service.ts`, extend `MemoryServiceOptions`:

```ts
l1: {
  enabled: boolean;
  mode: "local";
  maxSummaryChars: number;
  defaultScore: number;
};
l2: {
  enabled: boolean;
  mode: "local";
  triggerMinEntries: number;
  maxCanvasChars: number;
};
taskRecall: {
  enabled: boolean;
  maxTasks: number;
  maxCanvasChars: number;
};
```

Add to `memoryStatus()` output:

```ts
`L1 semantic evidence=${options.l1.enabled ? options.l1.mode : "disabled"}`,
`L2 semantic Mermaid=${options.l2.enabled ? options.l2.mode : "disabled"}`,
`Task-aware recall=${options.taskRecall.enabled ? `max_tasks=${options.taskRecall.maxTasks}` : "disabled"}`,
```

- [ ] **Step 4: Update bot memory summary labels**

In `src/bot/ui/renderers.ts`, ensure `buildRichMemorySummary()` includes these labels in the memory status section by relying on `memoryStatus()` output. Add a short explanatory section after active canvas:

```ts
"# Canonical chat JSONL",
"Raw chat transcript rows are stored in data/history/<chatId>.jsonl; SQLite stores memory/offload indexes, not the canonical transcript.",
"",
"# Task-aware recall",
"Active and relevant historical task canvases can be injected into chat context when they match the user query.",
"",
"# L1/L2 offload",
"L1 semantic evidence is stored in SQLite and JSONL; L2 semantic Mermaid patching writes task-scoped .mmd canvases.",
```

- [ ] **Step 5: Update prompt guidance**

In `src/agent/prompts/system.ts`, add this sentence to the memory/offload guidance:

```ts
"Use canonical chat JSONL only as raw transcript history. Use task-aware recall and L2 Mermaid task canvases as orientation for long-running work; drill down through node_id/result_ref when details are needed. L1 semantic evidence summaries are compact progress/blocker records, not durable persona facts.",
```

- [ ] **Step 6: Update docs**

In `docs/memory.md`, add:

```md
### TencentDB-style semantic offload completion

Short-term task context now uses four inspectable layers:

1. **Canonical chat JSONL** stores raw transcript rows in `data/history/<chatId>.jsonl` using `{id, chat_id, user_id, role, content, meta, created_at}`.
2. **L1 semantic evidence** stores each tool result as a compact progress/blocker/verification summary in SQLite and mirrors it to `data/memory/jsonl/l1/<chat>.jsonl`.
3. **L2 semantic Mermaid patching** consumes task-routed L1 evidence and writes task-scoped `.mmd` canvases under `data/memory/task-canvases/`.
4. **Task-aware recall** searches active and historical task canvases and injects relevant Mermaid snippets into the chat context.

SQLite remains authoritative for memory/offload indexes, while raw chat transcript history is JSONL-only. The durable memory pipeline remains `L0 JSONL conversations -> L1 atoms -> L2 scenarios -> L3 persona`.
```

In `docs/architecture.md`, add the flow:

```md
```text
chat turn/tool result
-> canonical chat JSONL (data/history/<chatId>.jsonl)
-> L1 semantic evidence summary (SQLite + JSONL)
-> L1.5 task judgment
-> L2 semantic Mermaid patch (.mmd + SQLite FTS)
-> task-aware recall
-> optional L4 draft skill generation
```
```

In `README.md`, add the same high-level bullets under the memory section.

- [ ] **Step 7: Run status and docs tests**

Run:

```bash
bun test tests/bot/memory-summary.test.ts tests/runtime/agent-prompt.test.ts tests/memory/readme.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/memory/core/service.ts src/bot/ui/renderers.ts src/agent/prompts/system.ts README.md docs/memory.md docs/architecture.md tests/bot/memory-summary.test.ts tests/runtime/agent-prompt.test.ts tests/memory/readme.test.ts
git commit -m "docs: describe semantic offload completion"
```

---

### Task 9: Full verification and regression checks

**Files:**
- Verify only; modify files only if a test reveals an implementation error in tasks 1-8.

- [ ] **Step 1: Run full test suite**

Run:

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: no TypeScript errors.

- [ ] **Step 3: Check git diff scope**

Run:

```bash
git status --short
git diff --stat
```

Expected: only files listed in this plan are modified or newly created. Existing unrelated local/staged files such as `.claude/*`, `TencentDB-Agent-Memory/*`, and `data/memory/*` should not be committed as part of this work.

- [ ] **Step 4: Manual runtime smoke test**

Run the bot locally:

```bash
bun run dev
```

In Telegram:

1. Send `sekarang hari apa dan jam berapa?`.
2. Confirm `data/history/<chatId>.jsonl` gets role-based `user`, `tool`, and `assistant` rows with `{id, chat_id, user_id, role, content, meta, created_at}`.
3. Confirm SQLite `conversations` is not used as the raw chat transcript; memory/offload tables may still be populated.
4. Confirm logs show `[agent:l15]` with `isLongTask: false`.
5. Confirm SQLite has an L1 evidence row for `tdai_current_datetime` with `task_id IS NULL`.
6. Confirm `data/memory/jsonl/l1/<chat>.jsonl` contains the datetime L1 evidence line.
7. Confirm no task `.mmd` is updated for the one-shot question.
8. Send a long task request such as `tolong investigasi flow memory recall dan buat task sampai selesai`.
9. Trigger a tool call during that task.
10. Confirm SQLite has L1 evidence with a non-null `task_id`.
11. Confirm the task `.mmd` under `data/memory/task-canvases/<chat>/` contains semantic `flowchart TD` content.
12. Ask a follow-up about the same task and confirm chat context includes `Relevant historical task canvases` when the active task is completed or no longer active.

- [ ] **Step 5: Final commit if verification required fixes**

If Step 1 or Step 2 required code fixes, commit the fix:

```bash
git add src/memory/history/jsonl.ts src/memory/events/service.ts src/memory/integration/factory.ts src/memory/core/service.ts src/config.ts .env.example src/memory/core/types.ts src/memory/core/backend.ts src/memory/backends/sqlite/migrate.ts src/memory/backends/sqlite/backend.ts src/memory/offload/l1.ts src/memory/offload/l2.ts src/memory/offload/service.ts src/agent/react-agent.ts src/memory/recall/service.ts src/tools/local.ts src/bot/ui/renderers.ts src/agent/prompts/system.ts README.md docs/memory.md docs/architecture.md tests/memory/history-jsonl.test.ts tests/memory/config.test.ts tests/memory/sqlite-backend.test.ts tests/memory/l1.test.ts tests/memory/l2.test.ts tests/memory/offload.test.ts tests/memory/agent-runtime.test.ts tests/memory/task-recall.test.ts tests/bot/memory-summary.test.ts tests/runtime/agent-prompt.test.ts tests/memory/readme.test.ts
git commit -m "fix: stabilize semantic offload pipeline"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

### Spec coverage

- JSONL-only canonical chat logs at `data/history/<chatId>.jsonl`: covered by Task 1.
- L1 semantic summary using JSONL plus SQLite: covered by Tasks 2-4.
- Keep SQLite authoritative for memory/offload indexes, not raw chat transcript: covered by Tasks 1-2 and node mapping/FTS index writes.
- Reuse JSONL for inspectability: covered by canonical chat history in Task 1 and `data/memory/jsonl/l1/<chat>.jsonl` mirror in Task 4.
- Keep `.mmd` files: covered by L2 writing to existing task canvas file paths in Task 6.
- L2 semantic Mermaid patching: covered by Tasks 5-6 with `write` and `replace` patch support.
- Task-aware recall: covered by Task 7 with active and historical task canvas retrieval.
- Runtime prompt/context integration: covered by Tasks 7-8.
- Docs/status/tests: covered by Tasks 8-9.

### Placeholder scan

This plan contains concrete file paths, test code, TypeScript snippets, SQL schema, command lines, and expected outcomes. It does not leave implementation decisions unnamed.

### Type consistency

The plan consistently uses these names across tasks:

- `ChatHistoryRow`, `NewChatHistoryRow`, `ChatHistoryRole`
- `appendChatHistoryTurn`, `readChatHistoryTail`, `searchChatHistory`, `countChatHistoryRows`
- `L1EvidenceEntry`, `NewL1EvidenceEntry`, `L1EvidenceStatus`
- `L2MermaidPatch`, `L2ReplaceBlock`, `L2EvidenceEntry`
- `TaskCanvasRecall`
- `insertL1EvidenceEntry`
- `listL1EvidenceEntriesForTask`
- `listPendingL1EvidenceEntriesForTask`
- `updateL1EvidenceNodeMapping`
- `getL1EvidenceJsonlPath`
- `upsertTaskCanvasSearchText`
- `searchTaskCanvases`

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-18-tencentdb-semantic-offload-completion.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.
