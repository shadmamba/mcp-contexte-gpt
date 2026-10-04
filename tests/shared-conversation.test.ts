import { describe, expect, it } from "vitest";
import { normalizeSharedConversation } from "../src/providers/chatgpt/shared-conversation.js";
import { fetchSharedConversation } from "../src/providers/chatgpt/chatgpt-client.js";
import { AppError } from "../src/shared/errors.js";

describe("normalizeSharedConversation", () => {
  it("keeps mapping payloads", () => {
    const conversation = normalizeSharedConversation(
      {
        title: "Shared",
        mapping: {
          root: { id: "root", parent: null, children: ["u"], message: null },
          u: {
            id: "u",
            parent: "root",
            children: [],
            message: {
              id: "u",
              author: { role: "user" },
              content: { content_type: "text", parts: ["Hello"] }
            }
          }
        }
      },
      "share-1",
      "share-share-1"
    );

    expect(conversation.id).toBe("share-share-1");
    expect(conversation.conversation_id).toBe("share-share-1");
    expect(conversation.title).toBe("Shared");
    expect(conversation.mapping?.u?.message?.content).toMatchObject({
      content_type: "text",
      parts: ["Hello"]
    });
  });

  it("preserves current_node so the displayed branch is kept", () => {
    const conversation = normalizeSharedConversation(
      {
        title: "Edited",
        current_node: "u2",
        mapping: {
          root: { id: "root", parent: null, children: ["u1", "u2"], message: null },
          u1: { id: "u1", parent: "root", children: [], message: { id: "u1", author: { role: "user" }, content: { content_type: "text", parts: ["v1"] } } },
          u2: { id: "u2", parent: "root", children: [], message: { id: "u2", author: { role: "user" }, content: { content_type: "text", parts: ["v2"] } } }
        }
      },
      "share-3",
      "share-share-3"
    );

    expect(conversation.current_node).toBe("u2");
  });

  it("builds mapping from linear_conversation messages", () => {
    const conversation = normalizeSharedConversation(
      {
        title: "Linear",
        linear_conversation: [
          {
            id: "m1",
            author: { role: "user" },
            content: { content_type: "text", parts: ["Q"] }
          },
          {
            id: "m2",
            author: { role: "assistant" },
            content: { content_type: "text", parts: ["A"] }
          }
        ]
      },
      "share-2",
      "share-share-2"
    );

    expect(Object.keys(conversation.mapping || {})).toContain("m1");
    expect(Object.keys(conversation.mapping || {})).toContain("m2");
    expect(conversation.mapping?.m1?.parent).toBe("client-created-root");
    expect(conversation.mapping?.m2?.parent).toBe("m1");
  });
});

describe("fetchSharedConversation", () => {
  it("fetches and normalizes share payloads without requiring a token", async () => {
    const fetchImpl = async () =>
      ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          title: "Public share",
          mapping: {
            root: { id: "root", parent: null, children: ["a"], message: null },
            a: {
              id: "a",
              parent: "root",
              children: [],
              message: {
                id: "a",
                author: { role: "assistant" },
                content: { content_type: "text", parts: ["Hi"] }
              }
            }
          }
        })
      }) as unknown as Response;

    const conversation = await fetchSharedConversation("abc", {
      env: {},
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(conversation.title).toBe("Public share");
    expect(conversation.id).toBe("share-abc");
  });

  it("maps 404 to CONVERSATION_NOT_FOUND_OR_FORBIDDEN", async () => {
    const fetchImpl = async () =>
      ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({})
      }) as unknown as Response;

    await expect(
      fetchSharedConversation("missing", {
        env: {},
        fetchImpl: fetchImpl as unknown as typeof fetch
      })
    ).rejects.toMatchObject({ error_code: "CONVERSATION_NOT_FOUND_OR_FORBIDDEN" });
  });

  it("throws AppError on transport failures", async () => {
    const fetchImpl = async () =>
      ({
        ok: false,
        status: 500,
        statusText: "Error",
        json: async () => ({})
      }) as unknown as Response;

    await expect(
      fetchSharedConversation("x", {
        env: {},
        fetchImpl: fetchImpl as unknown as typeof fetch
      })
    ).rejects.toBeInstanceOf(AppError);
  });
});
