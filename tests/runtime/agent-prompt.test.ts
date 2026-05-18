import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildAgentSystemPrompt } from "../../src/agent/prompts/system";

const agentPath = join(process.cwd(), "src", "agent", "react-agent.ts");

test("react agent uses the shared system prompt builder", async () => {
  const source = await readFile(agentPath, "utf8");

  expect(source).toContain('from "./prompts/system"');
  expect(source).toContain("buildAgentSystemPrompt()");
  expect(source).not.toContain("You are a Telegram AI agent running on grammY");
});

test("shared system prompt reflects the Telegram menu runtime", () => {
  const prompt = buildAgentSystemPrompt();

  expect(prompt).toContain("/start, /menu, and /help");
  expect(prompt).toContain("Memory Update");
  expect(prompt).toContain("tdai_current_datetime");
  expect(prompt).toContain("tdai_create_job");
  expect(prompt).toContain("max_runs defaults to 1");
  expect(prompt).toContain("send fixed text first, then run the agent prompt");
  expect(prompt).toContain("short-term context offload");
  expect(prompt).toContain("L1.5");
  expect(prompt).toContain("L4 draft skills");
  expect(prompt).toContain("menu/review flows");
  expect(prompt).toContain("canonical chat JSONL");
  expect(prompt).toContain("L1 semantic evidence summaries");
  expect(prompt).toContain("L2 Mermaid task canvases");
  expect(prompt).toContain("task-aware recall");
  expect(prompt).toContain("concise");
});
