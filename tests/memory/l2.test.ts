import { expect, test } from "bun:test";
import { applyL2Patch, generateL2MermaidPatch, parseL2MermaidJson, validateMermaidCanvas } from "../../src/memory/offload/l2";

test("parseL2MermaidJson accepts write response with node mapping", () => {
  const parsed = parseL2MermaidJson(JSON.stringify({
    fileAction: "write",
    mmdContent: "flowchart TD\n  N1[\"Inspect tests<br/>status: done<br/>summary: Found missing recall\"]\n",
    replaceBlocks: [],
    nodeMapping: { ref_a: "N1" },
  }));

  expect(parsed).toEqual({
    fileAction: "write",
    mmdContent: "flowchart TD\n  N1[\"Inspect tests<br/>status: done<br/>summary: Found missing recall\"]\n",
    replaceBlocks: [],
    nodeMapping: { ref_a: "N1" },
  });
});

test("applyL2Patch applies replace blocks with 1-based line numbers", () => {
  const current = "flowchart TD\n  N1[\"Old\"]\n  N2[\"Keep\"]\n";
  const patched = applyL2Patch(current, {
    fileAction: "replace",
    mmdContent: null,
    replaceBlocks: [{ startLine: 2, endLine: 2, content: "  N1[\"New\"]" }],
    nodeMapping: { ref_a: "N1" },
  });

  expect(patched).toBe("flowchart TD\n  N1[\"New\"]\n  N2[\"Keep\"]\n");
});

test("validateMermaidCanvas rejects non-flowchart content", () => {
  expect(validateMermaidCanvas("flowchart TD\n  N1[\"ok\"]\n")).toBe(true);
  expect(validateMermaidCanvas("console.log('not mermaid')")).toBe(false);
});

test("generateL2MermaidPatch uses local LLM response", async () => {
  const llm = {
    async complete() {
      return {
        content: JSON.stringify({
          fileAction: "write",
          mmdContent: "flowchart TD\n  N1[\"Run test<br/>status: done<br/>summary: Recall failure reproduced\"]\n",
          replaceBlocks: [],
          nodeMapping: { ref_test: "N1" },
        }),
        toolCalls: [],
      };
    },
  };

  const patch = await generateL2MermaidPatch(llm as any, {
    taskLabel: "task-aware-recall",
    currentMmd: "flowchart TD\n",
    entries: [{ nodeId: "ref_test", toolName: "bun_test", summary: "Recall failure reproduced", score: 9, resultRef: "refs/c1/ref_test.md" }],
    maxCanvasChars: 12000,
  });

  expect(patch?.nodeMapping).toEqual({ ref_test: "N1" });
});
