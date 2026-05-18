import { assertRuntimeConfig, config, getRuntimeConfigSummary } from "./config";
import { db, initDb } from "./db";
import { createLlmProvider } from "./agent/providers";
import { createMemoryService } from "./memory/integration/factory";
import { ToolRegistry } from "./tools/registry";
import { createLocalTools } from "./tools/local";
import { createTelegramBot } from "./bot/bot";
import { runOneAutonomousJob, runOneMemoryUpdateNow } from "./cron/autonomous";
import { startSchedulerLoop } from "./cron/scheduler";
import { AutonomousJobService } from "./services/autonomous-jobs";
import { MemoryUpdateSettingsService } from "./services/memory-update-settings";
import { unixNow } from "./utils/time";

async function main() {
  initDb();

  if (process.argv.includes("--migrate-only")) {
    console.log(`Migration done: ${config.storage.dbPath}`);
    return;
  }

  assertRuntimeConfig();
  console.log("Runtime config", getRuntimeConfigSummary());

  const llm = createLlmProvider();
  const memory = await createMemoryService(db, llm, {
    storage: {
      dataDir: config.storage.dataDir,
      memoryRefsDir: config.storage.memoryRefsDir,
      memoryCanvasDir: config.storage.memoryCanvasDir,
      memoryJsonlExportDir: config.storage.memoryJsonlExportDir,
      historyDir: config.storage.historyDir,
      memoryTaskCanvasDir: config.storage.memoryTaskCanvasDir,
      memoryGeneratedSkillsDir: config.storage.memoryGeneratedSkillsDir,
    },
    memory: {
      maintenanceCron: config.memory.maintenanceCron,
      offloadEnabled: config.memory.offloadEnabled,
      offloadMinChars: config.memory.offloadMinChars,
      offloadSummaryChars: config.memory.offloadSummaryChars,
      sqliteVecEnabled: config.memory.sqliteVecEnabled,
      jsonlExportEnabled: config.memory.jsonlExportEnabled,
      l15: config.memory.l15,
      l4: config.memory.l4,
    },
  });
  const registry = new ToolRegistry(db);
  const autonomousJobs = new AutonomousJobService(db);
  const memoryUpdateSettings = new MemoryUpdateSettingsService(db);

  const bot = createTelegramBot({ memory, registry, llm, autonomousJobs, memoryUpdateSettings });

  registry.registerMany(createLocalTools(memory, bot.api, autonomousJobs));

  startSchedulerLoop({
    tickCron: config.scheduler.tickCron,
    maxItemsPerTick: config.scheduler.maxItemsPerTick,
    jobs: autonomousJobs,
    memoryUpdateSettings,
    nowUnixFn: unixNow,
    runOneAutonomousJob: ({ job, nowUnix }) =>
      runOneAutonomousJob({
        db,
        bot,
        memory,
        registry,
        llm,
        job,
        nowUnix,
      }),
    runOneMemoryUpdateNow: ({ userId, nowUnix }) =>
      runOneMemoryUpdateNow({
        memory,
        settings: memoryUpdateSettings,
        userId,
        nowUnix,
      }),
  });

  const stop = async () => {
    console.log("Shutting down...");
    await bot.stop().catch(() => undefined);
    db.close();
    process.exit(0);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  console.log("Telegram bot starting...");
  await bot.start();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
