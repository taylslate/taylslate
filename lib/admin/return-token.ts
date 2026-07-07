// Return-to-admin opaque token (impersonation Layer 3).
//
// When founder impersonation starts (POST /api/admin/test-login) we mint a
// crypto-strength opaque token with NO payload. The raw token lives only in an
// httpOnly cookie; its sha256 hash is stored in the originating admin.impersonate
// domain_events row. POST /api/admin/return-to-admin hashes the cookie value and
// looks the event up by hash — so the audit log at rest never contains a usable
// bearer token, and the token resolves to the admin identity via the database
// (the event's actor_id), never via any cookie contents.
//
// Single source of truth for the cookie name, TTL, and hashing so the mint path
// (test-login) and the redeem path (return-to-admin) can never drift.

import { createHash, randomBytes } from "crypto";

// httpOnly, Secure, SameSite=Lax cookie carrying the raw opaque token. Distinct
// from the legacy plaintext `tslate_impersonation_origin` cookie, which is
// zero-authority (banner label only) and must never be trusted by the redeem path.
export const RETURN_TOKEN_COOKIE = "tslate_return_token";

// 8h. Enforced server-side on the event's created_at in the redeem path; also
// set as the cookie maxAge as a client-side hint.
export const RETURN_TOKEN_TTL_SECONDS = 8 * 60 * 60;

// 256 bits of randomness, url-safe. No structure — the token is purely a lookup
// key; all authority is resolved server-side from the event it points at.
export function mintReturnToken(): string {
  return randomBytes(32).toString("base64url");
}

// sha256 hex. What we persist in the event payload and what we match a presented
// cookie against. Storing the hash (not the raw token) keeps the audit log from
// being a source of live capability tokens.
export function hashReturnToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// Deterministic id for the admin.impersonation_ended sentinel row, derived from
// the originating admin.impersonate event id. domain_events.id is the primary
// key, so inserting the sentinel with this id makes single-use ATOMIC: a second
// redeem (concurrent or sequential, even after a prior fail-soft audit miss)
// collides on the PK (SQLSTATE 23505) instead of racing a check-then-write. The
// value is a UUID-shaped sha256 digest — Postgres `uuid` accepts any 8-4-4-4-12
// hex string; version/variant bits are irrelevant here since it's a lookup key,
// not an RFC-4122 identifier.
export function impersonationEndedEventId(impersonateEventId: string): string {
  const h = createHash("sha256")
    .update(`admin.impersonation_ended:${impersonateEventId}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
