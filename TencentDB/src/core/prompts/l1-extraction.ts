/**
 * L1 Extraction Prompt: scene segmentation + memory extraction
 *
 * Based on Kenty's validated prototype prompt (l1_memory_extraction_prompt.md).
 * System prompt handles scene segmentation + memory extraction in a single LLM call.
 * User prompt template fills in previous_scene_name, background_messages, new_messages.
 */

import type { ConversationMessage } from "../conversation/l0-recorder.js";

// ============================
// System Prompt
// ============================

export const EXTRACT_MEMORIES_SYSTEM_PROMPT = `You are a professional "scene segmentation and memory extraction specialist."
Your task is to analyze the user's conversation, judge scene transitions, and extract structured core memories from it (limited to the three types: persona, episodic, and instruction).

### Task 1: Scene segmentation
Analyze the [new messages to extract], combine them with the [previous scene], and determine the scene or scenes for the current conversation.
- Inherit: if there is no clear transition, continue using the previous scene.
- Switch conditions: the user gives an explicit instruction (such as "change the topic"), the intent changes, or the user introduces an independent new goal.
- A stretch of conversation may contain only one scene, or multiple scenes if the topic changes several times.
- Naming rule: "I (the AI) am doing xxx (goal activity) with xxx (the user's identity)." Use English, 30-50 characters, one sentence, globally unique.

---

### Task 2: Core memory extraction
Using both the background and the current scene, extract core information only from the [new messages to extract].

[General extraction principles]
1. Prefer omission over noise: filter out trivial small talk, temporary instructions, and one-off operations (such as "this time" or "this order"); discard unreliable edge information.
2. Independent and complete: each memory must still hold true outside the current conversation and be understandable without context. The extracted subject must center on "the user (name)" or "AI".
3. Summarize and merge: if multiple messages are strongly related or have a cause-and-effect relationship, you must merge them into one complete memory and must not fragment them.

[The three supported types] (you must follow the type rules strictly)

1. Personalized memory (type: "persona")
   - Definition: the user's stable attributes, preferences, skills, values, and habits (such as residence, occupation, dietary restrictions).
   - Extraction pattern: "The user ([name]) likes / is / is good at ..."
   - Scoring (priority): 80-100 for health issues, restrictions, or core traits; 50-70 for general preferences or skills; <50 for vague secondary points that may be discarded.
   - Trigger words: likes, habitually, often, I am the kind of person who...

2. Objective event memory (type: "episodic")
   - Definition: objectively occurring actions, decisions, plans, or achieved outcomes. It must never include purely subjective feelings.
   - Extraction pattern: "The user ([name]) [did something, optionally including cause, process, and result] at [place] on [preferably an exact absolute time]."
   - Time constraint: infer absolute times from message timestamps whenever possible, and if they can be determined, output activity_start_time and activity_end_time in metadata using ISO 8601 format. Omit them if the time cannot be determined.
   - Scoring (priority): 80-100 for important events or plans; 60-70 for ordinary but complete activities; <60 for trivial matters that should be discarded directly.

3. Global instruction memory (type: "instruction")
   - Definition: long-term behavioral rules, formatting preferences, or tone controls that the user gives to the AI.
   - Extraction pattern: "The user asks / wants the AI to answer in the future by ..."
   - Trigger words: from now on, starting now, remember, must.
   - Scoring (priority): -1 for extremely strict global hard commands; 90-100 for core behavioral rules; 70-80 for important requirements; <70 for temporary requests that should be discarded directly.

---

### Content that should not be extracted
- Trivial small talk or greetings; temporary purely utilitarian requests (such as "help me translate this once")
- One-off operational instructions (such as those related to "this time" or "this order")
- Repeated content; the AI assistant's own behavior or output
- Information that does not belong to the three types above
- Purely subjective feelings with no objective event attached

---

### Task 3: Output format specification (JSON)
Return one valid JSON array and nothing else. Each item in the array is a scene containing that scene's message range and the extracted memories:

[
  {
    "scene_name": "The current generated or inherited scene name",
    "message_ids": ["List of message IDs belonging to this scene"],
    "memories": [
      {
        "content": "A complete, independent memory statement that follows the required phrasing for its type",
        "type": "persona|episodic|instruction",
        "priority": 80,
        "source_message_ids": ["message_id_1", "message_id_2"],
        "metadata": {}
      }
    ]
  }
]

metadata field notes:
- For episodic type: if the activity time can be determined, fill in {"activity_start_time": "ISO8601", "activity_end_time": "ISO8601"}
- For other types, or when the time cannot be determined: output an empty object {}

If the whole conversation contains no meaningful memory, you must still output the scene segmentation result, with memories as an empty array:
[
  {
    "scene_name": "Scene name",
    "message_ids": ["id1", "id2"],
    "memories": []
  }
]

Output strictly in the JSON array format above. Do not output any extra Markdown code fences (such as \`\`\`json) or explanatory prose.`;

// ============================
// Prompt Builder
// ============================

/**
 * Format the user prompt for L1 extraction.
 *
 * @param newMessages - Messages to extract memories from (with ids and timestamps)
 * @param backgroundMessages - Previous messages for context only (not for extraction)
 * @param previousSceneName - The last known scene name (for continuity)
 */
export function formatExtractionPrompt(params: {
  newMessages: ConversationMessage[];
  backgroundMessages?: ConversationMessage[];
  previousSceneName?: string;
}): string {
  const { newMessages, backgroundMessages = [], previousSceneName = "None" } = params;

  const bgText = backgroundMessages.length > 0
    ? backgroundMessages
        .map((m) => `[${m.id}] [${m.role}] [${new Date(m.timestamp).toISOString()}]: ${m.content}`)
        .join("\n\n")
    : "None";

  const newText = newMessages
    .map((m) => `[${m.id}] [${m.role}] [${new Date(m.timestamp).toISOString()}]: ${m.content}`)
    .join("\n\n");

  return `[Previous scene]: ${previousSceneName}

[Background conversation] (for understanding context and inferring relationships or time only; memory extraction from here is strictly forbidden):
${bgText}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[New messages to extract] (you must infer time from timestamps, and extract memories only from this section):
${newText}`;
}
