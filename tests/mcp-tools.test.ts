import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importChatgptUrl } from "../src/mcp/tools/import-chatgpt-url.js";
import { getChatgptContext } from "../src/mcp/tools/get-chatgpt-context.js";
import { listChatgptImports } from "../src/mcp/tools/list-chatgpt-imports.js";
import { verifyChatgptAuth } from "../src/mcp/tools/verify-chatgpt-auth.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-tools-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function makeJwt(exp = 1893456000): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `${header}.${body}.sig`;
}

const conversation = {
  id: "conv-1",
  title: "Tool Test",
  mapping: {
    root: { parent: null, children: ["u"] },
    u: {
      parent: "root",
      children: [],
      message: { author: { role: "user" }, content: { content_type: "text", parts: ["Find me"] } }
    }
  }
};

function mockFetch(status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => conversation
  })) as unknown as typeof fetch;
}

describe("tool services", () => {
  it("gets cached context and lists imports", async () => {
    await importChatgptUrl({
      url: "https://chatgpt.com/c/conv-1",
      cacheRoot: tmp,
      clientOptions: { env: { CHATGPT_BEARER_TOKEN: makeJwt() }, fetchImpl: mockFetch() }
    });

    const context = await getChatgptContext({ conversation_id: "conv-1", cacheRoot: tmp });
    expect(context.freshness.source).toBe("cache");
    expect(context.content).toContain("Find me");

    const list = await listChatgptImports({ query: "find me", cacheRoot: tmp });
    expect(list.items).toHaveLength(1);
  });

  it("verifies auth success", async () => {
    const result = await verifyChatgptAuth({
      env: { CHATGPT_BEARER_TOKEN: makeJwt() },
      clientOptions: { fetchImpl: mockFetch() }
    });
    expect(result).toMatchObject({ has_token: true, token_expired: false, api_accessible: true });
  });

  it("verifies expired token without calling remote", async () => {
    const fetchImpl = mockFetch();
    const result = await verifyChatgptAuth({
      env: { CHATGPT_BEARER_TOKEN: makeJwt(100) },
      now: 101_000,
      clientOptions: { fetchImpl }
    });
    expect(result).toMatchObject({ token_expired: true, api_accessible: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

