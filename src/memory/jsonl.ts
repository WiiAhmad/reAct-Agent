import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function appendJsonl(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

export async function readJsonlTail<T = unknown>(path: string, limit = 50): Promise<T[]> {
  try {
    const raw = await readFile(path, "utf8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}
