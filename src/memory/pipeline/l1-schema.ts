import type { L1MemoryKind } from "../core/store/record-metadata";

export type ParsedL1Extraction = {
  text: string;
  importance?: number;
  source_turn_ids?: number[];
  memory_kind?: L1MemoryKind;
  scene_name?: string;
  source_message_ids?: string[];
  timestamps?: string[];
};

export function normalizeL1Extraction(input: ParsedL1Extraction): ParsedL1Extraction | undefined {
  const text = input.text?.trim();
  if (!text) return undefined;

  return {
    text,
    importance: input.importance,
    source_turn_ids: input.source_turn_ids ?? [],
    memory_kind: input.memory_kind ?? "episodic",
    scene_name: input.scene_name?.trim() || "conversation",
    source_message_ids: [...new Set((input.source_message_ids ?? []).filter(Boolean))],
    timestamps: [...new Set((input.timestamps ?? []).filter(Boolean))],
  };
}
