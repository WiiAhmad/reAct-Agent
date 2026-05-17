import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

test("README reflects the current Telegram runtime", () => {
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");

  expect(readme).toContain("/start");
  expect(readme).toContain("/menu");
  expect(readme).toContain("/help");
  expect(readme).toContain("@grammyjs/conversations");
  expect(readme).not.toContain("/memory_force");
  expect(readme).not.toContain("/job <prompt>");

  expect(existsSync(new URL("../../docs/architecture.md", import.meta.url))).toBe(true);
  expect(existsSync(new URL("../../docs/telegram-flow.md", import.meta.url))).toBe(true);
  expect(existsSync(new URL("../../docs/memory.md", import.meta.url))).toBe(true);
  expect(existsSync(new URL("../../docs/autonomous-jobs.md", import.meta.url))).toBe(true);
});
