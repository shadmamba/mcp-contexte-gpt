import { describe, expect, it } from "vitest";
import { SERVER_INSTRUCTIONS } from "../src/mcp/instructions.js";
import { createServer, SERVER_NAME } from "../src/mcp/server.js";

describe("MCP server", () => {
  it("has self-contained instructions", () => {
    expect(SERVER_INSTRUCTIONS.slice(0, 512)).toContain("import_chatgpt_url");
    expect(SERVER_INSTRUCTIONS).toContain("resources are cache-only");
  });

  it("uses the project name", () => {
    expect(SERVER_NAME).toBe("mcp-contexte-gpt");
  });

  it("creates a server with registered tools and resources", () => {
    const server = createServer();
    expect(server).toBeTruthy();
    expect(server.server).toBeTruthy();
  });
});

