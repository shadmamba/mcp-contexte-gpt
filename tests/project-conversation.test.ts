import { describe, expect, it, vi } from "vitest";
import { fetchProjectConversation } from "../src/providers/chatgpt/chatgpt-client.js";
import { AppError } from "../src/shared/errors.js";

function makeJwt(): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ exp: 1893456000 })).toString("base64url");
  return `${header}.${body}.sig`;
}

function mappingBody(title = "Project chat") {
  return {
    title,
    mapping: {
      root: { id: "root", parent: null, children: ["u"], message: null },
      u: {
        id: "u",
        parent: "root",
        children: ["a"],
        message: { id: "u", author: { role: "user" }, content: { content_type: "text", parts: ["Spec"] } }
      },
      a: {
        id: "a",
        parent: "u",
        children: [],
        message: { id: "a", author: { role: "assistant" }, content: { content_type: "text", parts: ["Ack"] } }
      }
    }
  };
}

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

describe("fetchProjectConversation", () => {
  it("matches the browser project request: conversations/{id} with num_turns=10 and no Content-Type", async () => {
    const fetchImpl = vi.fn(async () => okResponse(mappingBody())) as unknown as typeof fetch;

    const conversation = await fetchProjectConversation(
      {
        conversationId: "conv-project-1",
        projectId: "g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ownerUserId: "user-owner1",
        sourceUrl:
          "https://chatgpt.com/g/g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-example/shared/c/conv-project-1?owner_user_id=user-owner1"
      },
      { env: { CHATGPT_BEARER_TOKEN: makeJwt(), CHATGPT_ACCOUNT_ID: "acct-1" }, fetchImpl }
    );

    expect(conversation.title).toBe("Project chat");
    expect(conversation.id).toBe("conv-project-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { headers: Record<string, string> }
    ];
    expect(url).toContain("/backend-api/conversations/conv-project-1?");
    expect(url).toContain("num_turns=10");
    expect(url).toContain("include_has_versions=true");
    expect(init.headers["chatgpt-project-id"]).toBe("g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(init.headers["chatgpt-conv-owner-id"]).toBe("user-owner1");
    expect(init.headers["chatgpt-account-id"]).toBe("acct-1");
    expect(init.headers.Accept).toBe("*/*");
    expect(init.headers.Referer).toContain("/shared/c/conv-project-1");
    expect(init.headers["Content-Type"]).toBeUndefined();
  });

  it("falls back to /conversation/{id} when the first mapping is truncated", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const firstPage = url.includes("num_turns=10");
      return okResponse(
        firstPage
          ? {
              title: "Partial",
              mapping: {
                u: {
                  id: "u",
                  parent: "missing-root",
                  children: [],
                  message: { id: "u", author: { role: "user" }, content: { content_type: "text", parts: ["Hi"] } }
                }
              }
            }
          : mappingBody("Full")
      );
    }) as unknown as typeof fetch;

    const conversation = await fetchProjectConversation(
      { conversationId: "conv-project-1", projectId: "g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      { env: { CHATGPT_BEARER_TOKEN: makeJwt() }, fetchImpl }
    );

    expect(conversation.title).toBe("Full");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondUrl = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(secondUrl).toContain("/backend-api/conversation/conv-project-1");
    expect(secondUrl).not.toContain("num_turns=");
  });

  it("falls back after 422 Unprocessable Entity", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("num_turns=10")) {
        return {
          ok: false,
          status: 422,
          statusText: "Unprocessable Entity",
          json: async () => ({ detail: "invalid" }),
          text: async () => JSON.stringify({ detail: "invalid" })
        };
      }
      return okResponse(mappingBody("Recovered"));
    }) as unknown as typeof fetch;

    const conversation = await fetchProjectConversation(
      {
        conversationId: "conv-project-1",
        projectId: "g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ownerUserId: "user-owner1"
      },
      { env: { CHATGPT_BEARER_TOKEN: makeJwt() }, fetchImpl }
    );

    expect(conversation.title).toBe("Recovered");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("maps 403 to AUTH_FAILED", async () => {
    const fetchImpl = async () =>
      ({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        json: async () => ({}),
        text: async () => ""
      }) as unknown as Response;

    await expect(
      fetchProjectConversation(
        { conversationId: "conv-project-1", projectId: "g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        { env: { CHATGPT_BEARER_TOKEN: makeJwt() }, fetchImpl: fetchImpl as unknown as typeof fetch }
      )
    ).rejects.toMatchObject({ error_code: "AUTH_FAILED" });
  });

  it("throws AppError when the token is missing", async () => {
    await expect(
      fetchProjectConversation(
        { conversationId: "conv-project-1", projectId: "g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        { env: {}, fetchImpl: vi.fn() as unknown as typeof fetch }
      )
    ).rejects.toBeInstanceOf(AppError);
  });
});
