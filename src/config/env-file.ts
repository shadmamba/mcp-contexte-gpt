import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const ENV_FILE_KEYS = ["CHATGPT_BEARER_TOKEN", "CHATGPT_ACCOUNT_ID", "MCP_CONTEXTE_GPT_CACHE_DIR"] as const;

export type EnvFileKey = (typeof ENV_FILE_KEYS)[number];

export function getEnvFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.MCP_CONTEXTE_GPT_ENV_FILE?.trim() || path.join(os.homedir(), ".config", "mcp-contexte-gpt", "env");
}

/** Fills missing variables from the fallback env file, if it exists. Returns the file path that was read. */
export function loadEnvFile(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const filePath = getEnvFilePath(env);
  if (!fs.existsSync(filePath)) return undefined;
  applyEnvFile(env, parseEnvFile(fs.readFileSync(filePath, "utf8")));
  return filePath;
}

/** Accepts `KEY=value`, `export KEY=value`, and single- or double-quoted values. */
export function parseEnvFile(text: string): Partial<Record<EnvFileKey, string>> {
  const values: Partial<Record<EnvFileKey, string>> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!(ENV_FILE_KEYS as readonly string[]).includes(key)) continue;
    values[key as EnvFileKey] = unquote(line.slice(eq + 1).trim());
  }
  return values;
}

/** Process environment wins over env file values; empty process values do not. */
export function applyEnvFile(env: NodeJS.ProcessEnv, fileValues: Partial<Record<EnvFileKey, string>>): void {
  for (const key of ENV_FILE_KEYS) {
    const fileValue = fileValues[key];
    if (fileValue !== undefined && !env[key]) env[key] = fileValue;
  }
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && value.endsWith(first)) return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, "");
}
