# grammY + MCP + OpenAI/Claude Agent on Bun

Boilerplate Telegram AI agent dengan:

- Bun runtime
- grammY Telegram bot
- MCP multi-server tool registry
- OpenAI / OpenAI-compatible provider
- Claude native provider
- SQLite lokal via `bun:sqlite`
- JSONL chat history sebagai L0 evidence trail
- project-owned memory backend: L0 conversation → L1 atom → L2 scenario → L3 persona
- Short-term context offload: heavy tool results masuk `data/memory/refs/*.md`, agent melihat Mermaid canvas ringkas
- ReAct-style tool loop
- `node-cron` autonomous jobs setiap 10 menit dari `.env`

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

## 2. Run

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

## 3. Cron autonomous loop dari `.env`

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

## 4. Memory design

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

## 5. Inspect memory runtime

List user yang sudah punya percakapan:

```bash
bun run memory:inspect
```

Inspect memory untuk user tertentu, dengan chat id opsional untuk menampilkan canvas yang aktif:

```bash
bun run memory:inspect -- 123456789
bun run memory:inspect -- 123456789 5980836755
```

Output akan menunjukkan backend, owner, jumlah layer memory, status offload, cron maintenance, lalu persona/scenario yang sudah tersimpan.

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
src/memory/core/service.ts    project-owned memory service facade
src/memory/integration/*      memory runtime wiring
src/cron/autonomous.ts        node-cron autonomous + memory loops
src/db/schema.ts              SQLite schema
scripts/inspect-memory.ts     inspect the local memory backend
```

## 10. Notes

- Runtime memory sepenuhnya dimiliki project ini; tidak perlu vendor workflow eksternal untuk menjalankannya.
- `src/memory/jsonl.ts` tetap dipakai untuk export/append JSONL event trail.
- Jangan expose filesystem/shell MCP tools ke user publik tanpa allowlist.
