---
name: openclaw-memory-tencentdb-migration
description: Helps existing users migrate the OpenClaw memory plugin from the old package @tdai/memory-tdai to the new package @tencentdb-agent-memory/memory-tencentdb. Trigger when the user mentions "plugin migration", "change memory plugin package name", "memory-tdai upgrade", "package rename", or installation errors related to the old package.
version: 1.0.0
---

## Purpose

Help existing users who have installed `@tdai/memory-tdai` (the old package name) migrate smoothly to `@tencentdb-agent-memory/memory-tencentdb` (the new package name), while ensuring that existing memory data is not lost and configuration is fully restored.

## Background

- **Old package name**: `@tdai/memory-tdai` (plugin ID: `memory-tdai`)
- **New package name**: `@tencentdb-agent-memory/memory-tencentdb` (plugin ID: `memory-tencentdb`)
- The old and new plugins use the same data directory under the actual OpenClaw state directory: `<actual-state-dir>/memory-tdai/`. Identify the OpenClaw working/state directory used by the deployment first, then derive the `memory-tdai` path from it. The runtime derives this from `api.runtime.state.resolveStateDir()`, and `OPENCLAW_STATE_DIR` may override the state directory. Uninstalling the old plugin **does not delete the data directory**, so existing memory data is unaffected
- Uninstalling the old plugin **does delete** that plugin's configuration section from `openclaw.json`, so it must be backed up first

## When to use

- The user has installed `@tdai/memory-tdai` and needs to migrate to the new package name
- The user runs `openclaw plugins install @tdai/memory-tdai` and gets a 404 / not found error
- The user was told the old package is deprecated and needs to migrate

## When not to use

- The user has never installed a memory plugin (use the `openclaw-memory-tencentdb-setup` skill instead)
- The user is using another memory plugin (such as `openclaw-mem0`)

## Standard workflow

### 1) Confirm current state

Confirm whether the old plugin is installed:

```bash
openclaw plugins list | grep -i memory
```

Expected: `memory-tdai` or `@tdai/memory-tdai` is in the loaded state.

If the old plugin is not shown, skip the migration flow and use the `openclaw-memory-tencentdb-setup` skill for a fresh installation.

### 2) Back up the existing configuration (critical step)

Uninstalling the old plugin deletes its configuration section from `openclaw.json`. **Back it up first.**

Run the following command to extract the old plugin configuration to a local backup file without printing raw secrets to stdout:

```bash
# Set this explicitly to the OpenClaw configuration directory used by this deployment.
OPENCLAW_CONFIG_DIR="/absolute/path/to/openclaw-config"
python3 -c "
import json, os, stat
config_path = os.path.join(os.environ['OPENCLAW_CONFIG_DIR'], 'openclaw.json')
backup_path = '/tmp/memory-tdai-config-backup.json'
with open(config_path) as f:
    cfg = json.load(f)
plugins = cfg.get('plugins', {}).get('entries', {})
old_cfg = plugins.get('memory-tdai', {})
if old_cfg:
    with open(backup_path, 'w') as f:
        json.dump(old_cfg, f, indent=2, ensure_ascii=False)
    os.chmod(backup_path, stat.S_IRUSR | stat.S_IWUSR)
    print(f'Configuration backed up to {backup_path}')
    print('Top-level keys backed up:', ', '.join(sorted(old_cfg.keys())))
    print('Raw values are not printed because the backup may contain apiKey or other secrets.')
else:
    print('No memory-tdai configuration section found (possibly using defaults)')
"
```

**Pay special attention to whether the following settings exist. Inspect the local backup file securely if needed, but do not paste API keys into chat or logs:**

- `embedding` configuration (`provider`, `baseUrl`, `apiKey`, `model`, `dimensions`, `proxyUrl`)
- `extraction.model` (model used for extraction)
- `persona.model` (model used for persona generation)
- `capture.excludeAgents` (agents to exclude)
- `capture.l0l1RetentionDays` (data retention days)

### 3) Confirm that the data directory exists

```bash
# Set this explicitly to the OpenClaw state directory used by this deployment.
OPENCLAW_STATE_DIR="/absolute/path/to/openclaw-state"
MEMORY_TDAI_DIR="$OPENCLAW_STATE_DIR/memory-tdai"
ls -la "$MEMORY_TDAI_DIR/"
```

Expected contents include: `conversations/`, `records/`, `scene_blocks/`, `vectors.db`, `persona.md`, and related files. If the command does not show the expected files, stop and re-check the actual OpenClaw state directory before continuing.

Record the current data volume for post-migration verification:

```bash
# Set this explicitly to the OpenClaw state directory used by this deployment.
OPENCLAW_STATE_DIR="/absolute/path/to/openclaw-state"
MEMORY_TDAI_DIR="$OPENCLAW_STATE_DIR/memory-tdai"
echo "=== Pre-migration data statistics ==="
wc -l "$MEMORY_TDAI_DIR"/conversations/*.jsonl 2>/dev/null || echo "No conversation data"
wc -l "$MEMORY_TDAI_DIR"/records/*.jsonl 2>/dev/null || echo "No record data"
ls "$MEMORY_TDAI_DIR"/scene_blocks/*.md 2>/dev/null | wc -l | xargs -I{} echo "Scene blocks: {}"
wc -c "$MEMORY_TDAI_DIR/persona.md" 2>/dev/null || echo "No persona"
```

### 4) Uninstall the old plugin

```bash
openclaw plugins uninstall memory-tdai
```

After running it, confirm:

- The `memory-tdai` configuration section has been removed from `openclaw.json` (expected behavior)
- The `<actual-state-dir>/memory-tdai/` data directory **still exists** (it should not be deleted)

```bash
# Verify that the data directory still exists
# Set this explicitly to the OpenClaw state directory used by this deployment.
OPENCLAW_STATE_DIR="/absolute/path/to/openclaw-state"
MEMORY_TDAI_DIR="$OPENCLAW_STATE_DIR/memory-tdai"
ls "$MEMORY_TDAI_DIR/" && echo "Data directory intact: $MEMORY_TDAI_DIR" || echo "Data directory missing: $MEMORY_TDAI_DIR"
```

### 5) Install the new plugin

```bash
openclaw plugins install @tencentdb-agent-memory/memory-tencentdb
```

### 6) Restore the configuration

Write the plugin entry backed up in step 2 back to `openclaw.json` under `plugins.entries.memory-tencentdb`. Custom plugin settings belong in that entry's nested `config` object:

```bash
# Set this explicitly to the OpenClaw configuration directory used by this deployment.
OPENCLAW_CONFIG_DIR="/absolute/path/to/openclaw-config"
python3 -c "
import json, os

# Read backup configuration
backup_path = '/tmp/memory-tdai-config-backup.json'
if os.path.exists(backup_path):
    with open(backup_path) as f:
        old_cfg = json.load(f)
    print(f'Loaded backup configuration from {backup_path}')
    print('Top-level keys restored:', ', '.join(sorted(old_cfg.keys())))
    print('Raw values are not printed because the backup may contain apiKey or other secrets.')
else:
    old_cfg = {'enabled': True}
    print('No backup found; using minimal configuration')

# Read current openclaw.json
config_path = os.path.join(os.environ['OPENCLAW_CONFIG_DIR'], 'openclaw.json')
with open(config_path) as f:
    cfg = json.load(f)

# Write new plugin entry under plugins.entries.memory-tencentdb
cfg.setdefault('plugins', {}).setdefault('entries', {})['memory-tencentdb'] = old_cfg

with open(config_path, 'w') as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)

print('\nConfiguration written to plugins.entries.memory-tencentdb')
"
```

If the backup is missing or the user needs to restore manually, ensure at least this minimal plugin entry is written:

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

If restoring custom settings manually, place them under `plugins.entries.memory-tencentdb.config`.

### 7) Restart Gateway and verify

```bash
openclaw gateway restart
```

Checks:

- Gateway logs contain the `[memory-tdai]` prefix (note: the log label remains memory-tdai; this is normal)
- Data directory contents are unchanged

```bash
echo "=== Post-migration verification ==="
# Confirm the new plugin is loaded
openclaw plugins list | grep -i memory

# Confirm data volume matches the pre-migration data
# Set this explicitly to the OpenClaw state directory used by this deployment.
OPENCLAW_STATE_DIR="/absolute/path/to/openclaw-state"
MEMORY_TDAI_DIR="$OPENCLAW_STATE_DIR/memory-tdai"
wc -l "$MEMORY_TDAI_DIR"/conversations/*.jsonl 2>/dev/null
wc -l "$MEMORY_TDAI_DIR"/records/*.jsonl 2>/dev/null
```

### 8) Functional smoke verification

Run one conversation to confirm that the memory path works normally:

1. Send a message containing personal information (such as preferences or habits)
2. Confirm the logs contain output related to `[before_prompt_build]` and `[agent_end]`
3. If embedding is configured, confirm vector search works normally (no embedding errors in logs)

## Rollback plan

If problems occur after migration, roll back quickly:

```bash
# 1. Uninstall the new plugin
openclaw plugins uninstall memory-tencentdb

# 2. Reinstall the old plugin (if the npm source is still available)
openclaw plugins install @tdai/memory-tdai

# 3. Manually restore configuration from the backup
# Write the contents of /tmp/memory-tdai-config-backup.json back into the memory-tdai section of openclaw.json

# 4. Restart
openclaw gateway restart
```

## Troubleshooting

| Symptom | Possible cause | Solution |
|------|----------|----------|
| New plugin has no log output | `enabled` is not set to `true` in the plugin entry | Check `plugins.entries.memory-tencentdb.enabled` in `openclaw.json` |
| New plugin installation fails | npm source unavailable | Check network / npm registry configuration |
| No historical memories after migration | Configuration restore is incomplete | Compare `/tmp/memory-tdai-config-backup.json` with the current configuration |
| Embedding errors | `apiKey` or other settings are missing | Restore the `embedding` configuration section from the backup |
| Data directory is empty | Data was deleted abnormally during uninstall (very rare) | Identify the actual OpenClaw state directory and check whether its `memory-tdai/` subdirectory exists |

## Safety and compliance constraints

- The backup file `/tmp/memory-tdai-config-backup.json` may contain `apiKey`; delete it after migration: `rm /tmp/memory-tdai-config-backup.json`
- Do not display `apiKey` in plaintext in chat or logs
- Modify only the `plugins.entries.memory-tencentdb` plugin entry; do not affect the user's other plugins

## Definition of Done

Migration is complete only when all of the following are true:

- [x] The old plugin `@tdai/memory-tdai` has been uninstalled
- [x] The new plugin `@tencentdb-agent-memory/memory-tencentdb` has been installed and loaded
- [x] `openclaw.json` contains the complete `plugins.entries.memory-tencentdb` entry, including user-customized settings under `config`
- [x] Gateway has been restarted
- [x] Logs contain the `[memory-tdai]` prefix
- [x] The data directory is intact and data volume matches the pre-migration data
- [x] At least 1 conversation verified the memory path works normally
- [x] Sensitive information in the backup file has been cleaned up

## Delivery wording template

> Completed memory plugin migration:
> - Old plugin `@tdai/memory-tdai` → new plugin `@tencentdb-agent-memory/memory-tencentdb`
> - Existing memory data has been fully preserved (conversations / records / scene blocks / vector database are all unaffected)
> - Configuration has been fully restored from the old plugin (including embedding / extraction / persona and other custom settings)
> - Gateway has been restarted and the memory path has been verified
