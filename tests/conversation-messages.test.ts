import { describe, expect, it } from "vitest";
import { conversationToMessages, extractMessagesInOrder } from "../src/rendering/conversation-messages.js";
import type { ChatgptConversation } from "../src/providers/chatgpt/types.js";

function fixture(): ChatgptConversation {
  return {
    id: "conv-1",
    mapping: {
      root: { parent: null, children: ["user"] },
      user: {
        parent: "root",
        children: ["assistant"],
        message: {
          id: "m1",
          author: { role: "user" },
          create_time: 1893456000,
          content: { content_type: "text", parts: ["Hello"] }
        }
      },
      assistant: {
        parent: "user",
        children: ["hidden"],
        message: {
          id: "m2",
          author: { role: "assistant" },
          content: { content_type: "code", text: "console.log('hi')" }
        }
      },
      hidden: {
        parent: "assistant",
        children: ["tool"],
        message: {
          id: "m3",
          author: { role: "assistant" },
          metadata: { is_visually_hidden_from_conversation: true },
          content: { content_type: "text", parts: ["hidden"] }
        }
      },
      tool: {
        parent: "hidden",
        children: [],
        message: {
          id: "m4",
          author: { role: "tool", name: "browser" },
          content: { content_type: "text", parts: ["result"] }
        }
      }
    }
  };
}

function editedFixture(currentNode?: string): ChatgptConversation {
  const text = (id: string, role: string, value: string) => ({
    id,
    author: { role },
    content: { content_type: "text", parts: [value] }
  });
  return {
    id: "conv-edited",
    current_node: currentNode,
    mapping: {
      root: { parent: null, children: ["u1", "u2"] },
      u1: { parent: "root", children: ["a1"], message: text("u1", "user", "Question v1") },
      a1: { parent: "u1", children: [], message: text("a1", "assistant", "Answer to v1") },
      u2: { parent: "root", children: ["a2"], message: text("u2", "user", "Question v2") },
      a2: { parent: "u2", children: [], message: text("a2", "assistant", "Answer to v2") }
    }
  };
}

describe("conversationToMessages", () => {
  it("traverses the mapping in visible order", () => {
    expect(extractMessagesInOrder(fixture()).map((message) => message.id)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(conversationToMessages(fixture()).map((message) => message.id)).toEqual(["m1", "m2", "m4"]);
  });

  it("follows current_node to the branch displayed in ChatGPT", () => {
    expect(conversationToMessages(editedFixture("a1")).map((message) => message.content)).toEqual([
      "Question v1",
      "Answer to v1"
    ]);
    expect(conversationToMessages(editedFixture("a2")).map((message) => message.content)).toEqual([
      "Question v2",
      "Answer to v2"
    ]);
  });

  it("follows the most recent child at each fork when current_node is missing", () => {
    expect(conversationToMessages(editedFixture()).map((message) => message.content)).toEqual([
      "Question v2",
      "Answer to v2"
    ]);
  });

  it("falls back to the latest branch when current_node is unknown", () => {
    expect(conversationToMessages(editedFixture("missing")).map((message) => message.content)).toEqual([
      "Question v2",
      "Answer to v2"
    ]);
  });

  it("walks up from current_node when the root was not returned", () => {
    const conversation = editedFixture("a2");
    delete conversation.mapping!.root;
    expect(conversationToMessages(conversation).map((message) => message.content)).toEqual([
      "Question v2",
      "Answer to v2"
    ]);
  });

  it("normalizes roles and content", () => {
    const messages = conversationToMessages(fixture());
    expect(messages[0]).toMatchObject({ role: "user", content: "Hello", create_time: "2030-01-01T00:00:00.000Z" });
    expect(messages[1].content).toContain("```");
    expect(messages[2].content).toContain("Tool (browser)");
  });
});

