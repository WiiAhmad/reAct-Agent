import { expect, test } from "bun:test";
import { RuntimeTraceBus } from "../../src/logging/trace-bus";
import type { RuntimeTraceEmitter, RuntimeTraceEvent, RuntimeTraceSink } from "../../src/logging/types";

test("RuntimeTraceBus filters by level, increments emitted seq, redacts data, and isolates sink failures", () => {
  const received: RuntimeTraceEvent[] = [];
  const errors: Error[] = [];
  const goodSink: RuntimeTraceSink = (event) => received.push(event);
  const badSink: RuntimeTraceSink = () => {
    throw new Error("sink exploded");
  };
  let nowCalls = 0;
  const trace: RuntimeTraceEmitter = new RuntimeTraceBus({
    level: 2,
    runId: "run-1",
    pid: 123,
    now: () => `2026-05-19T14:32:0${nowCalls++}.000Z`,
    sinks: [badSink, goodSink],
    onSinkError: (error) => errors.push(error),
  });

  trace.emit({ minLevel: 3, source: "skip", event: "too-noisy" });
  trace.emit({
    minLevel: 1,
    source: "agent",
    event: "start",
    chatId: "chat-1",
    userId: "user-1",
    taskId: "task-1",
    jobId: "job-1",
    toolName: "shell",
    toolCallId: "tool-call-1",
    durationMs: 42,
    payload: { authorization: "Bearer secret-token", safe: "ok" },
  });
  trace.emit({
    minLevel: 2,
    source: "agent",
    event: "fail",
    tags: ["important"],
    error: { message: "bad sk-ant-api03-secret", token: "secret" },
  });

  expect(received).toHaveLength(2);
  expect(received.map((event) => event.seq)).toEqual([1, 2]);
  expect(received[0]).toMatchObject({
    ts: "2026-05-19T14:32:00.000Z",
    runId: "run-1",
    pid: 123,
    minLevel: 1,
    source: "agent",
    event: "start",
    chatId: "chat-1",
    userId: "user-1",
    taskId: "task-1",
    jobId: "job-1",
    toolName: "shell",
    toolCallId: "tool-call-1",
    durationMs: 42,
    tags: [],
    payload: { authorization: "[REDACTED]", safe: "ok" },
  });
  expect(received[1]!.tags).toEqual(["important"]);
  expect(received[1]!.error).toEqual({ message: "bad [REDACTED]", token: "[REDACTED]" });
  expect(errors).toHaveLength(2);
  expect(errors[0]!.message).toBe("sink exploded");
});
