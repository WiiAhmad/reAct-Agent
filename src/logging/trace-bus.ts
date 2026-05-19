import { redactSecrets } from "./redaction";
import type { RuntimeTraceBusOptions, RuntimeTraceEvent, RuntimeTraceInput } from "./types";

export class RuntimeTraceBus {
  private seq = 0;

  constructor(private readonly options: RuntimeTraceBusOptions) {}

  emit(input: RuntimeTraceInput): void {
    if (input.minLevel > this.options.level) {
      return;
    }

    const tsValue = this.options.now?.() ?? new Date();
    const event: RuntimeTraceEvent = {
      ...input,
      ts: typeof tsValue === "string" ? tsValue : tsValue.toISOString(),
      seq: ++this.seq,
      runId: this.options.runId,
      pid: this.options.pid ?? process.pid,
      tags: input.tags ?? [],
      payload: input.payload === undefined ? undefined : redactSecrets(input.payload),
      error: input.error === undefined ? undefined : redactSecrets(input.error),
    };

    for (const sink of this.options.sinks) {
      try {
        sink(event);
      } catch (error) {
        this.options.onSinkError?.(error instanceof Error ? error : new Error(String(error)), sink, event);
      }
    }
  }
}
