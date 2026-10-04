import { describe, expect, it } from "vitest";
import { packJson, packMarkdown, packMessages } from "../src/rendering/context-packer.js";
import { conversationToMarkdown, conversationToMarkdownParts } from "../src/rendering/markdown-renderer.js";
import { conversationToMessages } from "../src/rendering/conversation-messages.js";
import type { ChatgptConversation, NormalizedMessage } from "../src/providers/chatgpt/types.js";

function longConversation(): { conversation: ChatgptConversation; messages: NormalizedMessage[] } {
  const mapping: ChatgptConversation["mapping"] = { root: { parent: null, children: ["n0"] } };
  for (let i = 0; i < 10; i++) {
    mapping[`n${i}`] = {
      parent: i === 0 ? "root" : `n${i - 1}`,
      children: i < 9 ? [`n${i + 1}`] : [],
      message: {
        id: `m${i}`,
        author: { role: i % 2 === 0 ? "user" : "assistant" },
        content: { content_type: "text", parts: [`message ${i} ` + "x".repeat(200)] }
      }
    };
  }
  const conversation: ChatgptConversation = { id: "conv-long", title: "Long", mapping };
  return { conversation, messages: conversationToMessages(conversation) };
}

describe("context packing", () => {
  it("leaves small markdown unchanged", () => {
    expect(packMarkdown("hello", 10)).toEqual({ content: "hello", truncated: false, char_count: 5 });
  });

  it("truncates markdown and includes cache hints", () => {
    const result = packMarkdown("a".repeat(100), 60, { markdown_path: "/tmp/conversation.md" });
    expect(result.truncated).toBe(true);
    expect(result.char_count).toBe(100);
    expect(result.content).toContain("/tmp/conversation.md");
  });

  it("keeps front matter and whole recent messages when truncating markdown", () => {
    const { conversation, messages } = longConversation();
    const markdown = conversationToMarkdown(conversation);
    const parts = conversationToMarkdownParts(conversation, messages);
    const result = packMarkdown(markdown, 1000, { markdown_path: "/tmp/conversation.md" }, parts);

    expect(result.truncated).toBe(true);
    expect(result.char_count).toBe(markdown.length);
    expect(result.content.length).toBeLessThanOrEqual(1000);
    expect(result.content.startsWith("---\n")).toBe(true);
    expect(result.content).toContain("# Long");
    expect(result.content).toContain("/tmp/conversation.md");
    expect(result.content).toContain("message 9");
    expect(result.content).not.toContain("message 0");
    const body = result.content.split(/showing the last \d+ of 10 messages[^\n]*\n(?:> [^\n]*\n)*\n/)[1];
    expect(body.startsWith("## ")).toBe(true);
  });

  it("packs newest messages within budget", () => {
    const result = packMessages([
      { role: "user", content: "old".repeat(20) },
      { role: "assistant", content: "new" }
    ], 80);
    expect(result.truncated).toBe(true);
    expect(result.content).toEqual([{ role: "assistant", content: "new" }]);
  });

  it("returns full json when it fits", () => {
    const result = packJson({ id: "c" }, [], 1000);
    expect(result.truncated).toBe(false);
    expect(JSON.parse(result.content)).toEqual({ id: "c" });
  });

  it("truncates json into valid json with the most recent messages", () => {
    const { conversation, messages } = longConversation();
    const result = packJson(conversation, messages, 1000, { json_path: "/tmp/conversation.json" });

    expect(result.truncated).toBe(true);
    expect(result.content.length).toBeLessThanOrEqual(1000);
    const parsed = JSON.parse(result.content);
    expect(parsed).toMatchObject({ truncated: true, full_json_path: "/tmp/conversation.json", title: "Long", total_messages: 10 });
    expect(parsed.mapping).toBeUndefined();
    expect(parsed.messages.length).toBeGreaterThan(0);
    expect(parsed.messages.at(-1).id).toBe("m9");
  });
});
