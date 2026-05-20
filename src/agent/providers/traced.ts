import { emitTrace } from "../../logging/helpers";
import { recordLlmCall } from "../../logging/llm-request-context";
import type { RuntimeTraceEmitter } from "../../logging/types";
import type { LlmCompleteRequest, LlmCompleteResponse, LlmProvider } from "../types";

export class TracedLlmProvider implements LlmProvider {
  constructor(
    private readonly delegate: LlmProvider,
    private readonly options: {
      provider: "anthropic" | "openai";
      model: string;
      trace?: RuntimeTraceEmitter;
    },
  ) {}

  async complete(request: LlmCompleteRequest): Promise<LlmCompleteResponse> {
    const startedAtMs = Date.now();
    const origin = request.meta?.origin ?? "unknown";
    const call = recordLlmCall(origin);

    try {
      const response = await this.delegate.complete(request);
      emitTrace(this.options.trace, {
        minLevel: 3,
        source: "llm",
        event: "call.complete",
        requestId: call.requestId,
        requestType: call.requestType,
        chatId: call.chatId,
        userId: call.userId,
        jobId: call.jobId,
        durationMs: Date.now() - startedAtMs,
        payload: {
          provider: this.options.provider,
          model: this.options.model,
          origin,
          callIndex: call.callIndex,
          messageCount: request.messages.length,
          toolCount: request.tools.length,
          temperature: request.temperature,
          responseToolCalls: response.toolCalls.length,
          responseContentLength: response.content.length,
        },
      });
      return response;
    } catch (error) {
      emitTrace(this.options.trace, {
        minLevel: 1,
        source: "llm",
        event: "call.error",
        requestId: call.requestId,
        requestType: call.requestType,
        chatId: call.chatId,
        userId: call.userId,
        jobId: call.jobId,
        durationMs: Date.now() - startedAtMs,
        payload: {
          provider: this.options.provider,
          model: this.options.model,
          origin,
          callIndex: call.callIndex,
          messageCount: request.messages.length,
          toolCount: request.tools.length,
          temperature: request.temperature,
        },
        error,
      });
      throw error;
    }
  }
}
