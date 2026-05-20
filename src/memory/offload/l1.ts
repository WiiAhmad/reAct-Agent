import type { LlmProvider } from "../../agent/types";
import type { EventMeta } from "../core/types";

export type L1EvidenceSummary = {
  summary: string;
  score: number;
};

export type L1EvidenceInput = {
  toolName: string;
  toolCallId?: string;
  args: EventMeta;
  rawResult: string;
  maxSummaryChars: number;
  defaultScore: number;
};

function boundedText(input: string, maxChars: number): string {
  if (maxChars <= 0) {
    return "";
  }
  return input.length <= maxChars ? input : input.slice(0, maxChars);
}

export function parseL1EvidenceJson(content: string): L1EvidenceSummary | undefined {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    const summary = (parsed as { summary?: unknown }).summary;
    const score = (parsed as { score?: unknown }).score;
    if (typeof summary !== "string" || summary.trim().length === 0) {
      return undefined;
    }
    if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 10) {
      return undefined;
    }

    return { summary: summary.trim(), score };
  } catch {
    return undefined;
  }
}

export function buildFallbackL1Summary(rawResult: string, maxSummaryChars: number, defaultScore: number): L1EvidenceSummary {
  return {
    summary: boundedText(rawResult.replace(/\s+/g, " ").trim(), maxSummaryChars),
    score: defaultScore,
  };
}

export async function generateL1EvidenceSummary(llm: LlmProvider, input: L1EvidenceInput): Promise<L1EvidenceSummary> {
  const response = await llm.complete({
    messages: [
      {
        role: "system",
        content: [
          "Create a semantic L1 evidence summary for a tool result.",
          "Return only strict JSON with fields summary and score.",
          "summary must explain how the result moves, blocks, or verifies the current task.",
          "score is an integer 0-10 where higher means the summary can replace the raw result for planning.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          toolName: input.toolName,
          toolCallId: input.toolCallId ?? null,
          args: input.args,
          rawResult: boundedText(input.rawResult, Math.max(input.maxSummaryChars * 8, 2000)),
        }),
      },
    ],
    tools: [],
    meta: { origin: "offload.l1" },
  });

  const parsed = parseL1EvidenceJson(response.content);
  if (!parsed) {
    return buildFallbackL1Summary(input.rawResult, input.maxSummaryChars, input.defaultScore);
  }

  return {
    summary: boundedText(parsed.summary, input.maxSummaryChars),
    score: parsed.score,
  };
}
