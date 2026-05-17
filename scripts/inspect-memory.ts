#!/usr/bin/env bun
import { db, initDb } from "../src/db";
import { config } from "../src/config";
import { createMemoryService } from "../src/memory/integration/factory";

const llm = {
  async complete() {
    throw new Error("inspect-memory does not execute LLM calls");
  },
};

initDb();
const userId = process.argv[2] ?? "";
const chatId = process.argv[3] ?? "";
const memory = await createMemoryService(db, llm as any, {
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

if (!userId) {
  const rows = db.query(`SELECT DISTINCT user_id FROM conversations ORDER BY user_id`).all() as Array<{ user_id: string }>;
  console.log(rows.length ? rows.map((r) => r.user_id).join("\n") : "No users yet. Pass a user_id to inspect.");
  process.exit(0);
}

console.log(await memory.memoryStatus(userId, chatId || undefined));
const recall = await memory.recall(userId, "persona preferences project memory", 5, chatId || undefined);
if (recall.persona) console.log(`\n--- persona ---\n${recall.persona}`);
if (recall.scenarios.length) console.log(`\n--- scenarios ---\n${recall.scenarios.map((scenario) => `#${scenario.id} ${scenario.title}`).join("\n")}`);
