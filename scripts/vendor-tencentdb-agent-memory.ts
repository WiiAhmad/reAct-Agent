#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { config } from "../src/config";

const force = process.argv.includes("--force");
const vendorRoot = resolve("./vendor/tencentdb-agent-memory");
const zipPath = join(vendorRoot, `TencentDB-Agent-Memory-v${config.tencentMemory.version}.zip`);
const extractDir = join(vendorRoot, `TencentDB-Agent-Memory-${config.tencentMemory.version}`);

async function run(cmd: string[], cwd = process.cwd()) {
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited with ${code}`);
}

await mkdir(vendorRoot, { recursive: true });

if (!force && existsSync(extractDir)) {
  console.log(`TencentDB-Agent-Memory already vendored at ${extractDir}`);
  process.exit(0);
}

console.log(`Downloading ${config.tencentMemory.releaseUrl}`);
const response = await fetch(config.tencentMemory.releaseUrl);
if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
await Bun.write(zipPath, await response.arrayBuffer());
console.log(`Saved ${zipPath}`);

try {
  await run(["unzip", "-q", "-o", zipPath, "-d", vendorRoot]);
  console.log(`Extracted to ${extractDir}`);
} catch (error) {
  console.warn("Could not run unzip automatically. The ZIP is still saved; extract it manually if needed.");
  console.warn(error instanceof Error ? error.message : String(error));
}
