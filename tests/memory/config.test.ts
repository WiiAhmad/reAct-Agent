import { expect, test } from "bun:test";
import { parseConfig } from "../../src/config";

test("parseConfig defaults to local-first SQLite memory settings", () => {
  const runtime = parseConfig({
    BOT_TOKEN: "123:abc",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
  });

  expect(runtime.app).toEqual({ timezone: "Asia/Jakarta", locale: "id-ID" });
  expect(runtime.memory.sqliteVecEnabled).toBe(true);
  expect(runtime.memory.jsonlExportEnabled).toBe(false);
  expect(runtime.memory.retentionDays).toBe(30);
  expect(runtime.memory.l15).toEqual({
    enabled: true,
    mode: "hybrid",
    recentMessages: 6,
    historyTaskLimit: 10,
    maxCanvasChars: 12000,
    safeFallback: "short",
  });
  expect(runtime.memory.l4).toEqual({
    enabled: true,
    mode: "local",
    requireCompletedTask: false,
    maxEvidenceEntries: 80,
    maxCanvasChars: 20000,
    maxSkillChars: 20000,
  });
  expect(runtime.storage.memoryJsonlExportDir.endsWith("data/memory/jsonl")).toBe(true);
  expect(runtime.storage.memoryTaskCanvasDir.endsWith("data/memory/task-canvases")).toBe(true);
  expect(runtime.storage.memoryGeneratedSkillsDir.endsWith("data/memory/skills")).toBe(true);
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

test("parseConfig applies app and memory offload pipeline overrides", () => {
  const runtime = parseConfig({
    BOT_TOKEN: "123:abc",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
    DATA_DIR: "./tmp-data",
    APP_TIMEZONE: "UTC",
    APP_LOCALE: "en-US",
    MEMORY_L15_ENABLED: "false",
    MEMORY_L15_MODE: "rules",
    MEMORY_L15_RECENT_MESSAGES: "8",
    MEMORY_L15_HISTORY_TASK_LIMIT: "12",
    MEMORY_L15_MAX_CANVAS_CHARS: "3456",
    MEMORY_L15_SAFE_FALLBACK: "short",
    MEMORY_RETENTION_DAYS: "14",
    MEMORY_TASK_CANVAS_DIR: "./custom/task-canvases",
    MEMORY_L4_ENABLED: "false",
    MEMORY_L4_MODE: "local",
    MEMORY_L4_SKILLS_DIR: "./custom/skills",
    MEMORY_L4_REQUIRE_COMPLETED_TASK: "true",
    MEMORY_L4_MAX_EVIDENCE_ENTRIES: "20",
    MEMORY_L4_MAX_CANVAS_CHARS: "4567",
    MEMORY_L4_MAX_SKILL_CHARS: "5678",
  });

  expect(runtime.app).toEqual({ timezone: "UTC", locale: "en-US" });
  expect(runtime.memory.retentionDays).toBe(14);
  expect(runtime.memory.l15).toEqual({
    enabled: false,
    mode: "rules",
    recentMessages: 8,
    historyTaskLimit: 12,
    maxCanvasChars: 3456,
    safeFallback: "short",
  });
  expect(runtime.memory.l4).toEqual({
    enabled: false,
    mode: "local",
    requireCompletedTask: true,
    maxEvidenceEntries: 20,
    maxCanvasChars: 4567,
    maxSkillChars: 5678,
  });
  expect(runtime.storage.memoryTaskCanvasDir.endsWith("custom/task-canvases")).toBe(true);
  expect(runtime.storage.memoryGeneratedSkillsDir.endsWith("custom/skills")).toBe(true);
});

test("parseConfig exposes semantic offload defaults and overrides", () => {
  const defaults = parseConfig({
    BOT_TOKEN: "123:abc",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
  });

  expect(defaults.memory.l1).toEqual({
    enabled: true,
    mode: "local",
    maxSummaryChars: 900,
    defaultScore: 5,
  });
  expect(defaults.memory.l2).toEqual({
    enabled: true,
    mode: "local",
    triggerMinEntries: 1,
    maxCanvasChars: 12000,
  });
  expect(defaults.memory.taskRecall).toEqual({
    enabled: true,
    maxTasks: 3,
    maxCanvasChars: 2200,
  });

  const overridden = parseConfig({
    BOT_TOKEN: "123:abc",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
    MEMORY_L1_ENABLED: "false",
    MEMORY_L1_MODE: "local",
    MEMORY_L1_MAX_SUMMARY_CHARS: "700",
    MEMORY_L1_DEFAULT_SCORE: "4",
    MEMORY_L2_ENABLED: "false",
    MEMORY_L2_MODE: "local",
    MEMORY_L2_TRIGGER_MIN_ENTRIES: "3",
    MEMORY_L2_MAX_CANVAS_CHARS: "8000",
    MEMORY_TASK_RECALL_ENABLED: "false",
    MEMORY_TASK_RECALL_MAX_TASKS: "2",
    MEMORY_TASK_RECALL_MAX_CANVAS_CHARS: "1500",
  });

  expect(overridden.memory.l1).toEqual({
    enabled: false,
    mode: "local",
    maxSummaryChars: 700,
    defaultScore: 4,
  });
  expect(overridden.memory.l2).toEqual({
    enabled: false,
    mode: "local",
    triggerMinEntries: 3,
    maxCanvasChars: 8000,
  });
  expect(overridden.memory.taskRecall).toEqual({
    enabled: false,
    maxTasks: 2,
    maxCanvasChars: 1500,
  });
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
