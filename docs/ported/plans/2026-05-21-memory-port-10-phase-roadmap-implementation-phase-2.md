# Memory Port Phase 2 — Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the core memory intelligence layer by enriching L1 record shape, adding semantic conflict resolution, and splitting stable versus dynamic recall context.

**Architecture:** Build on Phase 1’s stable inputs and contract by evolving the L1 pipeline in place, introducing focused helpers for semantic dedupe and recall formatting, and keeping the work strictly scoped to extraction, dedupe, and recall behavior.

**Tech Stack:** Bun, TypeScript, bun:test, bun:sqlite, sqlite-vec, project-owned memory services under `src/memory/`

[Previous: Phase 1](2026-05-21-memory-port-10-phase-roadmap-implementation-phase-1.md) | [Back to implementation plan index](2026-05-21-memory-port-10-phase-roadmap-implementation.md) | [Next: Phase 3](2026-05-21-memory-port-10-phase-roadmap-implementation-phase-3.md)

---
## Phase 2 — Intelligence

Covers Workstream 2.1 through Workstream 2.3 from `docs/ported/specs/2026-05-21-memory-port-10-phase-roadmap-design.md`. Execute Task 4 through Task 6 in order before moving to Phase 3.

### Task 4 (Phase 2 / Workstream 2.1): Parse richer L1 extraction records

**Files:**
- Create: `src/memory/pipeline/l1-schema.ts`
- Create: `tests/memory/l1-pipeline-parity.test.ts`
- Modify: `src/memory/pipeline/l1.ts:9-18,77-119,121-194`
- Modify: `src/memory/prompts/l1.ts`
- Test: `tests/memory/l1-pipeline-parity.test.ts`
- Test: `tests/memory/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { migrateSqliteMemory } from "../../src/memory/backends/sqlite/migrate";
import { SqliteMemoryBackend } from "../../src/memory/backends/sqlite/backend";
import { SqliteMemoryStore } from "../../src/memory/backends/sqlite/store";
import { runL1Pipeline } from "../../src/memory/pipeline/l1";

test("runL1Pipeline stores scene and semantic metadata in IMemoryStore", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-l1-parity-"));
  const llm = {
    async complete() {
      return {
        content: JSON.stringify([
          {
            text: "Use Bun for local scripts",
            importance: 6,
            source_turn_ids: [1],
            memory_kind: "instruction",
            scene_name: "runtime",
            source_message_ids: ["msg-1"],
            timestamps: ["2026-05-18T08:00:00.000Z"],
          },
        ]),
        toolCalls: [],
      };
    },
  };

  try {
    const db = new Database(":memory:");
    migrateSqliteMemory(db);
    const backend = new SqliteMemoryBackend(db, {
      dataDir: tempDir,
      refsDir: join(tempDir, "refs"),
      canvasDir: join(tempDir, "canvases"),
    });
    const store = new SqliteMemoryStore(db, { sqliteVecEnabled: false, bm25Enabled: false });
    await store.init();

    await runL1Pipeline(backend, llm as any, "u1", [
      {
        id: 1,
        chatId: "c1",
        userId: "u1",
        role: "user",
        content: "Please use Bun for local scripts.",
        meta: {},
        createdAt: "2026-05-18T08:00:00.000Z",
      },
    ], store);

    const records = await store.queryL1Records({ userId: "u1", type: "L1", limit: 10 });

    expect(records[0]).toEqual(
      expect.objectContaining({
        sceneName: "runtime",
        metadata: expect.objectContaining({
          memoryKind: "instruction",
          sourceMessageIds: ["msg-1"],
          timestamps: ["2026-05-18T08:00:00.000Z"],
        }),
      }),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/memory/l1-pipeline-parity.test.ts`
Expected: FAIL because current `L1Extraction` does not parse `memory_kind`, `scene_name`, `source_message_ids`, or `timestamps`.

- [ ] **Step 3: Write minimal implementation**

`src/memory/pipeline/l1-schema.ts`

```ts
import type { L1MemoryKind } from "../core/store/record-metadata";

export type ParsedL1Extraction = {
  text: string;
  importance?: number;
  source_turn_ids?: number[];
  memory_kind?: L1MemoryKind;
  scene_name?: string;
  source_message_ids?: string[];
  timestamps?: string[];
};

export function normalizeL1Extraction(input: ParsedL1Extraction): ParsedL1Extraction | undefined {
  const text = input.text?.trim();
  if (!text) return undefined;

  return {
    text,
    importance: input.importance,
    source_turn_ids: input.source_turn_ids ?? [],
    memory_kind: input.memory_kind ?? "episodic",
    scene_name: input.scene_name?.trim() || "conversation",
    source_message_ids: [...new Set((input.source_message_ids ?? []).filter(Boolean))],
    timestamps: [...new Set((input.timestamps ?? []).filter(Boolean))],
  };
}
```

`src/memory/pipeline/l1.ts:9-18,77-119,121-194`

```ts
import { buildL1RecordMetadata } from "../core/store/record-metadata";
import { normalizeL1Extraction, type ParsedL1Extraction } from "./l1-schema";

type ParsedExtractions = {
  extractions: ParsedL1Extraction[];
  malformed: boolean;
};

const normalized = normalizeL1Extraction(item);
if (!normalized) continue;

const importance = normalized.importance ?? 3;
const sourceConversationIds = normalized.source_turn_ids ?? [];

const { record, created } = await buildStorePrimaryRecord(
  store,
  userId,
  normalized.text,
  importance,
  sourceConversationIds,
  turns,
  {
    sceneName: normalized.scene_name ?? "conversation",
    memoryKind: normalized.memory_kind ?? "episodic",
    sourceMessageIds: normalized.source_message_ids ?? [],
    timestamps: normalized.timestamps ?? [],
  },
);
```

```ts
async function buildStorePrimaryRecord(
  store: IMemoryStore,
  userId: string,
  text: string,
  importance: number,
  sourceConversationIds: number[],
  turns: ConversationTurn[],
  semantic?: {
    sceneName: string;
    memoryKind: "persona" | "episodic" | "instruction";
    sourceMessageIds: string[];
    timestamps: string[];
  },
): Promise<{ record: L1Record; created: boolean }> {
  // existing canonical matching above stays in place
  return {
    created: !existing,
    record: {
      recordId: existing?.recordId ?? storeRecordId(userId, canonicalText),
      userId,
      sessionKey: existing?.sessionKey ?? `chat:${chatId}`,
      sessionId: existing?.sessionId ?? chatId,
      content: text,
      type: "L1",
      priority: Math.max(existing?.priority ?? 0, importance),
      sceneName: semantic?.sceneName ?? existing?.sceneName ?? "conversation",
      timestampStr: timestampEnd,
      timestampStart,
      timestampEnd,
      sourceConversationIds: mergeNumberSets(existing?.sourceConversationIds ?? [], sourceConversationIds),
      metadata: buildL1RecordMetadata({
        source: "pipeline",
        canonicalText,
        memoryKind: semantic?.memoryKind,
        sourceMessageIds: semantic?.sourceMessageIds,
        timestamps: semantic?.timestamps,
      }),
      createdTime: existing?.createdTime ?? timestampStart,
      updatedTime: timestampEnd,
    },
  };
}
```

`src/memory/prompts/l1.ts`

```ts
Return a JSON array.
Each item must include:
- text
- importance
- source_turn_ids
- memory_kind (persona | episodic | instruction)
- scene_name
- source_message_ids
- timestamps
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/memory/l1-pipeline-parity.test.ts tests/memory/pipeline.test.ts`
Expected: PASS with the new metadata assertion and the existing pipeline tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/memory/pipeline/l1-schema.ts src/memory/pipeline/l1.ts src/memory/prompts/l1.ts tests/memory/l1-pipeline-parity.test.ts
git commit -m "feat: enrich l1 extraction record shape"
```

---

### Task 5 (Phase 2 / Workstream 2.2): Add semantic L1 dedupe decisions

**Files:**
- Create: `src/memory/pipeline/l1-dedupe.ts`
- Create: `src/memory/prompts/l1-dedupe.ts`
- Create: `tests/memory/l1-dedupe.test.ts`
- Modify: `src/memory/pipeline/l1.ts:121-194`
- Test: `tests/memory/l1-dedupe.test.ts`
- Test: `tests/memory/imemory-store-integration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import type { L1Record } from "../../src/memory/core/store/types";
import { resolveL1Conflict } from "../../src/memory/pipeline/l1-dedupe";

test("resolveL1Conflict can choose update for a paraphrased instruction memory", async () => {
  const existing: L1Record = {
    recordId: "store:l1:existing",
    userId: "u1",
    sessionKey: "chat:c1",
    sessionId: "c1",
    content: "Use Bun for local scripts",
    type: "L1",
    priority: 6,
    sceneName: "runtime",
    timestampStr: "2026-05-18T08:00:00.000Z",
    sourceConversationIds: [1],
    metadata: { source: "pipeline", memoryKind: "instruction" },
    createdTime: "2026-05-18T08:00:00.000Z",
    updatedTime: "2026-05-18T08:00:00.000Z",
  };

  const llm = {
    async complete() {
      return {
        content: JSON.stringify({ action: "update", targetRecordId: "store:l1:existing" }),
        toolCalls: [],
      };
    },
  };

  const decision = await resolveL1Conflict({
    llm: llm as any,
    newRecord: {
      ...existing,
      recordId: "store:l1:new",
      content: "Prefer Bun when running local scripts",
      sourceConversationIds: [2],
    },
    candidates: [existing],
  });

  expect(decision).toEqual({ action: "update", targetRecordId: "store:l1:existing" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/memory/l1-dedupe.test.ts`
Expected: FAIL with `Cannot find module '../../src/memory/pipeline/l1-dedupe'`.

- [ ] **Step 3: Write minimal implementation**

`src/memory/prompts/l1-dedupe.ts`

```ts
import type { L1Record } from "../core/store/types";

export function buildL1DedupePrompt(newRecord: L1Record, candidates: L1Record[]) {
  return [
    "You are resolving whether a new memory should be stored, updated, merged, or skipped.",
    "Return strict JSON with shape: {\"action\":\"store\"|\"update\"|\"merge\"|\"skip\",\"targetRecordId\":string|null}.",
    `NEW_RECORD=${JSON.stringify(newRecord)}`,
    `CANDIDATES=${JSON.stringify(candidates)}`,
  ].join("\n\n");
}
```

`src/memory/pipeline/l1-dedupe.ts`

```ts
import type { LlmProvider } from "../../agent/types";
import type { L1Record } from "../core/store/types";
import { buildL1DedupePrompt } from "../prompts/l1-dedupe";

export type L1ConflictDecision =
  | { action: "store" }
  | { action: "skip"; targetRecordId?: string }
  | { action: "update" | "merge"; targetRecordId: string };

export async function resolveL1Conflict(input: {
  llm: LlmProvider;
  newRecord: L1Record;
  candidates: L1Record[];
}): Promise<L1ConflictDecision> {
  if (input.candidates.length === 0) {
    return { action: "store" };
  }

  const response = await input.llm.complete({
    messages: [
      { role: "system", content: "Resolve L1 memory conflicts and return strict JSON only." },
      { role: "user", content: buildL1DedupePrompt(input.newRecord, input.candidates) },
    ],
    tools: [],
    meta: { origin: "memory.l1.dedupe" },
  });

  try {
    const parsed = JSON.parse(response.content) as { action?: string; targetRecordId?: string | null };
    if (parsed.action === "update" || parsed.action === "merge") {
      if (parsed.targetRecordId) {
        return { action: parsed.action, targetRecordId: parsed.targetRecordId };
      }
    }
    if (parsed.action === "skip") {
      return { action: "skip", targetRecordId: parsed.targetRecordId ?? undefined };
    }
  } catch {
    // fall through
  }

  return { action: "store" };
}
```

`src/memory/pipeline/l1.ts:121-194`

```ts
import { resolveL1Conflict } from "./l1-dedupe";

const conflict = store
  ? await resolveL1Conflict({
      llm,
      newRecord: record,
      candidates: await store.queryL1Records({
        userId,
        type: "L1",
        limit: 20,
      }),
    })
  : { action: "store" as const };

if (conflict.action === "skip") {
  continue;
}

const targetRecordId = conflict.action === "update" || conflict.action === "merge"
  ? conflict.targetRecordId
  : record.recordId;

const stored = await store.upsertL1({
  ...record,
  recordId: targetRecordId,
  sourceConversationIds: mergeNumberSets(
    record.sourceConversationIds,
    conflict.action === "update" || conflict.action === "merge"
      ? (await store.queryL1Records({ userId, type: "L1", limit: 20 }))
          .find((candidate) => candidate.recordId === conflict.targetRecordId)?.sourceConversationIds ?? []
      : [],
  ),
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/memory/l1-dedupe.test.ts tests/memory/imemory-store-integration.test.ts`
Expected: PASS with the new semantic decision test and existing store integration still green.

- [ ] **Step 5: Commit**

```bash
git add src/memory/pipeline/l1-dedupe.ts src/memory/prompts/l1-dedupe.ts src/memory/pipeline/l1.ts tests/memory/l1-dedupe.test.ts
git commit -m "feat: add semantic l1 dedupe decisions"
```

---

### Task 6 (Phase 2 / Workstream 2.3): Split recall into stable and dynamic prompt context

**Files:**
- Create: `src/memory/recall/context.ts`
- Create: `tests/memory/recall-context-split.test.ts`
- Modify: `src/agent/react-agent.ts:26-57,137-147`
- Test: `tests/memory/recall-context-split.test.ts`
- Test: `tests/memory/agent-runtime.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { buildRecallPromptSections } from "../../src/memory/recall/context";

test("buildRecallPromptSections keeps stable memory separate from dynamic recall", () => {
  const sections = buildRecallPromptSections({
    persona: "# Persona\nPrefers Bun runtime.",
    scenarios: [{ id: 1, title: "Runtime", bodyMarkdown: "## Runtime\nUse Bun" }],
    atoms: [{ id: 1, text: "Use Bun for local scripts", importance: 6 }],
    conversations: [{ id: 1, role: "user", content: "Please use Bun.", createdAt: "2026-05-18T00:00:00.000Z" }],
    taskCanvas: undefined,
    taskCanvases: [],
  });

  expect(sections.stableContext).toContain("## L3 Persona");
  expect(sections.stableContext).toContain("## L2 Scenarios");
  expect(sections.dynamicContext).toContain("<relevant-memories>");
  expect(sections.dynamicContext).toContain("Use Bun for local scripts");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/memory/recall-context-split.test.ts`
Expected: FAIL with `Cannot find module '../../src/memory/recall/context'`.

- [ ] **Step 3: Write minimal implementation**

`src/memory/recall/context.ts`

```ts
import { truncateText } from "../../utils/text";
import type { MemoryServiceRecall } from "../core/service";

export function buildRecallPromptSections(recall: MemoryServiceRecall) {
  const stableParts: string[] = [];
  const dynamicLines: string[] = [];

  if (recall.persona) {
    stableParts.push(`## L3 Persona\n${recall.persona}`);
  }

  if (recall.scenarios.length) {
    stableParts.push(
      `## L2 Scenarios\n${recall.scenarios
        .map((scenario) => `### Scenario #${scenario.id}: ${scenario.title}\n${truncateText(scenario.bodyMarkdown ?? scenario.body_markdown ?? "", 1600)}`)
        .join("\n\n")}`,
    );
  }

  if (recall.taskCanvas) {
    stableParts.push(`## Active Mermaid task canvas\n\`\`\`mermaid\n${truncateText(recall.taskCanvas, 2200)}\n\`\`\``);
  }

  if (recall.taskCanvases.length) {
    stableParts.push(
      `## Relevant historical task canvases\n${recall.taskCanvases
        .map((task) => `### Task #${task.id}: ${task.label} (${task.status})\nfile_path=${task.filePath}\n\`\`\`mermaid\n${truncateText(task.canvas, 2200)}\n\`\`\``)
        .join("\n\n")}`,
    );
  }

  if (recall.atoms.length) {
    dynamicLines.push(`## L1 Memory atoms\n${recall.atoms.map((atom) => `- atom_id=${atom.id} importance=${atom.importance}: ${atom.text}`).join("\n")}`);
  }

  if (recall.conversations.length) {
    dynamicLines.push(
      `## L0 Related conversation evidence\n${recall.conversations
        .map((conversation) => `- turn_id=${conversation.id} ${conversation.createdAt ?? conversation.created_at ?? ""} ${conversation.role}: ${truncateText(conversation.content, 600)}`)
        .join("\n")}`,
    );
  }

  return {
    stableContext: stableParts.join("\n\n") || "No stable layered memory found.",
    dynamicContext: dynamicLines.length > 0
      ? `<relevant-memories>\n${dynamicLines.join("\n\n")}\n</relevant-memories>`
      : undefined,
  };
}
```

`src/agent/react-agent.ts:26-57,137-147`

```ts
import { buildRecallPromptSections } from "../memory/recall/context";

const recallSections = buildRecallPromptSections(recall);

const messages: AgentMessage[] = [
  { role: "system", content: system },
  { role: "system", content: recallSections.stableContext },
  ...(recallSections.dynamicContext
    ? [{ role: "user", content: recallSections.dynamicContext } as AgentMessage]
    : []),
  ...recent
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }) as AgentMessage),
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/memory/recall-context-split.test.ts tests/memory/agent-runtime.test.ts`
Expected: PASS with the new context split test and existing agent runtime tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/memory/recall/context.ts src/agent/react-agent.ts tests/memory/recall-context-split.test.ts
git commit -m "feat: split recall into stable and dynamic context"
```

---

