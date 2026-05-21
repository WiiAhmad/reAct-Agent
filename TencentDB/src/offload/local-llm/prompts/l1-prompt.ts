/**
 * L1 Summarization Prompt — migrated from context-offload-server.
 *
 * Converts tool call/result pairs into high-density JSON summaries.
 */

// ─── System Prompt ───────────────────────────────────────────────────────────

export const L1_SYSTEM_PROMPT = `You are a "tool result summarizer" built specifically to support an AI coding assistant. Your core task is to deeply understand the current conversation context and distill complex tool calls and execution results (each tool call and tool result pair should be merged into one summary entry) into a high-information-density JSON array.

Before generating summaries, you must complete the following internal reasoning:
1. Task alignment: Use the recent conversation to identify the user's current core goal and latest intent. If the context contains conflicts, always follow the user's latest intent.
2. Value filtering: Ignore redundant implementation mechanics of how the tool works. Directly extract "what key clue was discovered," "what key action was taken," "what specific content was modified," or "what concrete error occurred."
3. Impact assessment: Judge the material impact of the result on the current task (for example: whether it confirmed a hypothesis, advanced a step, led to a decision, or caused a blocker because of a specific error).

[Output format requirements]
You must output one valid JSON object array and nothing else: [{...}]. Each object must contain the following fields:
- "tool_call": A concise description of the tool invocation. Apply these rules:
  · If the input marks the tool pair with [NEEDS_COMPRESS], you must compress the tool name plus key arguments into one concise description (≤150 characters). Keep the tool name and operation target (such as file path or command intent), and omit inline scripts or large content bodies.
    Example: exec({"command":"python3 -c 'import csv; ...200-line script...'"}) → "exec: run a Python script at xx/xx/xx.sh to analyze the data quality of sales_channels.csv"
    Example: write_file({"path":"/root/app.py","content":"...5000 characters..."}) → "write_file: write /root/app.py (main Flask app file), with content roughly about ..."
  · If [NEEDS_COMPRESS] is not present, briefly describe the tool and arguments directly (the system will overwrite them with the raw values).
- "summary": A concise conclusion that synthesizes the reasoning above (≤200 characters). It must state the business value of the result precisely and explain how it advanced or blocked the task.
- "tool_call_id": The original tool_call_id (must be passed through unchanged).
- "timestamp": The original China Standard Time (+08:00) ISO 8601 timestamp (must be passed through unchanged).
- "score" (required): Based on information density and task purpose, rate how replaceable the original content is by the summary on a scale from 0 to 10. The closer to 10, the more fully the summary can replace the original content.

[Strict rule]
Output only a pure JSON array. Never output your reasoning process or any other explanatory prose.`;

// ─── Constants ───────────────────────────────────────────────────────────────

const PARAMS_MAX_LEN = 500;
const RESULT_MAX_LEN = 2000;
const COMPRESS_THRESHOLD = 200;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface L1ToolPair {
  toolName: string;
  toolCallId: string;
  params: unknown;
  result: unknown;
  timestamp: string;
}

// ─── User Prompt Builder ─────────────────────────────────────────────────────

/**
 * Build the L1 user prompt for summarization.
 * Mirrors context-offload-server/internal/service/prompt/BuildL1UserPrompt.
 */
export function buildL1UserPrompt(recentMessages: string, pairs: L1ToolPair[]): string {
  const parts: string[] = [];

  parts.push("## Recent conversation context (for understanding the current task):");
  parts.push(recentMessages);
  parts.push("\n## Tool call/result pairs to summarize:");

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const paramsStr = truncate(stringify(p.params), PARAMS_MAX_LEN);
    const resultStr = truncate(stringify(p.result), RESULT_MAX_LEN);
    const canonical = `${p.toolName}(${stringify(p.params)})`;
    const needsCompress = canonical.length > COMPRESS_THRESHOLD;

    parts.push(`--- Tool Pair ${i + 1} ---`);
    parts.push(`tool_call_id: ${p.toolCallId}`);
    parts.push(`timestamp: ${p.timestamp}`);
    if (needsCompress) {
      parts.push(`Tool: ${p.toolName} [NEEDS_COMPRESS]`);
    } else {
      parts.push(`Tool: ${p.toolName}`);
    }
    parts.push(`Params: ${paramsStr}`);
    parts.push(`Result: ${resultStr}\n`);
  }

  parts.push("Summarize each pair into the described JSON array format.");
  return parts.join("\n");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "...";
}
