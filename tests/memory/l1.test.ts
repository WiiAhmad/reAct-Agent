import { expect, test } from "bun:test";
import { buildFallbackL1Summary, generateL1EvidenceSummary, parseL1EvidenceJson } from "../../src/memory/offload/l1";

test("parseL1EvidenceJson accepts strict semantic evidence JSON", () => {
  const parsed = parseL1EvidenceJson(JSON.stringify({
    summary: "Read auth middleware and found token refresh missing from retry branch.",
    score: 8,
  }));

  expect(parsed).toEqual({
    summary: "Read auth middleware and found token refresh missing from retry branch.",
    score: 8,
  });
});

test("parseL1EvidenceJson rejects malformed summaries", () => {
  expect(parseL1EvidenceJson("not json")).toBeUndefined();
  expect(parseL1EvidenceJson(JSON.stringify({ summary: "", score: 8 }))).toBeUndefined();
  expect(parseL1EvidenceJson(JSON.stringify({ summary: "ok", score: 99 }))).toBeUndefined();
});

test("buildFallbackL1Summary produces bounded deterministic summary", () => {
  const fallback = buildFallbackL1Summary("a\n".repeat(100), 30, 4);
  expect(fallback.summary.length).toBeLessThanOrEqual(30);
  expect(fallback.score).toBe(4);
});

test("generateL1EvidenceSummary uses local LLM response", async () => {
  const calls: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  const llm = {
    async complete(input: { messages: Array<{ role: string; content: string }> }) {
      calls.push(input);
      return {
        content: JSON.stringify({
          summary: "Ran targeted test and confirmed task-aware recall currently misses completed task canvas.",
          score: 9,
        }),
        toolCalls: [],
      };
    },
  };

  const summary = await generateL1EvidenceSummary(llm as any, {
    toolName: "bun_test",
    toolCallId: "call_1",
    args: { file: "tests/memory/task-recall.test.ts" },
    rawResult: "FAIL task-aware recall currently returns only active canvas",
    maxSummaryChars: 120,
    defaultScore: 5,
  });

  expect(summary).toEqual({
    summary: "Ran targeted test and confirmed task-aware recall currently misses completed task canvas.",
    score: 9,
  });
  expect(calls[0]?.messages[0]?.content).toContain("semantic L1 evidence summary");
});
