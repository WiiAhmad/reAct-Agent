import { expect, test } from "bun:test";
import { recordLlmCall, runWithLlmRequestContext } from "../../src/logging/llm-request-context";
import type { RuntimeTraceInput } from "../../src/logging/types";

test("runWithLlmRequestContext emits one summary with total and byOrigin after success", async () => {
  const events: RuntimeTraceInput[] = [];

  await runWithLlmRequestContext({
    trace: { emit: (event) => events.push(event) },
    requestType: "telegram_message",
    chatId: "c1",
    userId: "u1",
    requestId: "req-1",
  }, async () => {
    expect(recordLlmCall("agent")).toMatchObject({
      requestId: "req-1",
      requestType: "telegram_message",
      chatId: "c1",
      userId: "u1",
      callIndex: 1,
      originCount: 1,
    });
    expect(recordLlmCall("memory.l1")).toMatchObject({
      requestId: "req-1",
      requestType: "telegram_message",
      callIndex: 2,
      originCount: 1,
    });
  });

  const summaryEvents = events.filter((event) => event.event === "request.summary");
  expect(summaryEvents).toHaveLength(1);
  expect(summaryEvents[0]).toEqual(expect.objectContaining({
    source: "llm",
    event: "request.summary",
    requestId: "req-1",
    requestType: "telegram_message",
    chatId: "c1",
    userId: "u1",
    payload: expect.objectContaining({
      outcome: "success",
      llmCallCount: 2,
      byOrigin: { agent: 1, "memory.l1": 1 },
    }),
  }));
});

test("runWithLlmRequestContext emits byOrigin as a stable summary snapshot exactly once", async () => {
  const events: RuntimeTraceInput[] = [];

  await runWithLlmRequestContext({
    trace: {
      emit: (event) => {
        if (event.event === "request.summary") {
          recordLlmCall("after.summary.emit");
        }
        events.push(event);
      },
    },
    requestType: "telegram_message",
    requestId: "req-snapshot",
  }, async () => {
    expect(recordLlmCall("agent")).toMatchObject({
      callIndex: 1,
      originCount: 1,
    });
  });

  const summaryEvents = events.filter((event) => event.event === "request.summary");
  expect(summaryEvents).toHaveLength(1);
  expect(summaryEvents[0]?.payload).toEqual(expect.objectContaining({
    llmCallCount: 1,
    byOrigin: { agent: 1 },
  }));
});

test("recordLlmCall safely counts origins named like object prototype keys", async () => {
  const events: RuntimeTraceInput[] = [];

  await runWithLlmRequestContext({
    trace: { emit: (event) => events.push(event) },
    requestType: "telegram_message",
    requestId: "req-proto",
  }, async () => {
    expect(recordLlmCall("__proto__")).toMatchObject({
      callIndex: 1,
      originCount: 1,
    });
    expect(recordLlmCall("constructor")).toMatchObject({
      callIndex: 2,
      originCount: 1,
    });
  });

  const summaryEvents = events.filter((event) => event.event === "request.summary");
  expect(summaryEvents).toHaveLength(1);
  const payload = summaryEvents[0]?.payload as { byOrigin: Record<string, number> } | undefined;
  const byOrigin = payload?.byOrigin ?? {};
  expect(Object.getPrototypeOf(byOrigin)).toBe(Object.prototype);
  expect(Object.prototype.hasOwnProperty.call(byOrigin, "__proto__")).toBe(true);
  expect(Object.prototype.hasOwnProperty.call(byOrigin, "constructor")).toBe(true);
  expect(byOrigin["__proto__"]).toBe(1);
  expect(byOrigin["constructor"]).toBe(1);
});

test("runWithLlmRequestContext emits error summaries and leaves unscoped calls ungrouped", async () => {
  const events: RuntimeTraceInput[] = [];

  await expect(runWithLlmRequestContext({
    trace: { emit: (event) => events.push(event) },
    requestType: "memory_update",
    userId: "u1",
    requestId: "req-2",
  }, async () => {
    expect(recordLlmCall("memory.l2")).toMatchObject({
      requestId: "req-2",
      requestType: "memory_update",
      callIndex: 1,
      originCount: 1,
    });
    throw new Error("boom");
  })).rejects.toThrow("boom");

  expect(recordLlmCall("agent")).toMatchObject({
    requestId: undefined,
    requestType: "unscoped",
    callIndex: 1,
    originCount: 1,
  });

  expect(events).toContainEqual(expect.objectContaining({
    source: "llm",
    event: "request.summary",
    requestId: "req-2",
    requestType: "memory_update",
    payload: expect.objectContaining({
      outcome: "error",
      llmCallCount: 1,
      byOrigin: { "memory.l2": 1 },
    }),
  }));
});
