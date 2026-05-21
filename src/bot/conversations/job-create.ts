import type { BotConversation } from "../context";
import type { Context } from "grammy";
import { buildSchedulePresetKeyboard, uiCallbacks } from "../ui/keyboards";
import { validateCronExpression } from "../../services/schedules";
import type { AutonomousJobService } from "../../services/autonomous-jobs";
import { waitForCallbackData, waitForTextInput } from "./waits";

export type JobCreateConversationDeps = {
  autonomousJobs: AutonomousJobService;
};

const scheduleCallbackData = new Set<string>([
  uiCallbacks.schedulePreset10m,
  uiCallbacks.schedulePreset30m,
  uiCallbacks.schedulePreset1h,
  uiCallbacks.schedulePreset6h,
  uiCallbacks.schedulePreset12h,
  uiCallbacks.schedulePreset24h,
  uiCallbacks.customCron,
  uiCallbacks.cancel,
]);

function isScheduleCallbackData(data: string | undefined) {
  return data !== undefined && scheduleCallbackData.has(data);
}

function resolveChatId(ctx: Context) {
  return String(ctx.chat?.id ?? "unknown");
}

function resolveUserId(ctx: Context) {
  return String(ctx.from?.id ?? ctx.chat?.id ?? "unknown");
}

async function waitForActorCallbackData(
  conversation: BotConversation,
  actorId: string,
  isExpectedData: (data: string | undefined) => boolean,
) {
  while (true) {
    const action = await waitForCallbackData(conversation, isExpectedData);
    if (resolveUserId(action) !== actorId) {
      await action.answerCallbackQuery();
      continue;
    }
    return action;
  }
}

async function waitForActorTextInput(conversation: BotConversation, actorId: string) {
  while (true) {
    const messageCtx = await waitForTextInput(conversation);
    if (resolveUserId(messageCtx) !== actorId) {
      await conversation.skip({ next: true });
      continue;
    }
    return messageCtx;
  }
}

async function chooseSchedule(conversation: BotConversation, ctx: Context, actorId: string) {
  while (true) {
    await ctx.reply("Pilih jadwal untuk autonomous job:", {
      reply_markup: buildSchedulePresetKeyboard(),
    });

    const choice = await waitForActorCallbackData(conversation, actorId, isScheduleCallbackData);
    await choice.answerCallbackQuery();

    switch (choice.callbackQuery.data) {
      case uiCallbacks.schedulePreset10m:
        return { scheduleMode: "interval" as const, intervalSec: 600 };
      case uiCallbacks.schedulePreset30m:
        return { scheduleMode: "interval" as const, intervalSec: 1800 };
      case uiCallbacks.schedulePreset1h:
        return { scheduleMode: "interval" as const, intervalSec: 3600 };
      case uiCallbacks.schedulePreset6h:
        return { scheduleMode: "interval" as const, intervalSec: 21600 };
      case uiCallbacks.schedulePreset12h:
        return { scheduleMode: "interval" as const, intervalSec: 43200 };
      case uiCallbacks.schedulePreset24h:
        return { scheduleMode: "interval" as const, intervalSec: 86400 };
      case uiCallbacks.customCron: {
        while (true) {
          await ctx.reply("Kirim cron expression untuk autonomous job.");
          const cronCtx = await waitForActorTextInput(conversation, actorId);
          const cronExpr = cronCtx.message.text.trim();
          if (!cronExpr) {
            await cronCtx.reply("Cron expression tidak boleh kosong.");
            continue;
          }

          try {
            return { scheduleMode: "cron" as const, cronExpr: validateCronExpression(cronExpr) };
          } catch (error) {
            await cronCtx.reply(error instanceof Error ? error.message : String(error));
          }
        }
      }
      case uiCallbacks.cancel:
        return null;
      default:
        await choice.reply("Pilih preset atau custom cron.");
        break;
    }
  }
}

export function createJobCreateConversation(deps: JobCreateConversationDeps) {
  return async function jobCreateConversation(conversation: BotConversation, ctx: Context) {
    const chatId = resolveChatId(ctx);
    const userId = resolveUserId(ctx);

    await ctx.reply("Kirim prompt untuk autonomous job baru.");
    let prompt = "";

    while (!prompt) {
      const promptCtx = await waitForActorTextInput(conversation, userId);
      prompt = promptCtx.message.text.trim();
      if (!prompt) {
        await promptCtx.reply("Prompt tidak boleh kosong.");
      }
    }

    const schedule = await chooseSchedule(conversation, ctx, userId);
    if (!schedule) {
      await ctx.reply("Pembuatan autonomous job dibatalkan.");
      return;
    }

    const job = await conversation.external(() =>
      deps.autonomousJobs.createJob({
        chatId,
        userId,
        prompt,
        schedule,
      }),
    );

    await ctx.reply(`Autonomous job dibuat: #${job.id}\nSchedule: ${job.scheduleLabel}`);
  };
}
