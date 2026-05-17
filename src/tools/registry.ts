import type { Database } from "bun:sqlite";
import { nowIso } from "../utils/time";
import type { ToolDefinition } from "../agent/types";
import type { RegisteredTool, ToolContext } from "./types";

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  constructor(private readonly db: Database) {}

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
    try {
      return await tool.execute(args, ctx);
    } catch (error) {
      return `Tool ${name} failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
