/**
 * L1 Conflict Detection Prompt (Batch Mode)
 *
 * Based on Kenty's validated prototype prompt (l1_conflict_detection_prompt.md).
 * Batch-compares multiple new memories against a unified candidate pool,
 * supporting cross-type merge and multi-target operations.
 */

import type { MemoryRecord, ExtractedMemory } from "../record/l1-writer.js";

// ============================
// System Prompt
// ============================

export const CONFLICT_DETECTION_SYSTEM_PROMPT = `You are a memory conflict detector. Batch-compare multiple [new memories] against the existing memories in the [unified candidate memory pool], and decide how to handle each one individually.

## Core rules

- **Cross-type merge**: If memories of different types (persona / episodic / instruction) semantically describe the same fact or event, they may be merged.
- **Many-to-many merge**: One new memory may replace or merge with multiple existing memories in the candidate pool at the same time, specified through the target_ids array.
- After merging, you must judge the best resulting type for the new memory (merged_type).

## Decision logic

1. **Identify the nature of the memory**:
   - **State-like** (persona/instruction): preferences, traits, long-term settings, relatively stable facts, behavioral rules
   - **Event-like** (episodic): one-time experiences and objective records tied to a point in time; you should usually merge the cause and effect of the same event

2. **Judge whether it is the same fact or event**: same subject, same topic, similar time, similar scene_name

3. **Choose an action**:
   - "store": treat it as new information and add the current memory.
   - "skip": an existing memory is better; the new memory adds nothing or is more vague, so ignore the current memory.
   - "update": it is the same fact or event, and the new memory is better in content or time (more specific, later, or correcting an error). Use the new memory as the primary replacement for the old one, while preserving any still-correct older specifics when appropriate.
   - "merge": it is the same fact or the same evolution process, multiple memories are complementary without contradiction, and they should be merged into one more complete memory with minimal redundancy.

4. **Strategy tendency**:
   - State-like memories: if multiple memories describe the same preference or trait, prefer merge; if there is no added value, use skip; if there is a clear update, use update.
   - Event-like memories: if they describe the cause and effect or different stages of the same event, prefer merging them into one complete narrative; if they are fully identical, use skip.
   - Cross-type example: an episodic memory "The user started making podcasts in 2018" plus a persona memory "The user has podcast production experience" may be merged into either a persona or episodic memory, depending on where the information emphasis belongs.

5. **timestamp handling**:
   - During merge or update, merged_timestamps must contain the deduplicated, sorted union of all relevant memory timestamps.
   - This preserves the full timeline of when the event occurred.

## Output format

Strictly output a JSON array. Each element corresponds to the decision for one new memory. Output nothing else:

[
  {
    "record_id": "record_id of the new memory",
    "action": "store|update|skip|merge",
    "target_ids": ["record_id 1 of the candidate memory to delete", "record_id 2"],
    "merged_content": "Merged or updated memory content (required for merge/update)",
    "merged_type": "Best type after merging: persona|episodic|instruction (required for merge/update)",
    "merged_priority": 85,
    "merged_timestamps": ["Array of merged timestamps containing the union of all old and new memory timestamps (required for merge/update)"]
  }
]

Field notes:
- target_ids: an array of the old memory IDs to delete and replace. It may contain one or multiple IDs. Omit it or leave it empty for store or skip.
- merged_content: the final memory statement for merge or update. Omit it for store or skip.
- merged_type: the type the memory should belong to after merge or update. Judge it based on the essence of the merged content.
- merged_priority: the new priority after merge or update (an integer from 0 to 100; required for merge/update). Because merged information is more complete and more certain, priority should usually be raised when appropriate. Suggested reference: 80-100 for core traits or important events, 60-79 for general preferences or ordinary activities, and below 60 for secondary information.
- merged_timestamps: the merged timestamp array. Collect the new memory timestamp plus all timestamps from merged old memories, then deduplicate and sort them.`;

// ============================
// Prompt Builder
// ============================

/**
 * Candidate search result for a single new memory.
 */
export interface CandidateMatch {
  newMemory: ExtractedMemory & { record_id: string };
  candidates: MemoryRecord[];
}

/**
 * Format the batch conflict detection prompt using a unified candidate pool.
 *
 * Format (aligned with prototype):
 * 1. Unified candidate pool: de-duplicated list of all existing candidates across all new memories
 * 2. Per new memory: content + list of related candidate IDs from the pool
 *
 * This approach lets the LLM see the global picture and handle cross-memory dedup in one pass.
 *
 * @param matches - Array of new memories with their candidate matches
 */
export function formatBatchConflictPrompt(matches: CandidateMatch[]): string {
  // Step 1: Build unified candidate pool (de-duplicate across all new memories)
  const unifiedPool = new Map<string, MemoryRecord>();
  const perMemoryCandidateIds = new Map<string, string[]>();

  for (const m of matches) {
    const candidateIds: string[] = [];
    for (const c of m.candidates) {
      if (!unifiedPool.has(c.id)) {
        unifiedPool.set(c.id, c);
      }
      candidateIds.push(c.id);
    }
    perMemoryCandidateIds.set(m.newMemory.record_id, candidateIds);
  }

  // Step 2: Format unified pool as JSON
  const poolList = Array.from(unifiedPool.values()).map((c) => ({
    record_id: c.id,
    content: c.content,
    type: c.type,
    priority: c.priority,
    scene_name: c.scene_name,
    timestamps: c.timestamps,
  }));

  let poolSection: string;
  if (poolList.length === 0) {
    poolSection = "## Unified candidate memory pool\n\n(empty; there are no existing memories, so all new memories should be stored directly)";
  } else {
    const poolStr = JSON.stringify(poolList, null, 2);
    poolSection = `## Unified candidate memory pool (${poolList.length} existing memories total)\n\n${poolStr}`;
  }

  // Step 3: Format each new memory with its related candidate IDs
  const memoryParts = matches.map((m, idx) => {
    const relatedIds = perMemoryCandidateIds.get(m.newMemory.record_id) ?? [];
    const relatedNote =
      relatedIds.length > 0
        ? JSON.stringify(relatedIds)
        : "[] (no similar candidates; store directly)";

    const memStr = JSON.stringify(
      {
        record_id: m.newMemory.record_id,
        content: m.newMemory.content,
        type: m.newMemory.type,
        priority: m.newMemory.priority,
        scene_name: m.newMemory.scene_name,
      },
      null,
      2,
    );

    return `### New memory ${idx + 1} (record_id: ${m.newMemory.record_id})\n${memStr}\n\n[Related candidate IDs] ${relatedNote}`;
  });

  const newMemoriesText = memoryParts.join(
    "\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n",
  );

  // Step 4: Assemble final prompt
  return `${poolSection}

${"═".repeat(50)}

## New memories to judge (${matches.length} total)

${newMemoriesText}

Judge each memory one by one and output the decision JSON array. When a memory's candidate list is empty, that item should directly output action=store.`;
}
