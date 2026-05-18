# Structure and Documentation Comparison

**Project A:** `D:\Code\Test\yunus\grammy`  
**Project B:** `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory`

## Executive summary

Project A is organized as a private application repository. Its root surface is compact: Bun package metadata, local runtime data, source/tests/docs, a built local `dist/index.js`, and Telegram/memory/autonomous-job documentation. It is not shaped for npm publication.

Project B is organized as a package/plugin repository. It has package metadata, OpenClaw manifest, CI, Docker/Hermes integration, bilingual docs, changelog, license, contribution guides, assets, package inclusion/exclusion controls, and operational scripts.

Both projects share memory-related vocabulary and TypeScript/ESM conventions, but their repository structures reflect very different goals: Project A optimizes for running one Telegram agent app; Project B optimizes for distribution and integration as a memory plugin.

## Evidence table

| Topic | Evidence |
|---|---|
| Project A package identity | `D:\Code\Test\yunus\grammy\package.json:2-5` defines `name: "grammy-openai-claude-agent-bun"`, version `0.1.0`, `private: true`, and ESM module type. |
| Project A scripts | `D:\Code\Test\yunus\grammy\package.json:6-15` defines Bun scripts for dev, build, start, test, typecheck, migrate, db reset, and memory inspection. |
| Project A dependencies | `D:\Code\Test\yunus\grammy\package.json:16-31` includes `@anthropic-ai/sdk`, `openai`, `grammy`, `@grammyjs/conversations`, `sqlite-vec`, `node-cron`, `cron-parser`, `yaml`, `zod`, Bun/TypeScript types. |
| Project A purpose | `D:\Code\Test\yunus\grammy\README.md:1-3` describes it as a grammY Telegram Agent on Bun. |
| Project A Telegram surface | `D:\Code\Test\yunus\grammy\README.md:5-11` and `D:\Code\Test\yunus\grammy\docs\architecture.md:16-26` state public commands are `/start`, `/menu`, and `/help`; deeper functionality is menu/conversation driven. |
| Project A capability summary | `D:\Code\Test\yunus\grammy\README.md:13-23` lists Bun runtime, Telegram bot, ReAct loop, project-owned memory backend, autonomous jobs, task-scoped Mermaid canvases, L4 draft skill generation, and current datetime tool. |
| Project A memory model | `D:\Code\Test\yunus\grammy\README.md:80-100` describes L0 conversations, L1 atoms, L2 scenarios, L3 persona, offload refs, task-scoped Mermaid canvases, JSONL history, SQLite, recall, and draft skills. |
| Project A key files | `D:\Code\Test\yunus\grammy\README.md:102-112` lists important source files such as `src/index.ts`, `src/bot/bot.ts`, `src/agent/react-agent.ts`, `src/cron/scheduler.ts`, `src/tools/local.ts`, and `src/db/schema.ts`. |
| Project A local run/test docs | `D:\Code\Test\yunus\grammy\README.md:114-126` documents `bun install`, `bun run dev`, `bun test`, and `bun run typecheck`. |
| Project A architecture docs | `D:\Code\Test\yunus\grammy\docs\architecture.md:1-14` identifies runtime layers and major file responsibilities. |
| Project A context offload docs | `D:\Code\Test\yunus\grammy\docs\architecture.md:60-78` describes chat/tool-result capture, JSONL history, L1 summary, L1.5 task judgment, L2 Mermaid patch, task-aware recall, and optional L4 draft skill generation. |
| Project A data ownership | `D:\Code\Test\yunus\grammy\docs\architecture.md:80-84` says durable state is stored in the project-owned backend and no longer depends on old vendor-specific workflow. |
| Project A autonomous jobs docs | `D:\Code\Test\yunus\grammy\docs\autonomous-jobs.md:1-8` describes Telegram-managed scheduled tasks through a unified scheduler. |
| Project A TypeScript config | `D:\Code\Test\yunus\grammy\tsconfig.json:2-17` uses ES2022, bundler module resolution, Bun types, strict TypeScript, and includes source/tests. |
| Project A ignored artifacts | `D:\Code\Test\yunus\grammy\.gitignore:1-12` ignores `node_modules`, `.env`, SQLite DB files, history JSONL, memory markdown, `TencentDB-Agent-Memory`, and `dist`. |
| Project B package identity | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\package.json:2-6` defines `@tencentdb-agent-memory/memory-tencentdb`, version `0.3.4`, and describes a four-layer local memory system plugin for OpenClaw. |
| Project B binaries | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\package.json:7-11` declares `migrate-sqlite-to-tcvdb`, `export-tencent-vdb`, and `read-local-memory`. |
| Project B exports | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\package.json:12-17` exports `./dist/index.mjs`. |
| Project B scripts | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\package.json:18-33` includes build, script compilation, prepack, test, coverage, and a postinstall patch script. |
| Project B published files | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\package.json:34-55` publishes `dist/`, `bin/`, `index.ts`, selected scripts, `src/`, `hermes-plugin/`, `openclaw.plugin.json`, README, changelog, and license, while excluding tests/specs. |
| Project B metadata | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\package.json:56-74` includes keywords, author, MIT license, and Node `>=22.16.0`. |
| Project B deps/peers | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\package.json:75-124` includes AI SDK/OpenAI, Tencent VDB text package, sqlite-vec, yaml, optional `opik`, peer deps `node-llama-cpp` and `openclaw`, tsdown, TypeScript, and Vitest. |
| Project B OpenClaw metadata | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\package.json:102-117` declares extension `./index.ts`, plugin/gateway compatibility, and runtime dependency staging. |
| Project B README purpose | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\README.md:27-34` describes symbolic short-term memory and layered long-term memory. |
| Project B benchmark claims | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\README.md:34-43` presents OpenClaw benchmark improvements and token reductions. |
| Project B architecture concepts | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\README.md:63-80` describes L0/L1/L2/L3, heterogeneous storage, and traceability. |
| Project B offload concepts | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\README.md:85-105` describes Mermaid symbol graph, history offloading, and `node_id` tracing. |
| Project B install docs | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\README.md:134-155` documents OpenClaw plugin install and zero-config enablement. |
| Project B layer note | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\main.md:9-23` distinguishes long-term memory `L0 -> L1 -> L2 -> L3` from offload/task-canvas `L1 -> L1.5 -> L2 -> L4`. |
| Project B plugin manifest | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\openclaw.plugin.json:1-10` identifies plugin `memory-tencentdb`, startup activation, and tool contracts `tdai_memory_search`, `tdai_conversation_search`. |
| Project B config schema | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\openclaw.plugin.json:11-120` defines backend, capture, extraction, persona, pipeline, recall, embedding, TCVDB, BM25, reporting, LLM, and offload config. |
| Project B build config | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\tsdown.config.ts:13-35` builds `./index.ts` to `./dist` as ESM Node output and externalizes dependencies/OpenClaw/Node builtins. |
| Project B test config | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\vitest.config.ts:3-26` configures Node Vitest, fork pool, coverage, includes/excludes. |
| Project B e2e config | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\vitest.e2e.config.ts:3-14` includes `**/*.e2e.test.ts`. |
| Project B CI | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\.github\workflows\pr-ci.yml:1-135` runs PR CI: install, pack validation, manifest/package metadata validation, package size guard. |
| Project B Docker | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\docker\opensource\Dockerfile.hermes:1-12` describes an all-in-one Hermes Agent + memory_tencentdb plugin + TDAI Memory Gateway image. |
| Project B Docker runtime | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\docker\opensource\Dockerfile.hermes:82-106` exposes healthcheck, port 8420, volume, and starts the gateway server with `node --import tsx/esm`. |
| Project B Hermes adapter | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\hermes-plugin\memory\memory_tencentdb\plugin.yaml:1-12` defines Hermes memory plugin metadata, hooks, and aliases. |
| Project B skill packaging | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\SKILL.md:1-16` defines an OpenClaw memory-tencentdb setup skill in Chinese. |
| Project B ctl docs | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\scripts\README.memory-tencentdb-ctl.md:1-43` documents standalone/Hermes modes, default paths, logs/config files, gateway address, and dependencies. |
| Project B npmignore/gitignore | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\.npmignore:1-22` excludes tests/env/runtime artifacts; `.gitignore:1-44` ignores dependencies, env, output, lockfiles, test/offload scripts, and release tarballs. |
| Project B changelog | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\CHANGELOG.md:7-35` documents version `0.3.4` fixes, improvements, compatibility, Docker image addition, and tests. |
| Project B contributing docs | `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\CONTRIBUTING.md:14-23` gives prerequisites and Node.js/OpenClaw runtime notes; `:38-59` lists expected structure. |

## Project A structure summary

Observed Project A structure, excluding the nested `TencentDB-Agent-Memory` reference project:

```text
D:\Code\Test\yunus\grammy
├── .claude/
│   └── settings.local.json
├── data/
│   ├── history/
│   ├── memory/
│   ├── agent.db
│   ├── agent.db-shm
│   └── agent.db-wal
├── dist/
│   └── index.js
├── docs/
│   ├── bugs/
│   ├── superpowers/
│   ├── architecture.md
│   ├── autonomous-jobs.md
│   ├── memory.md
│   └── telegram-flow.md
├── scripts/
│   └── inspect-memory.ts
├── src/
│   ├── agent/
│   ├── bot/
│   ├── cron/
│   ├── db/
│   ├── memory/
│   ├── services/
│   ├── tools/
│   ├── utils/
│   ├── config.ts
│   └── index.ts
├── tests/
│   ├── bot/
│   ├── cron/
│   ├── memory/
│   ├── repo/
│   ├── runtime/
│   ├── services/
│   └── tools/
├── .env
├── .env.example
├── .gitignore
├── bun.lock
├── package.json
├── README.md
└── tsconfig.json
```

### Project A character

- Private application repo rather than package-publishing repo.
- Runtime data exists under `data/`, including SQLite DB/WAL/SHM and history/memory directories.
- Bun lockfile and Bun-oriented scripts.
- Single built local distribution artifact observed: `dist/index.js`.
- No Project A-owned `.github`, `docker`, `assets`, `.npmignore`, `LICENSE`, `CHANGELOG`, package `files`, or package `exports` were observed.
- Docs are local and operational: architecture, memory, Telegram flow, autonomous jobs, bugs/specs.

## Project B structure summary

Observed Project B structure:

```text
D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory
├── .git/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   ├── workflows/
│   └── PULL_REQUEST_TEMPLATE.md
├── assets/
│   └── images/
├── docker/
│   └── opensource/
├── hermes-plugin/
│   └── memory/
├── scripts/
│   ├── bugfix-20260423/
│   ├── export-diagnostic.sh
│   ├── install_hermes_memory_tencentdb.sh
│   ├── memory-tencentdb-ctl.sh
│   ├── openclaw-after-tool-call-messages.patch.sh
│   ├── README.memory-tencentdb-ctl.md
│   └── setup-offload.sh
├── src/
│   ├── adapters/
│   ├── cli/
│   ├── core/
│   ├── gateway/
│   ├── offload/
│   ├── utils/
│   └── config.ts
├── .gitignore
├── .npmignore
├── CHANGELOG.md
├── CONTRIBUTING.md
├── CONTRIBUTING_CN.md
├── index.ts
├── LICENSE
├── main.md
├── openclaw.plugin.json
├── package.json
├── README.md
├── README_CN.md
├── SKILL-DIAGNOSTIC-EXPORT.md
├── SKILL-MIGRATION.md
├── SKILL.md
├── tsdown.config.ts
├── vitest.config.ts
└── vitest.e2e.config.ts
```

### Project B character

- Package/plugin repo designed for npm and OpenClaw/Hermes distribution.
- Has package metadata for publication, package exports, binaries, files whitelist, peer dependencies, optional dependencies, OpenClaw plugin metadata, CI, Docker, Hermes adapter, changelog, contribution docs, license, and assets.
- No local `dist/` or `bin/` directories were observed at scan time, even though package metadata publishes them after build.
- Larger integration surface than Project A: OpenClaw plugin manifest, Hermes plugin, Docker image, ops scripts, postinstall patching, CI manifest validation.

## Key similarities

- Both are TypeScript/ESM projects.
- Both use layered memory terminology and SQLite/vector-memory concepts.
- Both expose memory/conversation search concepts.
- Both have `scripts/` folders and project documentation.
- Both use L0/L1/L2/L3-style memory language, though they map details differently.

## Key differences

| Area | Project A | Project B |
|---|---|---|
| Primary role | Telegram AI agent application | OpenClaw/Hermes memory plugin package |
| Visibility | `private: true` | Public npm package metadata |
| Runtime | Bun | Node >=22.16, npm/OpenClaw/Hermes |
| Distribution | Minimal app distribution | npm `files`, `exports`, `bin`, CI package validation, Docker |
| Public UX | Telegram commands and inline menus | OpenClaw tools/hooks, CLI, gateway, Hermes adapter |
| Docs | App architecture and operational docs | README/README_CN, main layer note, migration/diagnostic docs, skill, contributing docs, changelog |
| CI | Not observed for Project A | GitHub PR CI present |
| Docker | Not observed for Project A | Hermes/Gateway Dockerfile present |
| Runtime data | Local DB/history/memory present | Runtime workspace ignored/not present in root |
| Package build outputs | Local `dist/index.js` exists | `dist/` and `bin/` absent pre-build |

## Notable risks and gaps

- Project A contains local `.env` and runtime DB files. `.env` was not read.
- Project A has no observed CI, package-publishing metadata, package validation, license, changelog, or Docker surface. This may be intentional because it is private.
- Project A ignores `TencentDB-Agent-Memory`, indicating the nested project is treated as a reference/external project rather than part of Project A.
- Project A ignores `dist`, but `dist/index.js` exists locally as a likely build artifact.
- Project B package metadata expects built outputs under `dist/` and `bin/`, but those directories were not observed in the working tree. This is likely normal pre-build state because `prepack` runs build.
- Project B docs may contain version drift: package version is `0.3.4`, while `scripts/README.memory-tencentdb-ctl.md` references behavior “自 0.4.x 起”.
- Project B contribution docs mention direct TypeScript runtime loading, while package metadata and CI still require build/prepack for npm publication; runtime development vs publication should be clarified.
