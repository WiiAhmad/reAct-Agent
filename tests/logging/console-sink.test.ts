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
