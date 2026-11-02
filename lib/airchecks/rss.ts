// Minimal RSS 2.0 item parse. IO lines identify an episode by episode_url;
// the show's rss_url is the feed that carries the enclosure. No feed SDK.

export interface RssItem {
  link: string | null;
  guid: string | null;
  enclosureUrl: string | null;
  pubDate: string | null;
  /** itunes:duration in seconds, when the item includes one. */
  durationSeconds: number | null;
}

const AUDIO_EXT = /\.(mp3|m4a|mp4|m4v|wav|aac|ogg|oga|opus|flac)(?:$|[?#])/i;

/** Stop parsing a feed that is larger than the download cap. */
export const MAX_RSS_CHARS = 5_000_000;
/** One page of a show feed. A catalog-sized document is not returned whole. */
export const MAX_RSS_ITEMS = 200;
/** Keep scanning past the page so an older in-window episode can still match. */
export const MAX_RSS_SCAN_ITEMS = 5000;
/** An item larger than this is skipped instead of scanned. */
export const MAX_ITEM_CHARS = 100_000;

export function looksLikeAudioUrl(value: string): boolean {
  try {
    return AUDIO_EXT.test(new URL(value).pathname);
  } catch {
    return AUDIO_EXT.test(value);
  }
}

function decodeXml(raw: string): string {
  const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  const text = cdata ? cdata[1] : raw;
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
}

/** Seconds from itunes:duration. Accepts raw seconds, MM:SS, or HH:MM:SS. */
export function parseItunesDuration(raw: string | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? Math.round(seconds) : null;
  }
  const parts = trimmed.split(":").map((part) => Number(part));
  if (parts.length < 2 || parts.length > 3) return null;
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  if (parts.length === 2) return Math.round(parts[0] * 60 + parts[1]);
  return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
}

function startsTag(block: string, index: number, tag: string): boolean {
  const next = block[index + tag.length + 1];
  return next === ">" || next === " " || next === "/" || next === "\t" || next === "\n" || next === "\r";
}

function tagText(block: string, tag: string): string | null {
  const lower = block.toLowerCase();
  const open = `<${tag.toLowerCase()}`;
  const close = `</${tag.toLowerCase()}>`;
  let from = 0;
  while (from < lower.length) {
    const start = lower.indexOf(open, from);
    if (start < 0) return null;
    if (!startsTag(block, start, tag)) {
      from = start + open.length;
      continue;
    }
    const gt = block.indexOf(">", start);
    if (gt < 0) return null;
    const end = lower.indexOf(close, gt + 1);
    if (end < 0) return null;
    const text = decodeXml(block.slice(gt + 1, end));
    return text || null;
  }
  return null;
}

function attr(block: string, tag: string, name: string): string | null {
  const lower = block.toLowerCase();
  const open = `<${tag.toLowerCase()}`;
  const key = `${name.toLowerCase()}=`;
  let from = 0;
  while (from < lower.length) {
    const start = lower.indexOf(open, from);
    if (start < 0) return null;
    if (!startsTag(block, start, tag)) {
      from = start + open.length;
      continue;
    }
    const gt = block.indexOf(">", start);
    if (gt < 0) return null;
    const head = block.slice(start, gt);
    const at = head.toLowerCase().indexOf(key);
    if (at >= 0) {
      const quote = head[at + key.length];
      if (quote === '"' || quote === "'") {
        const end = head.indexOf(quote, at + key.length + 1);
        if (end > at) {
          const value = decodeXml(head.slice(at + key.length + 1, end));
          return value || null;
        }
      }
    }
    from = gt + 1;
  }
  return null;
}

function readItemBlock(block: string): RssItem {
  return {
    link: tagText(block, "link") ?? attr(block, "link", "href"),
    guid: tagText(block, "guid"),
    enclosureUrl: attr(block, "enclosure", "url"),
    pubDate: tagText(block, "pubDate"),
    durationSeconds: parseItunesDuration(tagText(block, "itunes:duration")),
  };
}

/** Next item, or null at the end of the document. Oversized items are skipped. */
function nextRssItem(
  xml: string,
  lower: string,
  from: number
): { item: RssItem | null; next: number } | null {
  const start = lower.indexOf("<item", from);
  if (start < 0) return null;
  if (!startsTag(xml, start, "item")) return { item: null, next: start + 5 };
  const gt = xml.indexOf(">", start);
  if (gt < 0) return null;
  const end = lower.indexOf("</item>", gt);
  if (end < 0) return null;
  const next = end + "</item>".length;
  const block = xml.slice(gt + 1, end);
  if (block.length > MAX_ITEM_CHARS) return { item: null, next };
  return { item: readItemBlock(block), next };
}

export function parseRssItems(xml: string): RssItem[] {
  if (xml.length > MAX_RSS_CHARS) return [];
  const items: RssItem[] = [];
  const lower = xml.toLowerCase();
  let from = 0;
  while (items.length < MAX_RSS_ITEMS) {
    const step = nextRssItem(xml, lower, from);
    if (!step) break;
    from = step.next;
    if (step.item) items.push(step.item);
  }
  return items;
}

function calendarDay(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

/**
 * Find one episode in a long feed. Pages of 200 items are scanned until
 * the guid matches, the air window is passed, or the scan cap is hit.
 */
export function findRssEpisode(
  xml: string,
  input: {
    episodeUrl: string | null;
    postDate: string | null;
    window: { start: string; end: string } | null;
  }
): RssItem | null {
  if (xml.length > MAX_RSS_CHARS) return null;
  const lower = xml.toLowerCase();
  let from = 0;
  let seen = 0;
  let best: RssItem | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let previousDay: string | null = null;
  let order: "newest-first" | "oldest-first" | null = null;
  const target = input.postDate ? Date.parse(`${input.postDate}T00:00:00.000Z`) : Number.NaN;

  while (seen < MAX_RSS_SCAN_ITEMS) {
    const step = nextRssItem(xml, lower, from);
    if (!step) break;
    from = step.next;
    seen += 1;
    const item = step.item;
    if (!item) continue;

    if (input.episodeUrl && matchRssItem([item], input.episodeUrl, null)) return item;

    const day = calendarDay(item.pubDate);
    if (day && previousDay && !order) {
      if (day < previousDay) order = "newest-first";
      else if (day > previousDay) order = "oldest-first";
    }

    const inWindow =
      input.window &&
      item.enclosureUrl &&
      day &&
      day >= input.window.start &&
      day <= input.window.end;
    if (inWindow && day) {
      const parsed = Date.parse(`${day}T00:00:00.000Z`);
      const distance = Number.isNaN(parsed) || Number.isNaN(target)
        ? 0
        : Math.abs(parsed - target);
      if (distance < bestDistance) {
        best = item;
        bestDistance = distance;
      }
    } else if (!input.episodeUrl && !input.window && input.postDate && day === input.postDate) {
      return item;
    }

    if (!input.episodeUrl && input.window && day && order) {
      if (order === "newest-first" && day < input.window.start) return best;
      if (order === "oldest-first" && day > input.window.end) return best;
    }
    if (day) previousDay = day;
  }
  return best;
}

/** Host, path, and query. Trailing slash and a leading www are ignored. */
export function normalizeEpisodeUrl(value: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    url.hash = "";
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.protocol}//${host}${path}${url.search}`;
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, "");
  }
}

/**
 * Match the IO line to one feed item.
 * An episode_url must match the item link, guid, or enclosure. A line
 * with no URL falls back to the feed item published on post_date.
 * A URL that matches nothing does not fall through to the date — that
 * would attach a different episode.
 */
export function matchRssItem(
  items: RssItem[],
  episodeUrl: string | null,
  postDate: string | null
): RssItem | null {
  if (episodeUrl) {
    const target = normalizeEpisodeUrl(episodeUrl);
    return (
      items.find((item) =>
        [item.link, item.guid, item.enclosureUrl].some(
          (value) => value && normalizeEpisodeUrl(value) === target
        )
      ) ?? null
    );
  }
  const day = calendarDay(postDate);
  if (!day) return null;
  return items.find((item) => calendarDay(item.pubDate) === day) ?? null;
}
