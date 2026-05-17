import { expect, test } from "bun:test";
import { parseConfig } from "../../src/config";

test("parseConfig defaults to local-first SQLite memory settings", () => {
  const runtime = parseConfig({
    BOT_TOKEN: "123:abc",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
  });

  expect(runtime.memory.sqliteVecEnabled).toBe(true);
  expect(runtime.memory.jsonlExportEnabled).toBe(false);
  expect(runtime.storage.memoryJsonlExportDir.endsWith("data/memory/jsonl")).toBe(true);
});

test("parseConfig no longer exposes an MCP config path", () => {
  const runtime = parseConfig({
    BOT_TOKEN: "123:abc",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
  });

  expect("mcpConfigPath" in runtime.storage).toBe(false);
});

test("parseConfig can enable JSONL export explicitly", () => {
  const runtime = parseConfig({
    BOT_TOKEN: "123:abc",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
    MEMORY_JSONL_EXPORT_ENABLED: "true",
  });

  expect(runtime.memory.jsonlExportEnabled).toBe(true);
});

test("parseConfig exposes scheduler defaults and overrides", () => {
  const defaults = parseConfig({
    BOT_TOKEN: "123:abc",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
  });

  expect(defaults.scheduler.tickCron).toBe("* * * * *");
  expect(defaults.scheduler.maxItemsPerTick).toBe(20);

  const overridden = parseConfig({
    BOT_TOKEN: "123:abc",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
    SCHEDULER_TICK_CRON: "*/5 * * * *",
    SCHEDULER_MAX_ITEMS_PER_TICK: "7",
  });

  expect(overridden.scheduler.tickCron).toBe("*/5 * * * *");
  expect(overridden.scheduler.maxItemsPerTick).toBe(7);
});
