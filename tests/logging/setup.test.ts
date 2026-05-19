import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupRuntimeLogging } from "../../src/logging/setup";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

test("setupRuntimeLogging skips file tracing when --log is absent", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "runtime-setup-"));
  tempDirs.push(dataDir);

  const result = setupRuntimeLogging({
    argv: [],
    dataDir,
    startedAt: new Date("2026-05-19T14:32:05.123Z"),
    pid: 1234,
  });

  expect(result.cli).toEqual({ migrateOnly: false });
  expect(result.trace).toBeUndefined();
  expect(result.traceFilePath).toBeUndefined();
  expect(existsSync(join(dataDir, "logs"))).toBe(false);
});

test("setupRuntimeLogging creates a level-3 trace file under dataDir logs", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "runtime-setup-"));
  tempDirs.push(dataDir);
  const consoleLines: string[] = [];

  const result = setupRuntimeLogging({
    argv: ["--log=3"],
    dataDir,
    startedAt: new Date("2026-05-19T14:32:05.123Z"),
    pid: 1234,
    consoleWrite: (line) => consoleLines.push(line),
  });

  expect(result.cli).toEqual({ logLevel: 3, migrateOnly: false });
  expect(result.trace).toBeDefined();
  expect(result.traceFilePath).toBe(join(dataDir, "logs", "runtime-20260519T143205Z-p1234.jsonl"));

  result.trace?.emit({ minLevel: 3, source: "app", event: "startup.begin" });

  expect(consoleLines).toHaveLength(1);
  expect(consoleLines[0]).toMatch(/^\[[^\]]+\] #1 L3 app\.startup\.begin$/);
  const contents = await readFile(result.traceFilePath!, "utf8");
  const lines = contents.trimEnd().split("\n");
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]!)).toMatchObject({
    seq: 1,
    runId: "20260519T143205Z-p1234",
    pid: 1234,
    minLevel: 3,
    source: "app",
    event: "startup.begin",
    tags: [],
  });
});
