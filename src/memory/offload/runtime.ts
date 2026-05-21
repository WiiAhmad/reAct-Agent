import { applyL2Patch, type L2MermaidPatch } from "./l2";

export async function flushPendingTaskEvidence(input: {
  currentMmd: string;
  fallbackMmd: string;
  generatePatch: () => Promise<L2MermaidPatch | undefined>;
}) {
  const firstPatch = await input.generatePatch();
  const secondPatch = firstPatch ?? await input.generatePatch();

  if (!secondPatch) {
    return { mode: "fallback" as const, canvas: input.fallbackMmd, nodeMapping: {} as Record<string, string> };
  }

  const canvas = secondPatch.fileAction === "write"
    ? secondPatch.mmdContent ?? input.currentMmd
    : applyL2Patch(input.currentMmd, secondPatch);

  return { mode: "patched" as const, canvas, nodeMapping: secondPatch.nodeMapping };
}
