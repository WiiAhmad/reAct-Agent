---
name: openclaw-diagnostic-export
description: Helps users export on-site diagnostic data for OpenClaw + the memory-tencentdb (formerly memory-tdai) memory plugin for troubleshooting. Trigger when the user mentions "export diagnostic data", "export diagnostic", "on-site data", "troubleshooting", "export logs", "collect on-site data", or "package diagnostic data".
version: 1.0.0
---

## Purpose

Package OpenClaw logs, memory plugin data (L0~L3), and redacted configuration into a local archive. The user confirms and manually sends it to the engineering team for troubleshooting.

> **Naming note**: the plugin has been renamed from `@tdai/memory-tdai` to `@tencentdb-agent-memory/memory-tencentdb`, but the data directory name remains `memory-tdai`. The export script selects an OpenClaw base directory with this priority: `OPENCLAW_STATE_DIR` -> `~/.openclaw` -> `~/.clawdbot`, then reads `memory-tdai` under that base directory. All references to the `memory-tdai` directory in this skill refer to the actual data directory path and are unrelated to the plugin ID.

## Export workflow

### Step 1: Confirm the environment

Before exporting, confirm which OpenClaw base directory the script will use. The script checks `OPENCLAW_STATE_DIR` first, then `~/.openclaw`, then `~/.clawdbot`, and copies logs, configuration, and `memory-tdai` from under the selected base directory:

```bash
if [ -n "${OPENCLAW_STATE_DIR:-}" ]; then
  OPENCLAW_BASE_DIR="$OPENCLAW_STATE_DIR"
elif [ -d "$HOME/.openclaw" ]; then
  OPENCLAW_BASE_DIR="$HOME/.openclaw"
elif [ -d "$HOME/.clawdbot" ]; then
  OPENCLAW_BASE_DIR="$HOME/.clawdbot"
else
  echo "OpenClaw base directory not found"
  exit 1
fi

ls -la "$OPENCLAW_BASE_DIR/" 2>/dev/null && echo "Using OpenClaw base directory: $OPENCLAW_BASE_DIR"
```

Confirm that the `memory-tdai` subdirectory exists under the selected base directory:

```bash
MEMORY_TDAI_DIR="$OPENCLAW_BASE_DIR/memory-tdai"
ls -la "$MEMORY_TDAI_DIR/" 2>/dev/null
```

### Step 2: Run the export script

Run the export script in the project's `scripts/` directory:

```bash
bash scripts/export-diagnostic.sh
```

> The script is located at `scripts/export-diagnostic.sh` in this project. If running through `pnpm` or another method, ensure the working directory is the project root.

By default, the script writes the archive to `~/Downloads/openclaw-diagnostic-<timestamp>.tar.gz`.

To specify a different output directory:

```bash
bash scripts/export-diagnostic.sh /tmp
```

### Step 3: Confirm the export result

After the script completes, check the output:

1. **Confirm the archive was generated** — the script prints the archive path and size at the end
2. **Explain what it contains to the user**:

| File/directory | Contents | Privacy risk |
|-----------|------|---------|
| `env-info.txt` | System version, OpenClaw version, directory structure, disk usage | Low |
| `logs/` | Gateway logs copied as-is from the OpenClaw logs directory; latest 3 rolling log files copied with each file truncated to its last 5000 lines | **High** — may contain user content, prompts, tool payloads, error payloads, file paths, or operational details |
| `memory-tdai/` | Full memory plugin data: L0 conversations, L1 memories, L2 scenes, L3 persona, SQLite database, checkpoint | **High** — contains original user conversation text |
| `openclaw-config-redacted.json` | Redacted configuration (API Key/Token/Password/Secret removed; models/channels/env sections fully replaced) | Low |
| `plugins-info.txt` | Installed plugin list and versions | Low |

3. **Remind the user**:
   - The configuration file has been automatically redacted; API keys, tokens, and other sensitive information have been replaced with `***REDACTED***`
   - **Logs (`logs/`) are copied as-is and may contain user content, prompts, tool payloads, or error payloads**; inspect them before sharing
   - **Memory data (`memory-tdai/`) contains original user conversation text**; confirm it can be shared before sending
   - The archive is stored locally and **is not uploaded automatically**; the user must manually send it to the engineering team

### Step 4: Tell the user what to do next

After export completes, tell the user:

1. The archive has been saved locally (print the exact path)
2. Inspect the contents, then manually send it to the engineering team through WeCom, email, or another channel
3. If only partial data is needed (for example, logs only or configuration only), extract the archive and send selected files

## Export contents in detail

### OpenClaw log locations

| Log type | Path | Description |
|---------|------|------|
| Gateway stdout | `<OpenClaw base dir>/logs/gateway.log` | Gateway daemon standard output |
| Gateway stderr | `<OpenClaw base dir>/logs/gateway.err.log` | Gateway daemon error output |
| Rolling logs | `/tmp/openclaw/openclaw-YYYY-MM-DD.log` | Date-rotated JSON Lines logs, automatically cleaned after 24h |
| Configuration audit | `<OpenClaw base dir>/logs/config-audit.jsonl` | Configuration write audit records |
| Command logs | `<OpenClaw base dir>/logs/commands.log` | Command event logs (optional hook) |

### Memory plugin data structure

```
<OpenClaw base dir>/memory-tdai/
├── conversations/                       — L0 raw conversations (daily JSONL shards)
├── records/                             — L1 structured memories (daily JSONL shards)
├── scene_blocks/                        — L2 scene Markdown files
├── persona.md                           — L3 user persona
├── vectors.db                           — SQLite database (vectors + full-text index)
├── .metadata/                           — checkpoint, scene_index.json
└── .backup/                             — Rolling backups
```

### Configuration redaction rules

The export script redacts `openclaw.json` as follows:

| Rule | Handling |
|------|---------|
| Field name matches `apiKey/token/password/secret/credential` and value is a string | Replace with `***REDACTED(Nchars)***` |
| SecretRef object (contains source/provider/id) | Replace id with `***REDACTED***` |
| Top-level `models`, `secrets`, `channels`, and `env` blocks | Replace the entire section with `***REDACTED_SECTION***` |
| token/password under `gateway.auth` | Replace with `***REDACTED***` |
| All other fields (including full `plugins` configuration) | **Preserve as-is** (plugin configuration is important for troubleshooting) |

## Manual export (fallback when the script is unavailable)

If the export script cannot run (for example, Node.js is unavailable), collect data manually as follows:

```bash
# 1. Create an export directory and select the same OpenClaw base directory priority as the script
EXPORT_DIR=~/Downloads/openclaw-diagnostic-$(date +%Y%m%d-%H%M%S)
if [ -n "${OPENCLAW_STATE_DIR:-}" ]; then
  OPENCLAW_BASE_DIR="$OPENCLAW_STATE_DIR"
elif [ -d "$HOME/.openclaw" ]; then
  OPENCLAW_BASE_DIR="$HOME/.openclaw"
elif [ -d "$HOME/.clawdbot" ]; then
  OPENCLAW_BASE_DIR="$HOME/.clawdbot"
else
  echo "OpenClaw base directory not found"
  exit 1
fi
MEMORY_TDAI_DIR="$OPENCLAW_BASE_DIR/memory-tdai"
mkdir -p "$EXPORT_DIR"

# 2. Copy logs
cp -r "$OPENCLAW_BASE_DIR/logs/" "$EXPORT_DIR/logs/" 2>/dev/null
cp /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log "$EXPORT_DIR/" 2>/dev/null

# 3. Copy memory plugin data
cp -r "$MEMORY_TDAI_DIR/" "$EXPORT_DIR/memory-tdai/" 2>/dev/null

# 4. Manually redact configuration (must manually delete sensitive fields!)
# Copy the configuration and use an editor to remove models/secrets/channels blocks and all apiKey/token values
cp "$OPENCLAW_BASE_DIR/openclaw.json" "$EXPORT_DIR/openclaw-config-NEEDS-MANUAL-REDACTION.json"

# 5. Package
cd ~/Downloads && tar -czf "$EXPORT_DIR.tar.gz" "$(basename "$EXPORT_DIR")"

echo "Before sending, manually inspect and remove sensitive information from the configuration!"
```

## Common troubleshooting clues

After receiving exported data, the engineering team usually checks the following:

| Investigation area | File to inspect | Key information |
|---------|---------|---------|
| Whether the plugin loaded | Search `logs/` for `[memory-tdai]` | Plugin registration and configuration parsing logs (note: the log label remains `[memory-tdai]`, independent of plugin ID) |
| Whether memory recall works | Search `logs/` for `[recall]` | Search strategy, duration, hit count |
| Whether L1 extraction triggers | Search `logs/` for `[pipeline]` | Scheduling trigger and L1/L2/L3 execution status |
| Whether vector search is available | `plugins.entries` in `openclaw-config-redacted.json` | Whether embedding configuration is correct |
| Data volume / disk usage | `env-info.txt` | du output and file counts |
| Checkpoint status | `memory-tdai/.metadata/recall_checkpoint.json` | Progress, cursor, counters |
