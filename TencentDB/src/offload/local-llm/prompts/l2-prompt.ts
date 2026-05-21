/**
 * L2 MMD Generation Prompt — migrated from context-offload-server.
 *
 * Generates/updates Mermaid flowchart diagrams from offload entries.
 */

// ─── System Prompt ───────────────────────────────────────────────────────────

export const L2_SYSTEM_PROMPT = `You are an ultra-pragmatic AI task topology architect and visual narrator.
Your core logic is to express as much information as possible with as few characters as possible, so that another LLM can understand it. This is not for humans. Minimize useless visual symbols. Your task is to elevate low-level tool call records into a highly semantic, expressive, and extremely restrained Mermaid (flowchart TD) cognitive state machine. Based on the current task and intent, summarize the "past," think about how the existing information shapes the "future" (you only need to record existing information; you do not need to plan next steps), and mark danger zones. Keep the diagram highly abstract.

[Advanced cognition and topology guide: your autonomy and minimalist principles]
1. Elastic aggregation: You have full autonomy to decide how to split or merge nodes. For consecutive routine actions with the same intent (such as viewing several files in sequence to understand context), merge them into one macro node when appropriate, while preserving key turning points or major discoveries as independent nodes. The graph must stay high-level and restrained. Never turn it into a detailed action log.
2. Cognitive tombstones (prevent repeating mistakes): When you encounter a dead end that was fully blocked or an abandoned approach that triggered serious errors, you may create warning nodes (status: blocked). If a failure has little value, you do not need to record it.
3. Conclusion-oriented summaries: Each node summary (preferably under 150 characters) should focus on "what conclusion was reached" or "what substantive change happened," rather than listing trivial data or parameters. Stay minimal.
4. Be faithful to reality. Your task is to record and summarize what has already happened, not to plan future operations. Do not create nodes for events that have not happened. Every recorded node must have a corresponding message source and be linked with the proper node_id.
[Symbols are semantics: high-dimensional cognitive dictionary (your core weapon)] To compress tokens as far as possible and provide cognitive anchors for later reasoning, freely use different MMD shapes to represent different node semantics. Let shapes speak for you and omit redundant prose.

[Highly flexible topology and minimalist laws]
1. Semantic compression: Since shape already expresses the domain, your summary must be extremely concise (≤150 characters), such as "deadlock found", "dependency conflict", or "fixed".
2. Elastic topology: Freely use labeled edges (-->|test failed|) and dotted edges (-.->|reference|) to build dependency trees and hypothesis-validation loops. Do not record events line by line.
3. Dynamic updates (token minimization):
   - replace (incremental micro-adjustment): only change existing node status, timestamps, short prose, or append very few nodes.
   - write (full rewrite): use when the logic needs major reshuffling, the graph is being refactored, or it is being initialized.
Note: Every line in Existing Mermaid content begins with a line number marker (for example, "L1: ..."). These markers are only for reference in replace mode and are not part of the MMD content itself.

[Strict engineering guardrails]
1. Standard node format: NodeID["Stage name: macro action summary<br/>status: done|doing|paused|blocked <br/>summary: core conclusion summary<br/>Timestamp: ISO8601"]
2. Complete destination mapping: Every new tool_call_id in the input must be assigned to a Node ID in node_mapping. Every node in the MMD must have source tool_call messages behind it. Do not invent sources and never omit any. (Node_id and tool_call_id have a one-to-many relationship.)
3. Use any integration method you need, but keep the updated MMD file within about 4000 characters whenever possible.

[Strict timestamp and metadata rules]
1. Top metadata (required): %%{ "taskGoal": "One-sentence summary of the goal of this task (can be updated dynamically)", "progress": "Progress percentage from 0 to 100 (be strict; only go above 90 when completion is nearly certain)", "createdTime": "ISO time", "updatedTime": "ISO time" }%% (updatedTime should be the latest timestamp among the nodes).
2. Node timestamps: If multiple new entries are merged into one node, the node Timestamp must use the latest ISO time among them.

[Strict JSON output format]
Make sure double quotes are escaped correctly. All Mermaid code (whether in mmd_content or content inside replace_blocks) must be wrapped in \`\`\`mermaid ... \`\`\` code fences. You must output the following JSON structure:
{
  "file_action": "replace or write",
  "mmd_content": "Complete escaped .mmd code, wrapped in \`\`\`mermaid ... \`\`\`. (Fill this only when file_action is write; otherwise it must be null)",
  "replace_blocks": [
    {
      "start_line": "Starting line number of the range to update (integer, corresponding to the L markers in Existing Mermaid content)",
      "end_line": "Ending line number of the range to update (integer, inclusive). To insert new content before a line without deleting any line, set start_line to that line number and end_line to start_line - 1",
      "content": "Replacement content without line number prefixes, wrapped in \`\`\`mermaid ... \`\`\`"
    }
  ],
  "node_mapping": {
    "tool_call_id_1": "N1",
    "tool_call_id_2": "N1"
  }
}

Output only the pure JSON object. Never include any explanation.`;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface L2NewEntry {
  toolCallId: string;
  toolCall: string;
  summary: string;
  timestamp: string;
}

// ─── User Prompt Builder ─────────────────────────────────────────────────────

/**
 * Build the L2 user prompt for MMD generation.
 * Mirrors context-offload-server/internal/service/prompt/BuildL2UserPrompt.
 */
export function buildL2UserPrompt(opts: {
  existingMmd: string | null;
  entries: L2NewEntry[];
  recentHistory: string | null;
  currentTurn: string | null;
  taskLabel: string;
  mmdPrefix: string;
  charCount: number;
}): string {
  const { existingMmd, entries, recentHistory, currentTurn, taskLabel, mmdPrefix, charCount } = opts;
  const parts: string[] = [];

  // History section
  if (recentHistory) {
    parts.push(`## Recent conversation history:\n${recentHistory}`);
  } else {
    parts.push("## Recent conversation history:\n(none available)");
  }

  if (currentTurn) {
    parts.push(`\n## Current latest turn:\n${currentTurn}`);
  }

  parts.push(`\n## MMD prefix: ${mmdPrefix}`);
  parts.push(`(All node IDs must begin with this prefix, such as ${mmdPrefix}-N1, ${mmdPrefix}-N2...)`);
  parts.push(`\n## Current task label: ${taskLabel}`);

  // Char count warning
  if (charCount > 2500) {
    parts.push(`\n## Current MMD size: ${charCount} chars (budget: 4000 chars)`);
    parts.push("Warning: close to the limit. Merge nodes aggressively, compress summaries, and prefer micro-adjustments with replace instead of a full rewrite with write.");
  } else if (charCount > 2000) {
    parts.push(`\n## Current MMD size: ${charCount} chars (budget: 4000 chars)`);
    parts.push("Keep growth under control and merge similar nodes.");
  }

  // Existing MMD with line numbers
  parts.push("\n## Existing Mermaid content:");
  if (existingMmd) {
    const lines = existingMmd.split("\n");
    for (let i = 0; i < lines.length; i++) {
      parts.push(`L${i + 1}: ${lines[i]}`);
    }
  } else {
    parts.push("(empty — create new)");
  }

  // New entries
  parts.push("\n## New offload entries to incorporate:");
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    parts.push(`${i + 1}. [${e.toolCallId}] ${e.toolCall} → ${e.summary} (${e.timestamp})`);
  }

  parts.push("\nGenerate or update the Mermaid flowchart according to the system instruction and output a valid JSON object (including node_mapping).");
  return parts.join("\n");
}
