import { expect, test } from "bun:test";
import type { ProfileRecord } from "../../src/memory/core/store/types";
import { buildInspectMemoryDump, formatInspectMemoryReport } from "../../src/memory/debug/inspect-memory-report";

function profile(overrides: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    id: "profile-1",
    type: "l2",
    userId: "user-1",
    filename: "scenario-1.md",
    content: "# Scenario\nDiscussed Bun runtime.",
    contentMd5: "md5-v1",
    version: 1,
    createdAtMs: 1710000000000,
    updatedAtMs: 1710000000000,
    metadata: {},
    ...overrides,
  };
}

test("buildInspectMemoryDump keeps only the selected user's L2 and L3 content", () => {
  const dump = buildInspectMemoryDump(
    [
      profile({ id: "l2-a", type: "l2", content: "# Scenario\nFirst scenario." }),
      profile({ id: "l3-a", type: "l3", filename: "persona-user-1.md", content: "# Persona\nPrefers Bun." }),
      profile({ id: "l2-b", userId: "user-2", type: "l2", content: "# Scenario\nOther user." }),
    ],
    "user-1",
  );

  expect(dump).toEqual({
    userId: "user-1",
    chatId: null,
    l2: [{ content: "# Scenario\nFirst scenario." }],
    l3: [{ content: "# Persona\nPrefers Bun." }],
  });
});

test("formatInspectMemoryReport prints summary first, full sections, and raw json", () => {
  const report = formatInspectMemoryReport("backend=sqlite\nL2 scenarios=1\nL3 persona=yes", {
    userId: "user-1",
    chatId: "chat-9",
    l2: [{ content: "# Scenario\nMorning planning." }],
    l3: [{ content: "# Persona\nPrefers concise replies." }],
  });

  expect(report).toContain("backend=sqlite\nL2 scenarios=1\nL3 persona=yes");
  expect(report).toContain("--- L2 scenarios ---\n\n#1\n# Scenario\nMorning planning.");
  expect(report).toContain("--- L3 persona ---\n\n# Persona\nPrefers concise replies.");
  expect(report).toContain(`--- raw json ---\n{\n  \"userId\": \"user-1\",\n  \"chatId\": \"chat-9\"`);
});

test("formatInspectMemoryReport prints explicit empty states", () => {
  const report = formatInspectMemoryReport("backend=sqlite", {
    userId: "user-1",
    chatId: null,
    l2: [],
    l3: [],
  });

  expect(report).toContain("No L2 scenarios found.");
  expect(report).toContain("No L3 persona found.");
  expect(report).toContain(`\"chatId\": null`);
});
