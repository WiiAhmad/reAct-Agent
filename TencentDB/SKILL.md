---
name: openclaw-memory-tencentdb-setup
description: Installs, configures, and verifies the @tencentdb-agent-memory/memory-tencentdb plugin in an OpenClaw environment. Trigger when the user mentions "install memory plugin", "configure memory-tencentdb", "enable long-term memory/recall", or related errors.
version: 1.0.0
---

## Purpose

Provide OpenClaw with persistent local long-term memory (L0→L1→L2→L3) without relying on an external hosted memory service, and complete a one-time loop from installation and configuration through acceptance verification.

## When to use

- The user wants to install or enable `memory-tencentdb` in OpenClaw
- The user needs to configure recall, extraction, persona, cleanup, or related parameters
- The user reports "the plugin is installed but there is no memory / no recall / no vector search"

## When not to use

- The user only wants an explanation of the memory concept and does not need an actual setup
- The user wants to integrate with a non-OpenClaw host (confirm the target framework first)

## Standard workflow

### 1) Environment preflight

First confirm that the base versions meet the requirements:

- OpenClaw: `>= 2026.3.13`
- Node.js: `>= 22.16.0`

Run:

```bash
openclaw --version
node -v
```

If the versions do not meet the requirements, upgrade before continuing.

### 2) Install the plugin

Run the installation command:

```bash
openclaw plugins install @tencentdb-agent-memory/memory-tencentdb
```

If it is already installed, update it instead:

```bash
openclaw plugins update memory-tencentdb
```

### 3) Write the minimal configuration

Edit `~/.openclaw/openclaw.json` and ensure the plugin entry is enabled:

```json
{
  "plugins": {
    "entries": {
      "memory-tencentdb": {
        "enabled": true
      }
    }
  }
}
```

Note: the plugin supports zero-config startup; basic functionality works without adding a `config` object.

### 4) Add recommended configuration as needed (common in production)

Add nested `plugins.entries.memory-tencentdb.config` fields based on the user's needs:

- `plugins.entries.memory-tencentdb.config.capture`: conversation capture and retention policy
- `plugins.entries.memory-tencentdb.config.extraction`: L1 extraction and deduplication
- `plugins.entries.memory-tencentdb.config.pipeline`: L1→L2→L3 scheduling
- `plugins.entries.memory-tencentdb.config.recall`: recall count, threshold, and strategy
- `plugins.entries.memory-tencentdb.config.persona`: scene and persona trigger parameters
- `plugins.entries.memory-tencentdb.config.embedding`: vector-search configuration (remote OpenAI-compatible service)

Practical template:

```json
{
  "plugins": {
    "entries": {
      "memory-tencentdb": {
        "enabled": true,
        "config": {
          "capture": {
            "enabled": true,
            "l0l1RetentionDays": 90
          },
          "recall": {
            "enabled": true,
            "maxResults": 5,
            "scoreThreshold": 0.3,
            "strategy": "hybrid"
          },
          "embedding": {
            "enabled": true,
            "provider": "openai",
            "baseUrl": "https://api.openai.com/v1",
            "apiKey": "${EMBEDDING_API_KEY}",
            "model": "text-embedding-3-small",
            "dimensions": 1536
          }
        }
      }
    }
  }
}
```

### 5) Key configuration rules (to avoid silent failures)

- Configuration values belong under `plugins.entries.memory-tencentdb.config`; the plugin enable flag belongs at `plugins.entries.memory-tencentdb.enabled`.
- When `plugins.entries.memory-tencentdb.config.embedding.provider = "none"`, vector capabilities are disabled and only the keyword path remains.
- If a remote `provider` is configured (such as `openai` / `deepseek`), the following nested `embedding` fields must also be provided:
  - `apiKey`
  - `baseUrl`
  - `model`
  - `dimensions`
- If any of the above is missing, the plugin continues running but automatically degrades to non-vector mode.
- `plugins.entries.memory-tencentdb.config.capture.l0l1RetentionDays`:
  - `0` means no cleanup
  - Non-`0` values should be `>=3`
  - Values of `1~2` require explicitly enabling `allowAggressiveCleanup`

### 6) Restart and verify that it takes effect

Run:

```bash
openclaw gateway restart
```

Checks:

- Gateway logs contain the `[memory-tdai]` prefix
- The memory data directory has been created under the resolved OpenClaw state directory as `<resolved-state-dir>/memory-tdai/` (runtime derives this from `resolveStateDir()`)
- Early writes usually create L0/L1 artifacts such as `conversations/` or `records/`; L2/L3 artifacts such as `scene_blocks/` and `persona.md` may appear only after their pipeline steps run
- `vectors.db` may appear when the SQLite vector backend is used; it is not required for every backend or configuration

### 7) Functional smoke test

Run one minimal conversation loop and verify:

1. Hold 2 to 3 consecutive conversation turns that include memorable information (preferences, constraints, background).
2. Start another conversation turn and observe whether recalled context is injected.
3. Call these tools in the Agent:
   - `tdai_memory_search`
   - `tdai_conversation_search`
4. Confirm that the newly generated content can be retrieved.

## Troubleshooting quick reference

- No plugin logs: check that `plugins.entries.memory-tencentdb.enabled` is `true` in `openclaw.json`, and confirm the Gateway has been restarted.
- Records exist but recall does not happen: check `plugins.entries.memory-tencentdb.config.recall.enabled` and whether `scoreThreshold` is too high.
- No vector results: check that the `plugins.entries.memory-tencentdb.config.embedding` quartet (`apiKey/baseUrl/model/dimensions`) is complete.
- Cleanup is too aggressive and too little history remains: check `plugins.entries.memory-tencentdb.config.capture.l0l1RetentionDays` and `allowAggressiveCleanup`.
- Configuration changed but behavior is unchanged: confirm you edited `~/.openclaw/openclaw.json` and restart the Gateway again.

## Safety and compliance constraints

- Treat `apiKey` as sensitive information; do not expose it in chat, logs, or screenshots.
- Prefer injecting secrets through environment variables; keep only placeholders in configuration examples.
- Modify only the `plugins.entries.memory-tencentdb` plugin entry and avoid overwriting other plugin configuration.

## Definition of Done

Before ending the task, all of the following must be true:

- The plugin install/update command succeeded
- `openclaw.json` contains a valid `plugins.entries.memory-tencentdb` entry, with custom settings under `plugins.entries.memory-tencentdb.config` when needed
- The Gateway has been restarted
- `[memory-tdai]` logs are visible
- The memory data directory under `<resolved-state-dir>/memory-tdai/` is active, and expected artifacts for the enabled backend/pipeline stage have been generated
- At least 1 search-tool call returned results successfully

## Delivery wording template

After completion, you may tell the user:

- Completed `memory-tencentdb` installation and configuration, and restarted the Gateway.
- Verified that logs and the data directory are active, and the memory path is usable.
- For further optimization, tune `plugins.entries.memory-tencentdb.config.recall.scoreThreshold`, `plugins.entries.memory-tencentdb.config.pipeline.everyNConversations`, `plugins.entries.memory-tencentdb.config.persona.triggerEveryN`, and `plugins.entries.memory-tencentdb.config.embedding` model parameters.
