# Tooling, Testing, CI, and Operations Comparison

**Project A:** `D:\Code\Test\yunus\grammy`  
**Project B:** `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory`

## Executive summary

Project A is a Bun application. Its tooling is intentionally small: `bun` scripts for development, build, start, test, typecheck, migration, database reset, and memory inspection; a Bun lockfile; strict TypeScript; and a test tree under `tests/`.

Project B is an npm/OpenClaw package. Its tooling is more package-oriented: Node `>=22.16.0`, `tsdown`, script-specific `tsc` builds, Vitest config, coverage config, package exports/bin/files metadata, OpenClaw compatibility metadata, Docker/Hermes ops scripts, and GitHub PR CI for package validation.

The strongest contrast is quality/release posture. Project A has local test/typecheck scripts but no observed CI. Project B has CI and package validation, but the CI scan did not find test execution, and no matching TypeScript test files were found for its Vitest config.

## Package and dependency comparison

### Project A package profile

`D:\Code\Test\yunus\grammy\package.json` shows Project A as a private Bun app:

- `name`: `grammy-openai-claude-agent-bun`
- `version`: `0.1.0`
- `private`: `true`
- `type`: `module`

Scripts at `package.json:6-15`:

| Script | Command | Purpose |
|---|---|---|
| `dev` | `bun --watch src/index.ts` | Run app in watch mode |
| `build` | `bun build src/index.ts --outdir dist --target bun` | Build Bun target |
| `start` | `bun dist/index.js` | Run built app |
| `test` | `bun test` | Run Bun tests |
| `typecheck` | `bunx tsc --noEmit` | TypeScript typecheck |
| `migrate` | `bun src/index.ts --migrate-only` | Run migrations only |
| `db:reset` | `rm -f data/agent.db data/agent.db-shm data/agent.db-wal && bun src/index.ts --migrate-only` | Reset local DB then migrate |
| `memory:inspect` | `bun scripts/inspect-memory.ts` | Inspect memory state |

Runtime dependencies at `package.json:16-25`:

- `@anthropic-ai/sdk`
- `@grammyjs/conversations`
- `cron-parser`
- `grammy`
- `node-cron`
- `openai`
- `sqlite-vec`
- `yaml`
- `zod`

Dev dependencies at `package.json:27-31`:

- `@types/bun`
- `@types/node-cron`
- `typescript`

Lockfile:

- `D:\Code\Test\yunus\grammy\bun.lock` exists.

Package publication posture:

- No `main`, `exports`, `bin`, `files`, `peerDependencies`, or `optionalDependencies` were found in Project A’s package manifest.
- This matches its `private: true` app posture.

### Project B package profile

`D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory\package.json` shows Project B as a publishable plugin package:

- `name`: `@tencentdb-agent-memory/memory-tencentdb`
- `version`: `0.3.4`
- `description`: four-layer local memory system plugin for OpenClaw
- `type`: `module`
- `main`: `./dist/index.mjs`

Publication/runtime metadata:

- `main` and `exports` point to `./dist/index.mjs` at `package.json:6-17`.
- `bin` entries at `package.json:7-11`:
  - `migrate-sqlite-to-tcvdb`
  - `export-tencent-vdb`
  - `read-local-memory`
- `files` whitelist at `package.json:34-55` includes build outputs, source, scripts, Hermes plugin, manifest, README, changelog, and license while excluding tests/specs.
- `engines.node` requires `>=22.16.0` at `package.json:72-74`.
- OpenClaw metadata is declared at `package.json:102-117`.

Scripts at `package.json:18-33`:

| Script | Command | Purpose |
|---|---|---|
| `build` | `npm run build:plugin && npm run build:scripts` | Build package and helper scripts |
| `build:plugin` | `tsdown` | Build main plugin |
| `build:scripts` | runs script builds | Build CLI/helper scripts |
| `prepack` | `npm run build` | Build before npm pack |
| `migrate-sqlite-to-tcvdb` | `node ./bin/migrate-sqlite-to-tcvdb.mjs` | Migration binary wrapper |
| `export-tencent-vdb` | `node ./bin/export-tencent-vdb.mjs` | Export binary wrapper |
| `read-local-memory` | `node ./bin/read-local-memory.mjs` | Local memory reader binary wrapper |
| `test` | `vitest run` | Run Vitest tests |
| `test:watch` | `vitest` | Watch mode |
| `test:coverage` | `vitest run --coverage` | Coverage |
| `postinstall` | `bash scripts/openclaw-after-tool-call-messages.patch.sh 2>/dev/null || true` | Patch script after install |

Runtime dependencies at `package.json:75-86`:

- `@ai-sdk/openai`
- `@node-rs/jieba`
- `@tencentdb-agent-memory/tcvdb-text`
- `ai`
- `js-tiktoken`
- `json5`
- `sqlite-vec`
- `tsx`
- `undici`
- `yaml`

Optional dependency:

- `opik` at `package.json:87-89`.

Peer dependencies:

- `node-llama-cpp`
- `openclaw >=2026.3.7`

Peer metadata marks both optional at `package.json:94-101`.

Lockfile:

- No root `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, or `bun.lock` was found in Project B during the scan.

## Build and TypeScript setup

### Project A

- Build command is Bun-native: `bun build src/index.ts --outdir dist --target bun`.
- Typecheck command is `bunx tsc --noEmit`.
- `tsconfig.json:2-17` uses:
  - ES2022 target
  - ESM module
  - bundler module resolution
  - strict mode
  - Bun types
  - `src/**/*.ts` and `tests/**/*.ts` includes

### Project B

- Main plugin build uses `tsdown`.
- `tsdown.config.ts:13-35` builds `./index.ts` to `./dist`, ESM format, Node platform, and externalizes dependencies/OpenClaw/Node builtins.
- Script binaries use `tsc --project` against script-specific tsconfig paths.
- The tooling scan reported a risk: `package.json` references script tsconfig paths such as `scripts/migrate-sqlite-to-tcvdb/tsconfig.json`, but no matching `tsconfig*.json` files were found under the scanned Project B `scripts` tree.

## Test coverage and test domains

### Project A tests

Test runner:

- `bun test` at `package.json:10`.

Test tree:

- 30 TypeScript test files were found under `D:\Code\Test\yunus\grammy\tests`.

Major visible test domains:

| Domain | Examples |
|---|---|
| Bot UI and commands | menu/help/start behavior, callback rendering, conversation pass-through |
| Cron/autonomous jobs | scheduler helpers, autonomous job dispatch, due job handling |
| Services | autonomous job service, schedule parsing, memory update settings |
| Memory pipeline | L1/L1.5/L2/L4, recall, task recall, JSONL history, offload, sqlite-vec |
| Repositories/runtime | prompt behavior, old MCP/runtime/repo support removal |
| Tools | local tool behavior, current datetime, memory search/status |

Evidence examples from scan:

- `tests\cron\autonomous-helpers.test.ts:14-360`
- `tests\services\autonomous-jobs.test.ts:12-168`
- `tests\bot\ui.test.ts:23-65`
- `tests\memory\pipeline.test.ts:36-321`
- `tests\memory\offload.test.ts:26-364`

Coverage tooling:

- No coverage script/config was found in Project A.

### Project B tests

TypeScript test runner:

- `vitest run`, `vitest`, and `vitest run --coverage` at `package.json:29-31`.

Vitest config:

- `vitest.config.ts:4-24` configures Node environment, fork pool, timeouts, coverage provider V8, source includes/excludes.
- It includes `src/**/*.test.ts` and `__tests__/**/*.test.ts`.
- It excludes `dist/**`, `node_modules/**`, and `**/*.e2e.test.ts`.

E2E config:

- `vitest.e2e.config.ts:4-13` includes `**/*.e2e.test.ts`.
- No package script was found that directly invokes this e2e config.

Actual TS tests found:

- 0 matching `*.test.ts` or `*.spec.ts` files were found during the scan.

Python/Hermes tests found:

- `hermes-plugin\memory\memory_tencentdb\tests\test_gateway_shutdown_leak.py`
- `hermes-plugin\memory\memory_tencentdb\tests\test_memory_tencentdb_recovery.py`

Visible Python test domains:

- Gateway shutdown/leak behavior.
- Supervisor lifecycle.
- Recovery/watchdog behavior.
- Prefetch/tool-call recovery.
- Idempotent shutdown.
- WAL checkpoint/SIGTERM behavior.

Evidence:

- `hermes-plugin\memory\memory_tencentdb\tests\test_gateway_shutdown_leak.py:321-603`
- `hermes-plugin\memory\memory_tencentdb\tests\test_memory_tencentdb_recovery.py:202-432`

Coverage/testing gap:

- CI did not appear to run `npm test`, `npm run test:coverage`, or the Python tests.
- Vitest config exists, but matching TS test files were not found.

## CI, release, and package validation

### Project A

No Project A-owned `.github` workflow was found in the root scan.

Observed quality gates are local scripts:

- `bun test`
- `bunx tsc --noEmit`

No observed:

- lint script/config
- format script/config
- coverage script/config
- GitHub CI workflow
- release workflow
- package validation gate
- package size guard

### Project B

GitHub PR CI exists at `.github\workflows\pr-ci.yml`.

CI behavior:

- Runs on pull requests to `main`.
- Uses Node 22.
- Installs with `npm install --ignore-scripts`.
- Runs `npm pack --dry-run` and `npm pack`.
- Uploads tarball artifact.
- Validates `openclaw.plugin.json`.
- Validates `package.json` OpenClaw metadata.
- Enforces a 512 KB package size guard.

Evidence:

- Trigger/concurrency: `.github\workflows\pr-ci.yml:1-10`
- Install: `.github\workflows\pr-ci.yml:14-33`
- Pack: `.github\workflows\pr-ci.yml:36-64`
- Manifest/package metadata validation: `.github\workflows\pr-ci.yml:67-105`
- Size guard: `.github\workflows\pr-ci.yml:108-134`

Not observed in CI:

- `npm test`
- `npm run test:coverage`
- Python/Hermes test execution
- TypeScript typecheck separate from build, unless indirectly covered by build/package behavior

## Env/config and operations

### Project A runtime/config

Project A config is `.env` and source-config driven.

`.env.example:1-67` documents:

- Telegram bot token/admin IDs.
- LLM provider selection.
- OpenAI/Anthropic settings.
- Agent iteration/history limits.
- timezone/locale.
- storage paths.
- memory layers/pipeline/offload settings.
- autonomous loop settings.

`src\config.ts:37-136` parses defaults and runtime config.

`src\config.ts:226-266` validates required credentials:

- `BOT_TOKEN` is required.
- OpenAI credentials are required when `LLM_PROVIDER=openai`.
- Anthropic credentials are required when `LLM_PROVIDER=anthropic`.

Operational scripts:

- `migrate`
- `db:reset`
- `memory:inspect`

Project A creates storage directories at startup from config paths at `src\config.ts:141-154`.

### Project B runtime/config

Project B has a schema-based plugin config in `openclaw.plugin.json:11-160`, including:

- backend selection
- capture
- extraction
- persona
- pipeline
- recall
- embedding
- TCVDB
- BM25
- reporting
- LLM
- offload

`src\config.ts:293-541` parses plugin config/defaults.

Gateway config uses env vars documented in source:

- `TDAI_GATEWAY_PORT`
- `TDAI_GATEWAY_HOST`
- `TDAI_DATA_DIR`
- `TDAI_LLM_BASE_URL`
- `TDAI_LLM_API_KEY`
- `TDAI_LLM_MODEL`
- `TDAI_LLM_MAX_TOKENS`
- `TDAI_LLM_TIMEOUT_MS`
- `TDAI_GATEWAY_CONFIG`
- `MEMORY_TENCENTDB_ROOT`

Evidence:

- `src\gateway\config.ts:76-105` reads gateway/data/LLM/memory config.
- `src\gateway\config.ts:116-134` resolves config path.
- `src\gateway\config.ts:137-172` resolves default data dir.
- `src\gateway\config.ts:202-229` expands `${VAR}` placeholders.

Docker runtime:

- `docker\opensource\Dockerfile.hermes:21-27` installs system deps/Node 22.
- `docker\opensource\Dockerfile.hermes:34-36` installs package.
- `docker\opensource\Dockerfile.hermes:67-80` defines model/gateway env defaults.
- `docker\opensource\Dockerfile.hermes:82-86` defines healthcheck, exposed port, and volume.
- `docker\opensource\Dockerfile.hermes:92-106` defines runtime command.

Operational scripts:

- `scripts\install_hermes_memory_tencentdb.sh`
- `scripts\memory-tencentdb-ctl.sh`
- `scripts\setup-offload.sh`
- `scripts\export-diagnostic.sh`
- `scripts\openclaw-after-tool-call-messages.patch.sh`
- `scripts\README.memory-tencentdb-ctl.md`

## Detailed comparison table

| Area | Project A | Project B |
|---|---|---|
| Package manager | Bun | npm/Node |
| Lockfile | `bun.lock` exists | No root lockfile found |
| Runtime engine | Bun | Node >=22.16 |
| Build command | `bun build` | `tsdown` + `tsc` script builds |
| Start command | `bun dist/index.js` | Plugin package plus gateway script/runtime |
| Test runner | `bun test` | Vitest; Python tests present separately |
| TS config | Strict TypeScript, Bun types | tsdown config, Vitest config, script tsconfigs referenced |
| Coverage | Not observed | `vitest run --coverage` configured |
| CI | Not observed | PR CI validates package/manifest/metadata/size |
| Package publication | Not intended/private | Full package exports/bin/files metadata |
| OpenClaw metadata | Not present | Present in `package.json` and `openclaw.plugin.json` |
| Docker | Not observed | Hermes/Gateway Dockerfile |
| Ops scripts | Minimal memory inspection/migration/reset | Multiple install/control/offload/diagnostic scripts |
| Env config | `.env.example` + `src/config.ts` | plugin schema + gateway env config + Docker env defaults |

## Risks and gaps

### Project A

- No visible CI/release workflow.
- No lint/format/coverage setup found.
- Local quality gates exist but are manual unless external CI exists outside the scanned root.
- No package validation gates, which is acceptable for private app posture but risky if distribution is added later.
- `db:reset` uses `rm -f`, which is POSIX-style and may not work in plain Windows PowerShell unless run under a compatible shell.
- Real `.env` exists but was not read; secrets should remain ignored and uncommitted.

### Project B

- No root lockfile found; dependency reproducibility may vary.
- CI does not appear to run tests or coverage.
- Vitest config/scripts exist, but no matching TypeScript test files were found.
- Python Hermes tests exist, but no discovered npm/CI invocation runs them.
- Package scripts reference script-specific tsconfig files that were not found during scan; `prepack` could fail if those paths are genuinely missing.
- `postinstall` uses `bash`; Windows consumers may rely on the `|| true` fallback to avoid hard failure.
- Package size guard is strict at 512 KB; including source/docs/scripts/Hermes files means packaging changes can fail CI unexpectedly.

## Suggested quality-gate improvements

### For Project A

1. Add CI that runs `bun test` and `bunx tsc --noEmit`.
2. Consider coverage if memory/offload/autonomous-job behavior becomes critical.
3. Consider a Windows-safe alternative for `db:reset`, or document the shell requirement.
4. Add a small package/docs validation step if this app is ever deployed through CI.

### For Project B

1. Add `npm test` or equivalent Vitest execution to PR CI.
2. Add Python test execution or explicitly document why Python/Hermes tests are out of CI scope.
3. Add or restore TS tests matching `vitest.config.ts` includes.
4. Add a root lockfile if reproducible npm CI installs matter.
5. Verify script build tsconfig paths before relying on `prepack`.
6. Clarify postinstall behavior on Windows and non-bash environments.
