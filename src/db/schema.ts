import { Database } from "bun:sqlite";
import { migrateSqliteMemory } from "../memory/backends/sqlite/migrate";

function hasColumn(db: Database, tableName: string, columnName: string) {
  const columns = db.query(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

function rebuildToolRegistry(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_registry__new (
      name TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      description TEXT NOT NULL,
      input_schema_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    INSERT INTO tool_registry__new (name, source, description, input_schema_json, enabled, updated_at)
    SELECT name, source, description, input_schema_json, enabled, updated_at
    FROM tool_registry;

    DROP TABLE tool_registry;
    ALTER TABLE tool_registry__new RENAME TO tool_registry;
  `);
}

export function migrate(db: Database) {
  migrateSqliteMemory(db);

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
      job_type TEXT NOT NULL DEFAULT 'agent',
      message_text TEXT NOT NULL DEFAULT '',
      agent_prompt TEXT NOT NULL DEFAULT '',
      run_at_unix INTEGER,
      run_count INTEGER NOT NULL DEFAULT 0,
      max_runs INTEGER,
      schedule_mode TEXT NOT NULL DEFAULT 'interval',
      interval_sec INTEGER,
      cron_expr TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at INTEGER,
      last_finished_at INTEGER,
      last_status TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_update_settings (
      user_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      schedule_mode TEXT NOT NULL DEFAULT 'interval',
      interval_sec INTEGER,
      cron_expr TEXT,
      last_run_at INTEGER,
      last_finished_at INTEGER,
      last_status TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_atoms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      text TEXT NOT NULL,
      canonical_text TEXT,
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

  if (hasColumn(db, "tool_registry", "server_name") || hasColumn(db, "tool_registry", "original_name")) {
    rebuildToolRegistry(db);
  }

  if (!hasColumn(db, "memory_atoms", "source_layer")) {
    db.exec(`ALTER TABLE memory_atoms ADD COLUMN source_layer TEXT NOT NULL DEFAULT 'L1'`);
  }
  if (!hasColumn(db, "memory_atoms", "canonical_text")) {
    db.exec(`ALTER TABLE memory_atoms ADD COLUMN canonical_text TEXT`);
  }

  if (!hasColumn(db, "memory_scenarios", "file_path")) {
    db.exec(`ALTER TABLE memory_scenarios ADD COLUMN file_path TEXT`);
  }

  if (!hasColumn(db, "autonomous_jobs", "schedule_mode")) {
    db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN schedule_mode TEXT NOT NULL DEFAULT 'interval'`);
  }
  if (!hasColumn(db, "autonomous_jobs", "interval_sec")) {
    db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN interval_sec INTEGER`);
  }
  if (!hasColumn(db, "autonomous_jobs", "cron_expr")) {
    db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN cron_expr TEXT`);
  }
  if (!hasColumn(db, "autonomous_jobs", "last_finished_at")) {
    db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN last_finished_at INTEGER`);
  }
  if (!hasColumn(db, "autonomous_jobs", "last_status")) {
    db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN last_status TEXT`);
  }
  if (!hasColumn(db, "autonomous_jobs", "last_error")) {
    db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN last_error TEXT`);
  }
  if (!hasColumn(db, "autonomous_jobs", "job_type")) {
    db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN job_type TEXT NOT NULL DEFAULT 'agent'`);
  }
  if (!hasColumn(db, "autonomous_jobs", "message_text")) {
    db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN message_text TEXT NOT NULL DEFAULT ''`);
  }
  if (!hasColumn(db, "autonomous_jobs", "agent_prompt")) {
    db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN agent_prompt TEXT NOT NULL DEFAULT ''`);
  }
  if (!hasColumn(db, "autonomous_jobs", "run_at_unix")) {
    db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN run_at_unix INTEGER`);
  }
  if (!hasColumn(db, "autonomous_jobs", "run_count")) {
    db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN run_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasColumn(db, "autonomous_jobs", "max_runs")) {
    db.exec(`ALTER TABLE autonomous_jobs ADD COLUMN max_runs INTEGER`);
  }
}
