import type { ChatgptConversation } from "./types.js";
import { createApiHeaders, getTokenInfo } from "./auth.js";
import { AppError } from "../../shared/errors.js";
import { normalizeSharedConversation, type SharedConversationPayload } from "./shared-conversation.js";

const API_BASE = "https://chatgpt.com/backend-api";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

export interface ChatgptClientOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

export async function fetchPrivateConversation(
  conversationId: string,
  options: ChatgptClientOptions = {}
): Promise<ChatgptConversation> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokenInfo = getTokenInfo(env);
  const response = await fetchImpl(`${API_BASE}/conversation/${encodeURIComponent(conversationId)}`, {
    headers: createApiHeaders(tokenInfo.token, tokenInfo.account_id)
  });

  if (response.status === 401 || response.status === 403) {
    throw new AppError("AUTH_FAILED", `ChatGPT authentication failed (${response.status}). Refresh CHATGPT_BEARER_TOKEN.`);
  }
  if (response.status === 404) {
    throw new AppError(
      "CONVERSATION_NOT_FOUND_OR_FORBIDDEN",
      `Conversation ${conversationId} was not found or is not accessible with the current token.`
    );
  }
  if (!response.ok) {
    throw new AppError("REMOTE_REQUEST_FAILED", `ChatGPT request failed (${response.status} ${response.statusText}).`);
  }

  return response.json() as Promise<ChatgptConversation>;
}

export async function fetchSharedConversation(
  shareId: string,
  options: ChatgptClientOptions = {}
): Promise<ChatgptConversation> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const cacheId = `share-${shareId}`;
  const response = await fetchImpl(`${API_BASE}/share/${encodeURIComponent(shareId)}`, {
    headers: createShareHeaders(env)
  });

  if (response.status === 404) {
    throw new AppError(
      "CONVERSATION_NOT_FOUND_OR_FORBIDDEN",
      `Shared conversation ${shareId} was not found or is no longer available.`
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new AppError(
      "AUTH_FAILED",
      `ChatGPT rejected the shared conversation request (${response.status}). The share may be restricted.`
    );
  }
  if (!response.ok) {
    throw new AppError(
      "REMOTE_REQUEST_FAILED",
      `ChatGPT share request failed (${response.status} ${response.statusText}).`
    );
  }

  const payload = (await response.json()) as SharedConversationPayload;
  return normalizeSharedConversation(payload, shareId, cacheId);
}

export interface ProjectConversationRef {
  conversationId: string;
  projectId: string;
  ownerUserId?: string;
  sourceUrl?: string;
}

interface ProjectFetchAttempt {
  path: string;
  query?: string;
}

const PROJECT_FETCH_ATTEMPTS: ProjectFetchAttempt[] = [
  { path: "conversations", query: "include_has_versions=true&num_turns=10" },
  { path: "conversation" },
  { path: "conversations", query: "include_has_versions=true&num_turns=50" },
  { path: "conversations", query: "include_has_versions=true" }
];

export async function fetchProjectConversation(
  ref: ProjectConversationRef,
  options: ChatgptClientOptions = {}
): Promise<ChatgptConversation> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokenInfo = getTokenInfo(env);
  const headers = createProjectConversationHeaders(tokenInfo.token, tokenInfo.account_id, ref);

  let lastError: AppError | undefined;
  let lastConversation: ChatgptConversation | undefined;

  for (const attempt of PROJECT_FETCH_ATTEMPTS) {
    const url =
      `${API_BASE}/${attempt.path}/${encodeURIComponent(ref.conversationId)}` +
      (attempt.query ? `?${attempt.query}` : "");
    const response = await fetchImpl(url, { headers });

    if (response.status === 401 || response.status === 403) {
      throw new AppError(
        "AUTH_FAILED",
        `ChatGPT rejected the project conversation request (${response.status}). Confirm the token, chatgpt-account-id, project access, and owner_user_id.`
      );
    }
    if (response.status === 404) {
      lastError = new AppError(
        "CONVERSATION_NOT_FOUND_OR_FORBIDDEN",
        `Project conversation ${ref.conversationId} was not found or is not accessible with the current token.`
      );
      continue;
    }
    if (!response.ok) {
      const detail = await safeResponseDetail(response);
      lastError = new AppError(
        "REMOTE_REQUEST_FAILED",
        `ChatGPT project conversation request failed (${response.status} ${response.statusText}${detail}).`
      );
      continue;
    }

    const payload = (await response.json()) as SharedConversationPayload;
    try {
      const conversation = normalizeSharedConversation(payload, ref.conversationId, ref.conversationId);
      lastConversation = conversation;
      if (!isProjectPayloadTruncated(payload, conversation.mapping)) {
        return conversation;
      }
    } catch (error) {
      if (error instanceof AppError) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  if (lastConversation) return lastConversation;
  throw (
    lastError ??
    new AppError(
      "REMOTE_REQUEST_FAILED",
      `Project conversation ${ref.conversationId} did not return a usable payload.`
    )
  );
}

function createProjectConversationHeaders(
  token: string,
  accountId: string | undefined,
  ref: ProjectConversationRef
): Record<string, string> {
  const referer =
    ref.sourceUrl ||
    `https://chatgpt.com/g/${ref.projectId}/shared/c/${ref.conversationId}` +
      (ref.ownerUserId ? `?owner_user_id=${encodeURIComponent(ref.ownerUserId)}` : "");
  const targetPath = `/backend-api/conversations/${ref.conversationId}`;
  const headers: Record<string, string> = {
    Accept: "*/*",
    Authorization: `Bearer ${token}`,
    "User-Agent": BROWSER_UA,
    Origin: "https://chatgpt.com",
    Referer: referer,
    "chatgpt-project-id": ref.projectId,
    "x-openai-target-path": targetPath,
    "x-openai-target-route": "/backend-api/conversations/{conversation_id}"
  };
  if (accountId) headers["chatgpt-account-id"] = accountId;
  if (ref.ownerUserId) headers["chatgpt-conv-owner-id"] = ref.ownerUserId;
  return headers;
}

async function safeResponseDetail(response: Response): Promise<string> {
  try {
    const text = (await response.text()).replace(/\s+/g, " ").trim();
    if (!text) return "";
    const clipped = text.slice(0, 180);
    return `; ${clipped}`;
  } catch {
    return "";
  }
}

function isProjectPayloadTruncated(
  payload: SharedConversationPayload,
  mapping: ChatgptConversation["mapping"]
): boolean {
  if (payload.has_more === true) return true;
  if (!mapping || Object.keys(mapping).length === 0) return true;
  const ids = new Set(Object.keys(mapping));
  return Object.values(mapping).some((node) => typeof node.parent === "string" && node.parent.length > 0 && !ids.has(node.parent));
}

function createShareHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const token = env.CHATGPT_BEARER_TOKEN?.trim();
  if (!token) {
    return {
      Accept: "application/json",
      "User-Agent": BROWSER_UA
    };
  }

  try {
    const tokenInfo = getTokenInfo(env);
    return createApiHeaders(tokenInfo.token, tokenInfo.account_id);
  } catch {
    // Public shares should still work if a local token is missing/expired.
    return {
      Accept: "application/json",
      "User-Agent": BROWSER_UA
    };
  }
}

export const PROJECT_CONVERSATION_PAGE_SIZE = 50;
/** Safety stop for one project list. Hitting it marks the result incomplete and names only the conversations already listed. */
export const MAX_PROJECT_CONVERSATIONS = 500;

export interface ProjectConversationListItem {
  id: string;
  title: string;
  create_time?: number | string | null;
  update_time?: number | string | null;
}

export interface ProjectConversationList {
  items: ProjectConversationListItem[];
  /** False when the API reported more conversations than were listed, or the safety stop was reached. */
  complete: boolean;
  total: number | null;
}

export async function listProjectConversations(
  projectId: string,
  options: ChatgptClientOptions & { pageSize?: number; maxItems?: number } = {}
): Promise<ProjectConversationList> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokenInfo = getTokenInfo(env);
  const headers = createApiHeaders(tokenInfo.token, tokenInfo.account_id, { projectId });
  const pageSize = options.pageSize && options.pageSize > 0 ? options.pageSize : PROJECT_CONVERSATION_PAGE_SIZE;
  const maxItems = options.maxItems && options.maxItems > 0 ? options.maxItems : MAX_PROJECT_CONVERSATIONS;

  const items: ProjectConversationListItem[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  let total: number | null = null;
  let complete = true;

  while (items.length < maxItems) {
    const url =
      `${API_BASE}/gizmos/${encodeURIComponent(projectId)}/conversations` +
      `?cursor=${cursor}&limit=${pageSize}`;
    const response = await fetchImpl(url, { headers });
    if (response.status === 401 || response.status === 403) {
      throw new AppError(
        "AUTH_FAILED",
        `ChatGPT rejected the project conversation list (${response.status}). Confirm the token, chatgpt-account-id, and project access.`
      );
    }
    if (!response.ok) {
      throw new AppError(
        "REMOTE_REQUEST_FAILED",
        `ChatGPT project conversation list failed (${response.status} ${response.statusText}).`
      );
    }

    const payload = (await response.json()) as { items?: unknown; total?: unknown };
    const page = Array.isArray(payload.items) ? payload.items : [];
    if (typeof payload.total === "number") total = payload.total;

    for (const entry of page) {
      const item = normalizeProjectListItem(entry);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
      if (items.length >= maxItems) break;
    }

    const reachedTotal = total !== null && cursor + pageSize >= total;
    const shortPage = page.length < pageSize;
    if (page.length === 0 || shortPage || reachedTotal) break;
    if (items.length >= maxItems) {
      complete = total !== null && items.length >= total;
      break;
    }
    cursor += pageSize;
  }

  if (total !== null && items.length < total) complete = false;
  return { items, complete, total };
}

function normalizeProjectListItem(value: unknown): ProjectConversationListItem | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : typeof row.conversation_id === "string" ? row.conversation_id : undefined;
  if (!id) return undefined;
  const title = typeof row.title === "string" && row.title.trim() ? row.title : "Untitled";
  return {
    id,
    title,
    create_time: timeField(row.create_time),
    update_time: timeField(row.update_time)
  };
}

function timeField(value: unknown): number | string | null | undefined {
  if (typeof value === "number" || typeof value === "string" || value === null) return value;
  return undefined;
}

export async function verifyBackendAccess(options: ChatgptClientOptions = {}): Promise<boolean> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokenInfo = getTokenInfo(env);
  const response = await fetchImpl(`${API_BASE}/conversations?limit=1&offset=0&order=updated`, {
    headers: createApiHeaders(tokenInfo.token, tokenInfo.account_id)
  });
  if (response.status === 401 || response.status === 403) {
    throw new AppError("AUTH_FAILED", `ChatGPT authentication failed (${response.status}). Refresh CHATGPT_BEARER_TOKEN.`);
  }
  return response.ok;
}
