import { appendFile, mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { LlmProvider } from "../../agent/types";
import { emitTrace, NEW_MEMORY_STACK_TAG } from "../../logging/helpers";
import type { RuntimeTraceEmitter } from "../../logging/types";
import { truncateText } from "../../utils/text";
import type { MemoryBackend } from "../core/backend";
import type { EventMeta } from "../core/types";
import { generateL1EvidenceSummary } from "./l1";
import { generateL2MermaidPatch } from "./l2";
import { flushPendingTaskEvidence } from "./runtime";

type OffloadServiceOptions = {
  offloadMinChars: number;
  offloadSummaryChars: number;
  l1: {
    enabled: boolean;
    mode: "local";
    maxSummaryChars: number;
    defaultScore: number;
  };
  l2: {
    enabled: boolean;
    mode: "local";
    triggerMinEntries: number;
    maxCanvasChars: number;
  };
  jsonlEnabled: boolean;
};

type FileWriter = (path: string, content: string) => Promise<void>;

export type OffloadToolResultInput = {
  chatId: string;
  userId: string;
  taskId?: number;
  toolCallId?: string;
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
    private readonly llm: LlmProvider,
    private readonly writeTextFile: FileWriter = (path, content) => writeFile(path, content, "utf8"),
    private readonly trace?: RuntimeTraceEmitter,
  ) {}

  async offloadToolResult(input: OffloadToolResultInput): Promise<OffloadToolResult> {
    const semantic = this.options.l1.enabled
      ? await generateL1EvidenceSummary(this.llm, {
          toolName: input.toolName,
          toolCallId: input.toolCallId,
          args: input.args,
          rawResult: input.rawResult,
          maxSummaryChars: this.options.l1.maxSummaryChars,
          defaultScore: this.options.l1.defaultScore,
        })
      : { summary: summarize(input.rawResult, this.options.offloadSummaryChars), score: this.options.l1.defaultScore };
    const summary = semantic.summary;
    const score = semantic.score;
    const createdAt = new Date().toISOString();
    const shouldOffload = input.rawResult.length >= this.options.offloadMinChars;

    if (!shouldOffload) {
      const nodeId = makeNodeId("task");
      await this.backend.insertTaskGraphNode({
        chatId: input.chatId,
        userId: input.userId,
        nodeId,
        taskId: input.taskId,
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        args: input.args,
        summary,
        score,
        status: "ok",
        createdAt,
      });
      await this.persistL1Evidence(input, nodeId, summary, undefined, score, createdAt);
      await this.tryWriteTaskCanvas(input.chatId, input.taskId);
      this.emitOffload("offload.inline", input, { nodeId, summaryLength: summary.length, rawLength: input.rawResult.length });
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
      createdAt,
    };
    const offloadedNode = {
      chatId: input.chatId,
      userId: input.userId,
      taskId: input.taskId,
      nodeId,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      args: input.args,
      summary,
      resultRef: relativePath,
      score,
      status: "offloaded",
      createdAt,
    } as const;

    let refWritten = false;
    let metadataCommitted = false;

    try {
      await mkdir(dirname(absolutePath), { recursive: true });
      await this.writeTextFile(absolutePath, markdown);
      refWritten = true;

      await this.backend.insertOffloadRefWithTaskGraphNode(ref, offloadedNode);
      metadataCommitted = true;
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
        taskId: input.taskId,
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        args: input.args,
        summary,
        score,
        status: "fallback",
        createdAt,
      });
      await this.persistL1Evidence(input, nodeId, summary, undefined, score, createdAt);
      await this.tryWriteTaskCanvas(input.chatId, input.taskId);
      this.emitOffload("offload.fallback", input, { nodeId, summaryLength: summary.length, rawLength: input.rawResult.length });

      return {
        content: ["[offload-fallback]", `tool=${input.toolName}`, `summary=${summary}`].join("\n"),
        offloaded: false,
        nodeId,
        summary,
      };
    }

    await this.persistL1Evidence(input, nodeId, summary, relativePath, score, createdAt);
    await this.tryWriteTaskCanvas(input.chatId, input.taskId);
    this.emitOffload("offload.ref_written", input, { nodeId, resultRef: relativePath, summaryLength: summary.length, rawLength: input.rawResult.length });

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
  }

  private emitOffload(event: string, input: OffloadToolResultInput, payload: Record<string, unknown>) {
    emitTrace(this.trace, {
      minLevel: 2,
      source: "memory",
      event,
      tags: [NEW_MEMORY_STACK_TAG],
      chatId: input.chatId,
      userId: input.userId,
      taskId: input.taskId == null ? undefined : String(input.taskId),
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      payload,
    });
  }

  private async persistL1Evidence(
    input: OffloadToolResultInput,
    nodeId: string,
    summary: string,
    resultRef: string | undefined,
    score: number,
    createdAt: string,
  ): Promise<void> {
    await this.backend.insertL1EvidenceEntry({
      chatId: input.chatId,
      userId: input.userId,
      taskId: input.taskId,
      nodeId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      args: input.args,
      summary,
      resultRef,
      score,
      status: input.taskId ? "pending" : "mapped",
      createdAt,
    });
    await this.writeL1Jsonl({
      chatId: input.chatId,
      userId: input.userId,
      taskId: input.taskId,
      nodeId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      summary,
      resultRef,
      score,
      createdAt,
    });
  }

  private async writeL1Jsonl(input: {
    chatId: string;
    userId: string;
    taskId?: number;
    nodeId: string;
    toolCallId?: string;
    toolName: string;
    summary: string;
    resultRef?: string;
    score: number;
    createdAt: string;
  }): Promise<void> {
    if (!this.options.jsonlEnabled) {
      return;
    }
    const jsonlPath = await this.backend.getL1EvidenceJsonlPath(input.chatId);
    await mkdir(dirname(jsonlPath.absolutePath), { recursive: true });
    await appendFile(jsonlPath.absolutePath, `${JSON.stringify({ type: "l1_evidence", ...input })}\n`, "utf8");
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

  private async writeTaskCanvas(chatId: string, taskId: number | undefined): Promise<void> {
    if (!taskId) {
      return;
    }

    const canvasPath = await this.backend.getTaskCanvasFilePath(taskId);
    if (!canvasPath) {
      return;
    }

    const pending = await this.backend.listPendingL1EvidenceEntriesForTask(taskId, this.options.l2.triggerMinEntries);
    if (this.options.l2.enabled && pending.length >= this.options.l2.triggerMinEntries) {
      const currentMmd = await this.readExistingCanvas(canvasPath.absolutePath);
      const task = await this.backend.getTaskCanvasById(pending[0]!.userId, taskId);
      const nodes = await this.backend.listTaskGraphNodesForTask(taskId, 80);
      const fallbackMmd = `${this.buildTaskCanvas(chatId, nodes)}\n`;
      const flushed = await flushPendingTaskEvidence({
        currentMmd,
        fallbackMmd,
        generatePatch: async () => {
          if (!task) {
            return undefined;
          }

          return generateL2MermaidPatch(this.llm, {
            taskLabel: task.label,
            currentMmd,
            entries: pending.map((entry) => ({
              nodeId: entry.nodeId,
              toolName: entry.toolName,
              summary: entry.summary,
              score: entry.score,
              resultRef: entry.resultRef,
            })),
            maxCanvasChars: this.options.l2.maxCanvasChars,
          });
        },
      });

      await mkdir(dirname(canvasPath.absolutePath), { recursive: true });
      await this.writeTextFile(canvasPath.absolutePath, flushed.canvas);
      if (Object.keys(flushed.nodeMapping).length > 0) {
        await this.backend.updateL1EvidenceNodeMapping(taskId, flushed.nodeMapping);
      }
      if (task) {
        await this.backend.upsertTaskCanvasSearchText({
          taskId,
          chatId,
          userId: task.userId,
          label: task.label,
          status: task.status,
          filePath: task.filePath,
          canvas: flushed.canvas,
        });
      }
      return;
    }

    const nodes = await this.backend.listTaskGraphNodesForTask(taskId, 80);
    const fallbackMmd = `${this.buildTaskCanvas(chatId, nodes)}\n`;
    await mkdir(dirname(canvasPath.absolutePath), { recursive: true });
    await this.writeTextFile(canvasPath.absolutePath, fallbackMmd);
    const task = nodes[0]?.userId ? await this.backend.getTaskCanvasById(nodes[0].userId, taskId) : undefined;
    if (task) {
      await this.backend.upsertTaskCanvasSearchText({
        taskId,
        chatId,
        userId: task.userId,
        label: task.label,
        status: task.status,
        filePath: task.filePath,
        canvas: fallbackMmd,
      });
    }
  }

  private async readExistingCanvas(path: string): Promise<string> {
    try {
      return await Bun.file(path).text();
    } catch {
      return "flowchart TD\n";
    }
  }

  private async tryWriteTaskCanvas(chatId: string, taskId: number | undefined): Promise<void> {
    try {
      await this.writeTaskCanvas(chatId, taskId);
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
