// Minimal RSS 2.0 item parse. IO lines identify an episode by episode_url;
// the show's rss_url is the feed that carries the enclosure. No feed SDK.

export interface RssItem {
  link: string | null;
  guid: string | null;
  enclosureUrl: string | null;
  pubDate: string | null;
}

const AUDIO_EXT = /\.(mp3|m4a|mp4|m4v|wav|aac|ogg|oga|opus|flac)(?:$|[?#])/i;

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

function tagText(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = block.match(re);
  if (!match) return null;
  const text = decodeXml(match[1]);
  return text || null;
}

function attr(block: string, tag: string, name: string): string | null {
  const re = new RegExp(
    `<${tag}\\b[^>]*\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i"
  );
  const match = block.match(re);
  if (!match) return null;
  const value = decodeXml(match[1] ?? match[2] ?? "");
  return value || null;
}

export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(xml))) {
    const block = match[1];
    items.push({
      link: tagText(block, "link") ?? attr(block, "link", "href"),
      guid: tagText(block, "guid"),
      enclosureUrl: attr(block, "enclosure", "url"),
      pubDate: tagText(block, "pubDate"),
    });
  }
  return items;
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

function calendarDay(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
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
