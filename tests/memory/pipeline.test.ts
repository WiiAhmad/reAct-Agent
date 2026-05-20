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

test("pipeline tags provider calls with L1/L2/L3 origin metadata", async () => {
  const origins: string[] = [];
  const llm: LlmProvider = {
    async complete(request) {
      origins.push(request.meta?.origin ?? "missing");
      const system = String(request.messages[0]?.content ?? "");
      if (system.includes("L1 extractor")) {
        return { content: JSON.stringify([{ text: "User prefers Bun runtime", importance: 4, source_turn_ids: [1] }]), toolCalls: [] };
      }
      if (system.includes("L2 Scenario aggregator")) {
        return { content: "## Runtime choices\n- atom_id=1 User prefers Bun runtime", toolCalls: [] };
      }
      return { content: "- scenario_id=1 Prefers Bun runtime\n- atom_id=1 User prefers Bun runtime", toolCalls: [] };
    },
  };

  const tempDir = await mkdtemp(join(tmpdir(), "grammy-pipeline-"));
  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });
    const pipeline = new PipelineCoordinator(backend, llm);

    await backend.insertConversationTurn({ chatId: "c1", userId: "u1", role: "user", content: "Please use Bun for this bot.", meta: { mode: "chat" } });
    await pipeline.runMaintenanceForUser("u1", true);

    expect(origins).toEqual(["memory.l1", "memory.l2", "memory.l3"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

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
      historyDir: join(tempDir, "history"),
    });
    const pipeline = new PipelineCoordinator(backend, fakeLlm);

    await backend.insertConversationTurn({ chatId: "c1", userId: "u1", role: "user", content: "Please use Bun for this bot.", meta: { mode: "chat" } });
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
      historyDir: join(tempDir, "history"),
    });
    const pipeline = new PipelineCoordinator(backend, fakeLlm);

    await backend.insertConversationTurn({ chatId: "c1", userId: "u1", role: "user", content: "Please use Bun for this bot.", meta: { mode: "chat" } });
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

test("pipeline emits progress events for L1, L2, and L3", async () => {
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
      historyDir: join(tempDir, "history"),
    });
    const traceEvents: Array<{ source: string; event: string; tags?: string[] }> = [];
    const pipeline = new PipelineCoordinator(backend, fakeLlm, { emit: (event) => traceEvents.push(event) });
    const events: string[] = [];

    await backend.insertConversationTurn({ chatId: "c1", userId: "u1", role: "user", content: "Please use Bun for this bot.", meta: { mode: "chat" } });
    const result = await pipeline.runMaintenanceForUser("u1", true, {
      source: "telegram",
      onProgress: async (event) => {
        events.push(`${event.stage}:${event.status}`);
      },
    });

    expect(result).toEqual({ l1Created: 1, l2ScenarioId: 1, personaUpdated: true });
    expect(events).toEqual([
      "l1:start",
      "l1:complete",
      "l2:start",
      "l2:complete",
      "l3:start",
      "l3:complete",
    ]);
    expect(traceEvents.map((event) => `${event.source}:${event.event}`)).toEqual([
      "memory:pipeline.l1.start",
      "memory:pipeline.l1.complete",
      "memory:pipeline.l2.start",
      "memory:pipeline.l2.complete",
      "memory:pipeline.l3.start",
      "memory:pipeline.l3.complete",
    ]);
    expect(traceEvents.every((event) => event.tags?.includes("new-memory-stack"))).toBe(true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("pipeline ignores progress reporter failures", async () => {
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
      historyDir: join(tempDir, "history"),
    });
    const pipeline = new PipelineCoordinator(backend, fakeLlm);
    const events: string[] = [];

    await backend.insertConversationTurn({ chatId: "c1", userId: "u1", role: "user", content: "Please use Bun for this bot.", meta: { mode: "chat" } });
    const result = await pipeline.runMaintenanceForUser("u1", true, {
      source: "telegram",
      onProgress: async (event) => {
        events.push(`${event.stage}:${event.status}`);
        throw new Error("reporter failed");
      },
    });

    expect(result).toEqual({ l1Created: 1, l2ScenarioId: 1, personaUpdated: true });
    expect(events).toEqual([
      "l1:start",
      "l1:complete",
      "l2:start",
      "l2:complete",
      "l3:start",
      "l3:complete",
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("pipeline emits skip events when force maintenance has no atoms to aggregate", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-pipeline-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });
    const pipeline = new PipelineCoordinator(backend, fakeLlm);
    const events: string[] = [];

    const result = await pipeline.runMaintenanceForUser("u1", true, {
      source: "scheduler",
      onProgress: async (event) => {
        events.push(`${event.stage}:${event.status}:${event.reason ?? ""}`);
      },
    });

    expect(result).toEqual({ l1Created: 0, l2ScenarioId: undefined, personaUpdated: false });
    expect(events).toEqual([
      "l1:start:",
      "l1:complete:",
      "l2:skip:no_atoms",
      "l3:skip:no_scenario",
    ]);
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
      historyDir: join(tempDir, "history"),
    });
    const invalidJsonLlm: LlmProvider = {
      async complete() {
        return { content: "not json at all", toolCalls: [] };
      },
    };
    const pipeline = new PipelineCoordinator(backend, invalidJsonLlm);

    await backend.insertConversationTurn({ chatId: "c1", userId: "u1", role: "user", content: "Remember I use Bun.", meta: { mode: "chat" } });

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
      historyDir: join(tempDir, "history"),
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

    await backend.insertConversationTurn({ chatId: "c1", userId: "u1", role: "user", content: "My name is Wii.", meta: { mode: "chat" } });
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
