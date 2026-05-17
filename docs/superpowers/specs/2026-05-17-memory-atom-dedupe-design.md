# Memory Atom Dedupe Design

Date: 2026-05-17
Status: Approved in brainstorming

## Summary

This design fixes inefficient duplicated memory scenarios by deduplicating durable memories at the L1 atom layer instead of trying to hide duplicates later in L2 or recall. New memory atoms will be canonicalized before upsert, and existing stored atoms will be backfilled with canonical keys and compacted only when they are exact canonical matches. L2 scenario generation remains simple and benefits automatically from a smaller, cleaner atom set.

The design intentionally does not add broad semantic auto-merge behavior for paraphrases, vector-threshold-based write-time merging, or scenario-specific dedupe logic in this change.

## Goals

- Collapse obvious duplicates like punctuation, quote-style, spacing, and markdown-noise variants into one atom.
- Reduce repeated bullets and repeated evidence in L2 scenario snapshots.
- Keep future atom growth lower so recall and maintenance stay more efficient.
- Safely clean up existing exact duplicates already in storage.
- Preserve provenance by merging source turn IDs and reference links correctly.
- Keep the rollout conservative and predictable.

## Non-Goals

- Broad semantic paraphrase clustering of old memories.
- Vector-based automatic merge decisions on atom writes.
- Rewriting historical `body_markdown` text in old scenario rows.
- Changing recall ranking beyond the indirect effects of a smaller deduped atom set.
- Adding scenario-upsert or scenario-deduplication semantics in this change.

## Current-State Context

The current duplication comes from the atom layer and then propagates upward:

- `src/memory/backends/sqlite/backend.ts` currently deduplicates atoms with exact raw text matching only: `WHERE user_id = ? AND text = ?`.
- `src/memory/pipeline/l1.ts` relies on the model prompt to avoid duplicates, but the backend does not protect against semantically identical wording variants.
- `src/memory/pipeline/l2.ts` always inserts a new scenario snapshot from the full atom list, so duplicated atoms naturally become duplicated scenario bullets.
- Local reproduction already shows that tiny wording differences such as straight-vs-curly apostrophes or alternate phrasings for the same formatting preference create separate atom IDs.

Because the root cause is at L1 storage, the fix should happen there rather than adding symptom-level filtering in scenarios.

## Approaches Considered

### 1. Atom-layer canonical dedupe

This is the recommended approach.

Pros:
- Fixes the duplication at the real source.
- Makes new writes deterministic instead of relying on model behavior.
- Improves L2 scenario quality automatically without extra scenario logic.
- Keeps recall and maintenance cheaper because fewer atoms accumulate.
- Supports safe cleanup of already-stored exact duplicates.

Cons:
- Conservative canonicalization will not catch every paraphrase.
- A schema migration and cleanup pass are required.
- Reference reassignment during cleanup adds implementation complexity.

### 2. Semantic merge on write using vector similarity

This would reuse the existing vector path and merge when a new atom is close enough to an existing one.

Pros:
- Can catch broader paraphrases immediately.
- Does not depend as heavily on prompt consistency.

Cons:
- Merge thresholds are hard to tune safely.
- False merges are much more dangerous than missed merges.
- The current vector distance behavior is too broad for safe automatic merging of user preferences and identity facts.

This approach is intentionally deferred.

### 3. Scenario-only dedupe

This would leave atom storage unchanged and hide duplicates only when building scenarios or during recall.

Pros:
- Fastest symptom-level improvement.
- Minimal storage migration work.

Cons:
- Leaves the root cause in place.
- Atom count continues to grow inefficiently.
- Other atom consumers would still see duplicated state.
- Makes behavior more fragmented because each higher layer would need its own dedupe logic.

This approach is rejected because it treats symptoms, not cause.

## Approved Approach

Implement atom-layer canonical dedupe with exact cleanup for existing data.

The design has two complementary parts:

1. New writes immediately use canonical matching at atom upsert time.
2. Existing rows are backfilled and compacted only when their canonical keys are exact matches.

That keeps the rollout conservative: new data becomes clean right away, obvious historical duplicates get fixed, and broader paraphrase decisions are deferred until there is enough evidence to justify a separate compaction tool.

## Detailed Design

### L1 extraction changes

Update the L1 extraction prompt so the model emits stable, reusable phrasing for durable memories and avoids duplicate statements within a single extraction batch.

Expected prompt behavior:
- Emit one normalized memory statement per durable fact.
- Prefer stable phrasing for identity, preferences, constraints, and reusable workflow instructions.
- Avoid producing two items that mean the same thing from the same evidence window.
- Continue returning structured JSON in the current shape.

This prompt tightening reduces variation at the source, but it is not the only protection. Backend canonical matching remains the real enforcement layer.

### Canonical matching key

Add a canonical matching key for memory atoms, stored as `canonical_text`.

The canonicalization helper should be conservative and deterministic. It should normalize text enough to catch obvious duplicates without trying to infer broad semantic equivalence.

Normalization rules:
- Unicode normalize with NFKC.
- Lowercase the text.
- Normalize straight and curly quote variants consistently.
- Remove markdown-only formatting noise such as emphasis markers.
- Normalize punctuation and separator noise that should not distinguish natural-language memory statements.
- Collapse repeated or irregular whitespace.
- Trim leading and trailing whitespace.

The helper should be designed for short natural-language memory statements, not for arbitrary code or identifier semantics. This is acceptable because memory atoms in this pipeline are already modeled as durable natural-language statements.

### Schema changes

Add a nullable `canonical_text` column to `memory_atoms`.

Migration order:
1. Add `canonical_text` to `memory_atoms` without uniqueness enforcement.
2. Backfill `canonical_text` for existing rows.
3. Merge rows that collide on `(user_id, canonical_text)`.
4. Create a unique index on `(user_id, canonical_text)` after collisions are resolved.

The existing `UNIQUE(user_id, text)` constraint can remain in place for now as an additional guard. The new canonical index becomes the authoritative dedupe key for future writes.

### Upsert behavior for new atoms

Update `upsertMemoryAtom` so it uses `canonical_text` as the first-class identity key.

For each incoming atom:
1. Trim and validate `text`.
2. Compute `canonical_text`.
3. Look up an existing row by `(user_id, canonical_text)`.
4. If none exists, insert a new atom with both `text` and `canonical_text`.
5. If a matching row exists, merge into that row instead of creating a new atom.

Merge behavior for a matched atom:
- union `source_turn_ids_json` and keep unique turn IDs
- keep the higher `importance`
- preserve the original `created_at`
- refresh `updated_at`
- continue updating `source_layer` with the current write behavior
- refresh the FTS row and embedding row for the surviving atom

Stored display text behavior:
- For new merges driven by fresh L1 output, the surviving row may refresh `text` to the newer canonical phrasing produced by L1.
- For historical cleanup, the migration does not need to rewrite the survivor's display text immediately.

This split keeps migration safer while still allowing the stored wording to become cleaner over time as new canonical writes arrive.

### Exact cleanup for existing stored atoms

Add a one-time backfill and compaction pass for already-stored atoms.

Cleanup scope:
- only merge rows whose `canonical_text` matches exactly
- do not attempt vector-threshold or semantic paraphrase merging

Deterministic survivor selection:
- keep the oldest row, using the lowest stable ID or earliest `created_at`
- merge metadata into that survivor

Merged survivor state:
- union all source turn IDs
- keep the highest importance value
- preserve the earliest `created_at`
- refresh `updated_at`
- recompute the survivor embedding and FTS representation

Reference updates required during cleanup:
- repoint `lineage_links` entries whose `source_kind` or `target_kind` references a removed atom ID
- deduplicate lineage rows if reassignment produces equivalent links that already exist
- rewrite `memory_scenarios.atom_ids_json` arrays so removed atom IDs are replaced with the survivor ID
- remove repeated IDs from those rewritten scenario arrays
- delete FTS and embedding rows associated with removed atom IDs if they are not already handled by existing cleanup logic

Historical scenario behavior after cleanup:
- old scenario `atom_ids_json` references stay internally consistent after atom merges
- old scenario `body_markdown` text is not rewritten during migration
- newly generated scenarios naturally become cleaner because they are built from the deduped atom set

### L2 scenario behavior

No special semantic dedupe logic is added to L2 in this change.

L2 continues to:
- read the atom set
- ask the model to build a scenario snapshot
- insert a new scenario row

The practical improvement comes from feeding L2 a cleaner atom set.

This keeps the change focused and avoids introducing two different definitions of “duplicate.”

### Testing

Add or update tests for the following cases:

Atom upsert tests:
- straight apostrophe vs curly apostrophe merges into one atom
- markdown formatting noise variants merge into one atom when canonical text matches
- source turn IDs are unioned during merge
- importance keeps the higher value during merge
- fresh L1 canonical phrasing can refresh stored `text` on a matched merge

Migration/cleanup tests:
- existing rows get `canonical_text` backfilled
- exact canonical collisions merge into one surviving atom
- survivor selection is deterministic
- lineage links are repointed correctly
- duplicate lineage rows are removed after reassignment
- scenario `atom_ids_json` arrays are rewritten to survivor IDs and deduped

Pipeline-level tests:
- L2 receives a smaller atom set after cleanup or canonicalized upserts
- scenario snapshots no longer contain duplicated bullets for obvious formatting or punctuation variants
- broader paraphrases that do not canonically match remain separate in this change

Regression tests should explicitly protect the non-goal: no broad semantic auto-merge for merely similar paraphrases.

## Risks and Tradeoffs

- Conservative canonicalization will still miss some broader paraphrases.
- Over-aggressive canonicalization could merge distinct memories incorrectly, so the helper must stay narrow in scope.
- Historical scenario markdown may remain visually stale until newer scenario snapshots are generated.
- Cleanup touches several reference surfaces, so the migration path carries more risk than a new-write-only fix.

These tradeoffs are acceptable because false merges are worse than missed merges for user identity, workflow preferences, and project memory.

## Additional Follow-Up Task: Reviewer False-Positive Reduction

During prior review, an automated reviewer flagged pre-existing assertions in `tests/memory/sqlite-backend.test.ts` about `memory_atoms.source_layer` and `memory_scenarios.file_path` as if they were new scope introduced by Task 1. In this context, those assertions already existed before the task, so the signal was a false positive rather than an implementation gap.

This should be tracked as a separate follow-up task, not as a blocker for the atom dedupe work.

Goal:
- reduce false positives when automated review comments on unchanged assertions or legacy lines in touched files
- improve trust in reviewer output by separating newly introduced scope from pre-existing baseline assertions

Proposed approach:
- make reviewer decisions diff-aware first and file-aware second
- treat unchanged lines in touched files as baseline context, not new task scope
- only flag unexpected additions when the relevant assertion or logic was added or materially changed in the current diff
- if a reviewer comment references legacy lines outside the diff, downgrade it to informational unless there is a direct interaction with changed code

Pros:
- less noise in automated review
- fewer false-positive blockers
- better reviewer credibility for real issues

Cons:
- this is a separate task from atom dedupe and should not block that implementation
- it is only feasible if the reviewer logic is implemented in this repo or otherwise adjustable by this project
- diff-aware review logic can become too narrow if it stops noticing real cross-file effects of a change

## Rollout Notes

Recommended rollout order:
1. land canonical-text support and new-write upsert logic
2. add exact-cleanup migration and tests
3. run maintenance to generate cleaner scenarios from the deduped atom set
4. if the reviewer implementation is repo-owned, handle reviewer false-positive reduction as a separate follow-up task

If broader paraphrase duplicates remain a real problem after this change, the next step should be a separate reviewed compaction tool rather than automatic semantic merging in the hot write path.
