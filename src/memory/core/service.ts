import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AgentMessage, LlmProvider } from "../../agent/types";
import { generateL4Skill, validateGeneratedSkill, writeDraftSkill } from "../offload/l4";
import { truncateText } from "../../utils/text";
import type { MemoryBackend } from "./backend";
import type { ConversationTurnRole, EventMeta, InteractionEvent, TaskCanvas } from "./types";
import { InteractionLogService } from "../events/service";
import { OffloadService, type OffloadToolResult } from "../offload/service";
import { runL15Judgment } from "../offload/l15";
import type { L15JudgmentResult } from "../offload/types";
import { PipelineCoordinator, type PipelineMaintenanceResult } from "../pipeline/coordinator";
import type { MemoryUpdateProgressOptions } from "../pipeline/progress";
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
  l15: {
    enabled: boolean;
    mode: "rules" | "llm" | "hybrid";
    recentMessages: number;
    historyTaskLimit: number;
    maxCanvasChars: number;
    safeFallback: "short";
  };
  l4: {
    enabled: boolean;
    mode: "local";
    requireCompletedTask: boolean;
    maxEvidenceEntries: number;
    maxCanvasChars: number;
    maxSkillChars: number;
  };
  generatedSkillsDir: string;
};

export type JudgeTaskTurnInput = {
  chatId: string;
  userId: string;
  latestUserMessage: string;
  sourceConversationId?: number;
};

export type JudgeTaskTurnResult = {
  judgment: L15JudgmentResult;
  taskId?: number;
};

export type GenerateSkillDraftInput = {
  chatId: string;
  userId: string;
  taskId: number;
  skillFocus?: string;
};

export type GenerateSkillDraftResult = { ok: true; skillName: string; filePath: string } | { ok: false; reason: string };

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
  llm: LlmProvider;
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
      historyDir: resolve(options.dataDir, "history"),
    }),
  ) {
    memoryServiceState.set(this, {
      backend,
      recallService,
      interactionLogService,
      offloadService,
      pipelineCoordinator,
      llm,
      options,
    });
  }

  async recall(userId: string, query: string, maxResults: number, chatId?: string): Promise<MemoryServiceRecall> {
    const { recallService, interactionLogService } = getState(this);
    const [recall, conversationRows] = await Promise.all([
      recallService.recall(userId, query, maxResults, chatId),
      interactionLogService.searchConversations(userId, query, maxResults, chatId),
    ]);
    return {
      persona: recall.persona,
      atoms: recall.atoms,
      scenarios: recall.scenarios.map((scenario) => ({
        id: scenario.id,
        title: scenario.title,
        bodyMarkdown: scenario.bodyMarkdown,
        body_markdown: scenario.bodyMarkdown,
      })),
      conversations: conversationRows.map((conversation) => ({
        id: conversation.id,
        role: conversation.role,
        content: conversation.content,
        createdAt: conversation.created_at,
        created_at: conversation.created_at,
      })),
      taskCanvas: recall.taskCanvas,
    };
  }

  async searchConversations(userId: string, query: string, limit = 5): Promise<string> {
    const { interactionLogService } = getState(this);
    const conversations = await interactionLogService.searchConversations(userId, query, limit);
    if (conversations.length === 0) {
      return "No matching conversation found.";
    }

    return conversations
      .map((conversation) => {
        return `#${conversation.id} [${conversation.created_at}] ${conversation.role}: ${truncateText(conversation.content, 800)}`;
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
    const { backend, interactionLogService, options } = getState(this);
    const taskCanvasPath = async () => {
      if (!chatId) {
        return undefined;
      }
      const activeTask = await backend.getActiveTaskCanvas(userId, chatId);
      if (activeTask) {
        const activePath = await backend.getTaskCanvasFilePath(activeTask.id);
        if (activePath?.relativePath) {
          return activePath.relativePath;
        }
        if (activeTask.filePath) {
          return activeTask.filePath;
        }
      }
      const canvas = await backend.getTaskCanvas(chatId);
      return canvas ? backend.getTaskCanvasPath(chatId) : undefined;
    };
    const [conversationCount, atomCount, scenarioCount, offloadRefCount, generatedSkillCount, persona, resolvedTaskCanvasPath] = await Promise.all([
      interactionLogService.countConversations(userId, chatId),
      backend.countMemoryAtoms(userId),
      backend.countMemoryScenarios(userId),
      backend.countOffloadRefs(userId),
      backend.countGeneratedSkills(userId),
      backend.getPersona(userId),
      taskCanvasPath(),
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
      `L1.5 enabled=${options.l15.enabled}`,
      `L1.5 mode=${options.l15.mode}`,
      `L4 enabled=${options.l4.enabled}`,
      `generated_skill_drafts=${generatedSkillCount}`,
      `task_canvas=${resolvedTaskCanvasPath ?? "none"}`,
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
    const { interactionLogService } = getState(this);
    return interactionLogService.recentMessages(userId, chatId, limit);
  }

  async listTaskCanvases(userId: string, chatId: string, limit = 10): Promise<TaskCanvas[]> {
    const { backend } = getState(this);
    return backend.listTaskCanvases(userId, chatId, limit);
  }

  async countTaskCanvases(userId: string, chatId: string): Promise<number> {
    const { backend } = getState(this);
    return (await backend.listTaskCanvases(userId, chatId, Number.MAX_SAFE_INTEGER)).length;
  }

  async countGeneratedSkills(userId: string): Promise<number> {
    const { backend } = getState(this);
    return backend.countGeneratedSkills(userId);
  }

  async listGeneratedSkills(userId: string, limit = 10) {
    const { backend } = getState(this);
    return backend.listGeneratedSkills(userId, limit);
  }

  async judgeTaskTurn(input: JudgeTaskTurnInput): Promise<JudgeTaskTurnResult> {
    const { backend, interactionLogService, llm, options } = getState(this);
    const fallback: L15JudgmentResult = { taskCompleted: false, isLongTask: false, isContinuation: false, source: "fallback" };

    if (!options.l15.enabled) {
      return { judgment: fallback };
    }

    const [turns, activeTask, historicalTasks] = await Promise.all([
      interactionLogService.recentMessages(input.userId, input.chatId, options.l15.recentMessages),
      backend.getActiveTaskCanvas(input.userId, input.chatId),
      backend.listTaskCanvases(input.userId, input.chatId, options.l15.historyTaskLimit),
    ]);
    const activeCanvas = activeTask ? await backend.getTaskCanvas(input.chatId) : undefined;
    const recentMessages = turns
      .filter((turn) => turn.role === "user" || turn.role === "assistant")
      .map((turn) => ({ role: turn.role, content: turn.content }) as AgentMessage);

    const judgment = await runL15Judgment({
      latestUserMessage: input.latestUserMessage,
      activeTask: activeTask ? { id: activeTask.id, label: activeTask.label, status: activeTask.status, canvas: activeCanvas } : undefined,
      historicalTasks: historicalTasks.map((task) => ({ id: task.id, label: task.label, status: task.status })),
      llm,
      mode: options.l15.mode,
      recentMessages,
      maxCanvasChars: options.l15.maxCanvasChars,
    });

    let taskId = judgment.selectedTaskId;
    if (judgment.taskCompleted && activeTask && !judgment.isLongTask) {
      await backend.updateTaskCanvasStatus(activeTask.id, "completed");
      taskId = activeTask.id;
    } else if (judgment.isContinuation && judgment.selectedTaskId) {
      await backend.updateTaskCanvasStatus(judgment.selectedTaskId, "active");
      taskId = judgment.selectedTaskId;
    } else if (judgment.isLongTask && !taskId && judgment.newTaskLabel) {
      const task = await backend.createTaskCanvas({
        chatId: input.chatId,
        userId: input.userId,
        label: judgment.newTaskLabel,
        status: "active",
      });
      taskId = task.id;
    }

    await backend.recordL15Judgment({
      chatId: input.chatId,
      userId: input.userId,
      sourceConversationId: input.sourceConversationId,
      taskCompleted: judgment.taskCompleted,
      isLongTask: judgment.isLongTask,
      isContinuation: judgment.isContinuation,
      selectedTaskId: taskId,
      newTaskLabel: judgment.newTaskLabel,
      source: judgment.source,
    });
    await backend.insertTaskBoundary({
      chatId: input.chatId,
      userId: input.userId,
      startNodeSequence: 0,
      result: judgment.isLongTask && taskId ? "long" : "short",
      taskId: judgment.isLongTask && taskId ? taskId : undefined,
    });

    return { judgment, taskId: judgment.isLongTask ? taskId : undefined };
  }

  async offloadToolResult(input: { chatId: string; userId: string; taskId?: number; toolName: string; args: EventMeta; rawResult: string }): Promise<OffloadToolResult> {
    const { offloadService } = getState(this);
    return offloadService.offloadToolResult({
      chatId: input.chatId,
      userId: input.userId,
      taskId: input.taskId,
      toolName: input.toolName,
      args: input.args,
      rawResult: input.rawResult,
    });
  }

  async generateSkillDraft(input: GenerateSkillDraftInput): Promise<GenerateSkillDraftResult> {
    const { backend, llm, options } = getState(this);
    if (!options.l4.enabled) {
      return { ok: false, reason: "L4 skill generation is disabled." };
    }

    const task = await backend.getTaskCanvasById(input.userId, input.taskId);
    if (!task || task.chatId !== input.chatId) {
      return { ok: false, reason: "Task canvas not found." };
    }
    if (options.l4.requireCompletedTask && task.status !== "completed") {
      return { ok: false, reason: "Task must be completed before skill generation." };
    }

    let canvas = "";
    try {
      canvas = await readFile(resolve(options.dataDir, task.filePath), "utf8");
    } catch {
      return { ok: false, reason: "Task canvas is empty." };
    }
    if (!canvas.trim()) {
      return { ok: false, reason: "Task canvas is empty." };
    }

    const nodes = await backend.listTaskGraphNodesForTask(task.id, options.l4.maxEvidenceEntries);
    const skillFocus = input.skillFocus?.trim() || null;
    const generated = await generateL4Skill(llm, {
      taskId: task.id,
      mmdFilename: task.filePath,
      mmdContent: canvas,
      offloadEntries: nodes.map((node) => ({
        nodeId: node.nodeId,
        toolName: node.toolName,
        args: node.args,
        summary: node.summary,
        resultRef: node.resultRef,
        createdAt: node.createdAt,
      })),
      skillFocus,
      maxCanvasChars: options.l4.maxCanvasChars,
      maxSkillChars: options.l4.maxSkillChars,
    });
    if (!generated) {
      return { ok: false, reason: "L4 response could not be parsed." };
    }

    const validation = validateGeneratedSkill(generated, { chatId: input.chatId, userId: input.userId });
    if (!validation.ok) {
      return validation;
    }

    const draft = await writeDraftSkill(options.generatedSkillsDir, generated);
    await backend.insertGeneratedSkill({
      sourceTaskId: task.id,
      chatId: input.chatId,
      userId: input.userId,
      skillName: generated.skillName,
      skillDescription: generated.skillDescription,
      skillFocus: skillFocus ?? undefined,
      skillFilePath: draft.relativePath,
      sourceCanvasFilePath: task.filePath,
      sourceNodeIds: nodes.map((node) => node.nodeId),
      sourceEvidenceIds: nodes.map((node) => node.resultRef ?? node.nodeId),
      status: "draft",
    });

    return { ok: true, skillName: generated.skillName, filePath: draft.relativePath };
  }

  async runMaintenanceForUser(userId: string, force = false, options: MemoryUpdateProgressOptions = {}): Promise<PipelineMaintenanceResult> {
    const { pipelineCoordinator } = getState(this);
    return pipelineCoordinator.runMaintenanceForUser(userId, force, options);
  }
}
