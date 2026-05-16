import type { Api } from "grammy";
import type { ToolDefinition } from "../agent/types";
import type { MemoryStore } from "../memory/store";

export type ToolContext = {
  chatId: string;
  userId: string;
  memory: MemoryStore;
  telegram?: Api;
};

export type RegisteredTool = ToolDefinition & {
  source: "local" | "mcp";
  serverName?: string;
  originalName?: string;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
};
