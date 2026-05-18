import type { Database } from "bun:sqlite";
import type { LlmProvider } from "../../agent/types";
import { SqliteMemoryBackend } from "../backends/sqlite/backend";
import { MemoryService } from "../core/service";
import { InteractionLogService } from "../events/service";
import { OffloadService } from "../offload/service";
import { PipelineCoordinator } from "../pipeline/coordinator";
import { RecallService } from "../recall/service";

type MemoryServiceFactoryConfig = {
  storage: {
    dataDir: string;
    memoryRefsDir: string;
    memoryCanvasDir: string;
    memoryJsonlExportDir: string;
    historyDir: string;
    memoryTaskCanvasDir?: string;
    memoryGeneratedSkillsDir?: string;
  };
  memory: {
    maintenanceCron: string;
    offloadEnabled: boolean;
    offloadMinChars: number;
    offloadSummaryChars: number;
    sqliteVecEnabled: boolean;
    jsonlExportEnabled: boolean;
    l15?: {
      enabled: boolean;
      mode: "rules" | "llm" | "hybrid";
      recentMessages: number;
      historyTaskLimit: number;
      maxCanvasChars: number;
      safeFallback: "short";
    };
    l4?: {
      enabled: boolean;
      mode: "local";
      requireCompletedTask: boolean;
      maxEvidenceEntries: number;
      maxCanvasChars: number;
      maxSkillChars: number;
    };
  };
};

const defaultL15 = {
  enabled: true,
  mode: "hybrid" as const,
  recentMessages: 6,
  historyTaskLimit: 10,
  maxCanvasChars: 12000,
  safeFallback: "short" as const,
};

const defaultL4 = {
  enabled: true,
  mode: "local" as const,
  requireCompletedTask: false,
  maxEvidenceEntries: 80,
  maxCanvasChars: 20000,
  maxSkillChars: 20000,
};

export async function createMemoryService(db: Database, llm: LlmProvider, config: MemoryServiceFactoryConfig): Promise<MemoryService> {
  const generatedSkillsDir = config.storage.memoryGeneratedSkillsDir ?? `${config.storage.dataDir}/memory/skills`;
  const backend = new SqliteMemoryBackend(db, {
    dataDir: config.storage.dataDir,
    refsDir: config.storage.memoryRefsDir,
    canvasDir: config.storage.memoryCanvasDir,
    taskCanvasDir: config.storage.memoryTaskCanvasDir,
    generatedSkillsDir,
    sqliteVecEnabled: config.memory.sqliteVecEnabled,
  });
  await backend.init();

  const recallService = new RecallService(backend);
  const interactionLogService = new InteractionLogService(backend, {
    enabled: config.memory.jsonlExportEnabled,
    exportDir: config.storage.memoryJsonlExportDir,
    historyDir: config.storage.historyDir,
  });
  const offloadService = new OffloadService(backend, {
    offloadMinChars: config.memory.offloadEnabled ? config.memory.offloadMinChars : Number.MAX_SAFE_INTEGER,
    offloadSummaryChars: config.memory.offloadSummaryChars,
  });
  const pipelineCoordinator = new PipelineCoordinator(backend, llm);

  return new MemoryService(
    backend,
    llm,
    {
      dataDir: config.storage.dataDir,
      backendName: "sqlite",
      backendOwner: "project-owned memory backend",
      maintenanceCron: config.memory.maintenanceCron,
      offloadEnabled: config.memory.offloadEnabled,
      l15: config.memory.l15 ?? defaultL15,
      l4: config.memory.l4 ?? defaultL4,
      generatedSkillsDir,
    },
    recallService,
    offloadService,
    pipelineCoordinator,
    interactionLogService,
  );
}
