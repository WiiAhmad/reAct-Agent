# Changelog

This file records all notable changes to the `@tencentdb-agent-memory/memory-tencentdb` plugin. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and version numbers follow [Semantic Versioning](https://semver.org/).

---

## [0.3.5] - 2026-05-15

### 🐛 Fixes

- **Compatibility with OpenClaw v2026.5.7 zod v4 subpath**: Explicitly declares the `zod@^4.4.3` dependency, fixing the `Cannot find module zod/v4` runtime error caused when `@ai-sdk/provider-utils@4.x` requires the `zod/v4` subpath export but the host environment may hoist zod@3.x.

### ✨ Improvements

- **Reduced L1→L2 delay from 90s to 10s**: Changes the default `l2DelayAfterL1Seconds` from 90 to 10, so cold-start users no longer wait about 90 seconds to see L2 scene extraction results.

### 📖 Documentation

- Added a Docker Quick Start section to the README, explaining how to configure model URL/name environment variables.

---

## [0.3.4] - 2026-05-12

### 🐛 Fixes

- **Compatibility with empty L1 extraction output on OpenClaw versions before v2026.4.7**: Older hosts do not support `systemPromptOverride`; falls back to injecting the system prompt through `extraSystemPrompt`, ensuring the LLM acts as a data extraction assistant.
- **Redundant double HTTP calls for TCVDB hybrid recall**: `auto-recall` sent two identical `hybridSearch` requests to TCVDB, and the keyword path incorrectly passed an FTS5 OR expression into the BM25 encoder. Added a `nativeHybridSearch` fast path so TCVDB completes dense + sparse + RRF in a single call, halving recall latency (about 50-120ms).
- **Aligned the L2 parser with the Go backend**: Added a mermaid fallback and fixed `first{...last}` JSON extraction logic.

### ✨ Improvements

- **VDB HTTP request-level timing**: `tcvdb-client` now logs one info-level timing entry per request (for example, `/document/hybridSearch 85ms`), while retry/failure details remain at debug level.
- **Downgraded misleading startup logs to DEBUG**: Normal scenarios such as store manifest mismatch, sqlite schema migration, and profile-sync MD5 mismatch no longer log warn/info entries, preventing AI misinterpretation.
- **L1 extraction debug logs**: Added the `[l1-debug]` series (RESOLVE / INVOKE / RESULT / EMPTY_DUMP / ENTRY / NO_JSON) to make LLM call-chain issues easier to locate.

### 🔧 Compatibility

- **OC 2026.4.23 Zod schema compatibility patch script** (`scripts/bugfix-20260423/`): One-command fix for `allowConversationAccess` being rejected by `.strict()`, including a lightweight script, a fully automated script, and a manual SOP document.
- Removed the `Backend` prefix from Offload logs and set the default timeout to 120s.

### 🚀 New Features

- **Offload Local Mode**: Supports running offload in local mode without depending on a remote backend.
- **All-in-one Docker image** (`Dockerfile.hermes`): Bundles Hermes Agent + the memory_tencentdb plugin + TDAI Memory Gateway in a single container, driven by unified `MODEL_*` environment variables.

### ✅ Tests

- Fixed the missing `embedding` field in the `fault-injection` FI-05 mock config
- Fixed `cli.test` dependency assertions for the new dependency
- Skipped the deleted `install-plugin.sh` test in `patch-effectiveness`

---

## [0.3.3] - 2026-05-08

### 🐛 Fixes

- **Hardened hook-policy version decision logic**: Automatically writes `hooks.allowConversationAccess` only when the host version is a strict `x.y.z` semantic version and is `>= 2026.4.24`; unparseable versions such as `unknown`, beta, snapshot, and other nonstandard versions are always skipped to avoid writing invalid configuration for older or unexpected versions and causing startup failures.
- Added debug logs on the hook-policy critical path (raw version string, parsed version, minimum required version, and whether to patch) to simplify production troubleshooting.

### ✅ Tests

- Added `src/utils/ensure-hook-policy.test.ts`, covering decision cases such as standard versions, prereleases, `unknown`, and boundary values.

## [0.3.2] - 2026-05-08

### 🐛 Fixes

- Maintains compatibility with OpenClaw versions before v2026.4.23, preventing written hook configuration from breaking startup.
- Changed `allowConversationAccess` so it is added only for 2026.4.24+.

## [0.3.1-beta.1] - 2026-05-07

### 🐛 Fixes

- **Compatibility with OpenClaw v2026.4.23+ hook permission policy**: This version introduced the `allowConversationAccess` security gate ([openclaw#70786](https://github.com/openclaw/openclaw/pull/70786)), silently blocking the `agent_end` hook for non-bundled plugins and disabling the entire capture pipeline. Added `ensurePluginHookPolicy()` to detect and complete the configuration automatically, preferring SDK-triggered gateway auto-restart with fallback to manually writing the config file.
- **Compatibility with OpenClaw 2026.5.3+ install validation**: Added tsdown build configuration to generate `dist/index.mjs`, satisfying newer mandatory validation for compiled artifacts during installation (pure TypeScript entry points are no longer allowed).
- **Declared `activation.onStartup`**: Ensures the gateway loads this plugin at startup.
- **Declared `contracts.tools`**: Registers the `tdai_memory_search` and `tdai_conversation_search` tool names to satisfy the tool registration contract.

---

## [0.3.0] - 2026-05-06

### 🚀 New Features

**Operations management tool (CTL)**

- Added the `memory-tencentdb-ctl` command-line management tool, supporting both standalone and hermes run modes
- Added the `install-memory-tencentdb` one-command installation script
- Added the `config vdb-off` command to CTL, supporting Gateway storage fallback from VDB to SQLite
- Gateway installation script can write environment variables to `~/.hermes/.env` for systemd scenarios

**Offload enhancements**

- Offload automatically applies the `after_tool_call` patch on startup and disables offload automatically if patching fails
- Added the `setup-offload.sh` one-command enable/disable script for offload, supporting the `--backend-api-key` parameter
- L0 capture filtering: excludes MMD context blocks injected by offload, preventing compressed intermediate artifacts from being stored as memories

**Gateway self-healing and stability**

- Added watchdog + lazy probe mechanisms to the Hermes plugin so the Gateway recovers automatically when abnormal
- Gateway YAML configuration parsing supports arbitrary nesting depth

### ✨ Improvements

- Unified the data directory and installation directory under `~/.memory-tencentdb/`
- Introduced the `$HERMES_HOME` environment variable convention and removed hardcoded `~/.hermes` paths
- CTL hermes configuration editing is now indentation-aware, preserving the original file format
- Operations scripts remain in the tarball but are no longer registered as bin commands, reducing global command pollution
- Downgraded init/destroy lifecycle logs to debug level
- Patch scripts support pnpm installations and dynamically resolve the openclaw installation path using Node.js

### 🐛 Fixes

**Core stability**

- Fixed a race condition when `ensureSchedulerStarted` is called concurrently
- Fixed `/session/end` incorrectly destroying the global scheduler (now scoped by session_key)
- Fixed store shutdown not waiting for background fire-and-forget tasks to complete
- Fixed `disable_offload` not correctly deleting the `slots.contextEngine` configuration

**Offload**

- Fixed slot occupancy detection: reject only when `ok=false` (slot occupied); API exceptions are no longer misclassified as conflicts
- Fixed offload not being disabled when `registerContextEngine` throws
- Fixed not fully disabling all offload features when the slot is occupied

**L3 compression**

- Fixed aggressive/emergency compression getting stuck when a user message is at the head of the queue
- Fixed compression stalling after many messages are offloaded

**Migration tools**

- Fixed migration script crashes when the source data directory or SQLite database does not exist (now skips gracefully)
- Fixed config/manifest not being written when source data is empty

**Scripts and operations**

- Fixed `((VAR++))` causing script exit under `set -e` when VAR=0
- Fixed patch scripts falsely reporting FAILED counts (skip candidates without an after_tool_call context)
- Fixed Gateway child process not being terminated when Hermes exits

### ♻️ Refactors

- Unified patch detection logic: always delegate to the patch script and decide the result by exit code

---

## [0.3.0-beta.1] - 2026-04-23

### 🚀 New Features

**Short-term memory compression (Context Offload)**

- Added the Offload module, supporting context compression and memory offloading for long conversations

**Architecture refactor: Core + Gateway multi-framework support**

- Refactored to a host-independent `TdaiCore` core layer plus adapter pattern, decoupling OpenClaw framework dependencies
- Added `HostAdapter` / `LLMRunner` / `LLMRunnerFactory` abstraction interfaces, supporting LLM calls from different hosts
- Added the Hermes Gateway adapter (`memory_tencentdb` Hermes Plugin), supporting standalone operation through the Hermes framework
- `TdaiCore` provides unified APIs such as `handleBeforeRecall()` / `handleTurnCommitted()` / `searchMemories()`
- Gateway zero-config auto-discovery: the Hermes plugin automatically detects configuration and data directories
- Data-directory ownership moved from the plugin to the Gateway layer

**Recall injection optimization (cache-friendly)**

- Moved L1 recalled memories from `appendSystemContext` to `prependContext` (user-message prefix), avoiding prompt cache busts caused by system prompt changes on every turn
- Persona / Scene Navigation / Tools Guide remain in `appendSystemContext` (stable content with cache hits across consecutive turns)
- Registered the `before_message_write` hook to strip `<relevant-memories>` tags before user messages are persisted to JSONL, preventing accumulated stale recall content in message history

**Scenario-specific embedding timeouts**

- Added `embedding.recallTimeoutMs` (recall path) and `embedding.captureTimeoutMs` (capture path) configuration
- On recall timeout, the hybrid strategy automatically degrades to keyword-only search; on capture timeout, L1 dedup degrades to FTS
- Backward compatible: falls back to global `embedding.timeoutMs` when not configured

### ✨ Improvements

- CleanContextRunner replaces OpenClaw's default system prompt through `systemPromptOverride`, saving about 4500 input tokens per L1/L2/L3 call
- L2 (scene extraction) and L3 (persona generation) prompts are split into `systemPrompt` + `userPrompt`, clarifying role separation
- Adjusted pipeline defaults: `l1IdleTimeoutSeconds` 60→600s, `l2MinIntervalSeconds` 300→900s, `l2MaxIntervalSeconds` 1800→3600s

### 🐛 Fixes

- Fixed `pullProfilesToLocal` concurrent competition causing `ENOTEMPTY` errors (optimistic lock-free fix: silently use the other result when rename competition fails)
- Fixed `originalUserMessageCount` data-link breakage preventing the L0 recorder from locating polluted user messages
- Fixed `RecallResult` type definition missing the `prependContext` field (`types.ts` and `auto-recall.ts` were inconsistent)

---

## [0.2.2] - 2026-04-17

### 🐛 Fixes

- Fixed TCVDB client load failures caused by not declaring the `undici` dependency (the development environment previously relied on transitive resolution from the monorepo root `node_modules`)
- Downgraded large amounts of INFO logging during plugin registration to DEBUG, avoiding excessive irrelevant output in CLI mode

## [0.2.1] - 2026-04-16 (deprecated)

> NOTE: This version is deprecated because an undici dependency issue caused plugin startup failures.
> The issue is fixed in 0.2.2 and later versions.

### 🚀 New Features

- Added HTTPS connection support for TCVDB; a custom CA certificate PEM file can be specified through plugin configuration `caPemPath` or the migration script parameter `--tcvdb-ca-pem`
- Added L2 single-file queries to the `read-local-memory` script, and switched L0 / L1 queries to read directly from `vectors.db`, supporting SQL-level filtering, sorting, and pagination

### ✨ Improvements

- Changed the default TCVDB vector index for L0 / L1 to `DISK_FLAT`, with automatic fallback to `HNSW` on instances that do not support that index type
- Changed the default server-side embedding model to `bge-large-zh`
- Enabled `readConsistency: "strongConsistency"` for all TCVDB read APIs, eliminating read-after-write inconsistency
- Added HTTPS self-signed certificate support for VDB connections in the health-check script

### 🐛 Fixes

- Fixed L3 persona sync skipping writes due to version conflicts caused by not pulling the remote baseline
- Fixed `memories_since_last_persona` being counted by both L0 and L1, inflating the persona trigger threshold
- Removed deprecated methods from `CheckpointManager` that had been replaced by `captureAtomically()`

---

## [0.2.0] - 2026-04-15

### 🚀 New Features

**Tencent Cloud VectorDB (TCVDB) storage backend**

- Added the Tencent Cloud VectorDB storage backend, supporting vector + BM25 hybrid recall
- Supports index-structure synchronization between SQLite and TCVDB
- L2 scenes / L3 persona support two-way synchronization between local cache and the vector database
- Plugin configuration (manifest) exposes settings such as `storeBackend`, `tcvdb`, `bm25`, and `embedding.timeoutMs`

**Local BM25 keyword retrieval**

- Replaced the previous BM25 HTTP sidecar service with the local tcvdb-text encoder, removing the external dependency

**Seed data import tool**

- Added the CLI `seed` command, supporting bulk import of memories from external data
- Extracted a shared pipeline-factory for reuse by seed and normal runtime
- Supports ISO 8601 timestamp format (JSONL support removed)

**Data migration and operations tools**

- Added a SQLite → Tencent Cloud VectorDB migration script with `--help` / `-h` for complete parameter descriptions and usage examples
- Added a VDB data export script (with precompiled JS and CLI launcher)
- Added a local Memory data query script
- Registered all CLI bin entry points: `migrate-sqlite-to-tcvdb`, `export-tencent-vdb`, `read-local-memory`

**Memory search tool call limits**

- Added a combined per-turn limit of at most 3 calls for `tdai_memory_search` + `tdai_conversation_search`, using tool descriptions and recall guidance prompts to constrain model behavior and prevent ineffective repeated searches

### 🐛 Fixes

- Fixed L2 scene merge (MERGE) being unable to delete old files: OpenClaw 4.1+ write tool rejects blank content, so soft deletion is implemented with a `[DELETED]` marker and recognized/cleaned during the SceneExtractor cleanup phase
- Fixed orphaned BATCH/ARCHIVE files produced by L2 extraction; unified the maxScenes limit at 15
- Fixed repeated profile pulls during L3 startup
- Filtered skill-wrapper noise markers (`¥¥[...]¥¥`)
- Handled `createCollection` concurrent races (error code 15202)

### ♻️ Refactors

- Changed pipeline checkpoint cursor semantics from timestamp to update_at
- Runner now uses `api.runtime.agent.runEmbeddedPiAgent`, avoiding cross-environment import failures
- Unified the script build process: added one-command `build:scripts`, and the `prepack` hook now automatically compiles all script artifacts before `npm pack`

### 📖 Documentation

- Added technical documentation for the design and implementation of the AI Agent long-term memory plugin
- Added project guide and development-system layered architecture documentation
- Added VDB storage design documentation and migration guide

---

<details>
<summary>Prerelease versions</summary>

## [0.2.0-beta.1] - 2026-04-14

*The contents of this version have been merged into the official [0.2.0] release.*

</details>

## [0.1.4] - 2026-04-10

### 🚀 New Features

- *(auto-recall)* Add recall hint text before memories

## [0.1.3] - 2026-04-09

### 🚀 New Features

- *(memory-tdai)* Replace emitMetric with the reporter abstraction
- *(L3)* L3 uses read/write tools to prevent model CoT output
- *(memory)* Add embedding truncation, recall timeout, and code-block removal from L0 capture
- *(config)* Embedding timeout supports configuration
- *(report)* Expose report configuration in the schema and change the default to false

### 🐛 Fixes

- *(capture)* Skip heartbeat / scheduled task / automation / scheduler messages
- *(recall)* Clear the timeout timer when recall completes, avoiding false timeout warnings

### 💼 Other

- Rename package to memory-tencentdb
- *(deps)* Change node-llama-cpp to an optional dependency

### ⚡ Performance

- *(auto-capture)* Move L0 vector embedding to the background to reduce latency

### 📖 Documentation

- Add an allowPromptInjection configuration warning

## [0.1.2] — 2026-03-26

### ✨ Improvements

1. Optimize conversation capture and memory extraction filtering

## [0.1.1] — 2026-03-25

### 🔧 Compatibility

1. Adapt to the openclaw 2026.3.23 update

## [0.1.0] — 2026-03-25

> First official release. A local-first four-layer memory system (L0→L1→L2→L3), using SQLite + LLM to implement conversation capture, memory extraction, scene summarization, and user persona generation.

### 🚀 New Features

1. Add an FTS5 full-text index with jieba tokenization for keyword retrieval
2. When no remote embedding service is configured, embedding is disabled by default (local embedding is not used automatically, and configuration entry points that actively enable local embedding are blocked)

### ✨ Improvements

1. Optimize L2 and L3 generation prompts to control generated content size (reducing token cost)
2. Optimize file-lock usage in the pipeline scheduler
3. Avoid full reads of L0 and L1 data
