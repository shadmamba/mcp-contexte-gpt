import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listProjectConversations } from "../src/providers/chatgpt/chatgpt-client.js";
import { importChatgptUrl } from "../src/mcp/tools/import-chatgpt-url.js";
import { importChatgptProject } from "../src/mcp/tools/import-chatgpt-project.js";
import { AppError } from "../src/shared/errors.js";

const PROJECT_URL = "https://chatgpt.com/g/g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-example/project";
const PROJECT_ID = "g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

let tmp: string;

afterEach(async () => {
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
});

function makeJwt(): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ exp: 1893456000 })).toString("base64url");
  return `${header}.${body}.sig`;
}

function conversation(id: string, title: string) {
  return {
    id,
    title,
    mapping: {
      root: { parent: null, children: ["u"] },
      u: {
        parent: "root",
        children: ["a"],
        message: { id: "u", author: { role: "user" }, content: { content_type: "text", parts: ["Question"] } }
      },
      a: {
        parent: "u",
        children: [],
        message: { id: "a", author: { role: "assistant" }, content: { content_type: "text", parts: [title] } }
      }
    }
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body
  } as Response;
}

describe("listProjectConversations", () => {
  it("follows cursor pages until the API total is covered", async () => {
    const fetchImpl = (async (url: string) => {
      const cursor = new URL(url).searchParams.get("cursor");
      if (cursor === "0") {
        return jsonResponse({
          total: 3,
          items: [
            { id: "c1", title: "One" },
            { id: "c2", title: "Two" }
          ]
        });
      }
      return jsonResponse({ total: 3, items: [{ id: "c3", title: "Three" }] });
    }) as typeof fetch;

    const listed = await listProjectConversations(PROJECT_ID, {
      env: { CHATGPT_BEARER_TOKEN: makeJwt() },
      fetchImpl,
      pageSize: 2
    });

    expect(listed.complete).toBe(true);
    expect(listed.items.map((item) => item.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("marks the list incomplete when the safety stop is hit before the total", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        total: 4,
        items: [
          { id: "c1", title: "One" },
          { id: "c2", title: "Two" }
        ]
      })) as typeof fetch;

    const listed = await listProjectConversations(PROJECT_ID, {
      env: { CHATGPT_BEARER_TOKEN: makeJwt() },
      fetchImpl,
      pageSize: 2,
      maxItems: 2
    });

    expect(listed.complete).toBe(false);
    expect(listed.items).toHaveLength(2);
  });
});

describe("importChatgptProject", () => {
  it("imports every listed conversation and reports full coverage", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-project-"));
    const result = await importChatgptProject({
      url: PROJECT_URL,
      cacheRoot: tmp,
      clientOptions: {
        env: { CHATGPT_BEARER_TOKEN: makeJwt() },
        fetchImpl: projectFetch([
          { id: "c1", title: "Auth decision" },
          { id: "c2", title: "Older note" }
        ])
      }
    });

    expect(result.covered).toBe(true);
    expect(result.list_complete).toBe(true);
    expect(result.imported_count).toBe(2);
    expect(result.not_imported).toEqual([]);
    expect(result.imported.map((item) => item.source_url)).toEqual([
      "https://chatgpt.com/g/g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-example/c/c1",
      "https://chatgpt.com/g/g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-example/c/c2"
    ]);
    await expect(fs.stat(result.imported[0].cache.markdown_path)).resolves.toBeTruthy();
    expect(await fs.readFile(result.imported[1].cache.markdown_path, "utf8")).toContain("Older note");
  });

  it("lists every conversation and imports none in list_only mode", async () => {
    const result = await importChatgptProject({
      url: PROJECT_URL,
      mode: "list_only",
      clientOptions: {
        env: { CHATGPT_BEARER_TOKEN: makeJwt() },
        fetchImpl: projectFetch([
          { id: "c1", title: "Auth decision" },
          { id: "c2", title: "Older note" }
        ])
      }
    });

    expect(result.covered).toBe(false);
    expect(result.imported_count).toBe(0);
    expect(result.not_imported.map((item) => item.title)).toEqual(["Auth decision", "Older note"]);
    expect(result.not_imported.every((item) => item.reason === "list_only")).toBe(true);
    expect(result.warning).toMatch(/not imported/i);
  });

  it("imports only the chosen ids and does not report the ones the caller left out", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-project-"));
    const result = await importChatgptProject({
      url: PROJECT_URL,
      conversation_ids: ["c2", "missing"],
      cacheRoot: tmp,
      clientOptions: {
        env: { CHATGPT_BEARER_TOKEN: makeJwt() },
        fetchImpl: projectFetch([
          { id: "c1", title: "Auth decision" },
          { id: "c2", title: "Older note" }
        ])
      }
    });

    expect(result.covered).toBeUndefined();
    expect(result.imported.map((item) => item.conversation_id)).toEqual(["c2"]);
    expect(result.not_imported).toEqual([]);
    expect(result.unknown_ids).toEqual(["missing"]);
    expect(result.warning).toMatch(/missing/);
  });

  it("names every conversation past an explicit import cap", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-project-"));
    const result = await importChatgptProject({
      url: PROJECT_URL,
      max_imports: 1,
      cacheRoot: tmp,
      clientOptions: {
        env: { CHATGPT_BEARER_TOKEN: makeJwt() },
        fetchImpl: projectFetch([
          { id: "c1", title: "First" },
          { id: "c2", title: "Second" }
        ])
      }
    });

    expect(result.imported.map((item) => item.conversation_id)).toEqual(["c1"]);
    expect(result.not_imported).toEqual([
      expect.objectContaining({ conversation_id: "c2", title: "Second", reason: "import_limit" })
    ]);
    expect(result.covered).toBe(false);
  });

  it("rejects a project home URL on the single-conversation tool", async () => {
    await expect(importChatgptUrl({ url: PROJECT_URL, clientOptions: { env: {}, fetchImpl: projectFetch([]) } })).rejects.toBeInstanceOf(
      AppError
    );
    await expect(importChatgptUrl({ url: PROJECT_URL, clientOptions: { env: {}, fetchImpl: projectFetch([]) } })).rejects.toThrow(
      /import_chatgpt_project/
    );
  });
});

function projectFetch(items: { id: string; title: string }[]): typeof fetch {
  return (async (url: string) => {
    if (url.includes("/gizmos/") && url.includes("/conversations?")) {
      return jsonResponse({ total: items.length, items });
    }
    const id = url.split("/").pop()?.split("?")[0] ?? "";
    const item = items.find((entry) => entry.id === id);
    return jsonResponse(conversation(id, item?.title ?? "Untitled"));
  }) as typeof fetch;
}
