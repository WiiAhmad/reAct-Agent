import type { Database } from "bun:sqlite";
import { nowIso } from "../utils/time";
import type { ToolDefinition } from "../agent/types";
import { emitTrace } from "../logging/helpers";
import type { RuntimeTraceEmitter } from "../logging/types";
import type { RegisteredTool, ToolContext } from "./types";

function formatToolError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: typeof error, message: String(error) };
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  constructor(
    private readonly db: Database,
    private readonly trace?: RuntimeTraceEmitter,
  ) {}

  register(tool: RegisteredTool) {
    this.tools.set(tool.name, tool);
    this.db
      .query(`
        INSERT INTO tool_registry (name, source, description, input_schema_json, enabled, updated_at)
        VALUES (?, ?, ?, ?, 1, ?)
        ON CONFLICT(name) DO UPDATE SET
          source = excluded.source,
          description = excluded.description,
          input_schema_json = excluded.input_schema_json,
          updated_at = excluded.updated_at
      `)
      .run(tool.name, tool.source, tool.description, JSON.stringify(tool.inputSchema), nowIso());
  }

  registerMany(tools: RegisteredTool[]) {
    for (const tool of tools) this.register(tool);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  listDebug(): Array<Pick<RegisteredTool, "name" | "source" | "description">> {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      source: tool.source,
      description: tool.description,
    }));
  }

  async call(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return `Tool not found: ${name}`;

    emitTrace(this.trace, {
      minLevel: 2,
      source: "tool",
      event: "execute.start",
      toolName: name,
      chatId: ctx.chatId,
      userId: ctx.userId,
      payload: { args },
    });

    try {
      const result = await tool.execute(args, ctx);
      emitTrace(this.trace, {
        minLevel: 3,
        source: "tool",
        event: "execute.complete",
        toolName: name,
        chatId: ctx.chatId,
        userId: ctx.userId,
        payload: { args, result },
      });
      return result;
    } catch (error) {
      emitTrace(this.trace, {
        minLevel: 1,
        source: "tool",
        event: "execute.error",
        toolName: name,
        chatId: ctx.chatId,
        userId: ctx.userId,
        payload: { args },
        error: formatToolError(error),
      });
      return `Tool ${name} failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
