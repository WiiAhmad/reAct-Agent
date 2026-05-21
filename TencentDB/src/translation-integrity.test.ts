import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

const cjkOpenBracket = String.fromCodePoint(0x3010);
const cjkCloseBracket = String.fromCodePoint(0x3011);

test("translated auto-recall module parses successfully", async () => {
  await expect(import("./core/hooks/auto-recall.ts")).resolves.toBeDefined();
});

test("translated offload runtime strings do not keep CJK bracket markers", async () => {
  const files = [
    new URL("./offload/mmd-injector.ts", import.meta.url),
    new URL("./offload/index.ts", import.meta.url),
    new URL("./offload/hooks/after-tool-call.ts", import.meta.url),
    new URL("./offload/hooks/llm-input-l3.ts", import.meta.url),
  ];

  for (const file of files) {
    const content = await readFile(file, "utf-8");
    expect(content).not.toContain(cjkOpenBracket);
    expect(content).not.toContain(cjkCloseBracket);
  }
});

test("scene extraction prompt does not require Chinese scene names", async () => {
  const content = await readFile(new URL("./core/prompts/l1-extraction.ts", import.meta.url), "utf-8");

  expect(content).not.toContain("Use Chinese");
});

test("l2 prompt metadata example stays valid ascii guidance", async () => {
  const content = await readFile(new URL("./offload/local-llm/prompts/l2-prompt.ts", import.meta.url), "utf-8");

  expect(content).not.toContain("progress（0-100）");
  expect(content).toContain('"createdTime": "ISO time"');
});
