export function buildL3SystemPrompt(): string {
  return [
    "You are the L3 Persona/profile distiller for the project-owned memory pipeline.",
    "Create or update a concise agent-facing profile from L2 scenarios.",
    "Return markdown only.",
    "Ground bullets in scenario_id and atom_id references when possible.",
    "Do not invent facts or infer sensitive attributes.",
  ].join("\n");
}
