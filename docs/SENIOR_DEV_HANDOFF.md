# Senior dev handoff

## A1: API keys and request plumbing for the public API (migration 057)

### What was built

Per-brand API keys and the request plumbing for `/api/v1`. A key is a bearer token `ts_live_<prefix>_<secret>`. The secret comes from `crypto.randomBytes` and is returned once from `createKey`. The database stores a SHA-256 hex digest of the full token plus the prefix used for lookup. Keys are revocable. `/api/v1` requests resolve through `Authorization: Bearer`, compare digests in constant time, reject revoked keys, and write an `api_call` row via `recordEvent`. A Postgres counter on `api_rate_windows` limits each key to 60 requests per UTC minute. The only route is `GET /api/v1/health`.

Plan gating is not applied here. `features.apiAccess` in `lib/billing/plans.ts` is unchanged and unread.

### Where

- `supabase/migrations/057_api_keys.sql` (not applied)
- `supabase/migrations/057_api_keys.test.ts`
- `lib/api/keys.ts`
- `lib/api/auth.ts`
- `lib/api/rate-limit.ts`
- `lib/api/memory-admin.ts` (unit-test double only)
- `lib/api/public-api.test.ts`
- `app/api/v1/health/route.ts`
- `app/api/v1/health/route.test.ts`
- `proxy.ts` (explicit `/api/v1` allowance; `/api/*` stays public)

### Tests

`npx vitest run supabase/migrations/057_api_keys.test.ts lib/api app/api/v1 proxy.test.ts`

Covers the migration grants, revokes, RLS, and the select policy; key create, list, and revoke; resolver 401s; scope 403; the per-minute counter and 429 `Retry-After`; health 401, 403, 429, 200, and 500; and the signed-out proxy allowlist.

### Known gaps

- Migration 057 is not applied. Apply on `ldtmhafewfifdizgfrnn` only after merge and Chris's OK, then run the introspection query in the file header.
- No settings UI (A4) and no data endpoints (A2).
- No plan check. Operator `apiAccess` is for A7.
- The limit is 60 requests per minute per key, in code, not an env var.
- `lib/utils/rate-limit.ts` is still the in-process limiter for outreach actions.
- `last_used_at` is best-effort. A failed touch does not fail the request.
- Old rate windows for a key are deleted on that key's next increment once they are an hour old. Windows for idle keys stay until the key is used again or the key row is deleted.
- `listKeys` and `revokeKey` are service-role helpers. Nothing in the app calls them yet.
