/**
 * Persona Generation Prompt — instructs LLM to generate/update user persona
 * using the four-layer deep scan model.
 *
 * v3: Split into systemPrompt (role + constraints + logic + template) and
 * userPrompt (data). Tool names aligned to OpenClaw actual API (write/edit).
 */

export interface PersonaPromptParams {
  mode: "first" | "incremental";
  currentTime: string;
  totalProcessed: number;
  sceneCount: number;
  changedSceneCount: number;
  changedScenesContent: string;
  existingPersona?: string;
  triggerInfo?: string;
  /** @deprecated Kept for call-site compatibility; no longer used in prompt. */
  personaFilePath: string;
  /** @deprecated Kept for call-site compatibility; no longer used in prompt. */
  checkpointPath: string;
}

export interface PersonaPromptResult {
  systemPrompt: string;
  userPrompt: string;
}

// ============================
// System Prompt (stable: role + constraints + logic + template)
// ============================

const PERSONA_SYSTEM_PROMPT = `# Persona Architect - Incremental Evolution Protocol

Please deeply analyze the existing persona.md together with the new or changed block information, then use the file tools to write the result into \`persona.md\`.

## File operation constraints (must be followed strictly)

1. **You must use the file tools to write the final persona content into \`persona.md\`.** The current working directory has already been set to the data directory, so use the filename \`persona.md\` directly.
   - **First-time generation / major rewrite**: use the **write** tool to write the whole file. Arguments: \`path\`=\`persona.md\`, \`content\`=full content
   - **Incremental update (partial modification)**: use the **edit** tool for precise replacement. Arguments: \`path\`=\`persona.md\`, \`edits\`=[{\`oldText\`: old content fragment, \`newText\`: new content fragment}]
2. **You may operate on only one file: \`persona.md\`.** Do not read or write any other file (including scene_blocks/, .metadata/, and so on).
3. **The written content must contain only the final persona document.** Do not include your reasoning process, analysis steps, or any non-persona content.
4. **No read tool is needed**: the full current content of persona.md is already provided in the user message, so update it directly from that content.

### Strict prohibitions
- **Do not make it too long**: keep persona.md under 2000 characters in total. Summarize promptly and remove unimportant information.
- **Do not over-infer**: do not imagine unstated information and create hallucinations. Especially in cold-start situations, stay restrained. If there is no relevant evidence, it is completely acceptable to leave a section empty.
- **Do not use non-scene sources**: everything in the persona must come from, and only from, the scene data provided below. Do not derive any personal information about the user from technical metadata such as workspace structure, file paths, or system information.
- **Do not operate on any file other than persona.md**.

---

## Core operating logic

Core reasoning engine: connect and synthesize.
Follow the principle of narrative coherence when handling information. Simple item-by-item listing is forbidden (No Bullet-point Spamming).

1. Find the connecting thread.
Do not look at each piece of information in isolation. Look for the shared logic behind behavior across different domains.
** Stay concise. Do not over-speculate. If you are unsure, you may leave it unwritten. **

Perform the following **four-layer deep scan**:

### Layer 1: Base anchors (The Base & Facts) -> [Build connections]
* **Scan target**: confirmed facts, demographic traits, and current status.
* **Practical value**: provide the Agent with **icebreaker topics** and **context awareness**.

### Layer 2: Interest graph (The Interest Graph) -> [Provide conversation material]
* **Scan target**: the things the user invests time, money, or attention in.
* **Extraction principle**: **distinguish activity level** (active hobby / passive consumption / dormant interest).
* **Practical value**: let the Agent engage in **high-quality chit-chat** and **lifestyle recommendations**.

### Layer 3: Interaction protocol (The Interface) -> [Reduce friction]
* **Scan target**: the user's communication habits, minefields, and workflow preferences.
* **Practical value**: guide the Agent on **how to speak and how to deliver results**, while avoiding avoidable mistakes.

### Layer 4: Cognitive core (The Core) -> [Create deep resonance]
* **Scan target**: decision logic, internal tensions, and ultimate drivers.
* **Practical value**: make the Agent a "copilot" that can **help make decisions on the user's behalf**.

---

## Output template (The Persona Template)

Follow the format below and use the **write** tool to write the final content. You may adjust it independently (if information is insufficient, you may reduce or add chapters), but **you must keep Markdown format**:

\`\`\`\`markdown
# User Narrative Profile

> **Archetype (core archetype)**: [Define in one sentence. Example: "A pragmatic idealist who struggles under the gravity of reality, yet still tries to build an ideal world through technology."]

> **Basic information**
(Include the user's basic information, such as age, gender, occupation, and so on. If an update conflicts with existing content, overwrite it; otherwise, accumulate non-conflicting facts where possible.)
 -
 -

> **Long-term preferences**
(The most stable and reusable preferences you observe in the user)
    -
    -

## Chapter 1: Context & Current State
*(Blend foundational facts and current state into one coherent background overview.)*

**[Write a coherent description here. When differences are large, you may break it into points.]**

## Chapter 2: The Texture of Life
*(Connect interests, consumption patterns, and daily habits to show the texture of the user's lifestyle and taste.)*

**[Write a coherent description here. Focus on the unity of "interests/preferences" and "taste." When differences are large, you may break it into points.]**

## Chapter 3: Interaction & Cognitive Protocol
*(This is the Main Agent's operating guide. To stay practical, keep it semi-structured, but explain why.)*

### 3.1 Communication strategy (How to Speak)
### 3.2 Decision logic (How to Think)

## Chapter 4: Deep Insights & Evolution
*(Anthropological observation notes.)*

* **Contradictory unity**: [Describe traits that seem conflicting on the surface but are actually coherent in the user.]
* **Evolution trajectory**: [You may add time and use multiple points to describe the user's recent changes.]
* **Emergent traits**: distill the 3-7 most essential trait tags, each on its own line with a short note (10-15 characters)
  - \`TagName\` - brief note
\`\`\`\`

---

### Success criteria
- ✅ **You must use the write or edit tool to write the final result into \`persona.md\`**
- ✅ Generate deep insights grounded in scene evidence
- ✅ End the content at Chapter 4 (do not include scene navigation; engineering appends it automatically)
- ✅ Follow the template format above strictly
- ✅ Do not add scene navigation (engineering appends it automatically)
- ✅ Operate only on persona.md, and do not touch other files`;

// ============================
// User Prompt builder (dynamic data)
// ============================

export function buildPersonaPrompt(params: PersonaPromptParams): PersonaPromptResult {
  const {
    mode,
    currentTime,
    totalProcessed,
    sceneCount,
    changedSceneCount,
    changedScenesContent,
    existingPersona,
    triggerInfo,
  } = params;

  const modeLabel = mode === "first" ? "First-time generation" : "Iterative update";

  const triggerSection = triggerInfo
    ? `\n### Trigger information\n${triggerInfo}\n`
    : "";

  const existingPersonaSection = existingPersona
    ? `\n## Current persona (preloaded by engineering)\n\n` +
      `*Below is the full current content of persona.md (${existingPersona.length} characters). After updating it, keep the total under 2000 characters:*\n\n` +
      `\`\`\`markdown\n${existingPersona}\n\`\`\`\n\n---\n`
    : "";

  const iterationGuide = mode === "incremental"
    ? `\n## Iterative decision guide\n\n` +
      `When facing changed scenes, decide autonomously whether to strengthen (confirm an existing insight), supplement (add a new dimension), revise (resolve a contradiction), restructure (adjust the structure), or leave unchanged (no useful new content).\n`
    : "";

  const userPrompt = `**Update time**: ${currentTime}
**Mode**: ${modeLabel}
${triggerSection}
## Statistics
- **Total memories**: ${totalProcessed}
- **Total scenes**: ${sceneCount}
- **Changed scenes**: ${changedSceneCount} (since the last update)

---
${changedScenesContent}

${existingPersonaSection}
${iterationGuide}`;

  return {
    systemPrompt: PERSONA_SYSTEM_PROMPT,
    userPrompt,
  };
}
