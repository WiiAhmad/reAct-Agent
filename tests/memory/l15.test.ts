import { expect, test } from "bun:test";
import type { LlmProvider } from "../../src/agent/types";
import { judgeTaskByRules, parseL15Json, runL15Judgment } from "../../src/memory/offload/l15";
import type { L15TaskSummary } from "../../src/memory/offload/types";

test("rules classify current datetime question as short", () => {
  expect(
    judgeTaskByRules({
      latestUserMessage: "sekarang Hari apa dan jam berapa",
      historicalTasks: [],
    }),
  ).toEqual({ taskCompleted: false, isLongTask: false, isContinuation: false, source: "rules" });
});

test("rules classify new implementation request without active task as long task", () => {
  expect(
    judgeTaskByRules({
      latestUserMessage: "Implement Task 3 from the full offload pipeline plan",
      historicalTasks: [],
    }),
  ).toEqual({
    taskCompleted: false,
    isLongTask: true,
    isContinuation: false,
    newTaskLabel: "implement-task-3-from-the-full-offload-pipeline-plan",
    source: "rules",
  });
});

test("rules mark explicit completion on active task", () => {
  const activeTask: L15TaskSummary = { id: 7, label: "offload-l15", status: "active" };

  expect(
    judgeTaskByRules({
      latestUserMessage: "sudah selesai, tests passing",
      activeTask,
      historicalTasks: [activeTask],
    }),
  ).toEqual({
    taskCompleted: true,
    isLongTask: false,
    isContinuation: false,
    selectedTaskId: 7,
    source: "rules",
  });
});

test("rules classify clear continuation on active task", () => {
  const activeTask: L15TaskSummary = { id: 8, label: "offload-l15", status: "active" };

  expect(
    judgeTaskByRules({
      latestUserMessage: "lanjutkan task ini",
      activeTask,
      historicalTasks: [activeTask],
    }),
  ).toEqual({
    taskCompleted: false,
    isLongTask: true,
    isContinuation: true,
    selectedTaskId: 8,
    source: "rules",
  });
});

test("parseL15Json accepts fenced JSON and normalizes label", () => {
  expect(
    parseL15Json('```json\n{"taskCompleted":false,"isLongTask":true,"isContinuation":false,"newTaskLabel":"Add L1.5 Router!"}\n```'),
  ).toEqual({
    taskCompleted: false,
    isLongTask: true,
    isContinuation: false,
    newTaskLabel: "add-l15-router",
    source: "llm",
  });
});

test("parseL15Json accepts continuationTaskId and maps it to selectedTaskId", () => {
  expect(
    parseL15Json('{"taskCompleted":false,"isLongTask":true,"isContinuation":true,"continuationTaskId":42}'),
  ).toEqual({
    taskCompleted: false,
    isLongTask: true,
    isContinuation: true,
    selectedTaskId: 42,
    source: "llm",
  });
});

test("runL15Judgment tags llm-mode calls with memory.l15 origin metadata", async () => {
  const seenOrigins: string[] = [];
  const llm: LlmProvider = {
    async complete(request: any) {
      seenOrigins.push(request.meta?.origin ?? "missing");
      return { content: '{"taskCompleted":false,"isLongTask":true,"isContinuation":false}', toolCalls: [] };
    },
  };

  await expect(
    runL15Judgment({
      latestUserMessage: "implement the runtime logger",
      historicalTasks: [],
      llm,
      mode: "llm",
      recentMessages: [],
      maxCanvasChars: 1000,
    }),
  ).resolves.toMatchObject({ source: "llm", isLongTask: true });
  expect(seenOrigins).toEqual(["memory.l15"]);
});

test("runL15Judgment falls back to short when LLM returns malformed JSON", async () => {
  const llm: LlmProvider = {
    async complete() {
      return { content: "not json", toolCalls: [] };
    },
  };

  await expect(
    runL15Judgment({
      latestUserMessage: "maybe do something",
      historicalTasks: [],
      llm,
      mode: "llm",
      recentMessages: [],
      maxCanvasChars: 1000,
    }),
  ).resolves.toEqual({ taskCompleted: false, isLongTask: false, isContinuation: false, source: "fallback" });
});
