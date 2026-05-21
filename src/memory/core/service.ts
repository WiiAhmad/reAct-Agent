import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AgentMessage, LlmProvider } from "../../agent/types";
import { emitTrace, NEW_MEMORY_STACK_TAG } from "../../logging/helpers";
import type { RuntimeTraceEmitter } from "../../logging/types";
import { generateL4Skill, validateGeneratedSkill, writeDraftSkill } from "../offload/l4";
import { truncateText } from "../../utils/text";
import type { MemoryBackend } from "./backend";
import { canonicalizeMemoryAtomText, mergeNumberSets } from "./canonical";
import type { IMemoryStore, L1Record, ProfileRecord } from "./store/types";
import type { ConversationTurnRole, EventMeta, InteractionEvent, TaskCanvas, TaskCanvasRecall } from "./types";
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
  taskCanvases: TaskCanvasRecall[];
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
  taskRecall: {
    enabled: boolean;
    maxTasks: number;
    maxCanvasChars: number;
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

function isFileAlreadyExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EEXIST");
}

type MemoryServiceState = {
  backend: MemoryBackend;
  recallService: RecallService;
  interactionLogService: InteractionLogService;
  offloadService: OffloadService;
  pipelineCoordinator: PipelineCoordinator;
  store?: IMemoryStore;
  llm: LlmProvider;
  options: MemoryServiceOptions;
  trace?: RuntimeTraceEmitter;
};

const memoryServiceState = new WeakMap<MemoryService, MemoryServiceState>();

function sessionKey(chatId: string, userId: string): string {
  return `telegram:${chatId}:${userId}`;
}

function profileCount(profiles: ProfileRecord[], userId: string, type: ProfileRecord["type"]): number {
  return profiles.filter((profile) => profile.userId === userId && profile.type === type).length;
}

function storeL1RecordId(userId: string, canonicalText: string): string {
  const digest = createHash("sha256").update(`${userId}\0${canonicalText}`).digest("hex").slice(0, 24);
  return `store:l1:${digest}`;
}

async function buildGenericStoreL1Record(store: IMemoryStore, input: SaveMemoryInput): Promise<L1Record> {
  const canonicalText = canonicalizeMemoryAtomText(input.text);
  if (!canonicalText) {
    throw new Error("Memory atom canonical text cannot be empty");
  }

  const existing = (await store.queryL1Records({ userId: input.userId, type: input.sourceLayer ?? "L1", limit: Number.MAX_SAFE_INTEGER }))
    .find((record) => canonicalizeMemoryAtomText(record.content) === canonicalText);
  const now = new Date().toISOString();

  return {
    recordId: existing?.recordId ?? storeL1RecordId(input.userId, canonicalText),
    userId: input.userId,
    sessionKey: existing?.sessionKey ?? `generic:${input.userId}`,
    sessionId: existing?.sessionId ?? "generic",
    content: input.text,
    type: input.sourceLayer ?? "L1",
    priority: Math.max(existing?.priority ?? 0, input.importance ?? 3),
    sceneName: existing?.sceneName ?? "generic memory",
    timestampStr: now,
    timestampStart: existing?.timestampStart ?? now,
    timestampEnd: now,
    sourceConversationIds: mergeNumberSets(existing?.sourceConversationIds ?? [], input.sourceConversationIds ?? []),
    metadata: { ...(existing?.metadata ?? {}), source: "MemoryService.saveMemory", canonicalText },
    createdTime: existing?.createdTime ?? now,
    updatedTime: now,
  };
}

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
    recallService = new RecallService(backend, options.taskRecall),
    offloadService = new OffloadService(backend, {
      offloadMinChars: 2500,
      offloadSummaryChars: 900,
      l1: options.l1,
      l2: options.l2,
      jsonlEnabled: false,
    }, llm),
    pipelineCoordinator = new PipelineCoordinator(backend, llm),
    interactionLogService = new InteractionLogService(backend, {
      enabled: false,
      historyDir: resolve(options.dataDir, "history"),
    }),
    store?: IMemoryStore,
    trace?: RuntimeTraceEmitter,
  ) {
    memoryServiceState.set(this, {
      backend,
      recallService,
      interactionLogService,
      offloadService,
      pipelineCoordinator,
      store,
      llm,
      options,
      trace,
    });
  }

  async recall(userId: string, query: string, maxResults: number, chatId?: string): Promise<MemoryServiceRecall> {
    const { recallService, interactionLogService, store, trace } = getState(this);
    emitTrace(trace, {
      minLevel: 2,
      source: "memory",
      event: "recall.start",
      tags: [NEW_MEMORY_STACK_TAG],
      chatId,
      userId,
      payload: { queryLength: query.length, maxResults },
    });
    const [recall, conversationRows] = await Promise.all([
      recallService.recall(userId, query, maxResults, chatId),
      store ? Promise.resolve([]) : interactionLogService.searchConversations(userId, query, maxResults, chatId),
    ]);
    const conversations = recall.conversations.length > 0
      ? recall.conversations.map((conversation) => ({
        id: conversation.id,
        role: conversation.role,
        content: conversation.content,
        createdAt: conversation.createdAt,
        created_at: conversation.createdAt,
      }))
      : conversationRows.map((conversation) => ({
        id: conversation.id,
        role: conversation.role,
        content: conversation.content,
        createdAt: conversation.created_at,
        created_at: conversation.created_at,
      }));

    const result = {
      persona: recall.persona,
      atoms: recall.atoms,
      scenarios: recall.scenarios.map((scenario) => ({
        id: scenario.id,
        title: scenario.title,
        bodyMarkdown: scenario.bodyMarkdown,
        body_markdown: scenario.bodyMarkdown,
      })),
      conversations,
      taskCanvas: recall.taskCanvas,
      taskCanvases: recall.taskCanvases,
    };
    emitTrace(trace, {
      minLevel: 2,
      source: "memory",
      event: "recall.complete",
      tags: [NEW_MEMORY_STACK_TAG],
      chatId,
      userId,
      payload: {
        atomCount: result.atoms.length,
        scenarioCount: result.scenarios.length,
        conversationCount: result.conversations.length,
        taskCanvasCount: result.taskCanvases.length,
      },
    });
    return result;
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
    const { backend, interactionLogService, options, store } = getState(this);
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
    const profilesPromise = store?.pullProfiles ? store.pullProfiles() : Promise.resolve<ProfileRecord[] | undefined>(undefined);
    const l0CountPromise = store
      ? (chatId
        ? Promise.resolve(store.queryL0ForL1(sessionKey(chatId, userId), 0, Number.MAX_SAFE_INTEGER)).then((rows) => rows.length)
        : store.countL0(userId))
      : interactionLogService.countConversations(userId, chatId);
    const [conversationCount, atomCount, backendScenarioCount, offloadRefCount, generatedSkillCount, backendPersona, resolvedTaskCanvasPath, profiles] = await Promise.all([
      l0CountPromise,
      store ? store.countL1(userId) : backend.countMemoryAtoms(userId),
      backend.countMemoryScenarios(userId),
      backend.countOffloadRefs(userId),
      backend.countGeneratedSkills(userId),
      backend.getPersona(userId),
      taskCanvasPath(),
      profilesPromise,
    ]);
    const scenarioCount = profiles ? profileCount(profiles, userId, "l2") : backendScenarioCount;
    const hasPersona = profiles ? profileCount(profiles, userId, "l3") > 0 : Boolean(backendPersona);

    return [
      `backend=${options.backendName}`,
      `owner=${options.backendOwner}`,
      `L0 conversations=${conversationCount}`,
      `L1 atoms=${atomCount}`,
      `L2 scenarios=${scenarioCount}`,
      `L3 persona=${hasPersona ? "yes" : "no"}`,
      `offload_refs=${offloadRefCount}`,
      `offload_enabled=${options.offloadEnabled}`,
      `L1.5 enabled=${options.l15.enabled}`,
      `L1.5 mode=${options.l15.mode}`,
      `L1 semantic evidence=${options.l1.enabled ? options.l1.mode : "disabled"}`,
      `L2 semantic Mermaid=${options.l2.enabled ? options.l2.mode : "disabled"}`,
      `Task-aware recall=${options.taskRecall.enabled ? `max_tasks=${options.taskRecall.maxTasks}` : "disabled"}`,
      `L4 enabled=${options.l4.enabled}`,
      `generated_skill_drafts=${generatedSkillCount}`,
      `task_canvas=${resolvedTaskCanvasPath ?? "none"}`,
      `memory_maintenance_cron=${options.maintenanceCron}`,
    ].join("\n");
  }

  async saveMemory(input: SaveMemoryInput): Promise<number> {
    const { backend, store } = getState(this);
    let stored = false;

    if (store) {
      stored = await store.upsertL1(await buildGenericStoreL1Record(store, input));
    }

    const result = await backend.upsertMemoryAtom({
      userId: input.userId,
      text: input.text,
      importance: input.importance,
      sourceConversationIds: input.sourceConversationIds,
      sourceLayer: input.sourceLayer,
    });

    if (store && !stored) {
      await store.upsertL1({
        recordId: `legacy:l1:${result.atom.id}`,
        userId: result.atom.userId,
        sessionKey: `generic:${result.atom.userId}`,
        sessionId: "generic",
        content: result.atom.text,
        type: result.atom.sourceLayer,
        priority: result.atom.importance,
        sceneName: "generic memory",
        timestampStr: result.atom.updatedAt,
        timestampStart: result.atom.createdAt,
        timestampEnd: result.atom.updatedAt,
        sourceConversationIds: result.atom.sourceConversationIds,
        metadata: { source: "MemoryService.saveMemory" },
        createdTime: result.atom.createdAt,
        updatedTime: result.atom.updatedAt,
      });
    }

    return result.atom.id;
  }

  async logUserMessage(input: { chatId: string; userId: string; content: string; mode?: string }): Promise<number> {
    const { interactionLogService, store } = getState(this);
    const eventId = await interactionLogService.logUserMessage(input);
    if (store) {
      const recordedAt = new Date().toISOString();
      await store.upsertL0({
        recordId: `interaction:l0:${eventId}`,
        sessionKey: sessionKey(input.chatId, input.userId),
        sessionId: input.chatId,
        chatId: input.chatId,
        userId: input.userId,
        role: "user",
        messageText: input.content,
        recordedAt,
        timestamp: Date.parse(recordedAt) || eventId,
        metadata: input.mode ? { mode: input.mode } : {},
      });
    }
    return eventId;
  }

  async logAssistantMessage(input: { chatId: string; userId: string; content: string; meta?: EventMeta }): Promise<number> {
    const { interactionLogService, store } = getState(this);
    const eventId = await interactionLogService.logAssistantMessage(input);
    if (store) {
      const recordedAt = new Date().toISOString();
      await store.upsertL0({
        recordId: `interaction:l0:${eventId}`,
        sessionKey: sessionKey(input.chatId, input.userId),
        sessionId: input.chatId,
        chatId: input.chatId,
        userId: input.userId,
        role: "assistant",
        messageText: input.content,
        recordedAt,
        timestamp: Date.parse(recordedAt) || eventId,
        metadata: input.meta,
      });
    }
    return eventId;
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
    const { backend, store } = getState(this);
    const createdAt = new Date().toISOString();
    const id = await backend.insertConversationTurn({
      chatId: input.chatId,
      userId: input.userId,
      role: input.role,
      content: input.content,
      meta: input.meta,
      createdAt,
    });

    if (store) {
      await store.upsertL0({
        recordId: `legacy:l0:${id}`,
        sessionKey: sessionKey(input.chatId, input.userId),
        sessionId: input.chatId,
        chatId: input.chatId,
        userId: input.userId,
        role: input.role,
        messageText: input.content,
        recordedAt: createdAt,
        timestamp: Date.parse(createdAt) || id,
        metadata: input.meta,
      });
    }

    return id;
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
    const activeCanvas = activeTask ? await backend.getTaskCanvasForUser(input.userId, input.chatId) : undefined;
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
    const taskScopedTurn = Boolean(taskId && (judgment.isLongTask || judgment.isContinuation || judgment.taskCompleted));

    await backend.insertTaskBoundary({
      chatId: input.chatId,
      userId: input.userId,
      startNodeSequence: 0,
      result: taskScopedTurn ? "long" : "short",
      taskId: taskScopedTurn ? taskId : undefined,
    });

    return { judgment, taskId: taskScopedTurn ? taskId : undefined };
  }

  async offloadToolResult(input: { chatId: string; userId: string; taskId?: number; toolCallId?: string; toolName: string; args: EventMeta; rawResult: string }): Promise<OffloadToolResult> {
    const { offloadService } = getState(this);
    return offloadService.offloadToolResult({
      chatId: input.chatId,
      userId: input.userId,
      taskId: input.taskId,
      toolCallId: input.toolCallId,
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

    const existingDraftCount = await backend.countGeneratedSkillsByName(input.userId, generated.skillName);
    let draft: Awaited<ReturnType<typeof writeDraftSkill>> | undefined;
    for (let draftNumber = existingDraftCount + 1; !draft; draftNumber += 1) {
      const draftDirectory = `draft-${String(draftNumber).padStart(3, "0")}`;
      try {
        draft = await writeDraftSkill(options.generatedSkillsDir, generated, draftDirectory);
      } catch (error) {
        if (isFileAlreadyExistsError(error)) continue;
        throw error;
      }
    }
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
