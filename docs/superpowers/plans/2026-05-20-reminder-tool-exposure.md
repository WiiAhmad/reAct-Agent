# Reminder Tool Exposure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `tdai_create_job` always available in chat mode so reminder clarification turns like `jam 5` or `sekali saja` can continue the scheduling flow, while keeping the tool hidden in autonomous mode.

**Architecture:** Remove the current-message scheduling heuristic from `src/agent/react-agent.ts` and let chat-mode tool exposure include `tdai_create_job` unconditionally. Keep the existing autonomous-mode restriction in place, then lock the behavior with runtime tests that cover unrelated follow-up chat turns, reminder clarification turns, and autonomous runs.

**Tech Stack:** Bun, TypeScript, grammY runtime agent loop, Bun test

---

## File Structure

- Modify: `src/agent/react-agent.ts`
  - Owns chat/autonomous tool exposure at runtime.
  - Remove the now-unused `shouldExposeSchedulingTools` helper.
  - Simplify tool filtering so `tdai_create_job` is always available in chat mode and still hidden in autonomous mode.

- Modify: `tests/memory/agent-runtime.test.ts`
  - Owns runtime-level behavior checks for tool exposure.
  - Update the existing chat-mode follow-up test to reflect the new always-available behavior.
  - Add a reminder-clarification regression test for `jam 5`, `sekali saja`, and `besok jam 5`.
  - Keep the existing autonomous-mode test as the regression boundary that `tdai_create_job` must stay hidden outside chat mode.

No database, scheduler, prompt, or memory-service files should change for this fix.

---

### Task 1: Encode the expected chat-mode behavior in tests first

**Files:**
- Modify: `tests/memory/agent-runtime.test.ts:176-275`
- Read-only reference: `src/agent/react-agent.ts:86-103`

- [ ] **Step 1: Replace the existing unrelated follow-up test so it expects `tdai_create_job` to remain available in chat mode**

Replace the current test named `agent runtime keeps tdai_create_job hidden for unrelated follow-up chat turns` with this exact test:

```ts
test("agent runtime keeps tdai_create_job available for unrelated follow-up chat turns", async () => {
  let seenTools: string[] = [];
  const llm = {
    async complete({ tools }: { tools: Array<{ name: string }> }) {
      seenTools = tools.map((tool) => tool.name);
      return { content: "Nama saya Karina.", toolCalls: [] };
    },
  };

  const tempDir = await mkdtemp(join(tmpdir(), "grammy-agent-runtime-"));

  try {
    const db = new Database(":memory:");
    migrate(db);
    const memory = await createMemoryService(db, llm as any, {
      storage: {
        dataDir: tempDir,
        memoryRefsDir: join(tempDir, "memory", "refs"),
        memoryCanvasDir: join(tempDir, "memory", "canvases"),
        memoryJsonlExportDir: join(tempDir, "memory", "jsonl"),
        historyDir: join(tempDir, "history"),
        memoryTaskCanvasDir: join(tempDir, "memory", "task-canvases"),
        memoryGeneratedSkillsDir: join(tempDir, "memory", "skills"),
      },
      memory: {
        maintenanceCron: "*/10 * * * *",
        offloadEnabled: true,
        offloadMinChars: 2500,
        offloadSummaryChars: 900,
        sqliteVecEnabled: true,
        jsonlExportEnabled: false,
        l15: { enabled: true, mode: "rules", recentMessages: 6, historyTaskLimit: 10, maxCanvasChars: 12000, safeFallback: "short" },
        l1: { enabled: true, mode: "local", maxSummaryChars: 900, defaultScore: 5 },
        l2: { enabled: false, mode: "local", triggerMinEntries: 1, maxCanvasChars: 12000 },
        taskRecall: { enabled: true, maxTasks: 3, maxCanvasChars: 2200 },
        l4: { enabled: true, mode: "local", requireCompletedTask: false, maxEvidenceEntries: 80, maxCanvasChars: 20000, maxSkillChars: 20000 },
      },
    });
    const registry = new ToolRegistry(db);
    registry.registerMany(createLocalTools(memory));

    await memory.logUserMessage({ chatId: "c1", userId: "u1", content: "ingatkan saya 4 menit kedepan untuk meeting", mode: "chat" });
    await memory.logAssistantMessage({ chatId: "c1", userId: "u1", content: "Siap, Terry. Saya Akan Ingatkan 4 Menit Lagi Untuk Meeting." });

    await runReactAgent({ chatId: "c1", userId: "u1", input: "siapa nama kamu", memory, registry, llm: llm as any, mode: "chat" });

    expect(seenTools).toContain("tdai_create_job");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}, 20000);
```

- [ ] **Step 2: Add a new regression test for reminder clarification turns**

Insert this new test immediately after `agent runtime keeps tdai_create_job available for reminder requests`:

```ts
test("agent runtime keeps tdai_create_job available for reminder clarification turns", async () => {
  const seenToolsByInput = new Map<string, string[]>();
  const llm = {
    async complete({ messages, tools }: { messages: Array<{ role: string; content?: string }>; tools: Array<{ name: string }> }) {
      const latestUser = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
      seenToolsByInput.set(latestUser, tools.map((tool) => tool.name));
      return { content: "Siap.", toolCalls: [] };
    },
  };

  const tempDir = await mkdtemp(join(tmpdir(), "grammy-agent-runtime-"));

  try {
    const db = new Database(":memory:");
    migrate(db);
    const memory = await createMemoryService(db, llm as any, {
      storage: {
        dataDir: tempDir,
        memoryRefsDir: join(tempDir, "memory", "refs"),
        memoryCanvasDir: join(tempDir, "memory", "canvases"),
        memoryJsonlExportDir: join(tempDir, "memory", "jsonl"),
        historyDir: join(tempDir, "history"),
        memoryTaskCanvasDir: join(tempDir, "memory", "task-canvases"),
        memoryGeneratedSkillsDir: join(tempDir, "memory", "skills"),
      },
      memory: {
        maintenanceCron: "*/10 * * * *",
        offloadEnabled: true,
        offloadMinChars: 2500,
        offloadSummaryChars: 900,
        sqliteVecEnabled: true,
        jsonlExportEnabled: false,
        l15: { enabled: true, mode: "rules", recentMessages: 6, historyTaskLimit: 10, maxCanvasChars: 12000, safeFallback: "short" },
        l1: { enabled: true, mode: "local", maxSummaryChars: 900, defaultScore: 5 },
        l2: { enabled: false, mode: "local", triggerMinEntries: 1, maxCanvasChars: 12000 },
        taskRecall: { enabled: true, maxTasks: 3, maxCanvasChars: 2200 },
        l4: { enabled: true, mode: "local", requireCompletedTask: false, maxEvidenceEntries: 80, maxCanvasChars: 20000, maxSkillChars: 20000 },
      },
    });
    const registry = new ToolRegistry(db);
    registry.registerMany(createLocalTools(memory));

    await memory.logUserMessage({ chatId: "c1", userId: "u1", content: "ingatkan saya untuk meeting", mode: "chat" });
    await memory.logAssistantMessage({ chatId: "c1", userId: "u1", content: "Ini pengingatnya sekali saja atau berulang? Meetingnya kapan?" });

    for (const followUp of ["jam 5", "sekali saja", "besok jam 5"]) {
      await runReactAgent({ chatId: "c1", userId: "u1", input: followUp, memory, registry, llm: llm as any, mode: "chat" });
    }

    expect(seenToolsByInput.get("jam 5")).toContain("tdai_create_job");
    expect(seenToolsByInput.get("sekali saja")).toContain("tdai_create_job");
    expect(seenToolsByInput.get("besok jam 5")).toContain("tdai_create_job");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}, 20000);
```

- [ ] **Step 3: Run the runtime-agent test file to verify the new expectations fail before implementation**

Run:

```bash
bun test tests/memory/agent-runtime.test.ts
```

Expected: FAIL. At minimum, the new chat-mode expectations for `jam 5` and `sekali saja` should fail with output equivalent to:

```text
expect(received).toContain(expected)
Expected value: "tdai_create_job"
Received array: [...]
```

The unrelated follow-up test should also fail until the runtime filter is removed.

---

### Task 2: Remove the chat-mode scheduling heuristic from the agent runtime

**Files:**
- Modify: `src/agent/react-agent.ts:86-103`
- Modify: `src/agent/react-agent.ts:168-173`
- Test: `tests/memory/agent-runtime.test.ts`

- [ ] **Step 1: Delete the now-unused `shouldExposeSchedulingTools` helper**

In `src/agent/react-agent.ts`, remove this entire function block:

```ts
function shouldExposeSchedulingTools(input: string): boolean {
  const normalized = input.normalize("NFKC").toLowerCase();
  return [
    /\bingatkan\b/u,
    /\bpengingat\b/u,
    /\bjadwalkan\b/u,
    /\bjadwal\b/u,
    /\bremind(?:er)?\b/u,
    /\bschedul(?:e|ed)\b/u,
    /\bset alarm\b/u,
    /\bsetiap\b/u,
    /\btiap\b/u,
    /\bevery\b/u,
    /\bbesok\b/u,
    /\btomorrow\b/u,
    /\b(\d+)\s*(detik|menit|jam|hari|seconds?|minutes?|hours?|days?)\b/u,
  ].some((pattern) => pattern.test(normalized));
}
```

After deletion, `asEventMeta(...)` should be followed directly by `export async function runReactAgent(...)`.

- [ ] **Step 2: Simplify the tool filter so `tdai_create_job` is always available in chat mode**

Replace this block in `src/agent/react-agent.ts`:

```ts
const schedulingAllowed = shouldExposeSchedulingTools(input.input);
const tools = input.registry
  .list()
  .filter((tool) => input.mode !== "autonomous" || (tool.name !== "tdai_create_job" && tool.name !== "telegram_send_message"))
  .filter((tool) => tool.name !== "tdai_create_job" || input.mode === "autonomous" || schedulingAllowed);
```

with this exact code:

```ts
const tools = input.registry
  .list()
  .filter((tool) => input.mode !== "autonomous" || (tool.name !== "tdai_create_job" && tool.name !== "telegram_send_message"));
```

This keeps the autonomous-mode restriction intact while removing all chat-mode hiding for `tdai_create_job`.

- [ ] **Step 3: Run the same runtime-agent test file again to verify the fix**

Run:

```bash
bun test tests/memory/agent-runtime.test.ts
```

Expected: PASS. In particular:
- the unrelated follow-up chat test now passes because `tdai_create_job` is present
- the clarification-turn test now passes for `jam 5`, `sekali saja`, and `besok jam 5`
- the autonomous-mode test still passes because the autonomous filter is unchanged

- [ ] **Step 4: Commit the implementation once the targeted runtime tests are green**

Run:

```bash
git add tests/memory/agent-runtime.test.ts src/agent/react-agent.ts
git commit -m "fix: keep reminder job tool available in chat"
```

Expected: a new commit containing only the runtime filter change and the updated tests.

---

### Task 3: Verify the fix against type safety and broader regressions

**Files:**
- Verify: `src/agent/react-agent.ts`
- Verify: `tests/memory/agent-runtime.test.ts`

- [ ] **Step 1: Run the targeted agent-runtime and prompt/runtime regression files together**

Run:

```bash
bun test tests/memory/agent-runtime.test.ts tests/runtime/agent-prompt.test.ts tests/runtime/remove-mcp-runtime.test.ts
```

Expected: PASS. This confirms the runtime still exposes the right tool surface, keeps the current prompt contract, and does not regress unrelated runtime behavior.

- [ ] **Step 2: Run TypeScript typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS with no unused-function or type errors after removing `shouldExposeSchedulingTools`.

- [ ] **Step 3: Run the full test suite**

Run:

```bash
bun test
```

Expected: PASS.

- [ ] **Step 4: Confirm the final behavior with the acceptance checklist**

Verify all of the following are true before closing the work:

```text
- tdai_create_job is present on all chat turns
- tdai_create_job is still absent on autonomous turns
- clarification turns like "jam 5" and "sekali saja" no longer lose the tool
- no scheduler, database, or memory-service files changed
```

If any item is false, stop and fix that issue before merging.
