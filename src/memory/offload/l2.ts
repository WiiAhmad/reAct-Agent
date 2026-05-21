import type { LlmProvider } from "../../agent/types";
import { truncateText } from "../../utils/text";

export type L2EvidenceEntry = {
  nodeId: string;
  toolName?: string;
  summary: string;
  score: number;
  resultRef?: string;
  createdAt?: string;
};

export type L2ReplaceBlock = {
  startLine: number;
  endLine: number;
  content: string;
};

export type L2MermaidPatch = {
  fileAction: "write" | "replace";
  mmdContent: string | null;
  replaceBlocks: L2ReplaceBlock[];
  nodeMapping: Record<string, string>;
};

export type L2Input = {
  taskLabel: string;
  currentMmd: string;
  entries: L2EvidenceEntry[];
  maxCanvasChars: number;
};

export function parseL2MermaidJson(content: string): L2MermaidPatch | undefined {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    const value = parsed as Record<string, unknown>;
    if (value.fileAction !== "write" && value.fileAction !== "replace") {
      return undefined;
    }

    const replaceBlocks = Array.isArray(value.replaceBlocks)
      ? value.replaceBlocks.map((block) => ({
          startLine: Number((block as { startLine?: unknown }).startLine),
          endLine: Number((block as { endLine?: unknown }).endLine),
          content: String((block as { content?: unknown }).content ?? ""),
        }))
      : [];
    if (replaceBlocks.some((block) => !Number.isInteger(block.startLine) || !Number.isInteger(block.endLine) || block.startLine < 1 || block.endLine < block.startLine)) {
      return undefined;
    }

    if (!value.nodeMapping || typeof value.nodeMapping !== "object" || Array.isArray(value.nodeMapping)) {
      return undefined;
    }
    const nodeMapping = Object.fromEntries(
      Object.entries(value.nodeMapping as Record<string, unknown>)
        .filter(([key, val]) => key && typeof val === "string" && val.trim())
        .map(([key, val]) => [key, String(val).trim()]),
    );
    if (Object.keys(nodeMapping).length === 0) {
      return undefined;
    }

    const mmdContent = typeof value.mmdContent === "string" ? value.mmdContent : null;
    if (value.fileAction === "write" && !mmdContent) {
      return undefined;
    }
    if (value.fileAction === "replace" && replaceBlocks.length === 0) {
      return undefined;
    }

    return { fileAction: value.fileAction, mmdContent, replaceBlocks, nodeMapping };
  } catch {
    return undefined;
  }
}

export function validateMermaidCanvas(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith("flowchart TD") || trimmed.startsWith("graph TD") || trimmed.startsWith("graph LR") || trimmed.startsWith("flowchart LR");
}

export function applyL2Patch(currentMmd: string, patch: L2MermaidPatch): string {
  if (patch.fileAction === "write") {
    return `${patch.mmdContent!.trimEnd()}\n`;
  }

  const lines = currentMmd.replace(/\r\n/g, "\n").split("\n");
  const ordered = [...patch.replaceBlocks].sort((a, b) => b.startLine - a.startLine);
  for (const block of ordered) {
    lines.splice(block.startLine - 1, block.endLine - block.startLine + 1, ...block.content.replace(/\r\n/g, "\n").split("\n"));
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function generateL2MermaidPatch(llm: LlmProvider, input: L2Input): Promise<L2MermaidPatch | undefined> {
  const response = await llm.complete({
    messages: [
      {
        role: "system",
        content: [
          "You generate compact semantic Mermaid task canvases from L1 evidence.",
          "Return only strict JSON with fileAction, mmdContent, replaceBlocks, and nodeMapping.",
          "Every input nodeId must appear exactly once in nodeMapping.",
          "Prefer semantic stages over chronological logs.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          taskLabel: input.taskLabel,
          currentMmd: truncateText(input.currentMmd, input.maxCanvasChars),
          entries: input.entries,
        }),
      },
    ],
    tools: [],
    meta: { origin: "offload.l2" },
  });

  const parsed = parseL2MermaidJson(response.content);
  if (!parsed) {
    return undefined;
  }

  const candidate = applyL2Patch(input.currentMmd, parsed);
  if (!validateMermaidCanvas(candidate) || candidate.length > input.maxCanvasChars) {
    return undefined;
  }

  return parsed;
}
