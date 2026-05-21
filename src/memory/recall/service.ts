import { truncateText } from "../../utils/text";
import { embedTextToVector } from "../backends/sqlite/vec";
import type { MemoryBackend } from "../core/backend";
import type { IMemoryStore, L0Record, L1Record, ProfileRecord } from "../core/store/types";
import type { ConversationTurn, MemoryAtom, MemoryRecall, MemoryRecallFallback, MemoryScenario, TaskCanvasRecall } from "../core/types";

export type TaskRecallOptions = {
  enabled: boolean;
  maxTasks: number;
  maxCanvasChars: number;
};

const defaultTaskRecallOptions: TaskRecallOptions = {
  enabled: true,
  maxTasks: 3,
  maxCanvasChars: 2200,
};

function fallbackKey(entry: MemoryRecallFallback): string {
  return [entry.missingKind, entry.missingId, entry.fallbackKind, entry.fallbackId, entry.linkType].join(":");
}

function mergeAtomResults(primary: MemoryAtom[], secondary: MemoryAtom[], limit: number): MemoryAtom[] {
  const merged = new Map<number, MemoryAtom>();

  for (const atom of [...primary, ...secondary]) {
    if (merged.has(atom.id)) {
      continue;
    }

    merged.set(atom.id, atom);
    if (merged.size >= limit) {
      break;
    }
  }

  return [...merged.values()];
}

function numericRecordId(recordId: string, fallback: number): number {
  const direct = Number.parseInt(recordId, 10);
  if (Number.isFinite(direct)) {
    return direct;
  }

  const suffix = recordId.match(/(\d+)(?!.*\d)/)?.[1];
  if (!suffix) {
    return fallback;
  }

  const parsed = Number.parseInt(suffix, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapStoreAtom(record: L1Record, index: number): MemoryAtom {
  return {
    id: numericRecordId(record.recordId, index + 1),
    userId: record.userId,
    text: record.content,
    importance: record.priority,
    sourceConversationIds: record.sourceConversationIds,
    sourceLayer: record.type === "L2" || record.type === "L3" ? record.type : "L1",
    createdAt: record.createdTime,
    updatedAt: record.updatedTime,
  };
}

function mapStoreConversation(record: L0Record, index: number): ConversationTurn {
  return {
    id: numericRecordId(record.recordId, record.timestamp || index + 1),
    chatId: record.chatId,
    userId: record.userId,
    role: record.role,
    content: record.messageText,
    meta: record.metadata ?? {},
    createdAt: record.recordedAt,
  };
}

function mergeConversationResults(primary: ConversationTurn[], secondary: ConversationTurn[], limit: number): ConversationTurn[] {
  const merged = new Map<number, ConversationTurn>();

  for (const conversation of [...primary, ...secondary]) {
    if (merged.has(conversation.id)) {
      continue;
    }

    merged.set(conversation.id, conversation);
    if (merged.size >= limit) {
      break;
    }
  }

  return [...merged.values()];
}

function profileAtomIds(profile: ProfileRecord): number[] {
  const atomIds = profile.metadata?.atomIds;
  return Array.isArray(atomIds)
    ? atomIds.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    : [];
}

function profileTitle(profile: ProfileRecord): string {
  return typeof profile.metadata?.title === "string" ? profile.metadata.title : profile.filename;
}

function mapStoreScenario(profile: ProfileRecord, index: number): MemoryScenario {
  const scenarioId = typeof profile.metadata?.scenarioId === "number"
    ? profile.metadata.scenarioId
    : numericRecordId(profile.id, index + 1);

  return {
    id: scenarioId,
    userId: profile.userId,
    title: profileTitle(profile),
    bodyMarkdown: profile.content,
    atomIds: profileAtomIds(profile),
    createdAt: new Date(profile.createdAtMs).toISOString(),
    updatedAt: new Date(profile.updatedAtMs).toISOString(),
  };
}

function latestProfile(profiles: ProfileRecord[], userId: string, type: ProfileRecord["type"]): ProfileRecord | undefined {
  return profiles
    .filter((profile) => profile.userId === userId && profile.type === type)
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs || right.id.localeCompare(left.id))[0];
}

function isMemoryStore(value: TaskRecallOptions | IMemoryStore): value is IMemoryStore {
  return "upsertL1" in value;
}

export class RecallService {
  private readonly taskRecallOptions: TaskRecallOptions;
  private readonly store?: IMemoryStore;

  constructor(
    private readonly backend: MemoryBackend,
    taskRecallOptionsOrStore: TaskRecallOptions | IMemoryStore = defaultTaskRecallOptions,
    store?: IMemoryStore,
  ) {
    if (isMemoryStore(taskRecallOptionsOrStore)) {
      this.taskRecallOptions = defaultTaskRecallOptions;
      this.store = taskRecallOptionsOrStore;
      return;
    }

    this.taskRecallOptions = taskRecallOptionsOrStore;
    this.store = store;
  }

  async recall(userId: string, query: string, maxResults: number, chatId?: string): Promise<MemoryRecall> {
    const taskCanvasLimit = Math.max(0, this.taskRecallOptions.maxTasks);
    const [personaProfile, keywordAtoms, vectorAtoms, scenarios, conversations, taskCanvas, taskCanvases] = await Promise.all([
      this.recallPersona(userId),
      this.recallStoreAtoms(userId, query, maxResults),
      this.store ? Promise.resolve([]) : this.backend.searchMemoryAtomsByVector(userId, query, maxResults),
      this.recallScenarios(userId, query, maxResults),
      this.recallStoreConversations(userId, query, maxResults),
      chatId ? this.backend.getTaskCanvasForUser(userId, chatId) : Promise.resolve(undefined),
      this.taskRecallOptions.enabled && taskCanvasLimit > 0
        ? this.backend.searchTaskCanvases(userId, query, taskCanvasLimit + 1, chatId)
        : Promise.resolve([]),
    ]);

    const atoms = mergeAtomResults(keywordAtoms, vectorAtoms, maxResults);
    const atomIds = new Set(atoms.map((atom) => atom.id));
    const scenarioAtomIds = new Set<number>();
    for (const scenario of scenarios) {
      for (const atomId of scenario.atomIds) {
        if (!atomIds.has(atomId)) {
          scenarioAtomIds.add(atomId);
        }
      }
    }

    const existingScenarioAtomIds = await this.backend.listExistingMemoryAtomIds(userId, [...scenarioAtomIds]);
    const fallbackChainMap = new Map<string, MemoryRecallFallback>();

    for (const scenario of scenarios) {
      for (const atomId of scenario.atomIds) {
        if (atomIds.has(atomId) || existingScenarioAtomIds.has(atomId)) {
          continue;
        }

        const chain = await this.backend.getFallbackChain(userId, "memory_atom", String(atomId));
        for (const entry of chain) {
          if (entry.fallbackKind !== "memory_scenario" || entry.fallbackId !== String(scenario.id)) {
            continue;
          }
          fallbackChainMap.set(fallbackKey(entry), entry);
        }
      }
    }

    return {
      persona: personaProfile?.markdown,
      atoms,
      scenarios,
      conversations,
      taskCanvas,
      taskCanvases: this.formatTaskCanvases(taskCanvases, taskCanvasLimit),
      fallbackChain: [...fallbackChainMap.values()],
    };
  }

  private async recallPersona(userId: string): Promise<{ markdown: string } | undefined> {
    if (!this.store?.pullProfiles) {
      return this.backend.getPersona(userId);
    }

    const profile = latestProfile(await this.store.pullProfiles(), userId, "l3");
    return profile ? { markdown: profile.content } : undefined;
  }

  private async recallStoreAtoms(userId: string, query: string, maxResults: number): Promise<MemoryAtom[]> {
    if (!this.store) {
      return this.backend.searchMemoryAtoms(userId, query, maxResults);
    }

    const queryEmbedding = this.store.getCapabilities().vectorSearch ? embedTextToVector(query) : undefined;
    const records = this.store.searchL1Hybrid
      ? await this.store.searchL1Hybrid({ query, queryEmbedding, topK: maxResults, userId })
      : this.store.isFtsAvailable()
        ? await this.store.searchL1Fts(query, maxResults, userId)
        : await this.store.queryL1Records({ userId, type: "L1", limit: maxResults });

    return records
      .filter((record) => record.type === "L1")
      .slice(0, maxResults)
      .map(mapStoreAtom);
  }

  private async recallScenarios(userId: string, query: string, maxResults: number): Promise<MemoryScenario[]> {
    if (!this.store?.pullProfiles) {
      return this.backend.searchMemoryScenarios(userId, query, maxResults);
    }

    const loweredQuery = query.trim().toLowerCase();
    const profiles = (await this.store.pullProfiles())
      .filter((profile) => profile.userId === userId && profile.type === "l2")
      .filter((profile) => {
        if (!loweredQuery) {
          return true;
        }

        return [profile.content, profile.filename, profileTitle(profile)]
          .some((value) => value.toLowerCase().includes(loweredQuery));
      })
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs || right.id.localeCompare(left.id))
      .slice(0, maxResults);

    return profiles.map(mapStoreScenario);
  }

  private async recallStoreConversations(userId: string, query: string, maxResults: number): Promise<ConversationTurn[]> {
    if (!this.store) {
      return this.backend.searchConversationTurns(userId, query, maxResults);
    }

    if (this.store.searchL0Hybrid) {
      return (await this.store.searchL0Hybrid({ query, queryEmbedding: embedTextToVector(query), topK: maxResults, userId }))
        .map(mapStoreConversation);
    }

    const ftsConversations = this.store.isFtsAvailable()
      ? (await this.store.searchL0Fts(query, maxResults, userId)).map(mapStoreConversation)
      : [];
    const vectorConversations = this.store.getCapabilities().vectorSearch
      ? (await this.store.searchL0Vector(embedTextToVector(query), maxResults, query, userId)).map(mapStoreConversation)
      : [];

    return mergeConversationResults(ftsConversations, vectorConversations, maxResults);
  }

  private formatTaskCanvases(taskCanvases: TaskCanvasRecall[], limit: number): TaskCanvasRecall[] {
    return taskCanvases
      .filter((task) => task.status !== "active")
      .slice(0, limit)
      .map((task) => ({
        ...task,
        canvas: truncateText(task.canvas, this.taskRecallOptions.maxCanvasChars),
      }));
  }
}
