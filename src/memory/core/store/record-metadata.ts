import type { EventMeta } from "../types";

export type L1MemoryKind = "persona" | "episodic" | "instruction";

export type L1RecordMetadata = EventMeta & {
  source?: "pipeline" | "MemoryService.saveMemory" | "offload";
  canonicalText?: string;
  memoryKind?: L1MemoryKind;
  sourceMessageIds?: string[];
  timestamps?: string[];
};

export function normalizeL1RecordMetadata(metadata: L1RecordMetadata): L1RecordMetadata {
  return {
    ...metadata,
    sourceMessageIds: [...new Set((metadata.sourceMessageIds ?? []).filter(Boolean))],
    timestamps: [...new Set((metadata.timestamps ?? []).filter(Boolean))],
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
    canonicalText: input.canonicalText,
    memoryKind: input.memoryKind,
    sourceMessageIds: input.sourceMessageIds,
    timestamps: input.timestamps,
  });
}
