export type RuntimeLogLevel = 1 | 2 | 3;

export type RuntimeRequestType = "telegram_message" | "autonomous_job" | "memory_update" | "unscoped";

export interface RuntimeCliArgs {
  logLevel?: RuntimeLogLevel;
  migrateOnly: boolean;
}

export interface RuntimeTraceInput {
  minLevel: RuntimeLogLevel;
  source: string;
  event: string;
  tags?: string[];
  chatId?: string;
  userId?: string;
  taskId?: string;
  jobId?: string;
  requestId?: string;
  requestType?: RuntimeRequestType;
  toolName?: string;
  toolCallId?: string;
  durationMs?: number;
  payload?: unknown;
  error?: unknown;
}

export interface RuntimeTraceEvent extends RuntimeTraceInput {
  ts: string;
  seq: number;
  runId: string;
  pid: number;
  tags: string[];
}

export interface RuntimeTraceEmitter {
  emit(input: RuntimeTraceInput): void;
}

export type RuntimeTraceSink = (event: RuntimeTraceEvent) => void;

export interface RuntimeTraceBusOptions {
  level: RuntimeLogLevel;
  runId: string;
  pid?: number;
  now?: () => Date | string;
  sinks: RuntimeTraceSink[];
  onSinkError?: (error: Error, sink: RuntimeTraceSink, event: RuntimeTraceEvent) => void;
}
