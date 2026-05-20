import { expect, test } from "bun:test";
import { buildL1SystemPrompt } from "../../src/memory/prompts/l1";
import { buildL2SystemPrompt } from "../../src/memory/prompts/l2";
import { buildL3SystemPrompt } from "../../src/memory/prompts/l3";

test("L1 prompt defines a strict durable extraction contract", () => {
  const prompt = buildL1SystemPrompt();

  expect(prompt).toContain("Role:");
  expect(prompt).toContain("Objective:");
  expect(prompt).toContain("What to keep:");
  expect(prompt).toContain("What to exclude:");
  expect(prompt).toContain("Normalization and dedupe:");
  expect(prompt).toContain("Output contract:");
  expect(prompt).toContain("Return ONLY a valid JSON array.");
  expect(prompt).toContain('"text": string');
  expect(prompt).toContain("importance");
  expect(prompt).toContain("source_turn_ids");
  expect(prompt).toContain("Example to extract:");
  expect(prompt).toContain("Example to ignore:");
});

test("L2 prompt defines a grounded markdown aggregation contract", () => {
  const prompt = buildL2SystemPrompt();

  expect(prompt).toContain("Role:");
  expect(prompt).toContain("Objective:");
  expect(prompt).toContain("Grounding rules:");
  expect(prompt).toContain("Output contract:");
  expect(prompt).toContain("Example:");
  expect(prompt).toContain("Return markdown only.");
  expect(prompt).toContain("Preserve atom_id evidence references.");
  expect(prompt).toContain("Do not invent facts");
});

test("L3 prompt defines a grounded persona distillation contract", () => {
  const prompt = buildL3SystemPrompt();

  expect(prompt).toContain("Role:");
  expect(prompt).toContain("Objective:");
  expect(prompt).toContain("Grounding rules:");
  expect(prompt).toContain("Output contract:");
  expect(prompt).toContain("Example:");
  expect(prompt).toContain("Return markdown only.");
  expect(prompt).toContain("scenario_id");
  expect(prompt).toContain("atom_id");
  expect(prompt).toContain("Do not invent facts or infer sensitive attributes.");
});
