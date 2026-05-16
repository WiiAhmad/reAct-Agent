import cron from "node-cron";
import type { Bot } from "grammy";
import type { Database } from "bun:sqlite";
import { config } from "../config";
import type { LlmProvider } from "../agent/types";
import { runReactAgent } from "../agent/react-agent";
import type { MemoryStore } from "../memory/store";
import type { ToolRegistry } from "../tools/registry";
import { splitTelegramMessage, truncateText } from "../utils/text";
import { unixNow } from "../utils/time";

export type AutonomousDeps = {
  db: Database;
  bot: Bot;
  memory: MemoryStore;
  registry: ToolRegistry;
  llm: LlmProvider;
};

let autonomousBusy = false;
let memoryBusy = false;

function logCronEvent(event: string, details: Record<string, unknown>) {
  console.log(`[cron:${event}]`, details);
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
          SELECT id, chat_id, user_id, prompt, last_run_at
          FROM autonomous_jobs
          WHERE enabled = 1
          ORDER BY id ASC
          LIMIT ?
        `)
        .all(config.autonomous.maxJobsPerTick) as Array<{ id: number; chat_id: string; user_id: string; prompt: string; last_run_at: number | null }>;

      logCronEvent("autonomous-tick", {
        cron: config.autonomous.cron,
        jobCount: jobs.length,
        maxJobsPerTick: config.autonomous.maxJobsPerTick,
      });

      for (const job of jobs) {
        if (job.last_run_at && now - job.last_run_at < config.autonomous.minIntervalSec) {
          logCronEvent("autonomous-job-skip", {
            jobId: job.id,
            chatId: job.chat_id,
            userId: job.user_id,
            reason: "min_interval",
          });
          continue;
        }

        logCronEvent("autonomous-job-start", {
          jobId: job.id,
          chatId: job.chat_id,
          userId: job.user_id,
          prompt: truncateText(job.prompt, 160),
        });

        deps.db.query(`UPDATE autonomous_jobs SET last_run_at = ?, updated_at = ? WHERE id = ?`).run(now, new Date().toISOString(), job.id);

        const answer = await runReactAgent({
          chatId: job.chat_id,
          userId: job.user_id,
          input: `[AUTONOMOUS_JOB #${job.id}] ${job.prompt}`,
          memory: deps.memory,
          registry: deps.registry,
          llm: deps.llm,
          mode: "autonomous",
        }).catch((error) => `Autonomous job #${job.id} failed: ${error instanceof Error ? error.message : String(error)}`);

        logCronEvent("autonomous-job-complete", {
          jobId: job.id,
          chatId: job.chat_id,
          answerLength: answer.length,
          answerPreview: truncateText(answer, 200),
        });

        const text = `🤖 Autonomous job #${job.id}\n\n${truncateText(answer, 3500)}`;
        for (const chunk of splitTelegramMessage(text)) {
          await deps.bot.api.sendMessage(job.chat_id, chunk).catch((error) => {
            console.error(`Failed to send autonomous job #${job.id}`, error);
          });
        }
      }
    } finally {
      autonomousBusy = false;
    }
  });

  console.log(`Autonomous loop scheduled from .env AUTONOMOUS_CRON=${config.autonomous.cron}`);
}

export function startMemoryMaintenanceLoop(input: { db: Database; memory: MemoryStore; llm: LlmProvider }) {
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
          const result = await input.memory.runMaintenanceForUser(user.user_id, input.llm);
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
