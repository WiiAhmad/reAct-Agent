import { expect, test } from "bun:test";
import type { L1Record } from "../../src/memory/core/store/types";
import { resolveL1Conflict } from "../../src/memory/pipeline/l1-dedupe";

test("resolveL1Conflict can choose update for a paraphrased instruction memory", async () => {
  const existing: L1Record = {
    recordId: "store:l1:existing",
    userId: "u1",
    sessionKey: "chat:c1",
    sessionId: "c1",
    content: "Use Bun for local scripts",
    type: "L1",
    priority: 6,
    sceneName: "runtime",
    timestampStr: "2026-05-18T08:00:00.000Z",
    sourceConversationIds: [1],
    metadata: { source: "pipeline", memoryKind: "instruction" },
    createdTime: "2026-05-18T08:00:00.000Z",
    updatedTime: "2026-05-18T08:00:00.000Z",
  };

  const llm = {
    async complete() {
      return {
        content: JSON.stringify({ action: "update", targetRecordId: "store:l1:existing" }),
        toolCalls: [],
      };
    },
  };

  const decision = await resolveL1Conflict({
    llm: llm as any,
    newRecord: {
      ...existing,
      recordId: "store:l1:new",
      content: "Prefer Bun when running local scripts",
      sourceConversationIds: [2],
    },
    candidates: [existing],
  });

  expect(decision).toEqual({ action: "update", targetRecordId: "store:l1:existing" });
});
