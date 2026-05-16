import type { Api } from "grammy";
import type { MemoryStore } from "../memory/store";
import type { RegisteredTool } from "./types";
import { truncateText } from "../utils/text";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function createLocalTools(memory: MemoryStore, telegram?: Api): RegisteredTool[] {
  return [
    {
      name: "tdai_memory_search",
      source: "local",
      description: "TencentDB-Agent-Memory style search over L3 persona, L2 scenarios, L1 atoms, L0 evidence, and active task canvas.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to recall" },
          maxResults: { type: "number", description: "Maximum results, default 5" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      async execute(args, ctx) {
        const query = asString(args.query);
        const maxResults = asNumber(args.maxResults, 5);
        const recall = await memory.recall(ctx.userId, query, maxResults, ctx.chatId);
        const parts = [];
        if (recall.persona) parts.push(`## L3 Persona\n${recall.persona}`);
        if (recall.scenarios.length) parts.push(`## L2 Scenarios\n${recall.scenarios.map((s) => `### #${s.id} ${s.title}\n${truncateText(s.body_markdown, 1200)}`).join("\n\n")}`);
        if (recall.atoms.length) parts.push(`## L1 Atoms\n${recall.atoms.map((a) => `- atom_id=${a.id} importance=${a.importance}: ${a.text}`).join("\n")}`);
        if (recall.conversations.length) parts.push(`## L0 Conversations\n${recall.conversations.map((c) => `- turn_id=${c.id} ${c.created_at} ${c.role}: ${truncateText(c.content, 500)}`).join("\n")}`);
        if (recall.taskCanvas) parts.push(`## Active Mermaid Canvas\n\`\`\`mermaid\n${truncateText(recall.taskCanvas, 1800)}\n\`\`\``);
        return parts.length ? parts.join("\n\n") : "No relevant memory found.";
      },
    },
    {
      name: "tdai_conversation_search",
      source: "local",
      description: "TencentDB-Agent-Memory style search over raw L0 conversation history for exact evidence.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", default: 5 },
        },
        required: ["query"],
        additionalProperties: false,
      },
      async execute(args, ctx) {
        return memory.searchConversations(ctx.userId, asString(args.query), asNumber(args.limit, 5));
      },
    },
    {
      name: "tdai_context_ref_read",
      source: "local",
      description: "Read an offloaded refs/*.md raw tool result by node_id or result_ref. Use this when the Mermaid canvas summary is insufficient.",
      inputSchema: {
        type: "object",
        properties: {
          node_id: { type: "string", description: "node_id from Mermaid canvas/offload summary" },
          result_ref: { type: "string", description: "relative ref path such as memory/refs/<chat>/<node>.md" },
        },
        additionalProperties: false,
      },
      async execute(args, ctx) {
        return memory.readContextRef({ userId: ctx.userId, nodeId: asString(args.node_id), resultRef: asString(args.result_ref) });
      },
    },
    {
      name: "tdai_memory_status",
      source: "local",
      description: "Inspect local TencentDB-Agent-Memory style adapter status, layer counts, cron settings, and offload state.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute(_args, ctx) {
        return memory.memoryStatus(ctx.userId, ctx.chatId);
      },
    },
    {
      name: "save_memory",
      source: "local",
      description: "Save a durable L1 memory atom. Use only for stable facts/preferences/workflows likely useful later.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          importance: { type: "number", minimum: 1, maximum: 5 },
        },
        required: ["text"],
        additionalProperties: false,
      },
      async execute(args, ctx) {
        const id = memory.addAtom({
          userId: ctx.userId,
          text: asString(args.text),
          importance: asNumber(args.importance, 3),
          sourceLayer: "L1",
        });
        return id > 0 ? `Saved L1 memory atom #${id}.` : "Memory was empty or duplicate.";
      },
    },
    {
      name: "telegram_send_message",
      source: "local",
      description: "Send a Telegram message to the current chat or a specified chat_id. Useful in autonomous runs.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          chat_id: { type: "string", description: "Optional Telegram chat id; defaults to current chat" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      async execute(args, ctx) {
        const api = telegram ?? ctx.telegram;
        if (!api) return "Telegram API unavailable.";
        const chatId = asString(args.chat_id, ctx.chatId);
        const text = truncateText(asString(args.text), 3900);
        await api.sendMessage(chatId, text);
        return `Sent Telegram message to ${chatId}.`;
      },
    },
  ];
}
