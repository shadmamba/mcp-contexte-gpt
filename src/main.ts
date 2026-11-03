#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadEnvFile } from "./config/env-file.js";
import { createServer } from "./mcp/server.js";
import { getCacheBase } from "./storage/cache-paths.js";
import { prepareWorkspaceCache } from "./storage/workspace-cache.js";

loadEnvFile(process.env);

try {
  await prepareWorkspaceCache(process.env, getCacheBase());
} catch (error) {
  console.error(`Workspace cache setup failed: ${error instanceof Error ? error.message : String(error)}`);
}

const server = createServer();
await server.connect(new StdioServerTransport());
