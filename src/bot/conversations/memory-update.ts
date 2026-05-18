import { InlineKeyboard } from "grammy";
import type { BotConversation } from "../context";
import type { Context } from "grammy";
import { buildMemorySummaryKeyboard, buildSchedulePresetKeyboard, uiCallbacks } from "../ui/keyboards";
import { buildRichMemorySummary, renderMemorySummaryScreen } from "../ui/renderers";
import type { MemoryService } from "../../memory/core/service";
import { MemoryUpdateSettingsService, type MemoryUpdateSettingsRow } from "../../services/memory-update-settings";
import { validateCronExpression } from "../../services/schedules";
import { startTelegramMemoryUpdateRun } from "./memory-update-runner";
import { waitForCallbackData, waitForTextInput } from "./waits";

export type MemoryUpdateConversationDeps = {
  memory: MemoryService;
  settings: MemoryUpdateSettingsService;
};

export const memoryUpdateCallbacks = {
  runNow: "memory-update:run-now",
  toggleEnabled: "memory-update:toggle-enabled",
  changeSchedule: "memory-update:change-schedule",
  back: "memory-update:back",
} as const;

const memoryUpdateCallbackData = new Set<string>(Object.values(memoryUpdateCallbacks));
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

function isCallbackDataIn(dataSet: ReadonlySet<string>) {
  return (data: string | undefined) => data !== undefined && dataSet.has(data);
}

async function waitForMemoryUpdateCallback(conversation: BotConversation) {
  return waitForCallbackData(conversation, isCallbackDataIn(memoryUpdateCallbackData));
}

async function waitForScheduleCallback(conversation: BotConversation) {
  return waitForCallbackData(conversation, isCallbackDataIn(scheduleCallbackData));
}

function resolveUserId(ctx: Context) {
  return String(ctx.from?.id ?? ctx.chat?.id ?? "unknown");
}

function normalizeLines(lines: Array<string | false | null | undefined>) {
  return lines.filter(Boolean).join("\n");
}

function buildMemoryUpdateKeyboard(setting: MemoryUpdateSettingsRow) {
  return new InlineKeyboard()
    .text("Run now", memoryUpdateCallbacks.runNow)
    .text(setting.enabled ? "Disable" : "Enable", memoryUpdateCallbacks.toggleEnabled)
    .row()
    .text("Change schedule", memoryUpdateCallbacks.changeSchedule)
    .text("Back", memoryUpdateCallbacks.back);
}

function renderMemoryUpdateScreen(setting: MemoryUpdateSettingsRow, note?: string) {
  return normalizeLines([
    "Memory Update",
    "",
    `Enabled: ${setting.enabled ? "yes" : "no"}`,
    `Schedule: ${setting.scheduleLabel}`,
    setting.lastStatus ? `Last status: ${setting.lastStatus}${setting.lastError ? ` (${setting.lastError})` : ""}` : "Last status: never run",
    note ? "" : null,
    note ? `Note: ${note}` : null,
    "",
    "Actions:",
    "- Run now",
    "- Enable/Disable",
    "- Change schedule",
    "- Back",
  ]);
}

async function chooseSchedule(conversation: BotConversation, ctx: Context) {
  while (true) {
    await ctx.reply("Pilih jadwal untuk Memory Update:", {
      reply_markup: buildSchedulePresetKeyboard(),
    });

    const choice = await waitForScheduleCallback(conversation);
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
          await ctx.reply("Kirim cron expression untuk Memory Update.");
          const cronCtx = await waitForTextInput(conversation);
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

export function createMemoryUpdateConversation(deps: MemoryUpdateConversationDeps) {
  return async function memoryUpdateConversation(conversation: BotConversation, ctx: Context) {
    const userId = resolveUserId(ctx);
    let note: string | undefined;

    const render = async (messageCtx: Context) => {
      const setting = await conversation.external(() => deps.settings.getOrCreate(userId));
      const text = renderMemoryUpdateScreen(setting, note);
      const keyboard = buildMemoryUpdateKeyboard(setting);

      if (messageCtx.callbackQuery) {
        await messageCtx.editMessageText(text, { reply_markup: keyboard });
      } else {
        await messageCtx.reply(text, { reply_markup: keyboard });
      }
    };

    await render(ctx);

    while (true) {
      const action = await waitForMemoryUpdateCallback(conversation);
      await action.answerCallbackQuery();
      const setting = await conversation.external(() => deps.settings.getOrCreate(userId));
      note = undefined;

      switch (action.callbackQuery.data) {
        case memoryUpdateCallbacks.back: {
          const summary = await conversation.external(async () => {
            const chatId = String(action.chat?.id ?? ctx.chat?.id ?? "");
            const [memoryStatus, recall, freshSetting] = await Promise.all([
              deps.memory.memoryStatus(userId, chatId),
              deps.memory.recall(userId, "project preferences workflow coding", 5, chatId),
              deps.settings.getOrCreate(userId),
            ]);
            return buildRichMemorySummary({
              memoryStatus,
              recall,
              memoryUpdateSummary: deps.settings.renderSummary(freshSetting),
            });
          });
          await action.editMessageText(renderMemorySummaryScreen(summary), {
            reply_markup: buildMemorySummaryKeyboard(),
          });
          return;
        }
        case memoryUpdateCallbacks.runNow: {
          const rawChatId = action.chat?.id ?? ctx.chat?.id;
          if (rawChatId == null) {
            note = "Tidak bisa menjalankan Memory Update dari tombol ini.";
            await render(action);
            break;
          }

          const chatId = String(rawChatId);
          const result = await conversation.external(async (outsideCtx) => {
            const run = await startTelegramMemoryUpdateRun({
              memory: deps.memory,
              settings: deps.settings,
              userId,
              sendMessage: (text) => outsideCtx.api.sendMessage(chatId, text),
            });
            return { status: run.status };
          });
          note = result.status === "started"
            ? "Run now dimulai. Progress dikirim sebagai pesan baru."
            : "Memory update masih berjalan untuk user ini.";
          await render(action);
          break;
        }
        case memoryUpdateCallbacks.toggleEnabled: {
          const updated = await conversation.external(() => deps.settings.setEnabled(userId, !setting.enabled));
          note = `Enabled ${updated.enabled ? "on" : "off"}`;
          await render(action);
          break;
        }
        case memoryUpdateCallbacks.changeSchedule: {
          const schedule = await chooseSchedule(conversation, ctx);
          if (!schedule) {
            note = "Schedule unchanged.";
            await render(action);
            break;
          }

          const updated = await conversation.external(() => deps.settings.updateSchedule(userId, schedule));
          note = `Schedule updated to ${updated.scheduleLabel}`;
          await render(action);
          break;
        }
        default:
          note = "Unknown action.";
          await render(action);
          break;
      }
    }
  };
}

export const memoryUpdateConversationId = "memory-update";
