import type { LlmProvider } from "../../agent/types";
import type { MemoryBackend } from "../core/backend";
import type { ConversationTurn } from "../core/types";
import { buildL1SystemPrompt } from "../prompts/l1";

type L1Extraction = {
  text: string;
  importance?: number;
  source_turn_ids?: number[];
};

type ParsedExtractions = {
  extractions: L1Extraction[];
  malformed: boolean;
};

function parseExtractions(content: string): ParsedExtractions {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const bracketed = content.match(/\[[\s\S]*\]/)?.[0];
  const raw = fenced ?? bracketed;

  if (!raw) {
    return { extractions: [], malformed: true };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return { extractions: [], malformed: true };
    }

    return { extractions: parsed as L1Extraction[], malformed: false };
  } catch {
    return { extractions: [], malformed: true };
  }
}

function buildTranscript(turns: ConversationTurn[]): string {
  return turns.map((turn) => `turn_id=${turn.id} ${turn.role}: ${turn.content}`).join("\n");
}

export async function runL1Pipeline(
  backend: MemoryBackend,
  llm: LlmProvider,
  userId: string,
  turns: ConversationTurn[],
): Promise<{ createdAtoms: number; lastConversationId: number; checkpointAdvanced: boolean }> {
  if (turns.length === 0) {
    return { createdAtoms: 0, lastConversationId: 0, checkpointAdvanced: false };
  }

  const response = await llm.complete({
    messages: [
      { role: "system", content: buildL1SystemPrompt() },
      { role: "user", content: buildTranscript(turns) },
    ],
    tools: [],
  });

  const parsed = parseExtractions(response.content);
  if (parsed.malformed) {
    return { createdAtoms: 0, lastConversationId: turns.at(-1)?.id ?? 0, checkpointAdvanced: false };
  }

  let createdAtoms = 0;
  for (const item of parsed.extractions) {
    const text = item.text?.trim();
    if (!text) continue;

    const result = await backend.upsertMemoryAtom({
      userId,
      text,
      importance: item.importance ?? 3,
      sourceConversationIds: item.source_turn_ids ?? [],
      sourceLayer: "L1",
    });

    if (result.created) {
      createdAtoms += 1;
    }

    for (const sourceTurnId of item.source_turn_ids ?? []) {
      await backend.insertLineageLink({
        userId,
        sourceKind: "conversation",
        sourceId: String(sourceTurnId),
        targetKind: "memory_atom",
        targetId: String(result.atom.id),
        linkType: "evidence",
      });
    }
  }

  return {
    createdAtoms,
    lastConversationId: turns.at(-1)?.id ?? 0,
    checkpointAdvanced: true,
  };
}
