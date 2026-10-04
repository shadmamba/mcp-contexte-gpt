import type { ChatgptConversation, ChatgptMappingNode, ChatgptMessage } from "./types.js";
import { AppError } from "../../shared/errors.js";

export interface SharedConversationPayload {
  title?: string;
  create_time?: number | string | null;
  update_time?: number | string | null;
  model?: string;
  gizmo_id?: string;
  conversation_id?: string;
  server_share_id?: string;
  mapping?: Record<string, ChatgptMappingNode>;
  current_node?: unknown;
  linear_conversation?: unknown[];
  has_more?: unknown;
  [key: string]: unknown;
}

/**
 * Normalize a backend-api/share/{id} payload into the same conversation shape
 * used by private conversation fetches.
 */
export function normalizeSharedConversation(
  payload: SharedConversationPayload,
  shareId: string,
  cacheId: string
): ChatgptConversation {
  const mapping =
    payload.mapping && Object.keys(payload.mapping).length > 0
      ? payload.mapping
      : mappingFromLinearConversation(payload.linear_conversation);

  if (!mapping || Object.keys(mapping).length === 0) {
    throw new AppError(
      "REMOTE_REQUEST_FAILED",
      `Shared conversation ${shareId} did not include a usable mapping or linear_conversation payload.`
    );
  }

  return {
    id: cacheId,
    conversation_id: cacheId,
    title: payload.title || "Untitled share",
    create_time: payload.create_time ?? null,
    update_time: payload.update_time ?? null,
    model: payload.model,
    gizmo_id: payload.gizmo_id,
    mapping,
    current_node: typeof payload.current_node === "string" ? payload.current_node : undefined,
    server_share_id: shareId,
    original_conversation_id: payload.conversation_id
  };
}

function mappingFromLinearConversation(
  linear: unknown[] | undefined
): Record<string, ChatgptMappingNode> | undefined {
  if (!Array.isArray(linear) || linear.length === 0) return undefined;

  // Already node-shaped: { id, message, parent, children }
  if (linear.every(isMappingNodeLike)) {
    const mapping: Record<string, ChatgptMappingNode> = {};
    for (const node of linear as ChatgptMappingNode[]) {
      const id = node.id;
      if (!id) continue;
      mapping[id] = {
        id,
        message: node.message ?? null,
        parent: node.parent ?? null,
        children: Array.isArray(node.children) ? node.children : []
      };
    }
    ensureRootLinks(mapping);
    return mapping;
  }

  // Message-shaped entries: build a linear parent/child chain.
  const messages = linear.filter(isMessageLike) as ChatgptMessage[];
  if (messages.length === 0) return undefined;

  const mapping: Record<string, ChatgptMappingNode> = {};
  const rootId = "client-created-root";
  mapping[rootId] = { id: rootId, message: null, parent: null, children: [] };

  let parentId = rootId;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    const id = message.id || `share-msg-${index}`;
    mapping[parentId].children = [...(mapping[parentId].children || []), id];
    mapping[id] = {
      id,
      message: { ...message, id },
      parent: parentId,
      children: []
    };
    parentId = id;
  }

  return mapping;
}

function isMappingNodeLike(value: unknown): value is ChatgptMappingNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;
  return typeof node.id === "string" && ("message" in node || "children" in node || "parent" in node);
}

function isMessageLike(value: unknown): value is ChatgptMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return "content" in message || "author" in message;
}

function ensureRootLinks(mapping: Record<string, ChatgptMappingNode>): void {
  const hasRoot = Object.values(mapping).some((node) => node.parent == null);
  if (hasRoot) return;

  const rootId = "client-created-root";
  const childIds = Object.keys(mapping).filter((id) => {
    const parent = mapping[id]?.parent;
    return !parent || !mapping[parent];
  });

  mapping[rootId] = {
    id: rootId,
    message: null,
    parent: null,
    children: childIds
  };

  for (const childId of childIds) {
    mapping[childId] = {
      ...mapping[childId],
      parent: rootId
    };
  }
}
