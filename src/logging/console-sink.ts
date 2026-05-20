import { truncateText } from "../utils/text";
import type { RuntimeTraceEvent, RuntimeTraceSink } from "./types";

function formatLlmRequestSummary(event: RuntimeTraceEvent): string | undefined {
  if (event.source !== "llm" || event.event !== "request.summary") {
    return undefined;
  }

  const payload = event.payload;
  if (payload === undefined || payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }

  const summary = payload as Record<string, unknown>;
  const fields: Record<string, unknown> = {
    type: event.requestType,
    chatId: event.chatId,
    userId: event.userId,
    jobId: event.jobId,
    llmCalls: summary.llmCallCount,
    outcome: summary.outcome,
  };

  return ["type", "chatId", "userId", "jobId", "llmCalls", "outcome"]
    .filter((key) => fields[key] !== undefined)
    .map((key) => `${key}=${String(fields[key])}`)
    .join(" ");
}

function formatDetails(event: RuntimeTraceEvent): string {
  const llmRequestSummary = formatLlmRequestSummary(event);
  if (llmRequestSummary !== undefined) {
    return llmRequestSummary === "" ? "" : ` ${llmRequestSummary}`;
  }

  const details: Record<string, unknown> = {};
  if (event.tags.length > 0) details.tags = event.tags;
  if (event.payload !== undefined) details.payload = event.payload;
  if (event.error !== undefined) details.error = event.error;

  if (Object.keys(details).length === 0) {
    return "";
  }

  return ` ${truncateText(JSON.stringify(details), 1000)}`;
}

export function createConsoleTraceSink(write: (line: string) => void = console.log): RuntimeTraceSink {
  return (event) => {
    write(`[${event.ts}] #${event.seq} L${event.minLevel} ${event.source}.${event.event}${formatDetails(event)}`);
  };
}
