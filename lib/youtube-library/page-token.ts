// Queue page tokens. An empty token is the first relevance search.
// order:date and order:viewCount repeat a finished query in another
// order. page: prefixes a YouTube nextPageToken so it cannot be read
// as an order variant. Tokens are stored, not logged.

export type LibrarySearchOrder = "relevance" | "date" | "viewCount";

const ORDER_DATE = "order:date";
const ORDER_VIEWS = "order:viewCount";
const PAGE_PREFIX = "page:";
const MAX_TOKEN_LENGTH = 1800;

export function decodeLibrarySearchPage(pageToken: string | null | undefined): {
  order: LibrarySearchOrder;
  pageToken?: string;
} {
  const token = pageToken?.trim() ?? "";
  if (!token) return { order: "relevance" };
  if (token === ORDER_DATE) return { order: "date" };
  if (token === ORDER_VIEWS) return { order: "viewCount" };
  if (token.startsWith(PAGE_PREFIX)) {
    const raw = token.slice(PAGE_PREFIX.length).trim();
    if (!raw) return { order: "relevance" };
    return { order: "relevance", pageToken: raw };
  }
  if (token.startsWith("order:")) return { order: "relevance" };
  return { order: "relevance", pageToken: token };
}

/** Wrap a YouTube nextPageToken for youtube_pull_queue.page_token. */
export function encodeNextPageToken(apiToken: string | null | undefined): string | null {
  const token = apiToken?.trim() ?? "";
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  if (token.startsWith("order:")) return null;
  return `${PAGE_PREFIX}${token}`;
}

export function isOrderVariant(pageToken: string | null | undefined): boolean {
  const token = pageToken?.trim() ?? "";
  return token === ORDER_DATE || token === ORDER_VIEWS;
}
