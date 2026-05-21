# Core Prompt Detail Expansion Design

**Date:** 2026-05-20  
**Status:** Draft for user review  
**Target project:** `D:\Code\Test\yunus\grammy`

## Goal

Rewrite the four core prompt builders so they are much more explicit, better organized, and easier to maintain, while preserving the current runtime behavior and product semantics.

In scope:

- `src/agent/prompts/system.ts`
- `src/memory/prompts/l1.ts`
- `src/memory/prompts/l2.ts`
- `src/memory/prompts/l3.ts`

The rewrite should make the prompts more detailed and reliable without changing which runtime paths consume them, how those paths are wired, or what the bot fundamentally does.

## User-approved direction

The conversation established these constraints:

- enhance **all core prompts**, not just the agent prompt
- use **maximum detail** rather than minimal cleanup
- preserve current behavior and capabilities; this is a **clarity/detail rewrite**, not a product-behavior redesign
- use a **structured expansion** approach for the agent prompt
- use **structured expansion plus small examples** for the L1/L2/L3 memory prompts

## Non-goals

- Do not change `runReactAgent()` orchestration.
- Do not change the L1/L2/L3 pipeline flow.
- Do not change tool availability, scheduling gates, or memory recall wiring.
- Do not rewrite prompt constructors outside the four core builders.
- Do not redesign L1.5 or L4 prompt behavior as part of this task.
- Do not introduce dynamic prompt composition, external prompt files, or config-driven prompt loading.
- Do not change Telegram UX, commands, menus, or service behavior.

## Existing prompt surfaces

### Core prompt builders

The current core prompt builders are:

- `buildAgentSystemPrompt()` in `src/agent/prompts/system.ts:1-34`
- `buildL1SystemPrompt()` in `src/memory/prompts/l1.ts:1-10`
- `buildL2SystemPrompt()` in `src/memory/prompts/l2.ts:1-8`
- `buildL3SystemPrompt()` in `src/memory/prompts/l3.ts:1-8`

These are currently short, compact prompt strings. They express the right broad intent, but much of the operational detail is compressed into single lines or dense paragraphs.

### Current runtime consumers

The rewrite must preserve the current consumer boundaries:

- `runReactAgent()` loads `buildAgentSystemPrompt()` into the first system message, then injects the layered memory snapshot as a separate system message.
  - **Provenance:** `src/agent/react-agent.ts:156-162`
- `runL1Pipeline()` sends `buildL1SystemPrompt()` plus a transcript-derived user message.
  - **Provenance:** `src/memory/pipeline/l1.ts:121-138`
- `runL2Pipeline()` sends `buildL2SystemPrompt()` plus an atom digest user message.
  - **Provenance:** `src/memory/pipeline/l2.ts:36-53`
- `runL3Pipeline()` sends `buildL3SystemPrompt()` plus `scenario_id` and scenario markdown.
  - **Provenance:** `src/memory/pipeline/l3.ts:27-41`

The design should not change these call sites.

## Current-state constraints the rewrite must preserve

### Agent prompt runtime facts

The current agent prompt already establishes several important runtime truths that must remain explicit after the rewrite:

- the runtime is a Telegram AI agent on grammY with a project-owned memory backend
- the public Telegram commands are `/start`, `/menu`, and `/help`
- Memory Update is the Telegram feature for durable memory changes
- `tdai_current_datetime` is the source of accurate current time information
- `tdai_create_job` is the scheduling/reminder tool
- hybrid scheduled jobs send fixed text first and then run the agent prompt
- `max_runs` defaults to `1` unless repeated runs are explicitly requested
- L1.5, task-aware recall, task canvases, refs, and L4 draft skills exist as part of the working-context/offload model
- replies must remain concise and the agent must not expose hidden chain-of-thought

**Provenance:** `src/agent/prompts/system.ts:1-34`, `tests/runtime/agent-prompt.test.ts:16-34`

### L1 contract constraints

The L1 prompt must continue to produce content compatible with the existing parser and pipeline expectations.

The pipeline currently expects a JSON array response and treats non-array or non-JSON output as malformed:

- extraction item shape: `text`, optional `importance`, optional `source_turn_ids`
- parser accepts fenced JSON or a bracketed JSON array
- non-array output becomes malformed and produces no extracted atoms

**Provenance:** `src/memory/pipeline/l1.ts:9-18`, `src/memory/pipeline/l1.ts:20-38`, `src/memory/pipeline/l1.ts:140-143`

This means the rewrite can clarify the contract, but it must not loosen the output format.

### L2 and L3 output constraints

The L2 and L3 pipelines currently accept raw model output as markdown content and store it directly.

- L2 prompt requires markdown-only output and evidence preservation
- L3 prompt requires markdown-only output, grounding in scenario/atom references when possible, and no invented facts or sensitive inference

**Provenance:** `src/memory/prompts/l2.ts:1-8`, `src/memory/prompts/l3.ts:1-8`, `src/memory/pipeline/l2.ts:47-58`, `src/memory/pipeline/l3.ts:35-49`

The rewrite should make these grounding rules more explicit without introducing a brittle output format that would amount to a behavior redesign.

## Problem statement

The current prompts are directionally correct, but they have three practical weaknesses:

1. **Compressed instructions** — important rules are packed into short lines, which makes priorities and boundaries less obvious.
2. **Weak output contracts** — L1 has the strongest explicit format contract, while L2/L3 rely on relatively sparse wording.
3. **Low maintainability under growth** — as the runtime gains more concepts, a flat or compact prompt becomes harder to reason about and easier to break with small wording changes.

The goal of this rewrite is to improve precision and readability, not to expand scope.

## Chosen approach

Use a **sectioned prompt architecture** across all four builders.

Each prompt will be rewritten to make these layers explicit:

1. role / identity
2. objective
3. required operating rules
4. boundaries / exclusions
5. output contract
6. examples where they materially reduce ambiguity

This is preferred over a full behavior redesign because the runtime already has the right shape. The main problem is that the prompts are underspecified relative to the complexity of the runtime that consumes them.

## Prompt-by-prompt design

### 1. Agent prompt redesign

File: `src/agent/prompts/system.ts`

#### Purpose

Turn the current dense runtime prompt into a clearly sectioned operating guide for the Telegram agent while preserving the same hierarchy of rules.

#### Required sections

1. **Role and runtime context**
   - identify the agent as a Telegram AI agent running on grammY
   - state that it has built-in local tools and a project-owned memory backend

2. **Interaction surface**
   - restate that public commands are `/start`, `/menu`, and `/help`
   - restate that Memory Update is the durable-memory workflow in Telegram

3. **Operating workflow**
   - preserve the current ReAct-style loop as ordered guidance
   - keep memory recall before action/tool use
   - keep tool choice as a deliberate decision rather than a default reflex

4. **Memory model**
   - preserve the durable layers: L0, L1, L2, L3
   - preserve the working-context/offload concepts: L1 evidence summaries, L1.5, task canvases, refs, and L4 draft skills
   - keep the distinction between durable memory and short-term context support explicit

5. **Tool-use rules**
   - prefer tools for fresh, private, or actionable data
   - use `tdai_current_datetime` for time-sensitive reasoning instead of guessing
   - use `tdai_create_job` for reminders and scheduled tasks
   - restate the hybrid-job behavior and `max_runs` default

6. **Response style rules**
   - answer in the user’s language
   - keep replies concise, practical, and not too long
   - do not reveal hidden chain-of-thought

7. **Hard constraints / failure behavior**
   - recover from tool failures when possible
   - otherwise explain the limitation clearly

#### Design notes

- The rewrite should keep this prompt **descriptive but not example-heavy**.
- The agent prompt already carries substantial runtime context; adding too many embedded examples would increase length without a proportional reliability gain.
- The important improvement here is explicit grouping and clearer priority wording.

#### Provenance

- current agent prompt content: `src/agent/prompts/system.ts:1-34`
- agent consumer boundary: `src/agent/react-agent.ts:156-172`
- current prompt assertions: `tests/runtime/agent-prompt.test.ts:16-34`

### 2. L1 prompt redesign

File: `src/memory/prompts/l1.ts`

#### Purpose

Make the durable-memory extraction contract much more explicit so the model is less likely to emit transient chat, duplicate facts, or malformed output.

#### Required sections

1. **Role**
   - identify the model as the L1 extractor for the project-owned memory pipeline

2. **Extraction objective**
   - extract durable, atomic memory items from conversation turns
   - emphasize stable preferences, constraints, project context, decisions, and reusable workflow facts

3. **What to keep**
   - stable user preferences
   - stable project facts
   - recurring constraints
   - durable decisions
   - reusable workflow instructions

4. **What to exclude**
   - transient chit-chat
   - duplicates
   - secrets
   - one-off noisy details that do not belong in durable memory

5. **Normalization and dedupe rules**
   - prefer stable wording
   - collapse multiple phrasings of the same fact into one item
   - keep atomic entries rather than blended summaries

6. **Output contract**
   - return only a JSON array
   - each item must match the expected shape
   - keep `importance` in the existing `1-5` scale
   - include `source_turn_ids` when supported by the evidence

7. **Examples**
   - one small positive example
   - one small negative or “do not extract” example

#### Design notes

- Examples are valuable here because L1 has the strictest parsing contract and the biggest risk of malformed output.
- The examples should teach boundaries, not redefine the runtime semantics.
- The prompt should remain strict about returning only JSON.

#### Provenance

- current L1 prompt: `src/memory/prompts/l1.ts:1-10`
- extraction item shape and parser contract: `src/memory/pipeline/l1.ts:9-38`
- L1 pipeline consumer path: `src/memory/pipeline/l1.ts:121-143`

### 3. L2 prompt redesign

File: `src/memory/prompts/l2.ts`

#### Purpose

Clarify that L2 is a grounded scenario-aggregation stage, not a freeform summarizer.

#### Required sections

1. **Role**
   - identify the model as the L2 scenario aggregator

2. **Objective**
   - group related L1 atoms into a concise scenario snapshot

3. **Grounding rules**
   - preserve `atom_id` evidence references
   - do not invent facts that are not supported by the supplied atoms
   - summarize only what the atom set supports

4. **Output expectations**
   - return markdown only
   - favor concise, readable scenario output
   - keep the result grounded rather than expansive

5. **Example**
   - include one small grounded markdown example that shows evidence-aware summarization

#### Design notes

- L2 should gain stronger grounding language, but it should **not** be forced into a brittle hardcoded template.
- The output needs to stay readable markdown because later stages consume scenario text as content, not as a rigid schema.
- The rewrite should improve consistency without turning L2 into a format migration.

#### Provenance

- current L2 prompt: `src/memory/prompts/l2.ts:1-8`
- L2 pipeline consumer path: `src/memory/pipeline/l2.ts:36-58`

### 4. L3 prompt redesign

File: `src/memory/prompts/l3.ts`

#### Purpose

Clarify that L3 produces a compact, agent-facing persona/profile distillation grounded in scenario evidence, not a speculative personality writeup.

#### Required sections

1. **Role**
   - identify the model as the L3 persona/profile distiller

2. **Objective**
   - create or update a concise agent-facing profile from L2 scenarios

3. **Grounding rules**
   - ground bullets in `scenario_id` and `atom_id` references when possible
   - prefer stable statements that the agent can reuse later
   - do not invent facts
   - do not infer sensitive attributes

4. **Output expectations**
   - return markdown only
   - favor compact bullet-driven profile output
   - preserve the idea that this is operational profile context, not prose biography

5. **Example**
   - include one small acceptable grounded bullet example

#### Design notes

- L3 benefits from examples because its failures are often about over-inference rather than malformed syntax.
- The rewrite should strengthen safety and evidence discipline more than it changes formatting.
- As with L2, the design should avoid imposing a needlessly rigid markdown schema.

#### Provenance

- current L3 prompt: `src/memory/prompts/l3.ts:1-8`
- L3 pipeline consumer path: `src/memory/pipeline/l3.ts:27-49`

## Maintainability guidelines for the implementation

The expanded prompts should be easier to evolve than the current compact versions.

Implementation should therefore favor:

- visible internal section boundaries inside the prompt text
- grouped rules rather than one large paragraph
- explicit output contracts near the end of each prompt
- examples only where they pay for their added length

The rewrite should **not** create prompt indirection or abstraction layers that are larger than the problem.

## Verification plan

### Existing coverage to preserve

There is already a runtime test that checks that:

- the shared agent system prompt builder is used
- the agent prompt still contains core runtime concepts

**Provenance:** `tests/runtime/agent-prompt.test.ts:8-34`

### Verification changes required by this design

1. Update the existing agent prompt test so it continues to assert the important runtime guarantees after the rewrite.
2. Add focused tests for the L1, L2, and L3 prompt builders.
3. Verify that the prompt text still states the required output contracts:
   - L1: strict JSON array items with the expected fields
   - L2: markdown-only, grounded scenario aggregation
   - L3: markdown-only, grounded persona/profile distillation with anti-invention rules
4. Run the existing automated checks relevant to a prompt-only code change.

### Verification intent

The purpose of the tests is not to freeze exact wording. The purpose is to ensure that the rewritten prompts still communicate the critical operational guarantees the runtime depends on.

## Success criteria

This design is successful when:

- the four core prompt builders are noticeably more explicit and easier to read
- the agent prompt is better structured without changing runtime behavior
- the L1 prompt is stricter and clearer about durable extraction boundaries and JSON output
- the L2 prompt is clearer about grounded scenario synthesis
- the L3 prompt is clearer about grounded persona distillation and anti-inference limits
- runtime wiring remains unchanged
- tests cover the preserved behavioral contracts of the rewritten prompts

## Out-of-scope prompt surfaces

These prompt-related areas were discovered during exploration but are not part of this rewrite unless requested later:

- L1.5 task judgment prompt in `src/memory/offload/l15.ts:157-179`
- L4 draft-skill generation prompt in `src/memory/offload/l4.ts:138-161`

They should remain unchanged in this task.
