#!/usr/bin/env bash
#
# memory-tencentdb-ctl.sh — unified management script for the memory_tencentdb (TDAI) service
#
# Two operating modes:
#
#   Default: standalone mode
#     Gateway runs as an independent HTTP service and does not touch ~/.hermes/
#       Log directory : $TDAI_DATA_DIR/logs/
#       Config file   : $TDAI_DATA_DIR/tdai-gateway.json   (llm / embedding / tcvdb)
#       Gateway bind  : 127.0.0.1:8420
#
#   --hermes mode (requires explicit --hermes or MEMORY_TENCENTDB_MODE=hermes)
#     Adds hermes integration — path conventions follow install_hermes_tdai_gateway.sh:
#       Log directory     : ~/.hermes/logs/memory_tencentdb/
#       env snippet file  : ~/.hermes/env.d/memory-tencentdb-llm.sh (config llm writes here)
#       hermes main config: ~/.hermes/config.yaml            (enable-hermes-memory modifies this)
#       Purpose: hermes supervisor can inherit LLM credentials for its managed
#                Gateway child process through os.environ.copy(); it also makes
#                debugging on the hermes side easier.
#
# Commands:
#   start | stop | restart | status | logs | health
#   config llm      --api-key <k> --base-url <u> --model <m>
#   config embedding --provider <p> --api-key <k> --base-url <u> --model <m> --dimensions <d>
#                   [--proxy-url <u>]
#   config vdb      --url <u> --username <u> --api-key <k> --database <d> [--ca-pem <path>]
#   config show
#   enable-hermes-memory        # only in --hermes mode: set hermes config.yaml
#                               #                   memory.provider to memory_tencentdb
#
# Most subcommands support --dry-run; all write operations use temporary files
# plus atomic rename replacement, and generated sensitive files are created with
# permissions set to 0600.

set -euo pipefail

# ============================================================
# Constants / paths
# ============================================================

SCRIPT_NAME="memory-tencentdb-ctl"
USER_HOME="${HOME:-$(eval echo "~$(whoami)")}"

# Unified memory-tencentdb root directory (all tdai-related data/code is stored here by default)
# Can be overridden with the MEMORY_TENCENTDB_ROOT environment variable
MEMORY_TENCENTDB_ROOT="${MEMORY_TENCENTDB_ROOT:-$USER_HOME/.memory-tencentdb}"

TDAI_INSTALL_DIR="${TDAI_INSTALL_DIR:-$MEMORY_TENCENTDB_ROOT/tdai-memory-openclaw-plugin}"
TDAI_DATA_DIR="${TDAI_DATA_DIR:-$MEMORY_TENCENTDB_ROOT/memory-tdai}"
GATEWAY_CFG="$TDAI_DATA_DIR/tdai-gateway.json"

# Legacy paths (warning only, no automatic migration; migration is handled by install_hermes_memory_tencentdb.sh)
_LEGACY_INSTALL_DIR="$USER_HOME/tdai-memory-openclaw-plugin"
_LEGACY_DATA_DIR="$USER_HOME/memory-tdai"
if [ -z "${TDAI_INSTALL_DIR_EXPLICIT:-}" ] && [ ! -e "$TDAI_INSTALL_DIR" ] && [ -e "$_LEGACY_INSTALL_DIR" ]; then
    printf '[%s] WARN: legacy install dir detected at %s; new default is %s. Run install_hermes_memory_tencentdb.sh to migrate, or `export TDAI_INSTALL_DIR=%s` to keep the old location.\n' \
        "$SCRIPT_NAME" "$_LEGACY_INSTALL_DIR" "$TDAI_INSTALL_DIR" "$_LEGACY_INSTALL_DIR" >&2
fi
if [ -z "${TDAI_DATA_DIR_EXPLICIT:-}" ] && [ ! -e "$TDAI_DATA_DIR" ] && [ -e "$_LEGACY_DATA_DIR" ]; then
    printf '[%s] WARN: legacy data dir detected at %s; new default is %s. Run install_hermes_memory_tencentdb.sh to migrate, or `export TDAI_DATA_DIR=%s` to keep the old location.\n' \
        "$SCRIPT_NAME" "$_LEGACY_DATA_DIR" "$TDAI_DATA_DIR" "$_LEGACY_DATA_DIR" >&2
fi

# Hermes paths are used only in --hermes mode; definitions are kept here so helpers can reuse them.
HERMES_HOME="${HERMES_HOME:-$USER_HOME/.hermes}"
HERMES_CONFIG="$HERMES_HOME/config.yaml"
HERMES_ENV_DIR="$HERMES_HOME/env.d"

GATEWAY_HOST="${MEMORY_TENCENTDB_GATEWAY_HOST:-127.0.0.1}"
GATEWAY_PORT="${MEMORY_TENCENTDB_GATEWAY_PORT:-8420}"

# Operating mode: standalone (default) | hermes
MODE="${MEMORY_TENCENTDB_MODE:-standalone}"

# These are assigned in _apply_mode_paths based on MODE
HERMES_LOG_DIR=""
PID_FILE=""
STDOUT_LOG=""
STDERR_LOG=""

DRY_RUN=0

# ============================================================
# General helpers
# ============================================================

log()  { printf '[%s] %s\n' "$SCRIPT_NAME" "$*"; }
warn() { printf '[%s:warn] %s\n' "$SCRIPT_NAME" "$*" >&2; }
die()  { printf '[%s:error] %s\n' "$SCRIPT_NAME" "$*" >&2; exit "${2:-1}"; }

need_cmd() {
    command -v "$1" >/dev/null 2>&1 || die "required command not found: $1" 127
}

# Safe shell quoting to prevent api_key and other special characters from breaking source
shell_quote() {
    printf '%s' "$1" | sed -e "s/'/'\\''/g" -e "1s/^/'/" -e "\$s/\$/'/"
}

# Atomic file write: write_file <path> <mode> <stdin content>
write_file_atomic() {
    local path="$1" mode="$2"
    local dir; dir="$(dirname "$path")"
    mkdir -p "$dir"
    if [[ $DRY_RUN -eq 1 ]]; then
        log "[dry-run] would write $path (mode=$mode):"
        sed 's/^/    /'
        return 0
    fi
    local tmp; tmp="$(mktemp "$dir/.${SCRIPT_NAME}.XXXXXX")"
    cat > "$tmp"
    chmod "$mode" "$tmp"
    mv -f "$tmp" "$path"
    log "wrote $path (mode=$mode)"
}

# PIDs listening on a port (prefer lsof, fall back to ss)
listening_pids() {
    local port="$1"
    if command -v lsof >/dev/null 2>&1; then
        lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true
    elif command -v ss >/dev/null 2>&1; then
        ss -ltnpH "sport = :$port" 2>/dev/null \
            | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u
    fi
}

# Health check (uses python3, not curl)
health_check() {
    local timeout="${1:-3}"
    python3 - "$GATEWAY_HOST" "$GATEWAY_PORT" "$timeout" <<'PYEOF' 2>/dev/null
import json, sys, urllib.request
host, port, timeout = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
url = f"http://{host}:{port}/health"
try:
    with urllib.request.urlopen(url, timeout=timeout) as r:
        body = r.read().decode("utf-8", "replace")
        print(body)
        sys.exit(0)
except Exception as e:
    print(f"health check failed: {e}", file=sys.stderr)
    sys.exit(1)
PYEOF
}

# Resolve log / PID directories based on MODE. Must be called after parsing
# --hermes and before any ensure_paths / startup logic.
_apply_mode_paths() {
    case "$MODE" in
        standalone)
            HERMES_LOG_DIR="${MEMORY_TENCENTDB_LOG_DIR:-$TDAI_DATA_DIR/logs}"
            ;;
        hermes)
            HERMES_LOG_DIR="${MEMORY_TENCENTDB_LOG_DIR:-$HERMES_HOME/logs/memory_tencentdb}"
            ;;
        *)
            die "invalid MODE: $MODE (expected standalone | hermes)" 1
            ;;
    esac
    PID_FILE="$HERMES_LOG_DIR/gateway.pid"
    STDOUT_LOG="$HERMES_LOG_DIR/gateway.stdout.log"
    STDERR_LOG="$HERMES_LOG_DIR/gateway.stderr.log"
}

# Guard for commands that are valid only in --hermes mode. Calling hermes-only
# commands outside hermes mode exits immediately.
require_hermes_mode() {
    [[ "$MODE" == "hermes" ]] || die \
        "'$1' is only available in --hermes mode; add --hermes or set MEMORY_TENCENTDB_MODE=hermes" 1
}

ensure_paths() {
    mkdir -p "$HERMES_LOG_DIR" "$TDAI_DATA_DIR"
    [[ "$MODE" == "hermes" ]] && mkdir -p "$HERMES_ENV_DIR"
    return 0
}

# Call this inside commands that need to source user env files. In standalone
# mode, it reads only top-level /etc/profile.d/ system configuration (for
# compatibility with the install script) and does not source ~/.hermes/env.d/*.
source_user_envs() {
    # System level: /etc/profile.d/memory-tencentdb-env.sh written by
    # install_hermes_tdai_gateway.sh contains only variables needed by the Gateway
    # itself (port/host/cmd/llm env), so it is safe to source in both modes.
    if [[ -r /etc/profile.d/memory-tencentdb-env.sh ]]; then
        # shellcheck disable=SC1091
        source /etc/profile.d/memory-tencentdb-env.sh
    fi

    if [[ "$MODE" == "hermes" ]]; then
        if [[ -r /etc/profile.d/hermes-env.sh ]]; then
            # shellcheck disable=SC1091
            source /etc/profile.d/hermes-env.sh
        fi
        # User-level env.d has higher precedence
        if [[ -d "$HERMES_ENV_DIR" ]]; then
            local f
            for f in "$HERMES_ENV_DIR"/*.sh; do
                [[ -r "$f" ]] || continue
                # shellcheck disable=SC1090
                source "$f"
            done
        fi
    fi
}

# ============================================================
# Startup command construction
#
# Priority:
#   1. MEMORY_TENCENTDB_GATEWAY_CMD (environment variable written by the install script)
#   2. Local tsx:  cd $TDAI_INSTALL_DIR && npx tsx src/gateway/server.ts
# ============================================================

resolve_gateway_cmd() {
    if [[ -n "${MEMORY_TENCENTDB_GATEWAY_CMD:-}" ]]; then
        printf '%s' "$MEMORY_TENCENTDB_GATEWAY_CMD"
        return 0
    fi
    local entry="$TDAI_INSTALL_DIR/src/gateway/server.ts"
    [[ -f "$entry" ]] || die "Gateway entry not found: $entry (has install_hermes_tdai_gateway.sh been run?)"
    # Match the install script style: sh -c 'cd ... && exec npx tsx ...'
    printf "sh -c 'cd %s && exec npx tsx src/gateway/server.ts'" "$TDAI_INSTALL_DIR"
}

# ============================================================
# Subcommands: start / stop / restart / status / logs / health
# ============================================================

cmd_start() {
    ensure_paths
    source_user_envs

    local pids; pids="$(listening_pids "$GATEWAY_PORT")"
    if [[ -n "$pids" ]]; then
        warn "Gateway is already running on :$GATEWAY_PORT (pid=$pids)"
        return 0
    fi

    need_cmd node
    need_cmd npx

    local gw_cmd; gw_cmd="$(resolve_gateway_cmd)"
    log "starting gateway: $gw_cmd"
    log "stdout -> $STDOUT_LOG"
    log "stderr -> $STDERR_LOG"

    if [[ $DRY_RUN -eq 1 ]]; then
        log "[dry-run] skip spawn"
        return 0
    fi

    # setsid detaches Gateway from the current shell process group; nohup is a
    # fallback to keep it alive after terminal disconnect.
    # eval is required because gw_cmd is a quoted structure like "sh -c '...'"
    if command -v setsid >/dev/null 2>&1; then
        eval "setsid nohup $gw_cmd >>\"$STDOUT_LOG\" 2>>\"$STDERR_LOG\" </dev/null &"
    else
        eval "nohup $gw_cmd >>\"$STDOUT_LOG\" 2>>\"$STDERR_LOG\" </dev/null &"
    fi
    local bg_pid=$!
    echo "$bg_pid" > "$PID_FILE"
    log "spawned pid=$bg_pid (shell wrapper)"

    # Wait for the port to start listening / health check to pass
    local i
    for i in $(seq 1 30); do
        sleep 0.5
        if [[ -n "$(listening_pids "$GATEWAY_PORT")" ]]; then
            if health_check 2 >/dev/null 2>&1; then
                log "gateway healthy on http://$GATEWAY_HOST:$GATEWAY_PORT"
                return 0
            fi
        fi
    done
    warn "gateway did not pass the health check within 15s; check $STDERR_LOG"
    return 1
}

cmd_stop() {
    local pids; pids="$(listening_pids "$GATEWAY_PORT")"
    if [[ -z "$pids" ]]; then
        log "no gateway is listening on :$GATEWAY_PORT"
        # Also clean up a leftover shell wrapper if present
        if [[ -f "$PID_FILE" ]]; then
            local wpid; wpid="$(cat "$PID_FILE" 2>/dev/null || true)"
            [[ -n "$wpid" ]] && kill -0 "$wpid" 2>/dev/null && kill -TERM "$wpid" 2>/dev/null || true
            rm -f "$PID_FILE"
        fi
        return 0
    fi

    log "sending SIGTERM to: $pids"
    [[ $DRY_RUN -eq 1 ]] && { log "[dry-run] skip kill"; return 0; }
    # shellcheck disable=SC2086
    kill -TERM $pids 2>/dev/null || true

    local i
    for i in $(seq 1 10); do
        sleep 0.5
        pids="$(listening_pids "$GATEWAY_PORT")"
        [[ -z "$pids" ]] && break
    done

    if [[ -n "$pids" ]]; then
        warn "SIGTERM did not take effect; sending SIGKILL: $pids"
        # shellcheck disable=SC2086
        kill -KILL $pids 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
    log "gateway stopped"
}

cmd_restart() {
    cmd_stop || true
    sleep 0.5
    cmd_start
}

cmd_status() {
    local pids; pids="$(listening_pids "$GATEWAY_PORT")"
    echo "== memory_tencentdb Gateway =="
    echo "  mode      : $MODE"
    echo "  host:port : $GATEWAY_HOST:$GATEWAY_PORT"
    echo "  install   : $TDAI_INSTALL_DIR"
    echo "  data dir  : $TDAI_DATA_DIR"
    echo "  log dir   : $HERMES_LOG_DIR"
    echo "  config    : $GATEWAY_CFG $([[ -f $GATEWAY_CFG ]] && echo '[exists]' || echo '[missing]')"
    if [[ "$MODE" == "hermes" ]]; then
        echo "  hermes cfg: $HERMES_CONFIG $([[ -f $HERMES_CONFIG ]] && echo '[exists]' || echo '[missing]')"
    fi
    if [[ -n "$pids" ]]; then
        echo "  state     : RUNNING (pid=$pids)"
        if health_check 2 >/dev/null 2>&1; then
            echo "  health    : OK"
        else
            echo "  health    : UNHEALTHY"
        fi
    else
        echo "  state     : STOPPED"
    fi

    if [[ "$MODE" == "hermes" ]]; then
        echo
        echo "== hermes memory provider =="
        if [[ -f "$HERMES_CONFIG" ]]; then
            local prov
            prov="$(sed -n '/^memory:/,/^[a-zA-Z]/p' "$HERMES_CONFIG" \
                    | sed -n 's/^[[:space:]]*provider:[[:space:]]*//p' | head -n1)"
            echo "  memory.provider = ${prov:-<unset>}"
        else
            echo "  (hermes config does not exist)"
        fi

        echo
        echo "== env files =="
        if [[ -d "$HERMES_ENV_DIR" ]]; then
            ls -l "$HERMES_ENV_DIR"/*.sh 2>/dev/null || echo "  (none)"
        else
            echo "  $HERMES_ENV_DIR not found"
        fi
    fi
}

cmd_logs() {
    local which="${1:-all}" lines="${2:-200}"
    case "$which" in
        out|stdout) tail -n "$lines" -f "$STDOUT_LOG" ;;
        err|stderr) tail -n "$lines" -f "$STDERR_LOG" ;;
        all|*)
            log "tail $STDOUT_LOG & $STDERR_LOG (press Ctrl-C to exit)"
            tail -n "$lines" -f "$STDOUT_LOG" "$STDERR_LOG"
            ;;
    esac
}

cmd_health() {
    if health_check 3; then
        log "gateway healthy"
    else
        die "gateway unhealthy" 1
    fi
}

# ============================================================
# Subcommand: config <llm|embedding|vdb|show>
#
# Writes to two places (aligned with sync_tdai_llm.sh):
#   - $HERMES_ENV_DIR/memory-tencentdb-<section>.sh   only needed for the llm section
#                                                     (exposed through environment variables)
#   - $GATEWAY_CFG (JSON)                             llm / embedding / tcvdb sections are all merged here
# ============================================================

# ---- JSON merge helper ----
# Usage: merge_gateway_json "<section>" <<<"$json_fragment"
# section: llm / embedding / tcvdb
merge_gateway_json() {
    local section="$1"
    ensure_paths
    if [[ $DRY_RUN -eq 1 ]]; then
        log "[dry-run] would merge '$section' into $GATEWAY_CFG"
        sed 's/^/    /'
        return 0
    fi
    need_cmd python3
    local fragment; fragment="$(cat)"
    SECTION="$section" FRAGMENT="$fragment" CFG="$GATEWAY_CFG" \
    python3 - <<'PYEOF'
import json, os, tempfile
section = os.environ["SECTION"]
fragment = json.loads(os.environ["FRAGMENT"])
path = os.environ["CFG"]

cfg = {}
if os.path.isfile(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            cfg = json.load(f) or {}
    except Exception:
        cfg = {}

# memory.* sections are nested under "memory" (as expected by loadGatewayConfig
# in gateway config.ts), but llm is a top-level section (see obj(fileConfig,"llm")
# around line 79 of src/gateway/config.ts).
if section == "llm":
    merged = cfg.get("llm") or {}
    merged.update(fragment)
    cfg["llm"] = merged
else:
    mem = cfg.get("memory") or {}
    sub = mem.get(section) or {}
    sub.update(fragment)
    mem[section] = sub
    cfg["memory"] = mem

d = os.path.dirname(path) or "."
fd, tmp = tempfile.mkstemp(prefix=".tdai-gateway.", dir=d)
os.close(fd)
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
os.chmod(tmp, 0o600)
os.replace(tmp, path)
PYEOF
    log "merged '$section' into $GATEWAY_CFG (0600)"
}

# ---- config llm ----
cmd_config_llm() {
    local api_key="" base_url="" model="" restart=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --api-key)  api_key="$2"; shift 2 ;;
            --base-url) base_url="$2"; shift 2 ;;
            --model)    model="$2"; shift 2 ;;
            --restart)  restart=1; shift ;;
            *) die "config llm: unknown argument $1" 1 ;;
        esac
    done
    [[ -n "$api_key"  ]] || die "--api-key is required"
    [[ -n "$base_url" ]] || die "--base-url is required"
    [[ -n "$model"    ]] || die "--model is required"
    case "$base_url" in
        http://*|https://*) ;;
        *) die "--base-url must start with http:// or https://: $base_url" 1 ;;
    esac

    log "configure LLM: model=$model base_url=$base_url api_key=<${#api_key} chars>"

    # 1) env file (only in --hermes mode): sourced when hermes starts, then the
    #    hermes supervisor injects the credentials into its managed Gateway child
    #    process through os.environ.copy(). In standalone mode, Gateway reads
    #    tdai-gateway.json directly, so no env file is needed.
    if [[ "$MODE" == "hermes" ]]; then
        local qk qu qm
        qk="$(shell_quote "$api_key")"
        qu="$(shell_quote "$base_url")"
        qm="$(shell_quote "$model")"
        write_file_atomic "$HERMES_ENV_DIR/memory-tencentdb-llm.sh" 600 <<EOF
# Auto-generated by $SCRIPT_NAME — do not edit by hand.
# Source this file in the shell that launches hermes so MemoryTencentdbProvider
# inherits the credentials via os.environ.copy().
export TDAI_LLM_BASE_URL=$qu
export TDAI_LLM_API_KEY=$qk
export TDAI_LLM_MODEL=$qm
# Legacy aliases used by the Python provider's get_config_schema()
export MEMORY_TENCENTDB_LLM_BASE_URL="\$TDAI_LLM_BASE_URL"
export MEMORY_TENCENTDB_LLM_API_KEY="\$TDAI_LLM_API_KEY"
export MEMORY_TENCENTDB_LLM_MODEL="\$TDAI_LLM_MODEL"
EOF
    fi

    # 2) merge into gateway.json (written in both modes)
    local frag
    frag=$(API="$api_key" URL="$base_url" MDL="$model" python3 -c '
import json, os
print(json.dumps({"baseUrl": os.environ["URL"], "apiKey": os.environ["API"], "model": os.environ["MDL"]}))
')
    printf '%s' "$frag" | merge_gateway_json llm

    [[ $restart -eq 1 ]] && cmd_restart || log "tip: add --restart to restart Gateway immediately and apply the new LLM settings"
}

# ---- config embedding ----
cmd_config_embedding() {
    local provider="" api_key="" base_url="" model="" dimensions="" proxy_url="" restart=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --provider)   provider="$2"; shift 2 ;;
            --api-key)    api_key="$2"; shift 2 ;;
            --base-url)   base_url="$2"; shift 2 ;;
            --model)      model="$2"; shift 2 ;;
            --dimensions) dimensions="$2"; shift 2 ;;
            --proxy-url)  proxy_url="$2"; shift 2 ;;
            --restart)    restart=1; shift ;;
            *) die "config embedding: unknown argument $1" 1 ;;
        esac
    done
    [[ -n "$provider" ]] || die "--provider is required (none/openai/deepseek/qclaw/...)"

    # provider=none writes only provider and clears the rest, effectively disabling vector retrieval
    if [[ "$provider" == "none" ]]; then
        printf '%s' '{"provider":"none","enabled":false}' | merge_gateway_json embedding
        log "embedding disabled (provider=none)"
        [[ $restart -eq 1 ]] && cmd_restart
        return 0
    fi

    [[ -n "$api_key"    ]] || die "--api-key is required"
    [[ -n "$base_url"   ]] || die "--base-url is required"
    [[ -n "$model"      ]] || die "--model is required"
    [[ -n "$dimensions" ]] || die "--dimensions is required (for example 1024)"
    case "$base_url" in
        http://*|https://*) ;;
        *) die "--base-url must start with http:// or https://: $base_url" 1 ;;
    esac
    [[ "$dimensions" =~ ^[0-9]+$ ]] || die "--dimensions must be a positive integer: $dimensions" 1

    if [[ "$provider" == "qclaw" && -z "$proxy_url" ]]; then
        die "provider=qclaw requires an additional --proxy-url" 1
    fi

    log "configure embedding: provider=$provider model=$model dims=$dimensions"

    local frag
    frag=$(
        PROV="$provider" API="$api_key" URL="$base_url" MDL="$model" \
        DIM="$dimensions" PROXY="$proxy_url" python3 -c '
import json, os
out = {
    "enabled": True,
    "provider": os.environ["PROV"],
    "baseUrl":  os.environ["URL"],
    "apiKey":   os.environ["API"],
    "model":    os.environ["MDL"],
    "dimensions": int(os.environ["DIM"]),
}
proxy = os.environ.get("PROXY", "")
if proxy:
    out["proxyUrl"] = proxy
print(json.dumps(out))
')
    printf '%s' "$frag" | merge_gateway_json embedding

    [[ $restart -eq 1 ]] && cmd_restart || log "tip: add --restart to apply embedding settings immediately"
}

# ---- config vdb (Tencent Cloud VectorDB) ----
cmd_config_vdb() {
    local url="" username="root" api_key="" database="" alias="" ca_pem="" embedding_model="" restart=0
    local set_backend=1
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --url)             url="$2"; shift 2 ;;
            --username)        username="$2"; shift 2 ;;
            --api-key)         api_key="$2"; shift 2 ;;
            --database)        database="$2"; shift 2 ;;
            --alias)           alias="$2"; shift 2 ;;
            --ca-pem)          ca_pem="$2"; shift 2 ;;
            --embedding-model) embedding_model="$2"; shift 2 ;;
            --no-set-backend)  set_backend=0; shift ;;
            --restart)         restart=1; shift ;;
            *) die "config vdb: unknown argument $1" 1 ;;
        esac
    done
    [[ -n "$url"      ]] || die "--url is required (for example http://xxx.tencentclb.com:8100)"
    [[ -n "$api_key"  ]] || die "--api-key is required"
    [[ -n "$database" ]] || die "--database is required"
    case "$url" in
        http://*|https://*) ;;
        *) die "--url must start with http:// or https://: $url" 1 ;;
    esac
    if [[ -n "$ca_pem" && ! -r "$ca_pem" ]]; then
        die "--ca-pem file is not readable: $ca_pem" 1
    fi

    log "configure VDB: url=$url database=$database user=$username"

    local frag
    frag=$(
        URL="$url" USR="$username" API="$api_key" DB="$database" \
        ALIAS="$alias" CA="$ca_pem" EM="$embedding_model" python3 -c '
import json, os
out = {
    "url":      os.environ["URL"],
    "username": os.environ["USR"],
    "apiKey":   os.environ["API"],
    "database": os.environ["DB"],
}
for k, env in [("alias","ALIAS"), ("caPemPath","CA"), ("embeddingModel","EM")]:
    v = os.environ.get(env, "")
    if v: out[k] = v
print(json.dumps(out))
')
    printf '%s' "$frag" | merge_gateway_json tcvdb

    # By default, also switch storeBackend to tcvdb (disable with --no-set-backend)
    if [[ $set_backend -eq 1 ]]; then
        printf '%s' '{"storeBackend":"tcvdb"}' | CFG="$GATEWAY_CFG" python3 -c '
import json, os, sys, tempfile
path = os.environ["CFG"]
fragment = json.loads(sys.stdin.read())
cfg = {}
if os.path.isfile(path):
    try:
        cfg = json.load(open(path, "r", encoding="utf-8")) or {}
    except Exception:
        cfg = {}
mem = cfg.get("memory") or {}
mem.update(fragment)
cfg["memory"] = mem
d = os.path.dirname(path) or "."
fd, tmp = tempfile.mkstemp(prefix=".tdai-gateway.", dir=d); os.close(fd)
json.dump(cfg, open(tmp, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
os.chmod(tmp, 0o600); os.replace(tmp, path)
' || warn "failed to set storeBackend"
        log "memory.storeBackend = tcvdb"
    fi

    [[ $restart -eq 1 ]] && cmd_restart || log "tip: add --restart to apply the VDB configuration immediately"
}

# ---- config vdb-off ----
# Switch gateway.json memory.storeBackend back to "sqlite".
# By default, keep memory.tcvdb credentials so you can switch back to vdb later
# without re-entering them; pass --purge-creds to explicitly remove the entire
# memory.tcvdb section.
cmd_config_vdb_off() {
    local restart=0 purge=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --purge-creds) purge=1; shift ;;
            --restart)     restart=1; shift ;;
            *) die "config vdb-off: unknown argument $1" 1 ;;
        esac
    done

    ensure_paths
    local purge_note=""
    [[ $purge -eq 1 ]] && purge_note=" (and remove memory.tcvdb)"
    if [[ $DRY_RUN -eq 1 ]]; then
        log "[dry-run] would set memory.storeBackend=sqlite in ${GATEWAY_CFG}${purge_note}"
        [[ $restart -eq 1 ]] && log "[dry-run] would restart Gateway"
        return 0
    fi
    if [[ ! -f "$GATEWAY_CFG" ]]; then
        warn "$GATEWAY_CFG does not exist; writing a minimal config containing only storeBackend=sqlite"
    fi

    need_cmd python3
    PURGE="$purge" CFG="$GATEWAY_CFG" python3 - <<'PYEOF' || die "failed to switch back to sqlite" 1
import json, os, sys, tempfile
path = os.environ["CFG"]
purge = os.environ.get("PURGE", "0") == "1"

cfg = {}
if os.path.isfile(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            cfg = json.load(f) or {}
    except Exception as e:
        sys.stderr.write(f"[memory-tencentdb-ctl:warn] failed to parse {path}; rebuilding from an empty config: {e}\n")
        cfg = {}

mem = cfg.get("memory") or {}
prev = mem.get("storeBackend")
mem["storeBackend"] = "sqlite"
if purge and "tcvdb" in mem:
    mem.pop("tcvdb", None)
cfg["memory"] = mem

d = os.path.dirname(path) or "."
os.makedirs(d, exist_ok=True)
fd, tmp = tempfile.mkstemp(prefix=".tdai-gateway.", dir=d); os.close(fd)
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
os.chmod(tmp, 0o600)
os.replace(tmp, path)
sys.stderr.write(f"[memory-tencentdb-ctl] memory.storeBackend: {prev!r} -> 'sqlite'"
                 + (" (tcvdb creds purged)" if purge else " (tcvdb creds kept)") + "\n")
PYEOF
    if [[ $purge -eq 1 ]]; then
        log "memory.storeBackend = sqlite (tcvdb creds purged)"
    else
        log "memory.storeBackend = sqlite (tcvdb creds kept; add --purge-creds to remove them)"
    fi
    [[ $restart -eq 1 ]] && cmd_restart || log "tip: add --restart to apply the rollback immediately"
}

# ---- config show ----
cmd_config_show() {
    echo "== $GATEWAY_CFG =="
    if [[ -f "$GATEWAY_CFG" ]]; then
        # Automatically redact apiKey
        python3 - "$GATEWAY_CFG" <<'PYEOF'
import json, sys
cfg = json.load(open(sys.argv[1], "r", encoding="utf-8"))
def redact(d):
    if isinstance(d, dict):
        for k, v in d.items():
            if isinstance(v, (dict, list)):
                redact(v)
            elif k.lower() in ("apikey","api_key","password","token") and isinstance(v, str) and v:
                d[k] = f"<redacted:{len(v)} chars>"
    elif isinstance(d, list):
        for x in d: redact(x)
redact(cfg)
print(json.dumps(cfg, indent=2, ensure_ascii=False))
PYEOF
    else
        echo "(not found)"
    fi

    echo
    if [[ "$MODE" == "hermes" ]]; then
        echo "== env files =="
        if [[ -d "$HERMES_ENV_DIR" ]]; then
            local f
            for f in "$HERMES_ENV_DIR"/memory-tencentdb-*.sh; do
                [[ -r "$f" ]] || continue
                echo "--- $f ---"
                # Redact API key values
                sed -E "s/(API_KEY=)'([^']{0,4})[^']*'/\1'\2<redacted>'/g" "$f"
            done
        fi
    else
        echo "(standalone mode: env.d is not written; add --hermes if you need hermes integration)"
    fi
}

# ============================================================
# Subcommand: enable-hermes-memory (only in --hermes mode)
# Set $HERMES_CONFIG memory.provider to memory_tencentdb.
# Write strategy (by priority, with automatic fallback):
#   1) ruamel.yaml round-trip: fully preserve comments, key order, quotes, indentation style
#   2) Minimal in-place line edit: change only the provider line and copy indentation
#      directly from existing sibling keys
#   3) If the memory section does not exist, append a minimal section at the end
# ============================================================

cmd_enable_hermes_memory() {
    require_hermes_mode "enable-hermes-memory"
    [[ -f "$HERMES_CONFIG" ]] || die "hermes config does not exist: $HERMES_CONFIG"
    [[ $# -eq 0 ]] || die "enable-hermes-memory: extra arguments are not supported: $*" 1

    if [[ $DRY_RUN -eq 1 ]]; then
        log "[dry-run] would set memory.provider=memory_tencentdb in $HERMES_CONFIG"
        return 0
    fi

    need_cmd python3
    # Write strategy (by priority, with automatic fallback):
    #   1. ruamel.yaml round-trip: fully preserve comments, key order, quotes, indentation style
    #   2. In-place line edit: only change the memory.provider line; copy indentation
    #      directly from sibling keys in the same section
    #   3. If the memory section does not exist, append a minimal section at the end
    #      (at that point there is no existing formatting left to preserve)
    python3 - "$HERMES_CONFIG" <<'PYEOF'
import os, re, sys, tempfile

path = sys.argv[1]
TARGET = "memory_tencentdb"


def _atomic_write(text: str) -> None:
    d = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(prefix=".hermes-config.", dir=d)
    os.close(fd)
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def try_ruamel() -> bool:
    """Preferred path: use ruamel.yaml round-trip editing to fully preserve comments/key order/indentation/quotes."""
    try:
        from ruamel.yaml import YAML  # type: ignore
    except Exception:
        return False
    yaml = YAML(typ="rt")
    yaml.preserve_quotes = True
    # Do not force a default indent; ruamel will reuse the document's existing style
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.load(f)
    if data is None:
        # Empty file: create a minimal mapping
        from ruamel.yaml.comments import CommentedMap
        data = CommentedMap()
    if "memory" not in data or not hasattr(data.get("memory"), "__setitem__"):
        from ruamel.yaml.comments import CommentedMap
        data["memory"] = CommentedMap()
    data["memory"]["provider"] = TARGET
    import io
    buf = io.StringIO()
    yaml.dump(data, buf)
    _atomic_write(buf.getvalue())
    print(f"updated {path} (ruamel.yaml round-trip)")
    return True


def fallback_inline_edit() -> None:
    """Fallback: minimal source-level in-place edit that never rewrites the full file structure.

    Rules:
      - Find the top-level `memory:` section and its block (until the next top-level key)
      - If the block already contains a `^(\\s+)provider\\s*:` line, replace only that
        line using the exact same prefix (reuse the existing provider indentation with
        zero guessing)
      - Otherwise, copy the indentation of any existing sibling key in the block and
        insert a new line immediately after `memory:`
      - If the block is completely empty (only a `memory:` line), insert a line after
        `memory:` using the child-key indentation found from another top-level mapping
        in the same file; if none exists, fall back to 2 spaces
      - If there is no top-level `memory:` section anywhere in the file, append a
        minimal section at the end
    """
    with open(path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    top_key_re = re.compile(r"^[A-Za-z_][\w\-]*\s*:")
    memory_start_re = re.compile(r"^memory\s*:\s*(#.*)?$")
    sibling_key_re = re.compile(r"^(\s+)[A-Za-z_][\w\-]*\s*:")
    provider_line_re = re.compile(r"^(\s+)provider(\s*):(\s*)(.*)$")

    def infer_indent_from_doc() -> str:
        """Extract an indentation string from the first child key under another top-level mapping in the document."""
        in_top = False
        for ln in lines:
            if top_key_re.match(ln):
                in_top = True
                continue
            if in_top:
                if not ln.strip() or ln.lstrip().startswith("#"):
                    continue
                m = sibling_key_re.match(ln)
                if m:
                    return m.group(1)
                if top_key_re.match(ln):
                    in_top = True
                    continue
                in_top = False
        return "  "  # Edge case: the file contains only memory: itself

    # Locate the top-level memory: section
    mem_idx = -1
    for idx, ln in enumerate(lines):
        if memory_start_re.match(ln):
            mem_idx = idx
            break

    if mem_idx == -1:
        # No memory section in the file: append directly (no formatting can be damaged)
        indent_str = infer_indent_from_doc()
        if lines and not lines[-1].endswith("\n"):
            lines.append("\n")
        lines.append("memory:\n")
        lines.append(f"{indent_str}provider: {TARGET}\n")
        _atomic_write("".join(lines))
        print(f"updated {path} (appended new memory section)")
        return

    # Define the block range: [mem_idx+1, end)
    end = len(lines)
    for j in range(mem_idx + 1, len(lines)):
        if top_key_re.match(lines[j]):
            end = j
            break
    block = lines[mem_idx + 1:end]

    # 1) If a provider line already exists, replace only that line with the same prefix
    for k, b in enumerate(block):
        m = provider_line_re.match(b)
        if m:
            indent = m.group(1)
            sp_before = m.group(2)
            sp_after = m.group(3) or " "
            # Preserve any trailing comment (content after #)
            tail = m.group(4)
            comment = ""
            ci = tail.find("#")
            if ci >= 0:
                # Simple handling: treat the content before # as the value, keep the comment afterward
                comment = "  " + tail[ci:].rstrip("\n")
            new_line = f"{indent}provider{sp_before}:{sp_after}{TARGET}{comment}\n"
            lines[mem_idx + 1 + k] = new_line
            _atomic_write("".join(lines))
            print(f"updated {path} (replaced provider line in-place)")
            return

    # 2) No provider line: copy indentation from another sibling key in the same block
    sibling_indent = None
    for b in block:
        if not b.strip() or b.lstrip().startswith("#"):
            continue
        m = sibling_key_re.match(b)
        if m:
            sibling_indent = m.group(1)
            break

    if sibling_indent is None:
        # No sibling keys in the block (for example just created or comments only) → infer from elsewhere in the document
        sibling_indent = infer_indent_from_doc()

    insert_at = mem_idx + 1
    new_line = f"{sibling_indent}provider: {TARGET}\n"
    lines.insert(insert_at, new_line)
    _atomic_write("".join(lines))
    print(f"updated {path} (inserted provider line)")


if not try_ruamel():
    sys.stderr.write(
        "[memory-tencentdb-ctl:info] ruamel.yaml is not installed; using the minimal in-place edit fallback "
        "(install ruamel.yaml with pip for best fidelity)\n"
    )
    fallback_inline_edit()
PYEOF
    log "hermes memory.provider = memory_tencentdb"
}

# ============================================================
# Command dispatch
# ============================================================

usage() {
    cat <<'USAGE'
memory-tencentdb-ctl.sh — management script for the memory_tencentdb (TDAI) Gateway

Operating modes:
  standalone (default)   Gateway runs independently; logs go to $TDAI_DATA_DIR/logs/; does not touch ~/.hermes
  --hermes               Adds hermes integration: logs go to ~/.hermes/logs/memory_tencentdb/,
                         config llm also writes ~/.hermes/env.d/memory-tencentdb-llm.sh,
                         and enables the enable-hermes-memory subcommand
                         (you can also enable this globally with MEMORY_TENCENTDB_MODE=hermes)

Common usage:
  memory-tencentdb-ctl start                        Start the Gateway
  memory-tencentdb-ctl stop                         Stop the Gateway
  memory-tencentdb-ctl restart                      Restart the Gateway
  memory-tencentdb-ctl status                       Show status
  memory-tencentdb-ctl health                       Run the health check (/health)
  memory-tencentdb-ctl logs [out|err|all] [N=200]   Follow logs

Configuration (by default writes only $TDAI_DATA_DIR/tdai-gateway.json, that is
              ~/.memory-tencentdb/memory-tdai/tdai-gateway.json; in --hermes mode,
              LLM config is also written to env.d):
  memory-tencentdb-ctl config llm --api-key K --base-url U --model M [--restart]
  memory-tencentdb-ctl config embedding --provider P --api-key K --base-url U \
                                        --model M --dimensions D [--proxy-url U] [--restart]
  memory-tencentdb-ctl config embedding --provider none           # Disable embedding
  memory-tencentdb-ctl config vdb --url U --api-key K --database D \
                                  [--username root] [--alias A] [--ca-pem /path] \
                                  [--embedding-model bge-large-zh] [--no-set-backend] [--restart]
  memory-tencentdb-ctl config vdb-off [--purge-creds] [--restart]
                                                # Switch back to local sqlite storage; keeps tcvdb
                                                # credentials by default (only changes storeBackend).
                                                # Use --purge-creds to remove credentials.
  memory-tencentdb-ctl config show                                 # Print configuration (apiKey redacted)

Hermes integration (requires --hermes):
  memory-tencentdb-ctl --hermes enable-hermes-memory
                                                    Set memory.provider in ~/.hermes/config.yaml;
                                                    prefer ruamel.yaml round-trip editing (preserves
                                                    comments/formatting), and fall back to minimal
                                                    in-place line editing if it is not installed.

Global options:
  --hermes / --standalone   Switch operating mode (default: standalone)
  --dry-run                 Preview all write operations without actually writing files
  -h, --help                Show this help

Key environment variables:
  MEMORY_TENCENTDB_MODE                      standalone | hermes (equivalent to --hermes / --standalone)
  MEMORY_TENCENTDB_GATEWAY_HOST / _PORT      Gateway bind address (default: 127.0.0.1:8420)
  MEMORY_TENCENTDB_GATEWAY_CMD               Custom startup command (otherwise use $TDAI_INSTALL_DIR)
  MEMORY_TENCENTDB_LOG_DIR                   Override the log directory
  MEMORY_TENCENTDB_ROOT                      Unified root directory (default: ~/.memory-tencentdb)
  TDAI_INSTALL_DIR / TDAI_DATA_DIR           Plugin source / data directory
                                             (both default to subdirectories under $MEMORY_TENCENTDB_ROOT)
USAGE
}

# Strip global flags
ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)    DRY_RUN=1; shift ;;
        --hermes)     MODE="hermes"; shift ;;
        --standalone) MODE="standalone"; shift ;;
        -h|--help)    usage; exit 0 ;;
        *) ARGS+=("$1"); shift ;;
    esac
done
set -- "${ARGS[@]:-}"

# Initialize log / PID paths based on MODE
_apply_mode_paths

[[ $# -ge 1 ]] || { usage; exit 1; }

SUB="$1"; shift || true
case "$SUB" in
    start)    cmd_start "$@" ;;
    stop)     cmd_stop "$@" ;;
    restart)  cmd_restart "$@" ;;
    status)   cmd_status "$@" ;;
    health)   cmd_health "$@" ;;
    logs)     cmd_logs "$@" ;;
    config)
        [[ $# -ge 1 ]] || die "config requires a subcommand: llm | embedding | vdb | vdb-off | show" 1
        SECTION="$1"; shift || true
        case "$SECTION" in
            llm)       cmd_config_llm "$@" ;;
            embedding) cmd_config_embedding "$@" ;;
            vdb)       cmd_config_vdb "$@" ;;
            vdb-off)   cmd_config_vdb_off "$@" ;;
            show)      cmd_config_show "$@" ;;
            *) die "unknown config subcommand: $SECTION" 1 ;;
        esac
        ;;
    enable-hermes-memory) cmd_enable_hermes_memory "$@" ;;
    *) usage; die "unknown command: $SUB" 1 ;;
esac
