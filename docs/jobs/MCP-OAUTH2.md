# MCP-OAUTH2: OAuth connector follow-ups and consent screenshots

Follow-ups from the PR 110 review. No migration. Migration 092 is in the repo and is still not applied.

## What shipped

- Client names drop Unicode format characters (right-to-left override, zero-width joiner, and the rest of `\p{Cf}`) along with control characters, before the length check. A name that is only format characters is rejected.
- A redirect omits any parameter whose value is empty, so a missing `state` does not become `state=`. A state that was sent, up to 500 characters, is echoed as sent. `iss` is still on every client redirect.
- Authorization server metadata advertises `authorization_response_iss_parameter_supported: true`.
- A family revoke (refresh replay, code replay, the refresh compare-and-set loser, the winner that sees the family already revoked, and `revokePresentedToken` for a refresh token) also sets `revoked_at` on the backing `api_keys` row. The update filters on the key id and on `brand_id` equal to the grant's user id, and only where `revoked_at` is null. Revoking one access token does not revoke the key. A failed key write is logged with a fixed message and does not change the HTTP response. The token rows are already revoked.
- After an OAuth access token passes the key, profile, and plan checks, `api_keys.last_used_at` is updated for that key id. A failed touch is logged with a fixed message and is not thrown.
- `/oauth/consent/:path*` sends `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`.
- Consent screenshots are in `docs/screenshots/MCP-OAUTH2/`.

## Screenshots

Taken with `npx next dev` from the real `/oauth/consent/[requestId]` page, so Tailwind, `lib/brand/tokens.css`, and the body font in `globals.css` were loaded. A throwaway harness stubbed the session and the request lookup with mocked states and was not committed. Nothing was written to the database. `proxy.ts` and the consent page are not in this diff.

- `01-consent-read.png`: read only, 1280 wide
- `02-consent-read-write.png`: read, write campaigns, and write outreach, 1280 wide
- `03-consent-expired.png`: expired or already-used request, 1280 wide
- `04-consent-plan-gate.png`: plan without API access, 1280 wide
- `05-consent-mobile.png`: read only, 390 wide

## Where

- `lib/mcp-oauth/clients.ts`, `authorize.ts` tests, `consent.ts` tests, `errors.ts`, `config.ts`, `grants.ts`, `resolve.ts`, `test-store.ts`, and their tests
- `app/api/oauth/token/route.test.ts`, `app/api/oauth/revoke/route.test.ts`
- `next.config.ts` (`headers()` only)
- `docs/screenshots/MCP-OAUTH2/`
- `docs/SENIOR_DEV_HANDOFF.md`

`proxy.ts`, `lib/stripe`, `lib/payouts`, `lib/billing`, `lib/airchecks`, `lib/api/auth.ts`, `lib/security/rate-limit.ts`, the consent page, and `supabase/migrations` were not edited. No migration.

## Tests

`npx tsc --noEmit` clean. `npx vitest run`: 432 files, 3634 passed, 41 skipped. `npx eslint` on changed files: 0 errors. `npx next build` compiled.

Security coverage: a name with a right-to-left override and a zero-width joiner comes back without them; a format-only name is rejected. A missing state is absent from the redirect; a sent state is echoed; `iss` is present. Each family revoke path revokes exactly that backing key. Another user's key with the same id is untouched. An access-token revoke leaves the key. A failed key write stays on the original status and logs a fixed message. `last_used_at` is set only after the plan check, and a failed touch is not thrown. `secret-db-text` from the token route (authorization code and refresh token), the revoke route, and the grants path is absent from response bodies and headers.

## Known gaps

- Migration 092 is not applied. Apply only after merge and Chris's OK.
- If the backing key write fails, the tokens are already revoked and the key can stay live until a later family revoke or Settings.
- Revoking one access token does not revoke the backing key.
- A missing or empty state is left off the redirect.
- Framing protection is only on `/oauth/consent/:path*`.
- No cleanup job. This PR does not merge. Paul reviews.
