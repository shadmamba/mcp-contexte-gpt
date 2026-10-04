import { AppError } from "../../shared/errors.js";

const AUTH_NAMESPACE = "https://api.openai.com/auth";

export interface AuthPayload {
  exp?: number;
  [AUTH_NAMESPACE]?: {
    chatgpt_user_id?: string;
    user_id?: string;
    chatgpt_account_id?: string;
    chatgpt_plan_type?: string;
  };
  [key: string]: unknown;
}

export interface TokenInfo {
  token: string;
  payload: AuthPayload;
  expires_at?: string;
  expired: boolean;
  account_id?: string;
}

export function getBearerToken(env: NodeJS.ProcessEnv = process.env): string {
  const token = env.CHATGPT_BEARER_TOKEN?.trim();
  if (!token) {
    throw new AppError("AUTH_TOKEN_MISSING", "CHATGPT_BEARER_TOKEN is not set.");
  }
  return token;
}

export function parseJwtPayload(token: string): AuthPayload {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) {
    throw new AppError("AUTH_TOKEN_INVALID", "Bearer token is not a parseable JWT.");
  }

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as AuthPayload;
  } catch {
    throw new AppError("AUTH_TOKEN_INVALID", "Bearer token JWT payload could not be decoded.");
  }
}

export function getTokenExpiration(payload: AuthPayload): string | undefined {
  if (typeof payload.exp !== "number") return undefined;
  return new Date(payload.exp * 1000).toISOString();
}

export function isTokenExpired(payload: AuthPayload, now = Date.now()): boolean {
  if (typeof payload.exp !== "number") return false;
  return payload.exp * 1000 <= now;
}

export function extractAccountIdFromPayload(payload: AuthPayload): string | undefined {
  const auth = payload[AUTH_NAMESPACE];
  if (!auth) return undefined;
  const planType = auth.chatgpt_plan_type;
  if (planType !== "team" && planType !== "enterprise") return undefined;
  return auth.chatgpt_account_id;
}

export function resolveAccountId(payload: AuthPayload, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.CHATGPT_ACCOUNT_ID?.trim() || extractAccountIdFromPayload(payload);
}

export function getTokenInfo(env: NodeJS.ProcessEnv = process.env, now = Date.now()): TokenInfo {
  const token = getBearerToken(env);
  const payload = parseJwtPayload(token);
  const expired = isTokenExpired(payload, now);
  if (expired) {
    throw new AppError("AUTH_TOKEN_EXPIRED", "CHATGPT_BEARER_TOKEN is expired.");
  }

  return {
    token,
    payload,
    expires_at: getTokenExpiration(payload),
    expired,
    account_id: resolveAccountId(payload, env)
  };
}

export interface ApiHeaderExtras {
  projectId?: string;
  convOwnerId?: string;
}

export function createApiHeaders(
  token: string,
  accountId?: string,
  extras: ApiHeaderExtras = {}
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
  };

  if (accountId) {
    headers["chatgpt-account-id"] = accountId;
  }
  if (extras.projectId) {
    headers["chatgpt-project-id"] = extras.projectId;
  }
  if (extras.convOwnerId) {
    headers["chatgpt-conv-owner-id"] = extras.convOwnerId;
  }

  return headers;
}

