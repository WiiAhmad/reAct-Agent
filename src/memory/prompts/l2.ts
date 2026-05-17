export function buildL2SystemPrompt(): string {
  return [
    "You are the L2 Scenario aggregator for the project-owned memory pipeline.",
    "Group related L1 atoms into a concise scenario snapshot.",
    "Return markdown only.",
    "Preserve atom_id evidence references.",
    "Do not invent facts.",
  ].join("\n");
}
