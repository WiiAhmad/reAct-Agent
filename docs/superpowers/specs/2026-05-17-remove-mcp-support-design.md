# Remove Project MCP Support Design

Date: 2026-05-17
Status: Awaiting written spec review

## Summary

Remove MCP support from the project entirely so the app runs only with built-in local tools and the project-owned memory backend. After this change, the repo will no longer load MCP config files, spawn MCP clients, expose MCP-backed tools, or depend on the MCP SDK.

## Goals

- Remove all runtime MCP support from the application.
- Remove MCP-related config, dependency, docs, and test coverage that only exists for MCP behavior.
- Keep the existing Telegram bot, local tools, memory stack, and provider integrations working unchanged.

## Non-Goals

- Changing Claude Code or user-global MCP settings outside this repo.
- Replacing MCP with another plugin or extension system.
- Refactoring unrelated runtime, memory, or bot behavior.

## Current Context

- `src/index.ts` imports `loadMcpConfig()` and `McpManager`, then loads configured servers during startup and closes them during shutdown.
- `src/mcp/config.ts` reads `config.storage.mcpConfigPath`, and `src/mcp/manager.ts` owns the MCP client lifecycle and tool wrapping.
- `src/config.ts` exposes `MCP_CONFIG_PATH` and `storage.mcpConfigPath` even though they only exist for MCP wiring.
- `src/tools/types.ts` treats MCP as a first-class tool source via `source: "local" | "mcp"`.
- `package.json` depends on `@modelcontextprotocol/sdk`, and the repo still contains MCP config files, README setup/docs, and an MCP-specific test.

## Proposed Change

1. Delete `src/mcp/config.ts` and `src/mcp/manager.ts`.
2. Remove all MCP imports and startup/shutdown wiring from `src/index.ts`.
3. Remove `MCP_CONFIG_PATH` and `storage.mcpConfigPath` from `src/config.ts`, plus the matching `.env.example` entry.
4. Simplify `src/tools/types.ts` so MCP is no longer a valid tool source.
5. Delete `mcp.servers.json` and `mcp.servers.example.json` because the app will no longer read project MCP config.
6. Remove `@modelcontextprotocol/sdk` from `package.json` and refresh the lockfile so the dependency graph becomes MCP-free.
7. Update `README.md` and tests so they describe and assert the MCP-free repo state instead of an empty-but-supported MCP path.

## Architecture

Startup becomes a local-only bootstrap flow: initialize storage, validate runtime config, create the LLM provider and memory service, register local tools, start background loops, then start the Telegram bot. No extension config is read and no external tool processes are created.

This intentionally removes MCP as a runtime concept rather than leaving an empty compatibility layer behind. The repo boundary becomes clearer and smaller: built-in bot behavior, local tools, and project-owned memory only.

## Components and File Responsibilities

- `src/index.ts`: bootstrap only local runtime pieces; no MCP lifecycle remains.
- `src/config.ts`: define only configuration that the app still uses at runtime.
- `src/tools/types.ts`: represent only tool sources that still exist.
- `package.json` / `bun.lock`: reflect the reduced dependency set.
- `README.md` / `.env.example`: document only supported setup and runtime options.
- `tests/*`: verify the current MCP-free behavior rather than the older demo-only cleanup.

## Runtime Impact

- App startup no longer reads `mcp.servers.json` or any `MCP_CONFIG_PATH` value.
- No MCP server subprocesses are launched.
- No MCP-backed tools are registered in the tool registry.
- Existing local tools, memory flows, and Telegram behavior remain unchanged.
- Old local MCP config files can remain on disk without affecting runtime because nothing reads them anymore.

## Error Handling

- Do not add migration warnings, deprecation notices, or compatibility shims.
- Missing deleted MCP files should not be handled specially because their code paths will be gone.
- The only expected behavior change is the absence of MCP loading and MCP-origin tools.

## Success Criteria

- No active source files import or reference MCP runtime code.
- The repo no longer contains project MCP config files or an MCP SDK dependency.
- `.env.example` and `README.md` no longer mention project MCP setup as a supported feature.
- The tool type system no longer models MCP as a valid source.
- The repo still passes typechecking and tests after the cleanup.

## Verification

- Search the repo for remaining active MCP references in source, config, tests, and docs.
- Run `bun test`.
- Run `bun run typecheck`.
- Confirm dependency metadata no longer includes `@modelcontextprotocol/sdk`.
