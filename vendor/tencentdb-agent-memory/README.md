# TencentDB-Agent-Memory vendor directory

This boilerplate is wired to a local TencentDB-Agent-Memory-style adapter in `src/memory/store.ts`.

To place the official v0.3.4 release source into this folder, run:

```bash
bun run vendor:tencent-memory
```

It downloads:

```text
https://github.com/Tencent/TencentDB-Agent-Memory/archive/refs/tags/v0.3.4.zip
```

Expected extract path:

```text
vendor/tencentdb-agent-memory/TencentDB-Agent-Memory-0.3.4/
```

The official repo is mainly an OpenClaw/Hermes plugin. The Telegram bot integration uses the local adapter directly so the bot can run on Bun without OpenClaw/Hermes.
