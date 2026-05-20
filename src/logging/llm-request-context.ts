import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { emitTrace } from "./helpers";
import type { RuntimeRequestType, RuntimeTraceEmitter } from "./types";

export type LlmRequestContext = {
  requestId: string;
  requestType: Exclude<RuntimeRequestType, "unscoped">;
  chatId?: string;
  userId?: string;
  jobId?: string;
  startedAtMs: number;
  llmCallCount: number;
  byOrigin: Record<string, number>;
};

type LlmRequestContextState = LlmRequestContext & {
  trace?: RuntimeTraceEmitter;
};

export type RecordedLlmCall = {
  requestId?: string;
  requestType: RuntimeRequestType;
  chatId?: string;
  userId?: string;
  jobId?: string;
  callIndex: number;
  originCount: number;
};

const storage = new AsyncLocalStorage<LlmRequestContextState>();

export function recordLlmCall(origin: string): RecordedLlmCall {
  const context = storage.getStore();
  if (!context) {
    return {
      requestId: undefined,
      requestType: "unscoped",
      chatId: undefined,
      userId: undefined,
      jobId: undefined,
      callIndex: 1,
      originCount: 1,
    };
  }

  context.llmCallCount += 1;
  context.byOrigin[origin] = (context.byOrigin[origin] ?? 0) + 1;

  return {
    requestId: context.requestId,
    requestType: context.requestType,
    chatId: context.chatId,
    userId: context.userId,
    jobId: context.jobId,
    callIndex: context.llmCallCount,
    originCount: context.byOrigin[origin],
  };
}

export async function runWithLlmRequestContext<T>(
  input: {
    trace?: RuntimeTraceEmitter;
    requestType: Exclude<RuntimeRequestType, "unscoped">;
    requestId?: string;
    chatId?: string;
    userId?: string;
    jobId?: string;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const context: LlmRequestContextState = {
    requestId: input.requestId ?? randomUUID(),
    requestType: input.requestType,
    chatId: input.chatId,
    userId: input.userId,
    jobId: input.jobId,
    startedAtMs: Date.now(),
    llmCallCount: 0,
    byOrigin: Object.create(null) as Record<string, number>,
    trace: input.trace,
  };

  return storage.run(context, async () => {
    let outcome: "success" | "error" = "success";
    try {
      return await fn();
    } catch (error) {
      outcome = "error";
      throw error;
    } finally {
      const durationMs = Date.now() - context.startedAtMs;
      emitTrace(context.trace, {
        minLevel: 1,
        source: "llm",
        event: "request.summary",
        requestId: context.requestId,
        requestType: context.requestType,
        chatId: context.chatId,
        userId: context.userId,
        jobId: context.jobId,
        durationMs,
        payload: {
          outcome,
          durationMs,
          llmCallCount: context.llmCallCount,
          byOrigin: { ...context.byOrigin },
        },
      });
    }
  });
}
