import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const readDoc = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("README reflects the current Telegram runtime", () => {
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");

  expect(readme).toContain("/start");
  expect(readme).toContain("/menu");
  expect(readme).toContain("/help");
  expect(readme).toContain("@grammyjs/conversations");
  expect(readme).toContain("L1.5 task judgment");
  expect(readme).toContain("task-scoped Mermaid canvases");
  expect(readme).toContain("L4 draft skill generation");
  expect(readme).toContain("Skill Drafts");
  expect(readme).toContain("configured timezone/locale");
  expect(readme).toContain("weekday");
  expect(readme).not.toContain("/memory_force");
  expect(readme).not.toContain("/job <prompt>");

  expect(existsSync(new URL("../../docs/architecture.md", import.meta.url))).toBe(true);
  expect(existsSync(new URL("../../docs/telegram-flow.md", import.meta.url))).toBe(true);
  expect(existsSync(new URL("../../docs/memory.md", import.meta.url))).toBe(true);
  expect(existsSync(new URL("../../docs/autonomous-jobs.md", import.meta.url))).toBe(true);
});

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
  expect(architecture).toContain("context-offload path is intentionally separate from durable memory maintenance");
  expect(architecture).toContain("L1.5 task judgment");
  expect(architecture).toContain("task-scoped L2 Mermaid canvas");
  expect(architecture).toContain("L4 draft skill generation");

  expect(telegramFlow).toContain("Telegram menus, inline buttons, and conversations from `@grammyjs/conversations`.");
  expect(telegramFlow).toContain("`@grammyjs/conversations` is used for any flow that needs multiple steps.");
  expect(telegramFlow).toContain("The old command-heavy surface is gone.");

  expect(memory).toContain("This project uses a project-owned memory backend with a protected layered model.");
  expect(memory).toContain("durable memory path remains L0 -> L1 -> L2 -> L3");
  expect(memory).toContain("offload L1 evidence summaries -> L1.5 task judgment -> task-scoped L2 Mermaid canvas -> L4 draft skill generation");
  expect(memory).toContain("short one-shot tool use like current date/time does not update task canvases");
  expect(memory).toContain("does not auto-install globally");
  expect(memory).toContain("Memory Update is the Telegram-managed workflow for durable memory maintenance.");
  expect(memory).toContain("It is not a public slash command.");
  expect(memory).toContain("Memory Update scheduling is stored per user.");

  expect(autonomousJobs).toContain("Autonomous jobs are Telegram-managed scheduled tasks that run through the unified scheduler.");
  expect(autonomousJobs).toContain("The unified scheduler wakes on an internal tick");
  expect(autonomousJobs).toContain("Job management is exposed through menu flows, not through public slash commands.");
  expect(autonomousJobs).toContain("The old `/job <prompt>` and `/jobs` command surface is no longer the primary interface.");
});
