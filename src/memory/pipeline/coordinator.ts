import type { LlmProvider } from "../../agent/types";
import type { MemoryBackend } from "../core/backend";
import { runL1Pipeline } from "./l1";
import { runL2Pipeline } from "./l2";
import { runL3Pipeline } from "./l3";

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

  async runMaintenanceForUser(userId: string, force = false): Promise<PipelineMaintenanceResult> {
    const lastCheckpoint = await this.backend.getCheckpoint(userId, L1_CHECKPOINT_KEY);
    const afterConversationId = typeof lastCheckpoint === "number"
      ? lastCheckpoint
      : Number.parseInt(String(lastCheckpoint ?? "0"), 10) || 0;

    const pendingTurns = await this.backend.listPendingConversationEvidence(userId, afterConversationId, DEFAULT_EVIDENCE_LIMIT);
    if (pendingTurns.length === 0 && !force) {
      return { l1Created: 0, l2ScenarioId: undefined, personaUpdated: false };
    }

    const l1Result = pendingTurns.length === 0
      ? { createdAtoms: 0, lastConversationId: afterConversationId, checkpointAdvanced: false }
      : await runL1Pipeline(this.backend, this.llm, userId, pendingTurns);
    if (l1Result.checkpointAdvanced) {
      await this.backend.setCheckpoint(userId, L1_CHECKPOINT_KEY, l1Result.lastConversationId);
    }

    if (!force && l1Result.createdAtoms === 0) {
      return { l1Created: 0, l2ScenarioId: undefined, personaUpdated: false };
    }

    const atoms = await this.backend.listMemoryAtoms(userId, DEFAULT_ATOM_LIMIT);
    const l2Result = await runL2Pipeline(this.backend, this.llm, userId, atoms);
    if (!l2Result) {
      return { l1Created: l1Result.createdAtoms, l2ScenarioId: undefined, personaUpdated: false };
    }

    const personaUpdated = await runL3Pipeline(
      this.backend,
      this.llm,
      userId,
      l2Result.scenarioId,
      l2Result.bodyMarkdown,
    );

    return {
      l1Created: l1Result.createdAtoms,
      l2ScenarioId: l2Result.scenarioId,
      personaUpdated,
    };
  }
}
