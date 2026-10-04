import { packJson, packMarkdown, packMessages } from "../../rendering/context-packer.js";
import { conversationToMarkdownParts } from "../../rendering/markdown-renderer.js";
import { getConversationCachePaths } from "../../storage/cache-paths.js";
import { readConversationArtifacts } from "../../storage/conversation-store.js";
import type { ContextFormat, ToolResult } from "./import-chatgpt-url.js";

export interface GetChatgptContextInput {
  conversation_id: string;
  format?: ContextFormat;
  max_chars?: number;
  cacheRoot?: string;
}

export async function getChatgptContext(input: GetChatgptContextInput): Promise<ToolResult> {
  const format = input.format ?? "markdown";
  const maxChars = input.max_chars ?? 30000;
  const cached = await readConversationArtifacts(input.conversation_id, input.cacheRoot);
  const paths = getConversationCachePaths(input.conversation_id, input.cacheRoot);
  const cache = {
    json_path: paths.json_path,
    markdown_path: paths.markdown_path,
    messages_path: paths.messages_path,
    metadata_path: paths.metadata_path
  };
  const packed =
    format === "messages"
      ? packMessages(cached.messages, maxChars)
      : format === "json"
        ? packJson(cached.conversation, cached.messages, maxChars, cache)
        : packMarkdown(cached.markdown, maxChars, cache, conversationToMarkdownParts(cached.conversation, cached.messages));

  return {
    conversation_id: input.conversation_id,
    title: cached.metadata.title,
    source_url: cached.metadata.source_url,
    cached: true,
    refreshed: false,
    format,
    truncated: packed.truncated,
    char_count: packed.char_count,
    cache,
    freshness: {
      source: "cache",
      checked_remote: false,
      changed: null,
      fetched_at: cached.metadata.fetched_at,
      remote_update_time: cached.metadata.remote_update_time
    },
    content: packed.content
  };
}

