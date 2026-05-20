# Memory

This document explains the memory runtime boundaries for contributors.

The most important rule is that the runtime has two parallel systems with different purposes:

- **durable memory** for long-lived semantic understanding
- **task/context offload** for operational working context during long or noisy tasks

## Protected boundary

The durable semantic meanings of L0, L1, L2, and L3 are protected. Future runtime changes may evolve storage, recall, or offload mechanics around those layers, but they should not casually redefine the durable model.

## Core mental model

```text
conversation + tool activity
├─ durable memory path
│  └─ L0 conversations -> L1 atoms -> L2 scenarios -> L3 persona
└─ task/context offload path
   └─ L1 evidence -> L1.5 task judgment -> task canvas + refs -> task-aware recall -> optional L4 draft skills
```

These are parallel systems with different jobs, not one long numbered ladder.

## Durable memory layers

### L0 conversations

L0 is the conversation-evidence layer. It preserves transcript-level history that later durable layers can build from.

### L1 atoms

L1 atoms are durable extracted memory units such as stable facts, preferences, constraints, and decisions worth carrying forward.

### L2 scenarios

L2 scenarios group durable meaning into higher-level contextual clusters rather than isolated facts.

### L3 persona

L3 persona is the most distilled durable layer. It captures the slowest-changing high-level understanding of the user and their working patterns.

The durable maintenance path is:

`L0 conversation evidence -> L1 atoms -> L2 scenarios -> L3 persona`

Memory Update maintains this path asynchronously. It is not the owner of inline task continuity.

## Task/context offload layers

### L1 evidence

L1 evidence is the compact operational summary layer for tool and interaction results. It carries forward progress, blockers, verification signals, and key findings for task continuity.

This is not the same thing as durable L1 atoms. L1 evidence is about keeping active work legible while a task is still unfolding.

### L1.5 task judgment

L1.5 is a task routing layer. It decides whether a turn starts, continues, completes, or avoids task-scoped context.

This is control logic, not a durable semantic layer.

### Task canvases

Task canvases are structured task-scoped working summaries used for continuity and recall. They are not the same thing as durable L2 scenarios.

A task canvas exists to preserve working structure for an active or historical task, not to redefine durable long-term meaning.

### Refs

Refs store raw offloaded detail when a tool result is too heavy to keep inline.

Not every tool result becomes a ref. Smaller results can still produce L1 evidence or task-canvas updates without needing a separate raw-output file.

### L4 draft skills

L4 draft skills are user-triggered, project-local draft artifacts derived from task context. They are not automatically installed runtime behavior.

## Timing model

- task/context offload happens inline during active work
- durable memory maintenance happens later through Memory Update

This is the difference between operational continuity now and semantic consolidation later.

## Worked example

1. a user starts a longer investigation
2. the agent runs tools
3. tool results produce L1 evidence
4. L1.5 decides whether the turn belongs to a long-running task
5. the runtime creates or updates a task canvas when appropriate
6. large tool output is stored as refs while the canvas keeps a compact summary
7. task-aware recall can later inject active or historical task canvases back into context
8. Memory Update later distills durable long-term meaning into L1 atoms, L2 scenarios, and L3 persona

## Canonical history, indexes, refs, and canvases

- per-chat JSONL history is the canonical transcript record
- SQLite stores structured indexes, memory state, task state, and recall-related records
- refs store heavy raw output
- task canvases store structured task summaries
- generated draft skills are reviewable artifacts derived from task context

## Recall behavior

Recall can combine:

- durable persona
- durable scenarios
- durable atoms
- relevant conversation evidence
- the active task canvas
- relevant historical task canvases

That means recall is not only a long-term-memory lookup. It can combine durable semantic memory with active or historical task context when a query needs both.

## Memory Update workflow

Memory Update is the Telegram-managed durable-memory maintenance workflow. It can run on demand or on a per-user schedule, and it is responsible for refreshing durable L0/L1/L2/L3 outputs.

When triggered from Telegram, it runs asynchronously and can emit progress or final result messages back to the chat.

## Per-user scheduling semantics

Memory Update scheduling is stored per user and supports `interval` and `cron` modes.

New users default to enabled Memory Update with a 24-hour interval.

## Contributor invariants

- durable L0/L1/L2/L3 semantics are protected
- L1 atoms are not the same thing as L1 evidence
- durable L2 scenarios are not the same thing as task canvases
- L1.5 is a routing layer, not a durable semantic layer
- refs hold raw detail, not the primary summary
- Memory Update maintains durable memory, not task continuity semantics
- L4 draft skills remain drafts until explicitly handled by the user

## Relevant code

- `src/memory/integration/factory.ts`
- `src/memory/core/service.ts`
- `src/memory/recall/service.ts`
- `src/memory/offload/l15.ts`
- `src/agent/react-agent.ts`
- `src/bot/conversations/memory-update-runner.ts`

## Related docs

- `docs/architecture.md`
- `docs/telegram-flow.md`
