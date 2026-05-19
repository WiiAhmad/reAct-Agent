import { truncateText } from "../utils/text";
import type { RuntimeTraceEvent, RuntimeTraceSink } from "./types";

function formatDetails(event: RuntimeTraceEvent): string {
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
