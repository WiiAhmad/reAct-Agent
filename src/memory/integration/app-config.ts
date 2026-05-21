import { parseConfig } from "../../config";

export type RuntimeConfig = ReturnType<typeof parseConfig>;

export function buildMemoryServiceFactoryConfig(runtime: RuntimeConfig) {
  return {
    storage: {
      dataDir: runtime.storage.dataDir,
      memoryRefsDir: runtime.storage.memoryRefsDir,
      memoryCanvasDir: runtime.storage.memoryCanvasDir,
      memoryJsonlExportDir: runtime.storage.memoryJsonlExportDir,
      historyDir: runtime.storage.historyDir,
      memoryTaskCanvasDir: runtime.storage.memoryTaskCanvasDir,
      memoryGeneratedSkillsDir: runtime.storage.memoryGeneratedSkillsDir,
    },
    memory: {
      maintenanceCron: runtime.memory.maintenanceCron,
      offloadEnabled: runtime.memory.offloadEnabled,
      offloadMinChars: runtime.memory.offloadMinChars,
      offloadSummaryChars: runtime.memory.offloadSummaryChars,
      sqliteVecEnabled: runtime.memory.sqliteVecEnabled,
      jsonlExportEnabled: runtime.memory.jsonlExportEnabled,
      l15: runtime.memory.l15,
      l1: runtime.memory.l1,
      l2: runtime.memory.l2,
      taskRecall: runtime.memory.taskRecall,
      l4: runtime.memory.l4,
    },
  };
}
