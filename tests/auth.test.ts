import { describe, expect, it } from "vitest";
import { AppError } from "../src/shared/errors.js";
import {
  createApiHeaders,
  extractAccountIdFromPayload,
  getBearerToken,
  getTokenExpiration,
  getTokenInfo,
  isTokenExpired,
  parseJwtPayload,
  resolveAccountId
} from "../src/providers/chatgpt/auth.js";

const AUTH_NAMESPACE = "https://api.openai.com/auth";

function makeJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}

describe("auth helpers", () => {
  it("requires CHATGPT_BEARER_TOKEN", () => {
    expect(() => getBearerToken({})).toThrow(AppError);
    expect(() => getBearerToken({})).toThrow(/CHATGPT_BEARER_TOKEN/);
  });

  it("parses JWT payload and expiration", () => {
    const token = makeJwt({ exp: 1893456000 });
    const payload = parseJwtPayload(token);
    expect(payload.exp).toBe(1893456000);
    expect(getTokenExpiration(payload)).toBe("2030-01-01T00:00:00.000Z");
  });

  it("detects expired tokens", () => {
    expect(isTokenExpired({ exp: 100 }, 101_000)).toBe(true);
    expect(isTokenExpired({ exp: 100 }, 99_000)).toBe(false);
  });

  it("extracts team account id from the auth namespace", () => {
    const payload = {
      [AUTH_NAMESPACE]: {
        chatgpt_plan_type: "team",
        chatgpt_account_id: "account-123"
      }
    };
    expect(extractAccountIdFromPayload(payload)).toBe("account-123");
  });

  it("prefers CHATGPT_ACCOUNT_ID over token account id", () => {
    const payload = {
      [AUTH_NAMESPACE]: {
        chatgpt_plan_type: "enterprise",
        chatgpt_account_id: "account-from-token"
      }
    };
    expect(resolveAccountId(payload, { CHATGPT_ACCOUNT_ID: "account-from-env" })).toBe("account-from-env");
  });

  it("throws on expired token when building token info", () => {
    const token = makeJwt({ exp: 100 });
    expect(() => getTokenInfo({ CHATGPT_BEARER_TOKEN: token }, 101_000)).toThrow(/expired/);
  });

  it("creates API headers without account id unless provided", () => {
    expect(createApiHeaders("token").Authorization).toBe("Bearer token");
    expect(createApiHeaders("token")["chatgpt-account-id"]).toBeUndefined();
    expect(createApiHeaders("token", "account-123")["chatgpt-account-id"]).toBe("account-123");
    expect(createApiHeaders("token", "account-123", { projectId: "g-p-abc", convOwnerId: "user-1" })).toMatchObject({
      "chatgpt-account-id": "account-123",
      "chatgpt-project-id": "g-p-abc",
      "chatgpt-conv-owner-id": "user-1"
    });
  });
});

