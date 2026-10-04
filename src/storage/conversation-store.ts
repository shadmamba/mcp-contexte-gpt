import fs from "node:fs/promises";
import type { ChatgptConversation, NormalizedMessage } from "../providers/chatgpt/types.js";
import { AppError } from "../shared/errors.js";
import { getConversationCachePaths, type ConversationCachePaths } from "./cache-paths.js";

/** Bump when Markdown/messages rendering changes so cached artifacts are regenerated on refresh. */
export const CACHE_FORMAT_VERSION = 2;

export interface ConversationMetadata {
  conversation_id: string;
  source_url: string;
  title: string;
  created_at?: string;
  remote_update_time?: string;
  fetched_at: string;
  content_hash: string;
  format_version: number;
}

export interface ConversationArtifacts {
  conversation: ChatgptConversation;
  markdown: string;
  messages: NormalizedMessage[];
  metadata: ConversationMetadata;
}

export async function writeConversationArtifacts(
  artifacts: ConversationArtifacts,
  cacheRoot?: string
): Promise<ConversationCachePaths> {
  const paths = getConversationCachePaths(artifacts.metadata.conversation_id, cacheRoot);
  try {
    await fs.mkdir(paths.conversationDir, { recursive: true });
    await Promise.all([
      fs.writeFile(paths.json_path, JSON.stringify(artifacts.conversation, null, 2)),
      fs.writeFile(paths.markdown_path, artifacts.markdown),
      fs.writeFile(paths.messages_path, JSON.stringify(artifacts.messages, null, 2)),
      fs.writeFile(paths.metadata_path, JSON.stringify(artifacts.metadata, null, 2))
    ]);
    return paths;
  } catch (error) {
    throw new AppError("CACHE_WRITE_FAILED", `Failed to write cache artifacts: ${errorMessage(error)}`, {
      recoverable: true
    });
  }
}

export async function readConversationArtifacts(conversationId: string, cacheRoot?: string): Promise<ConversationArtifacts> {
  const paths = getConversationCachePaths(conversationId, cacheRoot);
  try {
    const [conversationRaw, markdown, messagesRaw, metadataRaw] = await Promise.all([
      fs.readFile(paths.json_path, "utf8"),
      fs.readFile(paths.markdown_path, "utf8"),
      fs.readFile(paths.messages_path, "utf8"),
      fs.readFile(paths.metadata_path, "utf8")
    ]);
    return {
      conversation: JSON.parse(conversationRaw) as ChatgptConversation,
      markdown,
      messages: JSON.parse(messagesRaw) as NormalizedMessage[],
      metadata: JSON.parse(metadataRaw) as ConversationMetadata
    };
  } catch (error) {
    if (isNotFound(error)) {
      throw new AppError("CACHE_MISS", `Conversation ${conversationId} is not cached.`, { recoverable: true });
    }
    throw new AppError("CACHE_READ_FAILED", `Failed to read cache artifacts: ${errorMessage(error)}`, {
      recoverable: true
    });
  }
}

export async function readMetadata(conversationId: string, cacheRoot?: string): Promise<ConversationMetadata | null> {
  const paths = getConversationCachePaths(conversationId, cacheRoot);
  try {
    return JSON.parse(await fs.readFile(paths.metadata_path, "utf8")) as ConversationMetadata;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw new AppError("CACHE_READ_FAILED", `Failed to read metadata: ${errorMessage(error)}`);
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

