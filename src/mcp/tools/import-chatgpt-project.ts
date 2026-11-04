import { listProjectConversations, type ProjectConversationListItem } from "../../providers/chatgpt/chatgpt-client.js";
import type { ChatgptClientOptions } from "../../providers/chatgpt/chatgpt-client.js";
import { parseChatgptUrl } from "../../providers/chatgpt/url-parser.js";
import { AppError } from "../../shared/errors.js";
import { formatDate } from "../../shared/format-date.js";
import { importChatgptUrl, type ToolResult } from "./import-chatgpt-url.js";

export type ProjectImportMode = "import_all" | "list_only";
export type NotImportedReason = "list_only" | "import_limit" | "import_failed";

export interface ImportChatgptProjectInput {
  url: string;
  /** Default import_all. list_only returns the full inventory and imports nothing. */
  mode?: ProjectImportMode;
  /**
   * Import only these ids. The caller chose this subset: the other conversations
   * in the project are not listed and are not treated as missing.
   */
  conversation_ids?: string[];
  /**
   * Explicit cap. Never applied unless the caller sets it.
   * Conversations past the cap stay in not_imported with their titles.
   */
  max_imports?: number;
  /** Test seam. Production uses MAX_PROJECT_CONVERSATIONS inside the client. */
  listLimit?: number;
  cacheRoot?: string;
  clientOptions?: ChatgptClientOptions;
}

export interface ProjectConversationRef {
  conversation_id: string;
  title: string;
  source_url: string;
  create_time?: string;
  update_time?: string;
}

export interface ImportedProjectConversation extends ProjectConversationRef {
  cache: ToolResult["cache"];
}

export interface SkippedProjectConversation extends ProjectConversationRef {
  reason: NotImportedReason;
  message?: string;
}

export interface ImportChatgptProjectResult {
  project_id: string;
  project_url: string;
  /**
   * Present only for a whole-project import (no conversation_ids).
   * True only when every conversation the API reported was listed and imported.
   */
  covered?: boolean;
  /** False when the list itself stopped before the API said the project was exhausted. */
  list_complete: boolean;
  total: number | null;
  listed: number;
  imported_count: number;
  imported: ImportedProjectConversation[];
  not_imported: SkippedProjectConversation[];
  unknown_ids: string[];
  warning?: string;
}

export async function importChatgptProject(input: ImportChatgptProjectInput): Promise<ImportChatgptProjectResult> {
  const parsed = parseChatgptUrl(input.url);
  if (parsed.kind !== "project_index" || !parsed.projectId) {
    throw new AppError(
      "UNSUPPORTED_URL",
      "import_chatgpt_project expects a ChatGPT project home URL: /g/{project}/project."
    );
  }

  const listed = await listProjectConversations(parsed.projectId, {
    ...input.clientOptions,
    maxItems: input.listLimit
  });

  const inventory = listed.items.map((item) => toRef(parsed.sourceUrl, item));
  const mode = input.mode ?? "import_all";
  const explicitSelection = mode !== "list_only" && Boolean(input.conversation_ids?.length);
  const selected = selectForImport(inventory, input);
  const imported: ImportedProjectConversation[] = [];
  const notImported: SkippedProjectConversation[] = [];

  if (mode === "list_only") {
    notImported.push(...inventory.map((item) => ({ ...item, reason: "list_only" as const })));
  } else {
    const selectedIds = new Set(selected.map((item) => item.conversation_id));
    for (const item of inventory) {
      if (!selectedIds.has(item.conversation_id)) {
        if (!explicitSelection) {
          notImported.push({ ...item, reason: "import_limit" });
        }
        continue;
      }
      try {
        const stored = await importChatgptUrl({
          url: item.source_url,
          cacheRoot: input.cacheRoot,
          clientOptions: input.clientOptions,
          max_chars: 1
        });
        imported.push({ ...item, title: stored.title || item.title, cache: stored.cache });
      } catch (error) {
        if (error instanceof AppError && (error.error_code === "AUTH_FAILED" || error.error_code.startsWith("AUTH_TOKEN"))) {
          throw error;
        }
        notImported.push({
          ...item,
          reason: "import_failed",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  const unknownIds = (input.conversation_ids ?? []).filter(
    (id) => !inventory.some((item) => item.conversation_id === id)
  );
  const wholeProject = !explicitSelection;
  const covered = wholeProject && listed.complete && notImported.length === 0 && unknownIds.length === 0;
  const warning = coverageWarning({
    wholeProject,
    covered,
    listComplete: listed.complete,
    total: listed.total,
    listed: inventory.length,
    unknownIds
  });

  return {
    project_id: parsed.projectId,
    project_url: parsed.sourceUrl,
    ...(wholeProject ? { covered } : {}),
    list_complete: listed.complete,
    total: listed.total,
    listed: inventory.length,
    imported_count: imported.length,
    imported,
    not_imported: notImported,
    unknown_ids: unknownIds,
    warning
  };
}

function selectForImport(inventory: ProjectConversationRef[], input: ImportChatgptProjectInput): ProjectConversationRef[] {
  if (input.mode === "list_only") return [];
  if (input.conversation_ids) {
    const wanted = new Set(input.conversation_ids);
    return inventory.filter((item) => wanted.has(item.conversation_id));
  }
  if (input.max_imports && input.max_imports > 0) return inventory.slice(0, input.max_imports);
  return inventory;
}

function toRef(projectUrl: string, item: ProjectConversationListItem): ProjectConversationRef {
  return {
    conversation_id: item.id,
    title: item.title,
    source_url: projectConversationUrl(projectUrl, item.id),
    create_time: formatDate(item.create_time),
    update_time: formatDate(item.update_time)
  };
}

export function projectConversationUrl(projectUrl: string, conversationId: string): string {
  const url = new URL(projectUrl);
  url.pathname = url.pathname.replace(/\/project\/?$/, `/c/${encodeURIComponent(conversationId)}`);
  url.search = "";
  return url.toString();
}

function coverageWarning(input: {
  wholeProject: boolean;
  covered: boolean;
  listComplete: boolean;
  total: number | null;
  listed: number;
  unknownIds: string[];
}): string | undefined {
  if (!input.wholeProject) {
    if (input.unknownIds.length === 0) return undefined;
    return `These conversation ids are not in the project list: ${input.unknownIds.join(", ")}.`;
  }
  if (input.covered) return undefined;
  if (!input.listComplete) {
    const total = input.total === null ? "an unknown total" : String(input.total);
    return `Project list is incomplete (${input.listed} listed of ${total}). Conversations beyond this list were not named and were not imported. Do not treat the project as fully covered.`;
  }
  return "Some listed conversations were not imported. See not_imported. Do not answer as if the whole project were covered.";
}
