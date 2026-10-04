import { createHash } from "node:crypto";
import type { ChatgptConversation } from "../providers/chatgpt/types.js";

export function contentHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

/** Only fields that reflect conversation content; volatile top-level fields (e.g. safe_urls) are ignored. */
export function conversationContentHash(conversation: ChatgptConversation): string {
  return contentHash({
    id: conversation.id,
    conversation_id: conversation.conversation_id,
    title: conversation.title,
    create_time: conversation.create_time,
    update_time: conversation.update_time,
    model: conversation.model,
    gizmo_id: conversation.gizmo_id,
    mapping: conversation.mapping,
    current_node: conversation.current_node
  });
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",")}}`;
}
