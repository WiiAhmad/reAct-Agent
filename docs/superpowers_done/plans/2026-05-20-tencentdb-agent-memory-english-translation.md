# TencentDB-Agent-Memory English Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate all non-exempt human-readable Chinese content in `TencentDB-Agent-Memory/` into English, keep `README_CN.md` and `CONTRIBUTING_CN.md` unchanged, and preserve only behavior-critical Chinese detection regexes.

**Architecture:** Treat the work as a guarded translation pass over one subtree. Update English-facing docs first, then translate script/docs/source strings, co-migrate parser-format labels in `auto-recall.ts` so they become English safely, and finish with a Han-character scan plus build/test verification.

**Tech Stack:** Markdown, JSON, TypeScript, shell scripts, Node.js 22, tsdown, Vitest, OpenClaw/Hermes plugin docs

---

**Source spec:** `docs/superpowers/specs/2026-05-20-tencentdb-agent-memory-english-translation-design.md`

**Execution note:** This plan does not authorize git commits. Use diff-based verification unless the user later asks for commits.

## File structure

### English docs and metadata to modify

- `TencentDB-Agent-Memory/README.md` — primary English product and setup doc; must absorb any important Chinese-only guidance from `README_CN.md`
- `TencentDB-Agent-Memory/CONTRIBUTING.md` — primary English contributor guide; should stay in sync with `CONTRIBUTING_CN.md`
- `TencentDB-Agent-Memory/CHANGELOG.md` — release history currently written in Chinese
- `TencentDB-Agent-Memory/.npmignore` — Chinese comment headings
- `TencentDB-Agent-Memory/openclaw.plugin.json` — plugin metadata with Chinese human-readable text
- `TencentDB-Agent-Memory/src/cli/README.md` — CLI usage doc with Chinese text
- `TencentDB-Agent-Memory/SKILL.md` — skill metadata and usage guidance
- `TencentDB-Agent-Memory/SKILL-MIGRATION.md` — migration guide
- `TencentDB-Agent-Memory/SKILL-DIAGNOSTIC-EXPORT.md` — diagnostic export guide

### Chinese docs to reference but keep unchanged

- `TencentDB-Agent-Memory/README_CN.md`
- `TencentDB-Agent-Memory/CONTRIBUTING_CN.md`

### Script docs and script sources to modify

- `TencentDB-Agent-Memory/scripts/migrate-sqlite-to-tcvdb/README.md`
- `TencentDB-Agent-Memory/scripts/README.memory-tencentdb-ctl.md`
- `TencentDB-Agent-Memory/scripts/bugfix-20260423/BUGFIX-20260423-SOP.md`
- `TencentDB-Agent-Memory/scripts/setup-offload.sh`
- `TencentDB-Agent-Memory/scripts/openclaw-after-tool-call-messages.patch.sh`
- `TencentDB-Agent-Memory/scripts/install_hermes_memory_tencentdb.sh`
- `TencentDB-Agent-Memory/scripts/memory-tencentdb-ctl.sh`
- `TencentDB-Agent-Memory/scripts/export-diagnostic.sh`
- `TencentDB-Agent-Memory/scripts/bugfix-20260423/bugfix-20260423.sh`
- `TencentDB-Agent-Memory/scripts/bugfix-20260423/bugfix-20260423-full.sh`
- `TencentDB-Agent-Memory/scripts/read-local-memory/read-local-memory.ts`
- `TencentDB-Agent-Memory/scripts/migrate-sqlite-to-tcvdb/sqlite-to-tcvdb.ts`
- `TencentDB-Agent-Memory/scripts/export-tencent-vdb/export-tencent-vdb.ts`

### Runtime and prompt sources to modify

- `TencentDB-Agent-Memory/index.ts`
- `TencentDB-Agent-Memory/src/offload/index.ts`
- `TencentDB-Agent-Memory/src/offload/types.ts`
- `TencentDB-Agent-Memory/src/offload/mmd-injector.ts`
- `TencentDB-Agent-Memory/src/offload/l3-token-helpers.ts`
- `TencentDB-Agent-Memory/src/offload/hooks/after-tool-call.ts`
- `TencentDB-Agent-Memory/src/offload/hooks/llm-input-l3.ts`
- `TencentDB-Agent-Memory/src/offload/local-llm/prompts/l1-prompt.ts`
- `TencentDB-Agent-Memory/src/offload/local-llm/prompts/l15-prompt.ts`
- `TencentDB-Agent-Memory/src/offload/local-llm/prompts/l2-prompt.ts`
- `TencentDB-Agent-Memory/src/core/store/sqlite.ts`
- `TencentDB-Agent-Memory/src/core/store/tcvdb.ts`
- `TencentDB-Agent-Memory/src/core/scene/scene-navigation.ts`
- `TencentDB-Agent-Memory/src/core/scene/scene-extractor.ts`
- `TencentDB-Agent-Memory/src/core/record/l1-extractor.ts`
- `TencentDB-Agent-Memory/src/core/prompts/l1-extraction.ts`
- `TencentDB-Agent-Memory/src/core/prompts/l1-dedup.ts`
- `TencentDB-Agent-Memory/src/core/prompts/persona-generation.ts`
- `TencentDB-Agent-Memory/src/core/prompts/scene-extraction.ts`
- `TencentDB-Agent-Memory/src/core/persona/persona-trigger.ts`
- `TencentDB-Agent-Memory/src/core/persona/persona-generator.ts`
- `TencentDB-Agent-Memory/src/core/hooks/auto-recall.ts`
- `TencentDB-Agent-Memory/src/utils/memory-cleaner.ts`

### Generated outputs and wrappers to refresh indirectly

- `TencentDB-Agent-Memory/bin/read-local-memory.mjs`
- `TencentDB-Agent-Memory/bin/export-tencent-vdb.mjs`

Do not hand-edit the generated `bin/*.mjs` files. Regenerate them via `npm run build` after updating their TypeScript sources.

### Behavior-sensitive file to preserve selectively

- `TencentDB-Agent-Memory/src/utils/sanitize.ts` — translate comments to English, but keep the four Chinese prompt-injection regex literals intact because they are detection logic

## Task 1: Sync the English root docs and preserve the `_CN` exceptions

**Files:**
- Modify: `TencentDB-Agent-Memory/README.md`
- Modify: `TencentDB-Agent-Memory/CONTRIBUTING.md`
- Reference only: `TencentDB-Agent-Memory/README_CN.md`
- Reference only: `TencentDB-Agent-Memory/CONTRIBUTING_CN.md`
- Reference: `docs/superpowers/specs/2026-05-20-tencentdb-agent-memory-english-translation-design.md`

- [ ] **Step 1: Normalize the README language switch and headline copy**

```md
### Agents remember, humans innovate.

[**English**](./README.md) · [Simplified Chinese](./README_CN.md)
```

- [ ] **Step 2: Merge the Chinese-only community note into the English README**

Insert the English version of the community block directly after the overview quote block so English readers do not need `README_CN.md` for it:

```md
<p align="center">
  <img src="https://github.com/user-attachments/assets/c30eabef-caf7-4477-820f-9f5fe12e5d89" width="360" alt="Agent Memory WeChat community QR code" />
  <br/>
  <sub>📱 Scan to join the Agent Memory WeChat community and talk directly with early contributors.</sub>
</p>
```

- [ ] **Step 3: Compare `README.md` against `README_CN.md` section-by-section and translate any remaining Chinese-only setup prose into the English file**

Use the existing heading parity as the checklist. Keep the English headings below and ensure each section contains the same substantive guidance as the Chinese file:

```text
## ✨ Highlights
## Overview
## Core Technology: Reject Flat Storage, Embrace Layering and Symbolization
## Quick Start
## 🔧 Configurable Parameters
## 🤔 Features
## Documentation
## Community & Contributing
## Roadmap
```

- [ ] **Step 4: Confirm `CONTRIBUTING.md` still covers the same contributor guidance as `CONTRIBUTING_CN.md` without translating the `_CN` copy itself**

Use this section checklist and only adjust the English file if the Chinese version contains wording or examples not already represented:

```text
## How to Contribute
## Getting Started
## Submitting a Pull Request
## Commit Message Convention
## Code Style
## Developer Certificate of Origin (DCO)
## Security Issues
## License
```

- [ ] **Step 5: Verify the two English root docs are free of Chinese text**

Run: `rg -n --pcre2 "[\p{Han}]" "TencentDB-Agent-Memory/README.md" "TencentDB-Agent-Memory/CONTRIBUTING.md"`
Expected: no matches.

## Task 2: Translate top-level docs, changelog, metadata, and CLI docs

**Files:**
- Modify: `TencentDB-Agent-Memory/CHANGELOG.md`
- Modify: `TencentDB-Agent-Memory/.npmignore`
- Modify: `TencentDB-Agent-Memory/openclaw.plugin.json`
- Modify: `TencentDB-Agent-Memory/src/cli/README.md`
- Modify: `TencentDB-Agent-Memory/SKILL.md`
- Modify: `TencentDB-Agent-Memory/SKILL-MIGRATION.md`
- Modify: `TencentDB-Agent-Memory/SKILL-DIAGNOSTIC-EXPORT.md`

- [ ] **Step 1: Translate the `.npmignore` comment headings into English**

Replace the Chinese comment groups with these exact English headings:

```text
# Test files
# Development docs and helpers
# Environment and configuration
# Runtime artifacts
```

- [ ] **Step 2: Translate the plugin metadata and top-level doc prose without changing keys, paths, or package names**

Apply this rule set while editing `openclaw.plugin.json`, `src/cli/README.md`, `SKILL.md`, `SKILL-MIGRATION.md`, and `SKILL-DIAGNOSTIC-EXPORT.md`:

```text
Translate descriptions, headings, bullet prose, and examples for human readers.
Keep JSON keys, commands, flags, package names, file paths, and code fences structurally unchanged.
```

- [ ] **Step 3: Translate the changelog in place while preserving version headers, dates, and issue references**

Use these heading translations consistently throughout `CHANGELOG.md`:

```text
### 🐛 修复 -> ### 🐛 Fixes
### ✨ 改进 -> ### ✨ Improvements
### 📖 文档 -> ### 📖 Documentation
### 🔧 兼容性适配 -> ### 🔧 Compatibility
### 📦 新功能 -> ### 📦 New Features
### ✅ 测试 -> ### ✅ Tests
### 🚀 新功能 -> ### 🚀 New Features
### ♻️ 重构 -> ### ♻️ Refactors
```

- [ ] **Step 4: Verify the translated top-level docs and metadata are free of Chinese text**

Run: `rg -n --pcre2 "[\p{Han}]" "TencentDB-Agent-Memory/CHANGELOG.md" "TencentDB-Agent-Memory/.npmignore" "TencentDB-Agent-Memory/openclaw.plugin.json" "TencentDB-Agent-Memory/src/cli/README.md" "TencentDB-Agent-Memory/SKILL.md" "TencentDB-Agent-Memory/SKILL-MIGRATION.md" "TencentDB-Agent-Memory/SKILL-DIAGNOSTIC-EXPORT.md"`
Expected: no matches.

## Task 3: Translate script docs and script/source comments, then rebuild generated wrappers

**Files:**
- Modify: `TencentDB-Agent-Memory/scripts/migrate-sqlite-to-tcvdb/README.md`
- Modify: `TencentDB-Agent-Memory/scripts/README.memory-tencentdb-ctl.md`
- Modify: `TencentDB-Agent-Memory/scripts/bugfix-20260423/BUGFIX-20260423-SOP.md`
- Modify: `TencentDB-Agent-Memory/scripts/setup-offload.sh`
- Modify: `TencentDB-Agent-Memory/scripts/openclaw-after-tool-call-messages.patch.sh`
- Modify: `TencentDB-Agent-Memory/scripts/install_hermes_memory_tencentdb.sh`
- Modify: `TencentDB-Agent-Memory/scripts/memory-tencentdb-ctl.sh`
- Modify: `TencentDB-Agent-Memory/scripts/export-diagnostic.sh`
- Modify: `TencentDB-Agent-Memory/scripts/bugfix-20260423/bugfix-20260423.sh`
- Modify: `TencentDB-Agent-Memory/scripts/bugfix-20260423/bugfix-20260423-full.sh`
- Modify: `TencentDB-Agent-Memory/scripts/read-local-memory/read-local-memory.ts`
- Modify: `TencentDB-Agent-Memory/scripts/migrate-sqlite-to-tcvdb/sqlite-to-tcvdb.ts`
- Modify: `TencentDB-Agent-Memory/scripts/export-tencent-vdb/export-tencent-vdb.ts`
- Refresh via build: `TencentDB-Agent-Memory/bin/read-local-memory.mjs`
- Refresh via build: `TencentDB-Agent-Memory/bin/export-tencent-vdb.mjs`

- [ ] **Step 1: Translate the script Markdown docs into English**

Translate these docs fully in place while keeping command examples intact:

```text
TencentDB-Agent-Memory/scripts/migrate-sqlite-to-tcvdb/README.md
TencentDB-Agent-Memory/scripts/README.memory-tencentdb-ctl.md
TencentDB-Agent-Memory/scripts/bugfix-20260423/BUGFIX-20260423-SOP.md
```

- [ ] **Step 2: Translate shell comments and any user-facing echo/help text in the shell scripts**

Apply the same treatment to these files:

```text
TencentDB-Agent-Memory/scripts/setup-offload.sh
TencentDB-Agent-Memory/scripts/openclaw-after-tool-call-messages.patch.sh
TencentDB-Agent-Memory/scripts/install_hermes_memory_tencentdb.sh
TencentDB-Agent-Memory/scripts/memory-tencentdb-ctl.sh
TencentDB-Agent-Memory/scripts/export-diagnostic.sh
TencentDB-Agent-Memory/scripts/bugfix-20260423/bugfix-20260423.sh
TencentDB-Agent-Memory/scripts/bugfix-20260423/bugfix-20260423-full.sh
```

- [ ] **Step 3: Translate the TypeScript script help strings and comments, not the CLI flags or JSON field names**

Translate the human-readable strings in these sources:

```text
TencentDB-Agent-Memory/scripts/read-local-memory/read-local-memory.ts
TencentDB-Agent-Memory/scripts/migrate-sqlite-to-tcvdb/sqlite-to-tcvdb.ts
TencentDB-Agent-Memory/scripts/export-tencent-vdb/export-tencent-vdb.ts
```

- [ ] **Step 4: Rebuild the generated script wrappers after the source translations**

Run: `npm --prefix "TencentDB-Agent-Memory" run build`
Expected: exit code 0, with refreshed generated outputs in `TencentDB-Agent-Memory/bin/` and script build artifacts.

- [ ] **Step 5: Verify the script docs and script sources are free of Chinese text after the rebuild**

Run: `rg -n --pcre2 "[\p{Han}]" "TencentDB-Agent-Memory/scripts" "TencentDB-Agent-Memory/bin"`
Expected: no matches in the listed script files or generated wrappers.

## Task 4: Translate prompt bundles and safe runtime strings in source files

**Files:**
- Modify: `TencentDB-Agent-Memory/index.ts`
- Modify: `TencentDB-Agent-Memory/src/offload/index.ts`
- Modify: `TencentDB-Agent-Memory/src/offload/types.ts`
- Modify: `TencentDB-Agent-Memory/src/offload/mmd-injector.ts`
- Modify: `TencentDB-Agent-Memory/src/offload/l3-token-helpers.ts`
- Modify: `TencentDB-Agent-Memory/src/offload/hooks/after-tool-call.ts`
- Modify: `TencentDB-Agent-Memory/src/offload/hooks/llm-input-l3.ts`
- Modify: `TencentDB-Agent-Memory/src/offload/local-llm/prompts/l1-prompt.ts`
- Modify: `TencentDB-Agent-Memory/src/offload/local-llm/prompts/l15-prompt.ts`
- Modify: `TencentDB-Agent-Memory/src/offload/local-llm/prompts/l2-prompt.ts`
- Modify: `TencentDB-Agent-Memory/src/core/store/sqlite.ts`
- Modify: `TencentDB-Agent-Memory/src/core/store/tcvdb.ts`
- Modify: `TencentDB-Agent-Memory/src/core/record/l1-extractor.ts`
- Modify: `TencentDB-Agent-Memory/src/core/prompts/l1-extraction.ts`
- Modify: `TencentDB-Agent-Memory/src/core/prompts/l1-dedup.ts`
- Modify: `TencentDB-Agent-Memory/src/core/prompts/persona-generation.ts`
- Modify: `TencentDB-Agent-Memory/src/core/prompts/scene-extraction.ts`
- Modify: `TencentDB-Agent-Memory/src/utils/memory-cleaner.ts`

- [ ] **Step 1: Translate the prompt constants in the L1/L1.5/L2/L3 prompt files into natural English**

Use these concrete anchor replacements as the style baseline:

```text
你是记忆冲突检测器。 -> You are a memory conflict detector.
## 核心规则 -> ## Core rules
## 判断逻辑 -> ## Decision logic
## 输出格式 -> ## Output format
## 最近的对话上下文（用于理解当前任务）： -> ## Recent conversation context (for understanding the current task):
历史消息，可作为参考： -> Prior messages for reference:
最新user message： -> Latest user message:
未知情境 -> Unknown scenario
```

- [ ] **Step 2: Translate code comments and human-readable default strings in the supporting runtime files**

Apply that pass to these files without changing function names, JSON keys, or type names:

```text
TencentDB-Agent-Memory/index.ts
TencentDB-Agent-Memory/src/offload/types.ts
TencentDB-Agent-Memory/src/offload/mmd-injector.ts
TencentDB-Agent-Memory/src/offload/l3-token-helpers.ts
TencentDB-Agent-Memory/src/offload/hooks/after-tool-call.ts
TencentDB-Agent-Memory/src/offload/hooks/llm-input-l3.ts
TencentDB-Agent-Memory/src/core/store/sqlite.ts
TencentDB-Agent-Memory/src/core/store/tcvdb.ts
TencentDB-Agent-Memory/src/core/record/l1-extractor.ts
TencentDB-Agent-Memory/src/utils/memory-cleaner.ts
```

- [ ] **Step 3: Verify the prompt and safe-runtime group is free of Chinese text before touching parser-sensitive files**

Run: `rg -n --pcre2 "[\p{Han}]" "TencentDB-Agent-Memory/index.ts" "TencentDB-Agent-Memory/src/offload" "TencentDB-Agent-Memory/src/core/store" "TencentDB-Agent-Memory/src/core/record/l1-extractor.ts" "TencentDB-Agent-Memory/src/core/prompts" "TencentDB-Agent-Memory/src/utils/memory-cleaner.ts"`
Expected: remaining matches should be limited to files intentionally deferred to Task 5 or `src/utils/sanitize.ts`.

## Task 5: Co-migrate runtime labels and parser formats in `auto-recall` and scene/persona helpers

**Files:**
- Modify: `TencentDB-Agent-Memory/src/core/hooks/auto-recall.ts`
- Modify: `TencentDB-Agent-Memory/src/core/scene/scene-navigation.ts`
- Modify: `TencentDB-Agent-Memory/src/core/scene/scene-extractor.ts`
- Modify: `TencentDB-Agent-Memory/src/core/persona/persona-generator.ts`
- Modify: `TencentDB-Agent-Memory/src/core/persona/persona-trigger.ts`

- [ ] **Step 1: Translate the `MEMORY_TOOLS_GUIDE` and the injected relevant-memory note in `auto-recall.ts`**

Use these exact English section labels and guidance:

```text
## Memory tools usage guide
When the recalled memory snippets above are not enough to answer the user, call these tools to retrieve more information.
### ⚠️ Call limits
Across one conversation turn, `tdai_memory_search` and `tdai_conversation_search` may be called at most 3 times in total.
```

Also translate the `<relevant-memories>` note to:

```text
The following memories were recalled for this conversation. They are reference material, not the current task state.
```

- [ ] **Step 2: Replace the Chinese activity-time formatter strings and update the matching regexes in the same file**

Change both the formatting code and the parsing regexes together so they stay aligned. Use these exact English forms:

```text
(Activity time: 2025-05-01 ~ 2025-05-10)
(Activity time: from 2025-05-01)
(Activity time: until 2025-05-10)
(Activity time: 2025-03-01)
```

That means replacing the current `活动时间` regex/formatter fragments with `Activity time` variants everywhere they are paired in `auto-recall.ts`.

- [ ] **Step 3: Translate the scene/persona helper prose and warnings to English**

Translate the human-readable strings in these files, including the visible labels shown below:

```text
TencentDB-Agent-Memory/src/core/scene/scene-navigation.ts
- 📌 使用说明： -> 📌 Usage notes:
- 热度 -> Heat
- 更新 -> Updated

TencentDB-Agent-Memory/src/core/scene/scene-extractor.ts
- 当前场景总数 -> Current scene count
- 当前场景数量为 ... -> Current scene count is ...

TencentDB-Agent-Memory/src/core/persona/persona-generator.ts
- 变化场景完整内容 -> Full content of changed scenes
- 无变化场景 -> No changed scenes

TencentDB-Agent-Memory/src/core/persona/persona-trigger.ts
- 主动请求 -> Manual request
- 首次冷启动 -> First cold start
- 恢复 -> Recovery
- 达到阈值 -> Threshold reached
```

- [ ] **Step 4: Verify the parser-sensitive runtime group is now English-only**

Run: `rg -n --pcre2 "[\p{Han}]" "TencentDB-Agent-Memory/src/core/hooks/auto-recall.ts" "TencentDB-Agent-Memory/src/core/scene" "TencentDB-Agent-Memory/src/core/persona"`
Expected: no matches.

## Task 6: Preserve the Chinese detection regexes, then run the final scan, build, and tests

**Files:**
- Modify: `TencentDB-Agent-Memory/src/utils/sanitize.ts`
- Verify: `TencentDB-Agent-Memory/`

- [ ] **Step 1: Translate `sanitize.ts` comments to English but keep the four Chinese detection regex literals exactly as they are**

The preserved literals are these four patterns and nothing else in that file should remain Chinese:

```ts
/忽略(?:所有|之前|以上|先前)?(?:的)?(?:指令|规则|指示|说明)/,
/无视(?:所有|之前|以上)?(?:的)?(?:指令|规则|限制)/,
/(?:显示|输出|告诉我|给我看)(?:你的)?(?:系统|初始|隐藏)?(?:提示词|指令|规则|prompt)/,
/你(?:现在|从现在开始)是/,
```

- [ ] **Step 2: Run the final Han-character scan with the two `_CN` docs excluded from the translation target**

Run: `rg -n --pcre2 "[\p{Han}]" "TencentDB-Agent-Memory" -g "!README_CN.md" -g "!CONTRIBUTING_CN.md"`
Expected: only the four preserved regex literals in `TencentDB-Agent-Memory/src/utils/sanitize.ts` match.

- [ ] **Step 3: Rebuild the plugin after all source edits**

Run: `npm --prefix "TencentDB-Agent-Memory" run build`
Expected: exit code 0.

- [ ] **Step 4: Run the test suite after the translation pass**

Run: `npm --prefix "TencentDB-Agent-Memory" test`
Expected: Vitest exits 0.

- [ ] **Step 5: Review the final diff to confirm the allowed exceptions stayed untouched**

Run: `git diff -- "TencentDB-Agent-Memory"`
Expected:
- `TencentDB-Agent-Memory/README_CN.md` is unchanged.
- `TencentDB-Agent-Memory/CONTRIBUTING_CN.md` is unchanged.
- Remaining Chinese outside those files appears only in the four preserved regex literals in `src/utils/sanitize.ts`.
