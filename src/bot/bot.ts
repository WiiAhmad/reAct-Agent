import { Bot } from "grammy";
import type { Database } from "bun:sqlite";
import { config } from "../config";
import type { LlmProvider } from "../agent/types";
import { runReactAgent } from "../agent/react-agent";
import type { MemoryStore } from "../memory/store";
import type { ToolRegistry } from "../tools/registry";
import { splitTelegramMessage, truncateText } from "../utils/text";
import { nowIso } from "../utils/time";

export type BotDeps = {
  db: Database;
  memory: MemoryStore;
  registry: ToolRegistry;
  llm: LlmProvider;
};

function logTelegramEvent(event: string, details: Record<string, unknown>) {
  console.log(`[telegram:${event}]`, details);
}

export function createTelegramBot(deps: BotDeps) {
  const bot = new Bot(config.telegram.botToken);

  bot.command("start", async (ctx) => {
    logTelegramEvent("command:start", {
      chatId: String(ctx.chat.id),
      userId: String(ctx.from?.id ?? ctx.chat.id),
    });

    await ctx.reply(
      [
        "Halo. Bot siap.",
        "Memory: TencentDB-Agent-Memory style local adapter (L0/L1/L2/L3 + refs + Mermaid canvas).",
        "Commands:",
        "/tools - lihat tools aktif",
        "/memory - lihat persona/memory snapshot",
        "/memory_force - paksa extraction L1→L2→L3 sekarang",
        "/job <prompt> - tambah autonomous job dengan cron global dari .env",
        "/jobs - list autonomous jobs",
      ].join("\n"),
    );
  });

  bot.command("tools", async (ctx) => {
    const tools = deps.registry.listDebug();
    if (tools.length === 0) return ctx.reply("Belum ada tools terdaftar.");
    await ctx.reply(
      tools
        .map((tool) => `- ${tool.name} [${tool.source}${tool.serverName ? `:${tool.serverName}` : ""}]\n  ${tool.description}`)
        .join("\n"),
    );
  });

  bot.command("memory", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const userId = String(ctx.from?.id ?? ctx.chat.id);
    const persona = deps.memory.getPersona(userId) ?? "Belum ada L3 persona.";
    const recall = await deps.memory.recall(userId, "project preferences workflow coding", 5, chatId);
    const status = deps.memory.memoryStatus(userId, chatId);
    await ctx.reply(
      [
        "# Memory status",
        status,
        "",
        "# L3 Persona",
        persona,
        "",
        "# L2 Scenarios",
        recall.scenarios.length ? recall.scenarios.map((s) => `- #${s.id}: ${s.title}${s.file_path ? ` (${s.file_path})` : ""}`).join("\n") : "Belum ada scenario.",
        "",
        "# Top L1 atoms",
        recall.atoms.length ? recall.atoms.map((a) => `- #${a.id}: ${a.text}`).join("\n") : "Belum ada memory atom.",
        "",
        "# Active canvas",
        recall.taskCanvas ? "Ada di data/memory/canvases/." : "Belum ada canvas.",
      ].join("\n"),
    );
  });

  bot.command("memory_force", async (ctx) => {
    const userId = String(ctx.from?.id ?? ctx.chat.id);
    logTelegramEvent("command:memory_force", {
      chatId: String(ctx.chat.id),
      userId,
    });
    await ctx.reply("Running memory pipeline L1→L2→L3 untuk user ini...");
    const result = await deps.memory.runMaintenanceForUser(userId, deps.llm, true);
    await ctx.reply(`Done. L1 created=${result.l1Created}, L2 scenario=${result.l2ScenarioId ?? "none"}, L3 updated=${result.personaUpdated}`);
  });

  bot.command("job", async (ctx) => {
    const prompt = ctx.match.trim();
    if (!prompt) return ctx.reply("Format: /job cek sesuatu lalu beritahu saya");
    const chatId = String(ctx.chat.id);
    const userId = String(ctx.from?.id ?? ctx.chat.id);
    logTelegramEvent("command:job", {
      chatId,
      userId,
      prompt: truncateText(prompt, 160),
    });
    const now = nowIso();
    const result = deps.db
      .query(`
        INSERT INTO autonomous_jobs (chat_id, user_id, prompt, enabled, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
      `)
      .run(chatId, userId, prompt, now, now);
    await ctx.reply(`Autonomous job dibuat: #${result.lastInsertRowid}\nCron global: ${config.autonomous.cron}\nMin interval: ${config.autonomous.minIntervalSec}s`);
  });

  bot.command("jobs", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const rows = deps.db
      .query(`SELECT id, prompt, enabled, last_run_at FROM autonomous_jobs WHERE chat_id = ? ORDER BY id DESC LIMIT 20`)
      .all(chatId) as Array<{ id: number; prompt: string; enabled: number; last_run_at: number | null }>;
    if (rows.length === 0) return ctx.reply("Belum ada autonomous jobs.");
    await ctx.reply(
      rows
        .map((job) => `#${job.id} ${job.enabled ? "enabled" : "disabled"} last=${job.last_run_at ?? "never"}\n${job.prompt}`)
        .join("\n\n"),
    );
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return;

    const chatId = String(ctx.chat.id);
    const userId = String(ctx.from?.id ?? ctx.chat.id);
    logTelegramEvent("message:received", {
      chatId,
      userId,
      text: truncateText(text, 200),
      length: text.length,
    });
    await ctx.replyWithChatAction("typing");

    const answer = await runReactAgent({
      chatId,
      userId,
      input: text,
      memory: deps.memory,
      registry: deps.registry,
      llm: deps.llm,
      mode: "chat",
    });

    logTelegramEvent("message:answered", {
      chatId,
      userId,
      answerLength: answer.length,
      answerPreview: truncateText(answer, 200),
    });

    for (const chunk of splitTelegramMessage(answer)) {
      await ctx.reply(chunk);
    }
  });

  bot.catch((err) => {
    console.error("Telegram bot error", err);
  });

  return bot;
}
