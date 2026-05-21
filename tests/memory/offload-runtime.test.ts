import { expect, test } from "bun:test";
import { flushPendingTaskEvidence } from "../../src/memory/offload/runtime";

test("flushPendingTaskEvidence retries patch generation once before falling back", async () => {
  let attempts = 0;
  const result = await flushPendingTaskEvidence({
    currentMmd: "flowchart TD\n",
    fallbackMmd: "flowchart TD\n  Fallback[\"Run test\"]\n",
    generatePatch: async () => {
      attempts += 1;
      if (attempts === 1) {
        return undefined;
      }
      return {
        fileAction: "write",
        mmdContent: "flowchart TD\n  N1[\"Run test\"]\n",
        replaceBlocks: [],
        nodeMapping: { ref_test: "N1" },
      };
    },
  });

  expect(attempts).toBe(2);
  expect(result.mode).toBe("patched");
  expect(result.canvas).toContain("N1");
  expect(result.nodeMapping).toEqual({ ref_test: "N1" });
});
