import { InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import type { BotConversation } from "../context";
import { buildMemorySummaryKeyboard, buildSkillDraftKeyboard, uiCallbacks } from "../ui/keyboards";
import { buildRichMemorySummary, renderMemorySummaryScreen, renderSkillDraftScreen } from "../ui/renderers";
import type { MemoryService } from "../../memory/core/service";
import { truncateText } from "../../utils/text";
import { waitForCallbackData, waitForTextInput } from "./waits";

export const skillDraftConversationId = "skill-draft";

const skillDraftCallbacks = {
  back: "skill-draft:back",
  taskPrefix: "skill-draft:task:",
} as const;

function isSkillDraftCallbackData(data: string | undefined) {
  return data === uiCallbacks.memory || data === uiCallbacks.generateSkillDraft || data === skillDraftCallbacks.back || data?.startsWith(skillDraftCallbacks.taskPrefix) === true;
}

export type SkillDraftConversationDeps = {
  memory: MemoryService;
};

function resolveChatId(ctx: Context) {
  return String(ctx.chat?.id ?? "unknown");
}

function resolveUserId(ctx: Context) {
  return String(ctx.from?.id ?? ctx.chat?.id ?? "unknown");
}

function buildTaskCanvasKeyboard(tasks: Array<{ id: number; label: string }>) {
  const keyboard = new InlineKeyboard();
  for (const task of tasks) {
    keyboard.text(`#${task.id} ${truncateText(task.label, 40)}`, `${skillDraftCallbacks.taskPrefix}${task.id}`).row();
  }
  keyboard.text("Back", skillDraftCallbacks.back);
  return keyboard;
}

function renderSkillDraftSummary(generatedSkillCount: number, note?: string) {
  return [
    `Generated drafts: ${generatedSkillCount}`,
    note ? "" : null,
    note ? `Note: ${note}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function createSkillDraftConversation(deps: SkillDraftConversationDeps) {
  return async function skillDraftConversation(conversation: BotConversation, ctx: Context) {
    const chatId = resolveChatId(ctx);
    const userId = resolveUserId(ctx);
    let note: string | undefined;

    const render = async (messageCtx: Context) => {
      const generatedSkillCount = await conversation.external(() => deps.memory.countGeneratedSkills(userId));
      const text = renderSkillDraftScreen(renderSkillDraftSummary(generatedSkillCount, note));
      const keyboard = buildSkillDraftKeyboard();

      if (messageCtx.callbackQuery) {
        await messageCtx.editMessageText(text, { reply_markup: keyboard });
      } else {
        await messageCtx.reply(text, { reply_markup: keyboard });
      }
    };

    const renderMemorySummary = async (messageCtx: Context) => {
      const summary = await conversation.external(async () => {
        const [memoryStatus, recall, generatedSkillCount] = await Promise.all([
          deps.memory.memoryStatus(userId, chatId),
          deps.memory.recall(userId, "project preferences workflow coding", 5, chatId),
          deps.memory.countGeneratedSkills(userId),
        ]);
        return buildRichMemorySummary({
          memoryStatus,
          recall,
          memoryUpdateSummary: "Memory Update tersedia dari menu.",
          generatedSkillCount,
        });
      });
      await messageCtx.editMessageText(renderMemorySummaryScreen(summary), {
        reply_markup: buildMemorySummaryKeyboard(),
      });
    };

    await render(ctx);

    while (true) {
      const action = await waitForCallbackData(conversation, isSkillDraftCallbackData);
      await action.answerCallbackQuery();
      note = undefined;

      switch (action.callbackQuery.data) {
        case uiCallbacks.memory:
          await renderMemorySummary(action);
          return;
        case uiCallbacks.generateSkillDraft: {
          const tasks = await conversation.external(() => deps.memory.listTaskCanvases(userId, chatId, 10));
          if (tasks.length === 0) {
            note = "Belum ada task canvas untuk chat ini.";
            await render(action);
            break;
          }
          await action.editMessageText("Pilih task canvas untuk draft skill:", {
            reply_markup: buildTaskCanvasKeyboard(tasks),
          });
          break;
        }
        case skillDraftCallbacks.back:
          await render(action);
          break;
        default: {
          if (!action.callbackQuery.data.startsWith(skillDraftCallbacks.taskPrefix)) {
            note = "Pilih action Skill Drafts.";
            await render(action);
            break;
          }

          const taskId = Number(action.callbackQuery.data.slice(skillDraftCallbacks.taskPrefix.length));
          if (!Number.isFinite(taskId)) {
            note = "Task canvas tidak valid.";
            await render(action);
            break;
          }

          await action.reply("Kirim focus skill, atau '-' untuk tanpa focus.");
          const focusCtx = await waitForTextInput(conversation);
          const rawFocus = focusCtx.message.text.trim();
          const skillFocus = rawFocus && rawFocus !== "-" ? rawFocus : undefined;
          const result = await conversation.external(() =>
            deps.memory.generateSkillDraft({
              chatId,
              userId,
              taskId,
              skillFocus,
            }),
          );

          if (result.ok) {
            await focusCtx.reply(`Draft skill dibuat: ${result.skillName}\nFile: ${result.filePath}`);
          } else {
            await focusCtx.reply(`Gagal membuat draft skill: ${result.reason}`);
          }
          await render(focusCtx);
          break;
        }
      }
    }
  };
}
