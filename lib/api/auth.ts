// Resolves Authorization: Bearer ts_live_<prefix>_<secret> to a brand.
// Lookup is by prefix. The digest is compared in constant time. Revoked
// keys are rejected. A resolved call writes an api_call event_log row.

import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { recordEvent } from "@/lib/data/event-log";
import {
  hashKey,
  parseApiToken,
  scopesFromDb,
  type ApiScope,
} from "@/lib/api/keys";

export interface ResolvedApiRequest {
  brandId: string;
  scopes: ApiScope[];
  keyId: string;
}

export class ApiAuthError extends Error {
  readonly status: 401 | 403;

  constructor(status: 401 | 403, message: string) {
    super(message);
    this.name = "ApiAuthError";
    this.status = status;
  }
}

interface KeyAuthRow {
  id: string;
  brand_id: string;
  key_hash: string;
  scopes: unknown;
  revoked_at: string | null;
}

interface DbError {
  code?: string;
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

function hashesMatch(presented: string, stored: string): boolean {
  const left = Buffer.from(presented);
  const right = Buffer.from(stored);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function requestPath(req: Request): string {
  try {
    return new URL(req.url).pathname;
  } catch {
    return "";
  }
}

// Equal-length stand-in so a missing row still runs a full compare.
const DUMMY_HASH = hashKey(
  "ts_live_0000000000000000_0000000000000000000000000000000000000000000000000000000000000000"
);

export async function resolveApiRequest(req: Request): Promise<ResolvedApiRequest> {
  const token = bearerToken(req);
  const parsed = token ? parseApiToken(token) : null;
  if (!token || !parsed) {
    throw new ApiAuthError(401, "Missing or invalid API key.");
  }

  const presented = hashKey(token);
  const { data, error } = await supabaseAdmin
    .from("api_keys")
    .select("id, brand_id, key_hash, scopes, revoked_at")
    .eq("prefix", parsed.prefix)
    .maybeSingle();

  if (error) {
    console.warn("[api.auth] lookup failed:", (error as DbError).code ?? "unknown");
    throw new Error("API key lookup failed.");
  }

  const row = data as KeyAuthRow | null;
  const stored =
    typeof row?.key_hash === "string" && row.key_hash.length === presented.length
      ? row.key_hash
      : DUMMY_HASH;
  const match = hashesMatch(presented, stored);
  if (!row || !match) {
    throw new ApiAuthError(401, "Invalid API key.");
  }
  if (row.revoked_at) {
    throw new ApiAuthError(401, "API key is revoked.");
  }

  const { error: touchError } = await supabaseAdmin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id);
  if (touchError) {
    console.warn(
      "[api.auth] last_used_at update failed:",
      (touchError as DbError).code ?? "unknown"
    );
  }

  const scopes = scopesFromDb(row.scopes);
  await recordEvent({
    customerId: row.brand_id,
    operationType: "api_call",
    metadata: {
      key_id: row.id,
      path: requestPath(req),
      scopes,
    },
  });

  return { brandId: row.brand_id, scopes, keyId: row.id };
}

export function requireScope(resolved: ResolvedApiRequest, scope: ApiScope): void {
  if (!resolved.scopes.includes(scope)) {
    throw new ApiAuthError(403, "API key lacks the required scope.");
  }
}
