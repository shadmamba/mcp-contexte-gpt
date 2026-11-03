import os from "node:os";
import path from "node:path";
import { getWorkspacePath, workspaceCacheDir } from "./workspace-cache.js";

export interface ConversationCachePaths {
  root: string;
  conversationDir: string;
  json_path: string;
  markdown_path: string;
  messages_path: string;
  metadata_path: string;
}

export function getCacheBase(): string {
  return path.join(os.homedir(), ".cache", "mcp-contexte-gpt");
}

/** Explicit MCP_CONTEXTE_GPT_CACHE_DIR, otherwise one folder per workspace under the default base. */
export function getCacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.MCP_CONTEXTE_GPT_CACHE_DIR?.trim();
  if (override) return override;
  return workspaceCacheDir(getCacheBase(), getWorkspacePath(env));
}

export function getIndexPath(cacheRoot = getCacheRoot()): string {
  return path.join(cacheRoot, "index.json");
}

export function getConversationCachePaths(conversationId: string, cacheRoot = getCacheRoot()): ConversationCachePaths {
  const conversationDir = path.join(cacheRoot, "conversations", conversationId);
  return {
    root: cacheRoot,
    conversationDir,
    json_path: path.join(conversationDir, "conversation.json"),
    markdown_path: path.join(conversationDir, "conversation.md"),
    messages_path: path.join(conversationDir, "messages.json"),
    metadata_path: path.join(conversationDir, "metadata.json")
  };
}

