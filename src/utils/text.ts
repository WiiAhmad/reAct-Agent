export function truncateText(input: string, max = 6000): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max)}\n...[truncated ${input.length - max} chars]`;
}

export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

export function splitTelegramMessage(text: string, limit = 3900): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const idx = Math.max(rest.lastIndexOf("\n", limit), rest.lastIndexOf(" ", limit));
    const cut = idx > limit * 0.5 ? idx : limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function ftsQuery(input: string): string {
  const terms = input
    .replace(/["'`*()\[\]{}:^~\\]/g, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 12);

  if (terms.length === 0) return "";
  return terms.map((term) => `"${term}"`).join(" OR ");
}
