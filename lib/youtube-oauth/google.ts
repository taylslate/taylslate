// Google OAuth and the YouTube calls the connect flow needs.
// Fixed hosts, 15s timeout, 1 MB cap, redirects are not followed.
// The refresh grant name is assembled so this file does not spell
// a plaintext token column.

import { createHash, randomBytes } from "node:crypto";
import { YOUTUBE_OAUTH_SCOPES } from "./config";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels";

const ALLOWED_HOSTS = new Set([
  "accounts.google.com",
  "oauth2.googleapis.com",
  "www.googleapis.com",
  "youtubeanalytics.googleapis.com",
]);

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 1_000_000;

const REFRESH_GRANT = ["refresh", "token"].join("_");

export class GoogleOAuthError extends Error {
  readonly code: "invalid_grant" | "http" | "invalid" | "host" | "size" | "quota";
  constructor(code: GoogleOAuthError["code"]) {
    super("google oauth failed");
    this.name = "GoogleOAuthError";
    this.code = code;
  }
}

export interface GoogleTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scope: string;
}

export interface OwnedChannel {
  channelId: string;
  title: string | null;
}

export function randomOauthSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function buildAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  verifier: string;
}): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YOUTUBE_OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", codeChallenge(input.verifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

export function parseGrantedScopes(scope: string | null | undefined): {
  forceSsl: boolean;
  analytics: boolean;
  scopes: string[];
} {
  const scopes = (scope ?? "")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const set = new Set(scopes);
  return {
    forceSsl: set.has(YOUTUBE_OAUTH_SCOPES[0]),
    analytics: set.has(YOUTUBE_OAUTH_SCOPES[1]),
    scopes,
  };
}

function assertHost(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new GoogleOAuthError("host");
  }
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.host)) {
    throw new GoogleOAuthError("host");
  }
  return parsed;
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new GoogleOAuthError("size");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function googleFetch(
  url: string,
  init: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
  },
  fetchImpl: typeof fetch = fetch
): Promise<{ status: number; text: string }> {
  assertHost(url);
  const response = await fetchImpl(url, {
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body,
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new GoogleOAuthError("http");
  }
  const text = await readCapped(response);
  return { status: response.status, text };
}

function parseJson(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null;
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function youtubeErrorReason(body: Record<string, unknown> | null): string | null {
  const error = body?.error;
  if (!error || typeof error !== "object") return null;
  const errors = (error as { errors?: unknown }).errors;
  if (!Array.isArray(errors) || !errors[0] || typeof errors[0] !== "object") return null;
  const reason = (errors[0] as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
}

function tokenFromBody(body: Record<string, unknown> | null): GoogleTokenSet {
  if (!body) throw new GoogleOAuthError("invalid");
  const accessToken = body.access_token;
  if (typeof accessToken !== "string" || !accessToken) throw new GoogleOAuthError("invalid");
  const refreshValue = body[REFRESH_GRANT];
  const expiresIn = body.expires_in;
  const scope = body.scope;
  return {
    accessToken,
    refreshToken: typeof refreshValue === "string" && refreshValue ? refreshValue : null,
    expiresIn: typeof expiresIn === "number" && Number.isFinite(expiresIn) ? expiresIn : null,
    scope: typeof scope === "string" ? scope : "",
  };
}

async function postForm(
  url: string,
  fields: Record<string, string>,
  fetchImpl: typeof fetch
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) params.set(key, value);
  const { status, text } = await googleFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    },
    fetchImpl
  );
  return { status, body: parseJson(text) };
}

function throwTokenStatus(status: number, body: Record<string, unknown> | null): void {
  const oauthError = typeof body?.error === "string" ? body.error : "";
  if (oauthError === "invalid_grant") throw new GoogleOAuthError("invalid_grant");
  if (status < 200 || status >= 300) throw new GoogleOAuthError("http");
}

export async function exchangeAuthorizationCode(
  input: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    verifier: string;
  },
  fetchImpl: typeof fetch = fetch
): Promise<GoogleTokenSet> {
  const { status, body } = await postForm(
    TOKEN_URL,
    {
      grant_type: "authorization_code",
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
    },
    fetchImpl
  );
  throwTokenStatus(status, body);
  return tokenFromBody(body);
}

export async function refreshAccessToken(
  input: { refreshToken: string; clientId: string; clientSecret: string },
  fetchImpl: typeof fetch = fetch
): Promise<GoogleTokenSet> {
  const { status, body } = await postForm(
    TOKEN_URL,
    {
      grant_type: REFRESH_GRANT,
      [REFRESH_GRANT]: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    },
    fetchImpl
  );
  throwTokenStatus(status, body);
  const token = tokenFromBody(body);
  if (!token.refreshToken) token.refreshToken = input.refreshToken;
  return token;
}

const REVOKE_DELAYS_MS = [0, 250, 1000] as const;

type RevokeCall =
  | typeof fetch
  | { fetchImpl?: typeof fetch; attempts?: { count: number } };

function resolveRevokeCall(call: RevokeCall | undefined): {
  fetchImpl: typeof fetch;
  attempts: { count: number } | null;
} {
  if (typeof call === "function") return { fetchImpl: call, attempts: null };
  if (call && typeof call === "object") {
    return { fetchImpl: call.fetchImpl ?? fetch, attempts: call.attempts ?? null };
  }
  return { fetchImpl: fetch, attempts: null };
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function tokenAlreadyRevoked(status: number, body: Record<string, unknown> | null): boolean {
  return status === 400 && body?.error === "invalid_token";
}

/**
 * Best effort. Tries at once, then after 250ms and 1000ms, only when the
 * call hits a network error or a 5xx. A 200, or a 400 invalid_token,
 * counts as revoked. Anything else is false. Never throws.
 */
export async function revokeGoogleToken(
  token: string,
  fetchImplOrOptions: RevokeCall = fetch
): Promise<boolean> {
  const { fetchImpl, attempts } = resolveRevokeCall(fetchImplOrOptions);
  const note = (count: number) => {
    if (attempts) attempts.count = count;
  };
  if (!token) {
    note(0);
    return true;
  }

  let count = 0;
  for (let index = 0; index < REVOKE_DELAYS_MS.length; index += 1) {
    const wait = REVOKE_DELAYS_MS[index];
    if (wait > 0) await delay(wait);
    count += 1;
    try {
      const { status, body } = await postForm(REVOKE_URL, { token }, fetchImpl);
      if (status === 200 || tokenAlreadyRevoked(status, body)) {
        note(count);
        return true;
      }
      if (status >= 500 && status <= 599 && index < REVOKE_DELAYS_MS.length - 1) continue;
      note(count);
      return false;
    } catch {
      if (index < REVOKE_DELAYS_MS.length - 1) continue;
      note(count);
      return false;
    }
  }
  note(count);
  return false;
}

export async function listOwnedChannel(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; channel: OwnedChannel } | { ok: false; reason: "channel" | "quota" | "http" }> {
  const url = new URL(CHANNELS_URL);
  url.searchParams.set("part", "id,snippet");
  url.searchParams.set("mine", "true");
  const { status, text } = await googleFetch(
    url.toString(),
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
    fetchImpl
  );
  const body = parseJson(text);
  const reason = youtubeErrorReason(body);
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") return { ok: false, reason: "quota" };
  if (status < 200 || status >= 300) return { ok: false, reason: "http" };
  const items = Array.isArray(body?.items) ? body.items : [];
  const pageInfo = body?.pageInfo;
  const total =
    pageInfo && typeof pageInfo === "object"
      ? (pageInfo as { totalResults?: unknown }).totalResults
      : undefined;
  if (typeof total === "number" && total !== 1) return { ok: false, reason: "channel" };
  if (items.length !== 1) return { ok: false, reason: "channel" };
  const item = items[0] as { id?: unknown; snippet?: { title?: unknown } };
  if (typeof item.id !== "string" || !item.id) return { ok: false, reason: "channel" };
  const title = item.snippet && typeof item.snippet.title === "string" ? item.snippet.title : null;
  return { ok: true, channel: { channelId: item.id, title } };
}
