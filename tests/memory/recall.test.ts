import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { migrateSqliteMemory } from "../../src/memory/backends/sqlite/migrate";
import { SqliteMemoryBackend } from "../../src/memory/backends/sqlite/backend";
import { RecallService } from "../../src/memory/recall/service";

test("recall falls back through lineage when the direct atom is missing", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-recall-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });

    const scenarioId = await backend.insertMemoryScenario({
      userId: "u1",
      title: "Runtime choices",
      bodyMarkdown: "- atom_id=42 User prefers Bun runtime",
      atomIds: [42],
    });
    await backend.insertLineageLink({
      userId: "u1",
      sourceKind: "memory_atom",
      sourceId: "42",
      targetKind: "memory_scenario",
      targetId: String(scenarioId),
      linkType: "grouped_into",
    });

    const recall = await new RecallService(backend).recall("u1", "Bun runtime", 5, "c1");

    expect(recall.scenarios[0]?.id).toBe(scenarioId);
    expect(recall.atoms).toEqual([]);
    expect(recall.fallbackChain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          missingKind: "memory_atom",
          missingId: "42",
          fallbackKind: "memory_scenario",
          fallbackId: String(scenarioId),
        }),
      ]),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("recall does not emit fallback for an existing atom omitted by atom ranking", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-recall-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });

    const omittedAtom = await backend.upsertMemoryAtom({
      userId: "u1",
      text: "Bun runtime preference",
      importance: 1,
    });
    await backend.upsertMemoryAtom({
      userId: "u1",
      text: "Bun runtime guide",
      importance: 10,
    });

    const scenarioId = await backend.insertMemoryScenario({
      userId: "u1",
      title: "Runtime choices",
      bodyMarkdown: "- atom_id=1 Bun runtime preference recorded",
      atomIds: [omittedAtom.atom.id],
    });
    await backend.insertLineageLink({
      userId: "u1",
      sourceKind: "memory_atom",
      sourceId: String(omittedAtom.atom.id),
      targetKind: "memory_scenario",
      targetId: String(scenarioId),
      linkType: "grouped_into",
    });

    const recall = await new RecallService(backend).recall("u1", "Bun runtime", 1, "c1");

    expect(recall.atoms).toHaveLength(1);
    expect(recall.atoms[0]?.id).not.toBe(omittedAtom.atom.id);
    expect(recall.scenarios.map((scenario) => scenario.id)).toContain(scenarioId);
    expect(recall.fallbackChain).toEqual([]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("searchMemoryScenarios keeps older relevant scenarios searchable", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-recall-"));

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });

    const relevantScenarioId = await backend.insertMemoryScenario({
      userId: "u1",
      title: "Bun runtime preferences",
      bodyMarkdown: "User strongly prefers Bun runtime for local tooling.",
      atomIds: [],
    });

    for (let index = 0; index < 10; index += 1) {
      await backend.insertMemoryScenario({
        userId: "u1",
        title: `Irrelevant scenario ${index + 1}`,
        bodyMarkdown: "This note is about gardening and contains no runtime details.",
        atomIds: [],
      });
    }

    const scenarios = await backend.searchMemoryScenarios("u1", "Bun runtime", 1);

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]?.id).toBe(relevantScenarioId);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
