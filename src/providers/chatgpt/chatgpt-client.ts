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
