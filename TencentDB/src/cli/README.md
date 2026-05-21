# memory-tdai CLI

The `openclaw memory-tdai` command namespace provides offline data-management tools.

## seed — Import historical conversation data

Imports historical conversation JSON files into the memory pipeline and starts the L0→L1→L2→L3 processing flow. The seed runtime waits for L1 to become idle before shutting down, but L2/L3 jobs may still be in flight, so the final output is not guaranteed to include the latest L2 scene or L3 persona artifacts. Use it to:

- Load existing conversation data into the memory system
- Batch-test memory extraction quality
- Migrate or restore memory data

### Usage

```bash
openclaw memory-tdai seed --input <file> [options]
```

### Options

| Option | Required | Description |
|------|------|------|
| `--input <file>` | Yes | Input JSON file path |
| `--output-dir <dir>` | — | Output directory (defaults to an automatically generated timestamped directory) |
| `--session-key <key>` | — | Fallback session key (used when the input data does not provide one) |
| `--config <file>` | — | Configuration override file (JSON, deep-merged with the plugin configuration from openclaw.json) |
| `--strict-round-role` | — | Strictly validate that every conversation round contains both user and assistant messages |
| `--yes` | — | Skip interactive confirmations (such as timestamp auto-fill confirmation) |

### Examples

```bash
# Basic usage
openclaw memory-tdai seed --input conversations.json

# Specify an output directory
openclaw memory-tdai seed --input data.json --output-dir ./seed-output

# Use custom configuration overrides (for example, to adjust pipeline parameters)
openclaw memory-tdai seed --input data.json --config seed-config.json

# Skip all confirmations
openclaw memory-tdai seed --input data.json --yes

# Strict mode + custom configuration
openclaw memory-tdai seed --input data.json --config seed-config.json --strict-round-role --yes
```

### Input file format

Two JSON formats are supported:

#### Format A: object wrapper

```json
{
  "sessions": [
    {
      "sessionKey": "user-alice",
      "sessionId": "conv-001",
      "conversations": [
        [
          { "role": "user", "content": "Hello", "timestamp": 1711929600000 },
          { "role": "assistant", "content": "Hi! How can I help?", "timestamp": 1711929601000 }
        ],
        [
          { "role": "user", "content": "What is the weather like today?" },
          { "role": "assistant", "content": "It is sunny today, a good day to go out." }
        ]
      ]
    }
  ]
}
```

#### Format B: top-level array

```json
[
  {
    "sessionKey": "user-alice",
    "conversations": [
      [
        { "role": "user", "content": "Hello" },
        { "role": "assistant", "content": "Hi!" }
      ]
    ]
  }
]
```

#### Field descriptions

| Field | Type | Required | Description |
|------|------|------|------|
| `sessionKey` | string | Yes | Session identifier (for example, user ID or channel name) |
| `sessionId` | string | — | Conversation instance ID (there can be multiple sessionIds under the same sessionKey) |
| `conversations` | message[][] | Yes | Array of conversation rounds; each round is a group of messages |
| `role` | string | Yes | Message role: `user` or `assistant` |
| `content` | string | Yes | Message content |
| `timestamp` | number \| string | — | Timestamp: epoch milliseconds or an ISO 8601 string. When missing, seed prompts to auto-fill it |

### Configuration overrides

`--config` accepts a JSON file and performs a **two-level deep merge** with the plugin configuration in `openclaw.json`:

- Top-level keys that are objects on both sides → shallow-merge (preserving uncovered fields from the base configuration)
- Other types → directly override

Common use case: use more aggressive pipeline parameters during seed to speed up processing:

```json
{
  "pipeline": {
    "everyNConversations": 3,
    "enableWarmup": false,
    "l1IdleTimeoutSeconds": 2,
    "l2DelayAfterL1Seconds": 1,
    "l2MinIntervalSeconds": 1,
    "l2MaxIntervalSeconds": 10
  }
}
```

To seed into a dedicated TCVDB database:

```json
{
  "storeBackend": "tcvdb",
  "tcvdb": {
    "database": "my_seed_test_db"
  },
  "pipeline": {
    "everyNConversations": 3,
    "enableWarmup": false,
    "l1IdleTimeoutSeconds": 2
  }
}
```

### Output directory structure

```
<output-dir>/
├── conversations/          — L0 JSONL files
├── records/                — L1 JSONL files
├── scene_blocks/           — Optional L2 scene blocks (present only if L2 completes before shutdown)
├── vectors.db              — SQLite vector database (sqlite backend only)
├── .metadata/
│   ├── manifest.json       — Metadata (store binding + seed run record)
│   └── checkpoint.json     — Pipeline progress
└── .backup/                — Rolling backups
```

After seed finishes, `manifest.json` records this run:

```json
{
  "version": 1,
  "createdAt": "2026-04-01T22:00:00.000Z",
  "store": {
    "type": "sqlite",
    "sqlite": { "path": "vectors.db" }
  },
  "seed": {
    "inputFile": "conversations.json",
    "sessions": 3,
    "rounds": 42,
    "messages": 128,
    "startedAt": "2026-04-01T22:00:00.000Z",
    "completedAt": "2026-04-01T22:05:30.000Z"
  }
}
```
