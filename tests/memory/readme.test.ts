import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const readDoc = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("docs describe the current Telegram runtime model", () => {
  const architecture = readDoc("../../docs/architecture.md");
  const telegramFlow = readDoc("../../docs/telegram-flow.md");
  const memory = readDoc("../../docs/memory.md");
  const autonomousJobs = readDoc("../../docs/autonomous-jobs.md");

  expect(architecture).toContain("The public Telegram surface is intentionally small:");
  expect(architecture).toContain("/start");
  expect(architecture).toContain("/menu");
  expect(architecture).toContain("/help");
  expect(architecture).toContain("@grammyjs/conversations");

  expect(telegramFlow).toContain("Telegram menus, inline buttons, and conversations from `@grammyjs/conversations`.");
  expect(telegramFlow).toContain("`@grammyjs/conversations` is used for any flow that needs multiple steps.");
  expect(telegramFlow).toContain("The old command-heavy surface is gone.");

  expect(memory).toContain("This project uses a project-owned memory backend with a protected layered model.");
  expect(memory).toContain("Memory Update is the Telegram-managed workflow for durable memory maintenance.");
  expect(memory).toContain("It is not a public slash command.");
  expect(memory).toContain("Memory Update scheduling is stored per user.");

  expect(autonomousJobs).toContain("Autonomous jobs are Telegram-managed scheduled tasks that run through the unified scheduler.");
  expect(autonomousJobs).toContain("The unified scheduler wakes on an internal tick");
  expect(autonomousJobs).toContain("Job management is exposed through menu flows, not through public slash commands.");
  expect(autonomousJobs).toContain("The old `/job <prompt>` and `/jobs` command surface is no longer the primary interface.");
});
