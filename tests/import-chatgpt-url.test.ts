import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importChatgptUrl } from "../src/mcp/tools/import-chatgpt-url.js";
import type { ChatgptConversation } from "../src/providers/chatgpt/types.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-import-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function makeJwt(): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ exp: 1893456000 })).toString("base64url");
  return `${header}.${body}.sig`;
}

function conversation(title = "Title", answer = "Answer"): ChatgptConversation {
  return {
    id: "conv-1",
    title,
    create_time: 1893456000,
    update_time: 1893456060,
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
        message: { id: "a", author: { role: "assistant" }, content: { content_type: "text", parts: [answer] } }
      }
    }
  };
}

function mockFetch(body: unknown, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body
  })) as unknown as typeof fetch;
}

describe("importChatgptUrl", () => {
  it("fetches remote conversation, writes cache, and returns markdown", async () => {
    const result = await importChatgptUrl({
      url: "https://chatgpt.com/c/conv-1",
      cacheRoot: tmp,
      clientOptions: { env: { CHATGPT_BEARER_TOKEN: makeJwt() }, fetchImpl: mockFetch(conversation()) }
    });

    expect(result.refreshed).toBe(true);
    expect(result.freshness.changed).toBe(true);
    expect(String(result.content)).toContain("Answer");
    await expect(fs.stat(result.cache.markdown_path)).resolves.toBeTruthy();
  });

  it("returns changed false when remote hash is unchanged", async () => {
    const fetchImpl = mockFetch(conversation());
    await importChatgptUrl({
      url: "https://chatgpt.com/c/conv-1",
      cacheRoot: tmp,
      clientOptions: { env: { CHATGPT_BEARER_TOKEN: makeJwt() }, fetchImpl }
    });
    const second = await importChatgptUrl({
      url: "https://chatgpt.com/c/conv-1",
      cacheRoot: tmp,
      clientOptions: { env: { CHATGPT_BEARER_TOKEN: makeJwt() }, fetchImpl }
    });
    expect(second.freshness.changed).toBe(false);
  });

  it("ignores unstable top-level safe_urls when comparing content", async () => {
    await importChatgptUrl({
      url: "https://chatgpt.com/c/conv-1",
      cacheRoot: tmp,
      clientOptions: {
        env: { CHATGPT_BEARER_TOKEN: makeJwt() },
        fetchImpl: mockFetch({ ...conversation(), safe_urls: ["a"] })
      }
    });
    const second = await importChatgptUrl({
      url: "https://chatgpt.com/c/conv-1",
      cacheRoot: tmp,
      clientOptions: {
        env: { CHATGPT_BEARER_TOKEN: makeJwt() },
        fetchImpl: mockFetch({ ...conversation(), safe_urls: ["b"] })
      }
    });
    expect(second.freshness.changed).toBe(false);
  });

  it("updates cache when remote content changes", async () => {
    await importChatgptUrl({
      url: "https://chatgpt.com/c/conv-1",
      cacheRoot: tmp,
      clientOptions: { env: { CHATGPT_BEARER_TOKEN: makeJwt() }, fetchImpl: mockFetch(conversation("Title", "Old")) }
    });
    const second = await importChatgptUrl({
      url: "https://chatgpt.com/c/conv-1",
      cacheRoot: tmp,
      clientOptions: { env: { CHATGPT_BEARER_TOKEN: makeJwt() }, fetchImpl: mockFetch(conversation("Title", "New")) }
    });
    expect(second.freshness.changed).toBe(true);
    expect(second.content).toContain("New");
  });

  it("regenerates cached artifacts written by an older format version", async () => {
    const fetchImpl = mockFetch(conversation());
    const first = await importChatgptUrl({
      url: "https://chatgpt.com/c/conv-1",
      cacheRoot: tmp,
      clientOptions: { env: { CHATGPT_BEARER_TOKEN: makeJwt() }, fetchImpl }
    });
    const metadata = JSON.parse(await fs.readFile(first.cache.metadata_path, "utf8"));
    await fs.writeFile(first.cache.metadata_path, JSON.stringify({ ...metadata, format_version: 1 }));
    await fs.writeFile(first.cache.markdown_path, "stale markdown");

    const second = await importChatgptUrl({
      url: "https://chatgpt.com/c/conv-1",
      cacheRoot: tmp,
      clientOptions: { env: { CHATGPT_BEARER_TOKEN: makeJwt() }, fetchImpl }
    });

    expect(second.freshness.changed).toBe(false);
    expect(String(second.content)).toContain("Answer");
    expect(await fs.readFile(second.cache.markdown_path, "utf8")).not.toContain("stale markdown");
    const rewritten = JSON.parse(await fs.readFile(second.cache.metadata_path, "utf8"));
    expect(rewritten.format_version).toBe(2);
  });

  it("detects a branch switch in ChatGPT as a content change", async () => {
    const edited = (currentNode: string): ChatgptConversation => ({
      ...conversation(),
      current_node: currentNode,
      mapping: {
        root: { parent: null, children: ["u1", "u2"] },
        u1: { parent: "root", children: [], message: { id: "u1", author: { role: "user" }, content: { content_type: "text", parts: ["First"] } } },
        u2: { parent: "root", children: [], message: { id: "u2", author: { role: "user" }, content: { content_type: "text", parts: ["Second"] } } }
      }
    });
    await importChatgptUrl({
      url: "https://chatgpt.com/c/conv-1",
      cacheRoot: tmp,
      clientOptions: { env: { CHATGPT_BEARER_TOKEN: makeJwt() }, fetchImpl: mockFetch(edited("u2")) }
    });
    const switched = await importChatgptUrl({
      url: "https://chatgpt.com/c/conv-1",
      cacheRoot: tmp,
      clientOptions: { env: { CHATGPT_BEARER_TOKEN: makeJwt() }, fetchImpl: mockFetch(edited("u1")) }
    });

    expect(switched.freshness.changed).toBe(true);
    expect(String(switched.content)).toContain("First");
    expect(String(switched.content)).not.toContain("Second");
  });

  it("cache_only reads cache and does not call fetch", async () => {
    await importChatgptUrl({
      url: "https://chatgpt.com/c/conv-1",
      cacheRoot: tmp,
      clientOptions: { env: { CHATGPT_BEARER_TOKEN: makeJwt() }, fetchImpl: mockFetch(conversation()) }
    });
    const fetchImpl = mockFetch(conversation(), 500);
    const cached = await importChatgptUrl({
      url: "https://chatgpt.com/c/conv-1",
      cacheRoot: tmp,
      cache_policy: "cache_only",
      clientOptions: { env: {}, fetchImpl }
    });
    expect(cached.freshness.checked_remote).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });


  it("imports shared conversation URLs without requiring a bearer token", async () => {
    const result = await importChatgptUrl({
      url: "https://chatgpt.com/share/share-1",
      cacheRoot: tmp,
      clientOptions: {
        env: {},
        fetchImpl: mockFetch({
          title: "Shared CDC",
          mapping: {
            root: { parent: null, children: ["u"] },
            u: {
              parent: "root",
              children: ["a"],
              message: { id: "u", author: { role: "user" }, content: { content_type: "text", parts: ["Spec"] } }
            },
            a: {
              parent: "u",
              children: [],
              message: { id: "a", author: { role: "assistant" }, content: { content_type: "text", parts: ["Ack"] } }
            }
          }
        })
      }
    });

    expect(result.conversation_id).toBe("share-share-1");
    expect(result.source_url).toBe("https://chatgpt.com/share/share-1");
    expect(result.refreshed).toBe(true);
    expect(String(result.content)).toContain("Ack");
    await expect(fs.stat(result.cache.markdown_path)).resolves.toBeTruthy();
  });

  it("imports project shared conversation URLs with bearer token", async () => {
    const fetchImpl = mockFetch({
      title: "Project CDC",
      mapping: {
        root: { parent: null, children: ["u"] },
        u: {
          parent: "root",
          children: ["a"],
          message: { id: "u", author: { role: "user" }, content: { content_type: "text", parts: ["Finance"] } }
        },
        a: {
          parent: "u",
          children: [],
          message: { id: "a", author: { role: "assistant" }, content: { content_type: "text", parts: ["Layer"] } }
        }
      }
    });
    const result = await importChatgptUrl({
      url: "https://chatgpt.com/g/g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-example/shared/c/conv-project-1?owner_user_id=user-owner1",
      cacheRoot: tmp,
      clientOptions: { env: { CHATGPT_BEARER_TOKEN: makeJwt() }, fetchImpl }
    });

    expect(result.conversation_id).toBe("conv-project-1");
    expect(result.source_url).toContain("/g/g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-example/shared/c/conv-project-1");
    expect(String(result.content)).toContain("Layer");
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("auth failure with cache reports cache_available", async () => {
    await importChatgptUrl({
      url: "https://chatgpt.com/c/conv-1",
      cacheRoot: tmp,
      clientOptions: { env: { CHATGPT_BEARER_TOKEN: makeJwt() }, fetchImpl: mockFetch(conversation()) }
    });
    await expect(
      importChatgptUrl({
        url: "https://chatgpt.com/c/conv-1",
        cacheRoot: tmp,
        clientOptions: { env: {}, fetchImpl: mockFetch(conversation()) }
      })
    ).rejects.toMatchObject({ error_code: "AUTH_TOKEN_MISSING", cache_available: true });
  });
});
