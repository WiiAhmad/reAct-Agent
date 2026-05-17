import type { AgentMessage, LlmProvider } from "../../agent/types";

export type L15Mode = "rules" | "llm" | "hybrid";

export type L15TaskSummary = {
  id: number;
  label: string;
  status: "active" | "completed" | "inactive";
  canvas?: string;
};

export type L15Input = {
  latestUserMessage: string;
  activeTask?: L15TaskSummary;
  historicalTasks: L15TaskSummary[];
};

export type L15JudgmentResult = {
  taskCompleted: boolean;
  isLongTask: boolean;
  isContinuation: boolean;
  selectedTaskId?: number;
  newTaskLabel?: string;
  source: "rules" | "llm" | "fallback";
};

export type L15RunInput = L15Input & {
  llm: LlmProvider;
  mode: L15Mode;
  recentMessages: AgentMessage[];
  maxCanvasChars: number;
};
