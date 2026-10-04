import fs from "node:fs/promises";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { serializeError } from "../shared/errors.js";
import { getConversationCachePaths } from "../storage/cache-paths.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { getChatgptContext } from "./tools/get-chatgpt-context.js";
import { importChatgptUrl } from "./tools/import-chatgpt-url.js";
import { listChatgptImports } from "./tools/list-chatgpt-imports.js";
import { verifyChatgptAuth } from "./tools/verify-chatgpt-auth.js";

export const SERVER_NAME = "mcp-contexte-gpt";

const FormatSchema = z.enum(["markdown", "messages", "json"]).optional();

export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: "0.1.0" },
    { instructions: SERVER_INSTRUCTIONS }
  );

  server.registerTool(
    "import_chatgpt_url",
    {
      title: "Import ChatGPT URL",
      description: "Refresh and import a ChatGPT /c/{conversation_id}, public /share/{share_id} (or /share/e/{share_id}), Project /g/{project}/c/{conversation_id}, or Project shared /g/{project}/shared/c/{conversation_id}?owner_user_id={owner} URL into local cache and return bounded context that keeps the most recent messages when truncated.",
      inputSchema: {
        url: z.string().url(),
        format: FormatSchema,
        max_chars: z.number().int().positive().optional(),
        cache_policy: z.enum(["refresh", "cache_only"]).optional()
      }
    },
    async (args) => toolResult(importChatgptUrl(args))
  );

  server.registerTool(
    "get_chatgpt_context",
    {
      title: "Get Cached ChatGPT Context",
      description: "Read an already imported ChatGPT conversation from local cache. This does not check the remote conversation. Share imports are cached as share-{share_id}.",
      inputSchema: {
        conversation_id: z.string().min(1),
        format: FormatSchema,
        max_chars: z.number().int().positive().optional()
      }
    },
    async (args) => toolResult(getChatgptContext(args))
  );

  server.registerTool(
    "list_chatgpt_imports",
    {
      title: "List ChatGPT Imports",
      description: "List locally cached ChatGPT conversation imports, optionally filtered by a simple text query.",
      inputSchema: {
        query: z.string().optional(),
        limit: z.number().int().positive().optional()
      }
    },
    async (args) => toolResult(listChatgptImports(args))
  );

  server.registerTool(
    "verify_chatgpt_auth",
    {
      title: "Verify ChatGPT Auth",
      description: "Check whether CHATGPT_BEARER_TOKEN is present, unexpired, and accepted by the ChatGPT backend.",
      inputSchema: {}
    },
    async () => toolResult(verifyChatgptAuth())
  );

  registerConversationResource(server, "chatgpt-markdown", "chatgpt://conversation/{conversation_id}/markdown", "text/markdown", "markdown_path");
  registerConversationResource(server, "chatgpt-json", "chatgpt://conversation/{conversation_id}/json", "application/json", "json_path");
  registerConversationResource(server, "chatgpt-messages", "chatgpt://conversation/{conversation_id}/messages", "application/json", "messages_path");
  registerConversationResource(server, "chatgpt-metadata", "chatgpt://conversation/{conversation_id}/metadata", "application/json", "metadata_path");

  return server;
}

async function toolResult(promise: Promise<unknown>) {
  try {
    const result = await promise;
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as Record<string, unknown>
    };
  } catch (error) {
    const serialized = serializeError(error);
    return {
      isError: true,
      content: [{ type: "text" as const, text: JSON.stringify(serialized, null, 2) }],
      structuredContent: serialized as unknown as Record<string, unknown>
    };
  }
}

function registerConversationResource(
  server: McpServer,
  name: string,
  template: string,
  mimeType: string,
  pathKey: "json_path" | "markdown_path" | "messages_path" | "metadata_path"
): void {
  server.registerResource(
    name,
    new ResourceTemplate(template, { list: undefined }),
    {
      title: name,
      mimeType
    },
    async (uri, variables) => {
      const conversationId = String(variables.conversation_id);
      const paths = getConversationCachePaths(conversationId);
      const text = await fs.readFile(paths[pathKey], "utf8");
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType,
            text
          }
        ]
      };
    }
  );
}

