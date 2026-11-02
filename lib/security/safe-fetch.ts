// SSRF guard for server-side fetches of URLs we did not choose.
// Hostnames are resolved once. The connection uses that address so a
// later DNS answer cannot point the same name at a private host.
// Literal private, CGNAT, benchmark, multicast, and metadata names
// are refused before any connection.

import { lookup } from "node:dns/promises";
import { Agent, type Dispatcher } from "undici";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

export interface SafeFetchOptions {
  /** Aborts the connection when the caller did not pass a signal. */
  timeoutMs?: number;
}

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (octets.some((n) => Number.isNaN(n) || n > 255)) return null;
  return octets;
}

function ipv4Private(octets: number[]): boolean {
  const [a, b, c] = octets;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
  if (a >= 224 && a <= 239) return true; // 224.0.0.0/4 multicast
  if (a >= 240) return true; // 240.0.0.0/4 and 255.255.255.255
  return false;
}

/** Eight hextets, or null when the text is not an IPv6 address. */
export function parseIpv6Hextets(input: string): number[] | null {
  let raw = input.trim().toLowerCase();
  if (raw.startsWith("[") && raw.endsWith("]")) raw = raw.slice(1, -1);
  const zone = raw.indexOf("%");
  if (zone >= 0) raw = raw.slice(0, zone);
  if (!raw) return null;

  const lastColon = raw.lastIndexOf(":");
  if (raw.includes(".")) {
    if (lastColon < 0) return null;
    const v4 = parseIpv4(raw.slice(lastColon + 1));
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    raw = `${raw.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const halves = raw.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 && missing < 0) return null;
  const groups = halves.length === 2 ? [...head, ...Array(missing).fill("0"), ...tail] : head;
  if (groups.length !== 8) return null;
  const nums: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    nums.push(Number.parseInt(group, 16));
  }
  return nums;
}

function hextetsToV4(hi: number, lo: number): number[] {
  return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255];
}

function ipv6Private(groups: number[]): boolean {
  if (groups.every((part) => part === 0)) return true; // ::
  if (groups.slice(0, 7).every((part) => part === 0) && groups[7] === 1) return true; // ::1
  // fc00::/7 unique local
  if ((groups[0] & 0xfe00) === 0xfc00) return true;
  // fe80::/10 link-local
  if ((groups[0] & 0xffc0) === 0xfe80) return true;
  // fec0::/10 deprecated site-local
  if ((groups[0] & 0xffc0) === 0xfec0) return true;
  // 2002::/16 6to4
  if (groups[0] === 0x2002) return true;
  // 64:ff9b:1::/48 local SIIT
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups[2] === 1) return true;
  // ::ffff:0:0:0/96 IPv4-translated SIIT
  if (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0xffff &&
    groups[5] === 0
  ) {
    return true;
  }
  // 64:ff9b::/96 NAT64. The embedded IPv4 is whatever the translator reaches.
  if (
    groups[0] === 0x64 &&
    groups[1] === 0xff9b &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0
  ) {
    return true;
  }
  // ::ffff:0:0/96 IPv4-mapped, dotted or hex (::ffff:a9fe:a9fe).
  if (groups.slice(0, 5).every((part) => part === 0) && groups[5] === 0xffff) {
    return ipv4Private(hextetsToV4(groups[6], groups[7]));
  }
  // Deprecated IPv4-compatible form, including ::127.0.0.1 and ::7f00:1.
  if (groups.slice(0, 6).every((part) => part === 0) && (groups[6] !== 0 || groups[7] > 1)) {
    return ipv4Private(hextetsToV4(groups[6], groups[7]));
  }
  return false;
}

/** True for loopback, private, link-local, CGNAT, benchmark, and multicast addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = parseIpv4(ip);
  if (v4) return ipv4Private(v4);
  const groups = parseIpv6Hextets(ip);
  if (!groups) return false;
  return ipv6Private(groups);
}

function bareHost(hostname: string): string {
  let host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  const zone = host.indexOf("%");
  if (zone >= 0) host = host.slice(0, zone);
  return host;
}

function isMetadataHost(hostname: string): boolean {
  return hostname === "metadata.google.internal" || hostname.endsWith(".metadata.google.internal");
}

export interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

type LookupAddress = { address: string; family: number };

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number
) => void;

function wantsAllAddresses(options: unknown): boolean {
  return Boolean(
    options &&
      typeof options === "object" &&
      "all" in options &&
      (options as { all?: boolean }).all
  );
}

/**
 * DNS lookup callback that always returns the address chosen before connect.
 * Node's connector calls this with `{ all: true }` and reads an array.
 * A one-address callback still receives the string form.
 */
export function lookupPinned(address: string, family: 4 | 6) {
  return (_hostname: string, options: unknown, callback?: LookupCallback) => {
    const done: LookupCallback | undefined =
      typeof options === "function" ? (options as LookupCallback) : callback;
    if (!done) return;
    if (wantsAllAddresses(options)) done(null, [{ address, family }]);
    else done(null, address, family);
  };
}

export function createPinnedDispatcher(address: string, family: 4 | 6): Dispatcher {
  const pinnedLookup = lookupPinned(address, family);
  const agent = new Agent({
    connect: {
      lookup: pinnedLookup,
    },
  });
  return Object.assign(agent, { pinnedLookup });
}

async function pinHost(hostname: string): Promise<PinnedAddress | null> {
  const host = bareHost(hostname);
  if (!host || host === "localhost" || host.endsWith(".localhost") || isMetadataHost(host)) {
    return null;
  }
  if (parseIpv4(host)) {
    if (isPrivateAddress(host)) return null;
    return { address: host, family: 4 };
  }
  if (host.includes(":")) {
    const groups = parseIpv6Hextets(host);
    if (!groups || ipv6Private(groups)) return null;
    return { address: host, family: 6 };
  }
  try {
    const addresses = await lookup(host, { all: true });
    if (addresses.length === 0) return null;
    if (addresses.some((row) => isPrivateAddress(row.address))) return null;
    const first = addresses[0];
    const family = first.family === 6 || first.address.includes(":") ? 6 : 4;
    return { address: first.address, family };
  } catch {
    return null;
  }
}

/**
 * True when the URL is http(s) and every resolved address is public.
 * DNS failure counts as unsafe.
 */
export async function isUrlSafe(parsed: URL): Promise<boolean> {
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return (await pinHost(parsed.hostname)) !== null;
}

function withTimeout(
  init: RequestInit,
  timeoutMs: number
): { init: RequestInit; cancel: () => void } {
  if (init.signal) return { init, cancel: () => undefined };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    init: { ...init, signal: controller.signal },
    cancel: () => clearTimeout(timer),
  };
}

/**
 * One connection to an address that was already chosen. safeFetch uses
 * this after isUrlSafe. Callers that need a socket test can pass a
 * loopback address here without the private-address check.
 */
export async function fetchPinned(
  url: string,
  pinned: PinnedAddress,
  init: RequestInit = {}
): Promise<Response> {
  const dispatcher = createPinnedDispatcher(pinned.address, pinned.family);
  try {
    const res = await fetch(url, {
      ...init,
      redirect: "manual",
      dispatcher,
    } as RequestInit);
    if (REDIRECT_STATUSES.has(res.status)) {
      await res.body?.cancel().catch(() => undefined);
      await dispatcher.close();
      return res;
    }
    return bindDispatcher(res, dispatcher);
  } catch (err) {
    await dispatcher.close();
    throw err;
  }
}

/**
 * fetch() that checks every hop, then connects to the address from that
 * check. Returns null on a blocked target, a missing Location header,
 * more than `maxRedirects` hops, a timeout, or any network error.
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  maxRedirects: number = MAX_REDIRECTS,
  options: SafeFetchOptions = {}
): Promise<Response | null> {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return null;
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const timed = withTimeout(init, timeoutMs);

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const pinned = await pinHost(current.hostname);
      if (!pinned) return null;
      if (current.protocol !== "http:" && current.protocol !== "https:") return null;

      let res: Response;
      try {
        res = await fetchPinned(current.toString(), pinned, timed.init);
      } catch {
        return null;
      }

      if (!REDIRECT_STATUSES.has(res.status)) return res;

      const location = res.headers.get("location");
      if (!location) return null;
      try {
        current = new URL(location, current);
      } catch {
        return null;
      }
    }
    return null;
  } finally {
    timed.cancel();
  }
}

function bindDispatcher(res: Response, dispatcher: Dispatcher): Response {
  const close = () => dispatcher.close();
  if (!res.body) {
    void close();
    return res;
  }
  const reader = res.body.getReader();
  let closed = false;
  const finish = async () => {
    if (closed) return;
    closed = true;
    await close();
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          await finish();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        controller.error(err);
        await finish();
      }
    },
    async cancel() {
      await reader.cancel().catch(() => undefined);
      await finish();
    },
  });
  return new Response(stream, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

export function contentTypeAllowed(header: string | null, kind: "rss" | "audio"): boolean {
  const value = header?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!value || value === "text/html" || value === "application/json") return false;
  if (kind === "rss") {
    return value.includes("xml") || value.includes("rss") || value === "text/plain";
  }
  return (
    value.startsWith("audio/") ||
    value.startsWith("video/") ||
    value === "application/octet-stream"
  );
}

/**
 * Read a response body until `maxBytes`. A larger body cancels the stream
 * and does not buffer the rest.
 */
export async function readBodyCapped(
  res: Response,
  maxBytes: number,
  signal?: AbortSignal
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    return { ok: false, error: `Response is larger than ${maxBytes} bytes` };
  }
  const reader = res.body?.getReader();
  if (!reader) return { ok: false, error: "Response had no body" };
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, error: "Request timed out" };
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, error: `Response exceeded ${maxBytes} bytes` };
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return { ok: false, error: signal?.aborted ? "Request timed out" : "Response read failed" };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

export const RSS_MAX_BYTES = 5 * 1024 * 1024;
export const AUDIO_MAX_BYTES = 200 * 1024 * 1024;
export const AUDIO_FETCH_TIMEOUT_MS = 120_000;

/**
 * Fetch one body with a timeout, a byte cap, and a content-type check.
 * RSS and episode audio use this. The connection is pinned by safeFetch.
 */
export async function fetchCapped(
  url: string,
  init: RequestInit,
  options: { kind: "rss" | "audio"; maxBytes: number; timeoutMs: number }
): Promise<{ ok: true; bytes: Uint8Array; contentType: string } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const parent = init.signal;
  if (parent) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const res = await safeFetch(url, { ...init, signal: controller.signal });
    if (!res) {
      return {
        ok: false,
        error: controller.signal.aborted ? "Request timed out" : "Fetch was blocked or failed",
      };
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, error: `Fetch failed: ${res.status}` };
    }
    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() || "";
    if (!contentTypeAllowed(res.headers.get("content-type"), options.kind)) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, error: `Unexpected content-type: ${contentType || "missing"}` };
    }
    const body = await readBodyCapped(res, options.maxBytes, controller.signal);
    if (!body.ok) return body;
    if (body.bytes.byteLength === 0) return { ok: false, error: "Response was empty" };
    return { ok: true, bytes: body.bytes, contentType };
  } catch {
    return { ok: false, error: controller.signal.aborted ? "Request timed out" : "Fetch failed" };
  } finally {
    clearTimeout(timer);
  }
}
