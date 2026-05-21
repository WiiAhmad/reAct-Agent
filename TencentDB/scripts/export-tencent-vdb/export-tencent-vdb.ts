#!/usr/bin/env node
/**
 * Tencent Cloud VDB (Tencent VectorDB) export script.
 *
 * Connects to a Tencent Cloud Vector Database instance, queries documents from
 * collections in the specified database, and exports them as .jsonl files.
 * Only Tencent VectorDB is supported; other vector database vendors are not.
 *
 * All connection parameters are provided through the CLI, so no .env file is needed.
 *
 * Usage:
 *   node ./bin/export-tencent-vdb.mjs --url <url> --username <username> --api-key <key> --database <database>
 *   node ./bin/export-tencent-vdb.mjs --url <url> --username <username> --api-key <key> --database <database> --probe
 *   node ./bin/export-tencent-vdb.mjs --url <url> --username <username> --api-key <key> --database <database> -c <collection> -o /tmp/backup
 *
 * Output:
 *   By default, files are written to ./vdb-export-YYYY-MM-DD/ under the current working directory.
 *   Use -o to override the output location.
 *   <outputDir>/
 *   ├── <collection>.jsonl    — one JSON document per line
 *   ├── schemas.json          — exported collection schemas (indexes, embedding settings, and so on)
 *   └── export-meta.json      — export metadata
 *
 * Exported field rules:
 *   By default, all fields are exported except vector (dense vector, 1024-dimension float array, large in size).
 *   Add --include-vectors to export every field, including vector.
 *   Note: sparse_vector (BM25 sparse vector) is always exported and is not affected by this switch.
 *
 * Requires: Node.js >= 18 (built-in fetch)
 */

import fs from "node:fs";
import path from "node:path";

// ============================================================
// CLI argument parsing, including VDB connection settings
// ============================================================

interface VDBConfig {
  url: string;
  username: string;
  apiKey: string;
  database: string;
  timeout: number;
}

interface CliArgs {
  // Connection parameters
  url?: string;
  username?: string;
  apiKey?: string;
  database?: string;
  timeout: number;
  // Export parameters
  output: string;
  collection?: string;
  filter?: string;
  limit?: number;
  offset: number;
  includeVectors: boolean;
  probe: boolean;
  help: boolean;
}

const PAGE_SIZE = 100;

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    timeout: 30000,
    output: `./vdb-export-${new Date().toISOString().slice(0, 10)}`,
    offset: 0,
    includeVectors: false,
    probe: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--url":
        result.url = args[++i];
        break;
      case "--username":
        result.username = args[++i];
        break;
      case "--api-key":
        result.apiKey = args[++i];
        break;
      case "--database":
        result.database = args[++i];
        break;
      case "--timeout":
        result.timeout = parseInt(args[++i], 10) || 30000;
        break;
      case "--output":
      case "-o":
        result.output = args[++i];
        break;
      case "--collection":
      case "-c":
        result.collection = args[++i];
        break;
      case "--filter":
      case "-f":
        result.filter = args[++i];
        break;
      case "--limit":
      case "-l": {
        const v = parseInt(args[++i], 10);
        if (isNaN(v) || v < 1) {
          console.error(`❌ --limit must be >= 1, received: ${args[i]}`);
          process.exit(1);
        }
        result.limit = v;
        break;
      }
      case "--offset": {
        const v = parseInt(args[++i], 10);
        if (isNaN(v) || v < 0) {
          console.error(`❌ --offset must be >= 0, received: ${args[i]}`);
          process.exit(1);
        }
        result.offset = v;
        break;
      }
      case "--include-vectors":
        result.includeVectors = true;
        break;
      case "--probe":
        result.probe = true;
        break;
      case "--help":
      case "-h":
        result.help = true;
        break;
    }
  }

  return result;
}

function validateConfig(args: CliArgs): VDBConfig {
  const missing: string[] = [];
  if (!args.url) missing.push("--url");
  if (!args.username) missing.push("--username");
  if (!args.apiKey) missing.push("--api-key");
  if (!args.database) missing.push("--database");

  if (missing.length > 0) {
    console.error("❌ Missing required arguments:");
    for (const k of missing) {
      console.error(`   - ${k}`);
    }
    console.error();
    console.error("Example:");
    console.error();
    console.error('  node ./bin/export-tencent-vdb.mjs \\');
    console.error('    --url "http://your-vdb-host:8100" \\');
    console.error('    --username "root" \\');
    console.error('    --api-key "your-api-key" \\');
    console.error('    --database "your-database"');
    console.error();
    console.error("Use --help to view the full argument reference.");
    process.exit(1);
  }

  return {
    url: args.url!,
    username: args.username!,
    apiKey: args.apiKey!,
    database: args.database!,
    timeout: args.timeout,
  };
}

function printHelp(): void {
  console.log(`
Tencent Cloud VDB (Tencent VectorDB) export script

Usage:
  node ./bin/export-tencent-vdb.mjs [connection-args] [options]

Connection arguments (required):
      --url <url>                VDB instance HTTP URL (for example http://your-vdb-host:8100)
      --username <username>      Authentication username (for example root)
      --api-key <key>            Authentication key
      --database <database>      Database name

Options:
      --timeout <ms>             Timeout for each request (default: 30000)
  -o, --output <dir>             Output directory (default: ./vdb-export-YYYY-MM-DD)
  -c, --collection <full-name>   Export only the specified collection (full-name match; exports all if omitted)
  -f, --filter <expr>            VDB filter condition (for example 'agent_id = "xxx"')
  -l, --limit <count>            Maximum number of documents to export (exports all if omitted)
      --offset <offset>          Starting offset (default: 0); must be a multiple of the page size
      --include-vectors          Keep the dense vector field named vector (skipped by default)
      --probe                    Test connectivity only, list collection info, then exit
  -h, --help                     Show help

Output:
  <outputDir>/
  ├── <full-collection-name>.jsonl  one JSON document per line
  ├── schemas.json                  schema information
  └── export-meta.json              export metadata

Exported field rules:
  vector (dense vector) is skipped by default, while sparse_vector (BM25) is preserved.
  Add --include-vectors to export every field.

Examples:
  # Test connectivity
  node ./bin/export-tencent-vdb.mjs \\
    --url "http://gz-vdb-xxx:8100" --username root --api-key "xxx" --database mydb \\
    --probe

  # Export everything
  node ./bin/export-tencent-vdb.mjs \\
    --url "http://gz-vdb-xxx:8100" --username root --api-key "xxx" --database mydb

  # Export a specific collection to a specific directory
  node ./bin/export-tencent-vdb.mjs \\
    --url "http://gz-vdb-xxx:8100" --username root --api-key "xxx" --database mydb \\
    -c mydb_l0_conversations -o /tmp/backup

  # Export with a filter condition
  node ./bin/export-tencent-vdb.mjs \\
    --url "http://gz-vdb-xxx:8100" --username root --api-key "xxx" --database mydb \\
    -f 'role = "user"'
`);
}

// ============================================================
// VDB HTTP Client
// ============================================================

class VDBClient {
  private baseUrl: string;
  private authHeader: string;
  private database: string;
  private timeout: number;

  constructor(cfg: VDBConfig) {
    this.baseUrl = cfg.url.replace(/\/$/, "");
    this.authHeader = `Bearer account=${cfg.username}&api_key=${cfg.apiKey}`;
    this.database = cfg.database;
    this.timeout = cfg.timeout;
  }

  async request<T>(apiPath: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}${apiPath}`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.authHeader,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!resp.ok) {
      const responseBody = await resp.arrayBuffer()
        .then((buffer) => new TextDecoder().decode(buffer))
        .catch(() => "(unable to read body)");
      throw new Error(`VDB API error: HTTP ${resp.status} — ${responseBody.slice(0, 500)}`);
    }

    const json = (await resp.json()) as { code: number; msg: string } & T;
    if (json.code !== 0) {
      throw new Error(`VDB API error [${apiPath}]: code=${json.code}, msg=${json.msg}`);
    }
    return json;
  }

  async listCollections(): Promise<
    Array<{ collection: string; documentCount: number }>
  > {
    const result = await this.request<{
      collections: Array<{
        collection: string;
        documentCount: number;
        [key: string]: unknown;
      }>;
    }>("/collection/list", {
      database: this.database,
    });
    return (result.collections || []).map((c) => ({
      collection: c.collection,
      documentCount: c.documentCount ?? 0,
    }));
  }

  async queryDocuments(
    collection: string,
    options: {
      limit: number;
      offset: number;
      filter?: string;
      retrieveVector?: boolean;
    },
  ): Promise<{
    documents: Array<Record<string, unknown>>;
    count: number;
  }> {
    const query: Record<string, unknown> = {
      limit: options.limit,
      offset: options.offset,
    };
    if (options.filter) {
      query.filter = options.filter;
    }
    if (options.retrieveVector) {
      query.retrieveVector = true;
    }

    const result = await this.request<{
      documents: Array<Record<string, unknown>>;
      count: number;
    }>("/document/query", {
      database: this.database,
      collection,
      readConsistency: "strongConsistency",
      query,
    });

    return {
      documents: result.documents || [],
      count: result.count ?? 0,
    };
  }

  async describeCollection(collection: string): Promise<Record<string, unknown>> {
    const result = await this.request<{
      collection: Record<string, unknown>;
    }>("/collection/describe", {
      database: this.database,
      collection,
    });
    return result.collection || {};
  }
}

// ============================================================
// Export logic
// ============================================================

interface ExportOptions {
  filter?: string;
  limit?: number;
  offset: number;
  includeVectors: boolean;
  expectedTotal?: number;
}

async function exportCollection(
  client: VDBClient,
  collection: string,
  outputDir: string,
  options: ExportOptions,
): Promise<{ docCount: number; filePath: string }> {
  const filePath = path.join(outputDir, `${collection}.jsonl`);
  const writeStream = fs.createWriteStream(filePath, { encoding: "utf-8" });

  const isRangeMode = options.limit !== undefined;
  const maxDocs = options.limit ?? Infinity;
  const pageSize = isRangeMode ? Math.min(options.limit!, PAGE_SIZE) : PAGE_SIZE;

  let currentOffset = options.offset;
  let totalExported = 0;
  let hasMore = true;

  console.log(`  📦 ${collection}`);
  if (options.expectedTotal !== undefined) {
    console.log(`     Total documents: ${options.expectedTotal}`);
  }
  if (options.filter) {
    console.log(`     Filter: ${options.filter}`);
  }
  if (isRangeMode) {
    console.log(`     Export range: offset=${options.offset}, limit=${options.limit}`);
  }

  while (hasMore && totalExported < maxDocs) {
    const remaining = maxDocs - totalExported;
    const thisPageSize = Math.min(pageSize, remaining);

    try {
      const result = await client.queryDocuments(collection, {
        limit: thisPageSize,
        offset: currentOffset,
        filter: options.filter,
        retrieveVector: options.includeVectors,
      });

      const docs = result.documents;
      if (!docs || docs.length === 0) {
        hasMore = false;
        break;
      }

      for (const doc of docs) {
        const exportDoc = { ...doc };
        if (!options.includeVectors) {
          delete exportDoc.vector;
        }
        writeStream.write(JSON.stringify(exportDoc) + "\n");
      }

      totalExported += docs.length;
      currentOffset += docs.length;

      if (options.expectedTotal !== undefined && !isRangeMode) {
        const pct = Math.min(
          100,
          Math.round((totalExported / options.expectedTotal) * 100),
        );
        process.stdout.write(
          `\r     Progress: ${totalExported}/${options.expectedTotal} (${pct}%)`,
        );
      } else {
        process.stdout.write(`\r     Exported: ${totalExported} documents`);
      }

      if (docs.length < thisPageSize) {
        hasMore = false;
      }
    } catch (err) {
      console.error(
        `\n     ❌ Query failed (offset=${currentOffset}): ${err instanceof Error ? err.message : String(err)}`,
      );
      hasMore = false;
    }
  }

  writeStream.end();
  await new Promise<void>((resolve) => writeStream.on("finish", resolve));

  console.log(
    `\n     ✅ Done: ${totalExported} documents → ${path.basename(filePath)}`,
  );

  return { docCount: totalExported, filePath };
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const config = validateConfig(args);

  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║   Tencent Cloud VDB (Tencent VectorDB) Export Tool ║");
  console.log("╚═══════════════════════════════════════════════════╝");
  console.log();
  console.log(`📌 VDB URL:      ${config.url}`);
  console.log(`📌 Database:     ${config.database}`);
  console.log(`📌 Output dir:   ${args.output}`);
  if (args.collection) {
    console.log(`📌 Selected export: ${args.collection}`);
  }
  if (args.filter) {
    console.log(`📌 Filter:       ${args.filter}`);
  }
  if (args.limit !== undefined) {
    console.log(`📌 Export limit: ${args.limit} documents`);
  }
  if (args.offset > 0) {
    console.log(`📌 Start offset: ${args.offset}`);
  }
  if (args.includeVectors) {
    console.log(`📌 Include vectors: yes`);
  }
  console.log();

  fs.mkdirSync(args.output, { recursive: true });

  const client = new VDBClient(config);

  let allCollections: Array<{ collection: string; documentCount: number }>;
  try {
    allCollections = await client.listCollections();
  } catch (err) {
    console.error(
      `❌ Failed to list collections: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  let targetCollections: Array<{ collection: string; documentCount: number }>;
  if (args.collection) {
    const found = allCollections.find((c) => c.collection === args.collection);
    if (!found) {
      console.error(
        `❌ Collection "${args.collection}" does not exist. Available collections:`,
      );
      for (const c of allCollections) {
        console.error(`   - ${c.collection} (${c.documentCount} documents)`);
      }
      process.exit(1);
    }
    targetCollections = [found];
  } else {
    targetCollections = allCollections;
    console.log(
      `🔍 Found ${targetCollections.length} collections:`,
    );
    for (const c of targetCollections) {
      console.log(`   - ${c.collection} (${c.documentCount} documents)`);
    }
  }

  if (targetCollections.length === 0) {
    console.log("⚠️  The database has no collections, so there is no data to export");
    process.exit(0);
  }

  // --probe mode: test connectivity only, print information, then exit.
  if (args.probe) {
    console.log();
    console.log("✅ Connectivity test passed");
    console.log();
    console.log(`  VDB URL:    ${config.url}`);
    console.log(`  Database:   ${config.database}`);
    console.log(`  Collections: ${targetCollections.length}`);
    const totalDocs = targetCollections.reduce((s, c) => s + c.documentCount, 0);
    console.log(`  Total documents: ${totalDocs}`);
    console.log();
    for (const c of targetCollections) {
      console.log(`    - ${c.collection} (${c.documentCount} documents)`);
    }
    console.log();
    process.exit(0);
  }

  console.log();

  // Fetch and save schema information.
  const schemas: Record<string, Record<string, unknown>> = {};
  console.log("📐 Fetching schemas...");
  for (const col of targetCollections) {
    try {
      const schema = await client.describeCollection(col.collection);
      schemas[col.collection] = schema;
      const indexCount = Array.isArray(schema.indexes) ? schema.indexes.length : 0;
      const emb = schema.embedding as Record<string, unknown> | undefined;
      const embInfo = emb ? `embedding=${emb.field}→${emb.model}` : "no embedding";
      console.log(`   ✅ ${col.collection} (${indexCount} indexes, ${embInfo})`);
    } catch (err) {
      console.error(
        `   ⚠️ Failed to fetch the schema for ${col.collection}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  console.log();

  const schemaPath = path.join(args.output, "schemas.json");
  fs.writeFileSync(schemaPath, JSON.stringify(schemas, null, 2) + "\n");

  const exportResults: Array<{
    collection: string;
    docCount: number;
    filePath: string;
  }> = [];

  for (const col of targetCollections) {
    try {
      const result = await exportCollection(client, col.collection, args.output, {
        filter: args.filter,
        limit: args.limit,
        offset: args.offset,
        includeVectors: args.includeVectors,
        expectedTotal: col.documentCount,
      });
      exportResults.push({ collection: col.collection, ...result });
    } catch (err) {
      console.error(
        `❌ Failed to export ${col.collection}: ${err instanceof Error ? err.message : String(err)}`,
      );
      exportResults.push({
        collection: col.collection,
        docCount: 0,
        filePath: "",
      });
    }
    console.log();
  }

  const meta = {
    exportedAt: new Date().toISOString(),
    vdbUrl: config.url,
    database: config.database,
    filter: args.filter ?? null,
    offset: args.offset,
    limit: args.limit ?? null,
    includeVectors: args.includeVectors,
    collections: exportResults.map((r) => ({
      collection: r.collection,
      documentCount: r.docCount,
      file: r.filePath ? path.basename(r.filePath) : null,
    })),
    totalDocuments: exportResults.reduce((sum, r) => sum + r.docCount, 0),
  };

  const metaPath = path.join(args.output, "export-meta.json");
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");

  console.log("═══════════════════════════════════════════════════");
  console.log("  ✅ Export complete");
  console.log("═══════════════════════════════════════════════════");
  console.log();
  console.log(`  📁 Output dir: ${args.output}`);
  console.log(`  📊 Total documents: ${meta.totalDocuments}`);
  for (const r of exportResults) {
    const status = r.docCount > 0 ? "✅" : "⚠️";
    console.log(
      `     ${status} ${r.collection}: ${r.docCount} documents`,
    );
  }
  console.log(`  📋 Metadata:   ${path.basename(metaPath)}`);
  console.log(`  📐 Schemas:    ${path.basename(schemaPath)}`);
  console.log();
}

main().catch((err) => {
  console.error(
    `\n❌ Export failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
