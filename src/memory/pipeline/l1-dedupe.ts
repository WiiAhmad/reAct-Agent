import type { LlmProvider } from "../../agent/types";
import type { L1Record } from "../core/store/types";
import { buildL1DedupePrompt } from "../prompts/l1-dedupe";

export type L1ConflictDecision =
  | { action: "store" }
  | { action: "update"; targetRecordId: string }
  | { action: "merge"; targetRecordId: string }
  | { action: "skip"; targetRecordId?: string };

function parseDecision(content: string, candidates: L1Record[]): L1ConflictDecision {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const object = content.match(/\{[\s\S]*\}/)?.[0];
  const raw = fenced ?? object ?? content;

  try {
    const parsed = JSON.parse(raw) as { action?: unknown; targetRecordId?: unknown };
    const targetRecordId = typeof parsed.targetRecordId === "string" && parsed.targetRecordId.trim()
      ? parsed.targetRecordId.trim()
      : undefined;
    const hasTarget = targetRecordId !== undefined && candidates.some((candidate) => candidate.recordId === targetRecordId);

    if (parsed.action === "store") {
      return { action: "store" };
    }
    if (parsed.action === "skip") {
      return hasTarget ? { action: "skip", targetRecordId } : { action: "skip" };
    }
    if ((parsed.action === "update" || parsed.action === "merge") && hasTarget && targetRecordId !== undefined) {
      return { action: parsed.action, targetRecordId };
    }
  } catch {
    // Fall through to conservative store behavior.
  }

  return { action: "store" };
}

export async function resolveL1Conflict(input: {
  llm: LlmProvider;
  newRecord: L1Record;
  candidates: L1Record[];
}): Promise<L1ConflictDecision> {
  if (input.candidates.length === 0) {
    return { action: "store" };
  }

  const response = await input.llm.complete({
    messages: [
      { role: "system", content: "You are the L1 semantic dedupe decision step. Return strict JSON only." },
      { role: "user", content: buildL1DedupePrompt(input.newRecord, input.candidates) },
    ],
    tools: [],
    meta: { origin: "memory.l1.dedupe" },
  });

  return parseDecision(response.content, input.candidates);
}
