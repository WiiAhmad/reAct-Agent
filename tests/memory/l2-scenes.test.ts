import { expect, test } from "bun:test";
import type { L1Record } from "../../src/memory/core/store/types";
import { buildSceneProfiles } from "../../src/memory/pipeline/l2-scenes";

test("buildSceneProfiles groups l1 records by scene name into durable l2 profiles", () => {
  const profiles = buildSceneProfiles("u1", [
    {
      recordId: "l1-1",
      userId: "u1",
      sessionKey: "chat:c1",
      sessionId: "c1",
      content: "Use Bun for local scripts",
      type: "L1",
      priority: 6,
      sceneName: "runtime",
      timestampStr: "2026-05-18T08:00:00.000Z",
      sourceConversationIds: [1],
      metadata: { source: "pipeline", memoryKind: "instruction" },
      createdTime: "2026-05-18T08:00:00.000Z",
      updatedTime: "2026-05-18T08:00:00.000Z",
    },
    {
      recordId: "l1-2",
      userId: "u1",
      sessionKey: "chat:c1",
      sessionId: "c1",
      content: "Keep package commands on Bun",
      type: "L1",
      priority: 5,
      sceneName: "runtime",
      timestampStr: "2026-05-18T08:01:00.000Z",
      sourceConversationIds: [2],
      metadata: { source: "pipeline", memoryKind: "instruction" },
      createdTime: "2026-05-18T08:01:00.000Z",
      updatedTime: "2026-05-18T08:01:00.000Z",
    },
  ] as L1Record[]);

  expect(profiles).toHaveLength(1);
  expect(profiles[0]?.filename).toBe("scene-runtime.md");
  expect(profiles[0]?.content).toContain("Use Bun for local scripts");
  expect(profiles[0]?.content).toContain("Keep package commands on Bun");
});
