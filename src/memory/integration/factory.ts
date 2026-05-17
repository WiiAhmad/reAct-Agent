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
  };
  memory: {
    maintenanceCron: string;
    offloadEnabled: boolean;
    offloadMinChars: number;
    offloadSummaryChars: number;
    sqliteVecEnabled: boolean;
    jsonlExportEnabled: boolean;
  };
};

export async function createMemoryService(db: Database, llm: LlmProvider, config: MemoryServiceFactoryConfig): Promise<MemoryService> {
  const backend = new SqliteMemoryBackend(db, {
    dataDir: config.storage.dataDir,
    refsDir: config.storage.memoryRefsDir,
    canvasDir: config.storage.memoryCanvasDir,
    sqliteVecEnabled: config.memory.sqliteVecEnabled,
  });
  await backend.init();

  const recallService = new RecallService(backend);
  const interactionLogService = new InteractionLogService(backend, {
    enabled: config.memory.jsonlExportEnabled,
    exportDir: config.storage.memoryJsonlExportDir,
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
    },
    recallService,
    offloadService,
    pipelineCoordinator,
    interactionLogService,
  );
}
