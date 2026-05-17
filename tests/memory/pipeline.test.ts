import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { migrateSqliteMemory } from "../../src/memory/backends/sqlite/migrate";
import { SqliteMemoryBackend } from "../../src/memory/backends/sqlite/backend";
import { InteractionLogService } from "../../src/memory/events/service";
import { PipelineCoordinator } from "../../src/memory/pipeline/coordinator";
import { runL1Pipeline } from "../../src/memory/pipeline/l1";
import type { LlmProvider } from "../../src/agent/types";
import type { NewLineageLink } from "../../src/memory/core/types";

const fakeLlm: LlmProvider = {
  async complete({ messages }) {
    const system = String(messages[0]?.content ?? "");
    if (system.includes("L1 extractor")) {
      return {
        content: JSON.stringify([{ text: "User prefers Bun runtime", importance: 4, source_turn_ids: [1] }]),
        toolCalls: [],
      };
    }
    if (system.includes("L2 Scenario aggregator")) {
      return {
        content: "## Runtime choices\n- atom_id=1 User prefers Bun runtime",
        toolCalls: [],
      };
    }
    return {
      content: "- scenario_id=1 Prefers Bun runtime\n- atom_id=1 User prefers Bun runtime",
      toolCalls: [],
    };
  },
};

test("lineage links allow conversation targets for generic graph traversal", () => {
  const link: NewLineageLink = {
    userId: "u1",
    sourceKind: "memory_atom",
    sourceId: "1",
    targetKind: "conversation",
    targetId: "2",
    linkType: "fallback",
  };

  expect(link.targetKind).toBe("conversation");
});

test("force maintenance recomputes scenario and persona even without new turns", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-pipeline-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });
    const logs = new InteractionLogService(backend, {
      enabled: false,
      exportDir: join(tempDir, "jsonl"),
    });
    const pipeline = new PipelineCoordinator(backend, fakeLlm);

    await logs.logUserMessage({ chatId: "c1", userId: "u1", content: "Please use Bun for this bot.", mode: "chat" });
    const first = await pipeline.runMaintenanceForUser("u1", true);
    const second = await pipeline.runMaintenanceForUser("u1", true);

    expect(first.l2ScenarioId).toBeGreaterThan(0);
    expect(first.personaUpdated).toBe(true);
    expect(second.l1Created).toBe(0);
    expect(second.l2ScenarioId).toBeGreaterThan(0);
    expect(second.personaUpdated).toBe(true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("pipeline produces atoms, scenarios, persona, and lineage links", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-pipeline-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });
    const logs = new InteractionLogService(backend, {
      enabled: false,
      exportDir: join(tempDir, "jsonl"),
    });
    const pipeline = new PipelineCoordinator(backend, fakeLlm);

    await logs.logUserMessage({ chatId: "c1", userId: "u1", content: "Please use Bun for this bot.", mode: "chat" });
    const result = await pipeline.runMaintenanceForUser("u1", true);

    expect(result.l1Created).toBe(1);
    expect(result.l2ScenarioId).toBeGreaterThan(0);
    expect(result.personaUpdated).toBe(true);
    expect(await backend.listLineageTargets("u1", "conversation", "1")).toEqual(
      expect.arrayContaining([expect.objectContaining({ targetKind: "memory_atom" })]),
    );

    const scenarios = db
      .query(`SELECT id, body_markdown FROM memory_scenarios WHERE user_id = ? ORDER BY id ASC`)
      .all("u1") as Array<{ id: number; body_markdown: string }>;
    const persona = db
      .query(`SELECT markdown FROM personas WHERE user_id = ?`)
      .get("u1") as { markdown: string } | null;

    expect(scenarios).toEqual([
      expect.objectContaining({
        id: 1,
        body_markdown: "## Runtime choices\n- atom_id=1 User prefers Bun runtime",
      }),
    ]);
    expect(persona?.markdown).toContain("scenario_id=1");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("pipeline does not advance the L1 checkpoint when L1 returns invalid JSON", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-pipeline-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });
    const logs = new InteractionLogService(backend, {
      enabled: false,
      exportDir: join(tempDir, "jsonl"),
    });
    const invalidJsonLlm: LlmProvider = {
      async complete() {
        return { content: "not json at all", toolCalls: [] };
      },
    };
    const pipeline = new PipelineCoordinator(backend, invalidJsonLlm);

    await logs.logUserMessage({ chatId: "c1", userId: "u1", content: "Remember I use Bun.", mode: "chat" });

    const result = await pipeline.runMaintenanceForUser("u1");

    expect(result).toEqual({ l1Created: 0, l2ScenarioId: undefined, personaUpdated: false });
    expect(await backend.getCheckpoint("u1", "l1_last_conversation_id")).toBeUndefined();
    expect(await backend.listPendingConversationEvidence("u1", 0, 10)).toHaveLength(1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runL1Pipeline counts duplicate L1 outputs as updates instead of new atoms", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-pipeline-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });
    const duplicateExtractionLlm: LlmProvider = {
      async complete() {
        return {
          content: JSON.stringify([
            { text: "User prefers Bun runtime", importance: 4, source_turn_ids: [1] },
            { text: "User prefers Bun runtime", importance: 5, source_turn_ids: [1] },
          ]),
          toolCalls: [],
        };
      },
    };

    const result = await runL1Pipeline(backend, duplicateExtractionLlm, "u1", [
      {
        id: 1,
        chatId: "c1",
        userId: "u1",
        role: "user",
        content: "Please use Bun for this bot.",
        meta: {},
        createdAt: new Date(0).toISOString(),
      },
    ]);

    expect(result.createdAtoms).toBe(1);
    expect(await backend.listMemoryAtoms("u1", 10)).toHaveLength(1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("pipeline collapses canonical atom variants before building the L2 scenario", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-pipeline-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });
    const logs = new InteractionLogService(backend, {
      enabled: false,
      exportDir: join(tempDir, "jsonl"),
    });
    const duplicateVariantLlm: LlmProvider = {
      async complete({ messages }) {
        const system = String(messages[0]?.content ?? "");
        if (system.includes("L1 extractor")) {
          return {
            content: JSON.stringify([
              { text: "User's name is Wii.", importance: 4, source_turn_ids: [1] },
              { text: "User’s name is Wii.", importance: 5, source_turn_ids: [1] },
            ]),
            toolCalls: [],
          };
        }
        if (system.includes("L2 Scenario aggregator")) {
          const atomDigest = String(messages[1]?.content ?? "");
          return {
            content: `## Identity\n${atomDigest.split("\n").filter(Boolean).map((line) => `- ${line}`).join("\n")}`,
            toolCalls: [],
          };
        }
        return {
          content: "- scenario_id=1 Identity\n- atom_id=1 User’s name is Wii.",
          toolCalls: [],
        };
      },
    };
    const pipeline = new PipelineCoordinator(backend, duplicateVariantLlm);

    await logs.logUserMessage({ chatId: "c1", userId: "u1", content: "My name is Wii.", mode: "chat" });
    const result = await pipeline.runMaintenanceForUser("u1", true);

    const atoms = await backend.listMemoryAtoms("u1", 10);
    const scenario = db
      .query(`SELECT body_markdown, atom_ids_json FROM memory_scenarios WHERE user_id = ? ORDER BY id DESC LIMIT 1`)
      .get("u1") as { body_markdown: string; atom_ids_json: string } | null;

    expect(result.l1Created).toBe(1);
    expect(atoms).toHaveLength(1);
    expect(JSON.parse(scenario?.atom_ids_json ?? "[]")).toEqual([1]);
    expect((scenario?.body_markdown.match(/atom_id=/g) ?? [])).toHaveLength(1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
