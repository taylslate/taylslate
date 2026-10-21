// Per-brand public API keys. The bearer token is returned once from
// createKey and is never stored. The row keeps a SHA-256 hex digest
// and a public prefix used for lookup. All writes use service_role.

import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

const PREFIX_BYTES = 8;
const SECRET_BYTES = 32;
const CREATE_ATTEMPTS = 3;

export const API_SCOPES = ["read", "write:campaigns", "write:outreach"] as const;

export type ApiScope = (typeof API_SCOPES)[number];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PUBLIC_COLUMNS =
  "id, brand_id, name, prefix, scopes, created_at, last_used_at, revoked_at";

export interface ApiKeyRecord {
  id: string;
  brandId: string;
  name: string | null;
  prefix: string;
  scopes: ApiScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreatedApiKey extends ApiKeyRecord {
  /** Full bearer token. Returned once. Not stored. */
  secret: string;
}

interface ApiKeyDbRow {
  id: string;
  brand_id: string;
  name: string | null;
  prefix: string;
  scopes: string[] | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface DbError {
  message?: string;
  code?: string;
}

export class ApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiKeyError";
  }
}

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

export function generateKey(): { token: string; prefix: string; secret: string } {
  const prefix = randomBytes(PREFIX_BYTES).toString("hex");
  const secret = randomBytes(SECRET_BYTES).toString("hex");
  return { token: `ts_live_${prefix}_${secret}`, prefix, secret };
}

export function hashKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function parseApiToken(token: string): { prefix: string } | null {
  const match = /^ts_live_([0-9a-f]{16})_([0-9a-f]{64})$/.exec(token);
  if (!match) return null;
  return { prefix: match[1] };
}

export function scopesFromDb(value: unknown): ApiScope[] {
  if (!Array.isArray(value)) return [];
  const scopes: ApiScope[] = [];
  for (const item of value) {
    if (typeof item === "string" && isApiScope(item) && !scopes.includes(item)) {
      scopes.push(item);
    }
  }
  return scopes;
}

function assertBrandId(brandId: string): void {
  if (!UUID_RE.test(brandId)) {
    throw new ApiKeyError("API key needs a brand id.");
  }
}

function assertScopes(scopes: readonly string[]): ApiScope[] {
  if (scopes.length === 0) {
    throw new ApiKeyError("API key needs at least one scope.");
  }
  const unique: ApiScope[] = [];
  for (const scope of scopes) {
    if (!isApiScope(scope)) {
      throw new ApiKeyError("Unknown API scope.");
    }
    if (!unique.includes(scope)) unique.push(scope);
  }
  return unique;
}

function cleanName(name: string | null | undefined): string | null {
  if (name == null) return null;
  const trimmed = name.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function toRecord(row: ApiKeyDbRow): ApiKeyRecord {
  return {
    id: row.id,
    brandId: row.brand_id,
    name: row.name,
    prefix: row.prefix,
    scopes: scopesFromDb(row.scopes),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

export async function createKey(input: {
  brandId: string;
  name?: string | null;
  scopes: readonly string[];
}): Promise<CreatedApiKey> {
  assertBrandId(input.brandId);
  const scopes = assertScopes(input.scopes);
  const name = cleanName(input.name);

  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
    const generated = generateKey();
    const { data, error } = await supabaseAdmin
      .from("api_keys")
      .insert({
        brand_id: input.brandId,
        name,
        prefix: generated.prefix,
        key_hash: hashKey(generated.token),
        scopes,
      })
      .select(PUBLIC_COLUMNS)
      .single();

    if (!error && data) {
      return { ...toRecord(data as ApiKeyDbRow), secret: generated.token };
    }
    if ((error as DbError | null)?.code !== "23505") {
      console.warn(
        "[api.keys] create failed:",
        (error as DbError | null)?.code ?? "unknown"
      );
      throw new ApiKeyError("API key could not be created.");
    }
  }

  throw new ApiKeyError("API key could not be created.");
}

export async function listKeys(brandId: string): Promise<ApiKeyRecord[]> {
  assertBrandId(brandId);
  const { data, error } = await supabaseAdmin
    .from("api_keys")
    .select(PUBLIC_COLUMNS)
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false });

  if (error || !data) {
    console.warn("[api.keys] list failed:", (error as DbError | null)?.code ?? "unknown");
    throw new ApiKeyError("API keys could not be listed.");
  }
  return (data as ApiKeyDbRow[]).map(toRecord);
}

export async function revokeKey(
  keyId: string,
  brandId: string
): Promise<ApiKeyRecord> {
  assertBrandId(brandId);
  if (!UUID_RE.test(keyId)) {
    throw new ApiKeyError("API key was not found.");
  }

  const revokedAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("api_keys")
    .update({ revoked_at: revokedAt })
    .eq("id", keyId)
    .eq("brand_id", brandId)
    .is("revoked_at", null)
    .select(PUBLIC_COLUMNS)
    .maybeSingle();

  if (error) {
    console.warn("[api.keys] revoke failed:", (error as DbError | null)?.code ?? "unknown");
    throw new ApiKeyError("API key could not be revoked.");
  }
  if (data) return toRecord(data as ApiKeyDbRow);

  const { data: existing, error: readError } = await supabaseAdmin
    .from("api_keys")
    .select(PUBLIC_COLUMNS)
    .eq("id", keyId)
    .eq("brand_id", brandId)
    .maybeSingle();

  if (readError) {
    console.warn(
      "[api.keys] revoke read failed:",
      (readError as DbError | null)?.code ?? "unknown"
    );
    throw new ApiKeyError("API key could not be revoked.");
  }
  if (!existing) {
    throw new ApiKeyError("API key was not found.");
  }
  return toRecord(existing as ApiKeyDbRow);
}
