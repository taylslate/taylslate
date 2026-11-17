// RSS fetch for itunes:owner email. No XML library and no entity
// expansion. A doctype or entity declaration is skipped. The body
// stops at 2 MB or the first item. Private and loopback hosts are
// refused before the request.

import { isIP } from "node:net";

export const FEED_USER_AGENT = "TaylslateImport/1.0 (+https://www.taylslate.com)";
export const FEED_BYTE_CAP = 2 * 1024 * 1024;
export const FEED_TIMEOUT_MS = 10_000;
export const FEED_MAX_REDIRECTS = 3;
export const FEED_CONCURRENCY = 5;

export type FeedSkip =
  | "protocol"
  | "loopback"
  | "private"
  | "dns"
  | "redirects"
  | "timeout"
  | "too_large"
  | "doctype"
  | "entity"
  | "http"
  | "network"
  | "empty";

export interface FeedResult {
  email: string | null;
  skip: FeedSkip | null;
}

export type LookupFn = (host: string) => Promise<string[]>;

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeXml(text: string): string {
  return text.replace(
    /&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|amp|lt|gt|quot|apos);/g,
    (all, dec: string | undefined, hex: string | undefined) => {
      if (dec) return safeChar(Number(dec));
      if (hex) return safeChar(parseInt(hex, 16));
      const name = all.slice(1, -1);
      return NAMED[name] ?? all;
    }
  );
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  if (code >= 0xd800 && code <= 0xdfff) return "";
  return String.fromCodePoint(code);
}

export function extractOwnerEmail(xml: string): string | null {
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) return null;
  const owner = /<itunes:owner\b[^>]*>[\s\S]{0,4000}?<\/itunes:owner>/i.exec(xml);
  if (!owner) return null;
  const email = /<itunes:email\b[^>]*>([\s\S]{0,320}?)<\/itunes:email>/i.exec(owner[0]);
  if (!email) return null;
  const decoded = decodeXml(email[1]).replace(/<[^>]{0,200}>/g, "").trim();
  return decoded || null;
}

export function isBlockedIp(ip: string): boolean {
  const raw = ip.trim().toLowerCase();
  const mapped = raw.startsWith("::ffff:") ? raw.slice(7) : raw;
  if (isIP(mapped) === 4) return blockedV4(mapped);
  if (isIP(raw) === 6) return blockedV6(raw);
  return true;
}

function blockedV4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function blockedV6(ip: string): boolean {
  const value = ip.toLowerCase();
  if (value === "::1" || value === "::") return true;
  if (value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")) {
    return true;
  }
  if (value.startsWith("fc") || value.startsWith("fd")) return true;
  return false;
}

export function isBlockedHostname(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!name) return true;
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  if (isIP(name)) return isBlockedIp(name);
  return false;
}

async function addressesFor(host: string, lookup: LookupFn): Promise<string[]> {
  if (isIP(host)) return [host];
  return lookup(host);
}

function skipForAddress(address: string): FeedSkip {
  const value = address.trim().toLowerCase();
  if (value === "::1" || value.startsWith("127.")) return "loopback";
  return "private";
}

async function assertPublic(host: string, lookup: LookupFn): Promise<FeedSkip | null> {
  const name = host.toLowerCase().replace(/\.$/, "");
  if (name === "localhost" || name.endsWith(".localhost")) return "loopback";
  if (isIP(name)) return isBlockedIp(name) ? skipForAddress(name) : null;
  let addresses: string[];
  try {
    addresses = await addressesFor(name, lookup);
  } catch {
    return "dns";
  }
  if (addresses.length === 0) return "dns";
  for (const address of addresses) {
    if (isBlockedIp(address)) return skipForAddress(address);
  }
  return null;
}

function redirectSkip(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function readCapped(res: Response): Promise<{ text: string; tooLarge: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    return { text: text.slice(0, FEED_BYTE_CAP), tooLarge: text.length > FEED_BYTE_CAP };
  }
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  let tooLarge = false;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > FEED_BYTE_CAP) {
      tooLarge = true;
      await reader.cancel();
      break;
    }
    text += decoder.decode(chunk.value, { stream: true });
    const itemAt = text.search(/<item\b/i);
    if (itemAt >= 0) {
      text = text.slice(0, itemAt);
      await reader.cancel();
      break;
    }
  }
  text += decoder.decode();
  return { text, tooLarge };
}

export async function fetchOwnerEmail(
  feedUrl: string,
  deps: { fetchImpl?: typeof fetch; lookup?: LookupFn; timeoutMs?: number }
): Promise<FeedResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const lookup = deps.lookup ?? defaultLookup;
  let current: string;
  try {
    current = new URL(feedUrl).toString();
  } catch {
    return { email: null, skip: "protocol" };
  }
  const seen = new Set<string>();
  for (let hop = 0; hop <= FEED_MAX_REDIRECTS; hop += 1) {
    if (seen.has(current)) return { email: null, skip: "redirects" };
    seen.add(current);
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      return { email: null, skip: "protocol" };
    }
    if (url.protocol === "file:" || url.protocol === "ftp:") return { email: null, skip: "protocol" };
    if (url.protocol !== "http:" && url.protocol !== "https:") return { email: null, skip: "protocol" };
    const blocked = await assertPublic(url.hostname, lookup);
    if (blocked) return { email: null, skip: blocked };
    let res: Response;
    try {
      res = await fetchImpl(current, {
        redirect: "manual",
        headers: {
          "User-Agent": FEED_USER_AGENT,
          Accept: "application/rss+xml, application/xml, text/xml, */*",
        },
        signal: AbortSignal.timeout(deps.timeoutMs ?? FEED_TIMEOUT_MS),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError") return { email: null, skip: "timeout" };
      return { email: null, skip: "network" };
    }
    if (redirectSkip(res.status)) {
      const location = res.headers.get("location");
      if (!location || hop === FEED_MAX_REDIRECTS) return { email: null, skip: "redirects" };
      try {
        current = new URL(location, current).toString();
      } catch {
        return { email: null, skip: "redirects" };
      }
      continue;
    }
    if (!res.ok) return { email: null, skip: "http" };
    const body = await readCapped(res);
    if (/<!DOCTYPE/i.test(body.text)) return { email: null, skip: "doctype" };
    if (/<!ENTITY/i.test(body.text)) return { email: null, skip: "entity" };
    const email = extractOwnerEmail(body.text);
    if (email) return { email, skip: null };
    if (body.tooLarge) return { email: null, skip: "too_large" };
    return { email: null, skip: null };
  }
  return { email: null, skip: "redirects" };
}

async function defaultLookup(host: string): Promise<string[]> {
  const dns = await import("node:dns/promises");
  const records = await dns.lookup(host, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Math.max(1, Math.min(limit, items.length || 1));
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index], index);
    }
  }
  if (items.length === 0) return out;
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}
