// Fixed OAuth errors. Database failures become OAuthUnavailableError.
// Responses never include database text, tokens, codes, or verifiers.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const OAUTH_JSON_MAX_BYTES = 8 * 1024;

export const OAUTH_ERROR_DESCRIPTION = {
  invalid_request: "The request is not valid.",
  invalid_client: "The client is not recognized.",
  invalid_grant: "The grant is invalid, expired, or revoked.",
  unsupported_grant_type: "This grant type is not supported.",
  invalid_scope: "The requested scope is not valid.",
  invalid_redirect_uri: "The redirect URI is not allowed.",
  invalid_client_metadata: "The client metadata is not valid.",
  temporarily_unavailable: "The authorization server is temporarily unavailable.",
  invalid_target: "The resource is not valid.",
  access_denied: "The request was denied.",
} as const;

export type OAuthErrorCode = keyof typeof OAUTH_ERROR_DESCRIPTION;

const OAUTH_ERROR_STATUS: Record<OAuthErrorCode, number> = {
  invalid_request: 400,
  invalid_client: 401,
  invalid_grant: 400,
  unsupported_grant_type: 400,
  invalid_scope: 400,
  invalid_redirect_uri: 400,
  invalid_client_metadata: 400,
  temporarily_unavailable: 503,
  invalid_target: 400,
  access_denied: 400,
};

export const CLIENT_OR_REDIRECT_DESCRIPTION = "The client or redirect URI is not valid.";

export class OAuthUnavailableError extends Error {
  readonly code: string;

  constructor(code = "unknown") {
    super("temporarily_unavailable");
    this.name = "OAuthUnavailableError";
    this.code = code;
  }
}

export class OAuthRequestError extends Error {
  readonly error: OAuthErrorCode;
  readonly status: number;
  readonly description: string;

  constructor(error: OAuthErrorCode, status?: number, description?: string) {
    super(error);
    this.name = "OAuthRequestError";
    this.error = error;
    this.status = status ?? OAUTH_ERROR_STATUS[error];
    this.description = description ?? OAUTH_ERROR_DESCRIPTION[error];
  }
}

interface DbResult<T> {
  data: T;
  error: { code?: string; message?: string } | null;
}

function logCode(err: unknown): string {
  if (typeof err === "object" && err && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code)) return code;
  }
  return "unknown";
}

/** Every OAuth table call goes through here. Any failure is unavailable. */
export async function oauth<T>(query: PromiseLike<DbResult<T>>): Promise<T> {
  let result: DbResult<T>;
  try {
    result = await query;
  } catch (err) {
    const code = logCode(err);
    console.warn("[mcp-oauth]", code);
    throw new OAuthUnavailableError(code);
  }
  if (result.error) {
    const code = logCode(result.error);
    console.warn("[mcp-oauth]", code);
    throw new OAuthUnavailableError(code);
  }
  return result.data;
}

export function oauthAdmin() {
  return supabaseAdmin;
}

export function requestMime(req: Request): string {
  return req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
}

export async function readCappedText(
  req: Request,
  maxBytes: number
): Promise<{ ok: true; text: string } | { ok: false; error: "invalid_request" }> {
  const stream = req.body;
  if (!stream) return { ok: true, text: "" };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) return { ok: false, error: "invalid_request" };
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder("utf-8", { fatal: false }).decode(out) };
}

export function corsPreflight(methods: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": methods,
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "3600",
    },
  });
}

function applyCors(headers: Headers): void {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export function oauthJson(body: unknown, status: number, cors: boolean): Response {
  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  headers.set("Pragma", "no-cache");
  if (cors) applyCors(headers);
  return NextResponse.json(body, { status, headers });
}

export function oauthErrorResponse(
  error: OAuthErrorCode,
  cors: boolean,
  status?: number,
  description?: string
): Response {
  return oauthJson(
    {
      error,
      error_description: description ?? OAUTH_ERROR_DESCRIPTION[error],
    },
    status ?? OAUTH_ERROR_STATUS[error],
    cors
  );
}

export function withOauthRate(res: Response, cors: boolean): Response {
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Pragma", "no-cache");
  if (cors) applyCors(headers);
  return new Response(res.body, { status: res.status, headers });
}

export function respondOauthFailure(err: unknown, cors: boolean): Response {
  if (err instanceof OAuthRequestError) {
    return oauthErrorResponse(err.error, cors, err.status, err.description);
  }
  if (err instanceof OAuthUnavailableError) {
    return oauthErrorResponse("temporarily_unavailable", cors);
  }
  console.warn("[mcp-oauth]", "unknown");
  return oauthErrorResponse("temporarily_unavailable", cors);
}

export function redirectWith(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
