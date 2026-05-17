import { expect, test } from "bun:test";
import { buildRichMemorySummary } from "../../src/bot/ui/renderers";

test("rich memory summary includes status, persona, scenarios, atoms, canvas, and memory update summary", () => {
  const summary = buildRichMemorySummary({
    memoryStatus: ["backend=sqlite", "owner=project"].join("\n"),
    recall: {
      persona: "Persona snapshot",
      atoms: [
        { id: 1, text: "Atom one", importance: 7 },
        { id: 2, text: "Atom two", importance: 3 },
      ],
      scenarios: [
        { id: 7, title: "Scenario A" },
        { id: 8, title: "Scenario B" },
      ],
      taskCanvas: "canvas text",
    },
    memoryUpdateSummary: [
      "Memory update settings for user-1",
      "Enabled: yes",
      "Schedule: Every 24 hours",
      "Last run: never run",
    ].join("\n"),
  });

  expect(summary).toContain("# Memory status");
  expect(summary).toContain("backend=sqlite");
  expect(summary).toContain("# L3 Persona snapshot");
  expect(summary).toContain("Persona snapshot");
  expect(summary).toContain("# L2 Scenarios summary");
  expect(summary).toContain("- #7: Scenario A");
  expect(summary).toContain("- #8: Scenario B");
  expect(summary).toContain("# Top L1 atoms");
  expect(summary).toContain("- #1: Atom one");
  expect(summary).toContain("- #2: Atom two");
  expect(summary).toContain("# Active canvas");
  expect(summary).toContain("Active canvas: yes");
  expect(summary).toContain("# Memory Update summary");
  expect(summary).toContain("Memory update settings for user-1");
});
