import type { LlmProvider } from "../../agent/types";
import { createHash } from "node:crypto";
import type { MemoryBackend } from "../core/backend";
import type { IMemoryStore, ProfileSyncRecord } from "../core/store/types";
import type { MemoryAtom } from "../core/types";
import { buildL2SystemPrompt } from "../prompts/l2";

function buildAtomDigest(atoms: MemoryAtom[]): string {
  return atoms.map((atom) => `atom_id=${atom.id} importance=${atom.importance}: ${atom.text}`).join("\n");
}

function md5(content: string): string {
  return createHash("md5").update(content).digest("hex");
}

function scenarioProfile(userId: string, profileId: string, title: string, content: string, atomIds: number[], scenarioId?: number): ProfileSyncRecord {
  const nowMs = Date.now();
  return {
    id: profileId,
    type: "l2",
    userId,
    filename: `scenario-${userId}-${profileId.replace(/[^a-zA-Z0-9_-]+/g, "-")}.md`,
    content,
    contentMd5: md5(content),
    version: 1,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    metadata: { ...(scenarioId === undefined ? {} : { scenarioId }), title, atomIds },
  };
}

function scenarioProfileId(userId: string, title: string, content: string, atomIds: number[]): string {
  return `store:l2:${md5(JSON.stringify({ userId, title, content, atomIds }))}`;
}

export async function runL2Pipeline(
  backend: MemoryBackend,
  llm: LlmProvider,
  userId: string,
  atoms: MemoryAtom[],
  store?: IMemoryStore,
): Promise<{ scenarioId: number; bodyMarkdown: string } | undefined> {
  if (atoms.length === 0) {
    return undefined;
  }

  const response = await llm.complete({
    messages: [
      { role: "system", content: buildL2SystemPrompt() },
      { role: "user", content: buildAtomDigest(atoms) },
    ],
    tools: [],
    meta: { origin: "memory.l2" },
  });

  const title = `Scenario snapshot ${new Date().toISOString()}`;
  const atomIds = atoms.map((atom) => atom.id);
  const profileId = scenarioProfileId(userId, title, response.content, atomIds);

  if (store?.syncProfiles) {
    await store.syncProfiles([scenarioProfile(userId, profileId, title, response.content, atomIds)]);
  }

  const scenarioId = await backend.insertMemoryScenario({
    userId,
    title,
    bodyMarkdown: response.content,
    atomIds,
  });

  if (store?.syncProfiles) {
    await store.syncProfiles([scenarioProfile(userId, profileId, title, response.content, atomIds, scenarioId)]);
  }

  for (const atom of atoms) {
    await backend.insertLineageLink({
      userId,
      sourceKind: "memory_atom",
      sourceId: String(atom.id),
      targetKind: "memory_scenario",
      targetId: String(scenarioId),
      linkType: "aggregates_into",
    });
  }

  return { scenarioId, bodyMarkdown: response.content };
}
