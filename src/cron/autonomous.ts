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
import { emitTrace } from "../logging/helpers";
import { runWithLlmRequestContext } from "../logging/llm-request-context";
import type { RuntimeTraceEmitter } from "../logging/types";
import { splitTelegramMessage, truncateText } from "../utils/text";
import { unixNow } from "../utils/time";

export type AutonomousDeps = {
  db: Database;
  bot: Bot<BotContext>;
  memory: MemoryService;
  registry: ToolRegistry;
  llm: LlmProvider;
  trace?: RuntimeTraceEmitter;
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
  trace?: RuntimeTraceEmitter;
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
  fixed_text_sent_at: number | null;
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
    fixedTextSentAt: row.fixed_text_sent_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    scheduleLabel: describeSchedule(schedule),
  };
}

export async function runOneAutonomousJob(input: AutonomousRunInput) {
  const now = input.nowUnix ?? unixNow();
  const jobService = new AutonomousJobService(input.db);
  let currentJob = jobService.markRunStarted(input.job.id, now);
  emitTrace(input.trace, {
    minLevel: 1,
    source: "autonomous",
    event: "job.start",
    chatId: currentJob.chatId,
    userId: currentJob.userId,
    jobId: String(currentJob.id),
    payload: { nowUnix: now, jobType: currentJob.jobType, runCount: currentJob.runCount },
  });

  return runWithLlmRequestContext({
    trace: input.trace,
    requestType: "autonomous_job",
    chatId: currentJob.chatId,
    userId: currentJob.userId,
    jobId: String(currentJob.id),
  }, async () => {
    try {
      const shouldSendFixedText =
        currentJob.jobType === "hybrid" &&
        currentJob.messageText.trim().length > 0 &&
        !(currentJob.scheduleMode === "once" && currentJob.fixedTextSentAt != null);

      if (shouldSendFixedText) {
        const sent = await sendTelegramText(input.bot, currentJob.chatId, currentJob.messageText, `Failed to send hybrid job text #${currentJob.id}`);
        if (!sent) throw new Error(`Failed to send hybrid job text #${currentJob.id}`);
        if (currentJob.scheduleMode === "once") {
          currentJob = jobService.markFixedTextSent(currentJob.id, now);
        }
      }

      const agentPrompt = currentJob.jobType === "hybrid" && currentJob.agentPrompt.trim() ? currentJob.agentPrompt : currentJob.prompt;
      const answer = await (input.runAgent ?? runReactAgent)({
        chatId: currentJob.chatId,
        userId: currentJob.userId,
        input: `[AUTONOMOUS_JOB #${currentJob.id}] ${agentPrompt}`,
        memory: input.memory,
        registry: input.registry,
        llm: input.llm,
        mode: "autonomous",
        trace: input.trace,
      });

      const text = `🤖 Autonomous job #${currentJob.id}\n\n${truncateText(answer, 3500)}`;
      const sent = await sendTelegramText(input.bot, currentJob.chatId, text, `Failed to send autonomous job #${currentJob.id}`);
      if (!sent) throw new Error(`Failed to send autonomous job #${currentJob.id}`);

      const finishedAt = input.finishedUnix ?? unixNow();
      jobService.markRunFinished(currentJob.id, finishedAt, "success", null);
      const completion = jobService.recordSuccessfulRun(currentJob.id);
      emitTrace(input.trace, {
        minLevel: 1,
        source: "autonomous",
        event: "job.complete",
        chatId: currentJob.chatId,
        userId: currentJob.userId,
        jobId: String(currentJob.id),
        payload: { finishedAtUnix: finishedAt, answerLength: answer.length, deleted: completion.deleted, runCount: completion.runCount },
      });

      return { job: completion.job, answer, deleted: completion.deleted, runCount: completion.runCount };
    } catch (error) {
      const finishedAt = input.finishedUnix ?? unixNow();
      const message = toErrorMessage(error);
      jobService.markRunFinished(currentJob.id, finishedAt, "error", message);
      emitTrace(input.trace, {
        minLevel: 1,
        source: "autonomous",
        event: "job.error",
        chatId: currentJob.chatId,
        userId: currentJob.userId,
        jobId: String(currentJob.id),
        payload: { finishedAtUnix: finishedAt },
        error,
      });
      const failureText = `🤖 Autonomous job #${currentJob.id} failed\n\n${truncateText(message, 3500)}`;
      await sendTelegramText(input.bot, currentJob.chatId, failureText, `Failed to send autonomous job failure #${currentJob.id}`);
      throw error;
    }
  });
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

  return runWithLlmRequestContext({
    trace: input.trace,
    requestType: "memory_update",
    userId: input.userId,
  }, async () => {
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
  });
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
          SELECT id, chat_id, user_id, prompt, job_type, message_text, agent_prompt, enabled, schedule_mode, run_at_unix, interval_sec, cron_expr, run_count, max_runs, last_run_at, last_finished_at, fixed_text_sent_at, last_status, last_error, created_at, updated_at
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
