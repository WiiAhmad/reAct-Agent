import { expect, test } from "bun:test";
import { createConsoleTraceSink } from "../../src/logging/console-sink";

test("createConsoleTraceSink formats source and event", () => {
  const lines: string[] = [];
  const sink = createConsoleTraceSink((line) => lines.push(line));

  sink({
    ts: "2026-05-19T14:32:05.123Z",
    seq: 1,
    runId: "run-1",
    pid: 1234,
    minLevel: 1,
    source: "agent",
    event: "start",
    tags: [],
  });

  expect(lines).toEqual(["[2026-05-19T14:32:05.123Z] #1 L1 agent.start"]);
});

test("createConsoleTraceSink formats llm request summaries compactly", () => {
  const lines: string[] = [];
  const sink = createConsoleTraceSink((line) => lines.push(line));

  sink({
    ts: "2026-05-19T14:32:05.123Z",
    seq: 7,
    runId: "run-1",
    pid: 1234,
    minLevel: 1,
    source: "llm",
    event: "request.summary",
    tags: [],
    requestType: "telegram_message",
    chatId: "chat-123",
    userId: "user-456",
    payload: {
      llmCallCount: 4,
      outcome: "success",
    },
  });

  sink({
    ts: "2026-05-19T14:32:06.123Z",
    seq: 8,
    runId: "run-1",
    pid: 1234,
    minLevel: 1,
    source: "llm",
    event: "request.summary",
    tags: [],
    requestType: "autonomous_job",
    jobId: "job-789",
    payload: {
      llmCallCount: 2,
      outcome: "error",
    },
  });

  expect(lines).toEqual([
    "[2026-05-19T14:32:05.123Z] #7 L1 llm.request.summary type=telegram_message chatId=chat-123 userId=user-456 llmCalls=4 outcome=success",
    "[2026-05-19T14:32:06.123Z] #8 L1 llm.request.summary type=autonomous_job jobId=job-789 llmCalls=2 outcome=error",
  ]);
});
