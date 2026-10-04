import { describe, expect, it } from "vitest";
import { AppError } from "../src/shared/errors.js";
import { parseChatgptUrl } from "../src/providers/chatgpt/url-parser.js";

describe("parseChatgptUrl", () => {
  it("accepts chatgpt.com private conversation URLs", () => {
    expect(parseChatgptUrl("https://chatgpt.com/c/abc123")).toEqual({
      kind: "private",
      id: "abc123",
      cacheId: "abc123",
      sourceUrl: "https://chatgpt.com/c/abc123"
    });
  });

  it("accepts legacy chat.openai.com private conversation URLs", () => {
    expect(parseChatgptUrl("https://chat.openai.com/c/abc123?model=gpt")).toEqual({
      kind: "private",
      id: "abc123",
      cacheId: "abc123",
      sourceUrl: "https://chat.openai.com/c/abc123"
    });
  });

  it("accepts shared links", () => {
    expect(parseChatgptUrl("https://chatgpt.com/share/abc123")).toEqual({
      kind: "share",
      id: "abc123",
      cacheId: "share-abc123",
      sourceUrl: "https://chatgpt.com/share/abc123"
    });
  });

  it("accepts /share/e/{id} variants", () => {
    expect(parseChatgptUrl("https://chatgpt.com/share/e/abc123")).toEqual({
      kind: "share",
      id: "abc123",
      cacheId: "share-abc123",
      sourceUrl: "https://chatgpt.com/share/abc123"
    });
  });

  it("rejects non-ChatGPT domains", () => {
    expect(() => parseChatgptUrl("https://example.com/c/abc123")).toThrow(AppError);
  });

  it("rejects unsupported paths", () => {
    expect(() => parseChatgptUrl("https://chatgpt.com/g/abc123")).toThrow(AppError);
    expect(() => parseChatgptUrl("https://chatgpt.com/g/abc123")).toThrow(
      /\/share\/e\/\{share_id\}, \/g\/\{project\}\/c\/\{conversation_id\}, or \/g\/\{project\}\/shared\/c\/\{conversation_id\}/
    );
  });

  it("accepts project shared conversation URLs", () => {
    expect(
      parseChatgptUrl(
        "https://chatgpt.com/g/g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-example-project/shared/c/conv-project-1?owner_user_id=user-owner1"
      )
    ).toEqual({
      kind: "project",
      id: "conv-project-1",
      cacheId: "conv-project-1",
      sourceUrl:
        "https://chatgpt.com/g/g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-example-project/shared/c/conv-project-1?owner_user_id=user-owner1",
      projectId: "g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ownerUserId: "user-owner1"
    });
  });

  it("accepts project conversation URLs without shared", () => {
    expect(
      parseChatgptUrl("https://chatgpt.com/g/g-p-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-proj/c/conv-2")
    ).toEqual({
      kind: "project",
      id: "conv-2",
      cacheId: "conv-2",
      sourceUrl: "https://chatgpt.com/g/g-p-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-proj/c/conv-2",
      projectId: "g-p-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ownerUserId: undefined
    });
  });

  it("requires owner_user_id for project shared URLs", () => {
    expect(() =>
      parseChatgptUrl(
        "https://chatgpt.com/g/g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-example/shared/c/conv-project-1"
      )
    ).toThrow(/owner_user_id/);
  });
});
