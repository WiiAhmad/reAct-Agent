# TencentDB Agent Memory: what `L1.5` and `L4` really mean in this repo

This note explains the real layer model used in **TencentDB-Agent-Memory**, with special focus on **`L1.5`** and **`L4`**.

It is grounded in the implementation under `src/offload/*`, not just in README wording.

---

## Big picture

This repo contains **two related but different pipelines**:

1. **Long-term memory pipeline**
   - `L0 -> L1 -> L2 -> L3`
2. **Context offload / task-canvas pipeline**
   - `L1 -> L1.5 -> L2 -> L4`

These two pipelines interact, but they do **not** mean the same thing.

- The **long-term memory pipeline** is about storing and recalling durable knowledge across sessions.
- The **offload pipeline** is about compressing active long-running work into a structured task representation that an agent can keep using inside the current workflow.

That distinction is the most important thing to understand before judging `L1.5` and `L4`.

---

## Pipeline A: Long-term memory (`L0 -> L1 -> L2 -> L3`)

## 1) `L0` — raw conversation capture

`L0` is the evidence layer.

What happens here:
- conversation events are captured as raw records
- content is buffered per session
- nothing is abstracted yet
- no durable memory judgment is made yet

So `L0` means:

> Save the raw interaction first.

---

## 2) `L1` — memory extraction

`L1` transforms raw conversation into structured memory items.

Typical work at this layer:
- read recent `L0` messages
- group them by session or context
- run extraction with an LLM
- deduplicate / resolve conflicts
- write atomic memory records

These memories include things such as:
- persona-related facts
- episodic facts
- instructions / preferences

So `L1` means:

> Pull durable memory facts out of raw dialogue.

---

## 3) `L2` — scenario / scene layer

`L2` is the scenario aggregation layer.

Instead of keeping only isolated facts, the system groups related memory into larger scene blocks that are easier to inspect and reason over.

So `L2` means:

> Organize related memories into scenario-level structure.

---

## 4) `L3` — persona / high-level abstraction

`L3` is the top layer of long-term memory.

This layer summarizes higher-order user characteristics such as:
- preferences
- work style
- recurring goals
- long-term background

So `L3` means:

> Build a stable user profile from repeated memory patterns.

---

## Summary of the long-term pipeline

- `L0` = raw conversation
- `L1` = extracted memory facts
- `L2` = scenario / scene organization
- `L3` = persona / long-term abstraction

This is the **memory pyramid** described in the repo docs.

---

## Pipeline B: context offload (`L1 -> L1.5 -> L2 -> L4`)

This second pipeline is different.

It is not mainly about user memory across sessions. It is about **active task compression** for long-running coding or tool-heavy work.

The repo uses:
- offloaded verbose logs
- structured offload entries
- Mermaid task canvases (`.mmd`)
- `node_id` traceability back to raw evidence

This pipeline is where `L1.5` and `L4` live.

---

## 5) Offload `L1` — summarize active work into entries

In the offload system, `L1` is not the same as long-term-memory `L1`.

Here it means:
- summarize tool-call history or recent work
- produce structured offload entries
- keep the evidence available for later drill-down
- prepare data for task attribution and MMD generation

At this point, entries may still have `node_id = null` because they have not yet been attached to a concrete Mermaid node.

So offload `L1` means:

> Convert active verbose work into structured task evidence.

---

## 6) `L1.5` — task judgment / task boundary decision

This is the key layer for understanding the offload pipeline.

`L1.5` is **not** skill generation.
`L1.5` is **not** long-term memory extraction.
`L1.5` is **not** final task summarization.

`L1.5` is the layer that decides:
- whether the current thing is a long task or casual / short interaction
- whether the current thing is a continuation of an existing task
- whether the current active task is already completed
- whether to reactivate an old Mermaid task file
- whether to create a new Mermaid task file

In short:

> `L1.5` decides which task canvas this interaction belongs to.

### The actual `TaskJudgment` shape

In code, the result is represented as:

```ts
interface TaskJudgment {
  taskCompleted: boolean;
  isContinuation: boolean;
  continuationMmdFile?: string;
  newTaskLabel?: string;
  isLongTask: boolean;
}
```

That tells us exactly what `L1.5` is responsible for:
- completion judgment
- continuation judgment
- long-task judgment
- naming a new task when needed
- choosing the prior MMD file when continuing

### The `L15Boundary` role

The repo also defines:

```ts
interface L15Boundary {
  startIndex: number;
  result: "long" | "short" | "pending";
  targetMmd: string | null;
}
```

This means `L1.5` does not just classify a turn. It creates a **boundary** that tells the system how later offload entries should be attributed.

### What inputs `L1.5` uses

The L1.5 prompt builder shows that judgment is based on three sources:

1. `recentMessages`
2. `currentMmd`
3. `availableMmds`

The intended reasoning flow is:
- infer the user’s newest intent from recent conversation
- compare that intent against the currently active Mermaid task canvas
- look through available past Mermaid task files to see whether the new request is really a continuation of an old task

So `L1.5` is fundamentally a **task lifecycle router**.

### What runtime action `L1.5` triggers

After the judgment is returned, the runtime may:
- create a new MMD file
- reactivate an existing MMD file
- clear the active MMD if the interaction is casual / short

It then:
- pushes an `L15Boundary`
- marks the active MMD target
- sets `l15Settled = true`
- allows MMD injection to proceed

That is why `L1.5` is not optional bookkeeping. It is a **gate** for downstream behavior.

### What `L1.5` is not

It is important not to over-interpret this layer.

`L1.5` does **not**:
- generate a reusable skill
- write `SKILL.md`
- create the final Mermaid structure itself
- do high-level persona abstraction

It only answers:

> What task is this, and where should the next evidence go?

---

## 7) Offload `L2` — Mermaid task canvas generation

Once `L1.5` has settled the task boundary, `L2` can build or update the Mermaid task canvas.

This is the layer that:
- takes the chosen task target
- consumes the new attributed entries
- updates or creates the `.mmd` file
- maps evidence into Mermaid nodes
- preserves traceability through `node_id`

So offload `L2` means:

> Construct the readable task graph that represents the current long-running work.

A critical implementation detail is that **L2 waits for L1.5**.
The scheduler explicitly defers `L2` work until `l15Settled` is true.

That makes the control flow:
1. summarize entries
2. judge task ownership with `L1.5`
3. only then update the Mermaid canvas with `L2`

---

## 8) `L4` — skill generation from grounded task evidence

`L4` is not another memory tier like `L0` to `L3`.

In this repo, `L4` is best understood as:

> A skill-generation layer built on top of an already-structured task canvas and its supporting evidence.

The request and response types make this explicit:

```ts
interface L4Request {
  mmdFilename: string;
  mmdContent: string;
  offloadEntries: OffloadEntry[];
  skillFocus: string | null;
}

interface L4Response {
  skillName: string;
  skillDescription: string;
  skillContent: string;
}
```

This is very different from `L1.5`.

`L4` does not decide task continuity. Instead, it takes:
- a selected Mermaid task file
- the relevant filtered offload evidence
- an optional focus instruction

and turns that into:
- a skill name
- a skill description
- a generated `SKILL.md` body

### How `L4` is triggered

`L4` is not an always-on background stage.
It is triggered by a user command pattern:

```text
/create-skill <mmdName> [skillFocus...]
```

The command parser extracts:
- the target MMD name
- optional focus text

Then the runtime:
1. finds the requested MMD file
2. reads its Mermaid content
3. extracts all `node_id`s from that MMD
4. filters offload entries down to those node-linked records
5. sends the bundle to backend `l4Generate(...)`
6. writes the returned content to `skills/<skillName>/SKILL.md`
7. injects a result block back into system context

So `L4` is best viewed as:

> grounded skill synthesis from a completed or selected task graph.

### Why `L4` is different from plain summarization

A normal summary just compresses text.

`L4` is stronger than that because it tries to produce a **reusable operational artifact**:
- a named skill
- with a description
- with actual skill content
- grounded in task evidence selected from the MMD structure

### Important limitation: local mode does not support `L4`

The repo explicitly states in the local LLM implementation:

> `L4 Skill generation is not supported in local mode.`

So today:
- `L1.5` is part of the active offload control flow
- `L4` exists as a backend-powered capability
- `L4` is not fully implemented for local-only execution

That matters when judging maturity.

---

## Relationship between `L1.5` and `L4`

The clean mental model is:

- `L1.5` = **task judgment**
- `L2` = **task graph construction**
- `L4` = **skill synthesis from the task graph**

Another way to say it:

- `L1.5` answers: **Which task is this?**
- `L4` answers: **Can this task history become a reusable skill?**

So if you confuse `L1.5` with `L4`, you will judge the system incorrectly.

---

## How to judge `L1.5` and `L4` for skills

If the goal is to evaluate skill-related maturity, `L1.5` and `L4` should be judged on **different dimensions**.

## A) How to judge `L1.5`

`L1.5` should be judged as a **classification and routing layer**.

Good evaluation criteria:

### 1. Long-task detection quality
Can it correctly distinguish:
- long engineering work
- short QA / casual chat
- task-like but one-shot interactions

### 2. Continuation detection quality
Can it correctly decide whether the current request belongs to:
- the currently active task
- a previous historical task
- a completely new task

### 3. Completion judgment quality
Can it correctly infer whether the current active task is:
- finished
- still ongoing
- context-switched but not truly completed

### 4. Task label quality
When a new task is needed, does `newTaskLabel` become:
- short
- stable
- reusable
- semantically correct

### 5. False split / false merge rate
Two common failure modes:
- **false split**: one continuous task gets broken into multiple MMDs
- **false merge**: unrelated tasks get forced into one MMD

This is one of the most important signals for L1.5 quality.

### 6. Downstream usefulness
Even if the JSON is technically valid, the real question is:

> Did the L1.5 output make downstream `L2` construction and MMD reuse better?

That is the practical evaluation standard.

## B) How to judge `L4`

`L4` should be judged as a **grounded skill-generation layer**.

Good evaluation criteria:

### 1. Evidence grounding
Does the generated skill clearly come from:
- the selected MMD
- the filtered node-linked offload entries
- real task evidence rather than generic boilerplate

### 2. Correct abstraction level
A good `L4` skill should be:
- more reusable than the original raw session
- not so abstract that it becomes vague or empty
- not so specific that it only fits one past task

### 3. Skill structure quality
The returned artifact should have:
- a good `skillName`
- a usable `skillDescription`
- coherent `skillContent`
- a format that can actually be saved as `SKILL.md`

### 4. Reusability
Can another future agent use the generated skill on a similar task?
If not, then the output is only a summary, not a real skill.

### 5. Traceability
Can you explain where the skill came from?
In this repo, strong `L4` quality should preserve the path:
- generated skill
- selected MMD
- selected node IDs
- filtered offload entries
- raw underlying evidence

### 6. Backend dependency awareness
Because local mode does not support `L4`, maturity judgment should distinguish:
- **conceptual design quality**
- **backend implementation quality**
- **local availability**

A system can have a good `L4` design but still be only partially deployed in practice.

---

## Practical distinction: `L1.5` vs `L4`

A simple rule:

- If the question is **"Which task should this belong to?"**, that is `L1.5`.
- If the question is **"Can this finished task history be turned into a reusable skill?"**, that is `L4`.

Another short analogy:

- `L1.5` = choose the correct notebook
- `L2` = write the notebook page
- `L4` = turn the notebook page into a reusable operating manual

---

## Code evidence worth reading

If you want to verify the interpretation directly in code, the most important files are:

- `src/offload/types.ts`
  - `TaskJudgment`
  - `L15Boundary`
- `src/offload/local-llm/prompts/l15-prompt.ts`
  - L1.5 judgment prompt and input structure
- `src/offload/hooks/before-agent-start.ts`
  - task transition behavior after L1.5
- `src/offload/index.ts`
  - L1.5 orchestration, L2 gating, `/create-skill`, L4 result injection
- `src/offload/backend-client.ts`
  - `L4Request`, `L4Response`, backend `l4Generate()`
- `src/offload/local-llm/index.ts`
  - explicit note that local mode does not support `L4`

---

## Final conclusion

The most accurate interpretation of this repo today is:

- `L0 -> L3` is the **long-term memory pyramid**
- `L1 -> L1.5 -> L2 -> L4` is the **context-offload / task-structuring pipeline**
- `L1.5` is a **task lifecycle judgment layer**
- `L4` is a **backend-powered skill generation layer built from task-graph evidence**

So for any evaluation related to skills:
- judge **`L1.5`** on task routing, continuity, completion, and boundary quality
- judge **`L4`** on skill synthesis quality, grounding, abstraction, and reusability

That separation is the correct basis for judging the system.