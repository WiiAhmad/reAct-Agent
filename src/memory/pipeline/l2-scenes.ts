import { createHash } from "node:crypto";
import type { L1Record, ProfileSyncRecord } from "../core/store/types";

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "general";
}

function md5(content: string) {
  return createHash("md5").update(content).digest("hex");
}

export function buildSceneProfiles(userId: string, records: L1Record[]): ProfileSyncRecord[] {
  const grouped = new Map<string, L1Record[]>();

  for (const record of records) {
    const key = record.sceneName?.trim() || "general";
    grouped.set(key, [...(grouped.get(key) ?? []), record]);
  }

  const nowMs = Date.now();
  return [...grouped.entries()].map(([sceneName, sceneRecords]) => {
    const sceneSlug = slug(sceneName);
    const content = [
      `# Scene: ${sceneName}`,
      "",
      ...sceneRecords.map((record) => `- [${record.priority}] ${record.content}`),
    ].join("\n");

    return {
      id: `scene:${userId}:${sceneSlug}`,
      type: "l2",
      userId,
      filename: `scene-${sceneSlug}.md`,
      content,
      contentMd5: md5(content),
      version: 1,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      metadata: {
        sceneName,
        recordIds: sceneRecords.map((record) => record.recordId),
        atomIds: sceneRecords.flatMap((record) => record.sourceConversationIds),
      },
    };
  });
}
