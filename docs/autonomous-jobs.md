# Autonomous jobs

Autonomous jobs are Telegram-managed scheduled tasks that run through the unified scheduler.

## Model

A job contains its own schedule and execution state. The scheduler no longer treats autonomous work as a single global cron setting.

## Scheduling options

Jobs support:

- preset intervals
- custom cron expressions

The schedule is stored with the job, so each job can be due independently of the others.

## Lifecycle

From Telegram, a user can:

- create a job
- edit the prompt
- change the schedule
- enable or disable the job
- delete the job
- inspect the job status and execution history fields surfaced in the UI

## Dispatcher behavior

The unified scheduler wakes on an internal tick and checks the database for jobs that are due.

For each due job it:

1. marks the job as running
2. executes the agent in autonomous mode
3. records success or failure
4. stores the latest timestamps and error details

This design keeps execution centralized while letting each job keep its own cadence.

## Relation to Telegram UX

Job management is exposed through menu flows, not through public slash commands.

The old `/job <prompt>` and `/jobs` command surface is no longer the primary interface. Telegram users manage jobs from the Jobs menu instead.

## Operational note

The scheduler tick remains an internal runtime detail. It is not the source of truth for user-visible scheduling. The source of truth is the per-job record stored in SQLite.
