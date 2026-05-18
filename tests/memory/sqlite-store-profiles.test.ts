import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { ProfileSyncRecord } from "../../src/memory/core/store/types";
import { SqliteMemoryStore } from "../../src/memory/backends/sqlite/store";

async function createStore(): Promise<{ db: Database; store: SqliteMemoryStore }> {
  const db = new Database(":memory:");
  const store = new SqliteMemoryStore(db, { sqliteVecEnabled: false, bm25Enabled: false });
  await store.init();
  return { db, store };
}

function createProfile(overrides: Partial<ProfileSyncRecord> = {}): ProfileSyncRecord {
  return {
    id: "l3-user-1",
    type: "l3",
    userId: "user-1",
    filename: "persona-user-1.md",
    content: "# User 1\nPrefers concise replies.",
    contentMd5: "md5-v1",
    version: 1,
    createdAtMs: 1710000000000,
    updatedAtMs: 1710000000000,
    metadata: { source: "test" },
    ...overrides,
  };
}

test("syncProfiles inserts profiles and pullProfiles returns them in stable order", async () => {
  const { store } = await createStore();
  const l3 = createProfile();
  const l2 = createProfile({
    id: "l2-user-1-session-1",
    type: "l2",
    filename: "scenario-user-1-session-1.md",
    content: "# Scenario\nMorning planning details.",
    contentMd5: "scenario-md5",
    version: 3,
    updatedAtMs: 1710000001000,
    metadata: { scenarioId: 7 },
  });

  await store.syncProfiles([l3, l2]);

  await expect(store.pullProfiles()).resolves.toEqual([l2, l3]);
});

test("syncProfiles updates versioned profile content without changing createdAtMs", async () => {
  const { store } = await createStore();
  await store.syncProfiles([createProfile()]);

  const updated = createProfile({
    content: "# User 1\nNow prefers detailed checklists.",
    contentMd5: "md5-v2",
    version: 2,
    createdAtMs: 1710000000000,
    updatedAtMs: 1710000099999,
    metadata: { source: "test", revision: 2 },
  });
  await store.syncProfiles([updated]);

  await expect(store.pullProfiles()).resolves.toEqual([updated]);
});

test("deleteProfiles removes selected profiles and ignores missing IDs", async () => {
  const { store } = await createStore();
  const keep = createProfile({ id: "l3-user-1", type: "l3" });
  const remove = createProfile({ id: "l2-user-1-session-1", type: "l2", filename: "scenario.md" });
  await store.syncProfiles([keep, remove]);

  await store.deleteProfiles([remove.id, "missing-profile"]);

  await expect(store.pullProfiles()).resolves.toEqual([keep]);
}
);
