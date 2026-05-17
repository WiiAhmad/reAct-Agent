import type { Database } from "bun:sqlite";
import { canonicalizeMemoryAtomText, mergeNumberSets } from "./canonical";
import { embedTextToVector, serializeVector } from "./vec";

function parseNumberArray(raw: string): number[] {
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === "number") : [];
}

function hasColumn(db: Database, tableName: string, columnName: string): boolean {
  return (db.query(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).some((row) => row.name === columnName);
}

function repointLineageAtomReferences(db: Database, userId: string, loserId: number, winnerId: number): void {
  const sourceRows = db
    .query(`SELECT id, target_kind, target_id, link_type, created_at FROM lineage_links WHERE user_id = ? AND source_kind = 'memory_atom' AND source_id = ?`)
    .all(userId, String(loserId)) as Array<{
      id: number;
      target_kind: string;
      target_id: string;
      link_type: string;
      created_at: string;
    }>;

  for (const row of sourceRows) {
    const targetId = row.target_kind === "memory_atom" && row.target_id === String(loserId) ? String(winnerId) : row.target_id;
    if (!(row.target_kind === "memory_atom" && targetId === String(winnerId))) {
      db.query(`
        INSERT OR IGNORE INTO lineage_links (user_id, source_kind, source_id, target_kind, target_id, link_type, created_at)
        VALUES (?, 'memory_atom', ?, ?, ?, ?, ?)
      `).run(userId, String(winnerId), row.target_kind, targetId, row.link_type, row.created_at);
    }
    db.query(`DELETE FROM lineage_links WHERE id = ?`).run(row.id);
  }

  const targetRows = db
    .query(`SELECT id, source_kind, source_id, link_type, created_at FROM lineage_links WHERE user_id = ? AND target_kind = 'memory_atom' AND target_id = ?`)
    .all(userId, String(loserId)) as Array<{
      id: number;
      source_kind: string;
      source_id: string;
      link_type: string;
      created_at: string;
    }>;

  for (const row of targetRows) {
    const sourceId = row.source_kind === "memory_atom" && row.source_id === String(loserId) ? String(winnerId) : row.source_id;
    if (!(row.source_kind === "memory_atom" && sourceId === String(winnerId))) {
      db.query(`
        INSERT OR IGNORE INTO lineage_links (user_id, source_kind, source_id, target_kind, target_id, link_type, created_at)
        VALUES (?, ?, ?, 'memory_atom', ?, ?, ?)
      `).run(userId, row.source_kind, sourceId, String(winnerId), row.link_type, row.created_at);
    }
    db.query(`DELETE FROM lineage_links WHERE id = ?`).run(row.id);
  }
}

function rewriteScenarioAtomIds(db: Database, userId: string, loserId: number, winnerId: number): void {
  const rows = db
    .query(`SELECT id, atom_ids_json FROM memory_scenarios WHERE user_id = ? ORDER BY id ASC`)
    .all(userId) as Array<{ id: number; atom_ids_json: string }>;

  for (const row of rows) {
    const ids = parseNumberArray(row.atom_ids_json);
    if (!ids.includes(loserId)) {
      continue;
    }

    const rewritten = [...new Set(ids.map((id) => (id === loserId ? winnerId : id)))];
    db.query(`UPDATE memory_scenarios SET atom_ids_json = ? WHERE id = ?`).run(JSON.stringify(rewritten), row.id);
  }
}

function backfillCanonicalText(db: Database): void {
  const rows = db
    .query(`SELECT id, text FROM memory_atoms WHERE canonical_text IS NULL OR canonical_text = '' ORDER BY id ASC`)
    .all() as Array<{ id: number; text: string }>;

  for (const row of rows) {
    db.query(`UPDATE memory_atoms SET canonical_text = ? WHERE id = ?`).run(canonicalizeMemoryAtomText(row.text), row.id);
  }
}

function compactCanonicalAtomDuplicates(db: Database): void {
  const rows = db
    .query(`
      SELECT id, user_id, text, canonical_text, importance, source_turn_ids_json, updated_at
      FROM memory_atoms
      WHERE canonical_text IS NOT NULL
      ORDER BY user_id ASC, canonical_text ASC, id ASC
    `)
    .all() as Array<{
      id: number;
      user_id: string;
      text: string;
      canonical_text: string;
      importance: number;
      source_turn_ids_json: string;
      updated_at: string;
    }>;

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = JSON.stringify([row.user_id, row.canonical_text]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }

    const winner = group[0]!;
    const losers = group.slice(1);
    const mergedSourceTurnIds = mergeNumberSets(...group.map((row) => parseNumberArray(row.source_turn_ids_json)));
    const mergedImportance = Math.max(...group.map((row) => row.importance));
    const newest = group.reduce((best, row) => {
      if (row.updated_at > best.updated_at) {
        return row;
      }
      if (row.updated_at === best.updated_at && row.id > best.id) {
        return row;
      }
      return best;
    }, winner);
    const winnerText = newest.text;
    const updatedAt = newest.updated_at;
    const embeddingJson = serializeVector(embedTextToVector(winnerText));

    for (const loser of losers) {
      repointLineageAtomReferences(db, winner.user_id, loser.id, winner.id);
      rewriteScenarioAtomIds(db, winner.user_id, loser.id, winner.id);
      db.query(`DELETE FROM memory_atoms_fts WHERE atom_id = ? AND user_id = ?`).run(String(loser.id), loser.user_id);
      db.query(`DELETE FROM memory_atom_embeddings WHERE atom_id = ?`).run(loser.id);
      db.query(`DELETE FROM memory_atoms WHERE id = ?`).run(loser.id);
    }

    db.query(`
      UPDATE memory_atoms
      SET text = ?, canonical_text = ?, importance = ?, source_turn_ids_json = ?, updated_at = ?
      WHERE id = ?
    `).run(winnerText, winner.canonical_text, mergedImportance, JSON.stringify(mergedSourceTurnIds), updatedAt, winner.id);

    db.query(`DELETE FROM memory_atoms_fts WHERE atom_id = ? AND user_id = ?`).run(String(winner.id), winner.user_id);
    db.query(`INSERT INTO memory_atoms_fts (text, atom_id, user_id) VALUES (?, ?, ?)`)
      .run(winnerText, String(winner.id), winner.user_id);
    db.query(`
      INSERT INTO memory_atom_embeddings (atom_id, user_id, embedding_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(atom_id) DO UPDATE SET
        user_id = excluded.user_id,
        embedding_json = excluded.embedding_json,
        updated_at = excluded.updated_at
    `).run(winner.id, winner.user_id, embeddingJson, updatedAt);
  }
}

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

  if (!hasColumn(db, "memory_atoms", "canonical_text")) {
    db.exec(`ALTER TABLE memory_atoms ADD COLUMN canonical_text TEXT`);
  }
  if (!hasColumn(db, "memory_atoms", "source_layer")) {
    db.exec(`ALTER TABLE memory_atoms ADD COLUMN source_layer TEXT NOT NULL DEFAULT 'L1'`);
  }

  db.exec(`DROP INDEX IF EXISTS memory_atoms_user_canonical_text_idx`);

  backfillCanonicalText(db);
  compactCanonicalAtomDuplicates(db);

  db.exec(`
    CREATE UNIQUE INDEX memory_atoms_user_canonical_text_idx
    ON memory_atoms (user_id, canonical_text)
    WHERE canonical_text IS NOT NULL
  `);

  if (!hasColumn(db, "memory_scenarios", "file_path")) {
    db.exec(`ALTER TABLE memory_scenarios ADD COLUMN file_path TEXT`);
  }
}
