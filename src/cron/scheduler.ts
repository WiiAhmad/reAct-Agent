import cron from "node-cron";
import type { AutonomousJobRow, AutonomousJobService } from "../services/autonomous-jobs";
import type { MemoryUpdateSettingsService } from "../services/memory-update-settings";
import { unixNow } from "../utils/time";

export type RunOneAutonomousJob = (input: { job: AutonomousJobRow; nowUnix: number }) => Promise<unknown>;
export type RunOneMemoryUpdateNow = (input: { userId: string; nowUnix: number }) => Promise<unknown>;

export type SchedulerDispatchInput = {
  jobs: AutonomousJobService;
  memoryUpdateSettings: MemoryUpdateSettingsService;
  maxItemsPerTick: number;
  nowUnix?: number;
  runOneAutonomousJob: RunOneAutonomousJob;
  runOneMemoryUpdateNow: RunOneMemoryUpdateNow;
};

function logCronEvent(event: string, details: Record<string, unknown>) {
  console.log(`[cron:${event}]`, details);
}

export async function dispatchSchedulerTick(input: SchedulerDispatchInput) {
  const nowUnix = input.nowUnix ?? unixNow();
  const dueJobs = input.jobs.listDueJobs(nowUnix, input.maxItemsPerTick);

  let jobsRun = 0;
  for (const job of dueJobs) {
    jobsRun += 1;
    try {
      await input.runOneAutonomousJob({ job, nowUnix });
    } catch (error) {
      console.error(`Scheduler autonomous job failed for ${job.id}`, error);
    }
  }

  const remainingCapacity = Math.max(0, input.maxItemsPerTick - jobsRun);
  const dueUsers = input.memoryUpdateSettings.listDueUsers(nowUnix, remainingCapacity);

  let memoryUpdatesRun = 0;
  for (const userId of dueUsers) {
    memoryUpdatesRun += 1;
    try {
      await input.runOneMemoryUpdateNow({ userId, nowUnix });
    } catch (error) {
      console.error(`Scheduler memory update failed for ${userId}`, error);
    }
  }

  return { jobsRun, memoryUpdatesRun };
}

export type SchedulerLoopInput = SchedulerDispatchInput & {
  tickCron: string;
  nowUnixFn?: () => number;
};

export function startSchedulerLoop(input: SchedulerLoopInput) {
  let busy = false;

  const task = cron.schedule(input.tickCron, async () => {
    if (busy) {
      logCronEvent("scheduler-skip", { reason: "busy" });
      return;
    }

    busy = true;
    try {
      const result = await dispatchSchedulerTick({
        jobs: input.jobs,
        memoryUpdateSettings: input.memoryUpdateSettings,
        maxItemsPerTick: input.maxItemsPerTick,
        nowUnix: input.nowUnixFn ? input.nowUnixFn() : unixNow(),
        runOneAutonomousJob: input.runOneAutonomousJob,
        runOneMemoryUpdateNow: input.runOneMemoryUpdateNow,
      });

      logCronEvent("scheduler-tick", {
        cron: input.tickCron,
        jobsRun: result.jobsRun,
        memoryUpdatesRun: result.memoryUpdatesRun,
        maxItemsPerTick: input.maxItemsPerTick,
      });
    } finally {
      busy = false;
    }
  });

  console.log(`Scheduler loop scheduled from .env SCHEDULER_TICK_CRON=${input.tickCron}`);
  return task;
}
