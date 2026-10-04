import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyEnvFile, getEnvFilePath, loadEnvFile, parseEnvFile } from "../src/config/env-file.js";

describe("parseEnvFile", () => {
  it("accepts the export + double-quote format documented in the README", () => {
    const text = ['export CHATGPT_BEARER_TOKEN="token-value"', 'export CHATGPT_ACCOUNT_ID=""'].join("\n");
    expect(parseEnvFile(text)).toEqual({ CHATGPT_BEARER_TOKEN: "token-value", CHATGPT_ACCOUNT_ID: "" });
  });

  it("ignores a UTF-8 BOM written by Windows PowerShell Set-Content", () => {
    expect(parseEnvFile('\uFEFFexport CHATGPT_BEARER_TOKEN="token-value"')).toEqual({ CHATGPT_BEARER_TOKEN: "token-value" });
  });

  it("accepts plain, single-quoted, and CRLF lines and ignores comments and unknown keys", () => {
    const text = [
      "# comment",
      "CHATGPT_BEARER_TOKEN=plain # trailing comment",
      "MCP_CONTEXTE_GPT_CACHE_DIR='C:\\cache dir'",
      "OTHER_SECRET=ignored",
      ""
    ].join("\r\n");
    expect(parseEnvFile(text)).toEqual({
      CHATGPT_BEARER_TOKEN: "plain",
      MCP_CONTEXTE_GPT_CACHE_DIR: "C:\\cache dir"
    });
  });
});

describe("applyEnvFile", () => {
  it("keeps non-empty process values and fills missing or empty ones from the file", () => {
    const env: NodeJS.ProcessEnv = { CHATGPT_BEARER_TOKEN: "from-process", CHATGPT_ACCOUNT_ID: "" };
    applyEnvFile(env, {
      CHATGPT_BEARER_TOKEN: "from-file",
      CHATGPT_ACCOUNT_ID: "account-from-file",
      MCP_CONTEXTE_GPT_CACHE_DIR: "/tmp/cache"
    });
    expect(env).toEqual({
      CHATGPT_BEARER_TOKEN: "from-process",
      CHATGPT_ACCOUNT_ID: "account-from-file",
      MCP_CONTEXTE_GPT_CACHE_DIR: "/tmp/cache"
    });
  });
});

describe("loadEnvFile", () => {
  it("defaults to ~/.config/mcp-contexte-gpt/env", () => {
    expect(getEnvFilePath({})).toBe(path.join(os.homedir(), ".config", "mcp-contexte-gpt", "env"));
  });

  it("reads the file pointed to by MCP_CONTEXTE_GPT_ENV_FILE", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-contexte-gpt-env-"));
    const filePath = path.join(dir, "env");
    await fs.writeFile(filePath, 'export CHATGPT_BEARER_TOKEN="token-from-file"\n');
    try {
      const env: NodeJS.ProcessEnv = { MCP_CONTEXTE_GPT_ENV_FILE: filePath };
      expect(loadEnvFile(env)).toBe(filePath);
      expect(env.CHATGPT_BEARER_TOKEN).toBe("token-from-file");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("does nothing when the file does not exist", () => {
    const env: NodeJS.ProcessEnv = { MCP_CONTEXTE_GPT_ENV_FILE: path.join(os.tmpdir(), "missing-mcp-contexte-gpt-env") };
    expect(loadEnvFile(env)).toBeUndefined();
    expect(env.CHATGPT_BEARER_TOKEN).toBeUndefined();
  });
});
