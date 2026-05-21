# Remove Demo MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unused project demo MCP server from config, docs, and source while keeping the generic MCP loading path intact.

**Architecture:** Treat this as a small cleanup around the project-local MCP configuration surface. Keep `src/mcp/config.ts`, `src/mcp/manager.ts`, and the startup loop in `src/index.ts` unchanged so the app still supports future MCP servers, but remove the current `demo` server entry and its implementation.

**Tech Stack:** Bun, TypeScript, grammY, MCP SDK, Bun test

---

## File structure map

### Create

- `tests/mcp/remove-demo-mcp.test.ts` — regression coverage that proves project MCP config is empty, README no longer documents the demo MCP as default, and the demo server file is gone.

### Modify

- `mcp.servers.json` — remove the `demo` server entry and leave an empty `servers` object.
- `mcp.servers.example.json` — remove the `demo` server entry and leave an empty `servers` object.
- `README.md` — remove the default demo MCP example and rewrite the MCP section so it describes the project as having no default MCP servers configured.

### Delete

- `src/mcp/demo-server.ts` — remove the unused demo MCP implementation now that nothing configures it.

---

### Task 1: Remove the configured demo MCP

**Files:**
- Create: `tests/mcp/remove-demo-mcp.test.ts`
- Modify: `mcp.servers.json`
- Modify: `mcp.servers.example.json`
- Modify: `README.md`
- Delete: `src/mcp/demo-server.ts`

- [ ] **Step 1: Write the failing regression test**

```ts
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "bun:test";

function readJson(path: string) {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as {
    servers: Record<string, unknown>;
  };
}

test("project no longer ships a default demo MCP", () => {
  const projectConfig = readJson("../../mcp.servers.json");
  const exampleConfig = readJson("../../mcp.servers.example.json");
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  const demoServerPath = new URL("../../src/mcp/demo-server.ts", import.meta.url);

  expect(projectConfig.servers).toEqual({});
  expect(exampleConfig.servers).toEqual({});
  expect(readme.includes('"demo"')).toBe(false);
  expect(readme.includes("src/mcp/demo-server.ts")).toBe(false);
  expect(readme.includes("no default MCP servers configured")).toBe(true);
  expect(existsSync(demoServerPath)).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/mcp/remove-demo-mcp.test.ts`
Expected: FAIL because `mcp.servers.json` and `mcp.servers.example.json` still contain the `demo` server, `README.md` still documents it, and `src/mcp/demo-server.ts` still exists.

- [ ] **Step 3: Remove the configured demo MCP from both config files**

```json
// mcp.servers.json
{
  "servers": {}
}
```

```json
// mcp.servers.example.json
{
  "servers": {}
}
```

- [ ] **Step 4: Rewrite the README MCP section to reflect the new default**

Replace the current default-demo subsection with this content:

```md
## 7. MCP Tools

Project ini tidak mengaktifkan MCP server default apa pun.

File `mcp.servers.json` tetap dipakai sebagai tempat menambahkan server MCP project-local jika nanti dibutuhkan:

```json
{
  "servers": {}
}
```

Tool dari MCP akan didaftarkan sebagai:

```text
mcp_<serverName>_<originalToolName>
```
```

- [ ] **Step 5: Delete the unused demo server implementation**

```bash
git rm src/mcp/demo-server.ts
```

- [ ] **Step 6: Run the regression test and typecheck**

Run: `bun test tests/mcp/remove-demo-mcp.test.ts && bun run typecheck`
Expected: PASS for the MCP cleanup test and `tsc` exits with code 0.

- [ ] **Step 7: Run the full test suite**

Run: `bun test`
Expected: PASS with 0 failures.

- [ ] **Step 8: Commit**

```bash
git add tests/mcp/remove-demo-mcp.test.ts mcp.servers.json mcp.servers.example.json README.md
git rm src/mcp/demo-server.ts
git commit -m "chore: remove the default demo MCP server"
```

---

## Self-review

### Spec coverage

- Remove `demo` from active project config: Task 1, steps 3 and 6
- Delete the unused demo MCP implementation: Task 1, step 5
- Update project docs to stop presenting the demo MCP as default: Task 1, step 4
- Keep the generic MCP loading path intact: no runtime code changes are planned, which matches the approved design

### Placeholder scan

- No `TODO`, `TBD`, or deferred implementation markers remain.
- Each code-changing step includes exact file paths and literal replacement content.
- Each verification step includes exact commands and expected outcomes.

### Type consistency

- The plan intentionally leaves `src/index.ts`, `src/mcp/config.ts`, and `src/mcp/manager.ts` untouched so the existing `McpConfig` type and empty-loop startup behavior remain consistent.
- The regression test checks JSON file shape as `{ servers: Record<string, unknown> }`, matching the current config contract.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-17-remove-demo-mcp.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
