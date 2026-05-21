#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# bugfix-20260423.sh — OC 2026.4.23 allowConversationAccess fix
# ═══════════════════════════════════════════════════════════════════
# Issue #73806: In OC 2026.4.23, the Zod schema uses .strict() and rejects
# the hooks.allowConversationAccess field, which prevents unbundled plugins
# from registering conversation hooks (llm_input, llm_output, agent_end).
# PR #71221 fixes this in 4.24.
#
# This script does two things (both are idempotent and safe to run repeatedly):
#   1. Patch dist JS: inject the allowConversationAccess field into the hooks zod schema
#   2. Write openclaw.json: set hooks.allowConversationAccess = true
#
# Version limit: run Part 1 only on OC 2026.4.23; safely skip the dist patch
#                on other versions.
#                Part 2 (config write) is version-independent and always ensures
#                the config exists.
#
# Usage:
#   bash bugfix-20260423.sh [/path/to/openclaw]
#
# Environment variables:
#   OPENCLAW_DIR    — override the openclaw install path (takes precedence after arg)
#   OPENCLAW_JSON   — override the config file path (default ~/.openclaw/openclaw.json)
#   DEBUG=1         — enable debug output
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*" >&2; exit 1; }
debug() { [[ "${DEBUG:-}" == "1" ]] && echo -e "${CYAN}[DEBUG]${NC} $*" || true; }

PLUGIN_ID="memory-tencentdb"
OPENCLAW_JSON="${OPENCLAW_JSON:-${HOME}/.openclaw/openclaw.json}"

# ═══════════════════════════════════════════════════════════════════
# Part 1: Patch dist JS (2026.4.23 only)
# ═══════════════════════════════════════════════════════════════════

_resolve_openclaw_dir() {
    # Argument > environment variable > auto-detect
    if [[ -n "${1:-}" ]]; then
        echo "$1"; return 0
    fi
    if [[ -n "${OPENCLAW_DIR:-}" && -d "${OPENCLAW_DIR}" ]]; then
        echo "$OPENCLAW_DIR"; return 0
    fi
    # Auto-detect location
    node -e "
      const {dirname, join} = require('path');
      const {realpathSync, existsSync, readFileSync, statSync} = require('fs');
      function walkUp(start) {
        let dir = statSync(start).isDirectory() ? start : dirname(start);
        for (let i = 0; i < 10; i++) {
          const pj = join(dir, 'package.json');
          if (existsSync(pj)) {
            try { if (JSON.parse(readFileSync(pj,'utf8')).name==='openclaw') { console.log(dir); process.exit(0); } } catch {}
          }
          const parent = dirname(dir);
          if (parent === dir) break;
          dir = parent;
        }
        return null;
      }
      try {
        const {execSync} = require('child_process');
        const bin = execSync('which openclaw',{encoding:'utf8'}).trim();
        const real = realpathSync(bin);
        const found = walkUp(real);
        if (found) { console.log(found); process.exit(0); }
        const content = readFileSync(bin,'utf8');
        const m = content.match(/['\"]([^'\"]*openclaw[^'\"]*\\.(?:js|mjs))['\"]/) ||
                  content.match(/['\"]([^'\"]*openclaw[^'\"]*)['\"].*node/);
        if (m) { const f = walkUp(realpathSync(m[1])); if (f) { console.log(f); process.exit(0); } }
      } catch {}
      const searchDirs = [
        join(process.env.HOME||'/root','.local/share/pnpm'),
        join(process.env.HOME||'/root','.local/node/lib/node_modules'),
        '/usr/local/lib/node_modules','/usr/lib/node_modules',
      ];
      for (const base of searchDirs) {
        if (!existsSync(base)) continue;
        try {
          const {execSync:e2} = require('child_process');
          const out = e2('find '+JSON.stringify(base)+' -maxdepth 8 -name package.json -path \"*/openclaw/package.json\" 2>/dev/null',{encoding:'utf8',timeout:5000}).trim();
          for (const line of out.split('\\n')) {
            if (!line) continue;
            try { if (JSON.parse(readFileSync(line,'utf8')).name==='openclaw') { console.log(dirname(line)); process.exit(0); } } catch {}
          }
        } catch {}
      }
      process.exit(1);
    " 2>/dev/null
}

patch_dist_js() {
    local oc_dir
    oc_dir="$(_resolve_openclaw_dir "${1:-}")" || {
        warn "[Part 1] Could not find the OpenClaw install directory; skipping dist patch"
        return 0
    }

    local dist_dir="$oc_dir/dist"
    [[ -d "$dist_dir" ]] || { warn "[Part 1] dist directory does not exist: $dist_dir; skipping"; return 0; }

    local version
    version=$(grep -oP '"version"\s*:\s*"\K[^"]+' "$oc_dir/package.json" 2>/dev/null || echo "unknown")
    info "[Part 1] OpenClaw version: $version"

    # Version gate: 2026.4.23 only
    if [[ ! "$version" =~ ^2026\.4\.23($|[-\.]) ]]; then
        ok "[Part 1] Version $version does not need the schema patch; skipping"
        return 0
    fi

    # Exact targeting: unique signature of the hooks zod schema
    local -a candidates
    mapfile -t candidates < <(
        grep -rl 'allowPromptInjection' "$dist_dir" --include='*.js' 2>/dev/null | while read -r _f; do
            if perl -0777 -ne 'exit(0) if /allowPromptInjection\s*:\s*[a-zA-Z_\$][a-zA-Z0-9_\$]*\s*\.\s*boolean\s*\(\s*\)\s*\.\s*optional\s*\(\s*\)\s*[,\s]*\}\s*\)\s*\.\s*strict\s*\(\s*\)/; exit(1)' "$_f" 2>/dev/null; then
                echo "$_f"
            fi
        done
    )

    if [[ ${#candidates[@]} -eq 0 ]]; then
        warn "[Part 1] Could not find the target hooks zod schema file; skipping"
        return 0
    elif [[ ${#candidates[@]} -gt 1 ]]; then
        warn "[Part 1] Found ${#candidates[@]} matching files (expected 1); skipping to stay safe"
        return 0
    fi

    local target="${candidates[0]}"
    local relpath="${target#$dist_dir/}"
    debug "[Part 1] Target: $relpath"

    # Idempotent: skip if allowConversationAccess is already present in the target file
    if grep -q 'allowConversationAccess' "$target" 2>/dev/null; then
        ok "[Part 1] allowConversationAccess already exists in $relpath; skipping"
        return 0
    fi

    # Backup
    [[ -f "${target}.pre-aca-patch.bak" ]] || cp "$target" "${target}.pre-aca-patch.bak"

    # Inject using an exact variable-name match to avoid greedy backtracking
    perl -0777 -i -pe '
        s/(allowPromptInjection\s*:\s*[a-zA-Z_\$][a-zA-Z0-9_\$]*\s*\.\s*boolean\s*\(\s*\)\s*\.\s*optional\s*\(\s*\))(\s*\}\s*\)\s*\.\s*strict\s*\(\s*\))/$1,allowConversationAccess:z.boolean().optional()$2/
    ' "$target"

    # Verify
    if grep -q 'allowConversationAccess' "$target" 2>/dev/null; then
        ok "[Part 1] $relpath — patch succeeded"
    else
        warn "[Part 1] patch verification failed; restoring backup"
        cp "${target}.pre-aca-patch.bak" "$target"
        return 1
    fi
}

# ═══════════════════════════════════════════════════════════════════
# Part 2: Write openclaw.json (all versions; always ensure the config exists)
# ═══════════════════════════════════════════════════════════════════

patch_config_json() {
    if [[ ! -f "$OPENCLAW_JSON" ]]; then
        warn "[Part 2] openclaw.json does not exist: $OPENCLAW_JSON; skipping"
        return 0
    fi

    # Idempotency check
    local exists
    exists=$(python3 -c "
import json
try:
    with open('$OPENCLAW_JSON') as f:
        cfg = json.load(f)
    val = cfg.get('plugins',{}).get('entries',{}).get('$PLUGIN_ID',{}).get('hooks',{}).get('allowConversationAccess')
    print('yes' if val is True else 'no')
except Exception:
    print('no')
" 2>/dev/null || echo "no")

    if [[ "$exists" == "yes" ]]; then
        ok "[Part 2] hooks.allowConversationAccess already exists; skipping"
        return 0
    fi

    # Write config
    python3 -c "
import json

with open('$OPENCLAW_JSON') as f:
    cfg = json.load(f)

entry = cfg.setdefault('plugins', {}).setdefault('entries', {}).setdefault('$PLUGIN_ID', {})
hooks = entry.setdefault('hooks', {})
hooks['allowConversationAccess'] = True

with open('$OPENCLAW_JSON', 'w') as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
    f.write('\n')
"
    ok "[Part 2] hooks.allowConversationAccess = true has been written"
}

# ═══════════════════════════════════════════════════════════════════
# Main entry point
# ═══════════════════════════════════════════════════════════════════

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  bugfix-20260423: one-click allowConversationAccess fix${NC}"
echo -e "${CYAN}  Issue #73806 | Applies to: OC 2026.4.23${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
echo ""

# ── Step 1: Stop Gateway ──
info "[Step 1] Stopping Gateway..."
openclaw gateway stop 2>/dev/null || true
sleep 10

# Confirm it has stopped
if ps aux | grep -v grep | grep -q 'openclaw-gateway'; then
    warn "Detected that openclaw-gateway is still running; trying a forced stop..."
    pkill -9 -f 'openclaw-gateway' 2>/dev/null || true
    sleep 3
fi

if ps aux | grep -v grep | grep -q 'openclaw-gateway'; then
    fail "[Step 1] Could not stop openclaw-gateway; please handle it manually and try again"
fi
ok "[Step 1] Gateway has stopped"
echo ""

# ── Step 2: Apply patch ──
info "[Step 2] Applying patch..."
if ! patch_dist_js "${1:-}"; then
    fail "[Step 2] dist JS patch failed"
fi
if ! patch_config_json; then
    fail "[Step 2] Failed to write openclaw.json"
fi
echo ""

# ── Step 3: Verify ──
info "[Step 3] Verifying results..."
echo ""

# 3.1 Verify openclaw.json
info "  [3.1] Checking openclaw.json"
if grep -q '"allowConversationAccess"' "$OPENCLAW_JSON" 2>/dev/null; then
    _json_line=$(grep -n 'allowConversationAccess' "$OPENCLAW_JSON")
    ok "  openclaw.json: allowConversationAccess ✓"
    echo -e "  ${CYAN}${_json_line}${NC}"
else
    fail "[Step 3.1] allowConversationAccess was not found in openclaw.json"
fi
echo ""

# 3.2 Verify dist JS — only check zod-schema-BhKK4qYw.js
info "  [3.2] Checking zod-schema-BhKK4qYw.js"
_oc_dir="$(_resolve_openclaw_dir "${1:-}" 2>/dev/null)" || _oc_dir=""
_zod_file="$_oc_dir/dist/zod-schema-BhKK4qYw.js"
if [[ -n "$_oc_dir" && -f "$_zod_file" ]]; then
    _match_count=$(grep -c 'allowConversationAccess' "$_zod_file" 2>/dev/null || echo "0")

    if [[ "$_match_count" -eq 0 ]]; then
        fail "[Step 3.2] allowConversationAccess was not found in zod-schema-BhKK4qYw.js"
    elif [[ "$_match_count" -eq 1 ]]; then
        ok "  zod-schema-BhKK4qYw.js: allowConversationAccess appears 1 time ✓"
        echo -e "  ${CYAN}Matched line:${NC}"
        grep -n 'allowConversationAccess' "$_zod_file" | head -1 | sed 's/^/  /'
    else
        fail "[Step 3.2] allowConversationAccess appears $_match_count times in zod-schema-BhKK4qYw.js (expected 1); it may have been injected more than once"
    fi
else
    fail "[Step 3.2] File does not exist: $_zod_file"
fi
echo ""

# ── Step 4: Restart Gateway ──
info "[Step 4] Restarting Gateway..."
openclaw gateway start
sleep 10

if ps aux | grep -v grep | grep -q 'openclaw-gateway'; then
    ok "[Step 4] Gateway has started (pid=$(pgrep -f 'openclaw-gateway' | head -1))"
else
    fail "[Step 4] Failed to start Gateway; please check the logs"
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ bugfix-20260423 fix completed and Gateway restarted${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
