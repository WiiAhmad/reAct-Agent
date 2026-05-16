import { assertRuntimeConfig, config, getRuntimeConfigSummary } from "./config";
import { db, initDb } from "./db";
import { createLlmProvider } from "./agent/providers";
import { MemoryStore } from "./memory/store";
import { ToolRegistry } from "./tools/registry";
import { createLocalTools } from "./tools/local";
import { loadMcpConfig } from "./mcp/config";
import { McpManager } from "./mcp/manager";
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
  const memory = new MemoryStore(db);
  const registry = new ToolRegistry(db);
  const mcpManager = new McpManager();

  const bot = createTelegramBot({ db, memory, registry, llm });

  registry.registerMany(createLocalTools(memory, bot.api));

  const mcpConfig = loadMcpConfig();
  for (const [serverName, serverConfig] of Object.entries(mcpConfig.servers)) {
    try {
      const tools = await mcpManager.connectServer(serverName, serverConfig);
      registry.registerMany(tools);
      console.log(`MCP server connected: ${serverName}, tools=${tools.length}`);
    } catch (error) {
      console.error(`Failed to connect MCP server ${serverName}`, error);
    }
  }

  startAutonomousLoop({ db, bot, memory, registry, llm });
  startMemoryMaintenanceLoop({ db, memory, llm });

  const stop = async () => {
    console.log("Shutting down...");
    await bot.stop().catch(() => undefined);
    await mcpManager.closeAll();
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
