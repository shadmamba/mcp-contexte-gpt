import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const WORKSPACE_MARKER = "workspace.json";

export function getWorkspacePath(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeWorkspacePath(env.MCP_CONTEXTE_GPT_WORKSPACE?.trim() || process.cwd());
}

/** Stable absolute path. On Windows the hash ignores drive-letter case and trailing slashes. */
export function normalizeWorkspacePath(input: string): string {
  let resolved = path.resolve(input);
  if (resolved.length > path.parse(resolved).root.length && resolved.endsWith(path.sep)) {
    resolved = resolved.slice(0, -1);
  }
  if (process.platform === "win32") resolved = resolved.toLowerCase();
  return resolved;
}

export function workspaceCacheId(workspacePath: string): string {
  return createHash("sha256").update(normalizeWorkspacePath(workspacePath)).digest("hex").slice(0, 32);
}

export function workspacesDir(cacheBase: string): string {
  return path.join(cacheBase, "workspaces");
}

export function workspaceCacheDir(cacheBase: string, workspacePath: string): string {
  return path.join(workspacesDir(cacheBase), workspaceCacheId(workspacePath));
}

/**
 * Records the current workspace, then deletes cache folders whose workspace
 * directory no longer exists. Folders without a marker are left in place.
 * An explicit MCP_CONTEXTE_GPT_CACHE_DIR opts out of both steps.
 */
export async function prepareWorkspaceCache(env: NodeJS.ProcessEnv = process.env, cacheBase: string): Promise<void> {
  if (env.MCP_CONTEXTE_GPT_CACHE_DIR?.trim()) return;

  const workspacePath = getWorkspacePath(env);
  const dir = workspaceCacheDir(cacheBase, workspacePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, WORKSPACE_MARKER),
    JSON.stringify({ workspace_path: workspacePath }, null, 2)
  );
  await pruneMissingWorkspaces(workspacesDir(cacheBase));
}

export async function pruneMissingWorkspaces(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const cacheDir = path.join(dir, entry.name);
    const workspacePath = await readWorkspaceMarker(cacheDir);
    if (!workspacePath) continue;
    if (await pathExists(workspacePath)) continue;
    await fs.rm(cacheDir, { recursive: true, force: true });
    removed.push(cacheDir);
  }
  return removed;
}

async function readWorkspaceMarker(cacheDir: string): Promise<string | undefined> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(cacheDir, WORKSPACE_MARKER), "utf8")) as {
      workspace_path?: unknown;
    };
    return typeof raw.workspace_path === "string" && raw.workspace_path.trim() ? raw.workspace_path : undefined;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    return undefined;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    return true;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}
