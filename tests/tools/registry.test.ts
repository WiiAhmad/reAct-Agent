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

test("migrate preserves existing tool_registry rows during rebuild", () => {
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

    INSERT INTO tool_registry (
      name,
      source,
      server_name,
      original_name,
      description,
      input_schema_json,
      enabled,
      updated_at
    ) VALUES (
      'save_memory',
      'mcp',
      'memory-server',
      'save_memory',
      'Save a durable L1 memory atom.',
      '{"type":"object","properties":{},"additionalProperties":false}',
      1,
      '2026-05-17T00:00:00.000Z'
    );
  `);

  migrate(db);

  const row = db.query(
    `SELECT name, source, description, input_schema_json, enabled, updated_at
     FROM tool_registry
     WHERE name = ?`,
  ).get("save_memory") as {
    name: string;
    source: string;
    description: string;
    input_schema_json: string;
    enabled: number;
    updated_at: string;
  } | undefined;

  expect(row).toEqual({
    name: "save_memory",
    source: "mcp",
    description: "Save a durable L1 memory atom.",
    input_schema_json: '{"type":"object","properties":{},"additionalProperties":false}',
    enabled: 1,
    updated_at: "2026-05-17T00:00:00.000Z",
  });
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
