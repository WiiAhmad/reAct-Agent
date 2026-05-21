# TencentDB Full Offload Pipeline Adaptation Design

## Goal

Adapt the useful context-offload ideas from `TencentDB-Agent-Memory/main.md` into this project, including L1.5 task judgment, task-scoped L2 Mermaid canvases, and L4 skill generation from grounded task evidence.

The first success criterion is TencentDB-like L1.5 judging behavior: the runtime should decide whether a new interaction is short/casual, a continuation of an active task, a continuation of an older task, a new long task, or a completion signal before any Mermaid canvas is updated.

The final pipeline success criterion is grounded skill synthesis: a selected task canvas and its node-linked offload evidence can produce a reusable draft `SKILL.md` artifact without changing L0-L3 durable memory semantics.

## Non-goals

- Do not change the protected durable memory model: L0 conversations, L1 atoms, L2 scenarios, and L3 persona keep their current meanings.
- Do not replace the project-owned SQLite memory backend.
- Do not delete or migrate away existing offload refs or legacy per-chat canvas files.
- Do not auto-install generated skills into Claude Code or any global agent skill directory without explicit user approval. L4 creates draft skill artifacts first.

## Current state

The project already has a durable memory pipeline:

```text
L0 conversations -> L1 atoms -> L2 scenarios -> L3 persona
```

It also has short-term context offload support:

- Large tool results are written to markdown ref files.
- `memory_task_nodes` records tool-result evidence with `node_id` and optional `result_ref`.
- `OffloadService` writes a simple Mermaid canvas per chat.
- Recall can inject the active task canvas into the agent context.

The missing layers are task ownership judgment before canvas writing and skill synthesis after a task canvas has enough grounded evidence. Today, task nodes are tied primarily to a chat, so unrelated long tasks and casual messages can be merged into one canvas. There is also no project-owned L4 flow that turns completed task evidence into reusable draft skills.

## Proposed architecture

Add a separate context-offload task pipeline alongside the durable memory pipeline:

```text
recent turn/tool evidence -> offload L1 evidence summaries -> L1.5 task judgment -> task-scoped L2 Mermaid canvas -> L4 draft skill synthesis
```

This context-offload pipeline is separate from durable memory `L0 -> L1 -> L2 -> L3`.

- Offload L1 summarizes active tool evidence into compact entries.
- L1.5 is a first-class router, not memory extraction. It decides where subsequent offload evidence belongs.
- Offload L2 builds or updates the task-scoped Mermaid canvas.
- L4 creates a reusable draft skill from a selected task canvas and the node-linked evidence behind it.

These components should live under `src/memory/offload/` because they belong to active task context, not the durable `src/memory/pipeline/` L0-L3 maintenance path.

## Runtime configuration

Add explicit runtime config for L1.5, L4, task canvas storage, generated skill storage, and local datetime behavior.

### L1.5 config

Expose these environment-backed settings through `parseConfig`:

- `MEMORY_L15_ENABLED=true` enables task judgment before canvas routing.
- `MEMORY_L15_MODE=hybrid` controls the judge strategy: `rules`, `llm`, or `hybrid`.
- `MEMORY_L15_RECENT_MESSAGES=6` controls the recent conversation window used for judgment.
- `MEMORY_L15_HISTORY_TASK_LIMIT=10` controls how many historical task canvases are offered as continuation candidates.
- `MEMORY_L15_MAX_CANVAS_CHARS=12000` caps active/historical canvas content included in LLM judgment input.
- `MEMORY_L15_SAFE_FALLBACK=short` controls the safe result when LLM judgment fails. The first implementation should support `short` only, because failing closed avoids canvas pollution.
- `MEMORY_TASK_CANVAS_DIR=./data/memory/task-canvases` controls where new task-scoped `.mmd` files are written.

The default config should match the selected design: L1.5 enabled, hybrid mode, deterministic rules first, LLM only for ambiguous cases, and safe fallback to short/no-canvas routing.

### L4 config

Expose these environment-backed settings through `parseConfig`:

- `MEMORY_L4_ENABLED=true` enables draft skill generation from task canvases.
- `MEMORY_L4_MODE=local` controls generation strategy. The first implementation should use the existing configured `LlmProvider` locally instead of requiring TencentDB's backend service.
- `MEMORY_L4_SKILLS_DIR=./data/memory/skills` controls where generated draft skills are written.
- `MEMORY_L4_REQUIRE_COMPLETED_TASK=false` controls whether skills can only be generated from completed task canvases. Default false allows explicit user-triggered skill drafts from active tasks.
- `MEMORY_L4_MAX_EVIDENCE_ENTRIES=80` caps node-linked offload entries sent to the L4 prompt.
- `MEMORY_L4_MAX_CANVAS_CHARS=20000` caps selected Mermaid content in the L4 prompt.
- `MEMORY_L4_MAX_SKILL_CHARS=20000` caps generated `SKILL.md` content before writing.

Generated skills are draft artifacts. They should be saved under the project data directory and surfaced to the user for review. They should not be copied to `.claude/skills`, global skill directories, or committed automatically.

### Datetime config

Add local datetime settings so `tdai_current_datetime` is deterministic across hosts:

- `APP_TIMEZONE=Asia/Jakarta` by default for this deployment.
- `APP_LOCALE=id-ID` by default for localized readable date strings.

`getRuntimeConfigSummary()` should include L1.5 mode/enabled state, L4 enabled state, skill output directory, and the active timezone/locale, without exposing secrets.

## Data model

Add task-boundary and generated-skill state to the project-owned backend.

### Task canvas records

A task canvas record represents one long-running task and its Mermaid file.

Fields:

- stable task id
- chat id
- user id
- label
- canvas file path
- status: `active`, `completed`, or `inactive`
- created timestamp
- updated timestamp

### L1.5 judgments

A judgment records the router decision for a user turn.

Fields:

- chat id
- user id
- recent-message or turn range reference
- `taskCompleted`
- `isLongTask`
- `isContinuation`
- selected task id, if any
- `newTaskLabel`, if any
- source: `rules` or `llm`
- created timestamp

### Task boundaries

A boundary attributes future unassigned task nodes to a task target.

Fields:

- chat id
- user id
- starting task-node sequence position
- result: `long`, `short`, or `pending`
- target task id, if result is `long`
- created timestamp

`memory_task_nodes` should remain the evidence table. Add a nullable task id column so each new node can be directly associated with the selected task canvas. Boundary records still matter for explaining why a node was routed to that task, but node-to-task lookup should not require reconstructing range joins.

### L4 generated skill records

A generated skill record represents a draft reusable skill synthesized from one task canvas.

Fields:

- stable generated skill id
- source task id
- chat id
- user id
- skill name
- skill description
- skill focus, if provided
- skill file path
- source canvas file path
- source node ids JSON
- source offload ref ids or node ids JSON
- status: `draft`, `reviewed`, `rejected`, or `exported`
- created timestamp
- updated timestamp

The record should preserve traceability from the draft skill back to task canvas nodes and offload refs.

## L1.5 judgment flow

Run L1.5 for each new user turn before updating a task canvas.

### 1. Collect context

Build a compact judgment input from:

- latest user message
- recent conversation window
- active task metadata and Mermaid content, if present
- recent historical task metadata
- pending or recent tool-result nodes that are not yet assigned to a task

### 2. Apply deterministic rules

Rules should handle obvious cases without an LLM call:

- short/casual/one-shot QA messages become `isLongTask=false`
- tool-assisted one-shot QA, such as asking the current day/time via `tdai_current_datetime`, stays short even though it uses a tool
- explicit completion phrases mark the active task completed
- clear continuation of an active incomplete task keeps the active target
- clear new long-task requests create a new task label

Rules should only return a judgment when they are confident. A short side question should not complete or replace an unrelated active task unless the user explicitly says the active task is done.

### 3. Escalate ambiguous cases to the configured LLM

If rules are not confident, use the existing `LlmProvider` to produce strict JSON with this shape:

```ts
type TaskJudgment = {
  taskCompleted: boolean;
  isLongTask: boolean;
  isContinuation: boolean;
  continuationTaskId?: string;
  newTaskLabel?: string;
};
```

The prompt should mirror the TencentDB L1.5 intent:

1. infer the newest user intent from recent messages
2. compare it with the current active task canvas
3. scan recent historical task canvases for continuation candidates
4. output only JSON

The parser should validate the response defensively. If JSON parsing or validation fails, the fallback is safe: classify the turn as `short` or `pending` and do not update a task canvas.

### 4. Apply task transition

After a judgment:

- short interaction: do not assign new nodes to any canvas
- active continuation: keep the active task target
- historical continuation: reactivate the selected task canvas
- new long task: create a task canvas record and initial `.mmd` file
- completion: mark the active task completed and stop routing new evidence to it unless a later turn explicitly continues it

## Canvas generation

Canvas generation becomes task-scoped.

`OffloadService` should continue to:

- offload large tool results to ref markdown files
- create `memory_task_nodes`
- preserve `node_id`
- preserve optional `result_ref`

The change is where Mermaid updates go:

- if the current L1.5 boundary has no target, do not update a canvas
- if the boundary targets a task, update that task's `.mmd` file

Each task canvas should contain enough information to support later recall and ref lookup:

- task label or goal
- ordered task/tool nodes
- `node_id` in visible labels or metadata
- `result_ref` edge when a raw ref exists

Legacy per-chat canvas files should remain readable if present, but new writes should use task-scoped paths.

## L4 skill generation

L4 is user-triggered skill synthesis from a selected task canvas. It is not an always-on background stage.

TencentDB's reference flow uses `/create-skill <mmdName> [skillFocus...]`, then:

1. finds the requested MMD file
2. reads the Mermaid content
3. extracts node ids from the MMD
4. filters offload entries down to node-linked evidence
5. calls `l4Generate({ mmdFilename, mmdContent, offloadEntries, skillFocus })`
6. writes `skills/<skillName>/SKILL.md`
7. injects a result block back into context

This project should adapt the same data flow, but with project-owned storage and review-first output.

### Trigger surface

Do not add a public Telegram slash command for L4. The public Telegram surface should stay `/start`, `/menu`, and `/help`.

L4 should be exposed through a menu/conversation flow and optionally an internal local tool later:

- choose a task canvas
- optionally enter a skill focus
- generate a draft skill
- show the generated file path and summary
- ask the user to review before any export/install action

### L4 request and response

Use a local request shape equivalent to TencentDB:

```ts
type L4Request = {
  taskId: string;
  mmdFilename: string;
  mmdContent: string;
  offloadEntries: Array<{
    nodeId: string;
    toolName?: string;
    args: Record<string, unknown>;
    summary: string;
    resultRef?: string;
    createdAt: string;
  }>;
  skillFocus: string | null;
};

type L4Response = {
  skillName: string;
  skillDescription: string;
  skillContent: string;
};
```

The implementation should use the existing configured `LlmProvider` and local prompts rather than requiring a backend endpoint.

### Generated skill quality requirements

Because L4 produces skills, generated output must follow skill-authoring constraints:

- `skillName` uses letters, numbers, and hyphens only.
- `skillContent` is a complete `SKILL.md` with YAML frontmatter.
- frontmatter includes `name` and `description`.
- description starts with `Use when...` and describes triggering conditions, not the workflow summary.
- generated content must be reusable and not just a narrative summary of the completed task.
- generated content must include enough evidence-grounded technique or workflow detail to be useful later.
- generated content should not include secrets, raw private logs, API keys, chat ids, user ids, or excessive raw transcripts.

The generated artifact is a draft. The system should not claim it is a verified production skill until it has been reviewed. Full TDD-style pressure testing of generated skills can be a later export/deployment workflow, but the first L4 milestone must at least validate structure, frontmatter, naming, traceability, and privacy.

### L4 traceability

Each generated skill should store:

- source task id
- source MMD filename/path
- selected node ids
- selected offload entry ids or node ids
- skill focus
- generated file path

This preserves the path:

```text
draft skill -> selected task canvas -> selected node ids -> offload refs -> raw evidence
```

## Recall behavior

For the first milestone, recall only needs to include the active task canvas for the chat.

If no active task exists, recall may omit task canvas context. Historical task-canvas search can be added later, but it is not required for the first implementation.

Existing tools should continue to work:

- `tdai_memory_search` can show the active Mermaid canvas
- `tdai_context_ref_read` can read raw offload refs by `node_id` or `result_ref`
- `tdai_memory_status` should report task-canvas state and generated skill draft counts clearly

## Current datetime tool fix

The log evidence shows `tdai_current_datetime` returns an ISO timestamp, Unix timestamp, local readable datetime, timezone, and offset, but it does not return the weekday. The model then inferred the weekday from a numeric date and produced the wrong Indonesian day name.

Fix the tool contract so the model never has to infer the weekday. `currentDateTimeSnapshot` should return at least:

- `iso_timestamp`
- `unix_timestamp`
- `timezone`
- `offset_minutes`
- `locale`
- `local_date`
- `local_time`
- `weekday_local`, such as `Senin`
- `weekday_en`, such as `Monday`
- `iso_weekday`, where Monday is `1` and Sunday is `7`
- `readable_local_datetime`, including the localized weekday

The implementation should format values using configured `APP_TIMEZONE` and `APP_LOCALE`, not implicit host defaults. Tests should pin `2026-05-17T18:14:45.815Z` with `Asia/Jakarta` and assert the local weekday is Monday/Senin for `2026-05-18 01:14`.

## Failure behavior

Failure should prefer missing canvas updates over polluted canvases.

- If L1.5 cannot judge, record a safe fallback and do not assign nodes to a long-task canvas.
- If canvas file writing fails, keep offload metadata consistent with the existing safe-degradation behavior.
- If LLM JSON is malformed, do not advance to a new task canvas based on partial output.
- If L4 generation fails, do not create a partial skill record unless the written file and metadata can be kept consistent.
- If L4 output fails validation, save the failure reason or return it to the user, but do not mark the generated skill as a draft.

## Testing

Add tests for:

- config parsing exposes L1.5 defaults and environment overrides
- config parsing exposes L4 defaults and environment overrides
- config parsing exposes `APP_TIMEZONE` and `APP_LOCALE` defaults and overrides
- `tdai_current_datetime` returns weekday, locale, local date, local time, and ISO weekday using configured timezone/locale
- short/casual messages do not create or update task canvases
- tool-assisted one-shot QA, such as current day/time lookup, does not create or update task canvases
- new long-task messages create a task canvas with a stable label
- continuation messages keep the active task
- continuation messages can reactivate an older task
- completion messages mark the active task completed
- malformed LLM JSON falls back safely without canvas pollution
- offloaded tool results remain readable by `node_id` and `result_ref`
- L4 selects evidence by task canvas node ids rather than all chat history
- L4 writes a draft `SKILL.md` under the configured project skills directory
- L4 rejects invalid skill names, missing frontmatter, missing `Use when...` descriptions, and outputs containing obvious secrets or raw chat/user ids
- generated skill records preserve source task id, MMD path, node ids, and offload evidence ids
- memory status reports active task-canvas state and generated skill draft counts

## Migration

Use a forward-only, non-destructive migration.

- Add new task-canvas, judgment/boundary, and generated-skill storage.
- Keep existing tables and files.
- Leave legacy per-chat canvas files in place.
- Write new task-scoped canvases going forward.
- Write generated draft skills under the configured project skills directory going forward.

## Implementation sequencing

1. Add config parsing for `APP_TIMEZONE`, `APP_LOCALE`, L1.5 settings, L4 settings, task canvas directory, and generated skills directory.
2. Fix `currentDateTimeSnapshot` / `tdai_current_datetime` to return explicit weekday and configured timezone/locale formatting.
3. Add offload pipeline types for L1 evidence entries, L1.5 judgments, task canvases, L2 canvas routing, and L4 generated skills.
4. Add SQLite schema and backend methods for task canvases, judgments, boundaries, task-node task ids, and generated skill records.
5. Implement deterministic L1.5 rules.
6. Implement LLM-backed L1.5 fallback with strict JSON parsing.
7. Wire L1.5 into the agent turn flow before tool-result canvas updates.
8. Update `OffloadService` to write task-scoped canvases based on active boundaries.
9. Implement L4 prompt, response parser, structural validation, privacy checks, draft skill file writing, and generated skill metadata.
10. Add a Telegram menu/conversation flow for selecting a task canvas and generating a draft skill with optional focus.
11. Update recall/status output for active task canvases and generated skill draft counts.
12. Add tests for config, datetime output, judgment, transitions, canvas routing, L4 evidence selection, skill validation, and safe failure paths.
