import type { RuntimeCliArgs, RuntimeLogLevel } from "./types";

const VALID_LOG_LEVELS = new Set(["1", "2", "3"]);

function parseLogLevel(value: string): RuntimeLogLevel {
  if (!VALID_LOG_LEVELS.has(value)) {
    throw new Error(`Invalid --log value "${value}". Use 1, 2, or 3.`);
  }

  return Number(value) as RuntimeLogLevel;
}

export function parseRuntimeCliArgs(argv: string[]): RuntimeCliArgs {
  const parsed: RuntimeCliArgs = { migrateOnly: false };
  let sawLog = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--migrate-only") {
      parsed.migrateOnly = true;
      continue;
    }

    if (arg === "--log") {
      if (sawLog) {
        throw new Error("Use --log only once.");
      }
      sawLog = true;

      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error('Missing value after "--log". Use 1, 2, or 3.');
      }

      parsed.logLevel = parseLogLevel(value);
      index += 1;
      continue;
    }

    if (arg?.startsWith("--log=")) {
      if (sawLog) {
        throw new Error("Use --log only once.");
      }
      sawLog = true;
      parsed.logLevel = parseLogLevel(arg.slice("--log=".length));
    }
  }

  return parsed;
}
