import type { LlmProvider } from "../../agent/types";
import type { MemoryBackend } from "../core/backend";
import type { MemoryAtom } from "../core/types";
import { buildL2SystemPrompt } from "../prompts/l2";

function buildAtomDigest(atoms: MemoryAtom[]): string {
  return atoms.map((atom) => `atom_id=${atom.id} importance=${atom.importance}: ${atom.text}`).join("\n");
}

export async function runL2Pipeline(
  backend: MemoryBackend,
  llm: LlmProvider,
  userId: string,
  atoms: MemoryAtom[],
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
  });

  const scenarioId = await backend.insertMemoryScenario({
    userId,
    title: `Scenario snapshot ${new Date().toISOString()}`,
    bodyMarkdown: response.content,
    atomIds: atoms.map((atom) => atom.id),
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
