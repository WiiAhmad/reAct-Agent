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

test("writeDraftSkill writes SKILL.md under given temp dir", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-l4-"));

  try {
    const result = await writeDraftSkill(tempDir, {
      skillName: "debugging-routing",
      skillDescription: "Use when debugging route selection issues",
      skillContent: validSkillContent,
    });

    expect(result.relativePath).toBe("debugging-routing/SKILL.md");
    expect(await readFile(join(tempDir, result.relativePath), "utf8")).toBe(validSkillContent);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("MemoryService.generateSkillDraft writes draft and records metadata", async () => {
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

    const result = await service.generateSkillDraft({ chatId: "chat-1", userId: "user-1", taskId: task.id, skillFocus: "routing" });

    expect(result).toEqual({ ok: true, skillName: "debugging-routing", filePath: "debugging-routing/SKILL.md" });
    expect(await readFile(join(tempDir, "generated-skills", "debugging-routing", "SKILL.md"), "utf8")).toBe(validSkillContent);
    expect(await backend.listGeneratedSkills("user-1", 10)).toEqual([
      expect.objectContaining({
        sourceTaskId: task.id,
        skillName: "debugging-routing",
        skillFocus: "routing",
        skillFilePath: "debugging-routing/SKILL.md",
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
