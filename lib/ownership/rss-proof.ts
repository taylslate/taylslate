// Read a podcast feed and collect the text an ownership code can sit in.
// Channel description, itunes:summary, and the latest 10 items
// (description, content:encoded, itunes:summary). Tags are stripped
// and entities decoded before the search.

import { fetchCapped, isUrlSafe } from "@/lib/security/safe-fetch";
import { textContainsHashedCode, textHasOwnershipCode } from "@/lib/ownership/code";

export const RSS_PROOF_MAX_BYTES = 2 * 1024 * 1024;
export const RSS_PROOF_TIMEOUT_MS = 10_000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " ",
};

export type RssProofRead =
  | { status: "ok"; text: string }
  | { status: "blocked" }
  | { status: "miss" };

function decodeEntitiesOnce(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (all, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const num = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(num) || num < 0 || num > 0x10ffff) return all;
      try {
        return String.fromCodePoint(num);
      } catch {
        return all;
      }
    }
    return NAMED_ENTITIES[body] ?? all;
  });
}

function decodeEntities(value: string): string {
  let current = value;
  for (let i = 0; i < 2; i += 1) {
    const next = decodeEntitiesOnce(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

function unwrapXml(raw: string): string {
  const parts: string[] = [];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let last = 0;
  let found = false;
  for (const match of raw.matchAll(re)) {
    found = true;
    const index = match.index ?? 0;
    parts.push(decodeEntities(raw.slice(last, index)));
    parts.push(match[1] ?? "");
    last = index + match[0].length;
  }
  parts.push(decodeEntities(raw.slice(last)));
  return found ? parts.join("") : decodeEntities(raw);
}

function toSearchText(raw: string): string {
  const decoded = decodeEntities(unwrapXml(raw));
  const stripped = decoded.replace(/<[^>]*>/g, " ");
  return decodeEntities(stripped).replace(/\s+/g, " ").trim();
}

function elementBodies(xml: string, name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)</${escaped}>`, "gi");
  return [...xml.matchAll(re)].map((match) => match[1] ?? "");
}

/** Channel description, itunes:summary, and the latest 10 items. */
export function rssSearchText(xml: string): string {
  const items = [...xml.matchAll(/<item\b[^>]*>[\s\S]*?<\/item>/gi)].slice(0, 10).map((match) => match[0]);
  const channel = xml
    .replace(/<item\b[^>]*>[\s\S]*?<\/item>/gi, "")
    .replace(/<image\b[^>]*>[\s\S]*?<\/image>/gi, "");
  const chunks: string[] = [];
  for (const name of ["description", "itunes:summary"]) {
    for (const body of elementBodies(channel, name)) chunks.push(toSearchText(body));
  }
  for (const item of items) {
    for (const name of ["description", "content:encoded", "itunes:summary"]) {
      for (const body of elementBodies(item, name)) chunks.push(toSearchText(body));
    }
  }
  return chunks.filter((chunk) => chunk.length > 0).join("\n");
}

export function rssContainsCode(xml: string, code: string): boolean {
  return textHasOwnershipCode(rssSearchText(xml), code);
}

export function rssContainsHashedCode(xml: string, hashHex: string): boolean {
  return textContainsHashedCode(rssSearchText(xml), hashHex);
}

export async function readRssProofText(feedUrl: string): Promise<RssProofRead> {
  let parsed: URL;
  try {
    parsed = new URL(feedUrl);
  } catch {
    return { status: "blocked" };
  }
  if (!(await isUrlSafe(parsed))) return { status: "blocked" };

  const fetched = await fetchCapped(feedUrl, {}, {
    kind: "rss",
    maxBytes: RSS_PROOF_MAX_BYTES,
    timeoutMs: RSS_PROOF_TIMEOUT_MS,
  });
  if (!fetched.ok) return { status: "miss" };
  const xml = new TextDecoder("utf-8", { fatal: false }).decode(fetched.bytes);
  return { status: "ok", text: rssSearchText(xml) };
}
