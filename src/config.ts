import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function isPlaceholderValue(value: string): boolean {
  const normalized = value.trim();
  return normalized.endsWith("...") || normalized.includes("telegram-bot-token");
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const dataDir = resolve(env("DATA_DIR", "./data"));
const dbPath = resolve(env("DB_PATH", `${dataDir}/agent.db`));
const historyDir = resolve(`${dataDir}/history`);
const memoryDir = resolve(`${dataDir}/memory`);
const memoryScenarioDir = resolve(`${memoryDir}/scenarios`);
const memoryRefsDir = resolve(`${memoryDir}/refs`);
const memoryCanvasDir = resolve(`${memoryDir}/canvases`);
const mcpConfigPath = resolve(env("MCP_CONFIG_PATH", "./mcp.servers.json"));
const tencentMemoryVendorDir = resolve(env("TENCENT_MEMORY_VENDOR_DIR", "./vendor/tencentdb-agent-memory/TencentDB-Agent-Memory-0.3.4"));

for (const dir of [
  dataDir,
  historyDir,
  memoryDir,
  memoryScenarioDir,
  memoryRefsDir,
  memoryCanvasDir,
  dirname(dbPath),
  dirname(tencentMemoryVendorDir),
]) {
  mkdirSync(dir, { recursive: true });
}

export const config = {
  telegram: {
    botToken: env("BOT_TOKEN"),
  },
  llm: {
    provider: env("LLM_PROVIDER", "openai") as "openai" | "anthropic",
    openai: {
      apiKey: env("OPENAI_API_KEY"),
      baseURL: env("OPENAI_BASE_URL", "https://api.openai.com/v1"),
      model: env("OPENAI_MODEL", "gpt-4.1-mini"),
    },
    anthropic: {
      apiKey: env("ANTHROPIC_API_KEY"),
      model: env("ANTHROPIC_MODEL", "claude-sonnet-4-5"),
    },
  },
  agent: {
    maxToolIterations: intEnv("MAX_TOOL_ITERATIONS", 6),
    maxRecentMessages: intEnv("MAX_RECENT_MESSAGES", 12),
  },
  storage: {
    dataDir,
    dbPath,
    historyDir,
    memoryDir,
    memoryScenarioDir,
    memoryRefsDir,
    memoryCanvasDir,
    mcpConfigPath,
  },
  tencentMemory: {
    releaseUrl: env("TENCENT_MEMORY_RELEASE_URL", "https://github.com/Tencent/TencentDB-Agent-Memory/archive/refs/tags/v0.3.4.zip"),
    version: env("TENCENT_MEMORY_VERSION", "0.3.4"),
    vendorDir: tencentMemoryVendorDir,
    mode: env("TENCENT_MEMORY_MODE", "local") as "local" | "vendor-reference",
  },
  memory: {
    maintenanceCron: env("MEMORY_MAINTENANCE_CRON", "*/10 * * * *"),
    recallStrategy: env("MEMORY_RECALL_STRATEGY", "hybrid") as "keyword" | "hybrid",
    recallMaxResults: intEnv("MEMORY_RECALL_MAX_RESULTS", 5),
    pipelineEveryNConversations: intEnv("MEMORY_PIPELINE_EVERY_N_CONVERSATIONS", 5),
    extractionMaxMemoriesPerSession: intEnv("MEMORY_EXTRACTION_MAX_MEMORIES", 20),
    personaTriggerEveryN: intEnv("MEMORY_PERSONA_TRIGGER_EVERY_N", 50),
    l2MinIntervalSec: intEnv("MEMORY_L2_MIN_INTERVAL_SEC", 900),
    l1IdleTimeoutSec: intEnv("MEMORY_L1_IDLE_TIMEOUT_SEC", 600),
    enableDedup: boolEnv("MEMORY_ENABLE_DEDUP", true),
    offloadEnabled: boolEnv("MEMORY_OFFLOAD_ENABLED", true),
    offloadMinChars: intEnv("MEMORY_OFFLOAD_MIN_CHARS", 2500),
    offloadSummaryChars: intEnv("MEMORY_OFFLOAD_SUMMARY_CHARS", 900),
  },
  autonomous: {
    cron: env("AUTONOMOUS_CRON", "*/10 * * * *"),
    minIntervalSec: intEnv("AUTONOMOUS_MIN_INTERVAL_SEC", 600),
    maxJobsPerTick: intEnv("AUTONOMOUS_MAX_JOBS_PER_TICK", 20),
  },
};

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
    memory: {
      maintenanceCron: config.memory.maintenanceCron,
      recallStrategy: config.memory.recallStrategy,
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
