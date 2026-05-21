# Remove MCP Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove MCP support and MCP-specific metadata from the repo so the app runs only with built-in local tools and the project-owned memory backend.

**Architecture:** Convert bootstrap to a local-only flow, delete the `src/mcp` module, and simplify config/tool-registry surfaces so they no longer model MCP. Lock the cleanup in with repo-state, config, and schema tests that fail on any return of MCP runtime code, dependency metadata, or project MCP config files.

**Tech Stack:** Bun, TypeScript, grammY, bun:sqlite, Bun test

---

## File Map

- `tests/runtime/remove-mcp-runtime.test.ts` — regression coverage for runtime bootstrap cleanup, deleted `src/mcp/*` files, and MCP-free agent prompt text.
- `tests/memory/config.test.ts` — asserts `parseConfig()` no longer exposes `storage.mcpConfigPath`.
- `src/index.ts` — bootstrap only local tools; remove MCP startup/shutdown lifecycle.
- `src/config.ts` — remove `MCP_CONFIG_PATH` parsing and `storage.mcpConfigPath`.
- `src/agent/react-agent.ts` — remove MCP wording from the system prompt.
- `src/mcp/config.ts` — delete; project no longer loads MCP config files.
- `src/mcp/manager.ts` — delete; project no longer spawns MCP clients or wraps MCP tools.
- `tests/tools/registry.test.ts` — regression coverage for the `tool_registry` schema and `listDebug()` shape after removing MCP-only metadata.
- `src/tools/types.ts` — `RegisteredTool` becomes local-only and drops `serverName` / `originalName`.
- `src/tools/registry.ts` — persist only local-tool fields and simplify `listDebug()` output.
- `src/db/schema.ts` — rebuild `tool_registry` without `server_name` / `original_name` because those columns only existed for MCP.
- `src/bot/bot.ts` — simplify `/tools` output so it no longer expects per-server MCP details.
- `tests/repo/remove-mcp-support.test.ts` — regression coverage for removed MCP config files, README/env cleanup, package metadata, and dependency removal.
- `README.md` — remove MCP setup/docs and file references.
- `.env.example` — remove `MCP_CONFIG_PATH`.
- `package.json` — remove `@modelcontextprotocol/sdk` and rename the package to drop `mcp` from the live package name.
- `bun.lock` — refresh after dependency/package-name changes.
- `mcp.servers.json` — delete; runtime no longer reads project MCP config.
- `mcp.servers.example.json` — delete; runtime no longer reads project MCP config.
- `tests/mcp/remove-demo-mcp.test.ts` — delete; superseded by full MCP-removal regression coverage.

### Task 1: Remove MCP runtime bootstrap

**Files:**
- Create: `tests/runtime/remove-mcp-runtime.test.ts`
- Modify: `tests/memory/config.test.ts:1-25`
- Modify: `src/index.ts:1-79`
- Modify: `src/config.ts:32-88`
- Modify: `src/agent/react-agent.ts:93-115`
- Delete: `src/mcp/config.ts`
- Delete: `src/mcp/manager.ts`
- Test: `tests/runtime/remove-mcp-runtime.test.ts`
- Test: `tests/memory/config.test.ts`

- [ ] **Step 1: Write the failing runtime and config regression tests**

```ts
// tests/runtime/remove-mcp-runtime.test.ts
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

test("runtime no longer ships MCP bootstrap files or MCP prompt text", () => {
  const indexSource = readFileSync(new URL("../../src/index.ts", import.meta.url), "utf8");
  const agentSource = readFileSync(new URL("../../src/agent/react-agent.ts", import.meta.url), "utf8");

  expect(existsSync(new URL("../../src/mcp/config.ts", import.meta.url))).toBe(false);
  expect(existsSync(new URL("../../src/mcp/manager.ts", import.meta.url))).toBe(false);
  expect(indexSource.includes("loadMcpConfig")).toBe(false);
  expect(indexSource.includes("McpManager")).toBe(false);
  expect(agentSource.includes("MCP tools")).toBe(false);
});
```

```ts
// tests/memory/config.test.ts
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

test("parseConfig no longer exposes an MCP config path", () => {
  const runtime = parseConfig({
    BOT_TOKEN: "123:abc",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
  });

  expect("mcpConfigPath" in runtime.storage).toBe(false);
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

- [ ] **Step 2: Run the targeted tests to verify they fail before implementation**

Run:

```bash
bun test tests/runtime/remove-mcp-runtime.test.ts tests/memory/config.test.ts
```

Expected: FAIL because `src/mcp/config.ts` and `src/mcp/manager.ts` still exist, `src/index.ts` still references `loadMcpConfig` / `McpManager`, `src/agent/react-agent.ts` still says `MCP tools`, and `parseConfig()` still returns `storage.mcpConfigPath`.

- [ ] **Step 3: Remove the runtime MCP wiring and prompt text**

```ts
// src/index.ts
import { assertRuntimeConfig, config, getRuntimeConfigSummary } from "./config";
import { db, initDb } from "./db";
import { createLlmProvider } from "./agent/providers";
import { createMemoryService } from "./memory/integration/factory";
import { ToolRegistry } from "./tools/registry";
import { createLocalTools } from "./tools/local";
import { createTelegramBot } from "./bot/bot";
import { startAutonomousLoop, startMemoryMaintenanceLoop } from "./cron/autonomous";

async function main() {
  initDb();

  if (process.argv.includes("--migrate-only")) {
    console.log(`Migration done: ${config.storage.dbPath}`);
    return;
  }

  assertRuntimeConfig();
  console.log("Runtime config", getRuntimeConfigSummary());

  const llm = createLlmProvider();
  const memory = await createMemoryService(db, llm, {
    storage: {
      dataDir: config.storage.dataDir,
      memoryRefsDir: config.storage.memoryRefsDir,
      memoryCanvasDir: config.storage.memoryCanvasDir,
      memoryJsonlExportDir: config.storage.memoryJsonlExportDir,
    },
    memory: {
      maintenanceCron: config.memory.maintenanceCron,
      offloadEnabled: config.memory.offloadEnabled,
      offloadMinChars: config.memory.offloadMinChars,
      offloadSummaryChars: config.memory.offloadSummaryChars,
      sqliteVecEnabled: config.memory.sqliteVecEnabled,
      jsonlExportEnabled: config.memory.jsonlExportEnabled,
    },
  });
  const registry = new ToolRegistry(db);

  const bot = createTelegramBot({ db, memory, registry, llm });

  registry.registerMany(createLocalTools(memory, bot.api));

  startAutonomousLoop({ db, bot, memory, registry, llm });
  startMemoryMaintenanceLoop({ db, memory, llm });

  const stop = async () => {
    console.log("Shutting down...");
    await bot.stop().catch(() => undefined);
    db.close();
    process.exit(0);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  console.log("Telegram bot starting...");
  await bot.start();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

```ts
// Replace the start of parseConfig() in src/config.ts with this block.
export function parseConfig(source: ConfigSource) {
  const dataDir = resolvePath(env(source, "DATA_DIR", "./data"));
  const dbPath = resolvePath(env(source, "DB_PATH", `${dataDir}/agent.db`));
  const historyDir = resolvePath(`${dataDir}/history`);
  const memoryDir = resolvePath(`${dataDir}/memory`);
  const memoryScenarioDir = resolvePath(`${memoryDir}/scenarios`);
  const memoryRefsDir = resolvePath(`${memoryDir}/refs`);
  const memoryCanvasDir = resolvePath(`${memoryDir}/canvases`);
  const memoryJsonlExportDir = resolvePath(env(source, "MEMORY_JSONL_EXPORT_DIR", `${memoryDir}/jsonl`));

  return {
    telegram: {
      botToken: env(source, "BOT_TOKEN"),
    },
    llm: {
      provider: env(source, "LLM_PROVIDER", "openai") as "openai" | "anthropic",
      openai: {
        apiKey: env(source, "OPENAI_API_KEY"),
        baseURL: env(source, "OPENAI_BASE_URL", "https://api.openai.com/v1"),
        model: env(source, "OPENAI_MODEL", "gpt-4.1-mini"),
      },
      anthropic: {
        apiKey: env(source, "ANTHROPIC_API_KEY"),
        model: env(source, "ANTHROPIC_MODEL", "claude-sonnet-4-5"),
      },
    },
    agent: {
      maxToolIterations: intEnv(source, "MAX_TOOL_ITERATIONS", 6),
      maxRecentMessages: intEnv(source, "MAX_RECENT_MESSAGES", 12),
    },
    storage: {
      dataDir,
      dbPath,
      historyDir,
      memoryDir,
      memoryScenarioDir,
      memoryRefsDir,
      memoryCanvasDir,
      memoryJsonlExportDir,
    },
    memory: {
      maintenanceCron: env(source, "MEMORY_MAINTENANCE_CRON", "*/10 * * * *"),
      recallMaxResults: intEnv(source, "MEMORY_RECALL_MAX_RESULTS", 5),
      offloadEnabled: boolEnv(source, "MEMORY_OFFLOAD_ENABLED", true),
      offloadMinChars: intEnv(source, "MEMORY_OFFLOAD_MIN_CHARS", 2500),
      offloadSummaryChars: intEnv(source, "MEMORY_OFFLOAD_SUMMARY_CHARS", 900),
      sqliteVecEnabled: boolEnv(source, "MEMORY_SQLITE_VEC_ENABLED", true),
      jsonlExportEnabled: boolEnv(source, "MEMORY_JSONL_EXPORT_ENABLED", false),
    },
    autonomous: {
      cron: env(source, "AUTONOMOUS_CRON", "*/10 * * * *"),
      minIntervalSec: intEnv(source, "AUTONOMOUS_MIN_INTERVAL_SEC", 600),
      maxJobsPerTick: intEnv(source, "AUTONOMOUS_MAX_JOBS_PER_TICK", 20),
    },
  };
}
```

```ts
// src/agent/react-agent.ts
const system = `You are a Telegram AI agent running on grammY + built-in local tools + a project-owned local memory backend.

Use a ReAct-style loop internally:
```

```bash
rm src/mcp/config.ts src/mcp/manager.ts
```

- [ ] **Step 4: Run the runtime tests and typecheck to verify the cleanup passes**

Run:

```bash
bun test tests/runtime/remove-mcp-runtime.test.ts tests/memory/config.test.ts && bun run typecheck
```

Expected: PASS with no failing assertions and no TypeScript errors.

- [ ] **Step 5: Commit the runtime cleanup**

```bash
git add tests/runtime/remove-mcp-runtime.test.ts tests/memory/config.test.ts src/index.ts src/config.ts src/agent/react-agent.ts
git rm src/mcp/config.ts src/mcp/manager.ts
git commit -m "refactor: remove MCP runtime bootstrap"
```

### Task 2: Drop MCP-only tool registry metadata

**Files:**
- Create: `tests/tools/registry.test.ts`
- Modify: `src/tools/types.ts:1-17`
- Modify: `src/tools/registry.ts:1-66`
- Modify: `src/db/schema.ts:4-125`
- Modify: `src/bot/bot.ts:45-52`
- Test: `tests/tools/registry.test.ts`

- [ ] **Step 1: Write the failing schema and debug-shape tests**

```ts
// tests/tools/registry.test.ts
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { migrate } from "../../src/db/schema";
import { ToolRegistry } from "../../src/tools/registry";

test("migrate rebuilds tool_registry without MCP-only columns", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tool_registry (
      name TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      server_name TEXT,
      original_name TEXT,
      description TEXT NOT NULL,
      input_schema_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
  `);

  migrate(db);

  const columns = new Set(
    (db.query("PRAGMA table_info(tool_registry)").all() as Array<{ name: string }>).map((column) => column.name),
  );

  expect(columns).toEqual(new Set(["name", "source", "description", "input_schema_json", "enabled", "updated_at"]));
});

test("listDebug returns local tool summaries without server metadata", () => {
  const db = new Database(":memory:");
  migrate(db);

  const registry = new ToolRegistry(db);
  registry.register({
    name: "save_memory",
    source: "local",
    description: "Save a durable L1 memory atom.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      return "ok";
    },
  });

  expect(registry.listDebug()).toEqual([
    {
      name: "save_memory",
      source: "local",
      description: "Save a durable L1 memory atom.",
    },
  ]);
});
```

- [ ] **Step 2: Run the registry tests to verify they fail before implementation**

Run:

```bash
bun test tests/tools/registry.test.ts
```

Expected: FAIL because `migrate()` leaves `server_name` / `original_name` in `tool_registry`, and `listDebug()` still returns `serverName` metadata.

- [ ] **Step 3: Simplify the tool types, schema, registry persistence, and `/tools` rendering**

```ts
// src/tools/types.ts
import type { Api } from "grammy";
import type { ToolDefinition } from "../agent/types";
import type { MemoryServiceLike as MemoryService } from "../memory/core/service";

export type ToolContext = {
  chatId: string;
  userId: string;
  memory: MemoryService;
  telegram?: Api;
};

export type RegisteredTool = ToolDefinition & {
  source: "local";
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
};
```

```ts
// src/tools/registry.ts
import type { Database } from "bun:sqlite";
import { nowIso } from "../utils/time";
import type { ToolDefinition } from "../agent/types";
import type { RegisteredTool, ToolContext } from "./types";

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  constructor(private readonly db: Database) {}

  register(tool: RegisteredTool) {
    this.tools.set(tool.name, tool);
    this.db
      .query(`
        INSERT INTO tool_registry (name, source, description, input_schema_json, enabled, updated_at)
        VALUES (?, ?, ?, ?, 1, ?)
        ON CONFLICT(name) DO UPDATE SET
          source = excluded.source,
          description = excluded.description,
          input_schema_json = excluded.input_schema_json,
          updated_at = excluded.updated_at
      `)
      .run(tool.name, tool.source, tool.description, JSON.stringify(tool.inputSchema), nowIso());
  }

  registerMany(tools: RegisteredTool[]) {
    for (const tool of tools) this.register(tool);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  listDebug(): Array<Pick<RegisteredTool, "name" | "source" | "description">> {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      source: tool.source,
      description: tool.description,
    }));
  }

  async call(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return `Tool not found: ${name}`;
    try {
      return await tool.execute(args, ctx);
    } catch (error) {
      return `Tool ${name} failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
```

```ts
// src/db/schema.ts
function hasTable(db: Database, tableName: string) {
  return db.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tableName) !== null;
}

function resetToolRegistrySchema(db: Database) {
  const needsReset =
    hasTable(db, "tool_registry") &&
    (hasColumn(db, "tool_registry", "server_name") || hasColumn(db, "tool_registry", "original_name"));

  if (needsReset) {
    // tool_registry is fully rebuilt at startup, so dropping obsolete MCP columns is safe.
    db.exec(`DROP TABLE tool_registry`);
  }
}

export function migrate(db: Database) {
  migrateSqliteMemory(db);
  resetToolRegistrySchema(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_registry (
      name TEXT PRIMARY KEY,
      source TEXT NOT NULL,
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

    -- Transitional compatibility schema for the current app runtime.
    -- Task 2's dedicated SQLite memory migrator stays minimal while the project-owned
    -- runtime keeps using these memory tables directly.
    CREATE TABLE IF NOT EXISTS memory_atoms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      text TEXT NOT NULL,
      importance INTEGER NOT NULL DEFAULT 3,
      source_turn_ids_json TEXT NOT NULL DEFAULT '[]',
      source_layer TEXT NOT NULL DEFAULT 'L1',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, text)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_atoms_fts USING fts5(
      text,
      atom_id UNINDEXED,
      user_id UNINDEXED,
      tokenize = 'unicode61'
    );

    CREATE TABLE IF NOT EXISTS memory_scenarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body_markdown TEXT NOT NULL,
      atom_ids_json TEXT NOT NULL DEFAULT '[]',
      file_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS personas (
      user_id TEXT PRIMARY KEY,
      markdown TEXT NOT NULL,
      source_scenario_ids_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_pipeline_state (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, key)
    );

    CREATE TABLE IF NOT EXISTS memory_offload_refs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      node_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_task_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      node_id TEXT NOT NULL UNIQUE,
      tool_name TEXT,
      args_json TEXT NOT NULL DEFAULT '{}',
      summary TEXT NOT NULL,
      result_ref TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_run_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      status TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);

  if (!hasColumn(db, "memory_atoms", "source_layer")) {
    db.exec(`ALTER TABLE memory_atoms ADD COLUMN source_layer TEXT NOT NULL DEFAULT 'L1'`);
  }

  if (!hasColumn(db, "memory_scenarios", "file_path")) {
    db.exec(`ALTER TABLE memory_scenarios ADD COLUMN file_path TEXT`);
  }
}
```

```ts
// src/bot/bot.ts
await ctx.reply(
  tools
    .map((tool) => `- ${tool.name} [${tool.source}]\n  ${tool.description}`)
    .join("\n"),
);
```

- [ ] **Step 4: Run the registry test and typecheck to verify the cleanup passes**

Run:

```bash
bun test tests/tools/registry.test.ts && bun run typecheck
```

Expected: PASS with the rebuilt `tool_registry` schema and no remaining `serverName` type errors.

- [ ] **Step 5: Commit the registry cleanup**

```bash
git add tests/tools/registry.test.ts src/tools/types.ts src/tools/registry.ts src/db/schema.ts src/bot/bot.ts
git commit -m "refactor: drop MCP-specific tool registry metadata"
```

### Task 3: Remove remaining MCP repo artifacts

**Files:**
- Create: `tests/repo/remove-mcp-support.test.ts`
- Modify: `README.md:1-165`
- Modify: `.env.example:1-38`
- Modify: `package.json:1-30`
- Modify: `bun.lock`
- Delete: `mcp.servers.json`
- Delete: `mcp.servers.example.json`
- Delete: `tests/mcp/remove-demo-mcp.test.ts`
- Test: `tests/repo/remove-mcp-support.test.ts`

- [ ] **Step 1: Write the failing repo-state regression test**

```ts
// tests/repo/remove-mcp-support.test.ts
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

test("repo no longer ships MCP config, docs, or dependency metadata", () => {
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    name: string;
    dependencies?: Record<string, string>;
  };
  const lock = readFileSync(new URL("../../bun.lock", import.meta.url), "utf8");

  expect(existsSync(new URL("../../mcp.servers.json", import.meta.url))).toBe(false);
  expect(existsSync(new URL("../../mcp.servers.example.json", import.meta.url))).toBe(false);
  expect(existsSync(new URL("../../tests/mcp/remove-demo-mcp.test.ts", import.meta.url))).toBe(false);
  expect(pkg.name.includes("mcp")).toBe(false);
  expect(pkg.dependencies?.["@modelcontextprotocol/sdk"]).toBeUndefined();
  expect(lock.includes("@modelcontextprotocol/sdk")).toBe(false);
  expect(lock.includes("grammy-mcp-openai-claude-agent-bun")).toBe(false);
  expect(envExample.includes("MCP_CONFIG_PATH")).toBe(false);
  expect(readme.includes("MCP")).toBe(false);
  expect(readme.includes("mcp.servers.json")).toBe(false);
  expect(readme.includes("src/mcp/manager.ts")).toBe(false);
  expect(readme.includes("src/mcp/config.ts")).toBe(false);
});
```

- [ ] **Step 2: Run the repo-state regression test to verify it fails before implementation**

Run:

```bash
bun test tests/repo/remove-mcp-support.test.ts
```

Expected: FAIL because the repo still contains MCP config files, MCP README/env text, the MCP SDK dependency, the `grammy-mcp-openai-claude-agent-bun` package name, and the old `tests/mcp/remove-demo-mcp.test.ts` file.

- [ ] **Step 3: Remove the remaining docs, config, package, and test artifacts**

```text
README.md

# grammY + OpenAI/Claude Agent on Bun

Boilerplate Telegram AI agent dengan:
- Bun runtime
- grammY Telegram bot
- OpenAI / OpenAI-compatible provider
- Claude native provider
- SQLite lokal via `bun:sqlite`
- JSONL chat history sebagai L0 evidence trail
- project-owned memory backend: L0 conversation → L1 atom → L2 scenario → L3 persona
- Short-term context offload: heavy tool results masuk `data/memory/refs/*.md`, agent melihat Mermaid canvas ringkas
- ReAct-style tool loop
- `node-cron` autonomous jobs setiap 10 menit dari `.env`

## 1. Install
bun install
cp .env.example .env

## 7. Commands
/start          help
/tools          list tools
/memory         memory status + top memory
/memory_force   force L1→L2→L3 extraction now
/job <prompt>   create autonomous job
/jobs           list autonomous jobs

## 8. File penting
src/index.ts                  bootstrap app
src/bot/bot.ts                grammY handlers
src/agent/react-agent.ts      ReAct-style tool loop + offload integration
src/agent/providers/*         OpenAI/Claude abstraction
src/tools/registry.ts         multi-tool registry persisted in SQLite
src/tools/local.ts            tdai_* memory tools + Telegram tool
src/memory/core/service.ts    project-owned memory service facade
src/memory/integration/*      memory runtime wiring
src/cron/autonomous.ts        node-cron autonomous + memory loops
src/db/schema.ts              SQLite schema
scripts/inspect-memory.ts     inspect the local memory backend

## 9. Notes
- Runtime memory sepenuhnya dimiliki project ini; tidak perlu vendor workflow eksternal untuk menjalankannya.
- `src/memory/jsonl.ts` tetap dipakai untuk export/append JSONL event trail.
```

```env
# .env.example
# Telegram
BOT_TOKEN=123456:telegram-bot-token

# Provider: openai | anthropic
LLM_PROVIDER=openai

# OpenAI or OpenAI-compatible endpoint
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini

# Claude native API
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-5

# Agent
MAX_TOOL_ITERATIONS=6
MAX_RECENT_MESSAGES=12

# Storage
DATA_DIR=./data
DB_PATH=./data/agent.db

# Project-owned local memory backend
MEMORY_SQLITE_VEC_ENABLED=true
MEMORY_JSONL_EXPORT_ENABLED=false
MEMORY_JSONL_EXPORT_DIR=./data/memory/jsonl
MEMORY_MAINTENANCE_CRON=*/10 * * * *
MEMORY_RECALL_MAX_RESULTS=5
MEMORY_OFFLOAD_ENABLED=true
MEMORY_OFFLOAD_MIN_CHARS=2500
MEMORY_OFFLOAD_SUMMARY_CHARS=900

# Autonomous agent loop: every 10 minutes by default
AUTONOMOUS_CRON=*/10 * * * *
AUTONOMOUS_MIN_INTERVAL_SEC=600
AUTONOMOUS_MAX_JOBS_PER_TICK=20
```

```json
// package.json
{
  "name": "grammy-openai-claude-agent-bun",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "start": "bun src/index.ts",
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit",
    "db:reset": "rm -f data/agent.db data/agent.db-shm data/agent.db-wal && bun src/index.ts --migrate-only",
    "memory:inspect": "bun scripts/inspect-memory.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "latest",
    "@grammyjs/conversations": "^2.1.1",
    "grammy": "latest",
    "node-cron": "latest",
    "openai": "latest",
    "sqlite-vec": "latest",
    "yaml": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@types/node-cron": "latest",
    "typescript": "latest"
  }
}
```

```bash
rm -f mcp.servers.json mcp.servers.example.json tests/mcp/remove-demo-mcp.test.ts
bun install
```

- [ ] **Step 4: Run the repo regression, full test suite, and typecheck**

Run:

```bash
bun test tests/repo/remove-mcp-support.test.ts && bun test && bun run typecheck
```

Expected: PASS with the new repo-state regression green, the full Bun test suite green, and no TypeScript errors.

- [ ] **Step 5: Commit the remaining MCP artifact cleanup**

```bash
git add tests/repo/remove-mcp-support.test.ts README.md .env.example package.json bun.lock
git rm mcp.servers.json mcp.servers.example.json
git commit -m "refactor: remove remaining MCP artifacts"
```

## Final verification checklist

- Run `bun test` one more time from the repo root.
- Run `bun run typecheck` one more time from the repo root.
- Run this search and confirm there are no active MCP runtime references left in app source, setup docs, or package metadata:

```bash
rg "MCP|mcp_|mcp\.servers|MCP_CONFIG_PATH|@modelcontextprotocol" src README.md .env.example package.json bun.lock
```

Expected: no matches.
