// Wave 14 Phase 2A Layer 3 amendment — SSRF guard for server-side fetches
// of brand-provided URLs. derive-product fetches arbitrary URLs; without
// this, a hostname or redirect pointing at a private address would let a
// brand read internal services (cloud metadata, localhost, VPC hosts).

import { lookup } from "node:dns/promises";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (octets.some((n) => Number.isNaN(n) || n > 255)) return null;
  return octets;
}

/** True for loopback, RFC 1918, link-local, and their IPv6 equivalents. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = parseIpv4(ip);
  if (v4) {
    const [a, b] = v4;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local)
    if (a === 0) return true; // 0.0.0.0/8
    return false;
  }

  const v6 = ip.toLowerCase().split("%")[0]; // strip zone index
  if (v6 === "::1" || v6 === "::") return true; // loopback / unspecified
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]); // IPv4-mapped
  if (/^f[cd]/.test(v6)) return true; // fc00::/7 (unique local)
  if (/^fe[89ab]/.test(v6)) return true; // fe80::/10 (link-local)
  return false;
}

/**
 * True when the URL is http(s) and its host does not point at a private
 * address — literal IPs are checked directly, hostnames are DNS-resolved
 * and every resolved address must be public. DNS failure counts as unsafe
 * (the fetch would fail anyway).
 */
export async function isUrlSafe(parsed: URL): Promise<boolean> {
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  let hostname = parsed.hostname.toLowerCase();
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1); // IPv6 literal
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return false;
  }
  if (parseIpv4(hostname) || hostname.includes(":")) {
    return !isPrivateAddress(hostname);
  }
  try {
    const addresses = await lookup(hostname, { all: true });
    if (addresses.length === 0) return false;
    return addresses.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

/**
 * fetch() that validates every hop against isUrlSafe — redirects are
 * followed manually so the redirect *target* is checked before it is
 * fetched, not just the initial URL. Returns null on a blocked target,
 * a missing Location header, more than `maxRedirects` hops, or any
 * network error.
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  maxRedirects: number = MAX_REDIRECTS
): Promise<Response | null> {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return null;
  }

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!(await isUrlSafe(current))) return null;

    let res: Response;
    try {
      res = await fetch(current.toString(), { ...init, redirect: "manual" });
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
  return null; // redirect cap exceeded
}
