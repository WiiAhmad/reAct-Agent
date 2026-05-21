import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrateSqliteMemory } from "../../src/memory/backends/sqlite/migrate";
import { SqliteMemoryStore } from "../../src/memory/backends/sqlite/store";

function seedLegacyTables(db: Database): void {
  db.exec(`
    INSERT INTO conversations (id, chat_id, user_id, role, content, meta_json, created_at)
    VALUES (11, 'chat-1', 'user-1', 'user', 'Remember Ada likes espresso.', '{"mode":"chat"}', '2026-05-18T08:00:00.000Z');

    INSERT INTO memory_atoms (id, user_id, text, canonical_text, importance, source_turn_ids_json, source_layer, created_at, updated_at)
    VALUES (21, 'user-1', 'Ada likes espresso.', 'ada likes espresso', 8, '[11]', 'L1', '2026-05-18T08:01:00.000Z', '2026-05-18T08:02:00.000Z');

    INSERT INTO memory_scenarios (id, user_id, title, body_markdown, atom_ids_json, file_path, created_at, updated_at)
    VALUES (31, 'user-1', 'Coffee preferences', '# Coffee preferences\nAda likes espresso.', '[21]', 'memory/scenarios/coffee.md', '2026-05-18T08:03:00.000Z', '2026-05-18T08:04:00.000Z');

    INSERT INTO personas (user_id, markdown, source_scenario_ids_json, updated_at)
    VALUES ('user-1', '# Persona\nAda prefers concise replies.', '[31]', '2026-05-18T08:05:00.000Z');
  `);
}

test("backfillLegacy migrates legacy conversations, atoms, scenarios, and personas idempotently", async () => {
  const db = new Database(":memory:");
  migrateSqliteMemory(db);
  seedLegacyTables(db);
  const store = new SqliteMemoryStore(db, { sqliteVecEnabled: false, bm25Enabled: true, bm25Language: "en" });
  await store.init();

  await expect((store as SqliteMemoryStore & { backfillLegacy(): Promise<void> }).backfillLegacy()).resolves.toBeUndefined();
  await expect((store as SqliteMemoryStore & { backfillLegacy(): Promise<void> }).backfillLegacy()).resolves.toBeUndefined();

  await expect(store.countL0("user-1")).resolves.toBe(1);
  await expect(store.queryL0ForL1("telegram:chat-1:user-1", 0, 10)).resolves.toEqual([
    {
      recordId: "legacy:l0:11",
      sessionKey: "telegram:chat-1:user-1",
      sessionId: "chat-1",
      chatId: "chat-1",
      userId: "user-1",
      role: "user",
      messageText: "Remember Ada likes espresso.",
      recordedAt: "2026-05-18T08:00:00.000Z",
      timestamp: Date.parse("2026-05-18T08:00:00.000Z"),
      metadata: { mode: "chat", legacyId: 11 },
    },
  ]);

  await expect(store.countL1("user-1")).resolves.toBe(1);
  await expect(store.queryL1Records({ userId: "user-1" })).resolves.toEqual([
    {
      recordId: "legacy:l1:21",
      userId: "user-1",
      sessionKey: "legacy:user-1",
      sessionId: "legacy",
      content: "Ada likes espresso.",
      type: "L1",
      priority: 8,
      sceneName: "legacy memory atom",
      timestampStr: "2026-05-18T08:02:00.000Z",
      timestampStart: "2026-05-18T08:01:00.000Z",
      timestampEnd: "2026-05-18T08:02:00.000Z",
      sourceConversationIds: [11],
      metadata: { legacyId: 21, sourceLayer: "L1" },
      createdTime: "2026-05-18T08:01:00.000Z",
      updatedTime: "2026-05-18T08:02:00.000Z",
    },
  ]);

  const profiles = await store.pullProfiles();
  expect(profiles).toHaveLength(3);
  expect(profiles.map((profile) => profile.id)).toEqual(expect.arrayContaining(["scene:user-1:legacy-memory-atom", "legacy:l2:31", "legacy:l3:user-1"]));
  expect(profiles.find((profile) => profile.id === "scene:user-1:legacy-memory-atom")).toMatchObject({
    type: "l2",
    userId: "user-1",
    filename: "scene-legacy-memory-atom.md",
    content: "# Scene: legacy memory atom\n\n- [8] Ada likes espresso.",
    metadata: { sceneName: "legacy memory atom", recordIds: ["legacy:l1:21"], atomIds: [11] },
  });
  expect(profiles.find((profile) => profile.id === "legacy:l2:31")).toMatchObject({
    type: "l2",
    userId: "user-1",
    filename: "scenario-31.md",
    content: "# Coffee preferences\nAda likes espresso.",
    version: 1,
    createdAtMs: Date.parse("2026-05-18T08:03:00.000Z"),
    updatedAtMs: Date.parse("2026-05-18T08:04:00.000Z"),
    metadata: { legacyId: 31, title: "Coffee preferences", atomIds: [21], filePath: "memory/scenarios/coffee.md" },
  });
  expect(profiles.find((profile) => profile.id === "legacy:l3:user-1")).toMatchObject({
    type: "l3",
    userId: "user-1",
    filename: "persona-user-1.md",
    content: "# Persona\nAda prefers concise replies.",
    version: 1,
    createdAtMs: Date.parse("2026-05-18T08:05:00.000Z"),
    updatedAtMs: Date.parse("2026-05-18T08:05:00.000Z"),
    metadata: { sourceScenarioIds: [31] },
  });
  expect(profiles.every((profile) => profile.contentMd5.length === 32)).toBe(true);

  expect(db.query("SELECT COUNT(*) AS count FROM memory_store_l0").get()).toEqual({ count: 1 });
  expect(db.query("SELECT COUNT(*) AS count FROM memory_store_l1").get()).toEqual({ count: 1 });
  expect(db.query("SELECT COUNT(*) AS count FROM memory_store_profiles").get()).toEqual({ count: 3 });
  expect(db.query("SELECT value FROM memory_store_meta WHERE key = 'backfill.version'").get()).toEqual({ value: "1" });
}, 20000);
