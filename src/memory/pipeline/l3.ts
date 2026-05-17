import type { LlmProvider } from "../../agent/types";
import type { MemoryBackend } from "../core/backend";
import { buildL3SystemPrompt } from "../prompts/l3";

export async function runL3Pipeline(
  backend: MemoryBackend,
  llm: LlmProvider,
  userId: string,
  scenarioId: number,
  scenarioMarkdown: string,
): Promise<boolean> {
  const response = await llm.complete({
    messages: [
      { role: "system", content: buildL3SystemPrompt() },
      { role: "user", content: `scenario_id=${scenarioId}\n${scenarioMarkdown}` },
    ],
    tools: [],
  });

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
