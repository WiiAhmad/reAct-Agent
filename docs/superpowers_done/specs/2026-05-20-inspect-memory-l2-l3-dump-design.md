# Inspect Memory L2/L3 Full Dump Design

**Date:** 2026-05-20  
**Status:** Draft for user review  
**Target project:** `D:\Code\Test\yunus\grammy`

## Goal

Update `scripts/inspect-memory.ts` so it keeps the existing quick memory summary output and also prints a full debug dump of **all** available L2 scenarios and L3 persona content for a selected user.

The new output must include:

1. the existing `memoryStatus(...)` summary
2. human-readable sectioned text for L2 and L3
3. pretty-printed raw JSON for the same L2/L3 content

## Non-goals

- Do not change memory generation behavior for L1, L2, or L3.
- Do not add metadata-heavy debug output such as atom IDs, source scenario IDs, or internal checksums.
- Do not change `MemoryService` public APIs for general runtime behavior.
- Do not add flags or modes; the new dump is appended to the current default script output.

## Existing context

The current inspector is a small script at `scripts/inspect-memory.ts`.

Current behavior:

- if no `userId` is passed, it lists known users from `conversations`
- if `userId` is present, it prints `memory.memoryStatus(userId, chatId)`
- it then calls `memory.recall(userId, "persona preferences project memory", 5, chatId)` and prints:
  - persona markdown when available
  - only scenario IDs and titles when available

Provenance:

- current inspector flow: `scripts/inspect-memory.ts:33-43`
- current summary method: `src/memory/core/service.ts:313-370`
- current recall result shaping: `src/memory/core/service.ts:217-276`

## Problem statement

`memory.recall(...)` is not the right source for a "show me everything" inspector.

Why:

- it is query-driven rather than a full listing API
- it is limited by `maxResults`
- scenario inclusion depends on recall/search relevance rather than exhaustive enumeration

Provenance:

- recall entrypoint: `src/memory/core/service.ts:217-276`
- scenario retrieval path: `src/memory/recall/service.ts:236-241`
- persona retrieval path: `src/memory/recall/service.ts:209-213`

## Chosen approach

Use the existing project `IMemoryStore` profile storage as the inspector source for L2 and L3 dumps.

The script should:

1. keep calling `memory.memoryStatus(...)`
2. obtain all stored profiles through the existing store-backed path
3. filter records by the selected `userId`
4. split them into:
   - L2 profiles where `type === "l2"`
   - L3 profiles where `type === "l3"`
5. render content-only debug output in two forms:
   - human-readable sections
   - pretty JSON

This is preferred over extending `memory.recall(...)` because the debugging requirement is exhaustive inspection, not ranked retrieval.

## Architecture and boundaries

### Script responsibility

`scripts/inspect-memory.ts` remains a debug utility script. It is allowed to know about the store-backed profile shape because this is operational inspection code, not user-facing runtime product behavior.

### Storage boundary

The script should read profiles from the existing `IMemoryStore` instance created as part of `createMemoryService(...)` initialization.

Provenance:

- store creation in factory: `src/memory/integration/factory.ts:118-160`
- store contract for profiles: `src/memory/core/store/types.ts:87-144`
- profile listing implementation: `src/memory/backends/sqlite/store.ts:1057-1069`

### Data model used by the script

The script only needs the following profile fields:

- `type`
- `userId`
- `content`

It may also use `id` or `filename` as stable labels in sectioned text if needed for readability, but the JSON payload should remain content-focused.

## Output design

### 1. Existing summary

Keep the current first line block:

```text
backend=...
owner=...
L0 conversations=...
L1 atoms=...
L2 scenarios=...
L3 persona=...
...
```

This preserves the quick health/status overview.

### 2. Human-readable L2 section

Add a section after the summary:

```text
--- L2 scenarios ---

#1 <label>
<full scenario content>

#2 <label>
<full scenario content>
```

Rules:

- print every L2 record for the selected user
- include full content body
- if none exist, print `No L2 scenarios found.`

The label can use a lightweight identifier derived from the profile, but the primary payload is the full content body.

### 3. Human-readable L3 section

Add a section after L2:

```text
--- L3 persona ---

<full persona content>
```

Rules:

- print every L3 profile found for the user in the stable order returned by `pullProfiles()` after filtering
- if there is one latest persona only, the section is still the same
- if none exist, print `No L3 persona found.`

### 4. Raw JSON section

Append a final pretty-printed JSON object:

```json
{
  "userId": "...",
  "chatId": "...",
  "l2": [
    { "content": "..." }
  ],
  "l3": [
    { "content": "..." }
  ]
}
```

Rules:

- include `chatId: null` when not provided
- JSON should contain only content-oriented fields needed for debug readability
- do not include internal metadata unless later debugging needs prove it necessary

## Implementation notes

The script currently only keeps a `MemoryService` reference returned by `createMemoryService(...)`. To avoid broad service changes, the script should create its own script-local `SqliteMemoryStore` instance with the same initialization settings used by `createMemoryService(...)`, rather than introducing a new general-purpose `MemoryService.listProfiles()` API.

A minimal implementation can:

1. instantiate the memory service as today
2. instantiate a separate `SqliteMemoryStore` in the script using the same SQLite/vector settings used in `createMemoryService(...)`
3. call `pullProfiles()`
4. filter by `userId` and `type`
5. render sections and JSON

This keeps the change local to the inspector while avoiding changes to production service APIs.

Provenance:

- existing service construction: `scripts/inspect-memory.ts:15-31`
- store init pattern: `src/memory/integration/factory.ts:118-124`
- profile schema: `src/memory/core/store/types.ts:87-100`

## Error handling

- If profile loading returns an empty list, print explicit empty-state messages for both L2 and L3.
- If store initialization or profile reading fails, the script should fail fast with the thrown error rather than masking it, because this is a debugging utility.
- The script should not silently fall back to `memory.recall(...)` for exhaustive output, because that would hide correctness issues.

## Testing

Manual verification is sufficient for this script change.

Suggested checks:

1. run with no `userId` and confirm user listing behavior is unchanged
2. run with a user that has L2 and L3 data and confirm:
   - summary still prints first
   - all L2 scenario contents print in sectioned text
   - L3 persona content prints in sectioned text
   - JSON dump contains matching content
3. run with a user that has only L3 and no L2, and confirm explicit empty-state messaging for L2
4. run with a user that has no profiles, and confirm both empty-state messages appear

## Tradeoffs

### Why not keep using `memory.recall(...)`?

Because recall is optimized for relevance, not completeness. It is the wrong abstraction for a full inspector.

### Why not add a new `MemoryService` API?

That would be cleaner in abstraction terms, but it would widen the production service surface for a one-off debugging need. The request is specifically about a script, so a script-local solution is the smaller change.

## Success criteria

The design is successful when `scripts/inspect-memory.ts`:

- still prints the existing memory status summary
- prints full L2 scenario content for all stored scenarios of the selected user
- prints full L3 persona content for the selected user
- appends a readable pretty JSON dump of the same content
- no longer relies on `memory.recall(...)` as the source of exhaustive L2/L3 inspection
