import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

test("runtime no longer ships MCP bootstrap files or MCP prompt text", () => {
  const indexSource = readFileSync(new URL("../../src/index.ts", import.meta.url), "utf8");
  const agentSource = readFileSync(new URL("../../src/agent/react-agent.ts", import.meta.url), "utf8");

  expect(existsSync(new URL("../../src/mcp/config.ts", import.meta.url))).toBe(false);
  expect(existsSync(new URL("../../src/mcp/manager.ts", import.meta.url))).toBe(false);
  expect(indexSource.includes("loadMcpConfig")).toBe(false);
  expect(indexSource.includes("McpManager")).toBe(false);
  expect(agentSource.includes("MCP tools")).toBe(false);
});
