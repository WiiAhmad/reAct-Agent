import type { EventMeta } from "../types";

export type L1MemoryKind = "persona" | "episodic" | "instruction";

export type L1RecordMetadata = EventMeta & {
  source?: string;
  canonicalText?: string;
  memoryKind?: L1MemoryKind;
  sourceMessageIds?: string[];
  timestamps?: string[];
};

export function normalizeL1RecordMetadata(metadata: L1RecordMetadata): L1RecordMetadata {
  return {
    ...metadata,
    ...(metadata.sourceMessageIds === undefined
      ? {}
      : { sourceMessageIds: [...new Set(metadata.sourceMessageIds.filter(Boolean))] }),
    ...(metadata.timestamps === undefined
      ? {}
      : { timestamps: [...new Set(metadata.timestamps.filter(Boolean))] }),
  };
}

export function buildL1RecordMetadata(input: {
  source: NonNullable<L1RecordMetadata["source"]>;
  canonicalText?: string;
  memoryKind?: L1MemoryKind;
  sourceMessageIds?: string[];
  timestamps?: string[];
}): L1RecordMetadata {
  return normalizeL1RecordMetadata({
    source: input.source,
    ...(input.canonicalText === undefined ? {} : { canonicalText: input.canonicalText }),
    ...(input.memoryKind === undefined ? {} : { memoryKind: input.memoryKind }),
    ...(input.sourceMessageIds === undefined ? {} : { sourceMessageIds: input.sourceMessageIds }),
    ...(input.timestamps === undefined ? {} : { timestamps: input.timestamps }),
  });
}
