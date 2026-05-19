import type { MemoryService } from "../../memory/core/service";
import { runOneMemoryUpdateNow } from "../../cron/autonomous";
import { emitTrace } from "../../logging/helpers";
import type { RuntimeTraceEmitter } from "../../logging/types";
import type { MemoryUpdateSettingsService } from "../../services/memory-update-settings";
import type { MemoryUpdateProgressEvent } from "../../memory/pipeline/progress";

export type TelegramMemoryUpdateRunInput = {
  memory: MemoryService;
  settings: MemoryUpdateSettingsService;
  userId: string;
  chatId?: string;
  sendMessage: (text: string) => Promise<unknown>;
  runNow?: typeof runOneMemoryUpdateNow;
  trace?: RuntimeTraceEmitter;
};

export type TelegramMemoryUpdateRunStartResult =
  | { status: "started"; completion: Promise<void> }
  | { status: "already-running" };

const activeMemoryUpdateUsers = new Set<string>();

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function safeSendMemoryUpdateMessage(input: TelegramMemoryUpdateRunInput, text: string) {
  try {
    await input.sendMessage(text);
    emitTrace(input.trace, {
      minLevel: 1,
      source: "bot",
      event: "outbound.send.complete",
      chatId: input.chatId,
      userId: input.userId,
      payload: { textLength: text.length },
    });
  } catch (error) {
    console.error("Telegram memory update message send failed", {
      userId: input.userId,
      error,
    });
    emitTrace(input.trace, {
      minLevel: 1,
      source: "bot",
      event: "error",
      chatId: input.chatId,
      userId: input.userId,
      payload: { operation: "memory_update_send" },
      error,
    });
  }
}

export function resetActiveMemoryUpdateRunsForTest() {
  activeMemoryUpdateUsers.clear();
}

export function formatMemoryUpdateProgressMessage(event: MemoryUpdateProgressEvent) {
  if (event.stage === "run") return null;

  if (event.stage === "l1" && event.status === "start") return "L1 dimulai...";
  if (event.stage === "l1" && event.status === "complete") return `L1 selesai: ${event.createdAtoms ?? 0} atom dibuat.`;
  if (event.stage === "l1" && event.status === "skip") return "L1 dilewati: tidak ada percakapan baru.";

  if (event.stage === "l2" && event.status === "start") return "L2 dimulai...";
  if (event.stage === "l2" && event.status === "complete") return `L2 selesai: scenario #${event.scenarioId}.`;
  if (event.stage === "l2" && event.status === "skip") return event.reason === "no_atoms" ? "L2 dilewati: tidak ada atom." : "L2 dilewati.";

  if (event.stage === "l3" && event.status === "start") return "L3 dimulai...";
  if (event.stage === "l3" && event.status === "complete") return `L3 selesai: persona ${event.personaUpdated ? "updated" : "tidak berubah"}.`;
  if (event.stage === "l3" && event.status === "skip") return "L3 dilewati.";

  if (event.status === "error") return `Memory update gagal di ${event.stage.toUpperCase()}: ${event.error ?? "unknown error"}`;
  return null;
}

export function formatMemoryUpdateFinalMessage(result: { l1Created: number; l2ScenarioId?: number; personaUpdated: boolean }) {
  return [
    "Memory update selesai.",
    `L1=${result.l1Created} atom,`,
    `L2=${result.l2ScenarioId ? `scenario #${result.l2ScenarioId}` : "dilewati"},`,
    `L3=${result.personaUpdated ? "updated" : "dilewati"}.`,
  ].join(" ");
}

export async function startTelegramMemoryUpdateRun(input: TelegramMemoryUpdateRunInput): Promise<TelegramMemoryUpdateRunStartResult> {
  if (activeMemoryUpdateUsers.has(input.userId)) {
    console.log("[memory-update:run-skip]", {
      source: "telegram",
      userId: input.userId,
      reason: "already_running",
    });
    return { status: "already-running" };
  }

  activeMemoryUpdateUsers.add(input.userId);
  try {
    await input.sendMessage("Memory update dimulai...");
    emitTrace(input.trace, {
      minLevel: 1,
      source: "bot",
      event: "outbound.send.complete",
      chatId: input.chatId,
      userId: input.userId,
      payload: { textLength: "Memory update dimulai...".length },
    });
  } catch (error) {
    activeMemoryUpdateUsers.delete(input.userId);
    emitTrace(input.trace, {
      minLevel: 1,
      source: "bot",
      event: "error",
      chatId: input.chatId,
      userId: input.userId,
      payload: { operation: "memory_update_start_send" },
      error,
    });
    throw error;
  }

  const runNow = input.runNow ?? runOneMemoryUpdateNow;
  const completion = (async () => {
    try {
      const result = await runNow({
        memory: input.memory,
        settings: input.settings,
        userId: input.userId,
        source: "telegram",
        onProgress: async (event) => {
          const message = formatMemoryUpdateProgressMessage(event);
          if (message) await safeSendMemoryUpdateMessage(input, message);
        },
      });
      await safeSendMemoryUpdateMessage(input, formatMemoryUpdateFinalMessage(result.maintenanceResult));
    } catch (error) {
      await safeSendMemoryUpdateMessage(input, `Memory update gagal: ${toErrorMessage(error)}`);
    } finally {
      activeMemoryUpdateUsers.delete(input.userId);
    }
  })();

  completion.catch((error) => {
    console.error("Telegram memory update background task failed", error);
  });

  return { status: "started", completion };
}
