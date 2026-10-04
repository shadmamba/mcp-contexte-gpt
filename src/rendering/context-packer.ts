import type { ChatgptConversation, NormalizedMessage } from "../providers/chatgpt/types.js";
import type { MarkdownParts } from "./markdown-renderer.js";

export interface CachePathInfo {
  json_path?: string;
  markdown_path?: string;
  messages_path?: string;
  metadata_path?: string;
}

export interface PackResult<T = string | NormalizedMessage[] | object> {
  content: T;
  truncated: boolean;
  char_count: number;
}

/**
 * Every format keeps the conversation metadata and the most recent messages,
 * cutting only between whole messages.
 */
export function packMarkdown(
  markdown: string,
  maxChars = 30000,
  cache?: CachePathInfo,
  parts?: MarkdownParts
): PackResult<string> {
  if (markdown.length <= maxChars) {
    return { content: markdown, truncated: false, char_count: markdown.length };
  }

  const hints = [
    cache?.markdown_path ? `Markdown: ${cache.markdown_path}` : undefined,
    cache?.json_path ? `JSON: ${cache.json_path}` : undefined
  ].filter(Boolean);

  if (!parts || parts.blocks.length === 0) {
    const notice = ["[Content truncated. Full cached artifacts are available locally.]", ...hints, ""].join("\n");
    const budget = Math.max(0, maxChars - notice.length - 20);
    return { content: `${notice}\n...\n${markdown.slice(-budget)}`, truncated: true, char_count: markdown.length };
  }

  const total = parts.blocks.length;
  const noticeFor = (kept: number) =>
    [
      `> [Content truncated: showing the last ${kept} of ${total} messages. Full cached artifacts are available locally.]`,
      ...hints.map((hint) => `> ${hint}`),
      "",
      ""
    ].join("\n");

  const budget = Math.max(0, maxChars - parts.header.length - noticeFor(total).length);
  const kept: string[] = [];
  let used = 0;
  for (let i = total - 1; i >= 0; i--) {
    const block = parts.blocks[i];
    if (kept.length > 0 && used + block.length > budget) break;
    kept.unshift(kept.length === 0 && block.length > budget ? truncateBlock(block, budget) : block);
    used += kept[0].length;
  }

  const content = (parts.header + noticeFor(kept.length) + kept.join("")).trimEnd() + "\n";
  return { content, truncated: true, char_count: markdown.length };
}

export function packMessages(messages: NormalizedMessage[], maxChars = 30000): PackResult<NormalizedMessage[]> {
  const serializedLength = JSON.stringify(messages).length;
  if (serializedLength <= maxChars) {
    return { content: messages, truncated: false, char_count: serializedLength };
  }

  const selected: NormalizedMessage[] = [];
  let used = 2;
  for (let i = messages.length - 1; i >= 0; i--) {
    const next = messages[i];
    const cost = JSON.stringify(next).length + 1;
    if (selected.length > 0 && used + cost > maxChars) break;
    if (selected.length === 0 || used + cost <= maxChars) {
      selected.unshift(next);
      used += cost;
    }
  }

  return { content: selected, truncated: true, char_count: serializedLength };
}

/** Truncated output stays valid JSON: metadata plus the most recent messages instead of the raw mapping. */
export function packJson(
  conversation: ChatgptConversation,
  messages: NormalizedMessage[],
  maxChars = 30000,
  cache?: CachePathInfo
): PackResult<string> {
  const json = JSON.stringify(conversation, null, 2);
  if (json.length <= maxChars) {
    return { content: json, truncated: false, char_count: json.length };
  }

  const base = {
    truncated: true,
    note: "Raw mapping omitted. Showing the most recent messages of the displayed branch.",
    full_json_path: cache?.json_path,
    id: conversation.id,
    conversation_id: conversation.conversation_id,
    title: conversation.title,
    create_time: conversation.create_time,
    update_time: conversation.update_time,
    model: conversation.model,
    gizmo_id: conversation.gizmo_id,
    current_node: conversation.current_node,
    total_messages: messages.length
  };

  let tail = packMessages(messages, Math.max(0, maxChars - JSON.stringify(base).length)).content;
  let content = JSON.stringify({ ...base, messages: tail });
  while (content.length > maxChars && tail.length > 1) {
    tail = tail.slice(1);
    content = JSON.stringify({ ...base, messages: tail });
  }
  return { content, truncated: true, char_count: json.length };
}

function truncateBlock(block: string, budget: number): string {
  const newline = block.indexOf("\n");
  const heading = newline >= 0 ? block.slice(0, newline + 1) : "";
  const room = Math.max(0, budget - heading.length - 5);
  return `${heading}\n...\n${room > 0 ? block.slice(-room) : ""}`;
}
