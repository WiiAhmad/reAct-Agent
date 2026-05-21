import { expect, test } from "bun:test";
import { buildRecallPromptSections } from "../../src/memory/recall/context";

test("buildRecallPromptSections keeps stable memory separate from dynamic recall", () => {
  const sections = buildRecallPromptSections({
    persona: "# Persona\nPrefers Bun runtime.",
    scenarios: [{ id: 1, title: "Runtime", bodyMarkdown: "## Runtime\nUse Bun" }],
    atoms: [{ id: 1, text: "Use Bun for local scripts", importance: 6 }],
    conversations: [{ id: 1, role: "user", content: "Please use Bun.", createdAt: "2026-05-18T00:00:00.000Z" }],
    taskCanvas: undefined,
    taskCanvases: [],
  });

  expect(sections.stableContext).toContain("## L3 Persona");
  expect(sections.stableContext).toContain("## L2 Scenarios");
  expect(sections.dynamicContext).toContain("<relevant-memories>");
  expect(sections.dynamicContext).toContain("Use Bun for local scripts");
});
