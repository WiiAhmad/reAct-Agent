import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { SqliteMemoryBackend } from "../../src/memory/backends/sqlite/backend";
import { embedTextToVector, loadSqliteVec } from "../../src/memory/backends/sqlite/vec";
import { RecallService } from "../../src/memory/recall/service";

test("sqlite-vec loads in Bun and can execute a nearest-neighbor query", () => {
  const db = new Database(":memory:");
  loadSqliteVec(db as never);

  db.exec("CREATE VIRTUAL TABLE vec_items USING vec0(embedding float[4])");
  db.query("INSERT INTO vec_items(rowid, embedding) VALUES (?, ?)").run(1, new Float32Array([0.1, 0.1, 0.1, 0.1]));
  db.query("INSERT INTO vec_items(rowid, embedding) VALUES (?, ?)").run(2, new Float32Array([0.9, 0.9, 0.9, 0.9]));

  const rows = db.query(`
    SELECT rowid, distance
    FROM vec_items
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT 1
  `).all(new Float32Array([0.1, 0.1, 0.1, 0.1])) as Array<{ rowid: number; distance: number }>;

  expect(rows[0]?.rowid).toBe(1);
});

test("recall merges keyword and vector-backed atom matches", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-sqlite-vec-"));

  try {
    const db = new Database(":memory:");
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });

    await backend.init();
    const keywordAtom = await backend.upsertMemoryAtom({
      userId: "u1",
      text: "Bun runtime preference",
      importance: 8,
    });
    const vectorAtom = await backend.upsertMemoryAtom({
      userId: "u1",
      text: "JavaScript toolchain preference",
      importance: 6,
    });

    const recall = await new RecallService(backend).recall("u1", "java script runtime", 5, "c1");

    expect(recall.atoms.map((atom) => atom.id)).toEqual(
      expect.arrayContaining([keywordAtom.atom.id, vectorAtom.atom.id]),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Unicode text embeddings stay non-zero for non-Latin input", () => {
  const vector = embedTextToVector("你好 مرحبا Привет");

  expect(Array.from(vector).some((value) => value !== 0)).toBe(true);
});

test("vector search can be disabled by backend config", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-sqlite-vec-"));

  try {
    const db = new Database(":memory:");
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
      sqliteVecEnabled: false,
    });

    await backend.init();
    await backend.upsertMemoryAtom({
      userId: "u1",
      text: "JavaScript toolchain preference",
      importance: 6,
    });

    const atoms = await backend.searchMemoryAtomsByVector("u1", "java script runtime", 5);

    expect(atoms).toEqual([]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("vector search returns the requesting user's atoms even when another user has a closer match", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-sqlite-vec-"));

  try {
    const db = new Database(":memory:");
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });

    await backend.init();
    const targetAtom = await backend.upsertMemoryAtom({
      userId: "u1",
      text: "JavaScript toolchain preference",
      importance: 6,
    });
    await backend.upsertMemoryAtom({
      userId: "u2",
      text: "java script runtime",
      importance: 10,
    });

    const atoms = await backend.searchMemoryAtomsByVector("u1", "java script runtime", 1);

    expect(atoms.map((atom) => atom.id)).toEqual([targetAtom.atom.id]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("vector search does not return unrelated atoms for distant queries", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-sqlite-vec-"));

  try {
    const db = new Database(":memory:");
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });

    await backend.init();
    await backend.upsertMemoryAtom({
      userId: "u1",
      text: "JavaScript toolchain preference",
      importance: 6,
    });

    const atoms = await backend.searchMemoryAtomsByVector("u1", "gardening", 5);

    expect(atoms).toEqual([]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("recall ignores arbitrary vector matches for non-Latin queries", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-sqlite-vec-"));

  try {
    const db = new Database(":memory:");
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });

    await backend.init();
    await backend.upsertMemoryAtom({
      userId: "u1",
      text: "JavaScript toolchain preference",
      importance: 6,
    });

    const recall = await new RecallService(backend).recall("u1", "你好", 5, "c1");

    expect(recall.atoms).toEqual([]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
