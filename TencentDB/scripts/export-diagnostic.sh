#!/usr/bin/env bash
# OpenClaw + memory-tencentdb (formerly memory-tdai) diagnostic export script
# Note: the plugin has been renamed to memory-tencentdb, but the data directory
# remains memory-tdai because it is hard-coded in the implementation.
# Usage: bash export-diagnostic.sh [output_directory]
# By default, output is written to ~/Downloads/openclaw-diagnostic-<timestamp>/

set -euo pipefail

# ── Arguments ──
OUTPUT_BASE="${1:-$HOME/Downloads}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
EXPORT_DIR="${OUTPUT_BASE}/openclaw-diagnostic-${TIMESTAMP}"
ARCHIVE_PATH="${EXPORT_DIR}.tar.gz"

# ── Detect the OpenClaw working directory ──
if [ -n "${OPENCLAW_STATE_DIR:-}" ]; then
  STATE_DIR="$OPENCLAW_STATE_DIR"
elif [ -d "$HOME/.openclaw" ]; then
  STATE_DIR="$HOME/.openclaw"
elif [ -d "$HOME/.clawdbot" ]; then
  STATE_DIR="$HOME/.clawdbot"
else
  echo "❌ OpenClaw working directory not found (~/.openclaw or ~/.clawdbot)"
  exit 1
fi

echo "📂 OpenClaw working directory: $STATE_DIR"
echo "📦 Export directory: $EXPORT_DIR"

mkdir -p "$EXPORT_DIR"

# ── 1. Collect environment information ──
echo "🔍 Collecting environment information..."
{
  echo "=== Export time ==="
  date -Iseconds 2>/dev/null || date
  echo ""
  echo "=== System information ==="
  echo "OS: $(uname -a)"
  echo "Node: $(node --version 2>/dev/null || echo 'not found')"
  echo "pnpm: $(pnpm --version 2>/dev/null || echo 'not found')"
  echo ""
  echo "=== OpenClaw version ==="
  openclaw --version 2>/dev/null || pnpm openclaw --version 2>/dev/null || echo "(unknown)"
  echo ""
  echo "=== Working directory ==="
  echo "STATE_DIR: $STATE_DIR"
  echo ""
  echo "=== Directory structure ==="
  ls -la "$STATE_DIR/" 2>/dev/null || echo "(empty)"
  echo ""
  echo "=== memory-tdai directory structure ==="
  ls -laR "$STATE_DIR/memory-tdai/" 2>/dev/null || echo "(not found)"
  echo ""
  echo "=== Disk usage ==="
  du -sh "$STATE_DIR/memory-tdai/"* 2>/dev/null || echo "(not found)"
} > "$EXPORT_DIR/env-info.txt" 2>&1

# ── 2. Collect OpenClaw logs ──
echo "📋 Collecting OpenClaw logs..."
mkdir -p "$EXPORT_DIR/logs"

# Gateway logs (~/.openclaw/logs/)
if [ -d "$STATE_DIR/logs" ]; then
  cp -r "$STATE_DIR/logs/" "$EXPORT_DIR/logs/gateway-logs/" 2>/dev/null || true
fi

# Rolling logs (/tmp/openclaw/)
TMP_LOG_DIR="/tmp/openclaw"
if [ -d "$TMP_LOG_DIR" ]; then
  mkdir -p "$EXPORT_DIR/logs/rolling-logs"
  # Only keep the 3 most recent log files
  ls -t "$TMP_LOG_DIR"/openclaw-*.log 2>/dev/null | head -3 | while read -r f; do
    # Only keep the last 5000 lines from each file to avoid oversized output
    tail -5000 "$f" > "$EXPORT_DIR/logs/rolling-logs/$(basename "$f")" 2>/dev/null || true
  done
fi

# ── 3. Collect memory plugin data ──
# Note: the data directory is named memory-tdai for historical reasons and was not renamed after the plugin became memory-tencentdb.
echo "🧠 Collecting memory plugin data..."
MEMORY_DIR="$STATE_DIR/memory-tdai"
if [ -d "$MEMORY_DIR" ]; then
  mkdir -p "$EXPORT_DIR/memory-tdai"

  # L0 conversation records (JSONL)
  if [ -d "$MEMORY_DIR/conversations" ]; then
    cp -r "$MEMORY_DIR/conversations/" "$EXPORT_DIR/memory-tdai/conversations/" 2>/dev/null || true
  fi

  # L1 structured memory (JSONL)
  if [ -d "$MEMORY_DIR/records" ]; then
    cp -r "$MEMORY_DIR/records/" "$EXPORT_DIR/memory-tdai/records/" 2>/dev/null || true
  fi

  # L2 scene files (Markdown)
  if [ -d "$MEMORY_DIR/scene_blocks" ]; then
    cp -r "$MEMORY_DIR/scene_blocks/" "$EXPORT_DIR/memory-tdai/scene_blocks/" 2>/dev/null || true
  fi

  # L3 persona
  [ -f "$MEMORY_DIR/persona.md" ] && cp "$MEMORY_DIR/persona.md" "$EXPORT_DIR/memory-tdai/" 2>/dev/null || true

  # checkpoint + scene_index
  if [ -d "$MEMORY_DIR/.metadata" ]; then
    cp -r "$MEMORY_DIR/.metadata/" "$EXPORT_DIR/memory-tdai/.metadata/" 2>/dev/null || true
  fi

  # SQLite database (used to inspect vector/FTS index state)
  [ -f "$MEMORY_DIR/vectors.db" ] && cp "$MEMORY_DIR/vectors.db" "$EXPORT_DIR/memory-tdai/" 2>/dev/null || true

  # Backup directory (optional, may be large)
  if [ -d "$MEMORY_DIR/.backup" ]; then
    cp -r "$MEMORY_DIR/.backup/" "$EXPORT_DIR/memory-tdai/.backup/" 2>/dev/null || true
  fi
else
  echo "  ⚠️ memory-tdai data directory not found (data for the memory-tencentdb plugin is also stored here)"
fi

# ── 4. Collect OpenClaw configuration (redacted) ──
echo "🔧 Collecting OpenClaw configuration (redacted)..."
CONFIG_FILE="$STATE_DIR/openclaw.json"
if [ -f "$CONFIG_FILE" ]; then
  # Use Node to redact the configuration
  node -e "
    const fs = require('fs');
    const JSON5 = (() => { try { return require('json5'); } catch { return JSON; } })();
    const raw = fs.readFileSync('$CONFIG_FILE', 'utf-8');
    let cfg;
    try { cfg = JSON5.parse(raw); } catch { cfg = JSON.parse(raw); }

    // Recursive redaction helper
    function redact(obj, path) {
      if (!obj || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map((v, i) => redact(v, path + '[' + i + ']'));
      const result = {};
      for (const [k, v] of Object.entries(obj)) {
        const fullPath = path ? path + '.' + k : k;
        // Redaction rule: API key, token, password, secret, credential fields
        if (/api_?key|token|password|secret|credential/i.test(k) && typeof v === 'string') {
          result[k] = v.length > 0 ? '***REDACTED(' + v.length + 'chars)***' : '';
        }
        // Redact SecretRef objects
        else if (v && typeof v === 'object' && v.source && v.id && v.provider) {
          result[k] = { source: v.source, provider: v.provider, id: '***REDACTED***' };
        }
        // Top-level sensitive sections to skip entirely
        else if (['models', 'secrets', 'channels', 'env'].includes(k) && !path) {
          result[k] = '***REDACTED_SECTION(use openclaw config get ' + k + ' to inspect)***';
        }
        // token/password inside gateway.auth
        else if (path === 'gateway.auth' && /token|password/i.test(k)) {
          result[k] = typeof v === 'string' ? '***REDACTED***' : v;
        }
        else {
          result[k] = redact(v, fullPath);
        }
      }
      return result;
    }

    const redacted = redact(cfg, '');
    // plugins has already gone through recursive redact(), so fields such as
    // apiKey/token/password/secret are redacted automatically while preserving
    // non-sensitive configuration needed for troubleshooting, such as provider/model/enabled.

    fs.writeFileSync('$EXPORT_DIR/openclaw-config-redacted.json', JSON.stringify(redacted, null, 2));
    console.log('  ✅ Redacted configuration exported');
  " 2>&1 || {
    echo "  ⚠️ Node-based redaction failed; using grep for coarse redaction"
    # Coarse redaction: remove lines containing sensitive keywords
    grep -v -iE '(api.?key|token|password|secret|credential).*:.*"[^"]{8,}"' "$CONFIG_FILE" \
      | sed -E 's/"(models|secrets|channels|env)"\s*:\s*\{[^}]*\}/"__REDACTED_SECTION__"/g' \
      > "$EXPORT_DIR/openclaw-config-redacted.json" 2>/dev/null || true
  }
else
  echo "  ⚠️ Configuration file not found"
fi

# ── 5. Collect plugin installation information ──
echo "🔌 Collecting plugin installation information..."
if [ -d "$STATE_DIR/extensions" ]; then
  {
    echo "=== Installed plugins ==="
    ls -la "$STATE_DIR/extensions/" 2>/dev/null
    echo ""
    for ext_dir in "$STATE_DIR/extensions"/*/; do
      [ -d "$ext_dir" ] || continue
      pkg="$ext_dir/node_modules/openclaw/package.json"
      plugin_pkg="$ext_dir/package.json"
      echo "--- $(basename "$ext_dir") ---"
      if [ -f "$plugin_pkg" ]; then
        node -e "const p=require('$plugin_pkg'); console.log('name:', p.name, 'version:', p.version)" 2>/dev/null || true
      fi
    done
  } > "$EXPORT_DIR/plugins-info.txt" 2>&1
fi

# ── 6. Package ──
echo "📦 Creating archive..."
cd "$(dirname "$EXPORT_DIR")"
tar -czf "$ARCHIVE_PATH" "$(basename "$EXPORT_DIR")"

# Compute size
ARCHIVE_SIZE=$(du -sh "$ARCHIVE_PATH" | cut -f1)

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✅ Diagnostic export complete"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  📦 Archive: $ARCHIVE_PATH"
echo "  📏 Size: $ARCHIVE_SIZE"
echo ""
echo "  Included contents:"
echo "    - env-info.txt          — environment information and directory structure"
echo "    - logs/                 — OpenClaw gateway logs and rolling logs"
echo "    - memory-tdai/          — complete memory plugin data (L0~L3 + SQLite)"
echo "    - openclaw-config-redacted.json — redacted configuration file"
echo "    - plugins-info.txt      — plugin installation information"
echo ""
echo "  ⚠️ Security reminder:"
echo "    - The configuration file is automatically redacted (API keys, tokens, passwords, etc. are removed)"
echo "    - Sensitive sections such as models/secrets/channels/env are replaced in full"
echo "    - Memory data may contain user conversation content; please review before sending"
echo ""
echo "  📤 Please review it manually before sending it to the engineering team"
echo "═══════════════════════════════════════════════════"
