export type AgentRole = "system" | "user" | "assistant" | "tool";

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type AgentMessage = {
  role: AgentRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
};

export type LlmCompleteRequest = {
  messages: AgentMessage[];
  tools: ToolDefinition[];
  temperature?: number;
  meta?: {
    origin?: string;
  };
};

export type LlmCompleteResponse = {
  content: string;
  toolCalls: ToolCall[];
};

export interface LlmProvider {
  complete(request: LlmCompleteRequest): Promise<LlmCompleteResponse>;
}
