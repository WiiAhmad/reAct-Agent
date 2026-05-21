import { createHash } from "node:crypto";
import type { LlmProvider } from "../../agent/types";
import type { MemoryBackend } from "../core/backend";
import type { IMemoryStore, ProfileRecord, ProfileSyncRecord } from "../core/store/types";
import { buildL3SystemPrompt } from "../prompts/l3";
import { computeSceneFingerprint } from "./l3-scenes";

function md5(content: string): string {
  return createHash("md5").update(content).digest("hex");
}

function latestProfile(profiles: ProfileRecord[], userId: string, type: "l2" | "l3") {
  return profiles
    .filter((profile) => profile.userId === userId && profile.type === type)
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs)[0];
}

function personaProfile(userId: string, scenarioId: number, content: string, sceneFingerprint?: string): ProfileSyncRecord {
  const nowMs = Date.now();
  return {
    id: `legacy:l3:${userId}`,
    type: "l3",
    userId,
    filename: `persona-${userId}.md`,
    content,
    contentMd5: md5(content),
    version: 1,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    metadata: {
      sourceScenarioIds: [scenarioId],
      ...(sceneFingerprint === undefined ? {} : { sceneFingerprint }),
    },
  };
}

export async function runL3Pipeline(
  backend: MemoryBackend,
  llm: LlmProvider,
  userId: string,
  scenarioId: number,
  scenarioMarkdown: string,
  store?: IMemoryStore,
): Promise<boolean> {
  if (store?.pullProfiles && store.syncProfiles) {
    const profiles = await store.pullProfiles();
    const sceneProfiles = profiles.filter((profile) => profile.userId === userId && profile.type === "l2");
    const fingerprint = computeSceneFingerprint(
      sceneProfiles.map((profile) => ({ filename: profile.filename, contentMd5: profile.contentMd5 })),
    );
    const currentPersona = latestProfile(profiles, userId, "l3");
    const currentFingerprint = typeof currentPersona?.metadata?.sceneFingerprint === "string"
      ? currentPersona.metadata.sceneFingerprint
      : undefined;

    if (currentFingerprint === fingerprint) {
      return false;
    }

    const response = await llm.complete({
      messages: [
        { role: "system", content: buildL3SystemPrompt() },
        {
          role: "user",
          content: sceneProfiles.map((profile) => `## ${profile.filename}\n${profile.content}`).join("\n\n") || `scenario_id=${scenarioId}\n${scenarioMarkdown}`,
        },
      ],
      tools: [],
      meta: { origin: "memory.l3" },
    });

    await store.syncProfiles([personaProfile(userId, scenarioId, response.content, fingerprint)]);

    await backend.upsertPersona({
      userId,
      markdown: response.content,
      sourceScenarioIds: [scenarioId],
    });

    await backend.insertLineageLink({
      userId,
      sourceKind: "memory_scenario",
      sourceId: String(scenarioId),
      targetKind: "persona",
      targetId: userId,
      linkType: "distills_into",
    });

    return true;
  }

  const response = await llm.complete({
    messages: [
      { role: "system", content: buildL3SystemPrompt() },
      { role: "user", content: `scenario_id=${scenarioId}\n${scenarioMarkdown}` },
    ],
    tools: [],
    meta: { origin: "memory.l3" },
  });

  if (store?.syncProfiles) {
    await store.syncProfiles([personaProfile(userId, scenarioId, response.content)]);
  }

  await backend.upsertPersona({
    userId,
    markdown: response.content,
    sourceScenarioIds: [scenarioId],
  });

  await backend.insertLineageLink({
    userId,
    sourceKind: "memory_scenario",
    sourceId: String(scenarioId),
    targetKind: "persona",
    targetId: userId,
    linkType: "distills_into",
  });

  return true;
}
