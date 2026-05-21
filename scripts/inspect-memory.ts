#!/usr/bin/env bun
import { db, initDb } from "../src/db";
import { config } from "../src/config";
import { SqliteMemoryStore } from "../src/memory/backends/sqlite/store";
import { buildInspectMemoryDump, formatInspectMemoryReport } from "../src/memory/debug/inspect-memory-report";
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
    historyDir: config.storage.historyDir,
  },
  memory: {
    maintenanceCron: config.memory.maintenanceCron,
    retentionDays: config.memory.retentionDays,
    offloadEnabled: config.memory.offloadEnabled,
    offloadMinChars: config.memory.offloadMinChars,
    offloadSummaryChars: config.memory.offloadSummaryChars,
    sqliteVecEnabled: config.memory.sqliteVecEnabled,
    jsonlExportEnabled: config.memory.jsonlExportEnabled,
  },
});
const store = new SqliteMemoryStore(db, {
  sqliteVecEnabled: config.memory.sqliteVecEnabled,
  bm25Enabled: true,
  bm25Language: "en",
});
await store.init({ provider: "local", model: "deterministic-local", dimensions: 64 });

if (!userId) {
  const rows = db.query(`SELECT DISTINCT user_id FROM conversations ORDER BY user_id`).all() as Array<{ user_id: string }>;
  console.log(rows.length ? rows.map((r) => r.user_id).join("\n") : "No users yet. Pass a user_id to inspect.");
  process.exit(0);
}

const status = await memory.memoryStatus(userId, chatId || undefined);
const profiles = await store.pullProfiles();
const dump = buildInspectMemoryDump(profiles, userId, chatId || undefined);
console.log(formatInspectMemoryReport(status, dump));
