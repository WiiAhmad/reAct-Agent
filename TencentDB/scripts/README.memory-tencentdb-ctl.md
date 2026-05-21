# memory-tencentdb-ctl.sh — Operations Script for memory_tencentdb

> Use this together with [`install_hermes_memory_tencentdb.sh`](./install_hermes_memory_tencentdb.sh).
> First run the install script to deploy the plugin and Node dependencies. After that, handle all routine start/stop/configuration work through `memory-tencentdb-ctl.sh`.

## 1. Operating Modes

The script supports two modes. **The default is standalone mode**, which does not touch `~/.hermes` at all:

| Mode | How to enable it | What it does | What it does not do |
|---|---|---|---|
| `standalone` (default) | No extra arguments needed | Starts/stops the Gateway; writes `$TDAI_DATA_DIR/tdai-gateway.json`; writes logs to `$TDAI_DATA_DIR/logs/` | Does not write `$HERMES_HOME/env.d/`, does not modify `$HERMES_HOME/config.yaml`, and does not read Hermes-related environment variables |
| `hermes` | Add `--hermes` on the command line, or set `MEMORY_TENCENTDB_MODE=hermes` in the environment | Everything from standalone mode, plus `config llm` also writes `$HERMES_HOME/env.d/memory-tencentdb-llm.sh`; writes logs to `$HERMES_HOME/logs/memory_tencentdb/`; enables the `enable-hermes-memory` subcommand | — |

> **Why does hermes mode write an extra env file?**
> Because the Hermes process starts the Gateway as a managed child process (the supervisor passes the environment with `os.environ.copy()`). In that case, the Gateway cannot see the shell environment where `tdai-gateway.json` lives, so credentials must be injected through `$HERMES_HOME/env.d/*.sh` and sourced by Hermes itself. In standalone mode, the Gateway reads the JSON on its own, so this extra step is unnecessary.

## 2. Paths

> **Path variable convention**: this section and all examples below use `$HERMES_HOME` for the Hermes home directory, which defaults to `~/.hermes`. You can override it with an environment variable (for example, `export HERMES_HOME=/srv/hermes`), and both the script and Hermes itself honor that variable.
>
> Starting with 0.4.x, all tdai-related data and code are grouped under the unified root directory `$MEMORY_TENCENTDB_ROOT` (default: `~/.memory-tencentdb`):
>
> - `$TDAI_INSTALL_DIR` defaults to `$MEMORY_TENCENTDB_ROOT/tdai-memory-openclaw-plugin` (that is, `~/.memory-tencentdb/tdai-memory-openclaw-plugin`)
> - `$TDAI_DATA_DIR` defaults to `$MEMORY_TENCENTDB_ROOT/memory-tdai` (that is, `~/.memory-tencentdb/memory-tdai`)
>
> Whenever these variables appear below, you can simply `export` an override before running the command and it will apply globally.
> Older versions used `~/tdai-memory-openclaw-plugin` and `~/memory-tdai`; during upgrades, `install_hermes_memory_tencentdb.sh` automatically migrates those two legacy directories to the new locations.

| Path | standalone | hermes | Purpose |
|---|---|---|---|
| `$TDAI_INSTALL_DIR` | ✅ | ✅ | Plugin source code + `node_modules` + `src/gateway/server.ts` |
| `$TDAI_DATA_DIR/tdai-gateway.json` | ✅ | ✅ | Main Gateway config: `llm` / `memory.embedding` / `memory.tcvdb` / `memory.storeBackend`; permissions `0600` |
| `$TDAI_DATA_DIR/logs/` | ✅ logs | — | `gateway.stdout.log` / `gateway.stderr.log` / `gateway.pid` |
| `$HERMES_HOME/logs/memory_tencentdb/` | — | ✅ logs | Same files as above, just in a different directory |
| `$HERMES_HOME/env.d/memory-tencentdb-llm.sh` | — | ✅ | Sourced before Hermes starts, so LLM credentials are injected into the supervisor-managed Gateway child process |
| `$HERMES_HOME/config.yaml` | — | ✅ | Modified by `enable-hermes-memory` to update `memory.provider` |
| Gateway listener | `127.0.0.1:8420` | `127.0.0.1:8420` | Can be overridden with `MEMORY_TENCENTDB_GATEWAY_HOST/PORT` |

All paths can also be overridden with environment variables of the same names. Listed again here for convenience: `MEMORY_TENCENTDB_ROOT` (default `~/.memory-tencentdb`), `TDAI_INSTALL_DIR` (default `$MEMORY_TENCENTDB_ROOT/tdai-memory-openclaw-plugin`), `TDAI_DATA_DIR` (default `$MEMORY_TENCENTDB_ROOT/memory-tdai`), `HERMES_HOME` (default `~/.hermes`), `MEMORY_TENCENTDB_LOG_DIR`, and `MEMORY_TENCENTDB_GATEWAY_HOST/PORT`.

Dependencies: `bash`, `python3`, `node >= 22`, `npx`, and either `lsof` or `ss`.

## 3. Installation and Invocation

The script is published with the npm package under `node_modules/.../scripts/`, but it is **not** registered as a `bin` command. If you want to call it by a global command name, you must create the symlink yourself.

### 3.1 Run directly from the npm package (no extra setup required)

```bash
npm install @tencentdb-agent-memory/memory-tencentdb

# Local project install; resolve the path dynamically with npm root
"$(npm root)/@tencentdb-agent-memory/memory-tencentdb/scripts/memory-tencentdb-ctl.sh" --help

# Global install; use npm root -g
"$(npm root -g)/@tencentdb-agent-memory/memory-tencentdb/scripts/memory-tencentdb-ctl.sh" --help
```

`npm root` / `npm root -g` return the correct directory across all package managers (npm / pnpm / yarn) and different prefix configurations, so you do not need to hardcode a `node_modules/` path. This is ideal for one-off or temporary use.

### 3.2 Symlink into PATH (recommended for operations / long-term use)

No matter where the script comes from (a git-cloned repository, an `npm install`ed package, or a custom deployment directory), first resolve the script path into a variable, then create the symlink from that variable. This keeps the process the same whether the repository lives under `~/code/`, `/opt/`, or anywhere else.

```bash
# Step 1: locate the real path to memory-tencentdb-ctl.sh (choose any one source)

# (a) From a git repository (run from the repo root or any subdirectory)
SCRIPT="$(git -C "$(git rev-parse --show-toplevel)" ls-files | \
          grep -E 'scripts/memory-tencentdb-ctl\.sh$' | head -1)"
SCRIPT="$(git rev-parse --show-toplevel)/$SCRIPT"

# (b) From a globally installed npm package
SCRIPT="$(npm root -g)/@tencentdb-agent-memory/memory-tencentdb/scripts/memory-tencentdb-ctl.sh"

# (c) From the project's local node_modules
SCRIPT="$(npm root)/@tencentdb-agent-memory/memory-tencentdb/scripts/memory-tencentdb-ctl.sh"

# (d) A fully manual absolute path (for example, a non-standard deployment location)
SCRIPT="/opt/tdai/scripts/memory-tencentdb-ctl.sh"

# Step 2: verify the path, then create the symlink
test -f "$SCRIPT" && echo "ok: $SCRIPT" || { echo "not found"; exit 1; }
chmod +x "$SCRIPT"
sudo ln -sf "$SCRIPT" /usr/local/bin/memory-tencentdb-ctl

# Use the same method to link install_hermes_memory_tencentdb.sh as install-memory-tencentdb (optional)
INSTALL_SCRIPT="$(dirname "$SCRIPT")/install_hermes_memory_tencentdb.sh"
test -f "$INSTALL_SCRIPT" && {
  chmod +x "$INSTALL_SCRIPT"
  sudo ln -sf "$INSTALL_SCRIPT" /usr/local/bin/install-memory-tencentdb
}
```

After that, you can run `memory-tencentdb-ctl …` / `install-memory-tencentdb …` directly.

> **Why not register it directly with `npm bin`?** These two scripts are operations tools, not part of the package's core API. The main repository intentionally requires users to register them in PATH **explicitly**, to avoid accidentally polluting the global command namespace and to avoid silently removing operations entry points when the npm package is uninstalled.

## 4. Lifecycle Management (shared by both modes)

```bash
memory-tencentdb-ctl start        # If :8420 is already in use, return immediately; otherwise spawn in the background and wait for /health to pass
memory-tencentdb-ctl stop         # SIGTERM first, then SIGKILL if it has not exited within 5 seconds
memory-tencentdb-ctl restart
memory-tencentdb-ctl status       # Print the mode, port, data/log paths, and process status
memory-tencentdb-ctl health       # GET /health, implemented purely with python3 and does not require curl
memory-tencentdb-ctl logs         # tail -f stdout + stderr
memory-tencentdb-ctl logs err 500 # Show only the most recent 500 lines of stderr
```

Startup command resolution order:

1. Environment variable `MEMORY_TENCENTDB_GATEWAY_CMD` (the one written by `install_hermes_memory_tencentdb.sh` into `/etc/profile.d/memory-tencentdb-env.sh`).
2. Fallback to `sh -c 'cd $TDAI_INSTALL_DIR && exec npx tsx src/gateway/server.ts'`.

Environment files sourced automatically on startup:

- Both modes: `/etc/profile.d/memory-tencentdb-env.sh`
- Hermes mode only: `/etc/profile.d/hermes-env.sh` and `$HERMES_HOME/env.d/*.sh`

## 5. Configure LLM / Embedding / VDB

All three credential types are written to `$TDAI_DATA_DIR/tdai-gateway.json` (`0600`, atomic write). **In `--hermes` mode, `config llm` also writes an env file**; Embedding and VDB never write env files.

### 5.1 LLM

```bash
# standalone mode: writes only tdai-gateway.json
memory-tencentdb-ctl config llm \
  --api-key   "sk-xxxxxxxxxxxx" \
  --base-url  "https://api.openai.com/v1" \
  --model     "gpt-4o" \
  --restart

# hermes mode: tdai-gateway.json + $HERMES_HOME/env.d/memory-tencentdb-llm.sh
memory-tencentdb-ctl --hermes config llm \
  --api-key   "sk-xxxxxxxxxxxx" \
  --base-url  "https://api.openai.com/v1" \
  --model     "gpt-4o" \
  --restart
```

- JSON write target: `$.llm.{baseUrl, apiKey, model}`.
- Env file output (`--hermes` only): `TDAI_LLM_*` plus `MEMORY_TENCENTDB_LLM_*` aliases (the Python provider's `get_config_schema()` reads the latter).

### 5.2 Embedding

Disabled by default (`provider=none`). To enable a remote OpenAI-compatible service:

```bash
memory-tencentdb-ctl config embedding \
  --provider   openai \
  --api-key    "sk-xxxx" \
  --base-url   "https://api.openai.com/v1" \
  --model      "text-embedding-3-small" \
  --dimensions 1536 \
  --restart

# Disable embedding (fall back to BM25 / keyword recall)
memory-tencentdb-ctl config embedding --provider none --restart
```

- JSON write target: `$.memory.embedding.{provider, baseUrl, apiKey, model, dimensions, enabled, proxyUrl?}`.
- The `qclaw` provider additionally requires `--proxy-url`.
- Validation rules are aligned with `src/config.ts` `parseConfig()`: `dimensions` must be a positive integer, and any provider other than `none` must include `apiKey/baseUrl/model/dimensions`; if anything is missing, the script errors out immediately and does not write a half-broken JSON file.

### 5.3 VectorDB (Tencent Cloud VDB / tcvdb)

```bash
memory-tencentdb-ctl config vdb \
  --url       "http://xxx-vdb.tencentclb.com:8100" \
  --username  root \
  --api-key   "YOUR-VDB-API-KEY" \
  --database  "openclaw_memory" \
  --alias     "primary" \
  --embedding-model "bge-large-zh" \
  --ca-pem    "/etc/ssl/vdb-ca.pem" \
  --restart
```

- JSON write target: `$.memory.tcvdb.{url, username, apiKey, database, alias?, caPemPath?, embeddingModel?}`.
- By default it also switches `$.memory.storeBackend` to `"tcvdb"`; if you want to preload the config without switching yet, add `--no-set-backend`.
- `--ca-pem` writes only the path and does not copy the file; the script verifies that the file is readable.

### 5.4 Switch back to local SQLite (disable the VDB backend)

```bash
# Default: keep memory.tcvdb credentials (so you can switch back at any time), only change storeBackend to sqlite
memory-tencentdb-ctl config vdb-off --restart

# Also remove Tencent Cloud VDB credentials such as url / apiKey / database from the JSON
memory-tencentdb-ctl config vdb-off --purge-creds --restart
```

- JSON write target: set `$.memory.storeBackend` to `"sqlite"`; with `--purge-creds`, also remove the entire `$.memory.tcvdb` section.
- Other top-level sections such as `$.llm` and `$.memory.embedding` remain **completely unchanged**, and Hermes-side `memory.provider` is **not modified** (it stays `memory_tencentdb`; only the internal storage backend switches back to SQLite).
- If the config file does not exist, the script prints a `warn` and writes a minimal config containing only `{"memory":{"storeBackend":"sqlite"}}`.
- This is a full mirror of `config vdb`: it can be combined with `--dry-run` and `--restart`.

### 5.5 Show the current configuration

```bash
memory-tencentdb-ctl config show
```

- Prints `tdai-gateway.json`; fields such as `apiKey`, `password`, and `token` are automatically redacted as `<redacted:NN chars>`.
- In Hermes mode, it also prints `$HERMES_HOME/env.d/memory-tencentdb-*.sh` (with API keys redacted as well), so you can paste the output directly into an operations ticket.

## 6. Wire it into Hermes (`--hermes` mode only)

```bash
memory-tencentdb-ctl --hermes enable-hermes-memory
```

Idempotent behavior: changes `provider:` inside the `memory:` section of `$HERMES_HOME/config.yaml` to `memory_tencentdb` (or adds the entire section if it does not exist yet). Restart Hermes after the change:

```bash
source "$HERMES_HOME/env.d/memory-tencentdb-llm.sh"
pkill -f hermes-agent || true
hermes
```

> **About the write strategy**: the script uses a "format-preserving" dual-path approach and **never rewrites the entire YAML**:
>
> 1. **Preferred**: if [`ruamel.yaml`](https://yaml.readthedocs.io/) is available, it uses round-trip processing to preserve comments, key order, quotes, and indentation style in full (for best fidelity, install it with `pip install --user ruamel.yaml`; this is **recommended but not required**);
> 2. **Fallback**: if ruamel is not installed, it performs minimal in-place line editing and rewrites only the `provider:` line. The indentation is copied **character for character** from sibling keys in the same section, with zero guessing and zero formatting damage;
> 3. If the `memory:` section does not exist, it appends a minimal section to the end of the file, copying indentation style from child keys under other top-level sections in the document.
>
> Verified with byte-for-byte diffs against a real `~/.hermes/config.yaml`: aside from the `provider` value itself, every other byte remains identical.

Calling this command outside Hermes mode exits immediately with an error.

> If you want the opposite behavior — keep the Hermes provider unchanged, but switch TDAI's internal storage back to SQLite — use `config vdb-off` from §5.4 instead. There is no need to modify, and you **should not** modify, Hermes `memory.provider` for that case.

## 7. Typical Workflows

### Scenario A: Gateway deployed standalone (without Hermes)

```bash
# 1) Install
#    For ways to assign INSTALL_SCRIPT, see section 3.2 above (git rev-parse / npm root / manual path all work)
#    Example from the git repo root: INSTALL_SCRIPT="$(git rev-parse --show-toplevel)/scripts/install_hermes_memory_tencentdb.sh"
#             Example from global npm:  INSTALL_SCRIPT="$(npm root -g)/@tencentdb-agent-memory/memory-tencentdb/scripts/install_hermes_memory_tencentdb.sh"
bash "$INSTALL_SCRIPT"

# 2) Configure only the credentials required by the Gateway
memory-tencentdb-ctl config llm       --api-key "sk-..." --base-url "https://api.openai.com/v1" --model gpt-4o
memory-tencentdb-ctl config embedding --provider openai --api-key "sk-..." --base-url "https://api.openai.com/v1" \
                                      --model text-embedding-3-small --dimensions 1536
memory-tencentdb-ctl config vdb       --url "http://xxx:8100" --api-key "..." --database openclaw_memory

# 3) Start + self-check
memory-tencentdb-ctl start
memory-tencentdb-ctl status
memory-tencentdb-ctl health      # Expected: {"status":"ok",...}
```

### Scenario B: Integrated with Hermes

```bash
# 1) Install (same as Scenario A; resolve INSTALL_SCRIPT with section 3.2 above)
bash "$INSTALL_SCRIPT"

# 2) Add --hermes throughout (or run export MEMORY_TENCENTDB_MODE=hermes once)
memory-tencentdb-ctl --hermes config llm --api-key "sk-..." --base-url "https://api.openai.com/v1" --model gpt-4o
memory-tencentdb-ctl --hermes config embedding --provider openai --api-key "sk-..." \
                                               --base-url "https://api.openai.com/v1" \
                                               --model text-embedding-3-small --dimensions 1536
memory-tencentdb-ctl --hermes config vdb --url "http://xxx:8100" --api-key "..." --database openclaw_memory

# 3) Start the Gateway (normally managed by the Hermes supervisor; this is a manual fallback)
memory-tencentdb-ctl --hermes start
memory-tencentdb-ctl --hermes status

# 4) Enable the provider in Hermes config, then restart Hermes
memory-tencentdb-ctl --hermes enable-hermes-memory
source "$HERMES_HOME/env.d/memory-tencentdb-llm.sh"
pkill -f hermes-agent ; hermes
```

If you do not want to type `--hermes` every time, you can run:

```bash
export MEMORY_TENCENTDB_MODE=hermes
```

After that, all commands automatically use Hermes mode and you no longer need to add `--hermes` on the command line.

### Scenario C: Temporarily switch TDAI storage back to SQLite (while keeping Hermes integration)

Use this when VDB is unreachable, during troubleshooting, for offline development, and similar cases: you want Hermes-side `memory.provider` to remain `memory_tencentdb`, but you want the Gateway to store data in local SQLite again.

```bash
# (A) Default: keep memory.tcvdb credentials and only switch storeBackend back to sqlite
memory-tencentdb-ctl config vdb-off --restart

# (B) When troubleshooting is finished and you want to switch back to vdb:
#     currently you must run config vdb again and provide the required fields again,
#     even if the credentials are still present in the JSON. The command follows a
#     "redeclare required settings" model rather than acting as a toggle.
memory-tencentdb-ctl config vdb \
  --url "http://xxx-vdb.tencentclb.com:8100" \
  --api-key "<your KEY>" \
  --database "openclaw_memory" \
  --restart

# (C) Abandon vdb entirely: purge the credentials
memory-tencentdb-ctl config vdb-off --purge-creds --restart
```

> The reason (B) does not provide a zero-argument `vdb-on` command is that the original `config vdb` subcommand treats `--url/--api-key/--database` as strictly required, so users cannot accidentally assemble a half-broken config. If you want a single command that "reactivates stored credentials," ask the maintainer to add `config vdb-on`; its implementation would be a direct mirror of `vdb-off`.

> **Do not** modify `memory.provider` in `~/.hermes/config.yaml` just to "switch back to SQLite". Hermes should still see the `memory_tencentdb` provider; backend storage switching happens entirely inside the Gateway and is completely transparent to Hermes.

## 8. Global Options and Debugging Tips

- All write operations support `--dry-run` (place it at the very beginning of the command), which prints what would be written without saving it:
  ```bash
  memory-tencentdb-ctl --dry-run config llm --api-key k --base-url https://x --model m
  ```
- Sensitive files always use `0600`; `env.d/memory-tencentdb-llm.sh` contains a plaintext API key, so **do not** commit it.
- If startup fails, inspect stderr with `memory-tencentdb-ctl logs err 200`; it is often easier to see the error by running the server once in the foreground:
  ```bash
  cd "$TDAI_INSTALL_DIR" && npx tsx src/gateway/server.ts
  ```
- Port conflict: `MEMORY_TENCENTDB_GATEWAY_PORT=18420 memory-tencentdb-ctl restart`.
- Verify that Hermes picked up the new env values (Hermes mode):
  ```bash
  tr '\0' '\n' < /proc/$(pgrep -n hermes-agent)/environ | grep -E 'TDAI_|MEMORY_TENCENTDB_'
  ```

## 9. Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Invalid arguments / business-rule validation failure (for example, `--base-url` is not http(s), or a Hermes-only command is called in standalone mode) |
| 2 | Write failure (disk full, insufficient permissions, and similar cases) |
| 127 | Missing dependency (`python3` / `node` / `npx`) |

---

If you want to wrap it as a systemd unit, create a `Type=forking` service around `memory-tencentdb-ctl start` / `memory-tencentdb-ctl stop` (the Gateway is a stateless HTTP sidecar and does not depend on the systemd readiness protocol).