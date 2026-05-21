#!/bin/bash
#
# install_memory_tencentdb.sh
#
# Run this after install_hermes_ubuntu.sh to:
#   1. Download @tencentdb-agent-memory/memory-tencentdb@latest with npm into
#      $MEMORY_TENCENTDB_ROOT/tdai-memory-openclaw-plugin (default: ~/.memory-tencentdb/tdai-memory-openclaw-plugin)
#   2. Install the Gateway's Node.js dependencies (npm install)
#   3. Configure hermes config.yaml to use the memory_tencentdb memory provider
#   4. Set environment variables for Gateway auto-start
#
# Path conventions (all under ~/.memory-tencentdb/, overrideable with environment variables):
#   $MEMORY_TENCENTDB_ROOT     default: ~/.memory-tencentdb
#   $TDAI_INSTALL_DIR          default: $MEMORY_TENCENTDB_ROOT/tdai-memory-openclaw-plugin
#   $TDAI_DATA_DIR             default: $MEMORY_TENCENTDB_ROOT/memory-tdai
#
# Older versions (<= 0.3.x) used ~/tdai-memory-openclaw-plugin and ~/memory-tdai;
# before running, this script automatically migrates those two legacy directories
# to the new locations (see Step 0).
#
# Usage:
#   Run as the target user (recommended):
#     su - <username> -c "bash ~/install_memory_tencentdb.sh"
#     # or log in as that user and run directly
#     bash ~/install_memory_tencentdb.sh
#
#   Run as root (image build scenario):
#     bash ~/install_memory_tencentdb.sh
#     # root will automatically su to the target user, then fix permissions when done
#
# Prerequisites:
#   - install_hermes_ubuntu.sh has already completed (hermes-agent is installed)
#   - Node.js >= 22 is installed

set -e

# Dynamically determine the target installation user and that user's HOME directory.
# Priority:
#   1. Explicit ``INSTALL_AS_USER`` environment variable (admin script scenario:
#      root runs the installer but wants to configure another user)
#   2. ``SUDO_USER`` (when invoked through ``sudo``, switch back to the original
#      user instead of root)
#   3. ``whoami`` — the user for the current EUID
#
# Note: when root logs in directly over ssh (not through sudo), the first two are
# not set, so ``whoami`` returns ``root``. The ``id -u`` == 0 branch below detects
# this "the target user is root" case and skips recursive ``su - root``.
USERNAME="${INSTALL_AS_USER:-${SUDO_USER:-$(whoami)}}"
USER_HOME=$(eval echo ~$USERNAME)

# npm package name
NPM_PACKAGE="@tencentdb-agent-memory/memory-tencentdb@latest"

# Hermes paths
HERMES_HOME="$USER_HOME/.hermes"
HERMES_AGENT_DIR="$HERMES_HOME/hermes-agent"
HERMES_CONFIG="$HERMES_HOME/config.yaml"

# Unified memory-tencentdb root directory (all tdai-related data/code lives here)
# Can be overridden with the MEMORY_TENCENTDB_ROOT environment variable
MEMORY_TENCENTDB_ROOT="${MEMORY_TENCENTDB_ROOT:-$USER_HOME/.memory-tencentdb}"

# tdai extraction target directory (under the unified root)
# Can be overridden with the TDAI_INSTALL_DIR environment variable
TDAI_INSTALL_DIR="${TDAI_INSTALL_DIR:-$MEMORY_TENCENTDB_ROOT/tdai-memory-openclaw-plugin}"

# tdai data directory (Gateway baseDir, under the unified root)
# Can be overridden with the TDAI_DATA_DIR environment variable
TDAI_DATA_DIR="${TDAI_DATA_DIR:-$MEMORY_TENCENTDB_ROOT/memory-tdai}"

# Legacy paths (used only for automatic migration)
LEGACY_INSTALL_DIR="$USER_HOME/tdai-memory-openclaw-plugin"
LEGACY_DATA_DIR="$USER_HOME/memory-tdai"

# ==================== root → automatically switch to the target user ====================
# Keep behavior aligned with install_hermes_ubuntu.sh: if run as root and the target
# user is not root, automatically su to the target user for the actual installation.
#
# If the current user is root and the target user is also root (``USERNAME=root``,
# for example when logging in directly as root over ssh), skip ``su - root`` —
# otherwise it would recurse forever (``su - root`` is still root, which reaches
# this branch again, then su again, and so on). See issue #20.

if [ "$(id -u)" -eq 0 ] && [ "$USERNAME" != "root" ]; then
    echo "[memory-tencentdb] Running as root, switching to $USERNAME for installation..."

    # Validate prerequisites
    if [ ! -d "$HERMES_AGENT_DIR" ]; then
        echo "[ERROR] Hermes agent not found at $HERMES_AGENT_DIR"
        echo "[ERROR] Please run install_hermes_ubuntu.sh first."
        exit 1
    fi

    # Switch to the target user to run the installation
    TEMP_SCRIPT=$(mktemp /tmp/memory-tencentdb-install-XXXXXX.sh)
    cp "${BASH_SOURCE[0]}" "$TEMP_SCRIPT"
    chmod 755 "$TEMP_SCRIPT"
    su - $USERNAME -c "bash $TEMP_SCRIPT" </dev/null

    # Fix permissions
    echo "[memory-tencentdb] Fixing permissions..."
    chown -R $USERNAME:$USERNAME "$USER_HOME"

    rm -f "$TEMP_SCRIPT"
    echo "[memory-tencentdb] Installation completed successfully"
    exit 0
elif [ "$(id -u)" -eq 0 ]; then
    # Current user is root and the target user is also root: run the remaining
    # installation logic directly as root, without another ``su -`` hop (avoids
    # the recursion described in #20).
    echo "[memory-tencentdb] Running as root; target user is also root — installing in place."
fi

# ==================== user phase (core installation logic) ====================

echo "[memory-tencentdb] Installing memory-tencentdb plugin (user: $(whoami))..."

# Validate prerequisites
if [ ! -d "$HERMES_AGENT_DIR" ]; then
    echo "[ERROR] Hermes agent not found at $HERMES_AGENT_DIR"
    echo "[ERROR] Please run install_hermes_ubuntu.sh first."
    exit 1
fi

# Load the hermes environment (node/npm need to be on PATH)
if [ -f /etc/profile.d/hermes-env.sh ]; then
    source /etc/profile.d/hermes-env.sh
fi

# Ensure the unified root directory exists
mkdir -p "$MEMORY_TENCENTDB_ROOT"

# ---------- Step 0: automatically migrate legacy paths (backward compatibility) ----------
#
# Older versions extracted tdai into ~/tdai-memory-openclaw-plugin and stored data
# in ~/memory-tdai. Everything is now consolidated under ~/.memory-tencentdb/, so
# this performs a one-time automatic migration.
# Skip if already in the new location; if both old and new exist, print a warning
# and keep the new location unchanged.

migrate_legacy_dir() {
    local legacy="$1"
    local target="$2"
    local label="$3"
    if [ ! -e "$legacy" ]; then
        return 0
    fi
    if [ -L "$legacy" ]; then
        # If the old location is a symlink, remove it directly
        echo "[memory-tencentdb] Removing legacy symlink: $legacy"
        rm -f "$legacy"
        return 0
    fi
    if [ -e "$target" ]; then
        echo "[memory-tencentdb] WARN: legacy $label dir exists at $legacy but new location $target also exists." >&2
        echo "[memory-tencentdb] WARN: keeping new location; please review and remove $legacy manually if obsolete." >&2
        return 0
    fi
    echo "[memory-tencentdb] Migrating legacy $label dir: $legacy -> $target"
    mkdir -p "$(dirname "$target")"
    mv "$legacy" "$target"
}

migrate_legacy_dir "$LEGACY_INSTALL_DIR" "$TDAI_INSTALL_DIR" "install"
migrate_legacy_dir "$LEGACY_DATA_DIR"    "$TDAI_DATA_DIR"    "data"

# ---------- Step 1: download the package with npm and extract it to $TDAI_INSTALL_DIR ----------

echo "[memory-tencentdb] Step 1: Downloading $NPM_PACKAGE via npm..."

# Clean up the old installation
rm -rf "$TDAI_INSTALL_DIR"

# Use a temporary directory and npm install to download the package
TEMP_DOWNLOAD=$(mktemp -d /tmp/memory-tencentdb-download-XXXXXX)
cd "$TEMP_DOWNLOAD"
npm init -y --silent > /dev/null 2>&1
npm install "$NPM_PACKAGE" --omit=dev 2>&1 | tail -5

# After installation, the package is at node_modules/@tencentdb-agent-memory/memory-tencentdb
PACK_DIR="$TEMP_DOWNLOAD/node_modules/@tencentdb-agent-memory/memory-tencentdb"

if [ ! -d "$PACK_DIR" ]; then
    echo "[ERROR] Downloaded package directory not found at $PACK_DIR"
    rm -rf "$TEMP_DOWNLOAD"
    exit 1
fi

# Move the package contents into the target installation directory
mkdir -p "$(dirname "$TDAI_INSTALL_DIR")"
cp -r "$PACK_DIR" "$TDAI_INSTALL_DIR"

echo "[memory-tencentdb] Package downloaded and extracted to $TDAI_INSTALL_DIR"

# ---------- Step 2: install Gateway Node.js dependencies ----------

echo "[memory-tencentdb] Step 2: Installing Gateway dependencies..."

cd "$TDAI_INSTALL_DIR"

echo "[memory-tencentdb] Running npm install (this may take a while)..."
npm install --omit=dev 2>&1 | tail -5

# Install tsx (required to start the Gateway), prefer a local install
if ! npx tsx --version &>/dev/null; then
    npm install tsx 2>&1 | tail -2
fi

echo "[memory-tencentdb] Gateway dependencies installed"

# ---------- Step 2.5: link the plugin into the hermes plugins directory ----------

echo "[memory-tencentdb] Step 2.5: Linking plugin into hermes plugins directory..."

HERMES_PLUGIN_DIR="$HERMES_AGENT_DIR/plugins/memory/memory_tencentdb"
PLUGIN_SRC_DIR="$TDAI_INSTALL_DIR/hermes-plugin/memory/memory_tencentdb"

# Remove the old link/directory
rm -rf "$HERMES_PLUGIN_DIR"

# Create a symlink so hermes can discover the plugin
ln -sf "$PLUGIN_SRC_DIR" "$HERMES_PLUGIN_DIR"

echo "[memory-tencentdb] Plugin linked: $HERMES_PLUGIN_DIR -> $PLUGIN_SRC_DIR"

# ---------- Step 3: prompt the user to enable memory_tencentdb manually (do not modify config automatically) ----------

echo "[memory-tencentdb] Step 3: Checking hermes config..."

# The plugin is linked into the hermes plugins directory, but it is not enabled
# automatically by default; only show a reminder
if [ -f "$HERMES_CONFIG" ]; then
    if sed -n '/^memory:/,/^[a-zA-Z]/p' "$HERMES_CONFIG" | grep -q "provider: memory_tencentdb"; then
        echo "[memory-tencentdb] memory.provider is already set to memory_tencentdb"
    else
        echo "[memory-tencentdb] Plugin installed but not enabled by default."
        echo "[memory-tencentdb] To enable tdai memory, add or edit this in $HERMES_CONFIG:"
        echo ""
        echo "    memory:"
        echo "      provider: memory_tencentdb"
        echo ""
    fi
else
    echo "[memory-tencentdb] WARN: $HERMES_CONFIG not found. Please run install_hermes_ubuntu.sh first."
fi

# ---------- Step 4: configure Gateway environment variables ----------

echo "[memory-tencentdb] Step 4: Setting up Gateway environment..."

# Build the Gateway startup command
# Wrap with sh -c so we can cd into the plugin directory before starting Gateway
# (required for ESM resolution)
GATEWAY_CMD="sh -c 'cd $TDAI_INSTALL_DIR && exec npx tsx src/gateway/server.ts'"

# ── 4a: /etc/profile.d (interactive SSH login scenario) ──
# Write persistent environment variables into /etc/profile.d for manual `hermes`
# runs in SSH sessions.
# Note: LLM-related variables (API key, model, etc.) still need to be configured
# manually by the user afterward.
ENVFILE="/etc/profile.d/memory-tencentdb-env.sh"
cat << ENVEOF | sudo tee "$ENVFILE" > /dev/null
# memory-tencentdb Gateway environment variables
export MEMORY_TENCENTDB_GATEWAY_CMD="$GATEWAY_CMD"
export MEMORY_TENCENTDB_GATEWAY_HOST="127.0.0.1"
export MEMORY_TENCENTDB_GATEWAY_PORT="8420"
# LLM configuration (edit as needed)
# export MEMORY_TENCENTDB_LLM_API_KEY="sk-..."
# export MEMORY_TENCENTDB_LLM_BASE_URL="https://api.openai.com/v1"
# export MEMORY_TENCENTDB_LLM_MODEL="gpt-4o"
ENVEOF

echo "[memory-tencentdb] Environment variables written to $ENVFILE"

# ── 4b: ~/.hermes/.env (systemd service scenario) ──
# When hermes-gateway starts through a systemd user service, it does not source
# /etc/profile.d/*.sh. However, hermes run.py does load_dotenv("~/.hermes/.env")
# on startup.
# Therefore these key variables must also be written into .env, otherwise the
# Gateway cannot auto-start under systemd.
HERMES_ENV="$HERMES_HOME/.env"

_append_or_update_env() {
    local key="$1"
    local value="$2"
    local file="$3"
    if [ ! -f "$file" ]; then
        touch "$file"
    fi
    # Remove existing lines for the same variable name (including commented and
    # quoted forms), then append the new value
    sed -i "/^${key}=/d" "$file"
    sed -i "/^# *${key}=/d" "$file"
    # python-dotenv requires double quotes around values containing spaces,
    # quotes, or special characters
    echo "${key}=\"${value}\"" >> "$file"
}

_append_or_update_env "MEMORY_TENCENTDB_GATEWAY_CMD" "$GATEWAY_CMD" "$HERMES_ENV"
_append_or_update_env "MEMORY_TENCENTDB_GATEWAY_HOST" "127.0.0.1"   "$HERMES_ENV"
_append_or_update_env "MEMORY_TENCENTDB_GATEWAY_PORT" "8420"         "$HERMES_ENV"

echo "[memory-tencentdb] Gateway env vars also written to $HERMES_ENV (for systemd service)"

# ---------- cleanup ----------

rm -rf "$TEMP_DOWNLOAD"

# ---------- verify installation ----------

echo ""
echo "=========================================="
echo "[memory-tencentdb] Installation Summary"
echo "=========================================="
echo "  Root dir:       $MEMORY_TENCENTDB_ROOT"
echo "  tdai source:    $TDAI_INSTALL_DIR"
echo "  tdai data dir:  $TDAI_DATA_DIR"
echo "  Hermes config:  $HERMES_CONFIG"
echo "  Env file:       $ENVFILE"
echo ""
echo "  Installed files in tdai dir:"
ls -la "$TDAI_INSTALL_DIR"/ 2>/dev/null | head -20 || echo "  (none)"
echo ""

# Verify hermes plugin files exist (inside the extracted directory)
PLUGIN_SRC="$TDAI_INSTALL_DIR/hermes-plugin/memory/memory_tencentdb"
MISSING=0
for f in __init__.py plugin.yaml client.py supervisor.py; do
    if [ ! -f "$PLUGIN_SRC/$f" ]; then
        echo "  [WARN] Missing: $PLUGIN_SRC/$f"
        MISSING=1
    fi
done

if [ "$MISSING" -eq 0 ]; then
    echo "  [OK] All hermes plugin files are present"
fi

# Verify the Gateway entry point exists
if [ -f "$TDAI_INSTALL_DIR/src/gateway/server.ts" ]; then
    echo "  [OK] Gateway entry point found"
else
    echo "  [WARN] Gateway server.ts not found at $TDAI_INSTALL_DIR/src/gateway/server.ts"
fi

# Verify node_modules is installed
if [ -d "$TDAI_INSTALL_DIR/node_modules" ]; then
    echo "  [OK] Gateway node_modules installed"
else
    echo "  [WARN] Gateway node_modules not found"
fi

echo ""
echo "[memory-tencentdb] Done!"
echo ""
echo "  NOTE: Before using the memory plugin, configure LLM credentials in ~/.hermes/.env:"
echo "    MEMORY_TENCENTDB_LLM_API_KEY=your-api-key"
echo "    MEMORY_TENCENTDB_LLM_BASE_URL=https://api.openai.com/v1"
echo "    MEMORY_TENCENTDB_LLM_MODEL=gpt-4o"
echo ""
echo "  (For systemd-managed hermes-gateway, ~/.hermes/.env is the authoritative configuration."
echo "   /etc/profile.d/ is only used for interactive SSH sessions.)"
echo ""
