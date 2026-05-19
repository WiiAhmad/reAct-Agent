import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeTraceSink } from "./types";

export interface JsonlTraceSinkOptions {
  dataDir: string;
  startedAt?: Date;
  pid?: number;
}

export interface JsonlTraceSinkResult {
  filePath: string;
  sink: RuntimeTraceSink;
}

function formatTimestampForFile(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function buildRuntimeLogFilePath(dataDir: string, startedAt: Date, pid = process.pid): string {
  return join(dataDir, "logs", `runtime-${formatTimestampForFile(startedAt)}-p${pid}.jsonl`);
}

export function createJsonlTraceSink(options: JsonlTraceSinkOptions): JsonlTraceSinkResult {
  const startedAt = options.startedAt ?? new Date();
  const pid = options.pid ?? process.pid;
  const logDir = join(options.dataDir, "logs");
  mkdirSync(logDir, { recursive: true });

  const filePath = buildRuntimeLogFilePath(options.dataDir, startedAt, pid);
  const sink: RuntimeTraceSink = (event) => {
    appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");
  };

  return { filePath, sink };
}
