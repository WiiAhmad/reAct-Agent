import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerConfig } from "./config";
import { sanitizeToolName, truncateText } from "../utils/text";
import type { RegisteredTool } from "../tools/types";

function renderMcpContent(result: any): string {
  const content = result?.content;
  if (!Array.isArray(content)) return JSON.stringify(result ?? {});

  return content
    .map((item) => {
      if (item.type === "text") return item.text;
      if (item.type === "image") return `[image: ${item.mimeType ?? "unknown"}]`;
      if (item.type === "resource") return JSON.stringify(item.resource ?? item);
      return JSON.stringify(item);
    })
    .join("\n");
}

export class McpManager {
  private readonly clients = new Map<string, Client>();

  async connectServer(serverName: string, cfg: McpServerConfig): Promise<RegisteredTool[]> {
    const client = new Client({ name: `telegram-agent-${serverName}`, version: "0.1.0" });
    const transport = new StdioClientTransport({
      command: cfg.command,
      args: cfg.args ?? [],
      env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
    });

    await client.connect(transport);
    this.clients.set(serverName, client);

    const listed = await client.listTools();
    return (listed.tools ?? []).map((tool: any) => {
      const publicName = sanitizeToolName(`mcp_${serverName}_${tool.name}`);
      return {
        name: publicName,
        source: "mcp" as const,
        serverName,
        originalName: tool.name,
        description: `[MCP:${serverName}] ${tool.description ?? tool.name}`,
        inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
        async execute(args) {
          const result = await client.callTool({
            name: tool.name,
            arguments: args,
          });
          return truncateText(renderMcpContent(result), 12000);
        },
      } satisfies RegisteredTool;
    });
  }

  async closeAll() {
    for (const client of this.clients.values()) {
      await client.close().catch(() => undefined);
    }
    this.clients.clear();
  }
}
