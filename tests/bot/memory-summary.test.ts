import { expect, test } from "bun:test";
import { MemoryService, type MemoryServiceOptions } from "../../src/memory/core/service";
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
    generatedSkillCount: 2,
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
  expect(summary).toContain("# Skill drafts");
  expect(summary).toContain("Generated drafts: 2");
});

test("memory status includes context-offload settings and generated skill count", async () => {
  const options: MemoryServiceOptions = {
    dataDir: "/tmp/grammy-test",
    backendName: "sqlite",
    backendOwner: "test-owner",
    maintenanceCron: "0 * * * *",
    offloadEnabled: true,
    l15: {
      enabled: true,
      mode: "hybrid",
      recentMessages: 6,
      historyTaskLimit: 10,
      maxCanvasChars: 12000,
      safeFallback: "short",
    },
    l4: {
      enabled: true,
      mode: "local",
      requireCompletedTask: true,
      maxEvidenceEntries: 5,
      maxCanvasChars: 12000,
      maxSkillChars: 20000,
    },
    generatedSkillsDir: "/tmp/grammy-test/generated-skills",
  };
  const backend = {
    countConversationTurns: async () => 4,
    countMemoryAtoms: async () => 3,
    countMemoryScenarios: async () => 2,
    countOffloadRefs: async () => 1,
    countGeneratedSkills: async () => 5,
    getPersona: async () => ({ id: 1 }),
    getActiveTaskCanvas: async () => ({ id: 7, filePath: "memory/task-canvases/chat-1/task-7.mmd" }),
    getTaskCanvasFilePath: async () => ({ absolutePath: "/tmp/grammy-test/memory/task-canvases/chat-1/task-7.mmd", relativePath: "memory/task-canvases/chat-1/task-7.mmd" }),
    getTaskCanvas: async () => "graph LR\n",
    getTaskCanvasPath: async () => "/tmp/grammy-test/canvases/chat-1.mmd",
  };
  const service = new MemoryService(backend as never, { async complete() { return { content: "", toolCalls: [] }; } }, options);

  const status = await service.memoryStatus("user-1", "chat-1");

  expect(status).toContain("backend=sqlite");
  expect(status).toContain("owner=test-owner");
  expect(status).toContain("L0 conversations=4");
  expect(status).toContain("L1 atoms=3");
  expect(status).toContain("L2 scenarios=2");
  expect(status).toContain("L3 persona=yes");
  expect(status).toContain("offload_refs=1");
  expect(status).toContain("offload_enabled=true");
  expect(status).toContain("L1.5 enabled=true");
  expect(status).toContain("L1.5 mode=hybrid");
  expect(status).toContain("L4 enabled=true");
  expect(status).toContain("generated_skill_drafts=5");
  expect(status).toContain("task_canvas=memory/task-canvases/chat-1/task-7.mmd");
  expect(status).toContain("memory_maintenance_cron=0 * * * *");
});
