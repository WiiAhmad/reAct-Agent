import { expect, test } from "bun:test";
import { TracedLlmProvider } from "../../src/agent/providers/traced";
import { runWithLlmRequestContext } from "../../src/logging/llm-request-context";
import type { RuntimeTraceInput } from "../../src/logging/types";

test("TracedLlmProvider emits llm.call.complete and request summary for scoped success", async () => {
  const events: RuntimeTraceInput[] = [];
  const provider = new TracedLlmProvider({
    async complete() {
      return { content: "ok", toolCalls: [{ id: "tool-1", name: "clock", arguments: {} }] };
    },
  }, {
    provider: "openai",
    model: "gpt-test",
    trace: { emit: (event) => events.push(event) },
  });

  const response = await runWithLlmRequestContext({
    trace: { emit: (event) => events.push(event) },
    requestType: "telegram_message",
    requestId: "req-provider-1",
    chatId: "c1",
    userId: "u1",
  }, async () => provider.complete({
    messages: [{ role: "user", content: "hello" }],
    tools: [],
    temperature: 0.2,
    meta: { origin: "agent" },
  }));

  expect(response.content).toBe("ok");
  expect(events).toContainEqual(expect.objectContaining({
    source: "llm",
    event: "call.complete",
    requestId: "req-provider-1",
    requestType: "telegram_message",
    chatId: "c1",
    userId: "u1",
    payload: expect.objectContaining({
      provider: "openai",
      model: "gpt-test",
      origin: "agent",
      callIndex: 1,
      messageCount: 1,
      toolCount: 0,
      temperature: 0.2,
      responseToolCalls: 1,
      responseContentLength: 2,
    }),
  }));
  expect(events).toContainEqual(expect.objectContaining({
    source: "llm",
    event: "request.summary",
    payload: expect.objectContaining({ llmCallCount: 1, byOrigin: { agent: 1 } }),
  }));
});

test("TracedLlmProvider counts failed attempts and emits llm.call.error", async () => {
  const events: RuntimeTraceInput[] = [];
  const provider = new TracedLlmProvider({
    async complete() {
      throw new Error("provider down");
    },
  }, {
    provider: "anthropic",
    model: "claude-test",
    trace: { emit: (event) => events.push(event) },
  });

  await expect(runWithLlmRequestContext({
    trace: { emit: (event) => events.push(event) },
    requestType: "autonomous_job",
    requestId: "req-provider-2",
    chatId: "c2",
    userId: "u2",
    jobId: "7",
  }, async () => provider.complete({
    messages: [{ role: "user", content: "hello" }],
    tools: [],
    meta: { origin: "agent" },
  }))).rejects.toThrow("provider down");

  expect(events).toContainEqual(expect.objectContaining({
    source: "llm",
    event: "call.error",
    requestId: "req-provider-2",
    requestType: "autonomous_job",
    chatId: "c2",
    userId: "u2",
    jobId: "7",
    payload: expect.objectContaining({
      provider: "anthropic",
      model: "claude-test",
      origin: "agent",
      callIndex: 1,
      messageCount: 1,
      toolCount: 0,
      temperature: undefined,
    }),
  }));
  expect(events).toContainEqual(expect.objectContaining({
    source: "llm",
    event: "request.summary",
    payload: expect.objectContaining({ outcome: "error", llmCallCount: 1, byOrigin: { agent: 1 } }),
  }));
});

test("TracedLlmProvider emits unscoped call events without a request summary", async () => {
  const events: RuntimeTraceInput[] = [];
  const provider = new TracedLlmProvider({
    async complete() {
      return { content: "ok", toolCalls: [] };
    },
  }, {
    provider: "openai",
    model: "gpt-test",
    trace: { emit: (event) => events.push(event) },
  });

  await provider.complete({
    messages: [{ role: "user", content: "hello" }],
    tools: [],
  });

  expect(events).toContainEqual(expect.objectContaining({
    source: "llm",
    event: "call.complete",
    requestType: "unscoped",
    payload: expect.objectContaining({ origin: "unknown", callIndex: 1 }),
  }));
  expect(events.some((event) => event.source === "llm" && event.event === "request.summary")).toBe(false);
});
