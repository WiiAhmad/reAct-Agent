import { Bot, GrammyError, InlineKeyboard, type Context } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import { config } from "../config";
import type { LlmProvider } from "../agent/types";
import { runReactAgent } from "../agent/react-agent";
import type { MemoryService } from "../memory/core/service";
import { AutonomousJobService, type AutonomousJobRow } from "../services/autonomous-jobs";
import { MemoryUpdateSettingsService } from "../services/memory-update-settings";
import type { ToolRegistry } from "../tools/registry";
import { splitTelegramMessage, truncateText } from "../utils/text";
import { type BotContext } from "./context";
import { buildHelpKeyboard, buildMainMenuKeyboard, buildMemorySummaryKeyboard, buildStartKeyboard, uiCallbacks } from "./ui/keyboards";
import { buildRichMemorySummary, renderHelpScreen, renderJobsScreen, renderMainMenuScreen, renderMemorySummaryScreen, renderStartScreen } from "./ui/renderers";
import { createMemoryUpdateConversation, memoryUpdateCallbacks, memoryUpdateConversationId } from "./conversations/memory-update";
import { startTelegramMemoryUpdateRun } from "./conversations/memory-update-runner";
import { createSkillDraftConversation, skillDraftConversationId } from "./conversations/skill-draft";
import { createJobCreateConversation } from "./conversations/job-create";
import { createJobDetailConversation, jobDetailConversationId } from "./conversations/job-detail";

export const PUBLIC_COMMANDS = ["start", "menu", "help"] as const;

export type BotDeps = {
  memory: MemoryService;
  registry: ToolRegistry;
  llm: LlmProvider;
  autonomousJobs: AutonomousJobService;
  memoryUpdateSettings: MemoryUpdateSettingsService;
};

function logTelegramEvent(event: string, details: Record<string, unknown>) {
  console.log(`[telegram:${event}]`, details);
}

function resolveChatId(ctx: BotContext) {
  return String(ctx.chat?.id ?? "unknown");
}

function resolveUserId(ctx: BotContext) {
  return String(ctx.from?.id ?? ctx.chat?.id ?? "unknown");
}

function resolveMemoryUpdateCallbackTarget(ctx: BotContext) {
  if (ctx.chat?.id == null || ctx.from?.id == null) {
    return null;
  }

  return {
    chatId: String(ctx.chat.id),
    userId: String(ctx.from.id),
  };
}

function buildJobsListKeyboard(jobs: AutonomousJobRow[]) {
  const keyboard = new InlineKeyboard();
  if (jobs.length === 0) {
    return keyboard.text("Add Job", uiCallbacks.addJob).row().text("Back", uiCallbacks.back);
  }

  for (const job of jobs) {
    keyboard.text(`#${job.id}`, `jobs:detail:${job.id}`).row();
  }

  keyboard.text("Add Job", uiCallbacks.addJob).text("Refresh Jobs", uiCallbacks.refreshJobs).row().text("Back", uiCallbacks.back);
  return keyboard;
}

function renderJobsSummary(jobs: AutonomousJobRow[]) {
  return renderJobsScreen(
    jobs.length
      ? jobs.map((job) => `#${job.id} ${job.enabled ? "enabled" : "disabled"}\n${job.scheduleLabel}\n${truncateText(job.prompt, 300)}`).join("\n\n")
      : "Belum ada autonomous jobs.",
  );
}

function isUnchangedMessageError(error: unknown) {
  return error instanceof GrammyError && error.error_code === 400 && error.description.includes("message is not modified");
}

async function presentScreen(ctx: BotContext, text: string, keyboard: InlineKeyboard) {
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { reply_markup: keyboard });
    } catch (error) {
      if (!isUnchangedMessageError(error)) {
        throw error;
      }
    }
    return;
  }

  await ctx.reply(text, { reply_markup: keyboard });
}

async function showMenu(ctx: BotContext) {
  await presentScreen(ctx, renderMainMenuScreen(), buildMainMenuKeyboard());
}

async function showHelp(ctx: BotContext) {
  await presentScreen(ctx, renderHelpScreen(), buildHelpKeyboard());
}

async function showMemorySummary(ctx: BotContext, deps: BotDeps) {
  const chatId = resolveChatId(ctx);
  const userId = resolveUserId(ctx);
  const [memoryStatus, recall, generatedSkillCount] = await Promise.all([
    deps.memory.memoryStatus(userId, chatId),
    deps.memory.recall(userId, "project preferences workflow coding", 5, chatId),
    deps.memory.countGeneratedSkills(userId),
  ]);
  const setting = deps.memoryUpdateSettings.getOrCreate(userId);
  const summary = buildRichMemorySummary({
    memoryStatus,
    recall,
    memoryUpdateSummary: deps.memoryUpdateSettings.renderSummary(setting),
    generatedSkillCount,
  });
  await presentScreen(ctx, renderMemorySummaryScreen(summary), buildMemorySummaryKeyboard());
}

async function showJobsScreen(ctx: BotContext, deps: BotDeps) {
  const chatId = resolveChatId(ctx);
  const jobs = deps.autonomousJobs.listJobsForChat(chatId);
  await presentScreen(ctx, renderJobsSummary(jobs), buildJobsListKeyboard(jobs));
}

export function createTelegramBot(deps: BotDeps) {
  const bot = new Bot<BotContext>(config.telegram.botToken);

  bot.use(conversations());
  bot.use(createConversation(createMemoryUpdateConversation({ memory: deps.memory, settings: deps.memoryUpdateSettings }), { id: memoryUpdateConversationId } as never));
  bot.use(createConversation(createSkillDraftConversation({ memory: deps.memory }), { id: skillDraftConversationId } as never));
  bot.use(createConversation(createJobCreateConversation({ autonomousJobs: deps.autonomousJobs }), { id: "job-create" } as never));
  bot.use(createConversation(createJobDetailConversation({ autonomousJobs: deps.autonomousJobs }), { id: jobDetailConversationId } as never));

  bot.command("start", async (ctx) => {
    logTelegramEvent("command:start", {
      chatId: String(ctx.chat.id),
      userId: resolveUserId(ctx),
    });
    await ctx.reply(renderStartScreen(), { reply_markup: buildStartKeyboard() });
  });

  bot.command("menu", async (ctx) => {
    logTelegramEvent("command:menu", {
      chatId: String(ctx.chat.id),
      userId: resolveUserId(ctx),
    });
    await ctx.reply(renderMainMenuScreen(), { reply_markup: buildMainMenuKeyboard() });
  });

  bot.command("help", async (ctx) => {
    logTelegramEvent("command:help", {
      chatId: String(ctx.chat.id),
      userId: resolveUserId(ctx),
    });
    await ctx.reply(renderHelpScreen(), { reply_markup: buildHelpKeyboard() });
  });

  bot.callbackQuery(uiCallbacks.menu, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMenu(ctx);
  });

  bot.callbackQuery(uiCallbacks.help, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showHelp(ctx);
  });

  bot.callbackQuery(uiCallbacks.memory, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMemorySummary(ctx, deps);
  });

  bot.callbackQuery(uiCallbacks.memoryUpdate, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter(memoryUpdateConversationId);
  });

  bot.callbackQuery(memoryUpdateCallbacks.runNow, async (ctx) => {
    const target = resolveMemoryUpdateCallbackTarget(ctx);
    if (!target) {
      await ctx.answerCallbackQuery({
        text: "Tidak bisa menjalankan Memory Update dari tombol ini.",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();
    const result = await startTelegramMemoryUpdateRun({
      memory: deps.memory,
      settings: deps.memoryUpdateSettings,
      userId: target.userId,
      sendMessage: (text) => ctx.api.sendMessage(target.chatId, text),
    });
    if (result.status === "already-running") {
      await ctx.reply("Memory update masih berjalan untuk user ini.");
    }
  });

  bot.callbackQuery(uiCallbacks.skillDrafts, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter(skillDraftConversationId);
  });

  bot.callbackQuery(uiCallbacks.jobs, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showJobsScreen(ctx, deps);
  });

  bot.callbackQuery(uiCallbacks.addJob, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("job-create");
  });

  bot.callbackQuery(uiCallbacks.refreshJobs, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showJobsScreen(ctx, deps);
  });

  bot.callbackQuery(uiCallbacks.back, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMenu(ctx);
  });

  bot.callbackQuery(/^jobs:detail:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const match = ctx.match as RegExpExecArray | undefined;
    const jobId = Number(match?.[1]);
    if (!Number.isFinite(jobId)) {
      await ctx.reply("Job ID tidak valid.");
      return;
    }
    await ctx.conversation.enter(jobDetailConversationId, jobId);
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return;

    const chatId = resolveChatId(ctx);
    const userId = resolveUserId(ctx);
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
