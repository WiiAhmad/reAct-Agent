import { mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { truncateText } from "../../utils/text";
import type { MemoryBackend } from "../core/backend";
import type { EventMeta } from "../core/types";

type OffloadServiceOptions = {
  offloadMinChars: number;
  offloadSummaryChars: number;
};

type FileWriter = (path: string, content: string) => Promise<void>;

type OffloadToolResultInput = {
  chatId: string;
  userId: string;
  toolName: string;
  args: EventMeta;
  rawResult: string;
};

export type OffloadToolResult = {
  content: string;
  offloaded: boolean;
  nodeId?: string;
  resultRef?: string;
  summary: string;
};

function makeNodeId(prefix = "ref"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function fenceSafe(input: string): string {
  return input.replace(/```/g, "''' ");
}

function summarize(rawResult: string, maxChars: number): string {
  return truncateText(rawResult.replace(/\s+/g, " ").trim(), maxChars);
}

export class OffloadService {
  constructor(
    private readonly backend: MemoryBackend,
    private readonly options: OffloadServiceOptions,
    private readonly writeTextFile: FileWriter = (path, content) => writeFile(path, content, "utf8"),
  ) {}

  async offloadToolResult(input: OffloadToolResultInput): Promise<OffloadToolResult> {
    const summary = summarize(input.rawResult, this.options.offloadSummaryChars);
    const shouldOffload = input.rawResult.length >= this.options.offloadMinChars;

    if (!shouldOffload) {
      const nodeId = makeNodeId("task");
      await this.backend.insertTaskGraphNode({
        chatId: input.chatId,
        userId: input.userId,
        nodeId,
        toolName: input.toolName,
        args: input.args,
        summary,
        status: "ok",
      });
      await this.tryWriteTaskCanvas(input.chatId);
      return { content: input.rawResult, offloaded: false, nodeId, summary };
    }

    const nodeId = makeNodeId("ref");
    const { absolutePath, relativePath } = await this.backend.getOffloadPath(input.chatId, nodeId);
    const markdown = this.buildRefMarkdown(nodeId, input, summary);

    const ref = {
      chatId: input.chatId,
      userId: input.userId,
      nodeId,
      kind: "tool_result" as const,
      title: `Tool result ${input.toolName}`,
      filePath: relativePath,
      summary,
    };
    const offloadedNode = {
      chatId: input.chatId,
      userId: input.userId,
      nodeId,
      toolName: input.toolName,
      args: input.args,
      summary,
      resultRef: relativePath,
      status: "offloaded",
    } as const;

    let refWritten = false;
    let metadataCommitted = false;

    try {
      await mkdir(dirname(absolutePath), { recursive: true });
      await this.writeTextFile(absolutePath, markdown);
      refWritten = true;

      await this.backend.insertOffloadRefWithTaskGraphNode(ref, offloadedNode);
      metadataCommitted = true;

      await this.writeTaskCanvas(input.chatId);

      return {
        content: [
          "[memory-offload]",
          `node_id=${nodeId}`,
          `result_ref=${relativePath}`,
          `tool=${input.toolName}`,
          `summary=${summary}`,
        ].join("\n"),
        offloaded: true,
        nodeId,
        resultRef: relativePath,
        summary,
      };
    } catch {
      if (metadataCommitted) {
        await this.tryDeleteOffloadMetadata(nodeId);
      }
      if (refWritten) {
        await this.tryDeleteOffloadRef(absolutePath);
      }
      await this.backend.insertTaskGraphNode({
        chatId: input.chatId,
        userId: input.userId,
        nodeId,
        toolName: input.toolName,
        args: input.args,
        summary,
        status: "fallback",
      });
      await this.tryWriteTaskCanvas(input.chatId);

      return {
        content: ["[offload-fallback]", `tool=${input.toolName}`, `summary=${summary}`].join("\n"),
        offloaded: false,
        nodeId,
        summary,
      };
    }
  }

  private buildRefMarkdown(nodeId: string, input: OffloadToolResultInput, summary: string): string {
    return [
      "# Offloaded tool result",
      "",
      `- node_id: ${nodeId}`,
      `- chat_id: ${input.chatId}`,
      `- user_id: ${input.userId}`,
      `- tool: ${input.toolName}`,
      "",
      "## Arguments",
      "```json",
      JSON.stringify(input.args ?? {}, null, 2),
      "```",
      "",
      "## Summary",
      summary,
      "",
      "## Raw result",
      "```text",
      fenceSafe(input.rawResult),
      "```",
    ].join("\n");
  }

  private async writeTaskCanvas(chatId: string): Promise<void> {
    const nodes = await this.backend.listTaskGraphNodes(chatId, 40);
    const canvasPath = await this.backend.getTaskCanvasPath(chatId);
    await mkdir(dirname(canvasPath), { recursive: true });
    await this.writeTextFile(canvasPath, `${this.buildTaskCanvas(chatId, nodes)}\n`);
  }

  private async tryWriteTaskCanvas(chatId: string): Promise<void> {
    try {
      await this.writeTaskCanvas(chatId);
    } catch {
      // degrade safely when canvas persistence is unavailable
    }
  }

  private async tryDeleteOffloadRef(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch {
      // best-effort cleanup when offload persistence degrades
    }
  }

  private async tryDeleteOffloadMetadata(nodeId: string): Promise<void> {
    try {
      await this.backend.deleteOffloadMetadata(nodeId);
    } catch {
      // best-effort cleanup when committed metadata must be rolled back
    }
  }

  private buildTaskCanvas(chatId: string, nodes: Array<{ nodeId: string; toolName?: string; summary: string; resultRef?: string }>): string {
    const lines = ["graph LR", `  Start([chat ${chatId}])`];
    let previous = "Start";

    for (const node of nodes) {
      const label = `${node.toolName ?? "turn"}: ${truncateText(node.summary.replace(/[\n\r]+/g, " "), 90)}`.replace(/"/g, "'");
      lines.push(`  ${node.nodeId}["${label}<br/>node_id=${node.nodeId}"]`);
      lines.push(`  ${previous} --> ${node.nodeId}`);
      if (node.resultRef) {
        lines.push(`  ${node.nodeId} -. result_ref .-> ${node.nodeId}_ref[("${basename(node.resultRef)}")]`);
      }
      previous = node.nodeId;
    }

    return lines.join("\n");
  }
}
