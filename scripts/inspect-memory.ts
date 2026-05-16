#!/usr/bin/env bun
import { db, initDb } from "../src/db";
import { MemoryStore } from "../src/memory/store";

initDb();
const userId = process.argv[2] ?? "";
const memory = new MemoryStore(db);
if (!userId) {
  const rows = db.query(`SELECT DISTINCT user_id FROM conversations ORDER BY user_id`).all() as Array<{ user_id: string }>;
  console.log(rows.length ? rows.map((r) => r.user_id).join("\n") : "No users yet. Pass a user_id to inspect.");
  process.exit(0);
}
console.log(memory.memoryStatus(userId));
const persona = memory.getPersona(userId);
if (persona) console.log(`\n--- persona ---\n${persona}`);
