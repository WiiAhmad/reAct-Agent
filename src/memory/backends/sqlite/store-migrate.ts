import type { Database } from "bun:sqlite";

export function migrateSqliteMemoryStore(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_store_l0 (
      record_id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL,
      session_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      message_text TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_store_l0_fts USING fts5(
      message_text,
      record_id UNINDEXED,
      session_key UNINDEXED,
      session_id UNINDEXED,
      chat_id UNINDEXED,
      user_id UNINDEXED,
      tokenize = 'unicode61'
    );

    CREATE TABLE IF NOT EXISTS memory_store_l0_sparse (
      record_id TEXT PRIMARY KEY,
      sparse_vector_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_store_l0_vec_map (
      record_id TEXT PRIMARY KEY,
      vec_rowid INTEGER NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS memory_store_l1 (
      record_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_key TEXT NOT NULL,
      session_id TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT NOT NULL,
      priority INTEGER NOT NULL,
      scene_name TEXT NOT NULL DEFAULT '',
      timestamp_str TEXT NOT NULL,
      timestamp_start TEXT NOT NULL DEFAULT '',
      timestamp_end TEXT NOT NULL DEFAULT '',
      source_conversation_ids_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_time TEXT NOT NULL,
      updated_time TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_store_l1_fts USING fts5(
      content,
      record_id UNINDEXED,
      user_id UNINDEXED,
      session_key UNINDEXED,
      session_id UNINDEXED,
      type UNINDEXED,
      scene_name UNINDEXED,
      tokenize = 'unicode61'
    );

    CREATE TABLE IF NOT EXISTS memory_store_l1_sparse (
      record_id TEXT PRIMARY KEY,
      sparse_vector_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_store_l1_vec_map (
      record_id TEXT PRIMARY KEY,
      vec_rowid INTEGER NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS memory_store_profiles (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('l2', 'l3')),
      user_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      content TEXT NOT NULL,
      content_md5 TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS memory_store_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS memory_store_l0_session_timestamp_idx ON memory_store_l0(session_key, timestamp);
    CREATE INDEX IF NOT EXISTS memory_store_l0_user_timestamp_idx ON memory_store_l0(user_id, timestamp);
    CREATE INDEX IF NOT EXISTS memory_store_l1_user_updated_idx ON memory_store_l1(user_id, updated_time);
    CREATE INDEX IF NOT EXISTS memory_store_profiles_user_type_idx ON memory_store_profiles(user_id, type);
  `);
}
