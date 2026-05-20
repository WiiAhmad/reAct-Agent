import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentMessage, LlmProvider } from "../../agent/types";

export type L4EvidenceEntry = {
  nodeId: string;
  toolName?: string;
  args: Record<string, unknown>;
  summary: string;
  resultRef?: string;
  createdAt: string;
};

export type L4Request = {
  taskId: number;
  mmdFilename: string;
  mmdContent: string;
  offloadEntries: L4EvidenceEntry[];
  skillFocus: string | null;
  maxCanvasChars: number;
  maxSkillChars: number;
};

export type L4Response = {
  skillName: string;
  skillDescription: string;
  skillContent: string;
};

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export function parseL4Json(content: string): L4Response | undefined {
  const jsonText = extractJson(content);
  if (!jsonText) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const value = parsed as Record<string, unknown>;
  if (typeof value.skillName !== "string" || typeof value.skillDescription !== "string" || typeof value.skillContent !== "string") {
    return undefined;
  }

  return {
    skillName: value.skillName,
    skillDescription: value.skillDescription,
    skillContent: value.skillContent,
  };
}

export function validateGeneratedSkill(skill: L4Response, identity: { chatId: string; userId: string }): ValidationResult {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(skill.skillName)) {
    return { ok: false, reason: "Invalid skill name." };
  }
  if (!skill.skillDescription.startsWith("Use when")) {
    return { ok: false, reason: "Skill description must start with Use when." };
  }

  const combined = `${skill.skillName}\n${skill.skillDescription}\n${skill.skillContent}`;
  if (/\b(?:BOT_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY)\b/i.test(combined) || /\bsk-[A-Za-z0-9_-]{3,}\b/.test(combined)) {
    return { ok: false, reason: "Skill content appears to contain a secret." };
  }
  if (identity.chatId && skill.skillContent.includes(identity.chatId)) {
    return { ok: false, reason: "Skill content contains raw chat id." };
  }
  if (identity.userId && skill.skillContent.includes(identity.userId)) {
    return { ok: false, reason: "Skill content contains raw user id." };
  }
  if (!skill.skillContent.startsWith("---\n")) {
    return { ok: false, reason: "Skill content must include YAML frontmatter." };
  }

  const frontmatter = skill.skillContent.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
  if (!frontmatter) {
    return { ok: false, reason: "Skill content must include YAML frontmatter." };
  }

  const frontmatterName = readYamlScalar(frontmatter, "name");
  if (frontmatterName !== skill.skillName) {
    return { ok: false, reason: "Skill frontmatter name does not match skillName." };
  }
  const frontmatterDescription = readYamlScalar(frontmatter, "description");
  if (!frontmatterDescription?.startsWith("Use when")) {
    return { ok: false, reason: "Skill frontmatter description must start with Use when." };
  }

  return { ok: true };
}

export async function generateL4Skill(llm: LlmProvider, input: L4Request): Promise<L4Response | undefined> {
  const response = await llm.complete({
    messages: buildPrompt(input),
    tools: [],
    temperature: 0,
    meta: { origin: "offload.l4" },
  });
  const parsed = parseL4Json(response.content);
  if (!parsed || parsed.skillContent.length > input.maxSkillChars) return undefined;
  return parsed;
}

export async function writeDraftSkill(skillsDir: string, skill: L4Response): Promise<{ absolutePath: string; relativePath: string }> {
  const relativePath = `${skill.skillName}/SKILL.md`;
  const directory = resolve(skillsDir, skill.skillName);
  const absolutePath = resolve(directory, "SKILL.md");
  const root = resolve(skillsDir);
  if (!absolutePath.startsWith(root)) {
    throw new Error("Invalid skill path.");
  }

  await mkdir(directory, { recursive: true });
  await writeFile(absolutePath, skill.skillContent, "utf8");
  return { absolutePath, relativePath };
}

function extractJson(content: string): string | undefined {
  const trimmed = content.trim();
  const fullFence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fullFence?.[1]) return fullFence[1].trim();
  const embeddedFence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (embeddedFence?.[1]) return embeddedFence[1].trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  return first >= 0 && last > first ? trimmed.slice(first, last + 1) : undefined;
}

function readYamlScalar(frontmatter: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = frontmatter.match(new RegExp(`^${escaped}:\\s*(.*)$`, "m"));
  return match?.[1]?.trim().replace(/^['\"]|['\"]$/g, "");
}

function buildPrompt(input: L4Request): AgentMessage[] {
  return [
    {
      role: "system",
      content: [
        "Generate a draft Claude Code skill from grounded task evidence only.",
        "Return only strict JSON with string fields skillName, skillDescription, and skillContent.",
        "skillName must be kebab-case and skillDescription must start with 'Use when'.",
        "skillContent must be a complete SKILL.md draft starting with YAML frontmatter containing name and description.",
        "Do not include raw chat ids, raw user ids, API keys, tokens, or secrets.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({
        taskId: input.taskId,
        mmdFilename: input.mmdFilename,
        canvas: input.mmdContent.slice(0, Math.max(0, input.maxCanvasChars)),
        evidence: input.offloadEntries,
        skillFocus: input.skillFocus,
        maxSkillChars: input.maxSkillChars,
      }),
    },
  ];
}
