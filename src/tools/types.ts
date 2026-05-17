import type { Api } from "grammy";
import type { ToolDefinition } from "../agent/types";
import type { MemoryServiceLike as MemoryService } from "../memory/core/service";

export type ToolContext = {
  chatId: string;
  userId: string;
  memory: MemoryService;
  telegram?: Api;
};

export type RegisteredTool = ToolDefinition & {
  source: "local";
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
};
