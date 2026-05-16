import { existsSync, readFileSync } from "node:fs";
import { config } from "../config";

export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpConfig = {
  servers: Record<string, McpServerConfig>;
};

export function loadMcpConfig(): McpConfig {
  if (!existsSync(config.storage.mcpConfigPath)) return { servers: {} };
  return JSON.parse(readFileSync(config.storage.mcpConfigPath, "utf8")) as McpConfig;
}
