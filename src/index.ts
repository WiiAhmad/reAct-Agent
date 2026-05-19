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
import { emitTrace } from "./logging/helpers";
import { setupRuntimeLogging } from "./logging/setup";
import type { RuntimeTraceEmitter } from "./logging/types";

let runtimeTrace: RuntimeTraceEmitter | undefined;

async function main() {
  const logging = setupRuntimeLogging({ argv: process.argv.slice(2), dataDir: config.storage.dataDir });
  runtimeTrace = logging.trace;

  emitTrace(runtimeTrace, { minLevel: 1, source: "app", event: "startup.begin" });

  initDb();

  if (logging.cli.migrateOnly) {
    emitTrace(runtimeTrace, {
      minLevel: 1,
      source: "app",
      event: "migration.only",
      payload: { dbPath: config.storage.dbPath },
    });
    if (!runtimeTrace) {
      console.log(`Migration done: ${config.storage.dbPath}`);
    }
    return;
  }

  assertRuntimeConfig();
  const runtimeConfigSummary = getRuntimeConfigSummary();
  emitTrace(runtimeTrace, {
    minLevel: 1,
    source: "app",
    event: "config.ready",
    payload: { ...runtimeConfigSummary, traceFilePath: logging.traceFilePath },
  });
  if (!runtimeTrace) {
    console.log("Runtime config", runtimeConfigSummary);
  }

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
  }, runtimeTrace);
  const registry = new ToolRegistry(db, runtimeTrace);
  const autonomousJobs = new AutonomousJobService(db);
  const memoryUpdateSettings = new MemoryUpdateSettingsService(db);

  const bot = createTelegramBot({ memory, registry, llm, autonomousJobs, memoryUpdateSettings, trace: runtimeTrace });

  registry.registerMany(createLocalTools(memory, bot.api, autonomousJobs));

  startSchedulerLoop({
    tickCron: config.scheduler.tickCron,
    maxItemsPerTick: config.scheduler.maxItemsPerTick,
    jobs: autonomousJobs,
    memoryUpdateSettings,
    nowUnixFn: unixNow,
    runOneAutonomousJob: ({ job, nowUnix, trace }) =>
      runOneAutonomousJob({
        db,
        bot,
        memory,
        registry,
        llm,
        job,
        nowUnix,
        trace,
      }),
    runOneMemoryUpdateNow: ({ userId, nowUnix, trace }) =>
      runOneMemoryUpdateNow({
        memory,
        settings: memoryUpdateSettings,
        userId,
        nowUnix,
        trace,
      }),
    trace: runtimeTrace,
  });

  let stopping = false;
  const stop = async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    emitTrace(runtimeTrace, { minLevel: 1, source: "app", event: "shutdown.begin" });
    if (!runtimeTrace) {
      console.log("Shutting down...");
    }
    await bot.stop().catch(() => undefined);
    db.close();
    emitTrace(runtimeTrace, { minLevel: 1, source: "app", event: "shutdown.complete" });
    process.exit(0);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  emitTrace(runtimeTrace, { minLevel: 1, source: "app", event: "bot.starting" });
  if (!runtimeTrace) {
    console.log("Telegram bot starting...");
  }
  await bot.start();
  emitTrace(runtimeTrace, { minLevel: 1, source: "app", event: "bot.start" });
}

main().catch((error) => {
  emitTrace(runtimeTrace, { minLevel: 1, source: "app", event: "fatal", error });
  console.error(error);
  process.exit(1);
});
