// When youtube_pull_queue has no pending rows, add the next searches.
// Page follows use the saved next_page_token. Finished first-page
// queries also get order:date and order:viewCount. Keywords come from
// channels that passed the market filter, have no brand flag, and have
// a positive recent-view average. Existing kind+value+page rows are skipped.

import type { QueueKind, QueueStatus } from "./store";

export const REFILL_PAGE_LIMIT = 10;
export const REFILL_KEYWORD_LIMIT = 20;
export const REFILL_CHANNEL_SAMPLE = 40;
/** Ranked pool the 40-channel window rotates through. */
export const REFILL_CHANNEL_POOL = 200;

/** Slide a fixed window through a ranked pool so later refills see new channels. */
export function rotateHighScoringSample<T>(pool: readonly T[], cursor: number, size: number): T[] {
  if (size <= 0 || pool.length === 0) return [];
  if (pool.length <= size) return [...pool];
  const windows = Math.ceil(pool.length / size);
  const index = ((cursor % windows) + windows) % windows;
  const start = index * size;
  return pool.slice(start, start + size);
}

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "for",
  "to",
  "in",
  "on",
  "with",
  "your",
  "you",
  "my",
  "our",
  "from",
  "at",
  "by",
  "how",
  "what",
  "why",
  "this",
  "that",
  "it",
  "is",
  "are",
  "be",
  "video",
  "videos",
  "channel",
  "youtube",
  "subscribe",
  "official",
  "podcast",
  "show",
]);

export interface RefillQueueRow {
  kind: QueueKind;
  value: string;
  status: QueueStatus;
  page_token: string;
  next_page_token: string | null;
}

export interface RefillChannel {
  keywords: string[];
  niche_tags: string[];
  topic_categories: string[];
  avg_recent_views: number | null;
  passed_market_filter: boolean;
  brand_flag: string | null;
}

export interface PlannedQueueItem {
  kind: "category_query";
  value: string;
  page_token: string;
}

export function normalizeSearchPhrase(raw: string): string | null {
  const text = raw
    .replace(/&/g, " and ")
    .replace(/[_/|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!text || text.length < 3 || text.length > 80) return null;
  if (text.includes("@") || text.includes("http")) return null;
  const words = text.split(" ");
  if (words.length > 6) return null;
  if (words.length === 1 && (words[0].length < 4 || STOPWORDS.has(words[0]))) return null;
  if (words.every((word) => STOPWORDS.has(word))) return null;
  if (!/[a-z]/.test(text)) return null;
  return text;
}

function queueKey(kind: string, value: string, pageToken: string): string {
  return `${kind}\0${value.toLowerCase()}\0${pageToken}`;
}

function highScoring(channel: RefillChannel): boolean {
  return Boolean(
    channel.passed_market_filter &&
      !channel.brand_flag &&
      channel.avg_recent_views != null &&
      channel.avg_recent_views > 0
  );
}

export function planQueueRefill(input: {
  queue: RefillQueueRow[];
  channels: RefillChannel[];
}): { items: PlannedQueueItem[]; pages: number; keywords: number } {
  const existing = new Set(input.queue.map((row) => queueKey(row.kind, row.value, row.page_token ?? "")));
  const items: PlannedQueueItem[] = [];
  let pages = 0;

  for (const row of input.queue) {
    if (pages >= REFILL_PAGE_LIMIT) break;
    if (row.kind !== "category_query" || row.status !== "done") continue;
    const candidates: string[] = [];
    const next = row.next_page_token?.trim() ?? "";
    if (next && next !== row.page_token && next.length <= 2000) candidates.push(next);
    if ((row.page_token ?? "") === "") {
      candidates.push("order:date", "order:viewCount");
    }
    for (const pageToken of candidates) {
      if (pages >= REFILL_PAGE_LIMIT) break;
      const key = queueKey(row.kind, row.value, pageToken);
      if (existing.has(key)) continue;
      existing.add(key);
      items.push({ kind: "category_query", value: row.value, page_token: pageToken });
      pages += 1;
    }
  }

  const counts = new Map<string, number>();
  for (const channel of input.channels) {
    if (!highScoring(channel)) continue;
    const seenOnChannel = new Set<string>();
    const raw = [...channel.keywords, ...channel.niche_tags, ...channel.topic_categories];
    for (const phrase of raw) {
      const normalized = normalizeSearchPhrase(phrase);
      if (!normalized || seenOnChannel.has(normalized)) continue;
      seenOnChannel.add(normalized);
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  let keywords = 0;
  for (const [phrase] of ranked) {
    if (keywords >= REFILL_KEYWORD_LIMIT) break;
    const key = queueKey("category_query", phrase, "");
    if (existing.has(key)) continue;
    existing.add(key);
    items.push({ kind: "category_query", value: phrase, page_token: "" });
    keywords += 1;
  }

  return { items, pages, keywords };
}

export async function refillYoutubeQueue(
  store: {
    pendingQueue(): Promise<RefillQueueRow[]>;
    listQueue(): Promise<RefillQueueRow[]>;
    listHighScoringChannels(limit: number): Promise<RefillChannel[]>;
    enqueue(items: PlannedQueueItem[]): Promise<number>;
  },
  log: (line: string) => void = () => {}
): Promise<{ added: number; pages: number; keywords: number }> {
  const pending = await store.pendingQueue();
  if (pending.length > 0) return { added: 0, pages: 0, keywords: 0 };
  const queue = await store.listQueue();
  const pool = await store.listHighScoringChannels(REFILL_CHANNEL_POOL);
  const channels = rotateHighScoringSample(pool, queue.length, REFILL_CHANNEL_SAMPLE);
  const planned = planQueueRefill({ queue, channels });
  if (planned.items.length === 0) {
    log("[youtube-library] refill added=0 pages=0 keywords=0");
    return { added: 0, pages: 0, keywords: 0 };
  }
  const added = await store.enqueue(planned.items);
  log(`[youtube-library] refill added=${added} pages=${planned.pages} keywords=${planned.keywords}`);
  return { added, pages: planned.pages, keywords: planned.keywords };
}
