import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

test("repo no longer ships MCP config, docs, or dependency metadata", () => {
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    name: string;
    dependencies?: Record<string, string>;
  };
  const lock = readFileSync(new URL("../../bun.lock", import.meta.url), "utf8");

  expect(existsSync(new URL("../../mcp.servers.json", import.meta.url))).toBe(false);
  expect(existsSync(new URL("../../mcp.servers.example.json", import.meta.url))).toBe(false);
  expect(existsSync(new URL("../../tests/mcp/remove-demo-mcp.test.ts", import.meta.url))).toBe(false);
  expect(pkg.name.includes("mcp")).toBe(false);
  expect(pkg.dependencies?.["@modelcontextprotocol/sdk"]).toBeUndefined();
  expect(lock.includes("@modelcontextprotocol/sdk")).toBe(false);
  expect(lock.includes("grammy-mcp-openai-claude-agent-bun")).toBe(false);
  expect(envExample.includes("MCP_CONFIG_PATH")).toBe(false);
  expect(readme.includes("MCP")).toBe(false);
  expect(readme.includes("mcp.servers.json")).toBe(false);
  expect(readme.includes("src/mcp/manager.ts")).toBe(false);
  expect(readme.includes("src/mcp/config.ts")).toBe(false);
});
