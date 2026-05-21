# Project-Owned Memory System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current local/vendor-reference memory implementation with a fully project-owned Bun-native local-first memory subsystem that supports layered memory, lineage-aware recall, offload/canvas, structured interaction logging, a SQLite + `sqlite-vec` store, and optional JSONL export/debug logs.

**Architecture:** Build a host-neutral `MemoryService` over a local backend contract, then wire it into the existing grammY/agent runtime. Use a single local-first SQLite backend backed by `bun:sqlite`, `sqlite-vec`, and FTS5 for search, while keeping JSONL only as an optional append-only export/debug log derived from structured interaction events, never as the primary memory store.

**Tech Stack:** TypeScript, Bun, `bun:sqlite`, `sqlite-vec`, FTS5, grammY, node-cron, Bun test

---

## File structure map

### Create

- `src/memory/core/types.ts` — shared memory domain types for events, lineage, recall, atoms, scenarios, persona profiles, checkpoints, and backend config.
- `src/memory/core/backend.ts` — `MemoryBackend` contract plus small query/result types used by both backends.
- `src/memory/core/service.ts` — top-level `MemoryService` orchestration API consumed by the agent, bot, tools, and cron loops.
- `src/memory/events/service.ts` — structured interaction logging for user messages, assistant replies, tool calls, tool results, offload refs, and autonomous actions.
- `src/memory/events/jsonl-export.ts` — optional append-only JSONL export for interaction/debug traces.
- `src/memory/pipeline/coordinator.ts` — checkpoint-driven L1/L2/L3 maintenance flow.
- `src/memory/pipeline/l1.ts` — L1 extraction runner and parser glue.
- `src/memory/pipeline/l2.ts` — L2 scenario aggregation runner.
- `src/memory/pipeline/l3.ts` — L3 persona synthesis runner.
- `src/memory/prompts/l1.ts` — L1 extraction prompt text and JSON parser.
- `src/memory/prompts/l2.ts` — L2 scenario prompt text.
- `src/memory/prompts/l3.ts` — L3 persona prompt text.
- `src/memory/recall/service.ts` — recall merge/ranking plus lineage fallback traversal.
- `src/memory/offload/service.ts` — raw-result offload, refs, task graph, and Mermaid canvas generation.
- `src/memory/backends/sqlite/migrate.ts` — SQLite tables and indexes for the new memory model.
- `src/memory/backends/sqlite/backend.ts` — Bun SQLite implementation of the local memory backend.
- `src/memory/backends/sqlite/vec.ts` — `sqlite-vec` loading and vector-table helpers for the local backend.
- `src/memory/integration/factory.ts` — runtime factory that builds the local-first `MemoryService`.
- `tests/memory/config.test.ts` — config parsing coverage for local-first memory and JSONL export settings.
- `tests/memory/sqlite-backend.test.ts` — SQLite schema, interaction events, conversations, checkpoints, and lineage persistence.
- `tests/memory/pipeline.test.ts` — L1/L2/L3 maintenance behavior with fake LLM outputs.
- `tests/memory/recall.test.ts` — cross-layer recall and lineage fallback behavior.
- `tests/memory/offload.test.ts` — offload success, fallback, and Mermaid canvas behavior.
- `tests/memory/sqlite-vec.test.ts` — sqlite-vec extension loading and local vector search behavior.
- `tests/memory/tools.test.ts` — `tdai_*` tool surface against `MemoryService`.
- `tests/memory/agent-runtime.test.ts` — end-to-end agent loop logging and tool/offload behavior.
- `tests/memory/readme.test.ts` — final docs regression coverage for removing the vendor workflow.

### Modify

- `package.json` — add a `test` script.
- `tsconfig.json` — include the test tree in type checking.
- `.env.example` — replace vendor-reference variables with local SQLite/sqlite-vec settings and optional JSONL export settings.
- `README.md` — document the new project-owned memory architecture and remove vendor workflow docs.
- `src/config.ts` — add pure config parsing, local SQLite/sqlite-vec config, and optional JSONL export config.
- `src/db/schema.ts` — keep app-global tables and delegate memory schema creation to the new SQLite migrator.
- `src/index.ts` — build `MemoryService` through the new factory and pass it to the app.
- `src/tools/types.ts` — switch the `memory` dependency from `MemoryStore` to `MemoryService`.
- `src/tools/local.ts` — keep the bot-facing tool surface but reimplement it on `MemoryService`.
- `src/agent/react-agent.ts` — replace direct store calls with structured interaction logging and `MemoryService` calls.
- `src/bot/bot.ts` — rewire `/memory` and `/memory_force` to the new service.
- `src/cron/autonomous.ts` — keep autonomous jobs, but run maintenance through `MemoryService` and log autonomous actions.
- `scripts/inspect-memory.ts` — inspect the new schema instead of the old one.

### Delete in the final cleanup task

- `src/memory/store.ts`
- `scripts/vendor-tencentdb-agent-memory.ts`
- `vendor/tencentdb-agent-memory/` once the runtime no longer depends on it for anything except historical reference

The old `src/memory/jsonl.ts` should not be carried forward as a primary storage utility. If JSONL support is still wanted, replace it with the new optional export/debug module under `src/memory/events/jsonl-export.ts`.

---

### Task 1: Establish test harness and local-first memory config

**Files:**
- Create: `tests/memory/config.test.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `src/config.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { parseConfig } from "../../src/config";

test("parseConfig defaults to local-first SQLite memory settings", () => {
  const runtime = parseConfig({
    BOT_TOKEN: "123:abc",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
  });

  expect(runtime.memory.sqliteVecEnabled).toBe(true);
  expect(runtime.memory.jsonlExportEnabled).toBe(false);
  expect(runtime.storage.memoryJsonlExportDir.endsWith("data/memory/jsonl")).toBe(true);
});

test("parseConfig can enable JSONL export explicitly", () => {
  const runtime = parseConfig({
    BOT_TOKEN: "123:abc",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
    MEMORY_JSONL_EXPORT_ENABLED: "true",
  });

  expect(runtime.memory.jsonlExportEnabled).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/memory/config.test.ts`
Expected: FAIL because `parseConfig` is not exported yet and the local-first memory flags do not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// package.json
{
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "start": "bun src/index.ts",
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit"
  }
}
```

```json
// tsconfig.json
{
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

```ts
// src/config.ts
import { resolve } from "node:path";

export type EnvSource = Record<string, string | undefined>;

function envFrom(source: EnvSource, name: string, fallback = ""): string {
  return (source[name] ?? fallback).trim();
}

function intFrom(source: EnvSource, name: string, fallback: number): number {
  const raw = source[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseConfig(source: EnvSource) {
  return {
    telegram: {
      botToken: envFrom(source, "BOT_TOKEN"),
    },
    llm: {
      provider: envFrom(source, "LLM_PROVIDER", "openai") as "openai" | "anthropic",
      openai: {
        apiKey: envFrom(source, "OPENAI_API_KEY"),
        baseURL: envFrom(source, "OPENAI_BASE_URL", "https://api.openai.com/v1"),
        model: envFrom(source, "OPENAI_MODEL", "gpt-4.1-mini"),
      },
      anthropic: {
        apiKey: envFrom(source, "ANTHROPIC_API_KEY"),
        model: envFrom(source, "ANTHROPIC_MODEL", "claude-sonnet-4-5"),
      },
    },
    agent: {
      maxToolIterations: intFrom(source, "MAX_TOOL_ITERATIONS", 6),
      maxRecentMessages: intFrom(source, "MAX_RECENT_MESSAGES", 12),
    },
    storage: {
      dataDir: resolve(envFrom(source, "DATA_DIR", "./data")),
      dbPath: resolve(envFrom(source, "DB_PATH", "./data/agent.db")),
      memoryRefsDir: resolve(envFrom(source, "MEMORY_REFS_DIR", "./data/memory/refs")),
      memoryCanvasDir: resolve(envFrom(source, "MEMORY_CANVAS_DIR", "./data/memory/canvases")),
      memoryJsonlExportDir: resolve(envFrom(source, "MEMORY_JSONL_EXPORT_DIR", "./data/memory/jsonl")),
    },
    memory: {
      recallMaxResults: intFrom(source, "MEMORY_RECALL_MAX_RESULTS", 5),
      offloadMinChars: intFrom(source, "MEMORY_OFFLOAD_MIN_CHARS", 2500),
      offloadSummaryChars: intFrom(source, "MEMORY_OFFLOAD_SUMMARY_CHARS", 900),
      maintenanceCron: envFrom(source, "MEMORY_MAINTENANCE_CRON", "*/10 * * * *"),
      jsonlExportEnabled: envFrom(source, "MEMORY_JSONL_EXPORT_ENABLED", "false") === "true",
      sqliteVecEnabled: envFrom(source, "MEMORY_SQLITE_VEC_ENABLED", "true") !== "false",
    },
    autonomous: {
      cron: envFrom(source, "AUTONOMOUS_CRON", "*/10 * * * *"),
      minIntervalSec: intFrom(source, "AUTONOMOUS_MIN_INTERVAL_SEC", 600),
      maxJobsPerTick: intFrom(source, "AUTONOMOUS_MAX_JOBS_PER_TICK", 20),
    },
  };
}

export const config = parseConfig(process.env);
```

```dotenv
# .env.example
MEMORY_SQLITE_VEC_ENABLED=true
MEMORY_JSONL_EXPORT_ENABLED=false
MEMORY_JSONL_EXPORT_DIR=./data/memory/jsonl
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/memory/config.test.ts && bun run typecheck`
Expected: PASS for both config tests, and `tsc` exits with code 0.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json .env.example src/config.ts tests/memory/config.test.ts
git commit -m "test: add local-first memory config coverage"
```

### Task 2: Build SQLite schema and structured interaction logging

**Files:**
- Create: `src/memory/core/types.ts`
- Create: `src/memory/core/backend.ts`
- Create: `src/memory/events/service.ts`
- Create: `src/memory/events/jsonl-export.ts`
- Create: `src/memory/backends/sqlite/migrate.ts`
- Create: `src/memory/backends/sqlite/backend.ts`
- Create: `tests/memory/sqlite-backend.test.ts`
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrateSqliteMemory } from "../../src/memory/backends/sqlite/migrate";
import { SqliteMemoryBackend } from "../../src/memory/backends/sqlite/backend";
import { InteractionLogService } from "../../src/memory/events/service";

test("SQLite backend stores interaction events, optional JSONL exports, L0 turns, and checkpoints", async () => {
  const db = new Database(":memory:");
  migrateSqliteMemory(db);

  const backend = new SqliteMemoryBackend(db, {
    dataDir: "/tmp/grammy-memory-test",
    refsDir: "/tmp/grammy-memory-test/refs",
    canvasDir: "/tmp/grammy-memory-test/canvases",
  });
  const logs = new InteractionLogService(backend, {
    enabled: true,
    exportDir: "/tmp/grammy-memory-test/jsonl",
  });

  await logs.logUserMessage({ chatId: "c1", userId: "u1", content: "remember Bun", mode: "chat" });
  await logs.logToolResult({
    chatId: "c1",
    userId: "u1",
    toolName: "tdai_memory_search",
    toolCallId: "call_1",
    content: "No relevant memory found.",
    offloaded: false,
  });
  await backend.setCheckpoint("u1", "l1_last_conversation_id", "1");

  const turns = await backend.listConversationTurns("u1", "c1", 10);
  const events = await backend.listInteractionEvents("u1", "c1", 10);
  const jsonl = await Bun.file("/tmp/grammy-memory-test/jsonl/c1.jsonl").text();

  expect(turns[0]?.content).toBe("remember Bun");
  expect(jsonl).toContain("\"type\":\"user_message\"");
  expect(events.some((event) => event.type === "tool_result")).toBe(true);
  expect(await backend.getCheckpoint("u1", "l1_last_conversation_id")).toBe("1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/memory/sqlite-backend.test.ts`
Expected: FAIL because the SQLite memory migrator, backend, and interaction log service do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/memory/core/types.ts
export type InteractionEventType =
  | "user_message"
  | "assistant_message"
  | "tool_call"
  | "tool_result"
  | "offload_ref"
  | "autonomous_action";

export type ConversationRole = "user" | "assistant" | "tool";
export type PipelineCheckpointKey = "l1_last_conversation_id" | "l2_last_run_unix" | "l3_last_atom_count";

export type InteractionEvent = {
  id: number;
  chatId: string;
  userId: string;
  type: InteractionEventType;
  content: string;
  payload: Record<string, unknown>;
  createdAt: string;
};
```

```ts
// src/memory/core/backend.ts
import type { ConversationRole, InteractionEvent, InteractionEventType, PipelineCheckpointKey } from "./types";

export interface MemoryBackend {
  init(): Promise<void>;
  insertInteractionEvent(input: {
    chatId: string;
    userId: string;
    type: InteractionEventType;
    content: string;
    payload?: Record<string, unknown>;
    createdAt?: string;
  }): Promise<number>;
  insertConversationTurn(input: {
    chatId: string;
    userId: string;
    role: ConversationRole;
    content: string;
    meta?: Record<string, unknown>;
    createdAt?: string;
  }): Promise<number>;
  listInteractionEvents(userId: string, chatId: string, limit: number): Promise<InteractionEvent[]>;
  listConversationTurns(userId: string, chatId: string, limit: number): Promise<Array<{ id: number; role: ConversationRole; content: string; createdAt: string }>>;
  getCheckpoint(userId: string, key: PipelineCheckpointKey): Promise<string | undefined>;
  setCheckpoint(userId: string, key: PipelineCheckpointKey, value: string): Promise<void>;
}
```

```ts
// src/memory/backends/sqlite/migrate.ts
import type { Database } from "bun:sqlite";

export function migrateSqliteMemory(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS interaction_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS conversation_fts USING fts5(
      content,
      conversation_id UNINDEXED,
      chat_id UNINDEXED,
      user_id UNINDEXED,
      tokenize = 'unicode61'
    );

    CREATE TABLE IF NOT EXISTS lineage_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      link_type TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pipeline_checkpoints (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, key)
    );
  `);
}
```

```ts
// src/memory/events/service.ts
import type { MemoryBackend } from "../core/backend";
import { appendInteractionJsonl } from "./jsonl-export";

export class InteractionLogService {
  constructor(
    private readonly backend: MemoryBackend,
    private readonly jsonl?: { enabled: boolean; exportDir: string },
  ) {}

  async logUserMessage(input: { chatId: string; userId: string; content: string; mode: "chat" | "autonomous" }) {
    await this.backend.insertInteractionEvent({
      chatId: input.chatId,
      userId: input.userId,
      type: "user_message",
      content: input.content,
      payload: { mode: input.mode },
    });

    if (this.jsonl?.enabled) {
      await appendInteractionJsonl(this.jsonl.exportDir, input.chatId, {
        type: "user_message",
        userId: input.userId,
        content: input.content,
        payload: { mode: input.mode },
      });
    }

    return this.backend.insertConversationTurn({
      chatId: input.chatId,
      userId: input.userId,
      role: "user",
      content: input.content,
      meta: { mode: input.mode },
    });
  }

  async logToolResult(input: { chatId: string; userId: string; toolName: string; toolCallId: string; content: string; offloaded: boolean }) {
    const eventId = await this.backend.insertInteractionEvent({
      chatId: input.chatId,
      userId: input.userId,
      type: "tool_result",
      content: input.content,
      payload: { toolName: input.toolName, toolCallId: input.toolCallId, offloaded: input.offloaded },
    });

    if (this.jsonl?.enabled) {
      await appendInteractionJsonl(this.jsonl.exportDir, input.chatId, {
        type: "tool_result",
        userId: input.userId,
        content: input.content,
        payload: { toolName: input.toolName, toolCallId: input.toolCallId, offloaded: input.offloaded },
      });
    }

    return eventId;
  }
}
```

```ts
// src/memory/events/jsonl-export.ts
import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";

export async function appendInteractionJsonl(
  exportDir: string,
  chatId: string,
  record: { type: string; userId: string; content: string; payload: Record<string, unknown> },
) {
  await mkdir(exportDir, { recursive: true });
  const line = JSON.stringify({
    chat_id: chatId,
    user_id: record.userId,
    type: record.type,
    content: record.content,
    payload: record.payload,
    created_at: new Date().toISOString(),
  });
  await appendFile(join(exportDir, `${chatId}.jsonl`), `${line}\n`, "utf8");
}
```

```ts
// src/memory/backends/sqlite/backend.ts
import type { Database } from "bun:sqlite";
import { nowIso } from "../../utils/time";
import type { MemoryBackend } from "../../memory/core/backend";
import type { InteractionEvent, PipelineCheckpointKey } from "../../memory/core/types";

export class SqliteMemoryBackend implements MemoryBackend {
  constructor(private readonly db: Database, private readonly paths: { dataDir: string; refsDir: string; canvasDir: string }) {}

  async init(): Promise<void> {}

  async insertInteractionEvent(input: { chatId: string; userId: string; type: InteractionEvent["type"]; content: string; payload?: Record<string, unknown>; createdAt?: string }) {
    const result = this.db.query(`
      INSERT INTO interaction_events (chat_id, user_id, type, content, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.chatId, input.userId, input.type, input.content, JSON.stringify(input.payload ?? {}), input.createdAt ?? nowIso());
    return Number(result.lastInsertRowid);
  }

  async insertConversationTurn(input: { chatId: string; userId: string; role: "user" | "assistant" | "tool"; content: string; meta?: Record<string, unknown>; createdAt?: string }) {
    const createdAt = input.createdAt ?? nowIso();
    const result = this.db.query(`
      INSERT INTO conversations (chat_id, user_id, role, content, meta_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.chatId, input.userId, input.role, input.content, JSON.stringify(input.meta ?? {}), createdAt);
    const id = Number(result.lastInsertRowid);
    this.db.query(`INSERT INTO conversation_fts (content, conversation_id, chat_id, user_id) VALUES (?, ?, ?, ?)`).run(input.content, String(id), input.chatId, input.userId);
    return id;
  }

  async listInteractionEvents(userId: string, chatId: string, limit: number) {
    return this.db.query(`SELECT id, chat_id, user_id, type, content, payload_json, created_at FROM interaction_events WHERE user_id = ? AND chat_id = ? ORDER BY id DESC LIMIT ?`).all(userId, chatId, limit).map((row: any) => ({
      id: row.id,
      chatId: row.chat_id,
      userId: row.user_id,
      type: row.type,
      content: row.content,
      payload: JSON.parse(row.payload_json),
      createdAt: row.created_at,
    }));
  }

  async listConversationTurns(userId: string, chatId: string, limit: number) {
    return this.db.query(`SELECT id, role, content, created_at FROM conversations WHERE user_id = ? AND chat_id = ? ORDER BY id DESC LIMIT ?`).all(userId, chatId, limit).reverse().map((row: any) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    }));
  }

  async getCheckpoint(userId: string, key: PipelineCheckpointKey) {
    const row = this.db.query(`SELECT value FROM pipeline_checkpoints WHERE user_id = ? AND key = ?`).get(userId, key) as { value: string } | null;
    return row?.value;
  }

  async setCheckpoint(userId: string, key: PipelineCheckpointKey, value: string) {
    this.db.query(`
      INSERT INTO pipeline_checkpoints (user_id, key, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(userId, key, value, nowIso());
  }
}
```

```ts
// src/db/schema.ts
import { Database } from "bun:sqlite";
import { migrateSqliteMemory } from "../memory/backends/sqlite/migrate";

export function migrate(db: Database) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS tool_registry (
      name TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      server_name TEXT,
      original_name TEXT,
      description TEXT NOT NULL,
      input_schema_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS autonomous_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  migrateSqliteMemory(db);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/memory/sqlite-backend.test.ts && bun run typecheck`
Expected: PASS for SQLite event logging, optional JSONL export, and checkpoint persistence.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/memory/core/types.ts src/memory/core/backend.ts src/memory/events/service.ts src/memory/events/jsonl-export.ts src/memory/backends/sqlite/migrate.ts src/memory/backends/sqlite/backend.ts tests/memory/sqlite-backend.test.ts
git commit -m "feat: add sqlite memory event store"
```

### Task 3: Implement L1/L2/L3 pipeline runners and lineage writes

**Files:**
- Create: `src/memory/pipeline/l1.ts`
- Create: `src/memory/pipeline/l2.ts`
- Create: `src/memory/pipeline/l3.ts`
- Create: `src/memory/pipeline/coordinator.ts`
- Create: `src/memory/prompts/l1.ts`
- Create: `src/memory/prompts/l2.ts`
- Create: `src/memory/prompts/l3.ts`
- Create: `tests/memory/pipeline.test.ts`
- Modify: `src/memory/core/backend.ts`
- Modify: `src/memory/backends/sqlite/backend.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrateSqliteMemory } from "../../src/memory/backends/sqlite/migrate";
import { SqliteMemoryBackend } from "../../src/memory/backends/sqlite/backend";
import { InteractionLogService } from "../../src/memory/events/service";
import { PipelineCoordinator } from "../../src/memory/pipeline/coordinator";
import type { LlmProvider } from "../../src/agent/types";

const fakeLlm: LlmProvider = {
  async complete({ messages }) {
    const system = String(messages[0]?.content ?? "");
    if (system.includes("L1 extractor")) {
      return { content: JSON.stringify([{ text: "User prefers Bun runtime", importance: 4, source_turn_ids: [1] }]), toolCalls: [] };
    }
    if (system.includes("L2 Scenario aggregator")) {
      return { content: "## Runtime choices\n- atom_id=1 User prefers Bun runtime", toolCalls: [] };
    }
    return { content: "- scenario_id=1 Prefers Bun runtime\n- atom_id=1 User prefers Bun runtime", toolCalls: [] };
  },
};

test("pipeline produces atoms, scenarios, persona, and lineage links", async () => {
  const db = new Database(":memory:");
  migrateSqliteMemory(db);
  const backend = new SqliteMemoryBackend(db, {
    dataDir: "/tmp/grammy-memory-test",
    refsDir: "/tmp/grammy-memory-test/refs",
    canvasDir: "/tmp/grammy-memory-test/canvases",
  });
  const logs = new InteractionLogService(backend);
  const pipeline = new PipelineCoordinator(backend, fakeLlm);

  await logs.logUserMessage({ chatId: "c1", userId: "u1", content: "Please use Bun for this bot.", mode: "chat" });
  const result = await pipeline.runMaintenanceForUser("u1", true);

  expect(result.l1Created).toBe(1);
  expect(result.l2ScenarioId).toBeGreaterThan(0);
  expect(result.personaUpdated).toBe(true);
  expect(await backend.listLineageTargets("u1", "conversation", "1")).toEqual(
    expect.arrayContaining([expect.objectContaining({ targetKind: "memory_atom" })]),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/memory/pipeline.test.ts`
Expected: FAIL because atom/scenario/persona persistence and lineage APIs do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/memory/prompts/l1.ts
export const L1_SYSTEM_PROMPT = [
  "You are the L1 extractor from TencentDB-Agent-Memory style layered memory.",
  "Extract durable atomic memories from L0 conversations.",
  'Return ONLY valid JSON array. Each item: {"text": string, "importance": 1-5, "source_turn_ids": number[]}.',
].join("\n");
```

```ts
// src/memory/pipeline/l1.ts
import type { LlmProvider } from "../../agent/types";
import { L1_SYSTEM_PROMPT } from "../prompts/l1";
import type { MemoryBackend } from "../core/backend";

export async function runL1Extraction(backend: MemoryBackend, llm: LlmProvider, userId: string) {
  const rows = await backend.listPendingConversationEvidence(userId, 80);
  if (rows.length === 0) return { created: 0, lastConversationId: 0 };

  const transcript = rows.map((row) => `turn_id=${row.id} ${row.role}: ${row.content}`).join("\n");
  const response = await llm.complete({
    messages: [
      { role: "system", content: L1_SYSTEM_PROMPT },
      { role: "user", content: transcript },
    ],
    tools: [],
  });

  const items = JSON.parse(response.content) as Array<{ text: string; importance?: number; source_turn_ids?: number[] }>;
  let created = 0;
  for (const item of items) {
    const atomId = await backend.upsertMemoryAtom({
      userId,
      text: item.text,
      importance: item.importance ?? 3,
      sourceTurnIds: item.source_turn_ids ?? [],
    });
    if (atomId > 0) created += 1;
    for (const turnId of item.source_turn_ids ?? []) {
      await backend.insertLineageLink({ userId, sourceKind: "conversation", sourceId: String(turnId), targetKind: "memory_atom", targetId: String(atomId), linkType: "derived_from" });
    }
  }

  return { created, lastConversationId: rows.at(-1)?.id ?? 0 };
}
```

```ts
// src/memory/pipeline/coordinator.ts
import type { LlmProvider } from "../../agent/types";
import type { MemoryBackend } from "../core/backend";
import { runL1Extraction } from "./l1";
import { runL2ScenarioUpdate } from "./l2";
import { runL3PersonaUpdate } from "./l3";

export class PipelineCoordinator {
  constructor(private readonly backend: MemoryBackend, private readonly llm: LlmProvider) {}

  async runMaintenanceForUser(userId: string, force = false) {
    const l1 = await runL1Extraction(this.backend, this.llm, userId);
    const l2ScenarioId = force || l1.created > 0 ? await runL2ScenarioUpdate(this.backend, this.llm, userId) : undefined;
    const personaUpdated = force || Boolean(l2ScenarioId) ? await runL3PersonaUpdate(this.backend, this.llm, userId, l2ScenarioId) : false;

    if (l1.lastConversationId > 0) await this.backend.setCheckpoint(userId, "l1_last_conversation_id", String(l1.lastConversationId));
    return { l1Created: l1.created, l2ScenarioId, personaUpdated };
  }
}
```

```ts
// src/memory/core/backend.ts
export interface MemoryBackend {
  init(): Promise<void>;
  insertInteractionEvent(input: { chatId: string; userId: string; type: "user_message" | "assistant_message" | "tool_call" | "tool_result" | "offload_ref" | "autonomous_action"; content: string; payload?: Record<string, unknown>; createdAt?: string }): Promise<number>;
  insertConversationTurn(input: { chatId: string; userId: string; role: "user" | "assistant" | "tool"; content: string; meta?: Record<string, unknown>; createdAt?: string }): Promise<number>;
  listInteractionEvents(userId: string, chatId: string, limit: number): Promise<Array<{ id: number; type: string; content: string; payload: Record<string, unknown>; createdAt: string }>>;
  listConversationTurns(userId: string, chatId: string, limit: number): Promise<Array<{ id: number; role: "user" | "assistant" | "tool"; content: string; createdAt: string }>>;
  getCheckpoint(userId: string, key: "l1_last_conversation_id" | "l2_last_run_unix" | "l3_last_atom_count"): Promise<string | undefined>;
  setCheckpoint(userId: string, key: "l1_last_conversation_id" | "l2_last_run_unix" | "l3_last_atom_count", value: string): Promise<void>;
  listPendingConversationEvidence(userId: string, limit: number): Promise<Array<{ id: number; role: "user" | "assistant" | "tool"; content: string }>>;
  upsertMemoryAtom(input: { userId: string; text: string; importance: number; sourceTurnIds: number[] }): Promise<number>;
  insertScenarioBlock(input: { userId: string; title: string; bodyMarkdown: string; atomIds: number[] }): Promise<number>;
  upsertPersonaProfile(input: { userId: string; markdown: string; sourceScenarioIds: number[] }): Promise<void>;
  insertLineageLink(input: { userId: string; sourceKind: string; sourceId: string; targetKind: string; targetId: string; linkType: string }): Promise<void>;
  listLineageTargets(userId: string, sourceKind: string, sourceId: string): Promise<Array<{ targetKind: string; targetId: string }>>;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/memory/pipeline.test.ts && bun run typecheck`
Expected: PASS with one atom, one scenario, one persona update, and lineage links present.

- [ ] **Step 5: Commit**

```bash
git add src/memory/pipeline/l1.ts src/memory/pipeline/l2.ts src/memory/pipeline/l3.ts src/memory/pipeline/coordinator.ts src/memory/prompts/l1.ts src/memory/prompts/l2.ts src/memory/prompts/l3.ts src/memory/core/backend.ts src/memory/backends/sqlite/backend.ts tests/memory/pipeline.test.ts
git commit -m "feat: add layered memory pipeline"
```

### Task 4: Implement recall merge, ranking, and lineage fallback

**Files:**
- Create: `src/memory/recall/service.ts`
- Create: `tests/memory/recall.test.ts`
- Modify: `src/memory/core/backend.ts`
- Modify: `src/memory/backends/sqlite/backend.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrateSqliteMemory } from "../../src/memory/backends/sqlite/migrate";
import { SqliteMemoryBackend } from "../../src/memory/backends/sqlite/backend";
import { RecallService } from "../../src/memory/recall/service";

test("recall falls back through lineage when the direct atom is missing", async () => {
  const db = new Database(":memory:");
  migrateSqliteMemory(db);
  const backend = new SqliteMemoryBackend(db, {
    dataDir: "/tmp/grammy-memory-test",
    refsDir: "/tmp/grammy-memory-test/refs",
    canvasDir: "/tmp/grammy-memory-test/canvases",
  });

  const scenarioId = await backend.insertScenarioBlock({
    userId: "u1",
    title: "Runtime choices",
    bodyMarkdown: "- atom_id=42 User prefers Bun runtime",
    atomIds: [42],
  });
  await backend.insertLineageLink({
    userId: "u1",
    sourceKind: "memory_atom",
    sourceId: "42",
    targetKind: "scenario_block",
    targetId: String(scenarioId),
    linkType: "grouped_into",
  });

  const recall = await new RecallService(backend).recall("u1", "Bun runtime", 5, "c1");

  expect(recall.scenarios[0]?.id).toBe(scenarioId);
  expect(recall.fallbackChain).toEqual(
    expect.arrayContaining([expect.objectContaining({ missingKind: "memory_atom", fallbackKind: "scenario_block" })]),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/memory/recall.test.ts`
Expected: FAIL because `RecallService` and lineage fallback traversal are not implemented.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/memory/recall/service.ts
import type { MemoryBackend } from "../core/backend";

export class RecallService {
  constructor(private readonly backend: MemoryBackend) {}

  async recall(userId: string, query: string, maxResults: number, chatId?: string) {
    const persona = await this.backend.getPersonaProfile(userId);
    const atoms = await this.backend.searchMemoryAtoms(userId, query, maxResults);
    const scenarios = await this.backend.searchScenarioBlocks(userId, query, Math.min(maxResults, 3));
    const conversations = await this.backend.searchConversations(userId, query, maxResults);
    const taskCanvas = chatId ? await this.backend.getTaskCanvas(chatId) : undefined;

    const fallbackChain = atoms.length > 0
      ? []
      : await this.backend.findFallbackChain(userId, query, maxResults);

    return {
      persona,
      atoms,
      scenarios,
      conversations,
      taskCanvas,
      fallbackChain,
    };
  }
}
```

```ts
// src/memory/core/backend.ts
export interface MemoryBackend {
  init(): Promise<void>;
  insertInteractionEvent(input: { chatId: string; userId: string; type: "user_message" | "assistant_message" | "tool_call" | "tool_result" | "offload_ref" | "autonomous_action"; content: string; payload?: Record<string, unknown>; createdAt?: string }): Promise<number>;
  insertConversationTurn(input: { chatId: string; userId: string; role: "user" | "assistant" | "tool"; content: string; meta?: Record<string, unknown>; createdAt?: string }): Promise<number>;
  listInteractionEvents(userId: string, chatId: string, limit: number): Promise<Array<{ id: number; type: string; content: string; payload: Record<string, unknown>; createdAt: string }>>;
  listConversationTurns(userId: string, chatId: string, limit: number): Promise<Array<{ id: number; role: "user" | "assistant" | "tool"; content: string; createdAt: string }>>;
  getCheckpoint(userId: string, key: "l1_last_conversation_id" | "l2_last_run_unix" | "l3_last_atom_count"): Promise<string | undefined>;
  setCheckpoint(userId: string, key: "l1_last_conversation_id" | "l2_last_run_unix" | "l3_last_atom_count", value: string): Promise<void>;
  listPendingConversationEvidence(userId: string, limit: number): Promise<Array<{ id: number; role: "user" | "assistant" | "tool"; content: string }>>;
  upsertMemoryAtom(input: { userId: string; text: string; importance: number; sourceTurnIds: number[] }): Promise<number>;
  insertScenarioBlock(input: { userId: string; title: string; bodyMarkdown: string; atomIds: number[] }): Promise<number>;
  upsertPersonaProfile(input: { userId: string; markdown: string; sourceScenarioIds: number[] }): Promise<void>;
  insertLineageLink(input: { userId: string; sourceKind: string; sourceId: string; targetKind: string; targetId: string; linkType: string }): Promise<void>;
  listLineageTargets(userId: string, sourceKind: string, sourceId: string): Promise<Array<{ targetKind: string; targetId: string }>>;
  getPersonaProfile(userId: string): Promise<string | undefined>;
  searchMemoryAtoms(userId: string, query: string, limit: number): Promise<Array<{ id: number; text: string; importance: number }>>;
  searchScenarioBlocks(userId: string, query: string, limit: number): Promise<Array<{ id: number; title: string; body_markdown: string }>>;
  searchConversations(userId: string, query: string, limit: number): Promise<Array<{ id: number; role: string; content: string; created_at: string }>>;
  findFallbackChain(userId: string, query: string, limit: number): Promise<Array<{ missingKind: string; missingId: string; fallbackKind: string; fallbackId: string }>>;
  getTaskCanvas(chatId: string): Promise<string | undefined>;
}
```

```ts
// src/memory/backends/sqlite/backend.ts
async findFallbackChain(userId: string, _query: string, limit: number) {
  return this.db.query(`
    SELECT source_kind, source_id, target_kind, target_id
    FROM lineage_links
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(userId, limit).map((row: any) => ({
    missingKind: row.source_kind,
    missingId: row.source_id,
    fallbackKind: row.target_kind,
    fallbackId: row.target_id,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/memory/recall.test.ts && bun run typecheck`
Expected: PASS with scenario fallback returned when no direct atom hit is available.

- [ ] **Step 5: Commit**

```bash
git add src/memory/recall/service.ts src/memory/core/backend.ts src/memory/backends/sqlite/backend.ts tests/memory/recall.test.ts
git commit -m "feat: add lineage-aware recall"
```

### Task 5: Implement offload refs, task graph nodes, and Mermaid canvas

**Files:**
- Create: `src/memory/offload/service.ts`
- Create: `tests/memory/offload.test.ts`
- Modify: `src/memory/core/backend.ts`
- Modify: `src/memory/backends/sqlite/migrate.ts`
- Modify: `src/memory/backends/sqlite/backend.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrateSqliteMemory } from "../../src/memory/backends/sqlite/migrate";
import { SqliteMemoryBackend } from "../../src/memory/backends/sqlite/backend";
import { OffloadService } from "../../src/memory/offload/service";

test("offload writes refs and canvas, then degrades safely when file writes fail", async () => {
  const db = new Database(":memory:");
  migrateSqliteMemory(db);
  const backend = new SqliteMemoryBackend(db, {
    dataDir: "/tmp/grammy-memory-test",
    refsDir: "/tmp/grammy-memory-test/refs",
    canvasDir: "/tmp/grammy-memory-test/canvases",
  });

  const ok = new OffloadService(backend, { offloadMinChars: 10, offloadSummaryChars: 80 }, async () => undefined);
  const stored = await ok.offloadToolResult({
    chatId: "c1",
    userId: "u1",
    toolName: "demo_tool",
    args: { city: "Bandung" },
    rawResult: "x".repeat(200),
  });

  expect(stored.offloaded).toBe(true);
  expect(stored.resultRef).toContain("memory/refs/");

  const failingWriter = mock(async () => {
    throw new Error("disk full");
  });
  const degraded = new OffloadService(backend, { offloadMinChars: 10, offloadSummaryChars: 80 }, failingWriter);
  const fallback = await degraded.offloadToolResult({
    chatId: "c1",
    userId: "u1",
    toolName: "demo_tool",
    args: {},
    rawResult: "y".repeat(200),
  });

  expect(fallback.offloaded).toBe(false);
  expect(fallback.content).toContain("[offload-fallback]");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/memory/offload.test.ts`
Expected: FAIL because the offload service and `offload_refs`/`task_graph_nodes` tables do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/memory/backends/sqlite/migrate.ts
CREATE TABLE IF NOT EXISTS offload_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  node_id TEXT NOT NULL UNIQUE,
  file_path TEXT,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_graph_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  node_id TEXT NOT NULL UNIQUE,
  tool_name TEXT,
  summary TEXT NOT NULL,
  result_ref TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

```ts
// src/memory/offload/service.ts
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { MemoryBackend } from "../core/backend";
import { truncateText } from "../../utils/text";

export class OffloadService {
  constructor(
    private readonly backend: MemoryBackend,
    private readonly config: { offloadMinChars: number; offloadSummaryChars: number },
    private readonly writeText: (path: string, content: string) => Promise<void> = (path, content) => writeFile(path, content, "utf8"),
  ) {}

  async offloadToolResult(input: { chatId: string; userId: string; toolName: string; args: Record<string, unknown>; rawResult: string }) {
    const summary = truncateText(input.rawResult.replace(/\s+/g, " ").trim(), this.config.offloadSummaryChars);
    if (input.rawResult.length < this.config.offloadMinChars) {
      return { offloaded: false, content: input.rawResult, summary };
    }

    const nodeId = `ref_${Date.now().toString(36)}`;
    const filePath = join(await this.backend.getRefsDir(input.chatId), `${nodeId}.md`);
    const resultRef = relative(await this.backend.getDataDir(), filePath);

    try {
      await mkdir(await this.backend.getRefsDir(input.chatId), { recursive: true });
      await this.writeText(filePath, `# Offloaded tool result\n\n## Summary\n${summary}\n\n## Raw result\n\n${input.rawResult}`);
      await this.backend.insertOffloadRef({ chatId: input.chatId, userId: input.userId, nodeId, filePath: resultRef, summary });
      await this.backend.insertTaskGraphNode({ chatId: input.chatId, userId: input.userId, nodeId, toolName: input.toolName, summary, resultRef, status: "offloaded" });
      await this.backend.writeTaskCanvas(input.chatId);
      return { offloaded: true, nodeId, resultRef, summary, content: `[offloaded]\nnode_id=${nodeId}\nresult_ref=${resultRef}` };
    } catch {
      await this.backend.insertTaskGraphNode({ chatId: input.chatId, userId: input.userId, nodeId, toolName: input.toolName, summary, resultRef: undefined, status: "inline-fallback" });
      return { offloaded: false, summary, content: `[offload-fallback]\nsummary=${summary}` };
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/memory/offload.test.ts && bun run typecheck`
Expected: PASS for both stored offload refs and degraded inline fallback.

- [ ] **Step 5: Commit**

```bash
git add src/memory/offload/service.ts src/memory/core/backend.ts src/memory/backends/sqlite/migrate.ts src/memory/backends/sqlite/backend.ts tests/memory/offload.test.ts
git commit -m "feat: add offload refs and task canvas"
```

### Task 6: Load `sqlite-vec` and wire local vector search

**Files:**
- Modify: `package.json`
- Create: `src/memory/backends/sqlite/vec.ts`
- Create: `tests/memory/sqlite-vec.test.ts`
- Modify: `src/memory/backends/sqlite/migrate.ts`
- Modify: `src/memory/backends/sqlite/backend.ts`
- Modify: `src/memory/recall/service.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { loadSqliteVec } from "../../src/memory/backends/sqlite/vec";

test("sqlite-vec loads in Bun and can execute a nearest-neighbor query", () => {
  const db = new Database(":memory:");
  loadSqliteVec(db as never);

  db.exec("CREATE VIRTUAL TABLE vec_items USING vec0(embedding float[4])");
  db.query("INSERT INTO vec_items(rowid, embedding) VALUES (?, ?)").run(1, new Float32Array([0.1, 0.1, 0.1, 0.1]));
  db.query("INSERT INTO vec_items(rowid, embedding) VALUES (?, ?)").run(2, new Float32Array([0.9, 0.9, 0.9, 0.9]));

  const rows = db.query(`
    SELECT rowid, distance
    FROM vec_items
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT 1
  `).all(new Float32Array([0.1, 0.1, 0.1, 0.1])) as Array<{ rowid: number; distance: number }>;

  expect(rows[0]?.rowid).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/memory/sqlite-vec.test.ts`
Expected: FAIL because `sqlite-vec` is not installed and `loadSqliteVec()` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```json
// package.json
{
  "dependencies": {
    "sqlite-vec": "latest"
  }
}
```

```ts
// src/memory/backends/sqlite/vec.ts
import * as sqliteVec from "sqlite-vec";

export function loadSqliteVec(db: unknown) {
  sqliteVec.load(db as never);
  return db;
}
```

```ts
// src/memory/backends/sqlite/migrate.ts
CREATE VIRTUAL TABLE IF NOT EXISTS memory_atom_vec USING vec0(
  embedding float[1536]
);
```

```ts
// src/memory/backends/sqlite/backend.ts
import { loadSqliteVec } from "./vec";

async init(): Promise<void> {
  loadSqliteVec(this.db as never);
}
```

```ts
// src/memory/recall/service.ts
const atoms = await this.backend.searchMemoryAtoms(userId, query, maxResults);
const vectorAtoms = await this.backend.searchMemoryAtomsByVector?.(userId, query, maxResults) ?? [];
const mergedAtoms = [...vectorAtoms, ...atoms].slice(0, maxResults);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun install && bun test tests/memory/sqlite-vec.test.ts && bun run typecheck`
Expected: PASS with `sqlite-vec` loaded and the nearest-neighbor query returning row `1`.

- [ ] **Step 5: Commit**

```bash
git add package.json src/memory/backends/sqlite/vec.ts src/memory/backends/sqlite/migrate.ts src/memory/backends/sqlite/backend.ts src/memory/recall/service.ts tests/memory/sqlite-vec.test.ts
git commit -m "feat: add sqlite-vec local search"
```

### Task 7: Add MemoryService orchestration and keep the `tdai_*` tool surface

**Files:**
- Create: `src/memory/core/service.ts`
- Create: `src/memory/integration/factory.ts`
- Create: `tests/memory/tools.test.ts`
- Modify: `src/tools/types.ts`
- Modify: `src/tools/local.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { createLocalTools } from "../../src/tools/local";

const memory = {
  recall: async () => ({ persona: "- Uses Bun", atoms: [], scenarios: [], conversations: [], taskCanvas: undefined, fallbackChain: [] }),
  searchConversations: async () => "#1 [2026-05-17] user: remember Bun",
  readContextRef: async () => "# Offloaded tool result\n",
  memoryStatus: async () => "backend=sqlite",
  saveMemory: async () => 1,
};

test("tool surface stays stable while calling MemoryService", async () => {
  const tools = createLocalTools(memory as any);
  expect(tools.map((tool) => tool.name)).toEqual([
    "tdai_memory_search",
    "tdai_conversation_search",
    "tdai_context_ref_read",
    "tdai_memory_status",
    "save_memory",
    "telegram_send_message",
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/memory/tools.test.ts`
Expected: FAIL because `createLocalTools` still requires the old `MemoryStore` shape.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/memory/core/service.ts
import { InteractionLogService } from "../events/service";
import { PipelineCoordinator } from "../pipeline/coordinator";
import { RecallService } from "../recall/service";
import { OffloadService } from "../offload/service";
import type { MemoryBackend } from "./backend";

export class MemoryService {
  constructor(
    private readonly backend: MemoryBackend,
    private readonly logs: InteractionLogService,
    private readonly pipeline: PipelineCoordinator,
    private readonly recallService: RecallService,
    private readonly offloadService: OffloadService,
  ) {}

  logUserMessage(input: { chatId: string; userId: string; content: string; mode: "chat" | "autonomous" }) {
    return this.logs.logUserMessage(input);
  }

  logAssistantMessage(input: { chatId: string; userId: string; content: string; mode: "chat" | "autonomous"; toolIterations?: number }) {
    return this.logs.logAssistantMessage(input);
  }

  logToolCall(input: { chatId: string; userId: string; toolName: string; toolCallId: string; args: Record<string, unknown> }) {
    return this.logs.logToolCall(input);
  }

  logToolResult(input: { chatId: string; userId: string; toolName: string; toolCallId: string; content: string; offloaded: boolean; nodeId?: string; resultRef?: string }) {
    return this.logs.logToolResult(input);
  }

  recentMessages(chatId: string, limit: number) {
    return this.backend.listRecentMessages(chatId, limit);
  }

  listInteractionEvents(userId: string, chatId: string, limit: number) {
    return this.backend.listInteractionEvents(userId, chatId, limit);
  }

  recall(userId: string, query: string, maxResults: number, chatId?: string) {
    return this.recallService.recall(userId, query, maxResults, chatId);
  }

  searchConversations(userId: string, query: string, limit: number) {
    return this.backend.searchConversationsAsText(userId, query, limit);
  }

  readContextRef(input: { userId: string; nodeId?: string; resultRef?: string }) {
    return this.backend.readContextRef(input);
  }

  memoryStatus(userId: string, chatId?: string) {
    return this.backend.memoryStatus(userId, chatId);
  }

  saveMemory(input: { userId: string; text: string; importance: number }) {
    return this.backend.upsertMemoryAtom({ userId: input.userId, text: input.text, importance: input.importance, sourceTurnIds: [] });
  }

  runMaintenanceForUser(userId: string, force = false) {
    return this.pipeline.runMaintenanceForUser(userId, force);
  }

  offloadToolResult(input: { chatId: string; userId: string; toolName: string; args: Record<string, unknown>; rawResult: string }) {
    return this.offloadService.offloadToolResult(input);
  }
}
```

```ts
// src/memory/integration/factory.ts
import type { Database } from "bun:sqlite";
import type { LlmProvider } from "../../agent/types";
import { config } from "../../config";
import { InteractionLogService } from "../events/service";
import { PipelineCoordinator } from "../pipeline/coordinator";
import { RecallService } from "../recall/service";
import { OffloadService } from "../offload/service";
import { SqliteMemoryBackend } from "../backends/sqlite/backend";
import { MemoryService } from "../core/service";

export async function createMemoryService(input: { db: Database; llm: LlmProvider }) {
  const paths = {
    dataDir: config.storage.dataDir,
    refsDir: config.storage.memoryRefsDir,
    canvasDir: config.storage.memoryCanvasDir,
  };

  const backend = new SqliteMemoryBackend(input.db, paths);
  await backend.init();

  return new MemoryService(
    backend,
    new InteractionLogService(backend, {
      enabled: config.memory.jsonlExportEnabled,
      exportDir: config.storage.memoryJsonlExportDir,
    }),
    new PipelineCoordinator(backend, input.llm),
    new RecallService(backend),
    new OffloadService(backend, {
      offloadMinChars: config.memory.offloadMinChars,
      offloadSummaryChars: config.memory.offloadSummaryChars,
    }),
  );
}
```

```ts
// src/tools/types.ts
import type { MemoryService } from "../memory/core/service";

export type ToolContext = {
  chatId: string;
  userId: string;
  memory: MemoryService;
  telegram?: Api;
};
```

```ts
// src/tools/local.ts
import type { MemoryService } from "../memory/core/service";

export function createLocalTools(memory: MemoryService, telegram?: Api): RegisteredTool[] {
  return [
    { name: "tdai_memory_search", source: "local", description: "Search persona, scenarios, atoms, conversations, and active canvas.", inputSchema: { type: "object", properties: { query: { type: "string" }, maxResults: { type: "number" } }, required: ["query"], additionalProperties: false }, async execute(args, ctx) { const recall = await memory.recall(ctx.userId, String(args.query ?? ""), Number(args.maxResults ?? 5), ctx.chatId); return recall.persona ?? "No relevant memory found."; } },
    { name: "tdai_conversation_search", source: "local", description: "Search raw L0 conversation evidence.", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"], additionalProperties: false }, async execute(args, ctx) { return memory.searchConversations(ctx.userId, String(args.query ?? ""), Number(args.limit ?? 5)); } },
    { name: "tdai_context_ref_read", source: "local", description: "Read an offloaded raw result by node_id or result_ref.", inputSchema: { type: "object", properties: { node_id: { type: "string" }, result_ref: { type: "string" } }, additionalProperties: false }, async execute(args, ctx) { return memory.readContextRef({ userId: ctx.userId, nodeId: String(args.node_id ?? ""), resultRef: String(args.result_ref ?? "") }); } },
    { name: "tdai_memory_status", source: "local", description: "Inspect local SQLite memory counts, sqlite-vec status, and offload state.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, async execute(_args, ctx) { return memory.memoryStatus(ctx.userId, ctx.chatId); } },
    { name: "save_memory", source: "local", description: "Store one durable memory atom.", inputSchema: { type: "object", properties: { text: { type: "string" }, importance: { type: "number", minimum: 1, maximum: 5 } }, required: ["text"], additionalProperties: false }, async execute(args, ctx) { const id = await memory.saveMemory({ userId: ctx.userId, text: String(args.text ?? ""), importance: Number(args.importance ?? 3) }); return id > 0 ? `Saved memory atom #${id}.` : "Memory was empty or duplicate."; } },
    { name: "telegram_send_message", source: "local", description: "Send a Telegram message to the current chat.", inputSchema: { type: "object", properties: { text: { type: "string" }, chat_id: { type: "string" } }, required: ["text"], additionalProperties: false }, async execute(args, ctx) { const api = telegram ?? ctx.telegram; if (!api) return "Telegram API unavailable."; const chatId = String(args.chat_id ?? ctx.chatId); await api.sendMessage(chatId, String(args.text ?? "")); return `Sent Telegram message to ${chatId}.`; } },
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/memory/tools.test.ts && bun run typecheck`
Expected: PASS with stable `tdai_*` names and new `MemoryService` dependency.

- [ ] **Step 5: Commit**

```bash
git add src/memory/core/service.ts src/memory/integration/factory.ts src/tools/types.ts src/tools/local.ts tests/memory/tools.test.ts
git commit -m "feat: add memory service and tool adapter"
```

### Task 8: Integrate MemoryService into the agent, bot, and cron loops

**Files:**
- Create: `tests/memory/agent-runtime.test.ts`
- Modify: `src/index.ts`
- Modify: `src/agent/react-agent.ts`
- Modify: `src/bot/bot.ts`
- Modify: `src/cron/autonomous.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate } from "../../src/db/schema";
import { ToolRegistry } from "../../src/tools/registry";
import { createLocalTools } from "../../src/tools/local";
import { runReactAgent } from "../../src/agent/react-agent";
import { createMemoryService } from "../../src/memory/integration/factory";

const llm = {
  async complete() {
    return {
      content: "Done. I saved the memory.",
      toolCalls: [],
    };
  },
};

test("agent loop logs user and assistant turns through MemoryService", async () => {
  const db = new Database(":memory:");
  migrate(db);
  const memory = await createMemoryService({ db, llm: llm as any });
  const registry = new ToolRegistry(db);
  registry.registerMany(createLocalTools(memory));

  const answer = await runReactAgent({
    chatId: "c1",
    userId: "u1",
    input: "remember that we use Bun",
    memory,
    registry,
    llm: llm as any,
    mode: "chat",
  });

  expect(answer).toContain("Done.");
  const events = await memory.listInteractionEvents("u1", "c1", 10);
  expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["user_message", "assistant_message"]));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/memory/agent-runtime.test.ts`
Expected: FAIL because the runtime still instantiates `MemoryStore` directly and the agent loop does not use the new logging methods.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/index.ts
import { createMemoryService } from "./memory/integration/factory";

async function main() {
  initDb();
  assertRuntimeConfig();

  const llm = createLlmProvider();
  const memory = await createMemoryService({ db, llm });
  const registry = new ToolRegistry(db);
  const bot = createTelegramBot({ db, memory, registry, llm });

  registry.registerMany(createLocalTools(memory, bot.api));
  startAutonomousLoop({ db, bot, memory, registry, llm });
  startMemoryMaintenanceLoop({ db, memory });
}
```

```ts
// src/agent/react-agent.ts
await input.memory.logUserMessage({
  chatId: input.chatId,
  userId: input.userId,
  content: input.input,
  mode: input.mode ?? "chat",
});

const [recent, recall] = await Promise.all([
  input.memory.recentMessages(input.chatId, config.agent.maxRecentMessages),
  input.memory.recall(input.userId, input.input, config.memory.recallMaxResults, input.chatId),
]);

await input.memory.logToolCall({
  chatId: input.chatId,
  userId: input.userId,
  toolName: call.name,
  toolCallId: call.id,
  args: call.arguments ?? {},
});

await input.memory.logAssistantMessage({
  chatId: input.chatId,
  userId: input.userId,
  content: answer,
  mode: input.mode ?? "chat",
  toolIterations: i,
});
```

```ts
// src/cron/autonomous.ts
export function startMemoryMaintenanceLoop(input: { db: Database; memory: MemoryService }) {
  cron.schedule(config.memory.maintenanceCron, async () => {
    const users = input.db.query(`SELECT DISTINCT user_id FROM conversations ORDER BY id DESC LIMIT 50`).all() as Array<{ user_id: string }>;
    for (const user of users) {
      await input.memory.runMaintenanceForUser(user.user_id);
    }
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/memory/agent-runtime.test.ts && bun run typecheck`
Expected: PASS with user/assistant interaction events stored through the new service.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/agent/react-agent.ts src/bot/bot.ts src/cron/autonomous.ts tests/memory/agent-runtime.test.ts
git commit -m "feat: wire memory service into runtime"
```

### Task 9: Remove the old store/vendor flow and update docs and inspection tools

**Files:**
- Create: `tests/memory/readme.test.ts`
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `scripts/inspect-memory.ts`
- Delete: `src/memory/store.ts`
- Modify or replace: `src/memory/jsonl.ts` only if you want to reuse parts of it for the new optional JSONL export path; otherwise remove it after `src/memory/events/jsonl-export.ts` is in place.
- Delete: `scripts/vendor-tencentdb-agent-memory.ts`
- Delete: `vendor/tencentdb-agent-memory/` after final verification

- [ ] **Step 1: Write the failing verification step**

```ts
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("README no longer documents vendor:tencent-memory workflow", () => {
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  expect(readme.includes("vendor:tencent-memory")).toBe(false);
  expect(readme.includes("project-owned memory backend")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/memory/config.test.ts tests/memory/sqlite-backend.test.ts tests/memory/pipeline.test.ts tests/memory/recall.test.ts tests/memory/offload.test.ts tests/memory/sqlite-vec.test.ts tests/memory/tools.test.ts tests/memory/agent-runtime.test.ts tests/memory/readme.test.ts`
Expected: PASS for the implementation tests and FAIL for the README expectation until the docs are updated.

- [ ] **Step 3: Write minimal implementation**

```md
## Memory backend

This project uses a project-owned memory backend for the Bun/grammY agent runtime.

- This project uses a local-first SQLite memory store with `sqlite-vec` and FTS5.
- JSONL is optional and only used for append-only export/debug traces.
- The old `vendor:tencent-memory` workflow and OpenClaw/Hermes runtime notes are removed from this project because they are no longer part of the runtime path.
```

```ts
// scripts/inspect-memory.ts
const counts = {
  interactionEvents: db.query(`SELECT COUNT(*) AS count FROM interaction_events`).get() as { count: number },
  conversations: db.query(`SELECT COUNT(*) AS count FROM conversations`).get() as { count: number },
  memoryAtoms: db.query(`SELECT COUNT(*) AS count FROM memory_atoms`).get() as { count: number },
  scenarios: db.query(`SELECT COUNT(*) AS count FROM scenario_blocks`).get() as { count: number },
  personas: db.query(`SELECT COUNT(*) AS count FROM persona_profiles`).get() as { count: number },
  offloadRefs: db.query(`SELECT COUNT(*) AS count FROM offload_refs`).get() as { count: number },
};
```

```bash
# final cleanup
git rm src/memory/store.ts scripts/vendor-tencentdb-agent-memory.ts
# remove vendor/tencentdb-agent-memory/ once the full suite below stays green
# remove src/memory/jsonl.ts only if it is not reused by the new optional JSONL export module
```

- [ ] **Step 4: Run final verification**

Run: `bun run test && bun run typecheck && bun src/index.ts --migrate-only`
Expected: all tests PASS, TypeScript exits 0, and migrate-only prints the database path without touching the deleted vendor flow.

- [ ] **Step 5: Commit**

```bash
git add README.md .env.example scripts/inspect-memory.ts tests/memory/readme.test.ts
git rm src/memory/store.ts scripts/vendor-tencentdb-agent-memory.ts
git commit -m "refactor: remove vendor-based memory runtime"
```

---

## Self-review

### Spec coverage

- Full project-owned layered memory: Tasks 2, 3, 7, 8
- Structured chat/tool/autonomous logging plus optional JSONL debug export: Tasks 2 and 8
- Lineage-aware recall and fallback: Tasks 3, 4, and 5
- Offload refs and Mermaid task canvas: Task 5
- SQLite mode: Tasks 1, 2, 3, 4, 5, 7, 8
- sqlite-vec local vector search: Task 6 and final integration in Task 8
- Bun-only runtime with no OpenClaw/Hermes/gateway concerns: Tasks 6, 8, and 9
- Vendor removal and docs cleanup: Task 9

### Placeholder scan

- No `TODO`, `TBD`, or “implement later” markers remain in the tasks.
- Each code-changing step includes concrete file paths and code snippets.
- Each verification step names the exact command to run.

### Type consistency

- The runtime should consistently depend on `MemoryService`, not `MemoryStore`, after Task 7.
- The backend contract should consistently support the local-first SQLite implementation without leaking `sqlite-vec` details into higher-level services.
- Interaction logging should consistently use the event types defined in `src/memory/core/types.ts`.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-17-project-owned-memory-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**