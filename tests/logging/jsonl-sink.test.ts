import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildRuntimeLogFilePath, createJsonlTraceSink } from "../../src/logging/jsonl-sink";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

test("buildRuntimeLogFilePath uses Windows-safe UTC timestamp and pid under logs directory", () => {
  expect(buildRuntimeLogFilePath("C:/data", new Date("2026-05-19T14:32:05.123Z"), 1234)).toMatch(
    /[\\/]logs[\\/]runtime-20260519T143205Z-p1234\.jsonl$/,
  );
});

test("createJsonlTraceSink creates runtime log file under dataDir logs and appends one JSON object per line", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "runtime-log-"));
  tempDirs.push(dataDir);
  const { filePath, sink } = createJsonlTraceSink({
    dataDir,
    startedAt: new Date("2026-05-19T14:32:05.123Z"),
    pid: 1234,
  });

  sink({ ts: "2026-05-19T14:32:05.123Z", seq: 1, runId: "run-1", pid: 1234, minLevel: 1, source: "test", event: "write", chatId: "chat-1", userId: "user-1", taskId: "task-1", jobId: "job-1", toolName: "shell", toolCallId: "tool-call-1", durationMs: 42, tags: [], payload: { ok: true } });

  expect(filePath).toMatch(/[\\/]logs[\\/]runtime-20260519T143205Z-p1234\.jsonl$/);
  const contents = await readFile(filePath, "utf8");
  const lines = contents.trimEnd().split("\n");
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]!)).toEqual({
    ts: "2026-05-19T14:32:05.123Z",
    seq: 1,
    runId: "run-1",
    pid: 1234,
    minLevel: 1,
    source: "test",
    event: "write",
    chatId: "chat-1",
    userId: "user-1",
    taskId: "task-1",
    jobId: "job-1",
    toolName: "shell",
    toolCallId: "tool-call-1",
    durationMs: 42,
    tags: [],
    payload: { ok: true },
  });
});
