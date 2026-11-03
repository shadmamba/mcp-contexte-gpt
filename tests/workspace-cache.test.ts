import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getCacheRoot } from "../src/storage/cache-paths.js";
import {
  getWorkspacePath,
  normalizeWorkspacePath,
  prepareWorkspaceCache,
  workspaceCacheDir,
  workspaceCacheId
} from "../src/storage/workspace-cache.js";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

describe("workspace cache ids", () => {
  it("gives one id per folder and ignores a trailing separator", () => {
    const folder = path.join(os.tmpdir(), "mcp-projet-a");
    expect(workspaceCacheId(folder + path.sep)).toBe(workspaceCacheId(folder));
    expect(workspaceCacheId(path.join(os.tmpdir(), "mcp-projet-b"))).not.toBe(workspaceCacheId(folder));
  });

  it("uses MCP_CONTEXTE_GPT_WORKSPACE when it is set", () => {
    expect(getWorkspacePath({ MCP_CONTEXTE_GPT_WORKSPACE: path.join(os.tmpdir(), "choix") })).toBe(
      normalizeWorkspacePath(path.join(os.tmpdir(), "choix"))
    );
  });

  it("keeps an explicit cache directory as a single shared root", () => {
    expect(getCacheRoot({ MCP_CONTEXTE_GPT_CACHE_DIR: path.join(os.tmpdir(), "fixe") })).toBe(
      path.join(os.tmpdir(), "fixe")
    );
  });
});

describe("prepareWorkspaceCache", () => {
  it("groups a workspace in its own folder and drops the cache of a deleted folder", async () => {
    const cacheBase = await tempDir("mcp-cache-base-");
    const kept = await tempDir("mcp-kept-");
    const gone = await tempDir("mcp-gone-");

    await prepareWorkspaceCache({ MCP_CONTEXTE_GPT_WORKSPACE: kept }, cacheBase);
    await prepareWorkspaceCache({ MCP_CONTEXTE_GPT_WORKSPACE: gone }, cacheBase);
    const goneCache = workspaceCacheDir(cacheBase, gone);
    await fs.writeFile(path.join(goneCache, "conversation.md"), "ancien");
    await fs.rm(gone, { recursive: true, force: true });

    await prepareWorkspaceCache({ MCP_CONTEXTE_GPT_WORKSPACE: kept }, cacheBase);

    await expect(fs.stat(workspaceCacheDir(cacheBase, kept))).resolves.toBeTruthy();
    await expect(fs.stat(goneCache)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("leaves a cache folder that has no workspace marker", async () => {
    const cacheBase = await tempDir("mcp-cache-base-");
    const kept = await tempDir("mcp-kept-");
    const unknown = path.join(cacheBase, "workspaces", "sans-marqueur");
    await fs.mkdir(unknown, { recursive: true });
    await fs.writeFile(path.join(unknown, "conversation.md"), "gardé");

    await prepareWorkspaceCache({ MCP_CONTEXTE_GPT_WORKSPACE: kept }, cacheBase);

    await expect(fs.stat(path.join(unknown, "conversation.md"))).resolves.toBeTruthy();
  });

  it("does not prune when MCP_CONTEXTE_GPT_CACHE_DIR is set", async () => {
    const cacheBase = await tempDir("mcp-cache-base-");
    const kept = await tempDir("mcp-kept-");
    await prepareWorkspaceCache({ MCP_CONTEXTE_GPT_CACHE_DIR: path.join(cacheBase, "fixe"), MCP_CONTEXTE_GPT_WORKSPACE: kept }, cacheBase);
    await expect(fs.stat(path.join(cacheBase, "workspaces"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
