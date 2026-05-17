import type { AgentMessage } from "../../agent/types";
import type { L15Input, L15JudgmentResult, L15RunInput, L15TaskSummary } from "./types";

const fallbackResult: L15JudgmentResult = {
  taskCompleted: false,
  isLongTask: false,
  isContinuation: false,
  source: "fallback",
};

export function normalizeTaskLabel(input: string): string {
  const label = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/([a-z0-9])\.([a-z0-9])/g, "$1$2")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return label || "task";
}

export function judgeTaskByRules(input: L15Input): L15JudgmentResult | undefined {
  const message = input.latestUserMessage.trim();
  const lower = message.toLowerCase();
  const activeTask = input.activeTask?.status === "active" ? input.activeTask : undefined;

  if (activeTask && isCompletion(lower)) {
    return {
      taskCompleted: true,
      isLongTask: false,
      isContinuation: false,
      selectedTaskId: activeTask.id,
      source: "rules",
    };
  }

  if (activeTask && isContinuation(lower)) {
    return {
      taskCompleted: false,
      isLongTask: true,
      isContinuation: true,
      selectedTaskId: activeTask.id,
      source: "rules",
    };
  }

  if (isShortQa(lower)) {
    return { taskCompleted: false, isLongTask: false, isContinuation: false, source: "rules" };
  }

  if (!activeTask && isLongTask(lower)) {
    return {
      taskCompleted: false,
      isLongTask: true,
      isContinuation: false,
      newTaskLabel: normalizeTaskLabel(message),
      source: "rules",
    };
  }

  return undefined;
}

export function parseL15Json(content: string): L15JudgmentResult | undefined {
  const jsonText = extractJson(content);
  if (!jsonText) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const value = parsed as Record<string, unknown>;
  if (
    typeof value.taskCompleted !== "boolean" ||
    typeof value.isLongTask !== "boolean" ||
    typeof value.isContinuation !== "boolean"
  ) {
    return undefined;
  }

  const result: L15JudgmentResult = {
    taskCompleted: value.taskCompleted,
    isLongTask: value.isLongTask,
    isContinuation: value.isContinuation,
    source: "llm",
  };

  const selectedTaskId = value.selectedTaskId ?? value.continuationTaskId;
  if (selectedTaskId !== undefined) {
    if (!Number.isInteger(selectedTaskId) || typeof selectedTaskId !== "number") return undefined;
    result.selectedTaskId = selectedTaskId;
  }

  if (value.newTaskLabel !== undefined) {
    if (typeof value.newTaskLabel !== "string") return undefined;
    result.newTaskLabel = normalizeTaskLabel(value.newTaskLabel);
  }

  return result;
}

export async function runL15Judgment(input: L15RunInput): Promise<L15JudgmentResult> {
  if (input.mode !== "llm") {
    const rules = judgeTaskByRules(input);
    if (rules || input.mode === "rules") return rules ?? fallbackResult;
  }

  try {
    const response = await input.llm.complete({
      messages: buildPrompt(input),
      tools: [],
      temperature: 0,
    });
    return parseL15Json(response.content) ?? fallbackResult;
  } catch {
    return fallbackResult;
  }
}

function isShortQa(lower: string): boolean {
  if (/^(hi|hello|hey|halo|hai|pagi|siang|sore|malam)\b/.test(lower)) return true;
  if (/\b(thanks?|thank you|terima kasih|makasih|trims)\b/.test(lower)) return true;
  const hasQuestion = lower.includes("?") || /\b(apa|what|which|when|kapan|jam berapa|hari apa)\b/.test(lower);
  const hasDateTime = /\b(sekarang|now|today|hari ini|tanggal|date|time|jam|waktu|hari|day)\b/.test(lower);
  return hasQuestion && hasDateTime;
}

function isCompletion(lower: string): boolean {
  return /\b(selesai|done|fixed|beres|kelar|tuntas|resolved|complete(?:d)?|tests? passing|test(?:s)? pass(?:ing|ed)?)\b/.test(lower);
}

function isContinuation(lower: string): boolean {
  return /\b(lanjut|lanjutkan|continue|carry on|resume)\b/.test(lower);
}

function isLongTask(lower: string): boolean {
  return /\b(implement|tambahkan|add|build|buat|fix|betulkan|debug|refactor|adaptasi|migrasi|update|ubah|rancang|planning|plan)\b/.test(
    lower,
  );
}

function extractJson(content: string): string | undefined {
  const trimmed = content.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence?.[1]) return fence[1].trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  return first >= 0 && last > first ? trimmed.slice(first, last + 1) : undefined;
}

function buildPrompt(input: L15RunInput): AgentMessage[] {
  const active = summarizeTask(input.activeTask, input.maxCanvasChars);
  const historical = input.historicalTasks.map((task) => summarizeTask(task, input.maxCanvasChars));
  return [
    {
      role: "system",
      content: [
        "Judge whether the latest user message completes, continues, or starts a long task.",
        "Return only strict JSON with booleans: taskCompleted, isLongTask, isContinuation.",
        "Optionally include selectedTaskId or continuationTaskId and newTaskLabel.",
        "Prefer safe short/no-canvas when uncertain.",
      ].join(" "),
    },
    ...input.recentMessages,
    {
      role: "user",
      content: JSON.stringify({
        latestUserMessage: input.latestUserMessage,
        activeTask: active,
        historicalTasks: historical,
      }),
    },
  ];
}

function summarizeTask(task: L15TaskSummary | undefined, maxCanvasChars: number): L15TaskSummary | undefined {
  if (!task) return undefined;
  const max = Math.max(0, maxCanvasChars);
  return {
    ...task,
    canvas: task.canvas && task.canvas.length > max ? task.canvas.slice(0, max) : task.canvas,
  };
}
