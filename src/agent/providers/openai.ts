import OpenAI from "openai";
import type { AgentMessage, LlmCompleteRequest, LlmCompleteResponse, LlmProvider } from "../types";

function toOpenAiMessage(message: AgentMessage): any {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }

  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments ?? {}),
        },
      })),
    };
  }

  return {
    role: message.role,
    content: message.content,
  };
}

export class OpenAiProvider implements LlmProvider {
  private readonly client: OpenAI;

  constructor(private readonly options: { apiKey: string; model: string; baseURL?: string }) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
  }

  async complete(request: LlmCompleteRequest): Promise<LlmCompleteResponse> {
    const response = await this.client.chat.completions.create({
      model: this.options.model,
      temperature: request.temperature ?? 0.2,
      messages: request.messages.map(toOpenAiMessage),
      tools: request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      })),
      tool_choice: request.tools.length ? "auto" : undefined,
    } as any);

    const msg = response.choices[0]?.message;
    return {
      content: typeof msg?.content === "string" ? msg.content : "",
      toolCalls:
        msg?.tool_calls?.map((call: any) => ({
          id: call.id,
          name: call.function.name,
          arguments: JSON.parse(call.function.arguments || "{}"),
        })) ?? [],
    };
  }
}
