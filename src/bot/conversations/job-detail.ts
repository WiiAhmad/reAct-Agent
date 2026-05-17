import { InlineKeyboard } from "grammy";
import type { BotConversation } from "../context";
import type { Context } from "grammy";
import { buildSchedulePresetKeyboard, uiCallbacks } from "../ui/keyboards";
import { renderJobsScreen } from "../ui/renderers";
import { validateCronExpression } from "../../services/schedules";
import type { AutonomousJobRow, AutonomousJobService } from "../../services/autonomous-jobs";

export type JobDetailConversationDeps = {
  autonomousJobs: AutonomousJobService;
};

const jobDetailCallbacks = {
  editPrompt: "jobs:detail:edit-prompt",
  changeSchedule: "jobs:detail:change-schedule",
  toggleEnabled: "jobs:detail:toggle-enabled",
  delete: "jobs:detail:delete",
  deleteConfirm: "jobs:detail:delete-confirm",
  deleteCancel: "jobs:detail:delete-cancel",
  back: "jobs:detail:back",
} as const;

function resolveChatId(ctx: Context) {
  return String(ctx.chat?.id ?? "unknown");
}

function normalizeLines(lines: Array<string | false | null | undefined>) {
  return lines.filter(Boolean).join("\n");
}

function buildJobDetailKeyboard(job: AutonomousJobRow) {
  return new InlineKeyboard()
    .text("Edit prompt", jobDetailCallbacks.editPrompt)
    .text("Change schedule", jobDetailCallbacks.changeSchedule)
    .row()
    .text(job.enabled ? "Disable" : "Enable", jobDetailCallbacks.toggleEnabled)
    .text("Delete", jobDetailCallbacks.delete)
    .row()
    .text("Back", jobDetailCallbacks.back);
}

function buildDeleteConfirmKeyboard() {
  return new InlineKeyboard().text("Delete", jobDetailCallbacks.deleteConfirm).text("Cancel", jobDetailCallbacks.deleteCancel);
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

function renderJobDetailScreen(job: AutonomousJobRow, note?: string) {
  return normalizeLines([
    `Autonomous job #${job.id}`,
    "",
    `Enabled: ${job.enabled ? "yes" : "no"}`,
    `Schedule: ${job.scheduleLabel}`,
    `Prompt: ${job.prompt}`,
    job.lastStatus ? `Last status: ${job.lastStatus}${job.lastError ? ` (${job.lastError})` : ""}` : "Last status: never run",
    note ? "" : null,
    note ? `Note: ${note}` : null,
    "",
    "Actions:",
    "- Edit prompt",
    "- Change schedule",
    "- Enable/Disable",
    "- Delete",
    "- Back",
  ]);
}

function renderJobsSummary(jobs: AutonomousJobRow[]) {
  return jobs.length ? jobs.map((item) => `#${item.id} ${item.enabled ? "enabled" : "disabled"}\n${item.scheduleLabel}\n${item.prompt}`).join("\n\n") : "Belum ada autonomous jobs.";
}

async function chooseSchedule(conversation: BotConversation, ctx: Context) {
  while (true) {
    await ctx.reply("Pilih jadwal untuk autonomous job:", {
      reply_markup: buildSchedulePresetKeyboard(),
    });

    const choice = await conversation.waitFor("callback_query:data");
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
          const cronCtx = await conversation.waitFor("message:text");
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

export function createJobDetailConversation(deps: JobDetailConversationDeps) {
  return async function jobDetailConversation(conversation: BotConversation, ctx: Context, jobId: number) {
    const chatId = resolveChatId(ctx);
    let note: string | undefined;

    const loadedJob = await conversation.external(() => deps.autonomousJobs.getJobByChat(chatId, jobId));
    if (!loadedJob) {
      await ctx.reply(`Autonomous job #${jobId} tidak ditemukan.`);
      return;
    }
    let currentJob = loadedJob;

    const render = async (messageCtx: Context) => {
      const text = renderJobDetailScreen(currentJob, note);
      const keyboard = buildJobDetailKeyboard(currentJob);
      if (messageCtx.callbackQuery) {
        await messageCtx.editMessageText(text, { reply_markup: keyboard });
      } else {
        await messageCtx.reply(text, { reply_markup: keyboard });
      }
    };

    await render(ctx);

    while (true) {
      const action = await conversation.waitFor("callback_query:data");
      await action.answerCallbackQuery();
      note = undefined;

      switch (action.callbackQuery.data) {
        case jobDetailCallbacks.back: {
          const jobs = await conversation.external(() => deps.autonomousJobs.listJobsForChat(chatId));
          await action.editMessageText(renderJobsScreen(renderJobsSummary(jobs)), {
            reply_markup: buildJobsListKeyboard(jobs),
          });
          return;
        }
        case jobDetailCallbacks.editPrompt: {
          await action.reply("Kirim prompt baru untuk autonomous job ini.");
          while (true) {
            const promptCtx = await conversation.waitFor("message:text");
            const prompt = promptCtx.message.text.trim();
            if (!prompt) {
              await promptCtx.reply("Prompt tidak boleh kosong.");
              continue;
            }

            currentJob = await conversation.external(() => deps.autonomousJobs.updatePrompt(currentJob.id, prompt));
            note = "Prompt updated.";
            await render(action);
            break;
          }
          break;
        }
        case jobDetailCallbacks.changeSchedule: {
          const schedule = await chooseSchedule(conversation, ctx);
          if (!schedule) {
            note = "Schedule unchanged.";
            await render(action);
            break;
          }

          currentJob = await conversation.external(() => deps.autonomousJobs.updateSchedule(currentJob.id, schedule));
          note = `Schedule updated to ${currentJob.scheduleLabel}`;
          await render(action);
          break;
        }
        case jobDetailCallbacks.toggleEnabled: {
          currentJob = await conversation.external(() => deps.autonomousJobs.setEnabled(currentJob.id, !currentJob.enabled));
          note = currentJob.enabled ? "Job enabled." : "Job disabled.";
          await render(action);
          break;
        }
        case jobDetailCallbacks.delete: {
          await action.editMessageText(
            normalizeLines([
              `Delete autonomous job #${currentJob.id}?`,
              "",
              "This cannot be undone.",
            ]),
            { reply_markup: buildDeleteConfirmKeyboard() },
          );
          const confirm = await conversation.waitFor("callback_query:data");
          await confirm.answerCallbackQuery();

          if (confirm.callbackQuery.data === jobDetailCallbacks.deleteConfirm) {
            await conversation.external(() => deps.autonomousJobs.deleteJob(currentJob.id));
            const jobs = await conversation.external(() => deps.autonomousJobs.listJobsForChat(chatId));
            await confirm.editMessageText(renderJobsScreen(renderJobsSummary(jobs)), {
              reply_markup: buildJobsListKeyboard(jobs),
            });
            return;
          }

          const refreshedJob = await conversation.external(() => deps.autonomousJobs.getJobByChat(chatId, jobId));
          if (!refreshedJob) {
            const jobs = await conversation.external(() => deps.autonomousJobs.listJobsForChat(chatId));
            await confirm.editMessageText(renderJobsScreen(renderJobsSummary(jobs)), {
              reply_markup: buildJobsListKeyboard(jobs),
            });
            return;
          }

          currentJob = refreshedJob;
          note = "Delete canceled.";
          await render(confirm);
          break;
        }
        case jobDetailCallbacks.deleteConfirm:
        case jobDetailCallbacks.deleteCancel:
          break;
        default:
          note = "Unknown action.";
          await render(action);
          break;
      }
    }
  };
}

export const jobDetailConversationId = "job-detail";
