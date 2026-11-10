// Session gate, plan check, and response allowlist for brand API key
// settings. Key rows are read and written only through the A1 helpers.
// The plaintext secret is never logged here.

import { NextResponse } from "next/server";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { getAuthenticatedUser } from "@/lib/data/queries";
import {
  ApiKeyError,
  API_SCOPES,
  isApiScope,
  listKeys,
  revokeKey,
  type ApiKeyRecord,
  type ApiScope,
} from "@/lib/api/keys";
import type { RateLimitRule } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const ACTIVE_API_KEY_CAP = 10;
export const ACTIVE_API_KEY_CAP_MESSAGE =
  "You have the maximum of 10 active keys. Revoke one first.";
export const API_KEY_CREATE_MAX_BODY_BYTES = 8 * 1024;
export const API_KEY_NAME_MAX = 60;

export const API_KEY_CREATE_BUCKET = "api_key_create_user_hour";
export const API_KEY_CREATE_MAX = 10;
export const API_KEY_CREATE_WINDOW_SEC = 60 * 60;

export const API_KEY_REVOKE_BUCKET = "api_key_revoke_user_hour";
export const API_KEY_REVOKE_MAX = 30;
export const API_KEY_REVOKE_WINDOW_SEC = 60 * 60;

export const API_KEY_RESPONSE_FIELDS = [
  "id",
  "name",
  "prefix",
  "scopes",
  "created_at",
  "last_used_at",
  "revoked_at",
] as const;

const CREATE_FIELDS = ["name", "scopes"] as const;
const KEY_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NON_PRINTABLE = /[\u0000-\u001F\u007F-\u009F]/;

export interface ApiKeyResponse {
  id: string;
  name: string | null;
  prefix: string;
  scopes: ApiScope[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface BrandKeySession {
  brandId: string;
  apiAccess: boolean;
}

export class KeySettingsError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "KeySettingsError";
    this.status = status;
  }
}

export function brandHasApiAccess(plan: unknown): boolean {
  if (typeof plan !== "string" || !Object.hasOwn(PLANS, plan)) return false;
  return PLANS[plan as PlanId].features.apiAccess;
}

export function apiKeyCreateRules(userId: string): RateLimitRule[] {
  return [
    {
      bucket: API_KEY_CREATE_BUCKET,
      key: userId,
      max: API_KEY_CREATE_MAX,
      windowSeconds: API_KEY_CREATE_WINDOW_SEC,
    },
  ];
}

export function apiKeyRevokeRules(userId: string): RateLimitRule[] {
  return [
    {
      bucket: API_KEY_REVOKE_BUCKET,
      key: userId,
      max: API_KEY_REVOKE_MAX,
      windowSeconds: API_KEY_REVOKE_WINDOW_SEC,
    },
  ];
}

export function toApiKeyResponse(record: ApiKeyRecord): ApiKeyResponse {
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    scopes: [...record.scopes],
    created_at: record.createdAt,
    last_used_at: record.lastUsedAt,
    revoked_at: record.revokedAt,
  };
}

export function assertSameOrigin(request: Request): void {
  const originHeader = request.headers.get("origin");
  if (!originHeader) {
    throw new KeySettingsError(403, "Forbidden");
  }
  let originHost: string;
  let requestHost: string;
  try {
    originHost = new URL(originHeader).host;
    requestHost = new URL(request.url).host;
  } catch {
    throw new KeySettingsError(403, "Forbidden");
  }
  if (!originHost || originHost !== requestHost) {
    throw new KeySettingsError(403, "Forbidden");
  }
}

export function assertUnderActiveCap(keys: readonly ApiKeyRecord[]): void {
  const active = keys.filter((key) => key.revokedAt == null).length;
  if (active >= ACTIVE_API_KEY_CAP) {
    throw new KeySettingsError(409, ACTIVE_API_KEY_CAP_MESSAGE);
  }
}

export function isKeyId(value: string): boolean {
  return KEY_ID.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseApiKeyCreateBody(body: unknown): {
  name: string;
  scopes: ApiScope[];
} {
  if (!isRecord(body)) {
    throw new KeySettingsError(422, "Name is required.");
  }
  for (const key of Object.keys(body)) {
    if (!(CREATE_FIELDS as readonly string[]).includes(key)) {
      throw new KeySettingsError(422, `Unknown field ${key}.`);
    }
  }
  return {
    name: parseName(body.name),
    scopes: parseScopes(body.scopes),
  };
}

function parseName(value: unknown): string {
  if (typeof value !== "string") {
    throw new KeySettingsError(422, "Name is required.");
  }
  const name = value.trim();
  if (!name) {
    throw new KeySettingsError(422, "Name is required.");
  }
  if (name.length > API_KEY_NAME_MAX || NON_PRINTABLE.test(name)) {
    throw new KeySettingsError(
      422,
      "Name must be 1 to 60 printable characters."
    );
  }
  return name;
}

function parseScopes(value: unknown): ApiScope[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new KeySettingsError(422, "Choose at least one scope.");
  }
  if (value.length > API_SCOPES.length * 4) {
    throw new KeySettingsError(422, "Unknown API scope.");
  }
  const scopes: ApiScope[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !isApiScope(item)) {
      throw new KeySettingsError(422, "Unknown API scope.");
    }
    if (!scopes.includes(item)) scopes.push(item);
  }
  return scopes;
}

export async function readCreateBody(request: Request): Promise<{
  name: string;
  scopes: ApiScope[];
}> {
  const declared = request.headers.get("content-length");
  if (declared !== null && declared.trim() !== "") {
    if (!/^\d+$/.test(declared.trim()) || Number(declared) > API_KEY_CREATE_MAX_BODY_BYTES) {
      throw new KeySettingsError(413, "Request body is too large.");
    }
  }
  const mime = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime !== "application/json") {
    throw new KeySettingsError(415, "Request body must be JSON.");
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > API_KEY_CREATE_MAX_BODY_BYTES) {
    throw new KeySettingsError(413, "Request body is too large.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new KeySettingsError(400, "Invalid JSON");
  }
  return parseApiKeyCreateBody(parsed);
}

export async function loadBrandKeySettings(): Promise<BrandKeySession> {
  const user = await getAuthenticatedUser();
  if (!user?.id) {
    throw new KeySettingsError(401, "Unauthorized");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("role, plan")
    .eq("id", user.id)
    .single();

  if (error && error.code !== "PGRST116") {
    console.warn("[api-keys] profile read failed:", error.code ?? "unknown");
    throw new KeySettingsError(503, "unavailable");
  }

  const row = data as { role?: unknown; plan?: unknown } | null;
  if (row?.role !== "brand") {
    throw new KeySettingsError(403, "Forbidden");
  }

  return {
    brandId: user.id,
    apiAccess: brandHasApiAccess(row.plan),
  };
}

/**
 * Revoke one key owned by this brand. revokeKey returns an already
 * revoked row instead of failing, so a revoked or foreign id is 404
 * before that write.
 */
export async function revokeOwnedKey(
  brandId: string,
  keyId: string
): Promise<ApiKeyRecord> {
  if (!isKeyId(keyId)) {
    throw new KeySettingsError(404, "Not found");
  }
  let existing: ApiKeyRecord | undefined;
  try {
    const keys = await listKeys(brandId);
    existing = keys.find((key) => key.id === keyId);
  } catch (err) {
    if (err instanceof ApiKeyError) {
      console.warn("[api-keys] revoke list failed:", err.name);
      throw new KeySettingsError(500, "API key request failed.");
    }
    throw err;
  }
  if (!existing || existing.revokedAt) {
    throw new KeySettingsError(404, "Not found");
  }

  try {
    const revoked = await revokeKey(keyId, brandId);
    if (!revoked.revokedAt) {
      throw new KeySettingsError(404, "Not found");
    }
    return revoked;
  } catch (err) {
    if (err instanceof KeySettingsError) throw err;
    if (err instanceof ApiKeyError && err.message === "API key was not found.") {
      throw new KeySettingsError(404, "Not found");
    }
    if (err instanceof ApiKeyError) {
      console.warn("[api-keys] revoke failed:", err.name);
      throw new KeySettingsError(500, "API key request failed.");
    }
    throw err;
  }
}

export function keySettingsJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function keySettingsErrorResponse(err: unknown): NextResponse {
  if (err instanceof KeySettingsError) {
    return keySettingsJson({ error: err.message }, err.status);
  }
  if (err instanceof ApiKeyError) {
    if (err.message === "API key was not found.") {
      return keySettingsJson({ error: "Not found" }, 404);
    }
    console.warn("[api-keys] failed:", err.name);
    return keySettingsJson({ error: "API key request failed." }, 500);
  }
  console.warn(
    "[api-keys] failed:",
    err instanceof Error ? err.name : "unknown"
  );
  return keySettingsJson({ error: "API key request failed." }, 500);
}
