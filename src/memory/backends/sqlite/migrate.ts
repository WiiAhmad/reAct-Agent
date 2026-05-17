import type { Database } from "bun:sqlite";

export function migrateSqliteMemory(db: Database) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS interaction_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_name TEXT,
      tool_call_id TEXT,
      offloaded INTEGER NOT NULL DEFAULT 0,
      meta_json TEXT NOT NULL DEFAULT '{}',
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
      created_at TEXT NOT NULL,
      UNIQUE(user_id, source_kind, source_id, target_kind, target_id, link_type)
    );

    CREATE TABLE IF NOT EXISTS pipeline_checkpoints (
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

    CREATE TABLE IF NOT EXISTS memory_atom_embeddings (
      atom_id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(atom_id) REFERENCES memory_atoms(id) ON DELETE CASCADE
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
  `);

  const atomColumns = new Set(
    (db.query(`PRAGMA table_info(memory_atoms)`).all() as Array<{ name: string }>).map((row) => row.name),
  );
  if (!atomColumns.has("source_layer")) {
    db.exec(`ALTER TABLE memory_atoms ADD COLUMN source_layer TEXT NOT NULL DEFAULT 'L1'`);
  }

  const scenarioColumns = new Set(
    (db.query(`PRAGMA table_info(memory_scenarios)`).all() as Array<{ name: string }>).map((row) => row.name),
  );
  if (!scenarioColumns.has("file_path")) {
    db.exec(`ALTER TABLE memory_scenarios ADD COLUMN file_path TEXT`);
  }
}
