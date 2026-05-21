import { truncateText } from "../../utils/text";
import type { MemoryServiceRecall } from "../core/service";

function scenarioBody(scenario: { body_markdown?: string; bodyMarkdown?: string }): string {
  return scenario.body_markdown ?? scenario.bodyMarkdown ?? "";
}

export function buildRecallPromptSections(recall: MemoryServiceRecall) {
  const stableParts: string[] = [];
  const dynamicLines: string[] = [];

  if (recall.persona) {
    stableParts.push(`## L3 Persona\n${recall.persona}`);
  }

  if (recall.scenarios.length) {
    stableParts.push(
      `## L2 Scenarios\n${recall.scenarios
        .map((scenario) => `### Scenario #${scenario.id}: ${scenario.title}\n${truncateText(scenarioBody(scenario), 1600)}`)
        .join("\n\n")}`,
    );
  }

  if (recall.taskCanvas) {
    stableParts.push(`## Active Mermaid task canvas\n\`\`\`mermaid\n${truncateText(recall.taskCanvas, 2200)}\n\`\`\``);
  }

  if (recall.taskCanvases.length) {
    stableParts.push(
      `## Relevant historical task canvases\n${recall.taskCanvases
        .map((task) => `### Task #${task.id}: ${task.label} (${task.status})\nfile_path=${task.filePath}\n\`\`\`mermaid\n${truncateText(task.canvas, 2200)}\n\`\`\``)
        .join("\n\n")}`,
    );
  }

  if (recall.atoms.length) {
    dynamicLines.push(`## L1 Memory atoms\n${recall.atoms.map((atom) => `- atom_id=${atom.id} importance=${atom.importance}: ${atom.text}`).join("\n")}`);
  }

  if (recall.conversations.length) {
    dynamicLines.push(
      `## L0 Related conversation evidence\n${recall.conversations
        .map((conversation) => `- turn_id=${conversation.id} ${conversation.createdAt ?? conversation.created_at ?? ""} ${conversation.role}: ${truncateText(conversation.content, 600)}`)
        .join("\n")}`,
    );
  }

  return {
    stableContext: `Relevant layered memory snapshot:\n\n${stableParts.join("\n\n") || "No stable layered memory found."}`,
    dynamicContext: dynamicLines.length > 0
      ? `<relevant-memories>\n${dynamicLines.join("\n\n")}\n</relevant-memories>`
      : undefined,
  };
}
