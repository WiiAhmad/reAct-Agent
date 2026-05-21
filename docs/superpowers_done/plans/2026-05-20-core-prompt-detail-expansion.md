# Core Prompt Detail Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the four core prompt builders into clearer, more explicit prompt contracts without changing runtime wiring or product behavior.

**Architecture:** Keep the current prompt-builder boundaries intact and rewrite each builder in place with sectioned guidance. Drive the work test-first: tighten the agent prompt contract in the existing runtime prompt test, add a dedicated memory prompt contract test file, then rewrite the agent, L1, L2, and L3 builders one by one until the new assertions pass.

**Tech Stack:** TypeScript, Bun test runner, grammY runtime prompt builders, project-owned memory pipeline prompt builders.

---

## Source references

- Approved design: `docs/superpowers/specs/2026-05-20-core-prompt-detail-expansion-design.md`
- Agent prompt builder: `src/agent/prompts/system.ts`
- Agent runtime consumer: `src/agent/react-agent.ts`
- L1 prompt builder: `src/memory/prompts/l1.ts`
- L1 pipeline + parser contract: `src/memory/pipeline/l1.ts`
- L2 prompt builder: `src/memory/prompts/l2.ts`
- L2 pipeline consumer: `src/memory/pipeline/l2.ts`
- L3 prompt builder: `src/memory/prompts/l3.ts`
- L3 pipeline consumer: `src/memory/pipeline/l3.ts`
- Existing agent prompt test: `tests/runtime/agent-prompt.test.ts`
- New memory prompt contract test file to create: `tests/memory/prompt-builders.test.ts`
- Verification commands: `package.json`

## File structure

Modify these files:

- `src/agent/prompts/system.ts` — keep the same exported builder and rewrite the prompt into explicit runtime sections.
- `src/memory/prompts/l1.ts` — keep the same exported builder and rewrite the prompt into explicit durable-extraction rules with JSON contract examples.
- `src/memory/prompts/l2.ts` — keep the same exported builder and rewrite the prompt into explicit grounded markdown aggregation rules.
- `src/memory/prompts/l3.ts` — keep the same exported builder and rewrite the prompt into explicit grounded persona distillation rules.
- `tests/runtime/agent-prompt.test.ts` — tighten the agent prompt assertions around structure and preserved runtime facts.

Create this file:

- `tests/memory/prompt-builders.test.ts` — contract tests for the L1, L2, and L3 prompt builders.

Do not modify these files:

- `src/agent/react-agent.ts`
- `src/memory/pipeline/l1.ts`
- `src/memory/pipeline/l2.ts`
- `src/memory/pipeline/l3.ts`
- `src/memory/offload/l15.ts`
- `src/memory/offload/l4.ts`

---

### Task 1: Rewrite the agent system prompt behind a tighter runtime contract

**Files:**
- Modify: `tests/runtime/agent-prompt.test.ts:1-34`
- Modify: `src/agent/prompts/system.ts:1-34`
- Reference: `src/agent/react-agent.ts:156-172`

- [ ] **Step 1: Write the failing runtime prompt contract test**

Replace `tests/runtime/agent-prompt.test.ts` with this exact content:

```ts
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

test("shared system prompt uses sectioned runtime guidance", () => {
  const prompt = buildAgentSystemPrompt();

  expect(prompt).toContain("Role and runtime:");
  expect(prompt).toContain("Interaction surface:");
  expect(prompt).toContain("Operating workflow:");
  expect(prompt).toContain("Memory model:");
  expect(prompt).toContain("Tool-use rules:");
  expect(prompt).toContain("Response style:");
  expect(prompt).toContain("Failure behavior:");

  expect(prompt).toContain("/start, /menu, and /help");
  expect(prompt).toContain("Memory Update");
  expect(prompt).toContain("tdai_current_datetime");
  expect(prompt).toContain("tdai_create_job");
  expect(prompt).toContain("max_runs defaults to 1");
  expect(prompt).toContain("send fixed text first, then run the agent prompt");
  expect(prompt).toContain("canonical chat JSONL");
  expect(prompt).toContain("L1.5");
  expect(prompt).toContain("L4 draft skills");
  expect(prompt).toContain("menu/review flows");
  expect(prompt).toContain("task-aware recall");
  expect(prompt).toContain("Do not reveal hidden chain-of-thought");
  expect(prompt).toContain("Keep Telegram replies concise, practical, and not too long.");
});
```

- [ ] **Step 2: Run the targeted runtime test and verify it fails**

Run:

```bash
bun test tests/runtime/agent-prompt.test.ts
```

Expected: FAIL because the current prompt does not yet contain the new section headings such as `Role and runtime:` and `Tool-use rules:`.

- [ ] **Step 3: Rewrite the agent prompt builder with explicit sections**

Replace `src/agent/prompts/system.ts` with this exact content:

```ts
export function buildAgentSystemPrompt(): string {
  return `You are a Telegram AI agent running on grammY with built-in local tools and a project-owned local memory backend.

Role and runtime:
- Operate as the chat agent for a menu-driven Telegram runtime.
- Use the local tool layer and project-owned memory system to answer, act, and schedule follow-up work.

Interaction surface:
- Telegram UX is menu-driven.
- Public commands are /start, /menu, and /help.
- Use Memory Update as the Telegram feature for durable memory changes.

Operating workflow:
1. Understand the user goal.
2. Recall memory first, especially L3 Persona and L2 Scenarios.
3. Decide whether a tool is needed.
4. Call tools when useful.
5. Observe tool results. If a result was offloaded, use tdai_context_ref_read only when raw details are needed.
6. Answer clearly in the user's language.

Memory model:
- L0 Conversation: canonical chat JSONL raw transcript history; SQLite stores memory/offload indexes.
- L1 Atom: durable facts, preferences, constraints, and reusable workflow facts.
- L2 Scenario: grouped scene markdown with source atom references.
- L3 Persona: stable profile injected before turns.
- Short-term context offload: L1 semantic evidence summaries are judged by L1.5, routed to L2 Mermaid task canvases, and can support L4 draft skills.
- Use canonical chat JSONL only as raw transcript history.
- Use task-aware recall and L2 Mermaid task canvases as orientation for long-running work.
- Drill down through node_id/result_ref only when raw details are needed.
- Treat L1 semantic evidence summaries as compact progress/blocker records, not durable persona facts.
- Treat L4 draft skills as reviewable artifacts available only through menu/review flows; do not claim they are globally installed.

Tool-use rules:
- Prefer tools for fresh, private, or actionable data.
- Use save_memory only for durable preferences, stable project context, or reusable workflow facts.
- Use tdai_current_datetime for time-sensitive answers instead of guessing the current time.
- Use tdai_create_job for reminders and scheduled tasks.
- For relative times, call tdai_current_datetime first, compute an ISO run_at, then create the job.
- tdai_create_job jobs send fixed text first, then run the agent prompt when due.
- max_runs defaults to 1. Only set a larger max_runs when the user explicitly asks for repeated runs such as "3 times".

Response style:
- Do not reveal hidden chain-of-thought.
- Give concise reasoning summaries only when useful.
- Keep Telegram replies concise, practical, and not too long.

Failure behavior:
- If a tool fails, recover when possible.
- Otherwise explain the limitation clearly.`;
}
```

- [ ] **Step 4: Run the targeted runtime test and verify it passes**

Run:

```bash
bun test tests/runtime/agent-prompt.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the agent prompt rewrite**

Run:

```bash
git add tests/runtime/agent-prompt.test.ts src/agent/prompts/system.ts
git commit -m "refactor: expand agent system prompt structure"
```

Expected: commit succeeds with the tighter runtime prompt contract and the sectioned prompt implementation.

---

### Task 2: Rewrite the L1 prompt behind a strict durable-extraction contract test

**Files:**
- Create: `tests/memory/prompt-builders.test.ts`
- Modify: `src/memory/prompts/l1.ts:1-10`
- Reference: `src/memory/pipeline/l1.ts:9-38`

- [ ] **Step 1: Create the failing L1 prompt contract test**

Create `tests/memory/prompt-builders.test.ts` with this exact content:

```ts
import { expect, test } from "bun:test";
import { buildL1SystemPrompt } from "../../src/memory/prompts/l1";

test("L1 prompt defines a strict durable extraction contract", () => {
  const prompt = buildL1SystemPrompt();

  expect(prompt).toContain("Role:");
  expect(prompt).toContain("Objective:");
  expect(prompt).toContain("What to keep:");
  expect(prompt).toContain("What to exclude:");
  expect(prompt).toContain("Normalization and dedupe:");
  expect(prompt).toContain("Output contract:");
  expect(prompt).toContain("Return ONLY a valid JSON array.");
  expect(prompt).toContain('"text": string');
  expect(prompt).toContain("importance");
  expect(prompt).toContain("source_turn_ids");
  expect(prompt).toContain("Example to extract:");
  expect(prompt).toContain("Example to ignore:");
});
```

- [ ] **Step 2: Run the targeted L1 prompt test and verify it fails**

Run:

```bash
bun test tests/memory/prompt-builders.test.ts
```

Expected: FAIL because the current L1 prompt does not yet contain the new section headings or example blocks.

- [ ] **Step 3: Rewrite the L1 prompt builder with explicit durable-memory rules**

Replace `src/memory/prompts/l1.ts` with this exact content:

```ts
export function buildL1SystemPrompt(): string {
  return [
    "Role:\nYou are the L1 extractor for the project-owned memory pipeline.",
    "Objective:\nExtract durable atomic memories from conversation turns.",
    "What to keep:\n- stable user preferences\n- stable project context\n- durable decisions\n- recurring constraints\n- reusable workflow instructions",
    "What to exclude:\n- transient chit-chat\n- duplicates\n- secrets\n- one-off details that do not belong in durable memory",
    "Normalization and dedupe:\n- prefer stable phrasing for identity, preferences, constraints, and reusable workflow instructions\n- when two candidate memories mean the same thing, emit the clearest wording once\n- keep each item atomic instead of blending unrelated facts",
    'Output contract:\n- Return ONLY a valid JSON array.\n- Each item must match {"text": string, "importance": 1-5, "source_turn_ids": number[]}.\n- Use importance only in the 1-5 range.\n- Include source_turn_ids from the supporting turns when available.',
    'Example to extract:\nInput meaning: "The user prefers short replies and asked for SQL examples."\nOutput: [{"text":"User prefers short replies.","importance":4,"source_turn_ids":[12]},{"text":"User asked for SQL examples when helpful.","importance":3,"source_turn_ids":[12]}]',
    'Example to ignore:\nInput meaning: "Thanks lol" or repeated restatements of the same preference.\nOutput: []',
  ].join("\n\n");
}
```

- [ ] **Step 4: Run the targeted L1 prompt test and verify it passes**

Run:

```bash
bun test tests/memory/prompt-builders.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the L1 prompt rewrite**

Run:

```bash
git add tests/memory/prompt-builders.test.ts src/memory/prompts/l1.ts
git commit -m "refactor: expand L1 prompt contract"
```

Expected: commit succeeds with the new L1 contract test and the rewritten prompt builder.

---

### Task 3: Rewrite the L2 prompt behind a grounded markdown aggregation contract test

**Files:**
- Modify: `tests/memory/prompt-builders.test.ts`
- Modify: `src/memory/prompts/l2.ts:1-8`
- Reference: `src/memory/pipeline/l2.ts:36-53`

- [ ] **Step 1: Expand the prompt-builder test file with the failing L2 contract test**

Replace `tests/memory/prompt-builders.test.ts` with this exact content:

```ts
import { expect, test } from "bun:test";
import { buildL1SystemPrompt } from "../../src/memory/prompts/l1";
import { buildL2SystemPrompt } from "../../src/memory/prompts/l2";

test("L1 prompt defines a strict durable extraction contract", () => {
  const prompt = buildL1SystemPrompt();

  expect(prompt).toContain("Role:");
  expect(prompt).toContain("Objective:");
  expect(prompt).toContain("What to keep:");
  expect(prompt).toContain("What to exclude:");
  expect(prompt).toContain("Normalization and dedupe:");
  expect(prompt).toContain("Output contract:");
  expect(prompt).toContain("Return ONLY a valid JSON array.");
  expect(prompt).toContain('"text": string');
  expect(prompt).toContain("importance");
  expect(prompt).toContain("source_turn_ids");
  expect(prompt).toContain("Example to extract:");
  expect(prompt).toContain("Example to ignore:");
});

test("L2 prompt defines a grounded markdown aggregation contract", () => {
  const prompt = buildL2SystemPrompt();

  expect(prompt).toContain("Role:");
  expect(prompt).toContain("Objective:");
  expect(prompt).toContain("Grounding rules:");
  expect(prompt).toContain("Output contract:");
  expect(prompt).toContain("Example:");
  expect(prompt).toContain("Return markdown only.");
  expect(prompt).toContain("Preserve atom_id evidence references.");
  expect(prompt).toContain("Do not invent facts");
});
```

- [ ] **Step 2: Run the targeted memory prompt test file and verify the L2 contract fails**

Run:

```bash
bun test tests/memory/prompt-builders.test.ts
```

Expected: FAIL because the current L2 prompt does not yet contain the new section headings and example block.

- [ ] **Step 3: Rewrite the L2 prompt builder with explicit grounding rules**

Replace `src/memory/prompts/l2.ts` with this exact content:

```ts
export function buildL2SystemPrompt(): string {
  return [
    "Role:\nYou are the L2 Scenario aggregator for the project-owned memory pipeline.",
    "Objective:\nGroup related L1 atoms into a concise scenario snapshot.",
    "Grounding rules:\n- Preserve atom_id evidence references.\n- Summarize only what the supplied atoms support.\n- Do not invent facts, causes, or motivations.\n- Prefer concise grouped context over exhaustive restatement.",
    "Output contract:\n- Return markdown only.\n- Keep the scenario readable and compact.\n- Keep evidence references visible in the markdown.",
    "Example:\n## Scenario snapshot\n- User prefers terse debugging answers. [atom_id: 14]\n- User is actively working on Telegram job scheduling. [atom_id: 15]",
  ].join("\n\n");
}
```

- [ ] **Step 4: Run the targeted memory prompt test file and verify both L1 and L2 pass**

Run:

```bash
bun test tests/memory/prompt-builders.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the L2 prompt rewrite**

Run:

```bash
git add tests/memory/prompt-builders.test.ts src/memory/prompts/l2.ts
git commit -m "refactor: expand L2 prompt contract"
```

Expected: commit succeeds with the grounded markdown contract test and the rewritten L2 prompt.

---

### Task 4: Rewrite the L3 prompt behind a grounded persona contract test

**Files:**
- Modify: `tests/memory/prompt-builders.test.ts`
- Modify: `src/memory/prompts/l3.ts:1-8`
- Reference: `src/memory/pipeline/l3.ts:27-41`

- [ ] **Step 1: Expand the prompt-builder test file with the failing L3 contract test**

Replace `tests/memory/prompt-builders.test.ts` with this exact content:

```ts
import { expect, test } from "bun:test";
import { buildL1SystemPrompt } from "../../src/memory/prompts/l1";
import { buildL2SystemPrompt } from "../../src/memory/prompts/l2";
import { buildL3SystemPrompt } from "../../src/memory/prompts/l3";

test("L1 prompt defines a strict durable extraction contract", () => {
  const prompt = buildL1SystemPrompt();

  expect(prompt).toContain("Role:");
  expect(prompt).toContain("Objective:");
  expect(prompt).toContain("What to keep:");
  expect(prompt).toContain("What to exclude:");
  expect(prompt).toContain("Normalization and dedupe:");
  expect(prompt).toContain("Output contract:");
  expect(prompt).toContain("Return ONLY a valid JSON array.");
  expect(prompt).toContain('"text": string');
  expect(prompt).toContain("importance");
  expect(prompt).toContain("source_turn_ids");
  expect(prompt).toContain("Example to extract:");
  expect(prompt).toContain("Example to ignore:");
});

test("L2 prompt defines a grounded markdown aggregation contract", () => {
  const prompt = buildL2SystemPrompt();

  expect(prompt).toContain("Role:");
  expect(prompt).toContain("Objective:");
  expect(prompt).toContain("Grounding rules:");
  expect(prompt).toContain("Output contract:");
  expect(prompt).toContain("Example:");
  expect(prompt).toContain("Return markdown only.");
  expect(prompt).toContain("Preserve atom_id evidence references.");
  expect(prompt).toContain("Do not invent facts");
});

test("L3 prompt defines a grounded persona distillation contract", () => {
  const prompt = buildL3SystemPrompt();

  expect(prompt).toContain("Role:");
  expect(prompt).toContain("Objective:");
  expect(prompt).toContain("Grounding rules:");
  expect(prompt).toContain("Output contract:");
  expect(prompt).toContain("Example:");
  expect(prompt).toContain("Return markdown only.");
  expect(prompt).toContain("scenario_id");
  expect(prompt).toContain("atom_id");
  expect(prompt).toContain("Do not invent facts or infer sensitive attributes.");
});
```

- [ ] **Step 2: Run the targeted memory prompt test file and verify the L3 contract fails**

Run:

```bash
bun test tests/memory/prompt-builders.test.ts
```

Expected: FAIL because the current L3 prompt does not yet contain the new section headings and example block.

- [ ] **Step 3: Rewrite the L3 prompt builder with explicit grounding and anti-inference rules**

Replace `src/memory/prompts/l3.ts` with this exact content:

```ts
export function buildL3SystemPrompt(): string {
  return [
    "Role:\nYou are the L3 Persona/profile distiller for the project-owned memory pipeline.",
    "Objective:\nCreate or update a concise agent-facing profile from L2 scenarios.",
    "Grounding rules:\n- Ground bullets in scenario_id and atom_id references when possible.\n- Prefer stable statements the agent can reuse later.\n- Do not invent facts.\n- Do not infer sensitive attributes.",
    "Output contract:\n- Return markdown only.\n- Keep the profile concise and agent-facing.\n- Prefer compact bullets over narrative biography.",
    "Example:\n- Prefers terse debugging answers and is currently focused on Telegram job scheduling. [scenario_id: 8; atom_id: 14, 15]",
  ].join("\n\n");
}
```

- [ ] **Step 4: Run the targeted memory prompt test file and verify L1, L2, and L3 all pass**

Run:

```bash
bun test tests/memory/prompt-builders.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the L3 prompt rewrite**

Run:

```bash
git add tests/memory/prompt-builders.test.ts src/memory/prompts/l3.ts
git commit -m "refactor: expand L3 prompt contract"
```

Expected: commit succeeds with the grounded persona contract test and the rewritten L3 prompt.

---

### Task 5: Run final verification for the full prompt rewrite

**Files:**
- Verify: `tests/runtime/agent-prompt.test.ts`
- Verify: `tests/memory/prompt-builders.test.ts`
- Verify: `src/agent/prompts/system.ts`
- Verify: `src/memory/prompts/l1.ts`
- Verify: `src/memory/prompts/l2.ts`
- Verify: `src/memory/prompts/l3.ts`

- [ ] **Step 1: Run the focused prompt test files together**

Run:

```bash
bun test tests/runtime/agent-prompt.test.ts tests/memory/prompt-builders.test.ts
```

Expected: PASS for both files.

- [ ] **Step 2: Run type checking**

Run:

```bash
bun run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Run the full automated test suite**

Run:

```bash
bun test
```

Expected: PASS.

- [ ] **Step 4: Inspect the final prompt files for spec alignment**

Confirm these exact outcomes in the final files:

```text
src/agent/prompts/system.ts
- contains explicit sections for role/runtime, interaction surface, workflow, memory model, tool-use rules, response style, and failure behavior
- preserves the current facts about /start, /menu, /help, Memory Update, tdai_current_datetime, tdai_create_job, max_runs, L1.5, task-aware recall, and L4 draft skills

src/memory/prompts/l1.ts
- contains keep/exclude/normalization/output/example sections
- still requires a JSON array with text, importance, and source_turn_ids

src/memory/prompts/l2.ts
- contains role/objective/grounding/output/example sections
- still requires markdown-only grounded scenario aggregation with atom_id evidence

src/memory/prompts/l3.ts
- contains role/objective/grounding/output/example sections
- still requires markdown-only grounded persona distillation with anti-inference rules
```

- [ ] **Step 5: Commit the final verification state**

Run:

```bash
git add src/agent/prompts/system.ts src/memory/prompts/l1.ts src/memory/prompts/l2.ts src/memory/prompts/l3.ts tests/runtime/agent-prompt.test.ts tests/memory/prompt-builders.test.ts
git commit -m "test: lock expanded core prompt contracts"
```

Expected: commit succeeds only if all tests and type checking already passed.

---

## Self-review against the spec

### Spec coverage

- Agent prompt structure and preserved runtime facts: covered by Task 1.
- L1 durable extraction boundaries, JSON contract, and examples: covered by Task 2.
- L2 grounded markdown aggregation rules and example: covered by Task 3.
- L3 grounded persona distillation, anti-inference rules, and example: covered by Task 4.
- Verification updates and preserved builder boundaries: covered by Task 5.

### Placeholder scan

This plan contains exact file paths, exact test content, exact implementation content, and exact verification commands. There are no `TODO`, `TBD`, or “similar to previous task” shortcuts.

### Type consistency

- All prompt builder function names stay unchanged: `buildAgentSystemPrompt`, `buildL1SystemPrompt`, `buildL2SystemPrompt`, `buildL3SystemPrompt`.
- Test imports and assertions use those exact names consistently.
- The L1 output contract continues to use `text`, `importance`, and `source_turn_ids`, matching `src/memory/pipeline/l1.ts`.

### Notes before execution

- Do not modify pipeline consumers while implementing this plan.
- Do not expand this work into L1.5 or L4 prompt changes.
- If a test assertion needs a wording adjustment during implementation, prefer adjusting the prompt text rather than weakening the contract unless the assertion would change runtime behavior beyond the approved spec.
