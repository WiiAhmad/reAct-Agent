# TencentDB-Agent-Memory English Translation Design

**Date:** 2026-05-20  
**Status:** Draft for user review  
**Target project:** `D:\Code\Test\yunus\grammy`  
**Target subtree:** `TencentDB-Agent-Memory/`

## Goal

Translate all human-readable Chinese content in `TencentDB-Agent-Memory` into English, while preserving repository behavior and keeping `README_CN.md` and `CONTRIBUTING_CN.md` as explicit exceptions.

## User-approved direction

Conversation decisions already made:

- translate all readable Chinese content across `TencentDB-Agent-Memory`
- include docs, comments, embedded prompts, runtime strings, CLI/help text, and skill metadata
- preserve behavior-critical Chinese patterns or examples when the Chinese text is part of what the code detects, parses, or demonstrates
- do **not** translate or remove `TencentDB-Agent-Memory/README_CN.md`
- do **not** translate or remove `TencentDB-Agent-Memory/CONTRIBUTING_CN.md`
- if those `_CN` files contain information missing from the English docs, merge that content into `TencentDB-Agent-Memory/README.md` and `TencentDB-Agent-Memory/CONTRIBUTING.md`
- final verification should treat the two `_CN` files as intentional exceptions

## Non-goals

- Do not change code behavior just to remove Chinese text.
- Do not rename package names, environment variables, CLI flags, JSON keys, paths, URLs, or code identifiers.
- Do not delete `README_CN.md` or `CONTRIBUTING_CN.md`.
- Do not restructure the repository unless required to keep translated docs coherent.
- Do not commit changes as part of this design stage.

## Existing context

A Han-character scan across `TencentDB-Agent-Memory` found Chinese text in 49 files spanning multiple content types:

- top-level docs and metadata
- shell scripts and auxiliary READMEs
- source comments
- embedded LLM prompt text
- runtime recall/help strings
- changelog entries
- skill documentation

This is not a docs-only cleanup. The subtree mixes documentation with executable strings that influence agent behavior, memory extraction, and tool guidance.

Provenance:

- top-level scan count and file list: Han-character grep over `TencentDB-Agent-Memory/`
- mixed-language README anchor: `TencentDB-Agent-Memory/README.md:18`
- Chinese-only README content: `TencentDB-Agent-Memory/README_CN.md:5-266`
- Chinese skill metadata and instructions: `TencentDB-Agent-Memory/SKILL.md:3-201`
- runtime recall/help strings: `TencentDB-Agent-Memory/src/core/hooks/auto-recall.ts:31-42`, `TencentDB-Agent-Memory/src/core/hooks/auto-recall.ts:209-209`, `TencentDB-Agent-Memory/src/core/hooks/auto-recall.ts:692-702`
- prompt-heavy source files: `TencentDB-Agent-Memory/src/core/prompts/l1-dedup.ts:15-67`, `TencentDB-Agent-Memory/src/core/prompts/l1-extraction.ts:15-31`
- comments and behavioral examples: `TencentDB-Agent-Memory/src/utils/sanitize.ts:205-208`, `TencentDB-Agent-Memory/src/utils/memory-cleaner.ts:80-81`

## Translation scope by category

### Translate in place

Translate these categories to English:

- Markdown prose in docs and READMEs
- changelog headings and entries
- comments in source files and scripts
- LLM prompt instructions and examples meant for human/LLM reading
- runtime user-facing strings
- CLI/help text
- skill metadata and usage guidance
- shell script comments and operational notes

### Preserve exactly

Do not translate these unless a later pass proves they are non-functional prose:

- package names and import paths
- env var names and config keys
- JSON field names consumed by code
- file paths, URLs, commands, flags, and version strings
- regex patterns that intentionally match Chinese input
- parser formats where Chinese marker text is part of the expected syntax
- example strings whose purpose is to demonstrate supported Chinese user input

### Explicit file exceptions

These files remain unchanged in this pass:

- `TencentDB-Agent-Memory/README_CN.md`
- `TencentDB-Agent-Memory/CONTRIBUTING_CN.md`

Their content is allowed to remain Chinese. If they contain useful guidance not present in the English docs, that guidance should be incorporated into:

- `TencentDB-Agent-Memory/README.md`
- `TencentDB-Agent-Memory/CONTRIBUTING.md`

## Design rules for executable source text

### Safe-to-translate source text

Translate embedded strings when they are informational rather than behavioral, for example:

- agent-facing help text
- human-readable status messages
- prompt instructions where English is acceptable to the target model/runtime
- comments explaining logic
- changelog-like literals only shown to humans

### Behavior-sensitive source text

Preserve Chinese when the string itself affects runtime meaning. The main known cases are:

1. **Regex and detection logic**  
   `src/utils/sanitize.ts` contains patterns intended to catch Chinese-language prompt injection attempts. Translating those patterns would reduce detection coverage.

2. **Structured text formats**  
   `src/core/hooks/auto-recall.ts` formats and parses memory lines using Chinese markers such as activity-time text. If those markers are translated, matching logic must be updated in lockstep. This should only be done if the parser and formatter are both deliberately migrated together.

3. **Examples that document supported Chinese usage**  
   Some prompt files and inline examples may intentionally show Chinese user content. Those can stay Chinese if the example is demonstrating supported input rather than repository documentation.

## Documentation synchronization rules

The English docs must become the maintained source of truth for English readers.

That means:

1. Update `TencentDB-Agent-Memory/README.md` so any Chinese-only product explanation or setup guidance needed by English readers is represented there.
2. Update `TencentDB-Agent-Memory/CONTRIBUTING.md` the same way if the Chinese contributor guide contains material absent from the English one.
3. Do not rely on readers opening `_CN` files to get required setup or contribution information.

## Implementation approach

Use a curated translation pass rather than a blind bulk replace.

1. Inventory all remaining Han-character hits under `TencentDB-Agent-Memory/`.
2. Classify each hit as one of:
   - translatable prose
   - executable but safe-to-translate string
   - behavior-sensitive string to preserve
   - explicit `_CN` file exception
3. Translate eligible files in place.
4. Merge any missing Chinese-only doc content from `_CN` files into the English docs.
5. Re-scan the subtree and verify all remaining Chinese matches are intentional.

This is preferred over a bulk replace because the subtree contains parser markers, regexes, and prompt examples alongside normal prose.

## Verification plan

After edits, verify with a fresh Han-character scan over `TencentDB-Agent-Memory/`.

Expected remaining Chinese should be limited to:

- `TencentDB-Agent-Memory/README_CN.md`
- `TencentDB-Agent-Memory/CONTRIBUTING_CN.md`
- behavior-critical strings intentionally preserved in source files

Any unexpected remaining matches in docs, comments, prompts, or user-facing strings should be translated before calling the work complete.

## Risks and mitigations

### Risk: breaking detection or parsing logic

Mitigation: preserve or carefully co-migrate regexes and structured marker strings when Chinese text is part of runtime logic.

### Risk: English docs remain incomplete even after translation

Mitigation: compare `README_CN.md` and `CONTRIBUTING_CN.md` against their English counterparts and fold any missing substantive guidance into the English files.

### Risk: awkward literal translation in LLM prompts

Mitigation: prefer natural English that preserves instruction intent rather than word-for-word translation.

## Definition of done

This design is satisfied when:

- all non-exempt human-readable Chinese content in `TencentDB-Agent-Memory/` is translated into English
- `README.md` and `CONTRIBUTING.md` include any important guidance previously available only in the Chinese docs
- `README_CN.md` and `CONTRIBUTING_CN.md` remain unchanged as approved exceptions
- remaining Chinese in source files is limited to intentional behavior-sensitive cases
- a final scan confirms there are no accidental untranslated Chinese strings outside those exceptions
