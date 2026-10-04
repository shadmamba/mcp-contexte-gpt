import { searchCacheIndex } from "../../storage/cache-index.js";

export interface ListChatgptImportsInput {
  query?: string;
  limit?: number;
  cacheRoot?: string;
}

export async function listChatgptImports(input: ListChatgptImportsInput = {}) {
  return {
    items: await searchCacheIndex({ query: input.query, limit: input.limit, cacheRoot: input.cacheRoot })
  };
}

