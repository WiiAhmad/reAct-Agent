#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# setup-offload.sh — One-click enable/disable for the Offload feature
# ═══════════════════════════════════════════════════════════════════
#
# Usage:
#   bash setup-offload.sh --enable --user-id <userId> --backend-url <url> [--backend-api-key <key>]
#   bash setup-offload.sh --disable
#   bash setup-offload.sh --status
#
# Enable flow:
#   1. Prerequisite checks (openclaw.json exists, openclaw is installed)
#   2. Validate and apply the patch (inject after_tool_call messages) — stop on failure
#   3. Set plugins.slots.contextEngine
#   4. Set offload.enabled + backendUrl + userId [+ backendApiKey]
#   5. Set compaction.mode = safeguard
#
# Disable flow:
#   1. Set offload.enabled = false
#   2. Remove plugins.slots.contextEngine (free the occupied slot)
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Colors ──
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*" >&2; exit 1; }

# ── Constants ──
OPENCLAW_JSON="${HOME}/.openclaw/openclaw.json"
PLUGIN_ID="memory-tencentdb"
CONTEXT_ENGINE_ID="openclaw-context-offload"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_SCRIPT="${SCRIPT_DIR}/openclaw-after-tool-call-messages.patch.sh"

# ── Argument parsing ──
MODE=""
USER_ID=""
BACKEND_URL=""
BACKEND_API_KEY=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --enable)   MODE="enable"; shift ;;
        --disable)  MODE="disable"; shift ;;
        --status)   MODE="status"; shift ;;
        --user-id)  USER_ID="$2"; shift 2 ;;
        --backend-url) BACKEND_URL="$2"; shift 2 ;;
        --backend-api-key) BACKEND_API_KEY="$2"; shift 2 ;;
        -h|--help)
            echo "Usage:"
            echo "  bash setup-offload.sh --enable --user-id <userId> --backend-url <url> [--backend-api-key <key>]"
            echo "  bash setup-offload.sh --disable"
            echo "  bash setup-offload.sh --status"
            echo ""
            echo "Arguments:"
            echo "  --user-id         (required) User ID"
            echo "  --backend-url     (required) Offload backend URL, for example http://1.2.3.4:8080"
            echo "  --backend-api-key (optional) Backend API authentication token"
            exit 0
            ;;
        *) fail "Unknown argument: $1" ;;
    esac
done

[[ -z "$MODE" ]] && fail "Please specify a mode: --enable / --disable / --status"

# ═══════════════════════════════════════════════════════════════════
# Shared functions
# ═══════════════════════════════════════════════════════════════════

check_openclaw_json() {
    if [[ ! -f "$OPENCLAW_JSON" ]]; then
        fail "openclaw.json does not exist: $OPENCLAW_JSON"
    fi
    # Validate JSON format
    python3 -c "import json; json.load(open('$OPENCLAW_JSON'))" 2>/dev/null \
        || fail "openclaw.json has invalid JSON format"
}

backup_config() {
    local bak="${OPENCLAW_JSON}.bak.$(date +%Y%m%d_%H%M%S)"
    cp "$OPENCLAW_JSON" "$bak"
    info "Configuration backed up to: $bak"
}

# ═══════════════════════════════════════════════════════════════════
# --status: Show current configuration state
# ═══════════════════════════════════════════════════════════════════
show_status() {
    check_openclaw_json
    python3 -c "
import json

with open('$OPENCLAW_JSON') as f:
    cfg = json.load(f)

# Context Engine slot
slot = cfg.get('plugins', {}).get('slots', {}).get('contextEngine', '(not set)')
print(f'  Context Engine Slot: {slot}')

# Offload config
offload = cfg.get('plugins', {}).get('entries', {}).get('$PLUGIN_ID', {}).get('config', {}).get('offload', {})
enabled = offload.get('enabled', False)
backend = offload.get('backendUrl', '(not set)')
user_id = offload.get('userId', '(not set)')
api_key = offload.get('backendApiKey', '')
timeout = offload.get('backendTimeoutMs', '(default)')
mild = offload.get('mildOffloadRatio', '(default 0.5)')
agg = offload.get('aggressiveCompressRatio', '(default 0.85)')

status_icon = '✅ Enabled' if enabled else '❌ Disabled'
api_key_display = f'{api_key[:8]}...' if api_key and len(api_key) > 8 else (api_key or '(not set)')
print(f'  Offload Status: {status_icon}')
print(f'  Backend URL:  {backend}')
print(f'  Backend Key:  {api_key_display}')
print(f'  User ID:      {user_id}')
print(f'  Timeout:      {timeout}ms')
print(f'  Mild Ratio:   {mild}')
print(f'  Aggressive:   {agg}')

# Compaction mode
compaction = cfg.get('agents', {}).get('defaults', {}).get('compaction', {}).get('mode', '(not set)')
print(f'  Compaction:   {compaction}')
"
}

# ═══════════════════════════════════════════════════════════════════
# --enable: Enable offload
# ═══════════════════════════════════════════════════════════════════
enable_offload() {
    # Validate arguments
    [[ -z "$USER_ID" ]] && fail "Missing required argument: --user-id"
    [[ -z "$BACKEND_URL" ]] && fail "Missing required argument: --backend-url"

    # Basic URL format validation
    if [[ ! "$BACKEND_URL" =~ ^https?:// ]]; then
        fail "Invalid backendUrl format. It must start with http:// or https://: $BACKEND_URL"
    fi

    check_openclaw_json
    backup_config

    echo ""
    info "${BOLD}[1/4] Validating patch${NC}"

    # ── Step 1: Run patch script (idempotent, skips if already patched) ──
    # The patch script includes precise idempotency checks. Exit codes mean:
    #   0 = success (new patch applied or already skipped)
    #   1 = failure (could not patch)
    if [[ -f "$PATCH_SCRIPT" ]]; then
        info "Running patch script..."
        local patch_exit=0
        local patch_output
        patch_output=$(bash "$PATCH_SCRIPT" 2>&1) || patch_exit=$?

        # Show patch script output (indented)
        while IFS= read -r line; do
            echo "  $line"
        done <<< "$patch_output"

        if [[ $patch_exit -eq 0 ]]; then
            ok "Patch validation passed"
        else
            echo ""
            echo -e "${RED}═══════════════════════════════════════════════════${NC}"
            echo -e "${RED}  ❌ Patch failed (exit code: $patch_exit)${NC}"
            echo -e "${RED}═══════════════════════════════════════════════════${NC}"
            echo ""
            echo -e "  ${RED}The after_tool_call hook could not access session messages,${NC}"
            echo -e "  ${RED}so offload L1/L3 compression will not work correctly.${NC}"
            echo ""
            echo -e "  ${CYAN}Troubleshooting steps:${NC}"
            echo -e "    1. DEBUG=1 bash $PATCH_SCRIPT"
            echo -e "    2. Check whether the OpenClaw version is compatible"
            echo ""
            exit 2
        fi
    else
        echo -e "${RED}[FAIL]${NC}  Patch script not found: $PATCH_SCRIPT" >&2
        echo -e "  ${RED}The offload feature depends on this patch. Aborting enable flow.${NC}" >&2
        exit 2
    fi

    # ── Step 2: Set context engine slot ──
    echo ""
    info "${BOLD}[2/4] Setting Context Engine Slot${NC}"

    python3 -c "
import json

with open('$OPENCLAW_JSON') as f:
    cfg = json.load(f)

# Ensure plugins.slots exists
cfg.setdefault('plugins', {}).setdefault('slots', {})
cfg['plugins']['slots']['contextEngine'] = '$CONTEXT_ENGINE_ID'
print('  slots.contextEngine = $CONTEXT_ENGINE_ID')

with open('$OPENCLAW_JSON', 'w') as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
    f.write('\n')
"
    ok "Context Engine Slot set"

    # ── Step 3: Set offload configuration ──
    echo ""
    info "${BOLD}[3/4] Setting Offload Configuration${NC}"

    python3 -c "
import json

with open('$OPENCLAW_JSON') as f:
    cfg = json.load(f)

# Ensure the path exists
entry = cfg.setdefault('plugins', {}).setdefault('entries', {}).setdefault('$PLUGIN_ID', {})
config = entry.setdefault('config', {})
offload = config.setdefault('offload', {})

# Set required configuration
offload['enabled'] = True
offload['backendUrl'] = '$BACKEND_URL'
offload['userId'] = '$USER_ID'
offload.setdefault('backendTimeoutMs', 120000)

api_key = '$BACKEND_API_KEY'
if api_key:
    offload['backendApiKey'] = api_key
    print(f'  offload.backendApiKey = {api_key[:8]}...' if len(api_key) > 8 else f'  offload.backendApiKey = {api_key}')
elif 'backendApiKey' in offload:
    del offload['backendApiKey']

print('  offload.enabled = true')
print('  offload.backendUrl = $BACKEND_URL')
print('  offload.userId = $USER_ID')
print(f'  offload.backendTimeoutMs = {offload[\"backendTimeoutMs\"]}')

with open('$OPENCLAW_JSON', 'w') as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
    f.write('\n')
"
    ok "Offload configuration set"

    # ── Step 4: Set compaction mode ──
    echo ""
    info "${BOLD}[4/4] Setting Compaction Mode${NC}"

    python3 -c "
import json

with open('$OPENCLAW_JSON') as f:
    cfg = json.load(f)

defaults = cfg.setdefault('agents', {}).setdefault('defaults', {})
compaction = defaults.setdefault('compaction', {})
old_mode = compaction.get('mode', '(not set)')
compaction['mode'] = 'safeguard'
print(f'  compaction.mode: {old_mode} → safeguard')

with open('$OPENCLAW_JSON', 'w') as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
    f.write('\n')
"
    ok "Compaction mode set to safeguard"

    # ── Done ──
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ✅ Offload enabled${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    echo ""
    show_status
    echo ""
    echo -e "  ${CYAN}Note: Restart the gateway for the change to take effect${NC}"
    echo -e "  ${CYAN}  bash install-plugin.sh --restart${NC}"
}

# ═══════════════════════════════════════════════════════════════════
# --disable: Disable offload
# ═══════════════════════════════════════════════════════════════════
disable_offload() {
    check_openclaw_json
    backup_config

    python3 -c "
import json

with open('$OPENCLAW_JSON') as f:
    cfg = json.load(f)

# Disable offload.enabled (use setdefault to ensure the path exists so changes write back to cfg)
entry = cfg.setdefault('plugins', {}).setdefault('entries', {}).setdefault('$PLUGIN_ID', {})
config = entry.setdefault('config', {})
offload = config.setdefault('offload', {})
offload['enabled'] = False
print('  offload.enabled = false')

# Remove the contextEngine slot
plugins = cfg.get('plugins', {})
slots = plugins.get('slots', {})
if 'contextEngine' in slots:
    del slots['contextEngine']
    print('  slots.contextEngine → removed')
    # If slots becomes empty, remove the slots key as well
    if not slots and 'slots' in plugins:
        del plugins['slots']
        print('  plugins.slots → cleaned up (empty object)')
else:
    print('  slots.contextEngine → nothing to remove (not present)')

with open('$OPENCLAW_JSON', 'w') as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
    f.write('\n')
"

    echo ""
    echo -e "${YELLOW}═══════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  ❌ Offload disabled${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${CYAN}Note: Restart the gateway for the change to take effect${NC}"
    echo -e "  ${CYAN}  bash install-plugin.sh --restart${NC}"
}

# ═══════════════════════════════════════════════════════════════════
# Main entry point
# ═══════════════════════════════════════════════════════════════════
case "$MODE" in
    enable)  enable_offload ;;
    disable) disable_offload ;;
    status)
        echo ""
        info "${BOLD}Offload Configuration Status${NC}"
        show_status
        ;;
esac
