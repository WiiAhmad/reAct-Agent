import type { LlmProvider } from "../../agent/types";
import { createHash } from "node:crypto";
import { canonicalizeMemoryAtomText, mergeNumberSets } from "../core/canonical";
import type { MemoryBackend } from "../core/backend";
import { buildL1RecordMetadata, type L1MemoryKind } from "../core/store/record-metadata";
import type { IMemoryStore, L1Record } from "../core/store/types";
import type { ConversationTurn, MemoryAtom } from "../core/types";
import { buildL1SystemPrompt } from "../prompts/l1";
import { normalizeL1Extraction, type ParsedL1Extraction } from "./l1-schema";

type ParsedExtractions = {
  extractions: ParsedL1Extraction[];
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

    return { extractions: parsed as ParsedL1Extraction[], malformed: false };
  } catch {
    return { extractions: [], malformed: true };
  }
}

function buildTranscript(turns: ConversationTurn[]): string {
  return turns.map((turn) => `turn_id=${turn.id} ${turn.role}: ${turn.content}`).join("\n");
}

function atomToStoreRecord(atom: MemoryAtom, turns: ConversationTurn[]): L1Record {
  const firstTurn = turns[0];
  const lastTurn = turns.at(-1);
  const now = new Date().toISOString();
  const timestampStart = firstTurn?.createdAt ?? now;
  const timestampEnd = lastTurn?.createdAt ?? timestampStart;
  const chatId = firstTurn?.chatId ?? "default";

  return {
    recordId: `legacy:l1:${atom.id}`,
    userId: atom.userId,
    sessionKey: `chat:${chatId}`,
    sessionId: chatId,
    content: atom.text,
    type: atom.sourceLayer,
    priority: atom.importance,
    sceneName: "conversation",
    timestampStr: timestampEnd,
    timestampStart,
    timestampEnd,
    sourceConversationIds: atom.sourceConversationIds,
    metadata: { source: "pipeline" },
    createdTime: atom.createdAt,
    updatedTime: atom.updatedAt,
  };
}

function storeRecordId(userId: string, canonicalText: string): string {
  const digest = createHash("sha256").update(`${userId}\0${canonicalText}`).digest("hex").slice(0, 24);
  return `store:l1:${digest}`;
}

async function buildStorePrimaryRecord(
  store: IMemoryStore,
  userId: string,
  text: string,
  importance: number,
  sourceConversationIds: number[],
  turns: ConversationTurn[],
  semantic?: {
    sceneName: string;
    memoryKind: L1MemoryKind;
    sourceMessageIds: string[];
    timestamps: string[];
  },
): Promise<{ record: L1Record; created: boolean }> {
  const canonicalText = canonicalizeMemoryAtomText(text);
  if (!canonicalText) {
    throw new Error("Memory atom canonical text cannot be empty");
  }

  const existing = (await store.queryL1Records({ userId, type: "L1", limit: Number.MAX_SAFE_INTEGER }))
    .find((record) => canonicalizeMemoryAtomText(record.content) === canonicalText);
  const firstTurn = turns[0];
  const lastTurn = turns.at(-1);
  const now = new Date().toISOString();
  const timestampStart = firstTurn?.createdAt ?? existing?.timestampStart ?? now;
  const timestampEnd = lastTurn?.createdAt ?? existing?.timestampEnd ?? timestampStart;
  const chatId = firstTurn?.chatId ?? existing?.sessionId ?? "default";

  return {
    created: !existing,
    record: {
      recordId: existing?.recordId ?? storeRecordId(userId, canonicalText),
      userId,
      sessionKey: existing?.sessionKey ?? `chat:${chatId}`,
      sessionId: existing?.sessionId ?? chatId,
      content: text,
      type: "L1",
      priority: Math.max(existing?.priority ?? 0, importance),
      sceneName: semantic?.sceneName ?? existing?.sceneName ?? "conversation",
      timestampStr: timestampEnd,
      timestampStart,
      timestampEnd,
      sourceConversationIds: mergeNumberSets(existing?.sourceConversationIds ?? [], sourceConversationIds),
      metadata: {
        ...(existing?.metadata ?? {}),
        ...buildL1RecordMetadata({
          source: "pipeline",
          canonicalText,
          memoryKind: semantic?.memoryKind,
          sourceMessageIds: semantic?.sourceMessageIds,
          timestamps: semantic?.timestamps,
        }),
      },
      createdTime: existing?.createdTime ?? timestampStart,
      updatedTime: timestampEnd,
    },
  };
}

export async function runL1Pipeline(
  backend: MemoryBackend,
  llm: LlmProvider,
  userId: string,
  turns: ConversationTurn[],
  store?: IMemoryStore,
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
    meta: { origin: "memory.l1" },
  });

  const parsed = parseExtractions(response.content);
  if (parsed.malformed) {
    return { createdAtoms: 0, lastConversationId: turns.at(-1)?.id ?? 0, checkpointAdvanced: false };
  }

  let createdAtoms = 0;
  for (const item of parsed.extractions) {
    const normalized = normalizeL1Extraction(item);
    if (!normalized) continue;

    const importance = normalized.importance ?? 3;
    const sourceConversationIds = normalized.source_turn_ids ?? [];
    let storeCreated: boolean | undefined;

    if (store) {
      const { record, created } = await buildStorePrimaryRecord(store, userId, normalized.text, importance, sourceConversationIds, turns, {
        sceneName: normalized.scene_name ?? "conversation",
        memoryKind: normalized.memory_kind ?? "episodic",
        sourceMessageIds: normalized.source_message_ids ?? [],
        timestamps: normalized.timestamps ?? [],
      });
      const stored = await store.upsertL1(record);
      storeCreated = stored ? created : undefined;
    }

    const result = await backend.upsertMemoryAtom({
      userId,
      text: normalized.text,
      importance,
      sourceConversationIds,
      sourceLayer: "L1",
    });

    if (storeCreated ?? result.created) {
      createdAtoms += 1;
    }

    if (store && storeCreated === undefined) {
      await store.upsertL1(atomToStoreRecord(result.atom, turns));
    }

    for (const sourceTurnId of sourceConversationIds) {
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
