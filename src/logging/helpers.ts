import type { RuntimeTraceEmitter, RuntimeTraceInput } from "./types";

export const NEW_MEMORY_STACK_TAG = "new-memory-stack";

export function emitTrace(trace: RuntimeTraceEmitter | undefined, event: RuntimeTraceInput): void {
  trace?.emit(event);
}
