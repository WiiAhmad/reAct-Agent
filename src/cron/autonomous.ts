import cron from "node-cron";
import type { Bot } from "grammy";
import type { Database } from "bun:sqlite";
import { config } from "../config";
import type { LlmProvider } from "../agent/types";
import { runReactAgent } from "../agent/react-agent";
import type { MemoryService } from "../memory/core/service";
import { emitMemoryUpdateProgress, type MemoryUpdateProgressReporter, type MemoryUpdateSource } from "../memory/pipeline/progress";
import { AutonomousJobService, type AutonomousJobRow } from "../services/autonomous-jobs";
import { MemoryUpdateSettingsService } from "../services/memory-update-settings";
import { describeSchedule, normalizeSchedule } from "../services/schedules";
import type { BotContext } from "../bot/context";
import type { ToolRegistry } from "../tools/registry";
import { splitTelegramMessage, truncateText } from "../utils/text";
import { unixNow } from "../utils/time";

export type AutonomousDeps = {
  db: Database;
  bot: Bot<BotContext>;
  memory: MemoryService;
  registry: ToolRegistry;
  llm: LlmProvider;
};

export type AutonomousRunInput = AutonomousDeps & {
  job: AutonomousJobRow;
  nowUnix?: number;
  finishedUnix?: number;
  runAgent?: typeof runReactAgent;
};

export type MemoryUpdateRunNowInput = {
  memory: MemoryService;
  settings: MemoryUpdateSettingsService;
  userId: string;
  source?: MemoryUpdateSource;
  onProgress?: MemoryUpdateProgressReporter;
  nowUnix?: number;
  finishedUnix?: number;
};

let autonomousBusy = false;
let memoryBusy = false;

type AutonomousJobDbRow = {
  id: number;
  chat_id: string;
  user_id: string;
  prompt: string;
  job_type: "agent" | "hybrid";
  message_text: string;
  agent_prompt: string;
  enabled: number;
  schedule_mode: "once" | "interval" | "cron";
  run_at_unix: number | null;
  interval_sec: number | null;
  cron_expr: string | null;
  run_count: number;
  max_runs: number | null;
  last_run_at: number | null;
  last_finished_at: number | null;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function logCronEvent(event: string, details: Record<string, unknown>) {
  console.log(`[cron:${event}]`, details);
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function sendTelegramText(bot: Bot<BotContext>, chatId: string, text: string, errorLabel: string): Promise<boolean> {
  let sent = true;
  for (const chunk of splitTelegramMessage(text)) {
    await bot.api.sendMessage(chatId, chunk).catch((error) => {
      sent = false;
      console.error(errorLabel, error);
    });
  }
  return sent;
}

function logMemoryUpdateEvent(event: string, details: Record<string, unknown>) {
  console.log(`[memory-update:${event}]`, details);
}

async function reportMemoryUpdateProgress(
  reporter: MemoryUpdateProgressReporter | undefined,
  event: Parameters<typeof emitMemoryUpdateProgress>[1],
) {
  logMemoryUpdateEvent(`${event.stage}-${event.status}`, event);
  try {
    await emitMemoryUpdateProgress(reporter, event);
  } catch (error) {
    console.error("Failed to report memory update progress", {
      event,
      error: toErrorMessage(error),
    });
  }
}

export function mapAutonomousJobRow(row: AutonomousJobDbRow): AutonomousJobRow {
  const schedule = normalizeSchedule({
    scheduleMode: row.schedule_mode,
    runAtUnix: row.run_at_unix,
    intervalSec: row.interval_sec,
    cronExpr: row.cron_expr,
    lastFinishedAt: row.last_finished_at,
  });

  return {
    id: row.id,
    chatId: row.chat_id,
    userId: row.user_id,
    prompt: row.prompt,
    jobType: row.job_type,
    messageText: row.message_text,
    agentPrompt: row.agent_prompt,
    runAtUnix: schedule.runAtUnix,
    runCount: row.run_count,
    maxRuns: row.max_runs,
    enabled: row.enabled === 1,
    scheduleMode: schedule.scheduleMode,
    intervalSec: schedule.intervalSec,
    cronExpr: schedule.cronExpr,
    lastRunAt: row.last_run_at,
    lastFinishedAt: row.last_finished_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    scheduleLabel: describeSchedule(schedule),
  };
}

export async function runOneAutonomousJob(input: AutonomousRunInput) {
  const now = input.nowUnix ?? unixNow();
  const finishedAt = input.finishedUnix ?? unixNow();
  const jobService = new AutonomousJobService(input.db);
  jobService.markRunStarted(input.job.id, now);

  try {
    if (input.job.jobType === "hybrid" && input.job.messageText.trim()) {
      const sent = await sendTelegramText(input.bot, input.job.chatId, input.job.messageText, `Failed to send hybrid job text #${input.job.id}`);
      if (!sent) throw new Error(`Failed to send hybrid job text #${input.job.id}`);
    }

    const agentPrompt = input.job.jobType === "hybrid" && input.job.agentPrompt.trim() ? input.job.agentPrompt : input.job.prompt;
    const answer = await (input.runAgent ?? runReactAgent)({
      chatId: input.job.chatId,
      userId: input.job.userId,
      input: `[AUTONOMOUS_JOB #${input.job.id}] ${agentPrompt}`,
      memory: input.memory,
      registry: input.registry,
      llm: input.llm,
      mode: "autonomous",
    });

    const text = `🤖 Autonomous job #${input.job.id}\n\n${truncateText(answer, 3500)}`;
    const sent = await sendTelegramText(input.bot, input.job.chatId, text, `Failed to send autonomous job #${input.job.id}`);
    if (!sent) throw new Error(`Failed to send autonomous job #${input.job.id}`);

    jobService.markRunFinished(input.job.id, finishedAt, "success", null);
    const completion = jobService.recordSuccessfulRun(input.job.id);

    return { job: completion.job, answer, deleted: completion.deleted, runCount: completion.runCount };
  } catch (error) {
    const message = toErrorMessage(error);
    jobService.markRunFinished(input.job.id, finishedAt, "error", message);
    const failureText = `🤖 Autonomous job #${input.job.id} failed\n\n${truncateText(message, 3500)}`;
    await sendTelegramText(input.bot, input.job.chatId, failureText, `Failed to send autonomous job failure #${input.job.id}`);
    throw error;
  }
}

export async function runOneMemoryUpdateNow(input: MemoryUpdateRunNowInput) {
  const source = input.source ?? "scheduler";
  const now = input.nowUnix ?? unixNow();
  const startedAtMs = Date.now();
  input.settings.markRunStarted(input.userId, now);

  await reportMemoryUpdateProgress(input.onProgress, {
    source,
    userId: input.userId,
    stage: "run",
    status: "start",
    startedAtUnix: now,
  });

  try {
    const maintenanceResult = await input.memory.runMaintenanceForUser(input.userId, true, {
      source,
      onProgress: (event) => reportMemoryUpdateProgress(input.onProgress, event),
    });
    const finishedAt = input.finishedUnix ?? unixNow();
    const finished = input.settings.markRunFinished(input.userId, finishedAt, "success", null);
    await reportMemoryUpdateProgress(input.onProgress, {
      source,
      userId: input.userId,
      stage: "run",
      status: "complete",
      startedAtUnix: now,
      finishedAtUnix: finishedAt,
      durationMs: Date.now() - startedAtMs,
      createdAtoms: maintenanceResult.l1Created,
      scenarioId: maintenanceResult.l2ScenarioId,
      personaUpdated: maintenanceResult.personaUpdated,
    });
    return { settings: finished, maintenanceResult };
  } catch (error) {
    const message = toErrorMessage(error);
    const finishedAt = input.finishedUnix ?? unixNow();
    input.settings.markRunFinished(input.userId, finishedAt, "error", message);
    await reportMemoryUpdateProgress(input.onProgress, {
      source,
      userId: input.userId,
      stage: "run",
      status: "error",
      startedAtUnix: now,
      finishedAtUnix: finishedAt,
      durationMs: Date.now() - startedAtMs,
      error: message,
    });
    throw error;
  }
}

export function startAutonomousLoop(deps: AutonomousDeps) {
  cron.schedule(config.autonomous.cron, async () => {
    if (autonomousBusy) {
      logCronEvent("autonomous-skip", { reason: "busy" });
      return;
    }
    autonomousBusy = true;
    try {
      const now = unixNow();
      const jobs = deps.db
        .query(`
          SELECT id, chat_id, user_id, prompt, job_type, message_text, agent_prompt, enabled, schedule_mode, run_at_unix, interval_sec, cron_expr, run_count, max_runs, last_run_at, last_finished_at, last_status, last_error, created_at, updated_at
          FROM autonomous_jobs
          WHERE enabled = 1
          ORDER BY id ASC
          LIMIT ?
        `)
        .all(config.autonomous.maxJobsPerTick) as AutonomousJobDbRow[];

      const mappedJobs = jobs.map(mapAutonomousJobRow);

      logCronEvent("autonomous-tick", {
        cron: config.autonomous.cron,
        jobCount: mappedJobs.length,
        maxJobsPerTick: config.autonomous.maxJobsPerTick,
      });

      for (const job of mappedJobs) {
        if (job.lastRunAt && now - job.lastRunAt < config.autonomous.minIntervalSec) {
          logCronEvent("autonomous-job-skip", {
            jobId: job.id,
            chatId: job.chatId,
            userId: job.userId,
            reason: "min_interval",
          });
          continue;
        }

        logCronEvent("autonomous-job-start", {
          jobId: job.id,
          chatId: job.chatId,
          userId: job.userId,
          prompt: truncateText(job.prompt, 160),
        });

        try {
          const result = await runOneAutonomousJob({ ...deps, job, nowUnix: now });
          logCronEvent("autonomous-job-complete", {
            jobId: job.id,
            chatId: job.chatId,
            answerLength: result.answer.length,
            answerPreview: truncateText(result.answer, 200),
          });
        } catch (error) {
          logCronEvent("autonomous-job-error", {
            jobId: job.id,
            chatId: job.chatId,
            error: toErrorMessage(error),
          });
        }
      }
    } finally {
      autonomousBusy = false;
    }
  });

  console.log(`Autonomous loop scheduled from .env AUTONOMOUS_CRON=${config.autonomous.cron}`);
}

export function startMemoryMaintenanceLoop(input: { db: Database; memory: MemoryService; llm: LlmProvider }) {
  cron.schedule(config.memory.maintenanceCron, async () => {
    if (memoryBusy) {
      logCronEvent("memory-skip", { reason: "busy" });
      return;
    }
    memoryBusy = true;
    try {
      const users = input.db.query(`SELECT DISTINCT user_id FROM conversations ORDER BY id DESC LIMIT 50`).all() as Array<{ user_id: string }>;
      logCronEvent("memory-tick", {
        cron: config.memory.maintenanceCron,
        userCount: users.length,
      });
      for (const user of users) {
        try {
          const result = await input.memory.runMaintenanceForUser(user.user_id);
          if (result.l1Created || result.l2ScenarioId || result.personaUpdated) {
            console.log(`Memory maintenance user=${user.user_id} L1=${result.l1Created} L2=${result.l2ScenarioId ?? "-"} L3=${result.personaUpdated}`);
          }
        } catch (error) {
          console.error(`Memory maintenance failed for ${user.user_id}`, error);
        }
      }
    } finally {
      memoryBusy = false;
    }
  });

  console.log(`Memory maintenance loop scheduled from .env MEMORY_MAINTENANCE_CRON=${config.memory.maintenanceCron}`);
}
