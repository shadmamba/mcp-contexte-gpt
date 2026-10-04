import type {
  ChatgptContent,
  ChatgptConversation,
  ChatgptMappingNode,
  ChatgptMessage,
  ChatgptRole,
  NormalizedMessage
} from "../providers/chatgpt/types.js";
import { formatDate } from "../shared/format-date.js";

export function normalizeRole(role: string | undefined): ChatgptRole {
  if (role === "system" || role === "user" || role === "assistant" || role === "tool") return role;
  return "unknown";
}

/**
 * Returns the messages of the branch displayed in ChatGPT: walks up from
 * `current_node` to the root. Without `current_node`, follows the last child
 * at each fork (ChatGPT appends edits and regenerations as new children).
 */
export function extractMessagesInOrder(conversation: ChatgptConversation): ChatgptMessage[] {
  const nodes = conversation.mapping;
  if (!nodes) return [];

  const messages: ChatgptMessage[] = [];
  const visited = new Set<string>();
  let nodeId: string | null | undefined = resolveLeafId(conversation, nodes);
  while (nodeId && nodes[nodeId] && !visited.has(nodeId)) {
    visited.add(nodeId);
    const node: ChatgptMappingNode = nodes[nodeId];
    if (node.message?.content) messages.push(node.message);
    nodeId = node.parent;
  }
  return messages.reverse();
}

function resolveLeafId(conversation: ChatgptConversation, nodes: Record<string, ChatgptMappingNode>): string | undefined {
  const current = conversation.current_node;
  if (typeof current === "string" && nodes[current]) return current;

  let nodeId = Object.entries(nodes).find(([, node]) => !node.parent || !nodes[node.parent])?.[0];
  const visited = new Set<string>();
  while (nodeId && !visited.has(nodeId)) {
    visited.add(nodeId);
    const children = (nodes[nodeId]?.children ?? []).filter((childId) => nodes[childId]);
    const next = children[children.length - 1];
    if (!next) return nodeId;
    nodeId = next;
  }
  return nodeId;
}

export function extractMessageContent(message: ChatgptMessage): string {
  if (message.metadata?.is_visually_hidden_from_conversation) return "";
  const content = message.content;
  if (!content) return "";
  if (typeof content === "string") return content;

  if (content.content_type === "text" && Array.isArray(content.parts)) {
    return content.parts.filter((part): part is string => typeof part === "string").join("\n");
  }

  if (content.content_type === "code" && typeof content.text === "string") {
    return "```\n" + content.text + "\n```";
  }

  if (content.content_type === "multimodal_text" && Array.isArray(content.parts)) {
    const parts: string[] = [];
    for (const part of content.parts) {
      if (typeof part === "string") {
        parts.push(part);
      } else if (isContentPart(part) && typeof part.asset_pointer === "string") {
        const fileId = part.asset_pointer.replace(/^(sediment|file-service):\/\//, "");
        const label = part.content_type === "image_asset_pointer" ? "Image" : "File";
        parts.push(`[${label}: ${fileId}]`);
      }
    }
    return parts.join("\n");
  }

  if (content.content_type === "tether_browsing_display") {
    const text = stringParts(content).join("\n");
    return text.trim() ? `> **Browsing Result:**\n>\n> ${text.replace(/\n/g, "\n> ")}` : "";
  }

  if (content.content_type === "thoughts") {
    const text = stringParts(content).join("\n");
    return text.trim() ? `<details>\n<summary>Thinking</summary>\n\n${text}\n\n</details>` : "";
  }

  if (content.content_type === "reasoning_recap") {
    const text = stringParts(content).join("\n");
    return text.trim() ? `*Reasoning recap: ${text}*` : "";
  }

  if (content.content_type === "model_editable_context") {
    return "";
  }

  return "";
}

export function normalizeMessage(message: ChatgptMessage): NormalizedMessage | null {
  const content = formatToolMessage(message) || extractMessageContent(message);
  if (!content.trim()) return null;

  return {
    id: message.id,
    role: normalizeRole(message.author?.role),
    name: message.author?.name,
    create_time: formatDate(message.create_time),
    content
  };
}

export function conversationToMessages(conversation: ChatgptConversation): NormalizedMessage[] {
  return extractMessagesInOrder(conversation)
    .map(normalizeMessage)
    .filter((message): message is NormalizedMessage => message !== null);
}

function formatToolMessage(message: ChatgptMessage): string {
  if (message.author?.role !== "tool") return "";
  const name = message.author.name || "unknown_tool";
  const content = extractMessageContent(message);
  return content.trim() ? `> **Tool (${name}):** ${content}` : "";
}

function stringParts(content: ChatgptContent): string[] {
  return Array.isArray(content.parts) ? content.parts.filter((part): part is string => typeof part === "string") : [];
}

function isContentPart(value: unknown): value is ChatgptContent {
  return typeof value === "object" && value !== null;
}
