export type MemoryUpdateSource = "telegram" | "scheduler";
export type MemoryUpdateStage = "run" | "l1" | "l2" | "l3";
export type MemoryUpdateProgressStatus = "start" | "complete" | "skip" | "error";

export type MemoryUpdateProgressEvent = {
  source: MemoryUpdateSource;
  userId: string;
  stage: MemoryUpdateStage;
  status: MemoryUpdateProgressStatus;
  startedAtUnix?: number;
  finishedAtUnix?: number;
  durationMs?: number;
  pendingTurns?: number;
  createdAtoms?: number;
  checkpointAdvanced?: boolean;
  atomCount?: number;
  scenarioId?: number;
  personaUpdated?: boolean;
  reason?: string;
  error?: string;
};

export type MemoryUpdateProgressReporter = (event: MemoryUpdateProgressEvent) => void | Promise<void>;

export type MemoryUpdateProgressOptions = {
  source?: MemoryUpdateSource;
  onProgress?: MemoryUpdateProgressReporter;
};

function formatProgressReporterError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function emitMemoryUpdateProgress(
  reporter: MemoryUpdateProgressReporter | undefined,
  event: MemoryUpdateProgressEvent,
) {
  if (!reporter) return;
  try {
    await reporter(event);
  } catch (error) {
    console.error("Failed to report memory update progress", {
      source: event.source,
      userId: event.userId,
      stage: event.stage,
      status: event.status,
      error: formatProgressReporterError(error),
    });
  }
}
