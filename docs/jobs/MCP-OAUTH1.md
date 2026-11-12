# MCP-OAUTH1: OAuth 2.1 for remote MCP clients

Migration 092 is in the repo only. It was not applied.

## What shipped

A remote MCP client can discover Taylslate, register as a public client, send the brand through a consent screen, and call `POST /api/v1/mcp` with an access token. Bearer keys (`ts_live_`) are unchanged on this route and on every other `/api/v1` route.

```
client                Taylslate                         brand
  |  GET /.well-known/oauth-protected-resource
  |  GET /.well-known/oauth-authorization-server
  |  POST /api/oauth/register
  |  GET  /api/oauth/authorize  (PKCE S256)
  |                     302 /oauth/consent/<id>
  |                                                    sign in, Allow or Deny
  |  redirect ?code&state&iss
  |  POST /api/oauth/token
  |  POST /api/v1/mcp   Authorization: Bearer ts_oat_...
  |  POST /api/oauth/token   grant_type=refresh_token
  |  POST /api/oauth/revoke
```

Allow creates one `api_keys` row named `MCP: <client name>`. The plaintext `ts_live_` secret from that row is discarded. Disconnect is the existing revoke control in Settings, API keys. The resolver and the refresh grant both check `api_keys.revoked_at`.

## Tables

`092_mcp_oauth.sql` adds four tables. service_role only. RLS on, no policy, no function, no view, no change to an existing table.

- `mcp_oauth_clients`: public `client_id` (`tsc_` + 32 hex), name, 1 to 5 redirect URIs. No secret column.
- `mcp_oauth_requests`: one authorize attempt. 10 minute expiry. Consumed once.
- `mcp_oauth_codes`: SHA-256 of the code. 5 minute expiry. Single use.
- `mcp_oauth_tokens`: SHA-256 of access (`ts_oat_`) and refresh (`ts_ort_`). Access 1 hour. Refresh 30 days. `family_id` groups a rotation chain. `api_key_id` points at the backing key.

Grants, on each table: revoke all from public, anon, authenticated, and service_role; grant select, insert, update, delete to service_role; revoke truncate, references, trigger from authenticated, anon, and public.

## Rate limits

Closed. A store error is 503 `{ "error": "unavailable" }`, which is not the OAuth `temporarily_unavailable` body.

| Bucket | Limit |
| --- | --- |
| `mcp_oauth_register_ip_hour` | 10 per IP per hour |
| `mcp_oauth_register_ip_day` | 50 per IP per day |
| `mcp_oauth_authorize_ip_hour` | 60 per IP per hour |
| `mcp_oauth_consent_user_hour` | 20 per user per hour |
| `mcp_oauth_token_ip_min` | 30 per IP per minute |
| `mcp_oauth_token_client_hour` | 300 per client id per hour |
| `mcp_oauth_revoke_ip_min` | 30 per IP per minute |

The MCP route still uses the backing key's 60 per minute bucket. Every token on that grant shares it.

## Deploy before 092

Code can ship before the migration is applied.

- Metadata routes never touch the database.
- Every OAuth table call goes through `oauth()` in `lib/mcp-oauth/errors.ts`. Any error, including `42P01` and `PGRST205`, becomes 503 `{ "error": "temporarily_unavailable" }`. The log line is the error code only.
- A `ts_live_` token never reads an OAuth table.
- A `ts_oat_` token on `/api/v1/mcp` before 092 is 503 `{ "error": "API request failed." }`.
- A `ts_oat_` token on any other `/api/v1` route stays 401, because `lib/api/auth.ts` is not edited.

## Where

- `supabase/migrations/092_mcp_oauth.sql` and `092_mcp_oauth.test.ts`
- `lib/mcp-oauth/*` (config, pkce, tokens, clients, authorize, consent, grants, resolve, errors, copy)
- `app/.well-known/oauth-protected-resource/route.ts` and `[...path]/route.ts`
- `app/.well-known/oauth-authorization-server/route.ts`
- `app/api/oauth/register`, `authorize`, `consent`, `token`, `revoke`
- `app/oauth/consent/[requestId]/page.tsx` and `consent-client.tsx`
- `app/api/v1/mcp/route.ts` (bearer dispatch and the 401 header only)
- `proxy.ts` (three public `/.well-known` lines)
- `docs/api/MCP.md`, `docs/jobs/M1.md` (one known-gap line)

`lib/api/auth.ts`, `lib/api/keys.ts`, `lib/api/plan-gate.ts`, `lib/api/rate-limit.ts`, `lib/security/rate-limit.ts`, `lib/mcp/*`, `lib/stripe`, `lib/payouts`, `lib/billing`, `lib/airchecks`, and settings pages were not edited.

## Tests

Vitest with Supabase, the rate-limit RPC, `createKey`, and `recordEvent` mocked. Covers PKCE S256 and `timingSafeEqual`, single-use and expired codes, refresh rotation and family revoke, revoked keys, plans without API access, scope intersection, registration rejects, authorize redirect rules, consent session and origin checks, rate-limit 429 and closed 503, no plaintext in inserts, no database text in bodies, proxy allowlist, and both metadata documents.

## Known gaps

- Consent copy shipped as written. Chris can change it.
- Migration 092 is not applied.
- Public clients only. No client secret, no `plain` PKCE, no implicit grant, no password grant, no client credentials.
- Access tokens work only on `POST /api/v1/mcp`.
- Disconnect is revoking the API key. There is no separate OAuth list in Settings.
- Two refreshes that both pass the unused check can race. The loser revokes the family. A sequential reuse already revokes it.
- No captcha. The rate limits are the only brake.
