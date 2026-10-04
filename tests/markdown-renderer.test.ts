import { describe, expect, it } from "vitest";
import { conversationToMarkdown } from "../src/rendering/markdown-renderer.js";
import type { ChatgptConversation } from "../src/providers/chatgpt/types.js";

describe("conversationToMarkdown", () => {
  it("renders frontmatter and visible messages", () => {
    const conversation: ChatgptConversation = {
      id: "conv-1",
      title: "My Conversation",
      create_time: 1893456000,
      update_time: 1893456060,
      model: "gpt-test",
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
          message: { id: "a", author: { role: "assistant" }, content: { content_type: "text", parts: ["Answer"] } }
        }
      }
    };

    const markdown = conversationToMarkdown(conversation);
    expect(markdown).toContain('title: "My Conversation"');
    expect(markdown).toContain("model: gpt-test");
    expect(markdown).toContain("## User\n\nQuestion");
    expect(markdown).toContain("## Assistant\n\nAnswer");
  });

  it("renders multimodal asset references without downloading files", () => {
    const conversation: ChatgptConversation = {
      id: "conv-1",
      mapping: {
        root: { parent: null, children: ["u"] },
        u: {
          parent: "root",
          children: [],
          message: {
            author: { role: "user" },
            content: {
              content_type: "multimodal_text",
              parts: ["See this", { content_type: "image_asset_pointer", asset_pointer: "file-service://file-1" }]
            }
          }
        }
      }
    };

    expect(conversationToMarkdown(conversation)).toContain("[Image: file-1]");
  });
});

