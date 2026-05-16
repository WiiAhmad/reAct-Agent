# grammY + MCP + OpenAI/Claude Agent on Bun

Boilerplate Telegram AI agent dengan:

- Bun runtime
- grammY Telegram bot
- MCP multi-server tool registry
- OpenAI / OpenAI-compatible provider
- Claude native provider
- SQLite lokal via `bun:sqlite`
- JSONL chat history sebagai L0 evidence trail
- TencentDB-Agent-Memory-style local adapter: L0 conversation → L1 atom → L2 scenario → L3 persona
- Short-term context offload: heavy tool results masuk `data/memory/refs/*.md`, agent melihat Mermaid canvas ringkas
- ReAct-style tool loop
- `node-cron` autonomous jobs setiap 10 menit dari `.env`
- Script vendor untuk download official TencentDB-Agent-Memory v0.3.4 release source

## 1. Install

```bash
bun install
cp .env.example .env
cp mcp.servers.example.json mcp.servers.json
```

Isi `.env` minimal:

```bash
BOT_TOKEN=telegram-bot-token
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
```

## 2. Vendor official TencentDB-Agent-Memory v0.3.4

Repo official v0.3.4 bisa dimasukkan ke folder `vendor/`:

```bash
bun run vendor:tencent-memory
```

Itu akan download dan extract:

```text
https://github.com/Tencent/TencentDB-Agent-Memory/archive/refs/tags/v0.3.4.zip
vendor/tencentdb-agent-memory/TencentDB-Agent-Memory-0.3.4/
```

Catatan penting: official package `@tencentdb-agent-memory/memory-tencentdb` adalah plugin OpenClaw/Hermes. Boilerplate Telegram ini tidak menjalankan OpenClaw/Hermes, jadi integrasi bot memakai adapter lokal di `src/memory/store.ts` yang mengikuti mekanisme TencentDB-Agent-Memory: L0/L1/L2/L3, refs, Mermaid canvas, and drill-down chain.

## 3. Run

```bash
bun run dev
```

Test di Telegram:

```text
/start
/tools
/memory
halo, bantu saya bikin bot AI
```

## 4. Cron autonomous loop dari `.env`

Default:

```bash
AUTONOMOUS_CRON=*/10 * * * *
AUTONOMOUS_MIN_INTERVAL_SEC=600
MEMORY_MAINTENANCE_CRON=*/10 * * * *
```

Tambah autonomous job dari Telegram:

```text
/job setiap run, cek memory saya dan beri ringkasan kalau ada hal penting
```

Setiap tick cron, agent akan memanggil `runReactAgent(..., mode: "autonomous")`, bisa memakai tools, memory, dan `telegram_send_message`.

## 5. Memory design

```text
L0 Conversation
  - SQLite table conversations
  - JSONL per chat: data/history/<chat_id>.jsonl

L1 Atom
  - SQLite table memory_atoms
  - FTS5 search
  - dedup sederhana per user

L2 Scenario
  - SQLite table memory_scenarios
  - Markdown files: data/memory/scenarios/*.md

L3 Persona
  - SQLite table personas
  - Markdown file: data/memory/persona-<user_id>.md

Short-term context offload
  - Raw heavy tool result: data/memory/refs/<chat_id>/<node_id>.md
  - Mermaid canvas: data/memory/canvases/<chat_id>.mmd
  - Agent can drill down with tdai_context_ref_read
```

## 6. Local tools registered to the agent

```text
tdai_memory_search          search L3/L2/L1/L0 + canvas
tdai_conversation_search    search raw L0 conversations
tdai_context_ref_read       read offloaded refs/*.md by node_id/result_ref
tdai_memory_status          inspect memory layer counts
save_memory                 save durable L1 atom
telegram_send_message       send Telegram messages during autonomous runs
```

## 7. MCP Tools

Default config menjalankan demo MCP server:

```json
{
  "servers": {
    "demo": {
      "command": "bun",
      "args": ["src/mcp/demo-server.ts"],
      "env": {}
    }
  }
}
```

Tool dari MCP didaftarkan sebagai:

```text
mcp_<serverName>_<originalToolName>
```

## 8. Commands

```text
/start          help
/tools          list tools
/memory         memory status + top memory
/memory_force   force L1→L2→L3 extraction now
/job <prompt>   create autonomous job
/jobs           list autonomous jobs
```

## 9. File penting

```text
src/index.ts                  bootstrap app
src/bot/bot.ts                grammY handlers
src/agent/react-agent.ts      ReAct-style tool loop + offload integration
src/agent/providers/*         OpenAI/Claude abstraction
src/mcp/manager.ts            MCP client manager
src/mcp/demo-server.ts        sample MCP server
src/tools/registry.ts         multi-tool registry persisted in SQLite
src/tools/local.ts            tdai_* memory tools + Telegram tool
src/memory/store.ts           TencentDB-Agent-Memory-style local adapter
src/cron/autonomous.ts        node-cron autonomous + memory loops
src/db/schema.ts              SQLite schema
scripts/vendor-tencentdb-agent-memory.ts  downloads official release into vendor/
```

## 10. Notes

- Untuk benar-benar menjalankan official plugin, kamu perlu OpenClaw atau Hermes runtime. Project ini sengaja tetap Bun-first untuk Telegram bot.
- Kalau ingin vector recall seperti official `SQLite + sqlite-vec`, tambahkan `sqlite-vec` dan embedding provider. Versi ini memakai FTS5/hybrid-lite supaya langsung jalan di Bun.
- Jangan expose filesystem/shell MCP tools ke user publik tanpa allowlist.
