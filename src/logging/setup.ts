import { parseRuntimeCliArgs } from "./cli";
import { createConsoleTraceSink } from "./console-sink";
import { createJsonlTraceSink } from "./jsonl-sink";
import { RuntimeTraceBus } from "./trace-bus";
import type { RuntimeCliArgs, RuntimeTraceEmitter, RuntimeTraceSink } from "./types";

export interface RuntimeLoggingSetupInput {
  argv: string[];
  dataDir: string;
  startedAt?: Date;
  pid?: number;
  consoleWrite?: (line: string) => void;
}

export interface RuntimeLoggingSetupResult {
  cli: RuntimeCliArgs;
  trace: RuntimeTraceEmitter | undefined;
  traceFilePath: string | undefined;
}

function formatRunIdTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function buildRuntimeRunId(startedAt: Date, pid = process.pid): string {
  return `${formatRunIdTimestamp(startedAt)}-p${pid}`;
}

export function setupRuntimeLogging(input: RuntimeLoggingSetupInput): RuntimeLoggingSetupResult {
  const cli = parseRuntimeCliArgs(input.argv);

  if (cli.logLevel === undefined) {
    return { cli, trace: undefined, traceFilePath: undefined };
  }

  const startedAt = input.startedAt ?? new Date();
  const pid = input.pid ?? process.pid;
  const sinks: RuntimeTraceSink[] = [createConsoleTraceSink(input.consoleWrite)];
  let traceFilePath: string | undefined;

  if (cli.logLevel === 3) {
    const jsonl = createJsonlTraceSink({ dataDir: input.dataDir, startedAt, pid });
    traceFilePath = jsonl.filePath;
    sinks.push(jsonl.sink);
  }

  return {
    cli,
    trace: new RuntimeTraceBus({
      level: cli.logLevel,
      runId: buildRuntimeRunId(startedAt, pid),
      pid,
      sinks,
    }),
    traceFilePath,
  };
}
