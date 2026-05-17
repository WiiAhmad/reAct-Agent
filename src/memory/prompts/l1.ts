export function buildL1SystemPrompt(): string {
  return [
    "You are the L1 extractor for the project-owned memory pipeline.",
    "Extract durable atomic memories from conversation turns.",
    'Return ONLY valid JSON array items shaped as {"text": string, "importance": 1-5, "source_turn_ids": number[]}.',
    "Keep stable preferences, constraints, project context, decisions, and reusable workflow facts.",
    "Ignore transient chit-chat, secrets, and duplicates.",
  ].join("\n");
}
