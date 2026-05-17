import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { LlmProvider } from "../../agent/types";
import { truncateText } from "../../utils/text";
import type { MemoryBackend } from "./backend";
import type { ConversationTurnRole, EventMeta, InteractionEvent } from "./types";
import { InteractionLogService } from "../events/service";
import { OffloadService, type OffloadToolResult } from "../offload/service";
import { PipelineCoordinator, type PipelineMaintenanceResult } from "../pipeline/coordinator";
import { RecallService } from "../recall/service";

export type MemoryServiceRecall = {
  persona?: string;
  atoms: Array<{ id: number; text: string; importance: number }>;
  scenarios: Array<{ id: number; title: string; body_markdown?: string; bodyMarkdown?: string }>;
  conversations: Array<{ id: number; role: string; content: string; created_at?: string; createdAt?: string }>;
  taskCanvas?: string;
};

export type SaveMemoryInput = {
  userId: string;
  text: string;
  importance?: number;
  sourceConversationIds?: number[];
  sourceLayer?: "L1" | "L2" | "L3";
};

export type LogTurnInput = {
  chatId: string;
  userId: string;
  role: ConversationTurnRole;
  content: string;
  meta?: EventMeta;
};

export type MemoryServiceOptions = {
  dataDir: string;
  backendName: string;
  backendOwner: string;
  maintenanceCron: string;
  offloadEnabled: boolean;
};

type MaybePromise<T> = T | Promise<T>;

export type MemoryServiceLike = {
  recall(userId: string, query: string, maxResults: number, chatId?: string): MaybePromise<MemoryServiceRecall>;
  searchConversations(userId: string, query: string, limit?: number): MaybePromise<string>;
  readContextRef(input: { userId: string; nodeId?: string; resultRef?: string }): MaybePromise<string>;
  memoryStatus(userId: string, chatId?: string): MaybePromise<string>;
  saveMemory(input: SaveMemoryInput): MaybePromise<number>;
};

type MemoryServiceState = {
  backend: MemoryBackend;
  recallService: RecallService;
  interactionLogService: InteractionLogService;
  offloadService: OffloadService;
  pipelineCoordinator: PipelineCoordinator;
  options: MemoryServiceOptions;
};

const memoryServiceState = new WeakMap<MemoryService, MemoryServiceState>();

function getState(service: MemoryService): MemoryServiceState {
  const state = memoryServiceState.get(service);
  if (!state) {
    throw new Error("MemoryService is not initialized");
  }
  return state;
}

export class MemoryService {
  constructor(
    backend: MemoryBackend,
    llm: LlmProvider,
    options: MemoryServiceOptions,
    recallService = new RecallService(backend),
    offloadService = new OffloadService(backend, {
      offloadMinChars: 2500,
      offloadSummaryChars: 900,
    }),
    pipelineCoordinator = new PipelineCoordinator(backend, llm),
    interactionLogService = new InteractionLogService(backend, {
      enabled: false,
    }),
  ) {
    memoryServiceState.set(this, {
      backend,
      recallService,
      interactionLogService,
      offloadService,
      pipelineCoordinator,
      options,
    });
  }

  async recall(userId: string, query: string, maxResults: number, chatId?: string): Promise<MemoryServiceRecall> {
    const { recallService } = getState(this);
    const recall = await recallService.recall(userId, query, maxResults, chatId);
    return {
      persona: recall.persona,
      atoms: recall.atoms,
      scenarios: recall.scenarios.map((scenario) => ({
        id: scenario.id,
        title: scenario.title,
        bodyMarkdown: scenario.bodyMarkdown,
        body_markdown: scenario.bodyMarkdown,
      })),
      conversations: recall.conversations.map((conversation) => ({
        id: conversation.id,
        role: conversation.role,
        content: conversation.content,
        createdAt: conversation.createdAt,
        created_at: conversation.createdAt,
      })),
      taskCanvas: recall.taskCanvas,
    };
  }

  async searchConversations(userId: string, query: string, limit = 5): Promise<string> {
    const { backend } = getState(this);
    const conversations = await backend.searchConversationTurns(userId, query, limit);
    if (conversations.length === 0) {
      return "No matching conversation found.";
    }

    return conversations
      .map((conversation) => {
        return `#${conversation.id} [${conversation.createdAt}] ${conversation.role}: ${truncateText(conversation.content, 800)}`;
      })
      .join("\n\n");
  }

  async readContextRef(input: { userId: string; nodeId?: string; resultRef?: string }): Promise<string> {
    const { backend, options } = getState(this);
    const ref = input.nodeId
      ? await backend.findOffloadRefByNodeId(input.userId, input.nodeId)
      : input.resultRef
        ? await backend.findOffloadRefByFilePath(input.userId, input.resultRef)
        : undefined;

    if (!ref) {
      return "No matching context ref found.";
    }

    const path = resolve(options.dataDir, ref.filePath);
    const root = resolve(options.dataDir);
    if (!path.startsWith(root)) {
      return "Invalid ref path.";
    }

    return truncateText(await readFile(path, "utf8"), 12000);
  }

  async memoryStatus(userId: string, chatId?: string): Promise<string> {
    const { backend, options } = getState(this);
    const [conversationCount, atomCount, scenarioCount, offloadRefCount, persona, taskCanvasPath] = await Promise.all([
      backend.countConversationTurns(userId),
      backend.countMemoryAtoms(userId),
      backend.countMemoryScenarios(userId),
      backend.countOffloadRefs(userId),
      backend.getPersona(userId),
      chatId ? backend.getTaskCanvas(chatId).then((canvas) => (canvas ? backend.getTaskCanvasPath(chatId) : undefined)) : Promise.resolve(undefined),
    ]);

    return [
      `backend=${options.backendName}`,
      `owner=${options.backendOwner}`,
      `L0 conversations=${conversationCount}`,
      `L1 atoms=${atomCount}`,
      `L2 scenarios=${scenarioCount}`,
      `L3 persona=${persona ? "yes" : "no"}`,
      `offload_refs=${offloadRefCount}`,
      `offload_enabled=${options.offloadEnabled}`,
      `task_canvas=${taskCanvasPath ?? "none"}`,
      `memory_maintenance_cron=${options.maintenanceCron}`,
    ].join("\n");
  }

  async saveMemory(input: SaveMemoryInput): Promise<number> {
    const { backend } = getState(this);
    const result = await backend.upsertMemoryAtom({
      userId: input.userId,
      text: input.text,
      importance: input.importance,
      sourceConversationIds: input.sourceConversationIds,
      sourceLayer: input.sourceLayer,
    });
    return result.atom.id;
  }

  async logUserMessage(input: { chatId: string; userId: string; content: string; mode?: string }): Promise<number> {
    const { interactionLogService } = getState(this);
    return interactionLogService.logUserMessage(input);
  }

  async logAssistantMessage(input: { chatId: string; userId: string; content: string; meta?: EventMeta }): Promise<number> {
    const { interactionLogService } = getState(this);
    return interactionLogService.logAssistantMessage(input);
  }

  async logToolCall(input: {
    chatId: string;
    userId: string;
    toolName: string;
    toolCallId?: string;
    content: string;
    meta?: EventMeta;
  }): Promise<number> {
    const { interactionLogService } = getState(this);
    return interactionLogService.logToolCall(input);
  }

  async logToolResult(input: {
    chatId: string;
    userId: string;
    toolName: string;
    toolCallId?: string;
    content: string;
    offloaded: boolean;
    meta?: EventMeta;
  }): Promise<number> {
    const { interactionLogService } = getState(this);
    return interactionLogService.logToolResult(input);
  }

  async logTurn(input: LogTurnInput): Promise<number> {
    const { backend } = getState(this);
    return backend.insertConversationTurn({
      chatId: input.chatId,
      userId: input.userId,
      role: input.role,
      content: input.content,
      meta: input.meta,
    });
  }

  async listInteractionEvents(userId: string, chatId: string, limit: number): Promise<InteractionEvent[]> {
    const { interactionLogService } = getState(this);
    return interactionLogService.listInteractionEvents(userId, chatId, limit);
  }

  async recentMessages(userId: string, chatId: string, limit: number): Promise<Array<{ role: ConversationTurnRole; content: string; created_at: string; meta?: Record<string, unknown> }>> {
    const { backend } = getState(this);
    const turns = await backend.listConversationTurns(userId, chatId, limit);
    return turns.map((turn) => ({
      role: turn.role,
      content: turn.content,
      created_at: turn.createdAt,
      meta: turn.meta as Record<string, unknown>,
    }));
  }

  async offloadToolResult(input: { chatId: string; userId: string; toolName: string; args: EventMeta; rawResult: string }): Promise<OffloadToolResult> {
    const { offloadService } = getState(this);
    return offloadService.offloadToolResult({
      chatId: input.chatId,
      userId: input.userId,
      toolName: input.toolName,
      args: input.args,
      rawResult: input.rawResult,
    });
  }

  async runMaintenanceForUser(userId: string, force = false): Promise<PipelineMaintenanceResult> {
    const { pipelineCoordinator } = getState(this);
    return pipelineCoordinator.runMaintenanceForUser(userId, force);
  }
}
