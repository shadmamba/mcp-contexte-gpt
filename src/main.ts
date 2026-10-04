#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadEnvFile } from "./config/env-file.js";
import { createServer } from "./mcp/server.js";

loadEnvFile(process.env);

const server = createServer();
await server.connect(new StdioServerTransport());
