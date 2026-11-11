// YouTube OAuth for creator caption airchecks.
// Two scopes only. The code reads. It never uploads, edits, or posts.
// Redirect URI is always NEXT_PUBLIC_SITE_URL, never the request host.

import { NextResponse } from "next/server";

const FORCE_SSL = "https://www.googleapis.com/auth/youtube.force-ssl";
const ANALYTICS_READONLY = "https://www.googleapis.com/auth/yt-analytics.readonly";

export const YOUTUBE_OAUTH_SCOPES = [FORCE_SSL, ANALYTICS_READONLY] as const;

export const YOUTUBE_OAUTH_COOKIE = "yt_oauth";
export const YOUTUBE_OAUTH_COOKIE_MAX_AGE_SEC = 10 * 60;

export interface YoutubeOauthConfig {
  clientId: string;
  clientSecret: string;
  encryptionKey: Buffer;
  redirectUri: string;
  siteBase: string;
}

/** Apex always redirects here. OAuth, cookies, and Origin checks use this host. */
export const CANONICAL_SITE_HOST = "www.taylslate.com";

export function canonicalSiteUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.hostname === "taylslate.com") {
      url.hostname = CANONICAL_SITE_HOST;
      url.protocol = "https:";
    }
    return url;
  } catch {
    return null;
  }
}

function siteBase(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") ?? "";
  if (!raw) return null;
  const url = canonicalSiteUrl(raw);
  if (!url) return null;
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

/** 32-byte key. Accepts standard base64 or base64url. */
export function readTokenEncryptionKey(raw?: string | null): Buffer | null {
  const value = (raw === undefined ? process.env.YOUTUBE_TOKEN_ENC_KEY : raw)?.trim() ?? "";
  if (!value) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const key = Buffer.from(padded, "base64");
  if (key.length !== 32) return null;
  return key;
}

export function readYoutubeOauthConfig(): YoutubeOauthConfig | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "";
  const encryptionKey = readTokenEncryptionKey();
  const base = siteBase();
  if (!clientId || !clientSecret || !encryptionKey || !base) return null;
  return {
    clientId,
    clientSecret,
    encryptionKey,
    siteBase: base,
    redirectUri: `${base}/api/youtube/callback`,
  };
}

export function youtubeOauthConfigured(): boolean {
  return readYoutubeOauthConfig() !== null;
}

export const YOUTUBE_OAUTH_ERRORS = [
  "state",
  "expired",
  "user",
  "scope",
  "channel",
  "channel_taken",
  "denied",
  "exchange",
] as const;

export type YoutubeOauthErrorCode = (typeof YOUTUBE_OAUTH_ERRORS)[number];

export function setYoutubeOauthCookie(response: NextResponse, value: string, maxAge = YOUTUBE_OAUTH_COOKIE_MAX_AGE_SEC): void {
  response.cookies.set({
    name: YOUTUBE_OAUTH_COOKIE,
    value,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/youtube",
    maxAge,
  });
}

export function clearYoutubeOauthCookie(response: NextResponse): void {
  setYoutubeOauthCookie(response, "", 0);
}

/** Fixed settings targets only. No next parameter. */
export function youtubeSettingsUrl(query: { connected: true } | { error: YoutubeOauthErrorCode }): string | null {
  const base = readYoutubeOauthConfig()?.siteBase;
  if (!base) return null;
  const url = new URL("/settings/youtube", base);
  if ("connected" in query) url.searchParams.set("connected", "1");
  else url.searchParams.set("error", query.error);
  return url.toString();
}
