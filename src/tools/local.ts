import type { Api } from "grammy";
import { config } from "../config";
import type { MemoryServiceLike as MemoryService } from "../memory/core/service";
import type { AutonomousJobService } from "../services/autonomous-jobs";
import { validateCronExpression } from "../services/schedules";
import { currentDateTimeSnapshot } from "../utils/time";
import { truncateText } from "../utils/text";
import type { RegisteredTool, ToolContext } from "./types";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asPositiveInteger(value: unknown, fallback: number, fieldName: string): number | string {
  const resolved = value === undefined || value === null ? fallback : value;
  if (!Number.isInteger(resolved) || (resolved as number) <= 0) {
    return `${fieldName} must be a positive integer.`;
  }
  return resolved as number;
}

function parseRunAtUnix(value: unknown): number | string {
  const runAt = asString(value).trim();
  if (!runAt) return "schedule.run_at is required for one-shot jobs.";
  const timestamp = Date.parse(runAt);
  if (!Number.isFinite(timestamp)) return "schedule.run_at must be a valid ISO datetime.";
  return Math.floor(timestamp / 1000);
}

function scenarioBody(scenario: { body_markdown?: string; bodyMarkdown?: string }): string {
  return scenario.body_markdown ?? scenario.bodyMarkdown ?? "";
}

function conversationCreatedAt(conversation: { created_at?: string; createdAt?: string }): string {
  return conversation.created_at ?? conversation.createdAt ?? "";
}

function getMemory(memory: MemoryService, ctx: ToolContext): MemoryService {
  return ctx.memory ?? memory;
}

export function createLocalTools(memory: MemoryService, telegram?: Api, autonomousJobs?: AutonomousJobService): RegisteredTool[] {
  return [
    {
      name: "tdai_memory_search",
      source: "local",
      description: "Search the project-owned memory backend across L3 persona, L2 scenarios, L1 atoms, L0 evidence, and active or historical task canvases.",
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
        const recall = await getMemory(memory, ctx).recall(ctx.userId, query, maxResults, ctx.chatId);
        const parts = [];
        if (recall.persona) parts.push(`## L3 Persona\n${recall.persona}`);
        if (recall.scenarios.length) parts.push(`## L2 Scenarios\n${recall.scenarios.map((s) => `### #${s.id} ${s.title}\n${truncateText(scenarioBody(s), 1200)}`).join("\n\n")}`);
        if (recall.atoms.length) parts.push(`## L1 Atoms\n${recall.atoms.map((a) => `- atom_id=${a.id} importance=${a.importance}: ${a.text}`).join("\n")}`);
        if (recall.conversations.length) parts.push(`## L0 Conversations\n${recall.conversations.map((c) => `- turn_id=${c.id} ${conversationCreatedAt(c)} ${c.role}: ${truncateText(c.content, 500)}`).join("\n")}`);
        if (recall.taskCanvas) parts.push(`## Active Mermaid Canvas\n\`\`\`mermaid\n${truncateText(recall.taskCanvas, 1800)}\n\`\`\``);
        if (recall.taskCanvases.length) {
          parts.push(`## Relevant Task Canvases\n${recall.taskCanvases
            .map((task) => `### #${task.id} ${task.label} (${task.status})\nfile_path=${task.filePath}\n\`\`\`mermaid\n${truncateText(task.canvas, 1800)}\n\`\`\``)
            .join("\n\n")}`);
        }
        return parts.length ? parts.join("\n\n") : "No relevant memory found.";
      },
    },
    {
      name: "tdai_conversation_search",
      source: "local",
      description: "Search raw L0 conversation history in the project-owned memory backend for exact evidence.",
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
        return getMemory(memory, ctx).searchConversations(ctx.userId, asString(args.query), asNumber(args.limit, 5));
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
        return getMemory(memory, ctx).readContextRef({ userId: ctx.userId, nodeId: asString(args.node_id), resultRef: asString(args.result_ref) });
      },
    },
    {
      name: "tdai_memory_status",
      source: "local",
      description: "Inspect the project-owned memory backend status, layer counts, cron settings, and offload state.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute(_args, ctx) {
        return getMemory(memory, ctx).memoryStatus(ctx.userId, ctx.chatId);
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
        const id = await getMemory(memory, ctx).saveMemory({
          userId: ctx.userId,
          text: asString(args.text),
          importance: asNumber(args.importance, 3),
          sourceLayer: "L1",
        });
        return id > 0 ? `Saved L1 memory atom #${id}.` : "Memory was empty or duplicate.";
      },
    },
    {
      name: "tdai_current_datetime",
      source: "local",
      description: "Return the current date and time snapshot for Telegram replies and timestamp-sensitive tool use.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute() {
        return JSON.stringify(currentDateTimeSnapshot(new Date(), { timezone: config.app.timezone, locale: config.app.locale }));
      },
    },
    {
      name: "tdai_create_job",
      source: "local",
      description: "Create a hybrid scheduled Telegram job that sends fixed text first, then runs an agent prompt. Supports one-shot, interval, and cron schedules. Defaults max_runs to 1.",
      inputSchema: {
        type: "object",
        properties: {
          message_text: { type: "string", description: "Fixed Telegram text sent first when the job is due." },
          agent_prompt: { type: "string", description: "Prompt run by the agent after message_text is sent." },
          schedule: {
            type: "object",
            properties: {
              mode: { type: "string", enum: ["once", "interval", "cron"] },
              run_at: { type: "string", description: "ISO datetime for one-shot jobs." },
              interval_sec: { type: "number", description: "Positive interval in seconds for interval jobs." },
              cron_expr: { type: "string", description: "Cron expression for cron jobs." },
            },
            required: ["mode"],
            additionalProperties: false,
          },
          max_runs: { type: "number", description: "Positive maximum execution count. Defaults to 1." },
        },
        required: ["message_text", "agent_prompt", "schedule"],
        additionalProperties: false,
      },
      async execute(args, ctx) {
        const jobs = ctx.autonomousJobs ?? autonomousJobs;
        if (!jobs) return "Job service unavailable.";

        const messageText = asString(args.message_text).trim();
        if (!messageText) return "message_text is required.";

        const agentPrompt = asString(args.agent_prompt).trim();
        if (!agentPrompt) return "agent_prompt is required.";

        const maxRuns = asPositiveInteger(args.max_runs, 1, "max_runs");
        if (typeof maxRuns === "string") return maxRuns;

        const scheduleInput = asObject(args.schedule);
        const mode = asString(scheduleInput.mode).trim();
        let schedule;

        if (mode === "once") {
          const runAtUnix = parseRunAtUnix(scheduleInput.run_at);
          if (typeof runAtUnix === "string") return runAtUnix;
          schedule = { scheduleMode: "once" as const, runAtUnix };
        } else if (mode === "interval") {
          const intervalSec = asPositiveInteger(scheduleInput.interval_sec, 0, "schedule.interval_sec");
          if (typeof intervalSec === "string") return intervalSec;
          schedule = { scheduleMode: "interval" as const, intervalSec };
        } else if (mode === "cron") {
          const cronExpr = asString(scheduleInput.cron_expr).trim();
          if (!cronExpr) return "schedule.cron_expr is required for cron jobs.";
          try {
            schedule = { scheduleMode: "cron" as const, cronExpr: validateCronExpression(cronExpr) };
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        } else {
          return "schedule.mode must be one of: once, interval, cron.";
        }

        const job = jobs.createJob({
          chatId: ctx.chatId,
          userId: ctx.userId,
          prompt: agentPrompt,
          jobType: "hybrid",
          messageText,
          agentPrompt,
          schedule,
          maxRuns,
        });

        return `Created job #${job.id}. Schedule: ${job.scheduleLabel}. max_runs=${maxRuns}.`;
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
