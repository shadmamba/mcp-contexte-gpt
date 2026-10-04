import fs from "node:fs/promises";
import { AppError } from "../shared/errors.js";
import { getConversationCachePaths, getIndexPath } from "./cache-paths.js";
import type { ConversationMetadata } from "./conversation-store.js";

export interface CacheIndexItem {
  conversation_id: string;
  title: string;
  source_url: string;
  imported_at: string;
  fetched_at: string;
  remote_update_time?: string;
  markdown_path: string;
}

export interface CacheIndex {
  items: CacheIndexItem[];
}

export async function readCacheIndex(cacheRoot?: string): Promise<CacheIndex> {
  const indexPath = getIndexPath(cacheRoot);
  try {
    return JSON.parse(await fs.readFile(indexPath, "utf8")) as CacheIndex;
  } catch (error) {
    if (isNotFound(error)) return { items: [] };
    throw new AppError("CACHE_READ_FAILED", `Failed to read cache index: ${errorMessage(error)}`);
  }
}

export async function updateCacheIndex(metadata: ConversationMetadata, cacheRoot?: string): Promise<CacheIndex> {
  const index = await readCacheIndex(cacheRoot);
  const paths = getConversationCachePaths(metadata.conversation_id, cacheRoot);
  const existing = index.items.find((item) => item.conversation_id === metadata.conversation_id);
  const imported_at = existing?.imported_at || metadata.fetched_at;
  const nextItem: CacheIndexItem = {
    conversation_id: metadata.conversation_id,
    title: metadata.title,
    source_url: metadata.source_url,
    imported_at,
    fetched_at: metadata.fetched_at,
    remote_update_time: metadata.remote_update_time,
    markdown_path: paths.markdown_path
  };

  const items = [nextItem, ...index.items.filter((item) => item.conversation_id !== metadata.conversation_id)]
    .sort((a, b) => b.fetched_at.localeCompare(a.fetched_at));

  const nextIndex = { items };
  try {
    await fs.mkdir(paths.root, { recursive: true });
    await fs.writeFile(getIndexPath(cacheRoot), JSON.stringify(nextIndex, null, 2));
    return nextIndex;
  } catch (error) {
    throw new AppError("CACHE_WRITE_FAILED", `Failed to write cache index: ${errorMessage(error)}`);
  }
}

export async function searchCacheIndex(input: { query?: string; limit?: number; cacheRoot?: string }): Promise<CacheIndexItem[]> {
  const index = await readCacheIndex(input.cacheRoot);
  const limit = input.limit && input.limit > 0 ? input.limit : 20;
  const query = input.query?.trim().toLowerCase();
  if (!query) return index.items.slice(0, limit);

  const matches: CacheIndexItem[] = [];
  for (const item of index.items) {
    if (matches.length >= limit) break;
    const markdown = await readMarkdownQuietly(item.markdown_path);
    const haystack = [item.conversation_id, item.title, item.source_url, markdown].join("\n").toLowerCase();
    if (haystack.includes(query)) matches.push(item);
  }
  return matches;
}

async function readMarkdownQuietly(markdownPath: string): Promise<string> {
  try {
    return await fs.readFile(markdownPath, "utf8");
  } catch {
    return "";
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

