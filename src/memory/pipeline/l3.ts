import { createHash } from "node:crypto";
import type { LlmProvider } from "../../agent/types";
import type { MemoryBackend } from "../core/backend";
import type { IMemoryStore, ProfileSyncRecord } from "../core/store/types";
import { buildL3SystemPrompt } from "../prompts/l3";

function md5(content: string): string {
  return createHash("md5").update(content).digest("hex");
}

function personaProfile(userId: string, scenarioId: number, content: string): ProfileSyncRecord {
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
    metadata: { sourceScenarioIds: [scenarioId] },
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
  const response = await llm.complete({
    messages: [
      { role: "system", content: buildL3SystemPrompt() },
      { role: "user", content: `scenario_id=${scenarioId}\n${scenarioMarkdown}` },
    ],
    tools: [],
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
