import { mkdirSync } from "node:fs";
import { dirname, resolve as nodeResolve } from "node:path";

type ConfigSource = Record<string, string | undefined>;

function resolvePath(path: string): string {
  return nodeResolve(path).replace(/\\/g, "/");
}

function env(source: ConfigSource, name: string, fallback = ""): string {
  return (source[name] ?? fallback).trim();
}

function isPlaceholderValue(value: string): boolean {
  const normalized = value.trim();
  return normalized.endsWith("...") || normalized.includes("telegram-bot-token");
}

function boolEnv(source: ConfigSource, name: string, fallback: boolean): boolean {
  const raw = source[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function intEnv(source: ConfigSource, name: string, fallback: number): number {
  const raw = source[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function enumEnv<const T extends string>(source: ConfigSource, name: string, fallback: T, allowed: readonly T[]): T {
  const raw = env(source, name, fallback);
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

export function parseConfig(source: ConfigSource) {
  const dataDir = resolvePath(env(source, "DATA_DIR", "./data"));
  const dbPath = resolvePath(env(source, "DB_PATH", `${dataDir}/agent.db`));
  const historyDir = resolvePath(`${dataDir}/history`);
  const memoryDir = resolvePath(`${dataDir}/memory`);
  const memoryScenarioDir = resolvePath(`${memoryDir}/scenarios`);
  const memoryRefsDir = resolvePath(`${memoryDir}/refs`);
  const memoryCanvasDir = resolvePath(`${memoryDir}/canvases`);
  const memoryJsonlExportDir = resolvePath(env(source, "MEMORY_JSONL_EXPORT_DIR", `${memoryDir}/jsonl`));
  const memoryTaskCanvasDir = resolvePath(env(source, "MEMORY_TASK_CANVAS_DIR", `${memoryDir}/task-canvases`));
  const memoryGeneratedSkillsDir = resolvePath(env(source, "MEMORY_L4_SKILLS_DIR", `${memoryDir}/skills`));

  return {
    app: {
      timezone: env(source, "APP_TIMEZONE", "Asia/Jakarta"),
      locale: env(source, "APP_LOCALE", "id-ID"),
    },
    telegram: {
      botToken: env(source, "BOT_TOKEN"),
    },
    llm: {
      provider: env(source, "LLM_PROVIDER", "openai") as "openai" | "anthropic",
      openai: {
        apiKey: env(source, "OPENAI_API_KEY"),
        baseURL: env(source, "OPENAI_BASE_URL", "https://api.openai.com/v1"),
        model: env(source, "OPENAI_MODEL", "gpt-4.1-mini"),
      },
      anthropic: {
        apiKey: env(source, "ANTHROPIC_API_KEY"),
        model: env(source, "ANTHROPIC_MODEL", "claude-sonnet-4-5"),
      },
    },
    agent: {
      maxToolIterations: intEnv(source, "MAX_TOOL_ITERATIONS", 6),
      maxRecentMessages: intEnv(source, "MAX_RECENT_MESSAGES", 12),
    },
    storage: {
      dataDir,
      dbPath,
      historyDir,
      memoryDir,
      memoryScenarioDir,
      memoryRefsDir,
      memoryCanvasDir,
      memoryJsonlExportDir,
      memoryTaskCanvasDir,
      memoryGeneratedSkillsDir,
    },
    memory: {
      maintenanceCron: env(source, "MEMORY_MAINTENANCE_CRON", "*/10 * * * *"),
      recallMaxResults: intEnv(source, "MEMORY_RECALL_MAX_RESULTS", 5),
      offloadEnabled: boolEnv(source, "MEMORY_OFFLOAD_ENABLED", true),
      offloadMinChars: intEnv(source, "MEMORY_OFFLOAD_MIN_CHARS", 2500),
      offloadSummaryChars: intEnv(source, "MEMORY_OFFLOAD_SUMMARY_CHARS", 900),
      sqliteVecEnabled: boolEnv(source, "MEMORY_SQLITE_VEC_ENABLED", true),
      jsonlExportEnabled: boolEnv(source, "MEMORY_JSONL_EXPORT_ENABLED", false),
      l15: {
        enabled: boolEnv(source, "MEMORY_L15_ENABLED", true),
        mode: enumEnv(source, "MEMORY_L15_MODE", "hybrid", ["rules", "llm", "hybrid"]),
        recentMessages: intEnv(source, "MEMORY_L15_RECENT_MESSAGES", 6),
        historyTaskLimit: intEnv(source, "MEMORY_L15_HISTORY_TASK_LIMIT", 10),
        maxCanvasChars: intEnv(source, "MEMORY_L15_MAX_CANVAS_CHARS", 12000),
        safeFallback: enumEnv(source, "MEMORY_L15_SAFE_FALLBACK", "short", ["short"]),
      },
      l4: {
        enabled: boolEnv(source, "MEMORY_L4_ENABLED", true),
        mode: enumEnv(source, "MEMORY_L4_MODE", "local", ["local"]),
        requireCompletedTask: boolEnv(source, "MEMORY_L4_REQUIRE_COMPLETED_TASK", false),
        maxEvidenceEntries: intEnv(source, "MEMORY_L4_MAX_EVIDENCE_ENTRIES", 80),
        maxCanvasChars: intEnv(source, "MEMORY_L4_MAX_CANVAS_CHARS", 20000),
        maxSkillChars: intEnv(source, "MEMORY_L4_MAX_SKILL_CHARS", 20000),
      },
    },
    autonomous: {
      cron: env(source, "AUTONOMOUS_CRON", "*/10 * * * *"),
      minIntervalSec: intEnv(source, "AUTONOMOUS_MIN_INTERVAL_SEC", 600),
      maxJobsPerTick: intEnv(source, "AUTONOMOUS_MAX_JOBS_PER_TICK", 20),
    },
    scheduler: {
      tickCron: env(source, "SCHEDULER_TICK_CRON", "* * * * *"),
      maxItemsPerTick: intEnv(source, "SCHEDULER_MAX_ITEMS_PER_TICK", 20),
    },
  };
}

export const config = parseConfig(process.env);

for (const dir of [
  config.storage.dataDir,
  config.storage.historyDir,
  config.storage.memoryDir,
  config.storage.memoryScenarioDir,
  config.storage.memoryRefsDir,
  config.storage.memoryCanvasDir,
  config.storage.memoryJsonlExportDir,
  config.storage.memoryTaskCanvasDir,
  config.storage.memoryGeneratedSkillsDir,
  dirname(config.storage.dbPath),
]) {
  mkdirSync(dir, { recursive: true });
}

function summarizeApiKey(value: string) {
  if (!value) {
    return { present: false, length: 0, format: "missing" };
  }

  if (value.startsWith("sk-ant-")) {
    return { present: true, length: value.length, format: "anthropic" };
  }

  if (value.startsWith("sk-proj-")) {
    return { present: true, length: value.length, format: "openai-project" };
  }

  if (value.startsWith("sk-")) {
    return { present: true, length: value.length, format: "openai" };
  }

  return { present: true, length: value.length, format: "custom" };
}

export function getRuntimeConfigSummary() {
  const activeApiKey = config.llm.provider === "anthropic" ? config.llm.anthropic.apiKey : config.llm.openai.apiKey;

  return {
    app: {
      timezone: config.app.timezone,
      locale: config.app.locale,
    },
    telegram: {
      hasBotToken: Boolean(config.telegram.botToken),
    },
    llm: {
      provider: config.llm.provider,
      model: config.llm.provider === "anthropic" ? config.llm.anthropic.model : config.llm.openai.model,
      baseURL: config.llm.provider === "anthropic" ? "https://api.anthropic.com" : config.llm.openai.baseURL,
      apiKey: summarizeApiKey(activeApiKey),
    },
    autonomous: {
      cron: config.autonomous.cron,
      minIntervalSec: config.autonomous.minIntervalSec,
    },
    scheduler: {
      tickCron: config.scheduler.tickCron,
      maxItemsPerTick: config.scheduler.maxItemsPerTick,
    },
    storage: {
      dataDir: config.storage.dataDir,
      dbPath: config.storage.dbPath,
      historyDir: config.storage.historyDir,
      memoryDir: config.storage.memoryDir,
      memoryScenarioDir: config.storage.memoryScenarioDir,
      memoryRefsDir: config.storage.memoryRefsDir,
      memoryCanvasDir: config.storage.memoryCanvasDir,
      memoryJsonlExportDir: config.storage.memoryJsonlExportDir,
      memoryTaskCanvasDir: config.storage.memoryTaskCanvasDir,
      memoryGeneratedSkillsDir: config.storage.memoryGeneratedSkillsDir,
    },
    memory: {
      maintenanceCron: config.memory.maintenanceCron,
      sqliteVecEnabled: config.memory.sqliteVecEnabled,
      jsonlExportEnabled: config.memory.jsonlExportEnabled,
      l15: config.memory.l15,
      l4: config.memory.l4,
    },
  };
}

export function assertRuntimeConfig() {
  if (!config.telegram.botToken) {
    throw new Error("Missing BOT_TOKEN in .env");
  }

  if (isPlaceholderValue(config.telegram.botToken)) {
    throw new Error("BOT_TOKEN still uses the placeholder value from .env.example");
  }

  if (config.llm.provider !== "openai" && config.llm.provider !== "anthropic") {
    throw new Error(`Invalid LLM_PROVIDER=\"${config.llm.provider}\". Use \"openai\" or \"anthropic\".`);
  }

  if (config.llm.provider === "openai") {
    if (!config.llm.openai.apiKey) {
      throw new Error("Missing OPENAI_API_KEY in .env");
    }

    if (isPlaceholderValue(config.llm.openai.apiKey)) {
      throw new Error("OPENAI_API_KEY still uses the placeholder value from .env.example. Set a real key or switch LLM_PROVIDER=anthropic.");
    }

    if (config.llm.openai.apiKey.startsWith("sk-ant-")) {
      throw new Error("OPENAI_API_KEY looks like an Anthropic key. Set LLM_PROVIDER=anthropic and move the key to ANTHROPIC_API_KEY.");
    }
  }

  if (config.llm.provider === "anthropic") {
    if (!config.llm.anthropic.apiKey) {
      throw new Error("Missing ANTHROPIC_API_KEY in .env");
    }

    if (isPlaceholderValue(config.llm.anthropic.apiKey)) {
      throw new Error("ANTHROPIC_API_KEY still uses the placeholder value from .env.example. Set a real key or switch LLM_PROVIDER=openai.");
    }

    if (config.llm.anthropic.apiKey.startsWith("sk-proj-") || (config.llm.anthropic.apiKey.startsWith("sk-") && !config.llm.anthropic.apiKey.startsWith("sk-ant-"))) {
      throw new Error("ANTHROPIC_API_KEY looks like an OpenAI key. Set LLM_PROVIDER=openai and move the key to OPENAI_API_KEY.");
    }
  }
}
