# Source Architecture Comparison

**Project A:** `D:\Code\Test\yunus\grammy`  
**Project B:** `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory`

## Executive summary

Project A is a Telegram-first Bun/TypeScript agent application. Its architecture centers on one runtime composition root that initializes SQLite, the LLM provider, memory service, Telegram bot, local tools, autonomous job service, memory update settings, and scheduler loop in one process.

Project B is a host-neutral OpenClaw/Hermes/Gateway memory plugin. Its architecture separates a reusable `TdaiCore` facade from host adapters and storage backends. OpenClaw registration, gateway HTTP routes, Hermes Python client, context offload, and storage implementations all wrap or delegate to that core memory subsystem.

The main flow in Project A is:

```text
Telegram message or scheduled job
  -> ReAct agent
  -> local tool registry
  -> project-owned memory service
  -> SQLite-backed layered memory/offload/task-canvas persistence
```

The main flow in Project B is:

```text
OpenClaw hook or HTTP/Hermes gateway request
  -> TdaiCore facade
  -> auto-recall / auto-capture / search / pipeline manager
  -> IMemoryStore
  -> JSONL/files + SQLite or Tencent Cloud VectorDB
```

## Project A source architecture

### Runtime composition

Project A’s primary entrypoint is `D:\Code\Test\yunus\grammy\src\index.ts`.

Key startup responsibilities:

- Initializes database and supports migration-only mode at `src\index.ts:14-20`.
- Validates runtime config and creates the LLM provider at `src\index.ts:22-25`.
- Creates memory service from SQLite database, LLM provider, storage config, and memory config at `src\index.ts:26-46`.
- Constructs local tool registry, autonomous job service, and memory update settings service at `src\index.ts:47-49`.
- Creates the Telegram bot and registers local tools at `src\index.ts:51-54`.
- Starts the unified scheduler loop for autonomous jobs and memory updates at `src\index.ts:55-78`.
- Starts the Telegram bot and handles shutdown at `src\index.ts:80-91`.

Configuration is `.env` driven. `src\config.ts:37-136` defines Telegram, LLM, storage, memory-layer, autonomous-job, and scheduler settings. `src\config.ts:141-154` creates configured data directories at startup.

### Telegram integration

Telegram is Project A’s primary host boundary.

`src\bot\bot.ts` creates a grammY `Bot`, registers conversations, commands, callback handlers, and text handling:

- Bot dependencies are memory, registry, LLM provider, autonomous jobs, and memory update settings at `src\bot\bot.ts:22-28`.
- Bot construction and conversation registration happen at `src\bot\bot.ts:126-133`.
- Public commands `/start`, `/menu`, and `/help` are registered at `src\bot\bot.ts:135-157`.
- Memory summary and scheduled-job callback screens are handled at `src\bot\bot.ts:169-234`.
- Non-command text messages invoke the ReAct agent at `src\bot\bot.ts:237-259`, then split/send the answer at `src\bot\bot.ts:261-270`.

UI and conversation modules live under:

- `src\bot\conversations\*.ts`
- `src\bot\ui\keyboards.ts`
- `src\bot\ui\renderers.ts`

### ReAct agent flow

Project A’s agent loop is in `src\agent\react-agent.ts`.

Core flow:

1. Log the user message into memory at `src\agent\react-agent.ts:76-81`.
2. Run L1.5 task-turn judgment at `src\agent\react-agent.ts:82-96`.
3. Fetch recent messages and layered recall in parallel at `src\agent\react-agent.ts:98-101`.
4. Format recall as L3 persona, L2 scenarios, L1 atoms, L0 evidence, active task canvas, and historical task canvases at `src\agent\react-agent.ts:23-54`.
5. Build system and memory-context messages at `src\agent\react-agent.ts:117-127`.
6. Run iterative tool-calling against the selected LLM provider at `src\agent\react-agent.ts:134-240`.
7. Log assistant final answer at `src\agent\react-agent.ts:154-169`.
8. For each tool call, log the call, execute through `ToolRegistry`, offload or summarize the tool result, append a tool observation, and log the result at `src\agent\react-agent.ts:174-229`.

Autonomous mode filters out tools that could recursively create jobs or directly send Telegram messages at `src\agent\react-agent.ts:129-132`.

### Local tool registry

Project A uses a local DB-backed tool registry:

- `ToolRegistry` stores tool metadata and dispatches calls at `src\tools\registry.ts:6-55`.
- Local tools are defined in `src\tools\local.ts:50-264`.

Important local tools:

| Tool | Purpose | Evidence |
|---|---|---|
| `tdai_memory_search` | Search persona, scenarios, atoms, conversations, task canvases | `src\tools\local.ts:52-81` |
| `tdai_conversation_search` | Search raw conversation history | `src\tools\local.ts:83-98` |
| `tdai_context_ref_read` | Read offloaded refs | `src\tools\local.ts:100-114` |
| `tdai_memory_status` | Inspect memory/backend state | `src\tools\local.ts:116-127` |
| `save_memory` | Save a durable L1 atom | `src\tools\local.ts:130-150` |
| `tdai_create_job` | Create scheduled Telegram jobs | `src\tools\local.ts:166-239` |
| `telegram_send_message` | Send Telegram messages from autonomous flow | `src\tools\local.ts:242-261` |

### Memory service and backend boundary

Project A’s memory service is an application facade over several memory subsystems:

- `MemoryBackend` interface: `src\memory\core\backend.ts:36-91`.
- `MemoryService` facade: `src\memory\core\service.ts:134-517`.
- SQLite backend implementation: `src\memory\backends\sqlite\backend.ts:192-260`.
- Factory composition: `src\memory\integration\factory.ts:101-152`.

The backend contract is broad. It covers interaction events, conversation turns, L1 atoms, L2 scenarios, persona, lineage links, task canvases, offload refs, task graph nodes, L1 evidence, generated skills, and pipeline checkpoints.

SQLite schema responsibilities include:

- Tool registry and autonomous/memory-update tables: `src\db\schema.ts:32-77`.
- Memory atoms, FTS, scenarios, personas, pipeline state, offload refs, task nodes, and run logs: `src\db\schema.ts:79-158`.

### Recall

`RecallService.recall()` merges several memory sources:

- Persona, keyword atoms, vector atoms, scenarios, conversations, active task canvas, and historical task canvases are fetched at `src\memory\recall\service.ts:44-56`.
- Keyword/vector atom results are merged and historical task canvases are formatted at `src\memory\recall\service.ts:58-107`.

This recall snapshot is then formatted into the ReAct agent context.

### Memory maintenance pipeline

Project A has a conversation maintenance pipeline coordinated by `PipelineCoordinator`:

- Reads per-user checkpoint and pending turns at `src\memory\pipeline\coordinator.ts:24-37`.
- Runs L1 extraction from pending conversation text at `src\memory\pipeline\coordinator.ts:39-54`.
- Runs L2 scenario generation from atoms at `src\memory\pipeline\coordinator.ts:62-77`.
- Runs L3 persona update from the L2 scenario at `src\memory\pipeline\coordinator.ts:78-86`.

Layer files:

- L1 extracts JSON memory atoms and lineage at `src\memory\pipeline\l1.ts:42-99`.
- L2 turns atoms into a scenario snapshot at `src\memory\pipeline\l2.ts:10-47`.
- L3 distills scenario markdown into persona at `src\memory\pipeline\l3.ts:5-36`.

### Tool-result offload and task canvas pipeline

Tool results are processed immediately by `OffloadService` during the agent loop.

Key behavior:

- Generates semantic L1 evidence for every tool result when enabled at `src\memory\offload\service.ts:68-80`.
- For small results, stores a task graph node and L1 evidence, then updates task canvas at `src\memory\offload\service.ts:82-102`.
- For large results, writes a markdown ref, records metadata, and returns a compact `[memory-offload]` observation at `src\memory\offload\service.ts:104-189`.
- Persists L1 evidence and optional JSONL export at `src\memory\offload\service.ts:192-246`.
- Updates task Mermaid canvas by LLM-generated L2 patch or fallback graph rendering at `src\memory\offload\service.ts:272-337`.
- Fallback graph rendering is at `src\memory\offload\service.ts:371-386`.

Project A also has L4 generated skill drafts:

- `MemoryService.generateSkillDraft()` reads task canvas and task graph nodes, generates/validates a skill draft, writes it, and records metadata at `src\memory\core\service.ts:444-510`.

### Scheduler and autonomous jobs

Project A’s unified scheduler is in `src\cron\scheduler.ts`:

- `dispatchSchedulerTick()` lists due autonomous jobs first, then due memory-update users with remaining capacity at `src\cron\scheduler.ts:22-49`.
- `startSchedulerLoop()` uses `node-cron`, a busy flag, and tick result logging at `src\cron\scheduler.ts:57-90`.

Autonomous runtime:

- `runOneAutonomousJob()` marks a run started, optionally sends fixed hybrid text, runs the agent in autonomous mode, sends result to Telegram, and updates job state at `src\cron\autonomous.ts:140-178`.
- `runOneMemoryUpdateNow()` marks memory update running, calls `memory.runMaintenanceForUser(..., force=true)`, emits progress, and records status at `src\cron\autonomous.ts:180-229`.

Repository-style services:

- `AutonomousJobService`: schedule normalization, CRUD, due-job listing, run status, deletion at `src\services\autonomous-jobs.ts:128-260`.
- `MemoryUpdateSettingsService`: per-user settings, due-user discovery, status, rendering at `src\services\memory-update-settings.ts:62-208`.

## Project B source architecture

### Package and plugin entrypoints

Project B is published as `@tencentdb-agent-memory/memory-tencentdb` with OpenClaw plugin metadata and CLI bins in `package.json`.

Important package signals:

- Main module is `./dist/index.mjs` at `package.json:5-17`.
- OpenClaw extension points to `./index.ts` at `package.json:102-117`.
- Dependencies include AI SDK/OpenAI, jieba, TencentDB vector text package, sqlite-vec, and optional `opik` at `package.json:75-89`.
- Peer dependencies include OpenClaw and node-llama-cpp at `package.json:90-100`.

The OpenClaw plugin manifest is `openclaw.plugin.json`:

- Startup activation at `openclaw.plugin.json:1-7`.
- Tool contracts for `tdai_memory_search` and `tdai_conversation_search` at `openclaw.plugin.json:8-10`.
- Config schema for store backend, capture, extraction, persona, pipeline, recall, embedding, TCVDB, BM25, report, LLM, and offload at `openclaw.plugin.json:11-160`.

### OpenClaw plugin shell

`index.ts` is a plugin shell around `TdaiCore`.

It documents its purpose as a v3.1 shell that registers tools/hooks, translates OpenClaw events, and delegates memory logic to `src/core/tdai-core.ts` at `index.ts:1-19`.

Main composition:

- `register(api)` starts at `index.ts:130`.
- Config is parsed from `api.pluginConfig` at `index.ts:142-167`.
- Hook policy auto-patching is handled at `index.ts:169-212`.
- Plugin data dir is resolved under OpenClaw runtime state at `index.ts:219-222`.
- `OpenClawHostAdapter` and `TdaiCore` are created at `index.ts:224-242`.
- `core.initialize()` is started asynchronously, and profile pull from remote store is attempted after store init at `index.ts:244-258`.
- Metrics/reporter instance ID is initialized at `index.ts:260-268`.
- Optional daily local cleaner starts as a singleton at `index.ts:270-288`.

### Host-neutral `TdaiCore`

`TdaiCore` is the central facade.

Design intent:

- It is described as the single entry point for recall, capture, search, and pipeline management, depending on abstract interfaces rather than a specific host at `src\core\tdai-core.ts:1-20`.

Core state and lifecycle:

- Holds host adapter, config, logger, data dir, LLM runner factory, session filter, optional vector store, embedding service, scheduler, store readiness, and background tasks at `src\core\tdai-core.ts:75-123`.
- Constructor resolves runtime dependencies from host adapter at `src\core\tdai-core.ts:125-133`.
- `initialize()` creates directories, stores, and pipeline manager at `src\core\tdai-core.ts:143-164`.
- `destroy()` drains scheduler, background tasks, vector store, embedding service, and store caches at `src\core\tdai-core.ts:169-234`.

Core public methods:

| Method | Role | Evidence |
|---|---|---|
| `handleBeforeRecall()` | OpenClaw before-prompt or Hermes prefetch recall | `src\core\tdai-core.ts:240-259` |
| `handleTurnCommitted()` | OpenClaw agent_end or Hermes sync_turn capture | `src\core\tdai-core.ts:261-284` |
| `searchMemories()` | Tool/API memory search | `src\core\tdai-core.ts:286-306` |
| `searchConversations()` | Tool/API conversation search | `src\core\tdai-core.ts:308-326` |
| `handleSessionEnd()` | Scoped per-session flush | `src\core\tdai-core.ts:328-364` |

Host contracts are defined in `src\core\types.ts`:

- Logger, runtime context, LLM runner, LLM runner factory, and host adapter contracts at `src\core\types.ts:13-166`.
- `CompletedTurn`, `RecallResult`, and `CaptureResult` at `src\core\types.ts:168-226`.

### OpenClaw tools and hooks

Tools:

- `tdai_memory_search` registered at `index.ts:320-406`.
- `tdai_conversation_search` registered at `index.ts:408-488`.

Hooks:

- `before_prompt_build` performs auto-recall, caches original prompts, records timing, calls `core.handleBeforeRecall()`, and returns injected context at `index.ts:497-583`.
- `before_message_write` strips injected `<relevant-memories>` before persistence at `index.ts:586-622`.
- `agent_end` performs auto-capture and pipeline notification via `core.handleTurnCommitted()` at `index.ts:624-728`.
- `gateway_stop` performs cleanup through `core.destroy()` at `index.ts:730-777`.
- Optional context offload registers when `cfg.offload.enabled` at `index.ts:798-811`.
- CLI command registration is at `index.ts:813-831`.

### Auto-recall

`src\core\hooks\auto-recall.ts` implements recall injection.

Key behavior:

- Searches L1 memories with keyword, embedding, or hybrid strategy, and injects L3 persona and L2 scene navigation at `src\core\hooks\auto-recall.ts:1-11`.
- Wraps recall in a timeout to avoid blocking user work at `src\core\hooks\auto-recall.ts:74-102`.
- Chooses recall strategy from config at `src\core\hooks\auto-recall.ts:117-143`.
- Reads persona from `persona.md` at `src\core\hooks\auto-recall.ts:145-157`.
- Loads scene navigation from scene index at `src\core\hooks\auto-recall.ts:159-171`.
- Splits stable context from dynamic L1 memories for prompt caching at `src\core\hooks\auto-recall.ts:187-241`.

### Auto-capture and L0

`src\core\hooks\auto-capture.ts` records L0 and notifies the pipeline manager.

Key behavior:

- Records L0 locally and notifies `MemoryPipelineManager`; extraction is not directly triggered in the hook at `src\core\hooks\auto-capture.ts:1-11`.
- Uses `CheckpointManager.captureAtomically()` to avoid duplicate concurrent capture at `src\core\hooks\auto-capture.ts:98-147`.
- Supports metadata-first deferred embeddings for SQLite and synchronous embedding/upsert for remote/VDB stores at `src\core\hooks\auto-capture.ts:149-244`.
- Registers background embedding tasks for safe shutdown at `src\core\hooks\auto-capture.ts:245-296`.
- Notifies scheduler after capture/vector indexing at `src\core\hooks\auto-capture.ts:302-327`.

### Memory pipeline manager

Project B’s `MemoryPipelineManager` is a complex asynchronous per-session scheduler.

Architecture comments describe:

- L0 capture, L1 batch extraction, L2 scene extraction, and L3 persona generation at `src\utils\pipeline-manager.ts:1-28`.
- L1 trigger paths, L2 trigger paths, and warm-up mode at `src\utils\pipeline-manager.ts:42-73`.

Runtime behavior:

- Serial queues for L1, L2, and L3 at `src\utils\pipeline-manager.ts:196-238`.
- Restores checkpoint state and recovers pending sessions at startup at `src\utils\pipeline-manager.ts:304-336`.
- `notifyConversation()` increments per-session count, buffers messages, persists state, triggers L1 on threshold, or arms idle timer at `src\utils\pipeline-manager.ts:377-437`.
- `flushSession()` is scoped per session and avoids destroying shared scheduler state at `src\utils\pipeline-manager.ts:443-503`.
- `destroy()` attempts bounded flush and persists state for recovery at `src\utils\pipeline-manager.ts:505-557`.
- L1 enqueue/run/retry behavior is at `src\utils\pipeline-manager.ts:621-748`.
- L2 delayed timer, cold-session handling, queueing, and L3 trigger are at `src\utils\pipeline-manager.ts:754-923`.
- L3 deduped global queue is at `src\utils\pipeline-manager.ts:929-981`.

Layer implementations:

- L1 extraction: `src\core\record\l1-extractor.ts:1-13`, `:126-293`.
- L1 dedup: `src\core\record\l1-dedup.ts:37-143`.
- L1 writer: `src\core\record\l1-writer.ts:1-17`, record shape at `:47-72`.
- L2 scene extractor: `src\core\scene\scene-extractor.ts:1-17`, tool-enabled sandbox flow at `:205-220`.
- L3 persona generator: `src\core\persona\persona-generator.ts:63-210`.

### Persistence/store layer

Project B uses `IMemoryStore`, which is narrower and more backend-agnostic than Project A’s `MemoryBackend`.

- Capability flags for vector, FTS, native hybrid, and sparse vectors: `src\core\store\types.ts:178-194`.
- L1/L0/profile lifecycle/search contracts: `src\core\store\types.ts:220-300`.
- Store factory supports `sqlite` and `tcvdb`: `src\core\store\factory.ts:1-8`.
- TCVDB store creation: `src\core\store\factory.ts:50-88`.
- SQLite store creation and optional embedding service: `src\core\store\factory.ts:90-125`.

SQLite store:

- Manages L1 records, L1 vec, L0 conversations, and L0 vec tables at `src\core\store\sqlite.ts:1-21`.
- Uses Node 22 `node:sqlite`, sqlite-vec, WAL, and transactions at `src\core\store\sqlite.ts:14-20`.
- Includes Chinese FTS tokenization via jieba fallback at `src\core\store\sqlite.ts:148-260`.

TCVDB store:

- Uses server-side dense embedding, client-side sparse BM25 vectors, native hybrid search, and scalar filters at `src\core\store\tcvdb.ts:1-12`.
- Defines L1, L0, and profile collection names at `src\core\store\tcvdb.ts:53-80`.
- Initializes via HTTP client and tracks degraded state at `src\core\store\tcvdb.ts:119-176`.

Embedding service:

- Defines remote OpenAI-compatible and local node-llama-cpp embedding providers at `src\core\store\embedding.ts:1-14`.
- Local embedding service uses embeddinggemma and non-blocking warmup at `src\core\store\embedding.ts:117-220`.

### Gateway and Hermes integration

`src\gateway\server.ts` exposes a standalone gateway:

- Endpoints: `/health`, `/recall`, `/capture`, `/search/memories`, `/search/conversations`, `/session/end`, `/seed` at `src\gateway\server.ts:1-14`.
- Constructs `StandaloneHostAdapter` and `TdaiCore` at `src\gateway\server.ts:99-124`.
- Starts/stops HTTP server plus core lifecycle at `src\gateway\server.ts:129-165`.
- Routes requests at `src\gateway\server.ts:171-211`.
- `/recall` maps to `core.handleBeforeRecall()` at `src\gateway\server.ts:230-250`.
- `/capture` maps to `core.handleTurnCommitted()` at `src\gateway\server.ts:252-280`.
- Search/session/seed handlers are at `src\gateway\server.ts:282-435`.
- CLI auto-start is at `src\gateway\server.ts:442-467`.

Hermes Python client:

- Handles gateway requests with timeout/retry/error handling at `hermes-plugin\memory\memory_tencentdb\client.py:1-4`.
- Provides `recall`, `capture`, `search_memories`, `search_conversations`, `end_session`, and `seed` at `hermes-plugin\memory\memory_tencentdb\client.py:63-150`.

### Context offload

Project B’s optional offload subsystem is registered only when enabled at `index.ts:798-811`.

Key areas:

- Config and backend/local client selection: `src\offload\index.ts:256-375`.
- Hook registration for `before_tool_call`, `after_tool_call`, `llm_output`, `llm_input`, `before_agent_start`, and `before_prompt_build`: `src\offload\index.ts:976-1144`.
- Context engine singleton and hot-reload updates: `src\offload\index.ts:1146-1203`.
- Retention/reclaim scheduling for offload artifacts: `src\offload\index.ts:1205-1239`.

## Component-by-component comparison

| Component | Project A | Project B | Difference |
|---|---|---|---|
| Product shape | Telegram bot app with runtime composition in `src\index.ts:14-92` | OpenClaw plugin/library with `index.ts:130-837` and `TdaiCore` | A is an app; B is reusable infrastructure |
| Runtime host | Telegram via grammY | OpenClaw hooks, standalone HTTP gateway, Hermes client | A has one host; B abstracts multiple hosts |
| Composition root | Wires concrete DB/LLM/memory/tools/bot/scheduler directly | Creates host adapter and `TdaiCore` | B separates host from core more cleanly |
| Core facade | `MemoryService` owns recall/logs/task/offload/skills/maintenance | `TdaiCore` owns recall/capture/search/session/store lifecycle | Similar facade pattern, different host binding |
| Agent loop | Own ReAct loop in `src\agent\react-agent.ts` | No full chat loop; augments host agent | A runs the agent; B assists a host agent |
| Tool surface | Local registry plus memory/jobs/Telegram tools | OpenClaw memory/conversation tools | A has broad app tools; B has focused memory tools |
| Persistence | Broad app-specific `MemoryBackend`, concrete SQLite | Narrower `IMemoryStore`, SQLite or TCVDB | B is more backend-agnostic |
| Memory pipeline | Scheduled/forced maintenance plus immediate offload | Event-driven per-session pipeline scheduler | Different trigger model |
| L2 | Scenarios plus task Mermaid canvases | Scene block files and navigation | Same layer number, different abstraction |
| L4 | Draft skill generation from task canvas/evidence | Conceptual/offload-related skill command paths | A appears more productized for local drafts |
| Scheduler | Cron tick for due jobs and memory updates | Per-session pipeline timers/queues | A schedules user jobs; B schedules memory processing |
| Shutdown | Bot stop and DB close | Core destroy drains scheduler/background tasks/stores | B has more lifecycle complexity |

## Shared concepts

- Layered memory: L0 conversations, L1 structured memories/evidence, L2 scenario/scene/task abstraction, L3 persona.
- Memory search and conversation search tools.
- Persona/context injection.
- Keyword/vector/hybrid-style retrieval concepts.
- Context offload and compact references for large tool/runtime artifacts.

## Major divergences

### Application-owned vs host-neutral

Project A owns the full Telegram runtime and agent loop. Project B is designed as a host-neutral plugin/core, then wrapped by OpenClaw, Gateway, and Hermes adapters.

### Trigger model

Project A runs memory maintenance by schedule/manual action and offloads tool results inline during agent execution. Project B captures turns through hooks/API calls and schedules L1/L2/L3 work per session with thresholds, idle timers, queues, and recovery.

### Storage model

Project A has a broad, project-owned SQLite memory backend that stores app-specific task/offload/autonomous state. Project B has a narrower `IMemoryStore` for memory records/conversations/profiles, with SQLite and Tencent Cloud VectorDB implementations.

### User identity/session model

Project A uses Telegram `chatId` and `userId`. Project B uses `sessionKey`, `sessionId`, host runtime context, and default user/platform assumptions through adapters.

## Risks, gaps, and unknowns

- Project A has older separate scheduler functions in `src\cron\autonomous.ts:232-330` while `src\index.ts:55-78` uses the newer unified scheduler. These may be retained compatibility code or dead paths.
- Project A’s conversation maintenance pipeline and tool-result offload pipeline are adjacent but not fully unified: durable L1 atoms and offload L1 evidence are related but stored/processed differently.
- Project A’s `MemoryBackend` is broad, making a non-SQLite backend harder than Project B’s narrower `IMemoryStore`.
- Project B supports many runtime modes, which increases lifecycle complexity: OpenClaw, Gateway, Hermes, SQLite, TCVDB, remote/local embeddings, optional offload.
- Project B Gateway user scoping was not fully verified; gateway handlers call core methods directly, while adapters also define runtime context concepts.
- Project B’s TCVDB path requires external operational config: URL, API key, database, collections, embedding model assumptions, and optional CA path.
- Project A lacks B’s formal host-neutral abstractions; porting A to another host would likely require extracting host, LLM, and store boundaries.
- Project B lacks A’s Telegram UX and autonomous scheduled-job features.
