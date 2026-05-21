/**
 * L1.5 Task Judgment Prompt — migrated from context-offload-server.
 *
 * Determines task lifecycle: completion, continuation, new task detection.
 */

// ─── System Prompt ───────────────────────────────────────────────────────────

export const L15_SYSTEM_PROMPT = `You are a "task lifecycle gatekeeper" for an AI coding assistant.
Your duty is to cross-analyze the three provided input sources, determine the task state precisely, and output a pure JSON object.

[Input usage guide (required reasoning path)]
1. Step one - analyze recentMessages (identify intent): Based on the current and historical conversation, extract the core request in the user's latest reply. Determine whether it means "continue investigating," "declare completion" (for example: "it works now"), "a one-turn casual question," or "start a completely new request."
2. Step two - align with currentMmd (evaluate the current baseline): Compare the user's latest intent with the full Mermaid content in currentMmd. Focus on taskGoal, each node's status (done/doing/todo), and summary. If the request fully falls outside the scope of the current diagram, or the goal has already been achieved (all nodes are done and nothing remains), then taskCompleted is true. If the user is still working through a subproblem in the diagram (including doing nodes or bug fixing), then taskCompleted is false. (If there is no currentMmd, judge continuation only from the current and historical conversation.)
3. Step three - inspect availableMmds (decide whether it is a continuation): If you determine that a new task should begin (isLongTask=true and taskCompleted=true, or there is currently no task), you must scan the taskGoal and time information in availableMmds. If the new request strongly overlaps with an older task in the list (for example, returning to a module left unfinished yesterday), then it is a continuation (isContinuation=true).

[Strict JSON output format]
You must output a valid pure JSON object in the following format:
{
  "taskCompleted": boolean, // Whether the current task has ended (if currentMmd is none, this must be true)
  "isLongTask": boolean,    // Whether the latest request is a complex engineering task requiring multiple steps (ordinary technical Q&A or casual chat should be false)
  "isContinuation": boolean, // Whether this continues a historical task in availableMmds
  "continuationMmdFile": "string|null", // If it continues an old task, fill in the exact filename from availableMmds (without the path prefix); otherwise null
  "newTaskLabel": "string|null" // If it is a brand-new long task, generate a short label (≤30 characters, kebab-case, such as "refactor-api"); otherwise null
}

Output only the pure JSON object. Never include explanatory prose.`;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface L15CurrentMmd {
  filename: string;
  content: string;
  path: string;
}

export interface L15MmdMeta {
  filename: string;
  path: string;
  taskGoal: string;
  doneCount: number;
  doingCount: number;
  todoCount: number;
  updatedTime?: string | null;
  nodeSummaries?: Array<{ nodeId: string; status: string; summary: string }>;
}

// ─── User Prompt Builder ─────────────────────────────────────────────────────

/**
 * Build the L1.5 user prompt for task judgment.
 * Mirrors context-offload-server/internal/service/prompt/BuildL15UserPrompt.
 */
export function buildL15UserPrompt(
  recentMessages: string,
  currentMmd: L15CurrentMmd | null,
  metas: L15MmdMeta[],
): string {
  const parts: string[] = [];

  parts.push("## 1. Recent conversation context (recent 6 messages):");
  parts.push(recentMessages);
  parts.push("\n## 2. Currently mounted task graph (active Mermaid — full content):");

  if (currentMmd && currentMmd.filename) {
    parts.push(`**File:** ${currentMmd.filename}`);
    if (currentMmd.path) {
      parts.push(`**Path:** \`${currentMmd.path}\``);
    }
    parts.push(`\n\`\`\`mermaid\n${currentMmd.content}\n\`\`\``);
  } else {
    parts.push("(none - currently idle, with no active task)");
  }

  parts.push("\n## 3. Historical task graphs available for reuse (available Mermaid task files):");

  if (metas.length === 0) {
    parts.push("(none - no historical long-running tasks yet)");
  } else {
    for (const m of metas) {
      parts.push(`- **${m.filename}**`);
      parts.push(`  path: \`${m.path}\``);
      parts.push(`  taskGoal: ${m.taskGoal}`);
      const total = m.doneCount + m.doingCount + m.todoCount;
      parts.push(`  progress: ${m.doneCount}/${total} done, ${m.doingCount} doing, ${m.todoCount} todo`);
      if (m.updatedTime) {
        parts.push(`  lastUpdated: ${m.updatedTime}`);
      }
      if (m.nodeSummaries && m.nodeSummaries.length > 0) {
        parts.push("  recentNodes:");
        for (const n of m.nodeSummaries) {
          parts.push(`    - [${n.nodeId}] (${n.status}) ${n.summary}`);
        }
      }
      parts.push("");
    }
  }

  parts.push("Please judge strictly according to the three-step reasoning path in the system instruction and output a valid JSON object.");
  return parts.join("\n");
}
