import type { ConversationTurnRole, EventMeta } from "../types";
import type { L1RecordMetadata } from "./record-metadata";

export type MaybePromise<T> = T | Promise<T>;

export type StoreCapabilities = {
  vectorSearch: boolean;
  ftsSearch: boolean;
  nativeHybridSearch: boolean;
  sparseVectors: boolean;
};

export type StoreInitResult = {
  capabilities: StoreCapabilities;
  degraded: boolean;
};

export type EmbeddingProviderInfo = {
  provider?: string;
  model?: string;
  dimensions?: number;
};

export type L0Record = {
  recordId: string;
  sessionKey: string;
  sessionId: string;
  chatId: string;
  userId: string;
  role: ConversationTurnRole;
  messageText: string;
  recordedAt: string;
  timestamp: number;
  metadata?: EventMeta;
};

export type L0Cursor = number | {
  timestamp: number;
  recordId: string;
};

export type L0QueryRow = L0Record;

export type L0SessionGroup = {
  sessionId: string;
  records: L0QueryRow[];
};

export type L0SearchResult = L0Record & {
  score: number;
};

export type L0FtsResult = L0Record & {
  score: number;
};

export type L1Record = {
  recordId: string;
  userId: string;
  sessionKey: string;
  sessionId: string;
  content: string;
  type: "L1" | "L2" | "L3" | string;
  priority: number;
  sceneName: string;
  timestampStr: string;
  timestampStart?: string;
  timestampEnd?: string;
  sourceConversationIds: number[];
  metadata?: L1RecordMetadata;
  createdTime: string;
  updatedTime: string;
};

export type L1QueryFilter = {
  userId?: string;
  sessionKey?: string;
  sessionId?: string;
  type?: string;
  limit?: number;
};

export type L1RecordRow = L1Record;

export type L1SearchResult = L1Record & {
  score: number;
};

export type L1FtsResult = L1Record & {
  score: number;
};

export type ProfileRecord = {
  id: string;
  type: "l2" | "l3";
  userId: string;
  filename: string;
  content: string;
  contentMd5: string;
  version: number;
  createdAtMs: number;
  updatedAtMs: number;
  metadata?: EventMeta;
};

export type ProfileSyncRecord = ProfileRecord;

export type IMemoryStore = {
  readonly supportsDeferredEmbedding?: boolean;

  init(providerInfo?: EmbeddingProviderInfo): MaybePromise<StoreInitResult>;
  isDegraded(): boolean;
  getCapabilities(): StoreCapabilities;
  close(): void;

  upsertL1(record: L1Record, embedding?: Float32Array): MaybePromise<boolean>;
  deleteL1(recordId: string): MaybePromise<boolean>;
  deleteL1Batch(recordIds: string[]): MaybePromise<boolean>;
  deleteL1Expired(cutoffIso: string): MaybePromise<number>;
  countL1(userId?: string): MaybePromise<number>;
  queryL1Records(filter?: L1QueryFilter): MaybePromise<L1RecordRow[]>;
  getAllL1Texts(): MaybePromise<Array<{ record_id: string; content: string; updated_time: string }>>;
  searchL1Vector(queryEmbedding: Float32Array, topK?: number, queryText?: string, userId?: string): MaybePromise<L1SearchResult[]>;
  searchL1Fts(ftsQuery: string, limit?: number, userId?: string): MaybePromise<L1FtsResult[]>;
  searchL1Hybrid?(params: { query?: string; queryEmbedding?: Float32Array; topK?: number; userId?: string }): MaybePromise<L1SearchResult[]>;

  upsertL0(record: L0Record, embedding?: Float32Array): MaybePromise<boolean>;
  updateL0Embedding?(recordId: string, embedding: Float32Array): MaybePromise<boolean>;
  deleteL0(recordId: string): MaybePromise<boolean>;
  deleteL0Expired(cutoffIso: string): MaybePromise<number>;
  countL0(userId?: string): MaybePromise<number>;
  queryL0ForUser?(userId: string, after?: L0Cursor, limit?: number): MaybePromise<L0QueryRow[]>;
  queryL0ForL1(sessionKey: string, after?: L0Cursor, limit?: number): MaybePromise<L0QueryRow[]>;
  queryL0GroupedBySessionId(sessionKey: string, after?: L0Cursor, limit?: number): MaybePromise<L0SessionGroup[]>;
  getAllL0Texts(): MaybePromise<Array<{ record_id: string; message_text: string; recorded_at: string }>>;
  searchL0Vector(queryEmbedding: Float32Array, topK?: number, queryText?: string, userId?: string): MaybePromise<L0SearchResult[]>;
  searchL0Fts(ftsQuery: string, limit?: number, userId?: string): MaybePromise<L0FtsResult[]>;
  searchL0Hybrid?(params: { query?: string; queryEmbedding?: Float32Array; topK?: number; userId?: string }): MaybePromise<L0SearchResult[]>;

  pullProfiles?(): Promise<ProfileRecord[]>;
  syncProfiles?(records: ProfileSyncRecord[]): Promise<void>;
  deleteProfiles?(recordIds: string[]): Promise<void>;

  reindexAll(
    embedFn: (text: string) => Promise<Float32Array>,
    onProgress?: (done: number, total: number, layer: "L1" | "L0") => void,
  ): Promise<{ l1Count: number; l0Count: number }>;
  isFtsAvailable(): boolean;
  backfillLegacy?(): Promise<void>;
};
