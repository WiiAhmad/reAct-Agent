import { Database } from "bun:sqlite";
import { config } from "../config";
import { migrate } from "./schema";

export const db = new Database(config.storage.dbPath, { create: true });

export function initDb() {
  migrate(db);
}
