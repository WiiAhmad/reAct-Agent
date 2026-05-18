import type { Database } from "bun:sqlite";
import type { EventMeta } from "../../core/types";
import type {
  EmbeddingProviderInfo,
  IMemoryStore,
  L0FtsResult,
  L0QueryRow,
  L0Record,
  L0SearchResult,
  L0SessionGroup,
  L1FtsResult,
  L1QueryFilter,
  L1Record,
  L1RecordRow,
  L1SearchResult,
  ProfileRecord,
  ProfileSyncRecord,
  StoreCapabilities,
  StoreInitResult,
} from "../../core/store/types";
import { ftsQuery } from "../../../utils/text";
import { createBM25LocalEncoder, sparseVectorScore, type BM25LocalEncoder, type SparseVector } from "./bm25-local";
import { embedTextToVector, ensureSqliteVecTable, isZeroVector, loadSqliteVec, serializeVector } from "./vec";
import { migrateSqliteMemoryStore } from "./store-migrate";
import { backfillLegacyMemoryStore } from "./store-backfill";

export type SqliteMemoryStoreOptions = {
  sqliteVecEnabled?: boolean;
  bm25Enabled?: boolean;
  bm25Language?: "zh" | "en";
  ownsDatabase?: boolean;
};

type L0DbRow = {
  record_id: string;
  session_key: string;
  session_id: string;
  chat_id: string;
  user_id: string;
  role: string;
  message_text: string;
  recorded_at: string;
  timestamp: number;
  metadata_json: string;
};

type L1DbRow = {
  record_id: string;
  user_id: string;
  session_key: string;
  session_id: string;
  content: string;
  type: string;
  priority: number;
  scene_name: string;
  timestamp_str: string;
  timestamp_start: string;
  timestamp_end: string;
  source_conversation_ids_json: string;
  metadata_json: string;
  created_time: string;
  updated_time: string;
};

type ProfileDbRow = {
  id: string;
  type: "l2" | "l3";
  user_id: string;
  filename: string;
  content: string;
  content_md5: string;
  version: number;
  created_at_ms: number;
  updated_at_ms: number;
  metadata_json: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function parseJsonObject(raw: string): EventMeta {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as EventMeta : {};
  } catch {
    return {};
  }
}

function parseNumberArray(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === "number" && Number.isFinite(value)) : [];
  } catch {
    return [];
  }
}

function l1RowId(recordId: string): number {
  let hash = 2166136261;
  for (const char of recordId) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) || 1;
}

function l0RowId(recordId: string): number {
  return l1RowId(recordId);
}

function mapL0Row(row: L0DbRow): L0QueryRow {
  return {
    recordId: row.record_id,
    sessionKey: row.session_key,
    sessionId: row.session_id,
    chatId: row.chat_id,
    userId: row.user_id,
    role: row.role as L0QueryRow["role"],
    messageText: row.message_text,
    recordedAt: row.recorded_at,
    timestamp: row.timestamp,
    metadata: parseJsonObject(row.metadata_json),
  };
}

function mapL1Row(row: L1DbRow): L1RecordRow {
  return {
    recordId: row.record_id,
    userId: row.user_id,
    sessionKey: row.session_key,
    sessionId: row.session_id,
    content: row.content,
    type: row.type,
    priority: row.priority,
    sceneName: row.scene_name,
    timestampStr: row.timestamp_str,
    timestampStart: row.timestamp_start || undefined,
    timestampEnd: row.timestamp_end || undefined,
    sourceConversationIds: parseNumberArray(row.source_conversation_ids_json),
    metadata: parseJsonObject(row.metadata_json),
    createdTime: row.created_time,
    updatedTime: row.updated_time,
  };
}

function mapProfileRow(row: ProfileDbRow): ProfileRecord {
  return {
    id: row.id,
    type: row.type,
    userId: row.user_id,
    filename: row.filename,
    content: row.content,
    contentMd5: row.content_md5,
    version: row.version,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    metadata: parseJsonObject(row.metadata_json),
  };
}

export class SqliteMemoryStore implements IMemoryStore {
  private capabilities: StoreCapabilities = {
    vectorSearch: false,
    ftsSearch: false,
    nativeHybridSearch: false,
    sparseVectors: false,
  };
  private degraded = false;
  private bm25: BM25LocalEncoder = createBM25LocalEncoder({ enabled: false });
  private closed = false;

  constructor(
    private readonly db: Database,
    private readonly options: SqliteMemoryStoreOptions = {},
  ) {}

  async init(providerInfo: EmbeddingProviderInfo = {}): Promise<StoreInitResult> {
    migrateSqliteMemoryStore(this.db);
    this.capabilities = {
      vectorSearch: false,
      ftsSearch: true,
      nativeHybridSearch: false,
      sparseVectors: false,
    };
    this.degraded = false;

    if (this.options.sqliteVecEnabled !== false) {
      try {
        loadSqliteVec(this.db);
        ensureSqliteVecTable(this.db, "memory_store_l0_vec");
        ensureSqliteVecTable(this.db, "memory_store_l1_vec");
        this.capabilities.vectorSearch = true;
      } catch {
        this.capabilities.vectorSearch = false;
        this.degraded = true;
      }
    }

    this.bm25 = createBM25LocalEncoder({
      enabled: this.options.bm25Enabled !== false,
      language: this.options.bm25Language ?? "en",
    });
    this.capabilities.sparseVectors = this.bm25.available;

    this.writeMeta("embedding.provider", providerInfo.provider ?? "local");
    this.writeMeta("embedding.model", providerInfo.model ?? "deterministic-local");
    this.writeMeta("embedding.dimensions", String(providerInfo.dimensions ?? 64));
    this.writeMeta("bm25.enabled", String(this.capabilities.sparseVectors));
    this.writeMeta("bm25.language", this.options.bm25Language ?? "en");

    await this.backfillLegacy();

    return { capabilities: this.getCapabilities(), degraded: this.degraded };
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  getCapabilities(): StoreCapabilities {
    return { ...this.capabilities };
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    if (this.options.ownsDatabase) {
      this.db.close();
    }
  }

  isFtsAvailable(): boolean {
    return this.capabilities.ftsSearch;
  }

  private markRecoverableFailure(capability?: keyof StoreCapabilities): void {
    this.degraded = true;
    if (capability) {
      this.capabilities[capability] = false;
    }
  }

  private writeMeta(key: string, value: string): void {
    this.db.query(`
      INSERT INTO memory_store_meta (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, nowIso());
  }

  private vectorMapTable(layer: "l0" | "l1"): "memory_store_l0_vec_map" | "memory_store_l1_vec_map" {
    return layer === "l0" ? "memory_store_l0_vec_map" : "memory_store_l1_vec_map";
  }

  private vectorTable(layer: "l0" | "l1"): "memory_store_l0_vec" | "memory_store_l1_vec" {
    return layer === "l0" ? "memory_store_l0_vec" : "memory_store_l1_vec";
  }

  private getVectorRowId(layer: "l0" | "l1", recordId: string): number | undefined {
    const row = this.db.query(`SELECT vec_rowid FROM ${this.vectorMapTable(layer)} WHERE record_id = ?`).get(recordId) as { vec_rowid: number } | null;
    return row?.vec_rowid;
  }

  private ensureVectorRowId(layer: "l0" | "l1", recordId: string): number {
    const existing = this.getVectorRowId(layer, recordId);
    if (existing) {
      return existing;
    }

    const row = this.db.query(`SELECT COALESCE(MAX(vec_rowid), 0) + 1 AS next_rowid FROM ${this.vectorMapTable(layer)}`).get() as { next_rowid: number } | null;
    const nextRowId = row?.next_rowid ?? 1;
    this.db.query(`INSERT INTO ${this.vectorMapTable(layer)} (record_id, vec_rowid) VALUES (?, ?)`).run(recordId, nextRowId);
    return nextRowId;
  }

  private deleteVectorRow(layer: "l0" | "l1", recordId: string): void {
    const rowId = this.getVectorRowId(layer, recordId);
    if (!rowId) {
      return;
    }

    this.db.query(`DELETE FROM ${this.vectorTable(layer)} WHERE rowid = ?`).run(rowId);
    this.db.query(`DELETE FROM ${this.vectorMapTable(layer)} WHERE record_id = ?`).run(recordId);
  }

  private vectorRecordIdsByRowIds(layer: "l0" | "l1", rowIds: number[]): Map<number, string> {
    if (rowIds.length === 0) {
      return new Map();
    }

    const placeholders = rowIds.map(() => "?").join(", ");
    const rows = this.db.query(`SELECT record_id, vec_rowid FROM ${this.vectorMapTable(layer)} WHERE vec_rowid IN (${placeholders})`).all(...rowIds) as Array<{ record_id: string; vec_rowid: number }>;
    return new Map(rows.map((row) => [row.vec_rowid, row.record_id]));
  }

  private replaceL1FtsRow(record: L1Record): void {
    this.db.query(`DELETE FROM memory_store_l1_fts WHERE record_id = ?`).run(record.recordId);
    this.db.query(`
      INSERT INTO memory_store_l1_fts (content, record_id, user_id, session_key, session_id, type, scene_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(record.content, record.recordId, record.userId, record.sessionKey, record.sessionId, record.type, record.sceneName);
  }

  private replaceL1VectorRow(recordId: string, embedding: Float32Array): void {
    if (!this.capabilities.vectorSearch) {
      return;
    }

    const rowId = this.ensureVectorRowId("l1", recordId);
    this.db.query(`DELETE FROM memory_store_l1_vec WHERE rowid = ?`).run(rowId);
    if (isZeroVector(embedding)) {
      return;
    }

    this.db.query(`INSERT INTO memory_store_l1_vec (rowid, embedding) VALUES (?, ?)`).run(rowId, serializeVector(embedding));
  }

  private replaceL1SparseRow(record: L1Record): void {
    this.db.query(`DELETE FROM memory_store_l1_sparse WHERE record_id = ?`).run(record.recordId);
    if (!this.capabilities.sparseVectors) {
      return;
    }

    const sparseVector = this.bm25.encodeTexts([record.content])[0] ?? [];
    if (record.content.trim() && sparseVector.length === 0) {
      this.capabilities.sparseVectors = false;
      this.degraded = true;
      return;
    }

    this.db.query(`
      INSERT INTO memory_store_l1_sparse (record_id, sparse_vector_json, updated_at)
      VALUES (?, ?, ?)
    `).run(record.recordId, JSON.stringify(sparseVector), record.updatedTime);
  }

  private maintainL1Indexes(record: L1Record, embedding: Float32Array): void {
    try {
      this.replaceL1FtsRow(record);
    } catch {
      this.markRecoverableFailure("ftsSearch");
    }

    try {
      this.replaceL1VectorRow(record.recordId, embedding);
    } catch {
      this.markRecoverableFailure("vectorSearch");
    }

    try {
      this.replaceL1SparseRow(record);
    } catch {
      this.markRecoverableFailure("sparseVectors");
    }
  }

  async upsertL1(record: L1Record, embedding?: Float32Array): Promise<boolean> {
    try {
      const vector = embedding ?? embedTextToVector(record.content);
      const upsert = this.db.transaction((input: L1Record) => {
        this.db.query(`
          INSERT INTO memory_store_l1 (
            record_id, user_id, session_key, session_id, content, type, priority, scene_name,
            timestamp_str, timestamp_start, timestamp_end, source_conversation_ids_json,
            metadata_json, created_time, updated_time
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(record_id) DO UPDATE SET
            user_id = excluded.user_id,
            session_key = excluded.session_key,
            session_id = excluded.session_id,
            content = excluded.content,
            type = excluded.type,
            priority = excluded.priority,
            scene_name = excluded.scene_name,
            timestamp_str = excluded.timestamp_str,
            timestamp_start = excluded.timestamp_start,
            timestamp_end = excluded.timestamp_end,
            source_conversation_ids_json = excluded.source_conversation_ids_json,
            metadata_json = excluded.metadata_json,
            created_time = excluded.created_time,
            updated_time = excluded.updated_time
        `).run(
          input.recordId,
          input.userId,
          input.sessionKey,
          input.sessionId,
          input.content,
          input.type,
          input.priority,
          input.sceneName,
          input.timestampStr,
          input.timestampStart ?? "",
          input.timestampEnd ?? "",
          JSON.stringify(input.sourceConversationIds),
          JSON.stringify(input.metadata ?? {}),
          input.createdTime,
          input.updatedTime,
        );
      });

      upsert(record);
      this.maintainL1Indexes(record, vector);
      return true;
    } catch {
      this.markRecoverableFailure();
      return false;
    }
  }

  async deleteL1(recordId: string): Promise<boolean> {
    try {
      const existing = this.db.query(`SELECT record_id FROM memory_store_l1 WHERE record_id = ?`).get(recordId) as { record_id: string } | null;
      if (!existing) {
        return false;
      }

      const remove = this.db.transaction((id: string) => {
        this.db.query(`DELETE FROM memory_store_l1 WHERE record_id = ?`).run(id);
        this.db.query(`DELETE FROM memory_store_l1_fts WHERE record_id = ?`).run(id);
        this.db.query(`DELETE FROM memory_store_l1_sparse WHERE record_id = ?`).run(id);
        if (this.capabilities.vectorSearch) {
          this.deleteVectorRow("l1", id);
        }
      });

      remove(recordId);
      return true;
    } catch {
      this.markRecoverableFailure();
      return false;
    }
  }

  async deleteL1Batch(recordIds: string[]): Promise<boolean> {
    if (recordIds.length === 0) {
      return true;
    }

    try {
      const removeBatch = this.db.transaction((ids: string[]) => {
        for (const id of ids) {
          this.db.query(`DELETE FROM memory_store_l1 WHERE record_id = ?`).run(id);
          this.db.query(`DELETE FROM memory_store_l1_fts WHERE record_id = ?`).run(id);
          this.db.query(`DELETE FROM memory_store_l1_sparse WHERE record_id = ?`).run(id);
          if (this.capabilities.vectorSearch) {
            this.deleteVectorRow("l1", id);
          }
        }
      });

      removeBatch(recordIds);
      return true;
    } catch {
      this.markRecoverableFailure();
      return false;
    }
  }

  async deleteL1Expired(cutoffIso: string): Promise<number> {
    try {
      const rows = this.db.query(`SELECT record_id FROM memory_store_l1 WHERE updated_time < ?`).all(cutoffIso) as Array<{ record_id: string }>;
      if (rows.length === 0) {
        return 0;
      }

      const deleted = await this.deleteL1Batch(rows.map((row) => row.record_id));
      return deleted ? rows.length : 0;
    } catch {
      this.markRecoverableFailure();
      return 0;
    }
  }

  async countL1(userId?: string): Promise<number> {
    try {
      const row = userId
        ? this.db.query(`SELECT COUNT(*) AS count FROM memory_store_l1 WHERE user_id = ?`).get(userId) as { count: number } | null
        : this.db.query(`SELECT COUNT(*) AS count FROM memory_store_l1`).get() as { count: number } | null;

      return row?.count ?? 0;
    } catch {
      this.markRecoverableFailure();
      return 0;
    }
  }

  async queryL1Records(filter: L1QueryFilter = {}): Promise<L1RecordRow[]> {
    try {
      const conditions: string[] = [];
      const params: Array<string | number> = [];

      if (filter.userId) {
        conditions.push("user_id = ?");
        params.push(filter.userId);
      }
      if (filter.sessionKey) {
        conditions.push("session_key = ?");
        params.push(filter.sessionKey);
      }
      if (filter.sessionId) {
        conditions.push("session_id = ?");
        params.push(filter.sessionId);
      }
      if (filter.type) {
        conditions.push("type = ?");
        params.push(filter.type);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const limit = filter.limit ?? 100;
      const rows = this.db.query(`
        SELECT record_id, user_id, session_key, session_id, content, type, priority, scene_name,
          timestamp_str, timestamp_start, timestamp_end, source_conversation_ids_json,
          metadata_json, created_time, updated_time
        FROM memory_store_l1
        ${where}
        ORDER BY updated_time DESC, record_id ASC
        LIMIT ?
      `).all(...params, limit) as L1DbRow[];

      return rows.map(mapL1Row);
    } catch {
      this.markRecoverableFailure();
      return [];
    }
  }

  async getAllL1Texts(): Promise<Array<{ record_id: string; content: string; updated_time: string }>> {
    try {
      return this.db.query(`
        SELECT record_id, content, updated_time
        FROM memory_store_l1
        ORDER BY updated_time DESC, record_id ASC
      `).all() as Array<{ record_id: string; content: string; updated_time: string }>;
    } catch {
      this.markRecoverableFailure();
      return [];
    }
  }

  async searchL1Vector(queryEmbedding: Float32Array, topK = 5, _queryText?: string, userId?: string): Promise<L1SearchResult[]> {
    if (!this.capabilities.vectorSearch || topK <= 0 || isZeroVector(queryEmbedding)) {
      return [];
    }

    try {
      const vecRows = this.db.query(`
        SELECT rowid, distance
        FROM memory_store_l1_vec
        WHERE embedding MATCH ?
        ORDER BY distance
        LIMIT ?
      `).all(serializeVector(queryEmbedding), Math.max(topK * 4, topK)) as Array<{ rowid: number; distance: number }>;

      if (vecRows.length === 0) {
        return [];
      }

      const recordIdsByRowId = this.vectorRecordIdsByRowIds("l1", vecRows.map((row) => row.rowid));
      const records = await this.queryL1Records({ userId, limit: 10000 });
      const recordsById = new Map(records.map((record) => [record.recordId, record]));

      return vecRows
        .map((row) => ({ row, record: recordsById.get(recordIdsByRowId.get(row.rowid) ?? "") }))
        .filter((entry): entry is { row: { rowid: number; distance: number }; record: L1RecordRow } => Boolean(entry.record))
        .slice(0, topK)
        .map(({ row, record }) => ({ ...record, score: 1 / (1 + Math.max(0, row.distance)) }));
    } catch {
      this.markRecoverableFailure("vectorSearch");
      return [];
    }
  }

  async searchL1Fts(queryText: string, limit = 5, userId?: string): Promise<L1FtsResult[]> {
    const query = ftsQuery(queryText);
    if (!query || limit <= 0 || !this.capabilities.ftsSearch) {
      return [];
    }

    try {
      const rows = this.db.query(`
        SELECT m.record_id, m.user_id, m.session_key, m.session_id, m.content, m.type, m.priority, m.scene_name,
          m.timestamp_str, m.timestamp_start, m.timestamp_end, m.source_conversation_ids_json,
          m.metadata_json, m.created_time, m.updated_time, bm25(memory_store_l1_fts) AS rank
        FROM memory_store_l1_fts
        JOIN memory_store_l1 m ON m.record_id = memory_store_l1_fts.record_id
        WHERE memory_store_l1_fts MATCH ? ${userId ? "AND m.user_id = ?" : ""}
        ORDER BY rank ASC, m.updated_time DESC, m.record_id ASC
        LIMIT ?
      `).all(...(userId ? [query, userId, limit] : [query, limit])) as Array<L1DbRow & { rank: number }>;

      return rows.map((row) => ({ ...mapL1Row(row), score: row.rank < 0 ? -row.rank : 1 / (1 + row.rank) }));
    } catch {
      this.markRecoverableFailure("ftsSearch");
      return [];
    }
  }

  private searchL1Sparse(query: string, topK: number, userId?: string): L1SearchResult[] {
    if (!this.capabilities.sparseVectors || topK <= 0 || !query.trim()) {
      return [];
    }

    try {
      const queryVector = this.bm25.encodeQueries([query])[0] ?? [];
      if (query.trim() && queryVector.length === 0) {
        this.markRecoverableFailure("sparseVectors");
        return [];
      }

      const rows = this.db.query(`
        SELECT m.record_id, m.user_id, m.session_key, m.session_id, m.content, m.type, m.priority, m.scene_name,
          m.timestamp_str, m.timestamp_start, m.timestamp_end, m.source_conversation_ids_json,
          m.metadata_json, m.created_time, m.updated_time, s.sparse_vector_json
        FROM memory_store_l1_sparse s
        JOIN memory_store_l1 m ON m.record_id = s.record_id
        ${userId ? "WHERE m.user_id = ?" : ""}
      `).all(...(userId ? [userId] : [])) as Array<L1DbRow & { sparse_vector_json: string }>;

      return rows
        .map((row) => {
          let documentVector: SparseVector = [];
          try {
            const parsed = JSON.parse(row.sparse_vector_json) as unknown;
            documentVector = Array.isArray(parsed) ? parsed as SparseVector : [];
          } catch {
            documentVector = [];
          }
          return { record: mapL1Row(row), score: sparseVectorScore(queryVector, documentVector) };
        })
        .filter((row) => row.score > 0)
        .sort((left, right) => right.score - left.score || right.record.updatedTime.localeCompare(left.record.updatedTime))
        .slice(0, topK)
        .map(({ record, score }) => ({ ...record, score }));
    } catch {
      this.markRecoverableFailure("sparseVectors");
      return [];
    }
  }

  async searchL1Hybrid(params: { query?: string; queryEmbedding?: Float32Array; topK?: number; userId?: string }): Promise<L1SearchResult[]> {
    const topK = params.topK ?? 5;
    if (topK <= 0) {
      return [];
    }

    const combined = new Map<string, L1SearchResult>();
    const merge = (result: L1SearchResult): void => {
      const existing = combined.get(result.recordId);
      combined.set(result.recordId, existing ? { ...existing, score: existing.score + result.score } : result);
    };

    if (params.queryEmbedding) {
      for (const result of await this.searchL1Vector(params.queryEmbedding, topK, params.query, params.userId)) {
        merge(result);
      }
    }
    if (params.query) {
      for (const result of await this.searchL1Fts(params.query, topK, params.userId)) {
        merge(result);
      }
      for (const result of this.searchL1Sparse(params.query, topK, params.userId)) {
        merge(result);
      }
    }

    return Array.from(combined.values())
      .sort((left, right) => right.score - left.score || right.updatedTime.localeCompare(left.updatedTime) || left.recordId.localeCompare(right.recordId))
      .slice(0, topK);
  }

  private replaceL0FtsRow(record: L0Record): void {
    this.db.query(`DELETE FROM memory_store_l0_fts WHERE record_id = ?`).run(record.recordId);
    this.db.query(`
      INSERT INTO memory_store_l0_fts (message_text, record_id, session_key, session_id, chat_id, user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(record.messageText, record.recordId, record.sessionKey, record.sessionId, record.chatId, record.userId);
  }

  private replaceL0VectorRow(recordId: string, embedding: Float32Array): void {
    if (!this.capabilities.vectorSearch) {
      return;
    }

    const rowId = this.ensureVectorRowId("l0", recordId);
    this.db.query(`DELETE FROM memory_store_l0_vec WHERE rowid = ?`).run(rowId);
    if (isZeroVector(embedding)) {
      return;
    }

    this.db.query(`INSERT INTO memory_store_l0_vec (rowid, embedding) VALUES (?, ?)`).run(rowId, serializeVector(embedding));
  }

  private replaceL0SparseRow(record: L0Record): void {
    this.db.query(`DELETE FROM memory_store_l0_sparse WHERE record_id = ?`).run(record.recordId);
    if (!this.capabilities.sparseVectors) {
      return;
    }

    const sparseVector = this.bm25.encodeTexts([record.messageText])[0] ?? [];
    if (record.messageText.trim() && sparseVector.length === 0) {
      this.capabilities.sparseVectors = false;
      this.degraded = true;
      return;
    }

    this.db.query(`
      INSERT INTO memory_store_l0_sparse (record_id, sparse_vector_json, updated_at)
      VALUES (?, ?, ?)
    `).run(record.recordId, JSON.stringify(sparseVector), record.recordedAt);
  }

  private maintainL0Indexes(record: L0Record, embedding: Float32Array): void {
    try {
      this.replaceL0FtsRow(record);
    } catch {
      this.markRecoverableFailure("ftsSearch");
    }

    try {
      this.replaceL0VectorRow(record.recordId, embedding);
    } catch {
      this.markRecoverableFailure("vectorSearch");
    }

    try {
      this.replaceL0SparseRow(record);
    } catch {
      this.markRecoverableFailure("sparseVectors");
    }
  }

  async upsertL0(record: L0Record, embedding?: Float32Array): Promise<boolean> {
    try {
      const vector = embedding ?? embedTextToVector(record.messageText);
      const upsert = this.db.transaction((input: L0Record) => {
        this.db.query(`
          INSERT INTO memory_store_l0 (
            record_id, session_key, session_id, chat_id, user_id, role, message_text,
            recorded_at, timestamp, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(record_id) DO UPDATE SET
            session_key = excluded.session_key,
            session_id = excluded.session_id,
            chat_id = excluded.chat_id,
            user_id = excluded.user_id,
            role = excluded.role,
            message_text = excluded.message_text,
            recorded_at = excluded.recorded_at,
            timestamp = excluded.timestamp,
            metadata_json = excluded.metadata_json
        `).run(
          input.recordId,
          input.sessionKey,
          input.sessionId,
          input.chatId,
          input.userId,
          input.role,
          input.messageText,
          input.recordedAt,
          input.timestamp,
          JSON.stringify(input.metadata ?? {}),
        );
      });

      upsert(record);
      this.maintainL0Indexes(record, vector);
      return true;
    } catch {
      this.markRecoverableFailure();
      return false;
    }
  }

  async updateL0Embedding(recordId: string, embedding: Float32Array): Promise<boolean> {
    try {
      const existing = this.db.query(`SELECT record_id FROM memory_store_l0 WHERE record_id = ?`).get(recordId) as { record_id: string } | null;
      if (!existing) {
        return false;
      }

      this.replaceL0VectorRow(recordId, embedding);
      return true;
    } catch {
      this.markRecoverableFailure("vectorSearch");
      return false;
    }
  }

  async deleteL0(recordId: string): Promise<boolean> {
    try {
      const existing = this.db.query(`SELECT record_id FROM memory_store_l0 WHERE record_id = ?`).get(recordId) as { record_id: string } | null;
      if (!existing) {
        return false;
      }

      const remove = this.db.transaction((id: string) => {
        this.db.query(`DELETE FROM memory_store_l0 WHERE record_id = ?`).run(id);
        this.db.query(`DELETE FROM memory_store_l0_fts WHERE record_id = ?`).run(id);
        this.db.query(`DELETE FROM memory_store_l0_sparse WHERE record_id = ?`).run(id);
        if (this.capabilities.vectorSearch) {
          this.deleteVectorRow("l0", id);
        }
      });

      remove(recordId);
      return true;
    } catch {
      this.markRecoverableFailure();
      return false;
    }
  }

  async deleteL0Expired(cutoffIso: string): Promise<number> {
    try {
      const rows = this.db.query(`SELECT record_id FROM memory_store_l0 WHERE recorded_at < ?`).all(cutoffIso) as Array<{ record_id: string }>;
      if (rows.length === 0) {
        return 0;
      }

      const removeExpired = this.db.transaction((recordIds: string[]) => {
        for (const id of recordIds) {
          this.db.query(`DELETE FROM memory_store_l0 WHERE record_id = ?`).run(id);
          this.db.query(`DELETE FROM memory_store_l0_fts WHERE record_id = ?`).run(id);
          this.db.query(`DELETE FROM memory_store_l0_sparse WHERE record_id = ?`).run(id);
          if (this.capabilities.vectorSearch) {
            this.deleteVectorRow("l0", id);
          }
        }
      });

      removeExpired(rows.map((row) => row.record_id));
      return rows.length;
    } catch {
      this.markRecoverableFailure();
      return 0;
    }
  }

  async countL0(userId?: string): Promise<number> {
    try {
      const row = userId
        ? this.db.query(`SELECT COUNT(*) AS count FROM memory_store_l0 WHERE user_id = ?`).get(userId) as { count: number } | null
        : this.db.query(`SELECT COUNT(*) AS count FROM memory_store_l0`).get() as { count: number } | null;

      return row?.count ?? 0;
    } catch {
      this.markRecoverableFailure();
      return 0;
    }
  }

  async queryL0ForUser(userId: string, afterRecordedAtMs = 0, limit = 80): Promise<L0QueryRow[]> {
    try {
      const rows = this.db.query(`
        SELECT record_id, session_key, session_id, chat_id, user_id, role, message_text,
          recorded_at, timestamp, metadata_json
        FROM memory_store_l0
        WHERE user_id = ? AND timestamp > ? AND role IN ('user', 'assistant')
        ORDER BY timestamp ASC, record_id ASC
        LIMIT ?
      `).all(userId, afterRecordedAtMs, limit) as L0DbRow[];

      return rows.map(mapL0Row);
    } catch {
      this.markRecoverableFailure();
      return [];
    }
  }

  async queryL0ForL1(sessionKey: string, afterRecordedAtMs = 0, limit = 80): Promise<L0QueryRow[]> {
    try {
      const rows = this.db.query(`
        SELECT record_id, session_key, session_id, chat_id, user_id, role, message_text,
          recorded_at, timestamp, metadata_json
        FROM memory_store_l0
        WHERE session_key = ? AND timestamp > ?
        ORDER BY timestamp ASC, record_id ASC
        LIMIT ?
      `).all(sessionKey, afterRecordedAtMs, limit) as L0DbRow[];

      return rows.map(mapL0Row);
    } catch {
      this.markRecoverableFailure();
      return [];
    }
  }

  async queryL0GroupedBySessionId(sessionKey: string, afterRecordedAtMs = 0, limit = 80): Promise<L0SessionGroup[]> {
    const rows = await this.queryL0ForL1(sessionKey, afterRecordedAtMs, limit);
    const groups = new Map<string, L0QueryRow[]>();
    for (const row of rows) {
      const existing = groups.get(row.sessionId);
      if (existing) {
        existing.push(row);
      } else {
        groups.set(row.sessionId, [row]);
      }
    }

    return Array.from(groups, ([sessionId, records]) => ({ sessionId, records }));
  }

  async getAllL0Texts(): Promise<Array<{ record_id: string; message_text: string; recorded_at: string }>> {
    try {
      return this.db.query(`
        SELECT record_id, message_text, recorded_at
        FROM memory_store_l0
        ORDER BY recorded_at DESC, record_id ASC
      `).all() as Array<{ record_id: string; message_text: string; recorded_at: string }>;
    } catch {
      this.markRecoverableFailure();
      return [];
    }
  }

  async searchL0Vector(queryEmbedding: Float32Array, topK = 5, _queryText?: string, userId?: string): Promise<L0SearchResult[]> {
    if (!this.capabilities.vectorSearch || topK <= 0 || isZeroVector(queryEmbedding)) {
      return [];
    }

    try {
      const vecRows = this.db.query(`
        SELECT rowid, distance
        FROM memory_store_l0_vec
        WHERE embedding MATCH ?
        ORDER BY distance
        LIMIT ?
      `).all(serializeVector(queryEmbedding), Math.max(topK * 4, topK)) as Array<{ rowid: number; distance: number }>;

      if (vecRows.length === 0) {
        return [];
      }

      const recordIdsByRowId = this.vectorRecordIdsByRowIds("l0", vecRows.map((row) => row.rowid));
      const rows = this.db.query(`
        SELECT record_id, session_key, session_id, chat_id, user_id, role, message_text,
          recorded_at, timestamp, metadata_json
        FROM memory_store_l0
        ${userId ? "WHERE user_id = ?" : ""}
      `).all(...(userId ? [userId] : [])) as L0DbRow[];
      const recordsById = new Map(rows.map((row) => [row.record_id, mapL0Row(row)]));

      return vecRows
        .map((row) => ({ row, record: recordsById.get(recordIdsByRowId.get(row.rowid) ?? "") }))
        .filter((entry): entry is { row: { rowid: number; distance: number }; record: L0QueryRow } => Boolean(entry.record))
        .slice(0, topK)
        .map(({ row, record }) => ({ ...record, score: 1 / (1 + Math.max(0, row.distance)) }));
    } catch {
      this.markRecoverableFailure("vectorSearch");
      return [];
    }
  }

  async searchL0Fts(queryText: string, limit = 5, userId?: string): Promise<L0FtsResult[]> {
    const query = ftsQuery(queryText);
    if (!query || limit <= 0 || !this.capabilities.ftsSearch) {
      return [];
    }

    try {
      const rows = this.db.query(`
        SELECT m.record_id, m.session_key, m.session_id, m.chat_id, m.user_id, m.role,
          m.message_text, m.recorded_at, m.timestamp, m.metadata_json, bm25(memory_store_l0_fts) AS rank
        FROM memory_store_l0_fts
        JOIN memory_store_l0 m ON m.record_id = memory_store_l0_fts.record_id
        WHERE memory_store_l0_fts MATCH ? ${userId ? "AND m.user_id = ?" : ""}
        ORDER BY rank ASC, m.timestamp ASC, m.record_id ASC
        LIMIT ?
      `).all(...(userId ? [query, userId, limit] : [query, limit])) as Array<L0DbRow & { rank: number }>;

      return rows.map((row) => ({ ...mapL0Row(row), score: row.rank < 0 ? -row.rank : 1 / (1 + row.rank) }));
    } catch {
      this.markRecoverableFailure("ftsSearch");
      return [];
    }
  }

  private searchL0Sparse(query: string, topK: number, userId?: string): L0SearchResult[] {
    if (!this.capabilities.sparseVectors || topK <= 0 || !query.trim()) {
      return [];
    }

    try {
      const queryVector = this.bm25.encodeQueries([query])[0] ?? [];
      if (query.trim() && queryVector.length === 0) {
        this.markRecoverableFailure("sparseVectors");
        return [];
      }

      const rows = this.db.query(`
        SELECT m.record_id, m.session_key, m.session_id, m.chat_id, m.user_id, m.role,
          m.message_text, m.recorded_at, m.timestamp, m.metadata_json, s.sparse_vector_json
        FROM memory_store_l0_sparse s
        JOIN memory_store_l0 m ON m.record_id = s.record_id
        ${userId ? "WHERE m.user_id = ?" : ""}
      `).all(...(userId ? [userId] : [])) as Array<L0DbRow & { sparse_vector_json: string }>;

      return rows
        .map((row) => {
          let documentVector: SparseVector = [];
          try {
            const parsed = JSON.parse(row.sparse_vector_json) as unknown;
            documentVector = Array.isArray(parsed) ? parsed as SparseVector : [];
          } catch {
            documentVector = [];
          }
          return { record: mapL0Row(row), score: sparseVectorScore(queryVector, documentVector) };
        })
        .filter((row) => row.score > 0)
        .sort((left, right) => right.score - left.score || right.record.timestamp - left.record.timestamp)
        .slice(0, topK)
        .map(({ record, score }) => ({ ...record, score }));
    } catch {
      this.markRecoverableFailure("sparseVectors");
      return [];
    }
  }

  async searchL0Hybrid(params: { query?: string; queryEmbedding?: Float32Array; topK?: number; userId?: string }): Promise<L0SearchResult[]> {
    const topK = params.topK ?? 5;
    if (topK <= 0) {
      return [];
    }

    const combined = new Map<string, L0SearchResult>();
    const merge = (result: L0SearchResult): void => {
      const existing = combined.get(result.recordId);
      combined.set(result.recordId, existing ? { ...existing, score: existing.score + result.score } : result);
    };

    if (params.queryEmbedding) {
      for (const result of await this.searchL0Vector(params.queryEmbedding, topK, params.query, params.userId)) {
        merge(result);
      }
    }
    if (params.query) {
      for (const result of await this.searchL0Fts(params.query, topK, params.userId)) {
        merge(result);
      }
      for (const result of this.searchL0Sparse(params.query, topK, params.userId)) {
        merge(result);
      }
    }

    return Array.from(combined.values())
      .sort((left, right) => right.score - left.score || right.timestamp - left.timestamp || left.recordId.localeCompare(right.recordId))
      .slice(0, topK);
  }

  async pullProfiles(): Promise<ProfileRecord[]> {
    try {
      const rows = this.db.query(`
        SELECT id, type, user_id, filename, content, content_md5, version, created_at_ms, updated_at_ms, metadata_json
        FROM memory_store_profiles
        ORDER BY type ASC, user_id ASC, id ASC
      `).all() as ProfileDbRow[];

      return rows.map(mapProfileRow);
    } catch {
      this.markRecoverableFailure();
      return [];
    }
  }

  async syncProfiles(records: ProfileSyncRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    try {
      const upsert = this.db.transaction((items: ProfileSyncRecord[]) => {
        for (const record of items) {
          this.db.query(`
            INSERT INTO memory_store_profiles (
              id, type, user_id, filename, content, content_md5, version,
              created_at_ms, updated_at_ms, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              type = excluded.type,
              user_id = excluded.user_id,
              filename = excluded.filename,
              content = excluded.content,
              content_md5 = excluded.content_md5,
              version = excluded.version,
              created_at_ms = excluded.created_at_ms,
              updated_at_ms = excluded.updated_at_ms,
              metadata_json = excluded.metadata_json
          `).run(
            record.id,
            record.type,
            record.userId,
            record.filename,
            record.content,
            record.contentMd5,
            record.version,
            record.createdAtMs,
            record.updatedAtMs,
            JSON.stringify(record.metadata ?? {}),
          );
        }
      });

      upsert(records);
    } catch {
      this.markRecoverableFailure();
    }
  }

  async deleteProfiles(recordIds: string[]): Promise<void> {
    if (recordIds.length === 0) {
      return;
    }

    try {
      const remove = this.db.transaction((ids: string[]) => {
        for (const id of ids) {
          this.db.query(`DELETE FROM memory_store_profiles WHERE id = ?`).run(id);
        }
      });

      remove(recordIds);
    } catch {
      this.markRecoverableFailure();
    }
  }

  async reindexAll(
    embedFn: (text: string) => Promise<Float32Array>,
    onProgress?: (done: number, total: number, layer: "L1" | "L0") => void,
  ): Promise<{ l1Count: number; l0Count: number }> {
    try {
      const l1Records = await this.queryL1Records({ limit: Number.MAX_SAFE_INTEGER });
      const l0Rows = this.db.query(`
        SELECT record_id, session_key, session_id, chat_id, user_id, role, message_text,
          recorded_at, timestamp, metadata_json
        FROM memory_store_l0
        ORDER BY recorded_at DESC, record_id ASC
      `).all() as L0DbRow[];
      const l0Records = l0Rows.map(mapL0Row);

      this.db.query(`DELETE FROM memory_store_l1_sparse`).run();
      this.db.query(`DELETE FROM memory_store_l0_sparse`).run();
      if (this.capabilities.vectorSearch) {
        this.db.query(`DELETE FROM memory_store_l1_vec`).run();
        this.db.query(`DELETE FROM memory_store_l0_vec`).run();
        this.db.query(`DELETE FROM memory_store_l1_vec_map`).run();
        this.db.query(`DELETE FROM memory_store_l0_vec_map`).run();
      }

      let l1Done = 0;
      for (const record of l1Records) {
        this.replaceL1VectorRow(record.recordId, await embedFn(record.content));
        this.replaceL1SparseRow(record);
        l1Done += 1;
        onProgress?.(l1Done, l1Records.length, "L1");
      }

      let l0Done = 0;
      for (const record of l0Records) {
        this.replaceL0VectorRow(record.recordId, await embedFn(record.messageText));
        this.replaceL0SparseRow(record);
        l0Done += 1;
        onProgress?.(l0Done, l0Records.length, "L0");
      }

      return { l1Count: l1Records.length, l0Count: l0Records.length };
    } catch {
      this.markRecoverableFailure();
      return { l1Count: 0, l0Count: 0 };
    }
  }

  async backfillLegacy(): Promise<void> {
    await backfillLegacyMemoryStore(this.db, this);
  }
}
