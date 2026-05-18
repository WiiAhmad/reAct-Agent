import type { LlmProvider } from "../../agent/types";
import type { MemoryBackend } from "../core/backend";
import type { IMemoryStore } from "../core/store/types";
import { runL1Pipeline } from "./l1";
import { runL2Pipeline } from "./l2";
import { runL3Pipeline } from "./l3";
import { emitMemoryUpdateProgress, type MemoryUpdateProgressOptions } from "./progress";

export type PipelineMaintenanceResult = {
  l1Created: number;
  l2ScenarioId?: number;
  personaUpdated: boolean;
};

const L1_CHECKPOINT_KEY = "l1_last_conversation_id";
const DEFAULT_EVIDENCE_LIMIT = 80;
const DEFAULT_ATOM_LIMIT = 100;

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

export class PipelineCoordinator {
  constructor(
    private readonly backend: MemoryBackend,
    private readonly llm: LlmProvider,
    private readonly store?: IMemoryStore,
  ) {}

  async runMaintenanceForUser(userId: string, force = false, options: MemoryUpdateProgressOptions = {}): Promise<PipelineMaintenanceResult> {
    const source = options.source ?? "scheduler";
    const lastCheckpoint = await this.backend.getCheckpoint(userId, L1_CHECKPOINT_KEY);
    const afterConversationId = typeof lastCheckpoint === "number"
      ? lastCheckpoint
      : Number.parseInt(String(lastCheckpoint ?? "0"), 10) || 0;

    const storePendingTurns = this.store?.queryL0ForUser
      ? (await this.store.queryL0ForUser(userId, afterConversationId, DEFAULT_EVIDENCE_LIMIT)).map((row) => ({
        id: numericRecordId(row.recordId, row.timestamp),
        chatId: row.chatId,
        userId: row.userId,
        role: row.role,
        content: row.messageText,
        meta: row.metadata ?? {},
        createdAt: row.recordedAt,
      }))
      : undefined;
    const pendingTurns = storePendingTurns && storePendingTurns.length > 0
      ? storePendingTurns
      : await this.backend.listPendingConversationEvidence(userId, afterConversationId, DEFAULT_EVIDENCE_LIMIT);
    if (pendingTurns.length === 0 && !force) {
      await emitMemoryUpdateProgress(options.onProgress, { source, userId, stage: "l1", status: "skip", reason: "no_pending_turns" });
      await emitMemoryUpdateProgress(options.onProgress, { source, userId, stage: "l2", status: "skip", reason: "no_l1_work" });
      await emitMemoryUpdateProgress(options.onProgress, { source, userId, stage: "l3", status: "skip", reason: "no_scenario" });
      return { l1Created: 0, l2ScenarioId: undefined, personaUpdated: false };
    }

    await emitMemoryUpdateProgress(options.onProgress, { source, userId, stage: "l1", status: "start", pendingTurns: pendingTurns.length });
    const l1Result = pendingTurns.length === 0
      ? { createdAtoms: 0, lastConversationId: afterConversationId, checkpointAdvanced: false }
      : await runL1Pipeline(this.backend, this.llm, userId, pendingTurns, this.store);
    if (l1Result.checkpointAdvanced) {
      const nextCheckpoint = this.store?.queryL0ForUser
        ? Date.parse(pendingTurns.at(-1)?.createdAt ?? "") || afterConversationId
        : l1Result.lastConversationId;
      await this.backend.setCheckpoint(userId, L1_CHECKPOINT_KEY, nextCheckpoint);
    }
    await emitMemoryUpdateProgress(options.onProgress, {
      source,
      userId,
      stage: "l1",
      status: "complete",
      pendingTurns: pendingTurns.length,
      createdAtoms: l1Result.createdAtoms,
      checkpointAdvanced: l1Result.checkpointAdvanced,
    });

    if (!force && l1Result.createdAtoms === 0) {
      await emitMemoryUpdateProgress(options.onProgress, { source, userId, stage: "l2", status: "skip", reason: "no_new_atoms" });
      await emitMemoryUpdateProgress(options.onProgress, { source, userId, stage: "l3", status: "skip", reason: "no_scenario" });
      return { l1Created: 0, l2ScenarioId: undefined, personaUpdated: false };
    }

    const atoms = this.store
      ? (await this.store.queryL1Records({ userId, type: "L1", limit: DEFAULT_ATOM_LIMIT })).map((record) => ({
        id: Number.parseInt(record.recordId, 10) || record.sourceConversationIds[0] || 0,
        userId: record.userId,
        text: record.content,
        importance: record.priority,
        sourceConversationIds: record.sourceConversationIds,
        sourceLayer: "L1" as const,
        createdAt: record.createdTime,
        updatedAt: record.updatedTime,
      }))
      : await this.backend.listMemoryAtoms(userId, DEFAULT_ATOM_LIMIT);
    if (atoms.length === 0) {
      await emitMemoryUpdateProgress(options.onProgress, { source, userId, stage: "l2", status: "skip", atomCount: 0, reason: "no_atoms" });
      await emitMemoryUpdateProgress(options.onProgress, { source, userId, stage: "l3", status: "skip", reason: "no_scenario" });
      return { l1Created: l1Result.createdAtoms, l2ScenarioId: undefined, personaUpdated: false };
    }

    await emitMemoryUpdateProgress(options.onProgress, { source, userId, stage: "l2", status: "start", atomCount: atoms.length });
    const l2Result = await runL2Pipeline(this.backend, this.llm, userId, atoms, this.store);
    if (!l2Result) {
      await emitMemoryUpdateProgress(options.onProgress, { source, userId, stage: "l2", status: "skip", atomCount: atoms.length, reason: "no_scenario" });
      await emitMemoryUpdateProgress(options.onProgress, { source, userId, stage: "l3", status: "skip", reason: "no_scenario" });
      return { l1Created: l1Result.createdAtoms, l2ScenarioId: undefined, personaUpdated: false };
    }
    await emitMemoryUpdateProgress(options.onProgress, { source, userId, stage: "l2", status: "complete", atomCount: atoms.length, scenarioId: l2Result.scenarioId });

    await emitMemoryUpdateProgress(options.onProgress, { source, userId, stage: "l3", status: "start", scenarioId: l2Result.scenarioId });
    const personaUpdated = await runL3Pipeline(
      this.backend,
      this.llm,
      userId,
      l2Result.scenarioId,
      l2Result.bodyMarkdown,
      this.store,
    );
    await emitMemoryUpdateProgress(options.onProgress, { source, userId, stage: "l3", status: "complete", scenarioId: l2Result.scenarioId, personaUpdated });

    return {
      l1Created: l1Result.createdAtoms,
      l2ScenarioId: l2Result.scenarioId,
      personaUpdated,
    };
  }
}
