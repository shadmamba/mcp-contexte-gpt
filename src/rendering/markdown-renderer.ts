import type { ChatgptConversation, NormalizedMessage } from "../providers/chatgpt/types.js";
import { formatDate } from "../shared/format-date.js";
import { conversationToMessages } from "./conversation-messages.js";

/** Front matter + title, and one block per message, so truncation can cut on message boundaries. */
export interface MarkdownParts {
  header: string;
  blocks: string[];
}

export function conversationToMarkdown(conversation: ChatgptConversation): string {
  return renderMarkdown(conversationToMarkdownParts(conversation));
}

export function conversationToMarkdownParts(
  conversation: ChatgptConversation,
  messages: NormalizedMessage[] = conversationToMessages(conversation)
): MarkdownParts {
  const id = conversation.id || conversation.conversation_id || "unknown";
  const title = conversation.title || "Untitled";

  const headerLines: string[] = [];
  headerLines.push("---");
  headerLines.push(`title: "${escapeYaml(title)}"`);
  headerLines.push(`id: ${id}`);
  headerLines.push(`create_time: ${formatDate(conversation.create_time) || "unknown"}`);
  headerLines.push(`update_time: ${formatDate(conversation.update_time) || "unknown"}`);
  if (conversation.model) headerLines.push(`model: ${conversation.model}`);
  if (conversation.gizmo_id) headerLines.push(`project_id: ${conversation.gizmo_id}`);
  headerLines.push("---");
  headerLines.push("");
  headerLines.push(`# ${title}`);
  headerLines.push("");

  return {
    header: headerLines.join("\n") + "\n",
    blocks: messages.map(messageToMarkdown)
  };
}

export function renderMarkdown(parts: MarkdownParts): string {
  return (parts.header + parts.blocks.join("")).trimEnd() + "\n";
}

function messageToMarkdown(message: NormalizedMessage): string {
  return [`## ${roleLabel(message)}`, "", message.content, ""].join("\n") + "\n";
}

function roleLabel(message: NormalizedMessage): string {
  if (message.role === "tool") return message.name ? `Tool (${message.name})` : "Tool";
  return message.role.charAt(0).toUpperCase() + message.role.slice(1);
}

function escapeYaml(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
}
