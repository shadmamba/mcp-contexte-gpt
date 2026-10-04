import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../src/shared/errors.js";
import { getConversationCachePaths } from "../src/storage/cache-paths.js";
import { readConversationArtifacts, writeConversationArtifacts, type ConversationArtifacts } from "../src/storage/conversation-store.js";
import { readCacheIndex, searchCacheIndex, updateCacheIndex } from "../src/storage/cache-index.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-contexte-gpt-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function artifacts(title = "Title"): ConversationArtifacts {
  return {
    conversation: { id: "conv-1", title },
    markdown: `# ${title}\n\nhello cache`,
    messages: [{ role: "user", content: "hello cache" }],
    metadata: {
      conversation_id: "conv-1",
      source_url: "https://chatgpt.com/c/conv-1",
      title,
      fetched_at: "2030-01-01T00:00:00.000Z",
      remote_update_time: "2030-01-01T00:00:00.000Z",
      content_hash: "sha256:one",
      format_version: 1
    }
  };
}

describe("cache store", () => {
  it("writes and reads conversation artifacts", async () => {
    const paths = await writeConversationArtifacts(artifacts(), tmp);
    expect(paths.markdown_path).toBe(getConversationCachePaths("conv-1", tmp).markdown_path);

    const read = await readConversationArtifacts("conv-1", tmp);
    expect(read.markdown).toContain("hello cache");
    expect(read.metadata.title).toBe("Title");
  });

  it("overwrites an existing conversation id", async () => {
    await writeConversationArtifacts(artifacts("Old"), tmp);
    await writeConversationArtifacts(artifacts("New"), tmp);
    expect((await readConversationArtifacts("conv-1", tmp)).metadata.title).toBe("New");
  });

  it("throws CACHE_MISS for missing artifacts", async () => {
    await expect(readConversationArtifacts("missing", tmp)).rejects.toMatchObject({ error_code: "CACHE_MISS" });
    await expect(readConversationArtifacts("missing", tmp)).rejects.toBeInstanceOf(AppError);
  });

  it("updates and searches the cache index", async () => {
    const item = artifacts();
    await writeConversationArtifacts(item, tmp);
    await updateCacheIndex(item.metadata, tmp);

    expect((await readCacheIndex(tmp)).items).toHaveLength(1);
    expect(await searchCacheIndex({ query: "hello cache", cacheRoot: tmp })).toHaveLength(1);
    expect(await searchCacheIndex({ query: "missing", cacheRoot: tmp })).toHaveLength(0);
  });
});

