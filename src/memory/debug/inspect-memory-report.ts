import type { ProfileRecord } from "../core/store/types";

export type InspectMemoryDump = {
  userId: string;
  chatId: string | null;
  l2: Array<{ content: string }>;
  l3: Array<{ content: string }>;
};

export function buildInspectMemoryDump(
  profiles: ProfileRecord[],
  userId: string,
  chatId?: string,
): InspectMemoryDump {
  return {
    userId,
    chatId: chatId ?? null,
    l2: profiles
      .filter((profile) => profile.userId === userId && profile.type === "l2")
      .map((profile) => ({ content: profile.content })),
    l3: profiles
      .filter((profile) => profile.userId === userId && profile.type === "l3")
      .map((profile) => ({ content: profile.content })),
  };
}

export function formatInspectMemoryReport(status: string, dump: InspectMemoryDump): string {
  const l2Section = dump.l2.length === 0
    ? "No L2 scenarios found."
    : dump.l2.map((scenario, index) => `#${index + 1}\n${scenario.content}`).join("\n\n");

  const l3Section = dump.l3.length === 0
    ? "No L3 persona found."
    : dump.l3.map((persona) => persona.content).join("\n\n");

  return [
    status,
    "",
    "--- L2 scenarios ---",
    "",
    l2Section,
    "",
    "--- L3 persona ---",
    "",
    l3Section,
    "",
    "--- raw json ---",
    JSON.stringify(dump, null, 2),
  ].join("\n");
}
