/** Accepts ChatGPT unix timestamps in seconds or ISO strings. */
export function formatDate(timestamp: number | string | null | undefined): string | undefined {
  if (timestamp === null || timestamp === undefined) return undefined;
  const date = typeof timestamp === "number" ? new Date(timestamp * 1000) : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}
