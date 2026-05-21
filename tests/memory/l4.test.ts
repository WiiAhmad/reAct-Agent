import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import type { LlmProvider } from "../../src/agent/types";
import { SqliteMemoryBackend } from "../../src/memory/backends/sqlite/backend";
import { migrateSqliteMemory } from "../../src/memory/backends/sqlite/migrate";
import { MemoryService, type MemoryServiceOptions } from "../../src/memory/core/service";
import { parseL4Json, validateGeneratedSkill, writeDraftSkill } from "../../src/memory/offload/l4";

const validSkillContent = [
  "---",
  "name: debugging-routing",
  "description: Use when debugging route selection issues with grounded evidence",
  "---",
  "# Debugging Routing",
  "Use this draft only after reviewing the source task canvas and linked evidence.",
].join("\n");

function makeOptions(tempDir: string, overrides: Partial<MemoryServiceOptions["l4"]> = {}): MemoryServiceOptions {
  return {
    dataDir: tempDir,
    backendName: "sqlite",
    backendOwner: "test",
    maintenanceCron: "0 * * * *",
    retentionDays: 30,
    offloadEnabled: true,
    l15: {
      enabled: false,
      mode: "rules",
      recentMessages: 6,
      historyTaskLimit: 10,
      maxCanvasChars: 12000,
      safeFallback: "short",
    },
    l1: {
      enabled: true,
      mode: "local",
      maxSummaryChars: 900,
      defaultScore: 5,
    },
    l2: {
      enabled: false,
      mode: "local",
      triggerMinEntries: 1,
      maxCanvasChars: 12000,
    },
    taskRecall: {
      enabled: true,
      maxTasks: 3,
      maxCanvasChars: 2200,
    },
    l4: {
      enabled: true,
      mode: "local",
      requireCompletedTask: true,
      maxEvidenceEntries: 5,
      maxCanvasChars: 1000,
      maxSkillChars: 2000,
      ...overrides,
    },
    generatedSkillsDir: join(tempDir, "generated-skills"),
  };
}

function fakeLlm(content: string): LlmProvider {
  return {
    async complete() {
      return { content, toolCalls: [] };
    },
  };
}

test("parseL4Json parses generated skill JSON", () => {
  const parsed = parseL4Json(`Here is the draft:\n\n\`\`\`json\n${JSON.stringify({
    skillName: "debugging-routing",
    skillDescription: "Use when debugging route selection issues",
    skillContent: validSkillContent,
  })}\n\`\`\``);

  expect(parsed).toEqual({
    skillName: "debugging-routing",
    skillDescription: "Use when debugging route selection issues",
    skillContent: validSkillContent,
  });
});

test("validateGeneratedSkill rejects unsafe and invalid skills", () => {
  const base = {
    skillName: "debugging-routing",
    skillDescription: "Use when debugging route selection issues",
    skillContent: validSkillContent,
  };

  expect(validateGeneratedSkill({ ...base, skillName: "bad name" }, { chatId: "chat-123", userId: "user-456" })).toEqual({
    ok: false,
    reason: "Invalid skill name.",
  });
  expect(validateGeneratedSkill({ ...base, skillDescription: "Debug route selection" }, { chatId: "chat-123", userId: "user-456" })).toEqual({
    ok: false,
    reason: "Skill description must start with Use when.",
  });
  expect(
    validateGeneratedSkill({ ...base, skillContent: `${validSkillContent}\nANTHROPIC_API_KEY=sk-ant-test` }, { chatId: "chat-123", userId: "user-456" }),
  ).toEqual({ ok: false, reason: "Skill content appears to contain a secret." });
  expect(validateGeneratedSkill({ ...base, skillContent: `${validSkillContent}\nchat-123` }, { chatId: "chat-123", userId: "user-456" })).toEqual({
    ok: false,
    reason: "Skill content contains raw chat id.",
  });
  expect(validateGeneratedSkill({ ...base, skillContent: `${validSkillContent}\nuser-456` }, { chatId: "chat-123", userId: "user-456" })).toEqual({
    ok: false,
    reason: "Skill content contains raw user id.",
  });
});

test("writeDraftSkill writes SKILL.md under a revisioned draft directory", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-l4-"));

  try {
    const result = await writeDraftSkill(tempDir, {
      skillName: "debugging-routing",
      skillDescription: "Use when debugging route selection issues",
      skillContent: validSkillContent,
    }, "draft-001");

    expect(result.relativePath).toBe("debugging-routing/draft-001/SKILL.md");
    expect(await readFile(join(tempDir, result.relativePath), "utf8")).toBe(validSkillContent);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("writeDraftSkill rejects sibling-prefix path escapes", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-l4-"));
  const skillsDir = join(tempDir, "generated-skills");

  try {
    await expect(writeDraftSkill(skillsDir, {
      skillName: "../generated-skills-evil",
      skillDescription: "Use when debugging route selection issues",
      skillContent: validSkillContent,
    }, "draft-001")).rejects.toThrow("Invalid skill path.");
    expect(await Bun.file(join(tempDir, "generated-skills-evil", "draft-001", "SKILL.md")).exists()).toBe(false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("MemoryService.generateSkillDraft writes repeated same-skill drafts to separate revision directories", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-l4-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
      taskCanvasDir: join(tempDir, "memory", "task-canvases"),
      generatedSkillsDir: join(tempDir, "generated-skills"),
    });
    await backend.init();
    const task = await backend.createTaskCanvas({ chatId: "chat-1", userId: "user-1", label: "Debug routing", status: "completed" });
    await Bun.write(join(tempDir, task.filePath), "graph LR\n  A[route bug] --> B[fix]\n");
    await backend.insertTaskGraphNode({
      chatId: "chat-1",
      userId: "user-1",
      taskId: task.id,
      nodeId: "node-1",
      toolName: "Read",
      args: { file: "src/router.ts" },
      summary: "Found route mismatch",
      resultRef: "memory/refs/node-1.md",
      status: "offloaded",
    });
    await mkdir(join(tempDir, "generated-skills"), { recursive: true });
    const service = new MemoryService(
      backend,
      fakeLlm(JSON.stringify({
        skillName: "debugging-routing",
        skillDescription: "Use when debugging route selection issues with grounded evidence",
        skillContent: validSkillContent,
      })),
      makeOptions(tempDir),
    );

    const first = await service.generateSkillDraft({ chatId: "chat-1", userId: "user-1", taskId: task.id, skillFocus: "routing" });
    const second = await service.generateSkillDraft({ chatId: "chat-1", userId: "user-1", taskId: task.id, skillFocus: "routing" });

    expect(first).toEqual({ ok: true, skillName: "debugging-routing", filePath: "debugging-routing/draft-001/SKILL.md" });
    expect(second).toEqual({ ok: true, skillName: "debugging-routing", filePath: "debugging-routing/draft-002/SKILL.md" });
    expect(await readFile(join(tempDir, "generated-skills", "debugging-routing", "draft-001", "SKILL.md"), "utf8")).toBe(validSkillContent);
    expect(await readFile(join(tempDir, "generated-skills", "debugging-routing", "draft-002", "SKILL.md"), "utf8")).toBe(validSkillContent);
    expect(await backend.countGeneratedSkills("user-1")).toBe(2);
    expect(await backend.countGeneratedSkillsByName("user-1", "debugging-routing")).toBe(2);
    expect(await backend.listGeneratedSkills("user-1", 10)).toEqual([
      expect.objectContaining({
        sourceTaskId: task.id,
        skillName: "debugging-routing",
        skillFocus: "routing",
        skillFilePath: "debugging-routing/draft-002/SKILL.md",
        sourceCanvasFilePath: task.filePath,
        sourceNodeIds: ["node-1"],
        sourceEvidenceIds: ["memory/refs/node-1.md"],
        status: "draft",
      }),
      expect.objectContaining({
        sourceTaskId: task.id,
        skillName: "debugging-routing",
        skillFocus: "routing",
        skillFilePath: "debugging-routing/draft-001/SKILL.md",
        sourceCanvasFilePath: task.filePath,
        sourceNodeIds: ["node-1"],
        sourceEvidenceIds: ["memory/refs/node-1.md"],
        status: "draft",
      }),
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("MemoryService.generateSkillDraft retries draft directory when concurrent calls choose the same starting count", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-l4-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
      taskCanvasDir: join(tempDir, "memory", "task-canvases"),
      generatedSkillsDir: join(tempDir, "generated-skills"),
    });
    await backend.init();
    const task = await backend.createTaskCanvas({ chatId: "chat-1", userId: "user-1", label: "Debug routing", status: "completed" });
    await Bun.write(join(tempDir, task.filePath), "graph LR\n  A[route bug] --> B[fix]\n");
    await backend.insertTaskGraphNode({
      chatId: "chat-1",
      userId: "user-1",
      taskId: task.id,
      nodeId: "node-1",
      toolName: "Read",
      args: { file: "src/router.ts" },
      summary: "Found route mismatch",
      resultRef: "memory/refs/node-1.md",
      status: "offloaded",
    });
    await mkdir(join(tempDir, "generated-skills"), { recursive: true });
    const originalCountGeneratedSkillsByName = backend.countGeneratedSkillsByName.bind(backend);
    let countCalls = 0;
    let releaseCounts!: () => void;
    const bothCountsStarted = new Promise<void>((resolve) => {
      releaseCounts = resolve;
    });
    backend.countGeneratedSkillsByName = async (userId, skillName) => {
      countCalls += 1;
      if (countCalls === 2) releaseCounts();
      await bothCountsStarted;
      return originalCountGeneratedSkillsByName(userId, skillName);
    };
    const service = new MemoryService(
      backend,
      fakeLlm(JSON.stringify({
        skillName: "debugging-routing",
        skillDescription: "Use when debugging route selection issues with grounded evidence",
        skillContent: validSkillContent,
      })),
      makeOptions(tempDir),
    );

    const results = await Promise.all([
      service.generateSkillDraft({ chatId: "chat-1", userId: "user-1", taskId: task.id, skillFocus: "routing" }),
      service.generateSkillDraft({ chatId: "chat-1", userId: "user-1", taskId: task.id, skillFocus: "routing" }),
    ]);

    expect(results).toContainEqual({ ok: true, skillName: "debugging-routing", filePath: "debugging-routing/draft-001/SKILL.md" });
    expect(results).toContainEqual({ ok: true, skillName: "debugging-routing", filePath: "debugging-routing/draft-002/SKILL.md" });
    expect(await readFile(join(tempDir, "generated-skills", "debugging-routing", "draft-001", "SKILL.md"), "utf8")).toBe(validSkillContent);
    expect(await readFile(join(tempDir, "generated-skills", "debugging-routing", "draft-002", "SKILL.md"), "utf8")).toBe(validSkillContent);
    expect(await backend.countGeneratedSkills("user-1")).toBe(2);
    expect(await backend.countGeneratedSkillsByName("user-1", "debugging-routing")).toBe(2);
    expect((await backend.listGeneratedSkills("user-1", 10)).map((skill) => skill.skillFilePath).sort()).toEqual([
      "debugging-routing/draft-001/SKILL.md",
      "debugging-routing/draft-002/SKILL.md",
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("MemoryService.generateSkillDraft rejects invalid output without metadata", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-l4-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
      taskCanvasDir: join(tempDir, "memory", "task-canvases"),
      generatedSkillsDir: join(tempDir, "generated-skills"),
    });
    await backend.init();
    const task = await backend.createTaskCanvas({ chatId: "chat-1", userId: "user-1", label: "Debug routing", status: "completed" });
    await Bun.write(join(tempDir, task.filePath), "graph LR\n  A[route bug]\n");
    const service = new MemoryService(
      backend,
      fakeLlm(JSON.stringify({
        skillName: "bad name",
        skillDescription: "Use when debugging route selection issues",
        skillContent: validSkillContent,
      })),
      makeOptions(tempDir),
    );

    const result = await service.generateSkillDraft({ chatId: "chat-1", userId: "user-1", taskId: task.id });

    expect(result).toEqual({ ok: false, reason: "Invalid skill name." });
    expect(await backend.countGeneratedSkills("user-1")).toBe(0);
    expect(await Bun.file(join(tempDir, "generated-skills", "bad name", "SKILL.md")).exists()).toBe(false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
