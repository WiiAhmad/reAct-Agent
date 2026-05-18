# Project Comparison: grammy vs TencentDB-Agent-Memory

**Date:** 2026-05-18  
**Project A:** `D:\Code\Test\yunus\grammy`  
**Project B:** `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory`  
**Scope note:** Project A was scanned as the current repository root while excluding the nested `TencentDB-Agent-Memory` directory. Project B was scanned as its own nested/reference repository.

## Report files

- [`01-structure-docs.md`](01-structure-docs.md) — repository layout, documentation, package metadata, published surface, root-level maturity.
- [`02-source-architecture.md`](02-source-architecture.md) — source entrypoints, runtime composition, memory pipeline, persistence, scheduler, host integrations.
- [`03-tooling-testing-ci.md`](03-tooling-testing-ci.md) — package managers, dependencies, build/test setup, CI/release gates, env/config/ops scripts.
- [`04-features-apis-migration.md`](04-features-apis-migration.md) — public commands, tools, hooks, APIs, memory capabilities, migration/reuse opportunities.

## Executive summary

Project A is a private Bun/TypeScript Telegram agent application. It owns the whole runtime: Telegram UX, ReAct-style tool calling, SQLite-backed memory, autonomous scheduled jobs, memory update scheduling, tool-result offload, task-aware Mermaid canvases, and local L4 draft skill generation.

Project B is a publishable OpenClaw/Hermes memory plugin package. It is designed as reusable memory infrastructure with OpenClaw tools and lifecycle hooks, a host-neutral `TdaiCore`, SQLite or Tencent Cloud VectorDB storage, standalone/Hermes HTTP gateway endpoints, Docker/Hermes packaging, npm binaries, plugin manifest metadata, and CI package validation.

The projects share a conceptual memory vocabulary: L0 conversation capture, L1 structured memories/evidence, L2 scenarios/scenes/task canvases, L3 persona, recall/search, vector/keyword retrieval, and context offload. Project A has already adapted several TencentDB-Agent-Memory concepts into its Telegram-first architecture, especially L1.5 task judgment, task-scoped Mermaid canvases, task-aware recall, and skill draft generation.

The biggest difference is product shape. Project A is an end-user Telegram app with job scheduling and direct Telegram side effects. Project B is a host-neutral memory subsystem/plugin with OpenClaw/Hermes integration and broader packaging/operational surfaces.

## High-level comparison matrix

| Area | Project A: `grammy` | Project B: `TencentDB-Agent-Memory` |
|---|---|---|
| Primary role | Telegram AI agent application | OpenClaw/Hermes memory plugin package |
| Package posture | Private app package | Publishable npm package |
| Runtime | Bun, grammY, local SQLite | Node >=22.16, OpenClaw, Hermes/Gateway, SQLite or TCVDB |
| Main user surface | Telegram `/start`, `/menu`, `/help`, inline menus | OpenClaw plugin tools/hooks, CLI, HTTP gateway, Hermes adapter |
| Agent ownership | Runs its own ReAct loop | Augments host agents through hooks/tools |
| Memory ownership | Project-owned SQLite backend | Host-neutral store abstraction with SQLite/TCVDB backends |
| Memory layers | L0 conversations, L1 atoms/evidence, L2 scenarios/task canvases, L3 persona, L4 draft skills | L0 conversations, L1 records, L2 scene blocks, L3 persona, optional offload/MMD context engine |
| Scheduler | Cron-style due jobs plus memory update loop | Event-driven per-session memory pipeline scheduler |
| Autonomous jobs | First-class Telegram scheduled jobs | Not present; focused on memory processing |
| Packaging maturity | Minimal app scripts and Bun lockfile | `main`, `exports`, `bin`, `files`, `.npmignore`, CI, Docker, plugin manifest |
| Tests | 30 Bun test files found under `tests/` | Vitest config present; 0 matching TS tests found; 2 Python Hermes tests found |
| CI | No Project A-owned GitHub workflow observed | PR CI validates install, pack, manifest, metadata, package size |

## Most important findings

1. **Project A is a product app; Project B is infrastructure.**  
   Project A’s source composition starts the bot, tools, memory, scheduler, and database in one runtime. Project B separates host adapters from a reusable `TdaiCore` and exposes plugin/gateway surfaces.

2. **Project A intentionally keeps Telegram UX narrow.**  
   The documented and implemented public Telegram commands are `/start`, `/menu`, and `/help`; deeper actions are menu/conversation driven.

3. **Project B has much stronger distribution/package controls.**  
   It has package exports, bins, file whitelist, peer dependencies, OpenClaw compatibility metadata, `.npmignore`, CI pack validation, Docker/Hermes integration, changelog, license, and contribution docs.

4. **Project A has richer end-user automation features.**  
   It includes autonomous scheduled jobs, hybrid Telegram job execution, Memory Update settings, local Telegram message sending, and a date/time tool. Project B does not target those user-facing Telegram workflows.

5. **Project B has richer host-neutral memory infrastructure.**  
   Its abstractions around `TdaiCore`, `HostAdapter`, `LLMRunner`, `IMemoryStore`, SQLite/TCVDB backend selection, gateway endpoints, and OpenClaw hooks are the strongest reuse candidates if Project A ever needs non-Telegram hosts or a sidecar memory service.

6. **Project A has already borrowed TencentDB-style offload ideas.**  
   The current docs and code reflect L1.5 task judgment, task-scoped Mermaid canvases, semantic offload evidence, task-aware recall, and L4 draft skill generation adapted into project-owned storage.

## Main risks and gaps

### Project A risks/gaps

- No visible Project A-owned CI workflow, release gate, lint/format config, coverage config, or package validation gate.
- No external HTTP memory API/gateway.
- No TCVDB or BM25 backend support observed.
- No seed/import CLI equivalent to Project B’s seeding flow.
- Recall appears synchronous in the agent-start path; Project B’s timeout/degraded recall behavior may be worth adapting.
- Runtime data and `.env` exist locally; `.env` was not read.

### Project B risks/gaps

- Vitest scripts/config exist, but no matching TypeScript `*.test.ts` or `*.spec.ts` files were found in the scanned tree.
- Python Hermes tests exist, but no npm/CI invocation for them was found.
- PR CI validates package/manifest/size but does not appear to run tests.
- No root lockfile was found despite npm-based install/CI.
- Some package build script paths were reported as unresolved by the tooling scan, especially script-specific tsconfig paths under `scripts/`.
- Project B’s broader runtime modes create more lifecycle and operational complexity.

## Recommended alignment priorities

1. **Keep Project A’s Telegram-first UX and job model.** Do not force Project B’s plugin assumptions into A’s user-facing design.
2. **Borrow B’s host-neutral boundaries selectively.** `TdaiCore`-style facade, `HostAdapter`, and store capability contracts are valuable patterns if A needs memory reuse or sidecar operation.
3. **Add degraded recall behavior to A.** B’s recall timeout/fallback model can improve Telegram responsiveness.
4. **Consider a seed/import/debug surface for A.** B’s seed CLI/HTTP flow is a practical model for bootstrapping or migrating memory.
5. **Add CI/quality gates to A if it is expected to grow.** At minimum, run Bun test and TypeScript typecheck in CI.
6. **Tighten B’s test/release confidence if maintaining it.** Add test execution to CI, add/restore matching TS tests, and clarify lockfile/build-script expectations.

## Scan limitations

- This was a read-only scan. No tests or build commands were executed.
- `.env` content was intentionally not read.
- Subagents focused on core architecture, docs, package metadata, tests/configs, and feature/API surfaces; not every method in every large implementation file was exhaustively audited.
- Line references in the detailed reports are based on files read during the scan and may shift after future edits.
