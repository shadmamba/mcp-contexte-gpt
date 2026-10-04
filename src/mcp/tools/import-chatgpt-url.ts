import {
  fetchPrivateConversation,
  fetchProjectConversation,
  fetchSharedConversation,
  type ChatgptClientOptions
} from "../../providers/chatgpt/chatgpt-client.js";
import type { ChatgptConversation } from "../../providers/chatgpt/types.js";
import { parseChatgptUrl, type ParsedChatgptUrl } from "../../providers/chatgpt/url-parser.js";
import { conversationToMarkdown, conversationToMarkdownParts } from "../../rendering/markdown-renderer.js";
import { conversationToMessages } from "../../rendering/conversation-messages.js";
import { packJson, packMarkdown, packMessages } from "../../rendering/context-packer.js";
import { AppError } from "../../shared/errors.js";
import { formatDate } from "../../shared/format-date.js";
import { getConversationCachePaths } from "../../storage/cache-paths.js";
import { conversationContentHash } from "../../storage/content-hash.js";
import {
  CACHE_FORMAT_VERSION,
  readConversationArtifacts,
  readMetadata,
  writeConversationArtifacts,
  type ConversationMetadata
} from "../../storage/conversation-store.js";
import { updateCacheIndex } from "../../storage/cache-index.js";

export type ContextFormat = "markdown" | "messages" | "json";
export type CachePolicy = "refresh" | "cache_only";

export interface ImportChatgptUrlInput {
  url: string;
  format?: ContextFormat;
  max_chars?: number;
  cache_policy?: CachePolicy;
  cacheRoot?: string;
  clientOptions?: ChatgptClientOptions;
}

export interface Freshness {
  source: "remote" | "cache";
  checked_remote: boolean;
  changed: boolean | null;
  fetched_at?: string;
  remote_update_time?: string;
  warning?: string;
}

export interface ToolResult {
  conversation_id: string;
  title: string;
  source_url: string;
  cached: boolean;
  refreshed: boolean;
  format: ContextFormat;
  truncated: boolean;
  char_count: number;
  cache: {
    json_path: string;
    markdown_path: string;
    messages_path: string;
    metadata_path: string;
  };
  freshness: Freshness;
  content: string | object;
}

export async function importChatgptUrl(input: ImportChatgptUrlInput): Promise<ToolResult> {
  const parsed = parseChatgptUrl(input.url);
  const format = input.format ?? "markdown";
  const maxChars = input.max_chars ?? 30000;
  const cachePolicy = input.cache_policy ?? "refresh";

  if (cachePolicy === "cache_only") {
    return readCachedResult(parsed.cacheId, parsed.sourceUrl, format, maxChars, input.cacheRoot);
  }

  try {
    const conversation = await fetchRemoteConversation(parsed, input.clientOptions);
    return writeAndPackRemoteConversation({
      conversation,
      conversationId: parsed.cacheId,
      sourceUrl: parsed.sourceUrl,
      format,
      maxChars,
      cacheRoot: input.cacheRoot
    });
  } catch (error) {
    const metadata = await readMetadata(parsed.cacheId, input.cacheRoot);
    if (metadata && error instanceof AppError) {
      const paths = getConversationCachePaths(parsed.cacheId, input.cacheRoot);
      throw new AppError(error.error_code, error.message, {
        recoverable: error.recoverable,
        cache_available: true,
        cache: paths
      });
    }
    throw error;
  }
}

async function fetchRemoteConversation(
  parsed: ParsedChatgptUrl,
  clientOptions?: ChatgptClientOptions
): Promise<ChatgptConversation> {
  if (parsed.kind === "share") {
    return fetchSharedConversation(parsed.id, clientOptions);
  }
  if (parsed.kind === "project") {
    if (!parsed.projectId) {
      throw new AppError("UNSUPPORTED_URL", "ChatGPT project URL is missing a recognizable project id.");
    }
    return fetchProjectConversation(
      {
        conversationId: parsed.id,
        projectId: parsed.projectId,
        ownerUserId: parsed.ownerUserId,
        sourceUrl: parsed.sourceUrl
      },
      clientOptions
    );
  }
  return fetchPrivateConversation(parsed.id, clientOptions);
}

async function writeAndPackRemoteConversation(input: {
  conversation: ChatgptConversation;
  conversationId: string;
  sourceUrl: string;
  format: ContextFormat;
  maxChars: number;
  cacheRoot?: string;
}): Promise<ToolResult> {
  const fetchedAt = new Date().toISOString();
  const hash = conversationContentHash(input.conversation);
  const oldMetadata = await readMetadata(input.conversationId, input.cacheRoot);
  const contentChanged = !oldMetadata || oldMetadata.content_hash !== hash;
  const needsRewrite = contentChanged || oldMetadata?.format_version !== CACHE_FORMAT_VERSION;
  const paths = getConversationCachePaths(input.conversationId, input.cacheRoot);
  const title = input.conversation.title || "Untitled";
  const metadata: ConversationMetadata = {
    conversation_id: input.conversationId,
    source_url: input.sourceUrl,
    title,
    created_at: formatDate(input.conversation.create_time),
    remote_update_time: formatDate(input.conversation.update_time),
    fetched_at: fetchedAt,
    content_hash: hash,
    format_version: CACHE_FORMAT_VERSION
  };

  let markdown: string;
  let messages;
  if (needsRewrite) {
    markdown = conversationToMarkdown(input.conversation);
    messages = conversationToMessages(input.conversation);
    await writeConversationArtifacts({ conversation: input.conversation, markdown, messages, metadata }, input.cacheRoot);
    await updateCacheIndex(metadata, input.cacheRoot);
  } else {
    try {
      const cached = await readConversationArtifacts(input.conversationId, input.cacheRoot);
      markdown = cached.markdown;
      messages = cached.messages;
    } catch {
      markdown = conversationToMarkdown(input.conversation);
      messages = conversationToMessages(input.conversation);
      await writeConversationArtifacts({ conversation: input.conversation, markdown, messages, metadata }, input.cacheRoot);
      await updateCacheIndex(metadata, input.cacheRoot);
    }
  }

  return packToolResult({
    conversationId: input.conversationId,
    sourceUrl: input.sourceUrl,
    title,
    format: input.format,
    maxChars: input.maxChars,
    paths,
    conversation: input.conversation,
    markdown,
    messages,
    cached: Boolean(oldMetadata),
    refreshed: true,
    freshness: {
      source: "remote",
      checked_remote: true,
      changed: contentChanged,
      fetched_at: fetchedAt,
      remote_update_time: metadata.remote_update_time
    }
  });
}

function readCachedResult(
  conversationId: string,
  sourceUrl: string,
  format: ContextFormat,
  maxChars: number,
  cacheRoot?: string
): Promise<ToolResult> {
  return readConversationArtifacts(conversationId, cacheRoot).then((cached) => {
    const paths = getConversationCachePaths(conversationId, cacheRoot);
    return packToolResult({
      conversationId,
      sourceUrl: cached.metadata.source_url || sourceUrl,
      title: cached.metadata.title,
      format,
      maxChars,
      paths,
      conversation: cached.conversation,
      markdown: cached.markdown,
      messages: cached.messages,
      cached: true,
      refreshed: false,
      freshness: {
        source: "cache",
        checked_remote: false,
        changed: null,
        fetched_at: cached.metadata.fetched_at,
        remote_update_time: cached.metadata.remote_update_time
      }
    });
  });
}

function packToolResult(input: {
  conversationId: string;
  sourceUrl: string;
  title: string;
  format: ContextFormat;
  maxChars: number;
  paths: ReturnType<typeof getConversationCachePaths>;
  conversation: ChatgptConversation;
  markdown: string;
  messages: ReturnType<typeof conversationToMessages>;
  cached: boolean;
  refreshed: boolean;
  freshness: Freshness;
}): ToolResult {
  const cache = {
    json_path: input.paths.json_path,
    markdown_path: input.paths.markdown_path,
    messages_path: input.paths.messages_path,
    metadata_path: input.paths.metadata_path
  };

  const packed =
    input.format === "messages"
      ? packMessages(input.messages, input.maxChars)
      : input.format === "json"
        ? packJson(input.conversation, input.messages, input.maxChars, cache)
        : packMarkdown(
            input.markdown,
            input.maxChars,
            cache,
            conversationToMarkdownParts(input.conversation, input.messages)
          );

  return {
    conversation_id: input.conversationId,
    title: input.title,
    source_url: input.sourceUrl,
    cached: input.cached,
    refreshed: input.refreshed,
    format: input.format,
    truncated: packed.truncated,
    char_count: packed.char_count,
    cache,
    freshness: input.freshness,
    content: packed.content
  };
}
