# Features, APIs, and Migration Opportunities

**Project A:** `D:\Code\Test\yunus\grammy`  
**Project B:** `D:\Code\Test\yunus\grammy\TencentDB-Agent-Memory`

## Executive summary

Project A is a productized Telegram agent runtime. Its user-facing surface is deliberately small: `/start`, `/menu`, `/help`, plus inline menu flows for memory updates, skill drafts, and autonomous jobs. Its runtime API is mostly internal TypeScript service/tool APIs exposed to its own ReAct agent.

Project B is a reusable memory plugin and sidecar system. Its public surface is broader and integration-oriented: OpenClaw plugin tools and hooks, an OpenClaw CLI namespace, npm binaries, shell scripts, Hermes integration, and standalone HTTP gateway endpoints.

Memory-wise, Project A has adopted several TencentDB-Agent-Memory concepts but re-anchors them in a Telegram/project-owned SQLite runtime. Project B remains stronger as host-neutral memory infrastructure with configurable storage backends, auto-recall/capture hooks, gateway APIs, and pipeline scheduling.

The highest-value migration/reuse opportunity is selective: borrow Project B’s host-neutral boundaries, recall timeout/degradation, backend abstraction, seed/import flow, cleanup/retention patterns, and metrics concepts without importing Project B’s OpenClaw-specific assumptions into Project A’s Telegram UX.

## Project A capabilities and public surfaces

### Telegram commands and UX

Project A exposes only three public Telegram commands:

- `/start`
- `/menu`
- `/help`

Evidence:

- `README.md:5-11`
- `src\bot\bot.ts:20`
- command handlers at `src\bot\bot.ts:135-157`

Unknown slash commands are intentionally ignored by text handling:

- `src\bot\bot.ts:237-240`

The primary UX is menu-driven:

- Main menu callbacks for Memory, Jobs, Help: `src\bot\ui\keyboards.ts:28-34`.
- Memory summary actions for Memory Update and Skill Drafts: `src\bot\ui\keyboards.ts:36-42`.
- Schedule preset callbacks and custom cron: `src\bot\ui\keyboards.ts:56-68`.
- Bot callback wiring: `src\bot\bot.ts:159-235`.

### Agent/runtime tools

Project A registers local tools at startup:

- `src\index.ts:47-54`

Available local tools:

| Tool | Capability | Evidence |
|---|---|---|
| `tdai_memory_search` | Search L3 persona, L2 scenarios, L1 atoms, L0 evidence, active/historical task canvases | `src\tools\local.ts:53-81` |
| `tdai_conversation_search` | Search raw L0 conversation history | `src\tools\local.ts:84-98` |
| `tdai_context_ref_read` | Read offloaded raw result refs by `node_id` or `result_ref` | `src\tools\local.ts:101-114` |
| `tdai_memory_status` | Inspect backend counts, cron/offload state, task canvas state | `src\tools\local.ts:117-127` |
| `save_memory` | Save durable L1 memory atom | `src\tools\local.ts:130-150` |
| `tdai_current_datetime` | Deterministic timezone/locale datetime snapshot | `src\tools\local.ts:153-163` |
| `tdai_create_job` | Create hybrid scheduled Telegram jobs with once/interval/cron scheduling | `src\tools\local.ts:166-239` |
| `telegram_send_message` | Send Telegram messages during autonomous runs | `src\tools\local.ts:241-260` |

Safety/loop control:

- In autonomous mode, Project A filters out job-creation and direct Telegram send tools to prevent recursive or uncontrolled side effects at `src\agent\react-agent.ts:129-132`.

### Memory capabilities

Project A’s documented protected model:

- L0 conversations
- L1 atoms
- L2 scenarios
- L3 persona
- offload refs
- task-scoped Mermaid canvases

Evidence:

- `docs\memory.md:5-20`
- `README.md:80-91`

Project A’s short-term task context stack:

1. Canonical chat JSONL.
2. L1 semantic evidence in SQLite and mirrored JSONL.
3. L2 semantic Mermaid patching into task-scoped `.mmd` canvases.
4. Task-aware recall.

Evidence:

- `docs\memory.md:24-33`
- `README.md:93-100`

Runtime recall injection:

- L3 persona, L2 scenarios, L1 atoms, L0 evidence, active Mermaid canvas, historical task canvases are formatted at `src\agent\react-agent.ts:23-54`.
- Recall is fetched before the tool loop at `src\agent\react-agent.ts:98-123`.

Recall data sources:

- Keyword and vector atoms, scenarios, conversations, active task canvas, and task canvas search at `src\memory\recall\service.ts:44-57`.
- Vector/keyword atom merge at `src\memory\recall\service.ts:58-96`.

Durable memory maintenance:

- L1/L2/L3 maintenance with progress events at `src\memory\pipeline\coordinator.ts:24-93`.

L1.5 task judgment:

- Context collection from recent messages, active task, and historical tasks at `src\memory\core\service.ts:364-390`.
- Task canvas create/reactivate/complete behavior at `src\memory\core\service.ts:392-428`.

Offload and L4 skill drafts:

- Tool result offload wrapper at `src\memory\core\service.ts:431-442`.
- L4 draft skill generation from task canvas/evidence at `src\memory\core\service.ts:444-510`.

SQLite memory/task/offload schema:

- L0/events: `src\memory\backends\sqlite\migrate.ts:165-194`.
- lineage/checkpoints: `src\memory\backends\sqlite\migrate.ts:196-214`.
- offload refs/task nodes: `src\memory\backends\sqlite\migrate.ts:216-243`.
- L1 evidence: `src\memory\backends\sqlite\migrate.ts:245-260`.
- task canvases/FTS: `src\memory\backends\sqlite\migrate.ts:262-282`.
- L1.5 judgments/task boundaries: `src\memory\backends\sqlite\migrate.ts:284-306`.
- generated skills: `src\memory\backends\sqlite\migrate.ts:308-323`.
- L1 atoms/embeddings/L2 scenarios/L3 personas: `src\memory\backends\sqlite\migrate.ts:325-369`.

### Operational features

Project A supports:

- Bun dev/build/start/test/typecheck/migrate/db-reset/memory-inspect scripts at `package.json:6-15`.
- Telegram startup and graceful shutdown at `src\index.ts:14-97`.
- Per-user Memory Update settings defaulting to enabled every 24 hours at `src\services\memory-update-settings.ts:65-91`.
- Memory Update schedules for interval/cron only at `src\services\memory-update-settings.ts:93-104`.
- Unified scheduler dispatch for due autonomous jobs and due memory updates at `src\cron\scheduler.ts:22-49`.
- Autonomous/hybrid scheduled jobs with create/list/update/enable/delete/run bookkeeping at `src\services\autonomous-jobs.ts:131-252`.
- Hybrid autonomous jobs that send fixed text first, then run an agent prompt at `src\cron\autonomous.ts:140-170`.

### Where Project A borrows from Project B

Project A explicitly documents the adaptation source:

- `docs\superpowers\specs\2026-05-18-tencentdb-l15-offload-adaptation-design.md:3-9` says the goal is to adapt useful context-offload ideas from `TencentDB-Agent-Memory/main.md`, including L1.5 task judgment, task-scoped L2 Mermaid canvases, and L4 skill generation.

Project A also names “TencentDB-style semantic offload completion”:

- `docs\memory.md:24-33` documents canonical chat JSONL, L1 semantic evidence, L2 Mermaid patching, and task-aware recall.

Project A diverges by keeping durable L0→L1→L2→L3 semantics protected and placing TencentDB-style context offload beside durable memory rather than inside it:

- `docs\memory.md:16-22`
- `docs\superpowers\specs\2026-05-18-tencentdb-l15-offload-adaptation-design.md:35-50`

## Project B capabilities and public surfaces

### Package/plugin surface

Project B is an npm package:

- `package.json:1-4`

It exposes npm binaries:

- `migrate-sqlite-to-tcvdb`
- `export-tencent-vdb`
- `read-local-memory`

Evidence:

- `package.json:7-10`

It declares OpenClaw compatibility:

- Extension entry `./index.ts`: `package.json:102-105`.
- Plugin API/gateway compatibility: `package.json:106-113`.

Plugin manifest tool contracts:

- `tdai_memory_search`
- `tdai_conversation_search`

Evidence:

- `openclaw.plugin.json:1-10`

### OpenClaw tools

Tools are registered when memory features are enabled:

- Registration guard: `index.ts:320-323`.
- `tdai_memory_search` schema and execution: `index.ts:323-406`.
- `tdai_conversation_search` schema and execution: `index.ts:408-488`.

Tool descriptions include a soft combined per-turn limit, while comments indicate hard enforcement is still TODO:

- `index.ts:320-329`
- `index.ts:408-419`

### OpenClaw hooks

| Hook | Purpose | Evidence |
|---|---|---|
| `before_prompt_build` | auto-recall, context injection, prompt cache bookkeeping | `index.ts:497-583` |
| `before_message_write` | strip injected `<relevant-memories>` from persisted user messages | `index.ts:586-622` |
| `agent_end` | auto-capture, L0 record, L1/L2/L3 scheduling, metrics | `index.ts:624-728` |
| `gateway_stop` | cleanup, scheduler flush, store shutdown | `index.ts:730-777` |

Context offload registers conditionally:

- `index.ts:798-811`

### CLI surface

Project B registers an OpenClaw CLI namespace:

- `openclaw memory-tdai` at `index.ts:817-831`.

Implemented subcommand:

```text
memory-tdai seed --input <file> [--output-dir] [--session-key] [--config] [--strict-round-role] [--yes]
```

Evidence:

- `src\cli\index.ts:1-9`
- `src\cli\index.ts:54-60`
- `src\cli\commands\seed.ts:25-40`

### HTTP gateway/API endpoints

Project B includes a standalone/Hermes gateway built on Node’s native HTTP module.

Public endpoints:

- `GET /health`
- `POST /recall`
- `POST /capture`
- `POST /search/memories`
- `POST /search/conversations`
- `POST /session/end`
- `POST /seed`

Evidence:

- Endpoint list: `src\gateway\server.ts:1-12`.
- Router: `src\gateway\server.ts:187-205`.
- Health handler: `src\gateway\server.ts:217-228`.
- Recall handler: `src\gateway\server.ts:230-250`.
- Capture handler: `src\gateway\server.ts:252-280`.
- Memory search handler: `src\gateway\server.ts:282-303`.
- Conversation search handler: `src\gateway\server.ts:305-324`.
- Session end handler: `src\gateway\server.ts:326-338`.
- Seed handler: `src\gateway\server.ts:340-435`.

### Host-neutral core API

`TdaiCore` maps public integration surfaces to memory behavior:

| Method | Public mapping | Evidence |
|---|---|---|
| `handleBeforeRecall` | OpenClaw `before_prompt_build`, Hermes prefetch, HTTP `/recall` | `src\core\tdai-core.ts:240-259` |
| `handleTurnCommitted` | OpenClaw `agent_end`, Hermes sync_turn, HTTP `/capture` | `src\core\tdai-core.ts:261-284` |
| `searchMemories` | `tdai_memory_search`, HTTP `/search/memories` | `src\core\tdai-core.ts:286-306` |
| `searchConversations` | `tdai_conversation_search`, HTTP `/search/conversations` | `src\core\tdai-core.ts:308-326` |
| `handleSessionEnd` | Hermes on-session-end, HTTP `/session/end` | `src\core\tdai-core.ts:328-364` |

### Memory capabilities

README-level capability split:

- Symbolic short-term memory: refs, JSONL summaries, Mermaid canvas.
- Layered long-term memory: L0 conversations, L1 atoms, L2 scenes, L3 persona.

Evidence:

- `README.md:27-34`
- `README.md:63-80`
- `README.md:85-104`

Auto-recall supports:

- L1 keyword/embedding/hybrid search.
- L3 persona injection.
- L2 scene navigation.
- Memory tool usage guide.
- Timeout guard.
- Prompt-cache-friendly split between stable and dynamic context.

Evidence:

- `src\core\hooks\auto-recall.ts:1-11`
- `src\core\hooks\auto-recall.ts:30-43`
- `src\core\hooks\auto-recall.ts:83-102`
- `src\core\hooks\auto-recall.ts:145-170`
- `src\core\hooks\auto-recall.ts:187-220`

Auto-capture supports:

- L0 JSONL recording.
- Vector indexing.
- Scheduler notification.
- Atomic checkpointed capture.

Evidence:

- `src\core\hooks\auto-capture.ts:1-11`
- `src\core\hooks\auto-capture.ts:100-146`
- `src\core\hooks\auto-capture.ts:149-180`

Pipeline manager supports:

- L1 threshold and idle triggers.
- Warmup thresholds.
- L2 delayed/min/max interval scheduling.
- L3 serialized persona generation.
- Shutdown flush.

Evidence:

- `src\utils\pipeline-manager.ts:1-77`
- `src\utils\pipeline-manager.ts:104-147`
- `src\utils\pipeline-manager.ts:196-245`

Scene extraction:

- LLM-driven and sandboxed to scene block files at `src\core\scene\scene-extractor.ts:1-17`.
- Tool-enabled runner at `src\core\scene\scene-extractor.ts:97-113`.
- Extraction flow starts at `src\core\scene\scene-extractor.ts:122-160`.

Storage backends:

- Store factory docs: `src\core\store\factory.ts:1-8`.
- TCVDB creation: `src\core\store\factory.ts:50-88`.
- SQLite + embedding service creation: `src\core\store\factory.ts:90-125`.
- Capability flags: `src\core\store\types.ts:181-194`.

### Context offload capabilities

Project B’s offload module includes:

- after-tool-call buffering and L3 compression.
- before-prompt-build MMD injection and compression.
- L1.5 task/MMD management.
- backend/local mode selection.
- retention/reclaimer support.

Evidence:

- Offload module entry/imports: `src\offload\index.ts:1-68`.
- L1.5 task transition helpers: `src\offload\hooks\before-agent-start.ts:1-31`.
- MMD create/reactivate/clear behavior: `src\offload\hooks\before-agent-start.ts:33-131`.
- After-tool-call buffering and patch-effectiveness detection: `src\offload\hooks\after-tool-call.ts:94-186`.
- Before-prompt-build phases: `src\offload\hooks\before-prompt-build.ts:1-8`.
- Before-prompt-build MMD injection/compression begins at `src\offload\hooks\before-prompt-build.ts:43-68`.

### Configuration surface

Project B exposes config through `openclaw.plugin.json:11-160`:

- `storeBackend`
- `capture`
- `extraction`
- `persona`
- `pipeline`
- `recall`
- `embedding`
- `tcvdb`
- `bm25`
- `report`
- `llm`
- `offload`

TypeScript parser and defaults:

- `src\config.ts:1-8`
- defaults returned at `src\config.ts:457-541`

Notable defaults:

- capture enabled
- extraction enabled
- recall enabled, hybrid strategy, max 5
- embedding disabled unless configured
- store backend defaults to SQLite
- offload disabled by default

Evidence:

- `src\config.ts:457-492`
- `src\config.ts:330-407`
- `src\config.ts:413-416`
- `src\config.ts:426-455`

## Feature/API comparison matrix

| Area | Project A | Project B | Alignment/divergence |
|---|---|---|---|
| Primary product | Telegram bot/agent runtime | OpenClaw plugin + Hermes/standalone memory gateway | Different hosts and UX goals |
| Public commands | Telegram `/start`, `/menu`, `/help` | OpenClaw CLI `memory-tdai`, npm bins, shell scripts | A is user-facing; B is operator/developer-facing |
| Agent tools | 8 local tools including memory, context refs, datetime, job creation, Telegram send | 2 memory tools: `tdai_memory_search`, `tdai_conversation_search` | A has broader runtime tools; B focuses on memory |
| Hooks | Internal bot/agent wiring only | OpenClaw lifecycle hooks | B has external plugin lifecycle |
| HTTP API | None observed | Gateway endpoints for health/recall/capture/search/session/seed | A could reuse if memory becomes sidecar |
| Core API | Internal `MemoryService` | Host-neutral `TdaiCore` | Similar intent; B has cleaner boundary |
| L0 | Conversations in SQLite and JSONL | Auto-captured JSONL plus optional vector-indexed L0 | B has richer host capture/checkpointing |
| L1 | Atoms with FTS/vector embedding and evidence | Structured memories with configurable extraction/dedup/search | B is more configurable |
| L2 | DB scenarios and task Mermaid canvases | Scene blocks in Markdown with scene index/navigation | Same layer number, different shape |
| L3 | Persona table and recall injection | Persona Markdown loaded into stable context | B emphasizes prompt caching/stable context |
| Recall | Persona + scenarios + atoms + conversations + task canvases | L1 keyword/embedding/hybrid + persona + scene navigation | A recalls task canvases; B recalls scene navigation |
| Offload refs | Raw result refs and `tdai_context_ref_read` | refs/MMD/offload entries with compression engine | B has fuller compression/injection engine |
| L1.5 task judgment | Implemented in `MemoryService.judgeTaskTurn` | Implemented in offload task transition helpers/backend/local flow | A adapts B concept into project schema |
| L4/skills | Draft skill generation from task canvas/evidence | Conceptual/offload-related skill command paths | A appears more productized locally |
| Scheduling | Autonomous Telegram jobs + Memory Update scheduler | Memory pipeline timers/queues | A schedules user jobs; B schedules memory processing |
| Storage | Project-owned SQLite | SQLite or TCVDB + BM25/embedding service | B has more portable backend abstraction |
| Metrics | Console/status-oriented | Structured reporting around recall/capture counts/durations | B stronger observability |
| Cleanup/retention | No broad retention surface observed | L0/L1 cleanup and offload retention/log limits | B richer retention operations |
| Seeding/import | No direct equivalent observed | CLI and HTTP seed pipeline | B has migration/bootstrap path |

## Migration, reuse, and alignment opportunities

### 1. Adapt Project B’s host-neutral core boundary

Project B’s `TdaiCore` separates host adapters from memory logic, with methods for recall, capture, search, and session end at `src\core\tdai-core.ts:240-364`.

Project A’s `MemoryService` is already a central facade but remains coupled to the Telegram/Bun runtime. If Project A ever needs a sidecar, a CLI import tool, tests independent from Telegram, or non-Telegram hosts, a `TdaiCore`-style boundary is the safest reuse point.

Recommended adaptation:

- Keep Telegram-specific code in `src\bot` and autonomous services.
- Introduce a host-neutral memory runtime interface only around memory capture/recall/search/maintenance.
- Avoid importing OpenClaw hook assumptions into Telegram message handling.

### 2. Reuse backend abstraction ideas

Project B supports store capability flags and backend selection:

- capabilities: `src\core\store\types.ts:181-194`
- factory: `src\core\store\factory.ts:41-127`

Project A currently uses a project-owned SQLite backend with a broad `MemoryBackend`. If Tencent Cloud VectorDB alignment matters, Project B’s store contracts are the main migration source.

Recommended adaptation:

- First split Project A’s app-specific tables from generic memory records.
- Then introduce a smaller store contract for L0/L1/persona/search.
- Keep task canvases, autonomous jobs, and Telegram state in Project A’s app DB unless there is a concrete reason to move them.

### 3. Port recall timeout and degraded fallback

Project B wraps recall in a timeout at `src\core\hooks\auto-recall.ts:83-102`.

Project A fetches recall synchronously before the ReAct loop at `src\agent\react-agent.ts:98-123`.

Recommended adaptation:

- Add a bounded recall timeout in Project A’s agent startup path.
- If recall times out, continue with recent history and a visible internal status/log entry.
- Preserve Project A’s task canvas recall when available, but do not block the whole Telegram response on slow memory retrieval.

### 4. Port stable/dynamic prompt context split

Project B separates stable persona/scene/tool-guide context from dynamic L1 memories for prompt caching at `src\core\hooks\auto-recall.ts:187-220`.

Project A currently formats memory context into the agent messages at `src\agent\react-agent.ts:23-54` and `src\agent\react-agent.ts:117-127`.

Recommended adaptation:

- If using Claude prompt caching through the Anthropic SDK, split stable persona/task instructions from dynamic recall snippets.
- Keep highly volatile L0/L1/tool evidence outside cached blocks.
- This is only worth doing if token/cost/latency shows recall context as a meaningful load.

### 5. Add seed/import tooling to Project A

Project B has CLI and HTTP seed paths:

- CLI: `src\cli\commands\seed.ts:25-40`
- HTTP: `src\gateway\server.ts:340-435`

Project A has no direct equivalent.

Recommended adaptation:

- Add a local `memory:seed` script only if migration/bootstrap becomes necessary.
- Accept JSONL or a small normalized transcript format.
- Write through Project A’s existing `MemoryService`/backend to preserve schema invariants.

### 6. Borrow pipeline scheduler semantics selectively

Project A maintenance is scheduled or manual through `PipelineCoordinator` at `src\memory\pipeline\coordinator.ts:24-93`.

Project B’s `MemoryPipelineManager` supports warmup, idle thresholds, delayed L2 generation, serialized queues, and shutdown flush at `src\utils\pipeline-manager.ts:1-77`.

Recommended adaptation:

- If Project A needs faster memory formation, add event-driven triggers after a configurable number of messages.
- Keep manual Memory Update flow for user control.
- Avoid importing the full B scheduler unless A needs per-session recovery/queue semantics.

### 7. Align task/MMD traceability formats

Project A already adopted L1.5 task judgment, task canvases, and L4 draft skills from TencentDB-style ideas.

Project B has mature node tracing and offload/MMD concepts:

- README node tracing: `README.md:85-104`
- after-tool-call MMD behavior: `src\offload\hooks\after-tool-call.ts:194-220`

Recommended adaptation:

- Normalize node IDs, result refs, task status names, and MMD metadata.
- Keep Project A’s SQLite/FTS task canvas implementation.
- Align formats only where it improves import/export/debugging.

### 8. Adopt B-style metrics and diagnostics

Project B reports recall/capture counts and durations at `index.ts:690-713`.

Project A has status messages and logs but less structured metrics.

Recommended adaptation:

- Track recall latency, memory update duration, offload byte counts, task-canvas patch counts, autonomous job run duration, and tool failures.
- Expose a compact admin-only Telegram memory/status view or local inspection output.

### 9. Add cleanup/retention policy patterns

Project B validates retention and cleanup configuration:

- retention config types: `src\config.ts:21-31`
- parser validation: `src\config.ts:299-312`

Project A stores growing JSONL, refs, canvases, generated skills, and SQLite rows. No equivalent retention surface was found.

Recommended adaptation:

- Add retention settings only for clearly growing artifacts: history JSONL, offload raw refs, old task canvases, old generated skill drafts.
- Do not delete L1/L2/L3 durable memory by default without user/admin action.

## Lower-friction alignment opportunities

- Normalize memory tool descriptions and call limits. Project B injects a memory tool guide with a combined max of 3 calls per turn at `src\core\hooks\auto-recall.ts:30-43`; Project A could add similar guidance to its agent prompt.
- Add optional `type` and `scene` filters to Project A’s `tdai_memory_search`, inspired by Project B’s tool schema at `index.ts:341-349`.
- Add session/chat filter mapping if importing/exporting between B’s `session_key` and A’s Telegram `chatId/userId`.
- Consider a read-only local HTTP API for Project A memory status/search, mirroring B’s gateway endpoints, if external debugging/admin tools are needed.
- Reuse B’s embedding config degradation behavior, which keeps running when remote embedding config is incomplete at `src\config.ts:376-397`.

## Risks and gaps

### Semantic mismatch

Project A intentionally preserves durable memory semantics and keeps TencentDB-style context offload separate:

- `docs\memory.md:16-22`
- `docs\superpowers\specs\2026-05-18-tencentdb-l15-offload-adaptation-design.md:13-17`

Directly importing Project B’s pipeline could blur Project A’s protected L0/L1/L2/L3 meanings.

### Host assumptions differ

Project B assumes OpenClaw/Hermes concepts such as:

- `sessionKey`
- `before_prompt_build`
- `agent_end`
- gateway lifecycle
- plugin config
- host LLM runners

Project A assumes:

- Telegram `chatId/userId`
- grammY conversations
- Bun SQLite
- local tool registry
- Telegram side effects

Reuse should target pure concepts/modules, not host glue.

### B’s offload engine may be overkill for A

Project B’s after-tool-call hook detects runtime patch effectiveness and skips L3 when message data is missing at `src\offload\hooks\after-tool-call.ts:117-149`.

Project A already has simpler direct access to its own tool results inside the ReAct loop. Importing B’s full offload patch/injection system could add complexity without benefit.

### A’s autonomous tools are side-effectful

Project A has `tdai_create_job` and `telegram_send_message`. Project B’s memory plugin tools do not create user-visible jobs/messages. Aligning tool registries without guardrails could expose side effects in contexts that expect read-only memory tools.

### Runtime requirements differ

Project A is Bun-based and uses app-local dependencies. Project B targets Node >=22.16, OpenClaw, tsdown packaging, and optional Node/OpenClaw peers.

Code reuse may need adapters for:

- SQLite APIs
- filesystem paths
- timers/schedulers
- LLM clients
- session identity
- logging/metrics

## Gaps in Project A relative to Project B

- No external HTTP memory API/gateway.
- No seed/import CLI.
- No TCVDB backend support.
- No BM25 sparse-vector backend.
- No explicit retention/cleanup policy for L0/L1/offload refs/canvases.
- Less structured metrics/reporting.
- No plugin/hook surface for other hosts.
- Recall lacks observed B-style timeout/degraded fallback.
- L2 scene navigation is less rich than B’s scene block/navigation model.
- Embedding configuration is simpler and local/project-owned.

## Gaps in Project B relative to Project A

- No Telegram UX.
- No user-facing menu workflows.
- No autonomous scheduled Telegram jobs.
- No `tdai_create_job`, `tdai_current_datetime`, or `telegram_send_message` equivalent.
- L4 skill generation appears less productized/user-facing than A’s draft skill flow: B references skill generation conceptually in `README.md:69-72` and backend L4 routing in `src\config.ts:230-231`, while A has explicit draft generation/storage at `src\memory\core\service.ts:444-510`.

## Practical recommendation

Do not treat Project B as a drop-in replacement for Project A’s memory layer. Treat it as a reference implementation for reusable memory infrastructure.

Best path if alignment is desired:

1. Keep Project A’s Telegram UX, autonomous jobs, and project-owned schema intact.
2. Extract a smaller Project A memory runtime interface inspired by `TdaiCore`.
3. Add recall timeouts/degraded fallback before making storage changes.
4. Add seed/import and diagnostics only if operationally needed.
5. Align MMD/task metadata formats for future import/export/debugging.
6. Consider backend abstraction/TCVDB only after Project A’s local SQLite behavior is stable and covered by tests.

## Unknowns not fully verified

- Tests/builds were not executed.
- Every shell script in Project B was not fully audited.
- Generated/dist contents were not inspected in depth.
- Every Project A conversation file was not deeply analyzed; conclusions are based on public command/callback wiring, docs, services, and memory/job modules.
- Project B package references binaries/build outputs that were not present in the source tree at scan time.
