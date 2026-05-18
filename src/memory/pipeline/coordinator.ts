import type { LlmProvider } from "../../agent/types";
import type { MemoryBackend } from "../core/backend";
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

export class PipelineCoordinator {
  constructor(
    private readonly backend: MemoryBackend,
    private readonly llm: LlmProvider,
  ) {}

  async runMaintenanceForUser(userId: string, force = false, options: MemoryUpdateProgressOptions = {}): Promise<PipelineMaintenanceResult> {
    const source = options.source ?? "scheduler";
    const lastCheckpoint = await this.backend.getCheckpoint(userId, L1_CHECKPOINT_KEY);
    const afterConversationId = typeof lastCheckpoint === "number"
      ? lastCheckpoint
      : Number.parseInt(String(lastCheckpoint ?? "0"), 10) || 0;

    const pendingTurns = await this.backend.listPendingConversationEvidence(userId, afterConversationId, DEFAULT_EVIDENCE_LIMIT);
    if (pendingTurns.length === 0 && !force) {
      await emitMemoryUpdateProgress(options.onProgress, { source, userId, stage: "l1", status: "skip", reason: "no_pending_turns" });
      await emitMemoryUpdateProgress(options.onProgress, { source, userId, stage: "l2", status: "skip", reason: "no_l1_work" });
      await emitMemoryUpdateProgress(options.onProgress, { source, userId, stage: "l3", status: "skip", reason: "no_scenario" });
      return { l1Created: 0, l2ScenarioId: undefined, personaUpdated: false };
    }

    await emitMemoryUpdateProgress(options.onProgress, { source, userId, stage: "l1", status: "start", pendingTurns: pendingTurns.length });
    const l1Result = pendingTurns.length === 0
      ? { createdAtoms: 0, lastConversationId: afterConversationId, checkpointAdvanced: false }
      : await runL1Pipeline(this.backend, this.llm, userId, pendingTurns);
    if (l1Result.checkpointAdvanced) {
      await this.backend.setCheckpoint(userId, L1_CHECKPOINT_KEY, l1Result.lastConversationId);
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

    const atoms = await this.backend.listMemoryAtoms(userId, DEFAULT_ATOM_LIMIT);
    if (atoms.length === 0) {
      await emitMemoryUpdateProgress(options.onProgress, { source, userId, stage: "l2", status: "skip", atomCount: 0, reason: "no_atoms" });
      await emitMemoryUpdateProgress(options.onProgress, { source, userId, stage: "l3", status: "skip", reason: "no_scenario" });
      return { l1Created: l1Result.createdAtoms, l2ScenarioId: undefined, personaUpdated: false };
    }

    await emitMemoryUpdateProgress(options.onProgress, { source, userId, stage: "l2", status: "start", atomCount: atoms.length });
    const l2Result = await runL2Pipeline(this.backend, this.llm, userId, atoms);
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
    );
    await emitMemoryUpdateProgress(options.onProgress, { source, userId, stage: "l3", status: "complete", scenarioId: l2Result.scenarioId, personaUpdated });

    return {
      l1Created: l1Result.createdAtoms,
      l2ScenarioId: l2Result.scenarioId,
      personaUpdated,
    };
  }
}
