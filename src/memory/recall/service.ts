import { truncateText } from "../../utils/text";
import type { MemoryBackend } from "../core/backend";
import type { MemoryAtom, MemoryRecall, MemoryRecallFallback, TaskCanvasRecall } from "../core/types";

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

export class RecallService {
  constructor(
    private readonly backend: MemoryBackend,
    private readonly taskRecallOptions: TaskRecallOptions = defaultTaskRecallOptions,
  ) {}

  async recall(userId: string, query: string, maxResults: number, chatId?: string): Promise<MemoryRecall> {
    const taskCanvasLimit = Math.max(0, this.taskRecallOptions.maxTasks);
    const [personaProfile, keywordAtoms, vectorAtoms, scenarios, conversations, taskCanvas, taskCanvases] = await Promise.all([
      this.backend.getPersona(userId),
      this.backend.searchMemoryAtoms(userId, query, maxResults),
      this.backend.searchMemoryAtomsByVector(userId, query, maxResults),
      this.backend.searchMemoryScenarios(userId, query, maxResults),
      this.backend.searchConversationTurns(userId, query, maxResults),
      chatId ? this.backend.getTaskCanvas(chatId) : Promise.resolve(undefined),
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
