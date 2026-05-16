import Anthropic from "@anthropic-ai/sdk";
import type { AgentMessage, LlmCompleteRequest, LlmCompleteResponse, LlmProvider } from "../types";

function convertMessages(messages: AgentMessage[]) {
  const systemParts: string[] = [];
  const converted: any[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(message.content);
      continue;
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      const content: any[] = [];
      if (message.content) content.push({ type: "text", text: message.content });
      for (const call of message.toolCalls) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.arguments ?? {},
        });
      }
      converted.push({ role: "assistant", content });
      continue;
    }

    if (message.role === "tool") {
      converted.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.toolCallId,
            content: message.content,
          },
        ],
      });
      continue;
    }

    converted.push({ role: message.role, content: message.content });
  }

  return { system: systemParts.join("\n\n"), messages: converted };
}

export class AnthropicProvider implements LlmProvider {
  private readonly client: Anthropic;

  constructor(private readonly options: { apiKey: string; model: string }) {
    this.client = new Anthropic({ apiKey: options.apiKey });
  }

  async complete(request: LlmCompleteRequest): Promise<LlmCompleteResponse> {
    const { system, messages } = convertMessages(request.messages);
    const response = await this.client.messages.create({
      model: this.options.model,
      max_tokens: 4096,
      temperature: request.temperature ?? 0.2,
      system: system || undefined,
      messages,
      tools: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema as any,
      })),
    } as any);

    const textParts: string[] = [];
    const toolCalls = [];

    for (const block of response.content as any[]) {
      if (block.type === "text") textParts.push(block.text);
      if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input ?? {},
        });
      }
    }

    return { content: textParts.join("\n"), toolCalls };
  }
}
