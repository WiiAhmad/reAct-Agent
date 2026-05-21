import type { LlmProvider } from "../../agent/types";
import type { MemoryBackend } from "../core/backend";
import type { IMemoryStore, L1Record } from "../core/store/types";
import type { MemoryAtom } from "../core/types";
import { buildL2SystemPrompt } from "../prompts/l2";
import { buildSceneProfiles } from "./l2-scenes";

function buildAtomDigest(atoms: MemoryAtom[]): string {
  return atoms.map((atom) => `atom_id=${atom.id} importance=${atom.importance}: ${atom.text}`).join("\n");
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

  if (store?.syncProfiles) {
    const l1Records = await store.queryL1Records({ userId, type: "L1", limit: 200 }) as L1Record[];
    const sceneProfiles = buildSceneProfiles(userId, l1Records);
    if (sceneProfiles.length > 0) {
      await store.syncProfiles(sceneProfiles);
    }
  }

  const scenarioId = await backend.insertMemoryScenario({
    userId,
    title,
    bodyMarkdown: response.content,
    atomIds,
  });

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
