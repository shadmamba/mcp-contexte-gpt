import { AppError } from "../../shared/errors.js";

export interface ParsedChatgptUrl {
  kind: "private" | "share" | "project";
  /** Conversation id for /c/ and /g/.../c/, or share id for /share/. */
  id: string;
  /** Stable cache key. Shares use `share-{id}` (Windows-safe). */
  cacheId: string;
  sourceUrl: string;
  projectId?: string;
  ownerUserId?: string;
}

const SUPPORTED_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);

export function parseChatgptUrl(input: string): ParsedChatgptUrl {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new AppError("UNSUPPORTED_URL", "URL must be a valid ChatGPT conversation or share URL.");
  }

  if (!SUPPORTED_HOSTS.has(parsed.hostname)) {
    throw new AppError(
      "UNSUPPORTED_URL",
      "Only chatgpt.com and chat.openai.com conversation or share URLs are supported."
    );
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length >= 2 && segments[0] === "c") {
    const conversationId = segments[1];
    if (!conversationId) {
      throw new AppError("UNSUPPORTED_URL", "ChatGPT conversation URL is missing a conversation id.");
    }
    return {
      kind: "private",
      id: conversationId,
      cacheId: conversationId,
      sourceUrl: `${parsed.origin}/c/${conversationId}`
    };
  }

  if (segments.length >= 2 && segments[0] === "share") {
    // Support /share/{id} and /share/e/{id}
    const shareId = segments[1] === "e" ? segments[2] : segments[1];
    if (!shareId) {
      throw new AppError("UNSUPPORTED_URL", "ChatGPT share URL is missing a share id.");
    }
    return {
      kind: "share",
      id: shareId,
      cacheId: `share-${shareId}`,
      sourceUrl: `${parsed.origin}/share/${shareId}`
    };
  }

  const project = parseProjectConversationPath(parsed.origin, segments, parsed.searchParams);
  if (project) return project;

  throw new AppError(
    "UNSUPPORTED_URL",
    "Only ChatGPT /c/{conversation_id}, /share/{share_id}, /share/e/{share_id}, /g/{project}/c/{conversation_id}, or /g/{project}/shared/c/{conversation_id}?owner_user_id={owner} URLs are supported."
  );
}

export function extractProjectId(slug: string): string | undefined {
  const compact = slug.match(/^(g-p-[0-9a-fA-F]{32})(?:-|$)/);
  if (compact?.[1]) return compact[1];
  const dashed = slug.match(
    /^(g-p-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:-|$)/
  );
  if (dashed?.[1]) return dashed[1];
  return undefined;
}

function parseProjectConversationPath(
  origin: string,
  segments: string[],
  searchParams: URLSearchParams
): ParsedChatgptUrl | undefined {
  if (segments[0] !== "g" || !segments[1]) return undefined;

  let conversationId: string | undefined;
  let shared = false;
  if (segments.length >= 5 && segments[2] === "shared" && segments[3] === "c") {
    conversationId = segments[4];
    shared = true;
  } else if (segments.length >= 4 && segments[2] === "c") {
    conversationId = segments[3];
  } else {
    return undefined;
  }

  if (!conversationId) {
    throw new AppError("UNSUPPORTED_URL", "ChatGPT project URL is missing a conversation id.");
  }

  const projectId = extractProjectId(segments[1]);
  if (!projectId) {
    throw new AppError("UNSUPPORTED_URL", "ChatGPT project URL is missing a recognizable project id.");
  }

  const ownerUserId = searchParams.get("owner_user_id")?.trim() || undefined;
  if (shared && !ownerUserId) {
    throw new AppError(
      "UNSUPPORTED_URL",
      "Project shared conversation URLs require owner_user_id in the query string."
    );
  }

  const pathKind = shared ? "shared/c" : "c";
  const query = ownerUserId ? `?owner_user_id=${encodeURIComponent(ownerUserId)}` : "";
  return {
    kind: "project",
    id: conversationId,
    cacheId: conversationId,
    sourceUrl: `${origin}/g/${segments[1]}/${pathKind}/${conversationId}${query}`,
    projectId,
    ownerUserId
  };
}
