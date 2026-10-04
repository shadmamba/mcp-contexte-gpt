import {
  extractAccountIdFromPayload,
  getBearerToken,
  getTokenExpiration,
  isTokenExpired,
  parseJwtPayload
} from "../../providers/chatgpt/auth.js";
import { verifyBackendAccess, type ChatgptClientOptions } from "../../providers/chatgpt/chatgpt-client.js";
import { AppError } from "../../shared/errors.js";

export interface VerifyChatgptAuthInput {
  env?: NodeJS.ProcessEnv;
  clientOptions?: ChatgptClientOptions;
  now?: number;
}

export async function verifyChatgptAuth(input: VerifyChatgptAuthInput = {}) {
  const env = input.env ?? process.env;
  try {
    const token = getBearerToken(env);
    const payload = parseJwtPayload(token);
    const expired = isTokenExpired(payload, input.now);
    if (expired) {
      return {
        has_token: true,
        token_expired: true,
        expires_at: getTokenExpiration(payload),
        account_id_detected: Boolean(env.CHATGPT_ACCOUNT_ID || extractAccountIdFromPayload(payload)),
        api_accessible: false,
        error_code: "AUTH_TOKEN_EXPIRED",
        message: "CHATGPT_BEARER_TOKEN is expired."
      };
    }

    const apiAccessible = await verifyBackendAccess({ ...input.clientOptions, env });
    return {
      has_token: true,
      token_expired: false,
      expires_at: getTokenExpiration(payload),
      account_id_detected: Boolean(env.CHATGPT_ACCOUNT_ID || extractAccountIdFromPayload(payload)),
      api_accessible: apiAccessible
    };
  } catch (error) {
    if (error instanceof AppError) {
      return {
        has_token: error.error_code !== "AUTH_TOKEN_MISSING",
        token_expired: error.error_code === "AUTH_TOKEN_EXPIRED" ? true : null,
        account_id_detected: false,
        api_accessible: false,
        error_code: error.error_code,
        message: error.message
      };
    }
    return {
      has_token: false,
      token_expired: null,
      account_id_detected: false,
      api_accessible: false,
      error_code: "REMOTE_REQUEST_FAILED",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

