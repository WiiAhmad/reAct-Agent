import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("README no longer documents vendor:tencent-memory workflow", () => {
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  expect(readme.includes("vendor:tencent-memory")).toBe(false);
  expect(readme.includes("project-owned memory backend")).toBe(true);
});
