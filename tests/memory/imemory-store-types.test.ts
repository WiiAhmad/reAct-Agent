import { expect, test } from "bun:test";
import type {
  IMemoryStore,
  L0Record,
  L1Record,
  ProfileSyncRecord,
  StoreCapabilities,
} from "../../src/memory/core/store/types";

test("IMemoryStore types model generic L0 L1 and profile storage", () => {
  const capabilities: StoreCapabilities = {
    vectorSearch: true,
    ftsSearch: true,
    nativeHybridSearch: false,
    sparseVectors: true,
  };
  const l0: L0Record = {
    recordId: "l0-1",
    sessionKey: "telegram:c1:u1",
    sessionId: "c1",
    chatId: "c1",
    userId: "u1",
    role: "user",
    messageText: "remember Bun runtime",
    recordedAt: "2026-05-18T00:00:00.000Z",
    timestamp: 1,
    metadata: { source: "test" },
  };
  const l1: L1Record = {
    recordId: "l1-1",
    userId: "u1",
    sessionKey: "telegram:c1:u1",
    sessionId: "c1",
    content: "User prefers Bun runtime",
    type: "L1",
    priority: 8,
    sceneName: "",
    timestampStr: "2026-05-18T00:00:00.000Z",
    sourceConversationIds: [1],
    metadata: {
      source: "pipeline",
      memoryKind: "instruction",
      sourceMessageIds: ["msg-1"],
      timestamps: ["2026-05-18T00:00:00.000Z"],
    },
    createdTime: "2026-05-18T00:00:00.000Z",
    updatedTime: "2026-05-18T00:00:00.000Z",
  };
  const profile: ProfileSyncRecord = {
    id: "profile-1",
    type: "l3",
    userId: "u1",
    filename: "persona-u1.md",
    content: "# Persona",
    contentMd5: "md5",
    version: 1,
    createdAtMs: 1,
    updatedAtMs: 2,
    metadata: {},
  };
  const store = undefined as unknown as IMemoryStore;

  expect(capabilities.nativeHybridSearch).toBe(false);
  expect(l0.sessionKey).toBe("telegram:c1:u1");
  expect(l1.sourceConversationIds).toEqual([1]);
  expect(profile.type).toBe("l3");
  expect(store).toBeUndefined();
});
