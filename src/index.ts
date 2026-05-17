import { assertRuntimeConfig, config, getRuntimeConfigSummary } from "./config";
import { db, initDb } from "./db";
import { createLlmProvider } from "./agent/providers";
import { createMemoryService } from "./memory/integration/factory";
import { ToolRegistry } from "./tools/registry";
import { createLocalTools } from "./tools/local";
import { createTelegramBot } from "./bot/bot";
import { startAutonomousLoop, startMemoryMaintenanceLoop } from "./cron/autonomous";

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
    },
    memory: {
      maintenanceCron: config.memory.maintenanceCron,
      offloadEnabled: config.memory.offloadEnabled,
      offloadMinChars: config.memory.offloadMinChars,
      offloadSummaryChars: config.memory.offloadSummaryChars,
      sqliteVecEnabled: config.memory.sqliteVecEnabled,
      jsonlExportEnabled: config.memory.jsonlExportEnabled,
    },
  });
  const registry = new ToolRegistry(db);

  const bot = createTelegramBot({ db, memory, registry, llm });

  registry.registerMany(createLocalTools(memory, bot.api));

  startAutonomousLoop({ db, bot, memory, registry, llm });
  startMemoryMaintenanceLoop({ db, memory, llm });

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
