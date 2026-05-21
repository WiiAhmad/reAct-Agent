#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# OpenClaw Patch: inject session messages into the after_tool_call hook
# ═══════════════════════════════════════════════════════════════════
# Purpose: inject ctx.params.session?.messages into the after_tool_call
#          hookEvent so plugins such as context-offload can access the
#          complete message history after a tool call.
#
# Compatibility strategy (tried in priority order, stops after first success):
#   Strategy 1: AST-like — find the durationMs field in the hookEvent object and append messages after it
#   Strategy 2: Legacy dispatch-*.js — handle earlier file layouts
#   Strategy 3: runAfterToolCall anchor — insert before the closing brace of hookEvent
#   Strategy 4: Generic fallback — use a loose match based on after_tool_call + durationMs
#
# Usage:
#   bash openclaw-after-tool-call-messages.patch.sh
#   bash openclaw-after-tool-call-messages.patch.sh /custom/path/to/openclaw
#
# Idempotency: files that are already patched are skipped automatically,
# so it is safe to run this script repeatedly.
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }
debug() { [[ "${DEBUG:-}" == "1" ]] && echo -e "${CYAN}[DEBUG]${NC} $*" || true; }

# ─── Locate the OpenClaw installation directory ───────────────────
# Uses Node.js require.resolve to locate the package root — handles
# nvm, pnpm, npm, yarn, volta, and any other layout automatically.
_node_resolve_openclaw() {
    node -e "
      const {dirname, join} = require('path');
      const {realpathSync, existsSync, readFileSync, statSync} = require('fs');

      // Helper: walk up from a file or directory to find the openclaw package root
      function walkUp(start) {
        let dir = statSync(start).isDirectory() ? start : dirname(start);
        for (let i = 0; i < 10; i++) {
          const pj = join(dir, 'package.json');
          if (existsSync(pj)) {
            try {
              const pkg = JSON.parse(readFileSync(pj, 'utf8'));
              if (pkg.name === 'openclaw') return dir;
            } catch {}
          }
          const parent = dirname(dir);
          if (parent === dir) break;
          dir = parent;
        }
        return null;
      }

      // Strategy 1: which openclaw → realpath → walk up
      try {
        const {execSync} = require('child_process');
        const bin = execSync('which openclaw', {encoding:'utf8'}).trim();
        const real = realpathSync(bin);
        const found = walkUp(real);
        if (found) { console.log(found); process.exit(0); }

        // pnpm uses shell shims: the bin file is a script, not a symlink.
        // Read the shim content to extract the real entry point path.
        const content = readFileSync(bin, 'utf8');
        // pnpm shim contains a line like: exec node \"/path/.../openclaw/dist/cli.js\"
        // or: require(\"/path/.../openclaw/dist/cli.js\")
        const m = content.match(/['\"]([^'\"]*openclaw[^'\"]*\\.(?:js|mjs))['\"]/) ||
                  content.match(/['\"]([^'\"]*openclaw[^'\"]*)['\"].*node/);
        if (m) {
          const shimTarget = realpathSync(m[1]);
          const found2 = walkUp(shimTarget);
          if (found2) { console.log(found2); process.exit(0); }
        }
      } catch {}

      // Strategy 2: search common pnpm/npm global paths
      const {execSync: exec2} = require('child_process');
      const searchDirs = [
        join(process.env.HOME || '/root', '.local/share/pnpm'),
        join(process.env.HOME || '/root', '.local/node/lib/node_modules'),
        '/usr/local/lib/node_modules',
        '/usr/lib/node_modules',
      ];
      for (const base of searchDirs) {
        if (!existsSync(base)) continue;
        try {
          const out = exec2(
            'find ' + JSON.stringify(base) + ' -maxdepth 8 -name package.json -path \"*/openclaw/package.json\" 2>/dev/null',
            {encoding:'utf8', timeout: 5000}
          ).trim();
          for (const line of out.split('\\n')) {
            if (!line) continue;
            try {
              const pkg = JSON.parse(readFileSync(line, 'utf8'));
              if (pkg.name === 'openclaw') { console.log(dirname(line)); process.exit(0); }
            } catch {}
          }
        } catch {}
      }

      process.exit(1);
    " 2>/dev/null
}

if [[ -n "${1:-}" ]]; then
    OPENCLAW_DIR="$1"
elif OPENCLAW_DIR="$(_node_resolve_openclaw)"; then
    debug "Node.js resolved openclaw → $OPENCLAW_DIR"
else
    fail "Could not find the OpenClaw installation directory. Please specify it manually:\n       bash $0 /path/to/openclaw"
fi

DIST_DIR="$OPENCLAW_DIR/dist"

if [[ ! -d "$DIST_DIR" ]]; then
    fail "dist directory does not exist: $DIST_DIR"
fi

info "OpenClaw directory: $OPENCLAW_DIR"

# ─── Detect the OpenClaw version ──────────────────────────────────
VERSION=$(grep -oP '"version"\s*:\s*"\K[^"]+' "$OPENCLAW_DIR/package.json" 2>/dev/null || echo "unknown")
info "Detected OpenClaw version: $VERSION"

# ─── Already-patched detection ────────────────────────────────────
# Core marker: messages injection appears right after durationMs inside hookEvent
# Supports multiple indentation styles (tabs / spaces / mixed)
INJECTION_CODE='messages: ctx.params.session?.messages'
INJECTION_CODE_ALT='messages:ctx.params.session?.messages'

is_already_patched() {
    local f="$1"
    # Method 1: exact detection — messages injection appears right after durationMs (allow any whitespace)
    if perl -0777 -ne 'exit(0) if /durationMs[,\s]*\n\s*messages\s*:\s*ctx\.params\.session\?\s*\.messages/; exit(1)' "$f" 2>/dev/null; then
        return 0
    fi
    # Method 2: context detection — messages injection exists inside the after_tool_call hookEvent object (near durationMs)
    # Note: we cannot scan the whole file because before_compaction also has messages: ctx.params.session.messages
    if perl -0777 -ne 'exit(0) if /(?:hookEvent|hook_event)\s*=\s*\{[\s\S]{0,500}durationMs[\s\S]{0,100}messages\s*:\s*ctx\.params\.session/; exit(1)' "$f" 2>/dev/null; then
        return 0
    fi
    return 1
}

verify_patch() {
    local f="$1"
    is_already_patched "$f"
}

# ─── Backup helper ────────────────────────────────────────────────
backup_file() {
    local f="$1"
    local bak="${f}.pre-offload-patch.bak"
    if [[ ! -f "$bak" ]]; then
        cp "$f" "$bak"
        debug "Backup created: $bak"
    fi
}

# ─── Find all candidate files ─────────────────────────────────────
# Collect all JS files containing after_tool_call (no limit on subdirectory depth)
mapfile -t CANDIDATE_FILES < <(grep -rl 'after_tool_call' "$DIST_DIR" --include='*.js' 2>/dev/null || true)

if [[ ${#CANDIDATE_FILES[@]} -eq 0 ]]; then
    warn "No JS files containing after_tool_call were found under $DIST_DIR"
fi

info "Found ${#CANDIDATE_FILES[@]} candidate files"

PATCHED=0
SKIPPED=0
FAILED=0

# ─── Try multiple strategies for each candidate file ──────────────
for f in "${CANDIDATE_FILES[@]}"; do
    fname="$(basename "$f")"
    relpath="${f#$DIST_DIR/}"

    # Already patched → skip
    if is_already_patched "$f"; then
        warn "$relpath — already patched, skipping"
        ((SKIPPED++)) || true
        continue
    fi

    # Confirm the file contains durationMs (marker field for hookEvent)
    if ! grep -q 'durationMs' "$f" 2>/dev/null; then
        debug "$relpath — does not contain durationMs, not a patch target, skipping"
        continue
    fi

    # Confirm durationMs appears near after_tool_call context (avoid false matches such as before_compaction)
    if ! perl -0777 -ne 'exit(0) if /after_tool_call[\s\S]{0,2000}durationMs/; exit(1)' "$f" 2>/dev/null; then
        debug "$relpath — durationMs is not in after_tool_call context, skipping"
        continue
    fi

    backup_file "$f"
    applied=false

    # ── Strategy 1: durationMs is the last field in the hookEvent object ──
    # Match: durationMs<newline><whitespace>};<newline><whitespace>hookRunnerAfter
    # Or:    durationMs<newline><whitespace>};<newline><whitespace>await ...hookRunner...afterToolCall
    # Use loose \s+ matching for indentation
    if [[ "$applied" == "false" ]]; then
        if perl -0777 -ne 'exit(0) if /durationMs\s*\n(\s*)\};\s*\n\s*(hookRunnerAfter|await\s+\S*hookRunner\S*\.runAfterToolCall|hookRunner\S*\.runAfterToolCall)/; exit(1)' "$f" 2>/dev/null; then
            debug "$relpath — matched strategy 1 (hookRunnerAfter anchor)"
            perl -0777 -i -pe 's/(durationMs)\s*\n(\s*\};\s*\n\s*(?:hookRunnerAfter|await\s+\S*hookRunner\S*\.runAfterToolCall|hookRunner\S*\.runAfterToolCall))/$1,\n\t\t\tmessages: ctx.params.session?.messages\n$2/' "$f"
            if verify_patch "$f"; then
                ok "[Strategy 1] $relpath — patch applied successfully"
                ((PATCHED++)) || true
                applied=true
            fi
        fi
    fi

    # ── Strategy 2: legacy dispatch-*.js — durationMs stands alone at end of line ──
    if [[ "$applied" == "false" ]]; then
        if echo "$relpath" | grep -qP 'dispatch-.*\.js' 2>/dev/null; then
            # Match a standalone durationMs at end of line (preceded by whitespace)
            if grep -qP '^\s+durationMs\s*$' "$f" 2>/dev/null; then
                debug "$relpath — matched strategy 2 (legacy dispatch)"
                sed -i -E 's/^(\s+)(durationMs)\s*$/\1\2,\n\1messages: ctx.params.session?.messages/' "$f"
                if verify_patch "$f"; then
                    ok "[Strategy 2] $relpath — patch applied successfully"
                    ((PATCHED++)) || true
                    applied=true
                fi
            fi
        fi
    fi

    # ── Strategy 3: durationMs is followed by }; but there is no hookRunnerAfter anchor ──
    # Match: durationMs<newline><whitespace>}; (hookEvent closing)
    # Use context (after_tool_call nearby) to confirm this is the right object
    if [[ "$applied" == "false" ]]; then
        # Find a code region containing durationMs with after_tool_call nearby (±20 lines)
        if perl -0777 -ne 'exit(0) if /after_tool_call[\s\S]{0,800}durationMs\s*\n(\s*)\};/; exit(1)' "$f" 2>/dev/null; then
            debug "$relpath — matched strategy 3 (durationMs→}; near after_tool_call)"
            # Only replace durationMs → }; near the after_tool_call context
            perl -0777 -i -pe 's/(after_tool_call[\s\S]{0,800}durationMs)\s*\n(\s*\};)/$1,\n\t\t\tmessages: ctx.params.session?.messages\n$2/' "$f"
            if verify_patch "$f"; then
                ok "[Strategy 3] $relpath — patch applied successfully"
                ((PATCHED++)) || true
                applied=true
            fi
        fi
    fi

    # ── Strategy 4: generic fallback — durationMs inside hookEvent assignment ──
    # Match forms like: const hookEvent = { ... durationMs ... }
    # Or:               hookEvent = { ... durationMs ... }
    # Use perl to find an object literal containing after_tool_call and durationMs, then insert after durationMs
    if [[ "$applied" == "false" ]]; then
        # Very loose: find the nearest "}" or "};" after "durationMs"
        # but restrict to within 2000 characters of the after_tool_call keyword
        if perl -0777 -ne 'exit(0) if /after_tool_call[\s\S]{0,2000}?(?:hookEvent|hook_event)[\s\S]{0,500}?durationMs/; exit(1)' "$f" 2>/dev/null; then
            debug "$relpath — matched strategy 4 (generic fallback)"
            # Append after durationMs (first match only)
            perl -0777 -i -pe '
                my $done = 0;
                s/(after_tool_call[\s\S]{0,2000}?(?:hookEvent|hook_event)[\s\S]{0,500}?durationMs)\s*\n(\s*)(\};)/
                    if (!$done) { $done = 1; "$1,\n$2\tmessages: ctx.params.session?.messages\n$2$3" }
                    else { "$1\n$2$3" }
                /ge;
            ' "$f"
            if verify_patch "$f"; then
                ok "[Strategy 4] $relpath — patch applied successfully"
                ((PATCHED++)) || true
                applied=true
            else
                warn "[Strategy 4] $relpath — patch verification failed, restoring backup"
                cp "${f}.pre-offload-patch.bak" "$f"
            fi
        fi
    fi

    # ── No strategy matched ────────────────────────────────────────
    if [[ "$applied" == "false" ]]; then
        debug "$relpath — no strategy matched"
        ((FAILED++)) || true
    fi
done

# ─── Result summary ────────────────────────────────────────────────
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Patch complete  (OpenClaw $VERSION)${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Success: ${GREEN}${PATCHED}${NC}  Skipped: ${YELLOW}${SKIPPED}${NC}  Failed: ${RED}${FAILED}${NC}"
echo ""
if [[ $PATCHED -gt 0 ]]; then
    echo -e "  ${CYAN}Takes effect after restarting OpenClaw.${NC}"
    echo -e "  ${CYAN}Backup files: *.pre-offload-patch.bak${NC}"
elif [[ $SKIPPED -gt 0 && $FAILED -eq 0 ]]; then
    echo -e "  ${YELLOW}All target files are already patched. No action needed.${NC}"
elif [[ $FAILED -gt 0 ]]; then
    echo -e "  ${RED}Some files could not be patched. You may need to inspect them manually or update the patch script.${NC}"
    echo -e "  ${RED}Tip: run with DEBUG=1 to see the detailed matching process:${NC}"
    echo -e "  ${RED}  DEBUG=1 bash $0 $OPENCLAW_DIR${NC}"
else
    echo -e "  ${RED}No matching target files were found. Please verify the OpenClaw version.${NC}"
    echo -e "  ${RED}Tip: run with DEBUG=1 to see the detailed matching process:${NC}"
    echo -e "  ${RED}  DEBUG=1 bash $0 $OPENCLAW_DIR${NC}"
fi
echo ""

# ─── Exit codes ───────────────────────────────────────────────────
# 0: success (at least one file patched successfully or already skipped)
# 1: failure (no file patched successfully and no already-patched files skipped)
if [[ $PATCHED -gt 0 || $SKIPPED -gt 0 ]]; then
    exit 0
else
    exit 1
fi
