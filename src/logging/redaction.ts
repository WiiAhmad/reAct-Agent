const REDACTED = "[REDACTED]";

const API_KEY_PATTERN = /sk-(?:ant-api\d{2}|proj|[A-Za-z0-9])[-_A-Za-z0-9]{6,}/g;
const BEARER_TOKEN_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;

function isSecretKey(key: string): boolean {
  const normalized = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return (
    normalized === "token" ||
    normalized === "apikey" ||
    normalized === "authorization" ||
    normalized === "secret" ||
    normalized === "secretkey" ||
    normalized === "privatekey" ||
    normalized === "accesskey" ||
    normalized === "password" ||
    normalized.endsWith("token") ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("secretkey") ||
    normalized.endsWith("privatekey") ||
    normalized.endsWith("accesskey")
  );
}

function redactString(input: string): string {
  return input
    .replace(BEARER_TOKEN_PATTERN, `$1${REDACTED}`)
    .replace(API_KEY_PATTERN, REDACTED);
}

export function redactSecrets<T>(input: T): T {
  return redactValue(input, new WeakSet()) as T;
}

function redactValue(input: unknown, ancestors: WeakSet<object>): unknown {
  if (typeof input === "string") {
    return redactString(input);
  }

  if (input === null || typeof input !== "object") {
    return input;
  }

  if (input instanceof Date) {
    return input;
  }

  if (ancestors.has(input)) {
    return "[Circular]";
  }
  ancestors.add(input);

  try {
    if (Array.isArray(input)) {
      return input.map((item) => redactValue(item, ancestors));
    }

    if (input instanceof Error) {
      return redactError(input);
    }

    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      output[key] = isSecretKey(key) ? REDACTED : redactValue(value, ancestors);
    }
    return output;
  } finally {
    ancestors.delete(input);
  }
}

function redactError(error: Error): Record<string, unknown> {
  const output: Record<string, unknown> = {
    name: redactString(error.name),
    message: redactString(error.message),
  };

  if (typeof error.stack === "string") {
    output.stack = redactString(error.stack);
  }

  return output;
}
