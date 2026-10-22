# Senior dev handoff

## I2: Past-campaign parse API

### What was built

`POST /api/deals/import` accepts `mode=past_campaign` (form field or query) and returns drafts only. The branch requires a signed-in brand or agency, same as the save route. CSV and XLSX go through `callLLMWithFallback` and `lib/prompts/past-campaign-mapping.md` to map columns. Past-campaign PDFs call `createLLMClient()` from `lib/llm/client.ts` and pass model `claude-sonnet-4-20250514` explicitly, then `dealsFromImportedIO`. That model matches the older IO PDF path. The older path still constructs its own client and is unchanged.

`POST /api/imports/past-campaigns` saves one `past_campaign_imports` row and its `past_campaign_records` for the signed-in brand or agency. `brand_id` is the session user on both rows (composite FK). A `brand_id` in the body is ignored. `matched_show_id` is an exact case-insensitive show-name hint: one match is stored, zero or several stay empty. The hint is not a write to `shows`.

Limits on parse: 10MB, 2,000 data rows, extension plus MIME. An XLSX is rejected before exceljs loads it when the inflated zip entries exceed 32MB (`lib/imports/xlsx-limit.ts`), including a stream that under-reports its size in the zip header. Save status is `confirmed`. `pooling_consent` defaults to false, and `terms_version` is stored only when consent is true.

### Where

- `lib/imports/csv.ts`
- `lib/imports/xlsx-limit.ts`
- `lib/imports/past-campaigns.ts`
- `lib/imports/fixtures/past-campaign.csv`
- `lib/imports/fixtures/past-campaign.pdf`
- `lib/prompts/past-campaign-mapping.md`
- `app/api/deals/import/route.ts` (new branch only)
- `app/api/imports/past-campaigns/route.ts`
- `package.json` / `package-lock.json` (`exceljs@4.4.0`, regenerated from the main lockfile). Existing locked package versions are unchanged. Where an exceljs dependency needs a newer copy, that copy is nested under the new package.

### Tests

`npx vitest run lib/imports app/api/deals/import app/api/imports`

Covers CSV, XLSX (first sheet only), and PDF fixtures with a mocked LLM, the old IO response shape, body `brand_id` ignored, and both 054 tables written under the session brand. Supabase is mocked. No live writes.

### Known gaps

- Migration 054 is in the repo and is not applied. Save will fail against the live database until Chris applies it after merge.
- No UI in this job. The older IO PDF and manual JSON paths stay open without a session. `mode=past_campaign` and the save route require a brand or agency session.
- XLSX reads the first worksheet only. A sheet whose dimension is more than 7,000 rows is rejected.
- PDF drafts follow `dealsFromImportedIO`: one row per show, price and downloads taken from the first line item. Conversions are empty because an IO does not carry them.
- `matched_show_id` is a hint. A failed or ambiguous name lookup leaves it empty and still saves the row.
- `exceljs` is imported directly. `next.config.ts` was not changed.
- CSV MIME must be `text/csv`, `application/csv`, `text/plain`, or `application/vnd.ms-excel`. XLSX must be the Open XML sheet MIME. `application/octet-stream` is rejected.

## M0

### What was built

An admin-only clickable mockup of the pending screens, so they can be signed off before any of those UI jobs start. Every page checks `isInternalAdmin` on the server and calls `notFound()` otherwise. Data comes from static fixtures. Buttons update React state in the browser only. Every page shows the banner "Mockup. Nothing here is saved."

Surfaces:

- CRM index, with a Free upgrade card. Starter and Operator previews open the show list. `canUseCrm` is mirrored locally as `previewCanUseCrm` (Starter, Operator, and the legacy agency id).
- Per-show CRM: Contacts (add, edit, remove), Notes (add, remove), and read-only Deal history with placement, episodes, CPM, total, and flight.
- Past campaign import: choose CSV, XLSX, or PDF, name a file, edit sample rows, see an advisory catalog suggestion, accept or skip pooling consent (`pooling-v1`), then a confirmed summary. Discard is local too.
- Rep roster: Exclusive starts on and can be turned off. Rep deals for roster links show status and flight only. Per-show view repeats that, plus the exclusive switch. Roster CSV upload parses show names in the browser, previews them as pending with Exclusive on, and can be confirmed locally.
- Roster requests: pending, approved, and rejected, with approve and reject.
- API keys: create with scopes, show the secret once, hide it, revoke, and show last used.
- Approvals: pending actions with approve and reject.

### Where

- `app/(dashboard)/admin/mockups/page.tsx` at `/admin/mockups`
- `app/(dashboard)/admin/mockups/crm/page.tsx` at `/admin/mockups/crm`
- `app/(dashboard)/admin/mockups/crm/[showId]/page.tsx` at `/admin/mockups/crm/[showId]`
- `app/(dashboard)/admin/mockups/import/page.tsx` at `/admin/mockups/import`
- `app/(dashboard)/admin/mockups/rep/page.tsx` at `/admin/mockups/rep`
- `app/(dashboard)/admin/mockups/rep/deals/page.tsx` at `/admin/mockups/rep/deals`
- `app/(dashboard)/admin/mockups/rep/shows/[showId]/page.tsx` at `/admin/mockups/rep/shows/[showId]`
- `app/(dashboard)/admin/mockups/rep/upload/page.tsx` at `/admin/mockups/rep/upload`
- `app/(dashboard)/admin/mockups/roster-requests/page.tsx` at `/admin/mockups/roster-requests`
- `app/(dashboard)/admin/mockups/api-keys/page.tsx` at `/admin/mockups/api-keys`
- `app/(dashboard)/admin/mockups/approvals/page.tsx` at `/admin/mockups/approvals`
- Fixtures and the admin gate: `app/(dashboard)/admin/mockups/fixtures.ts`, `app/(dashboard)/admin/mockups/require-admin.ts`
- Shared Ink & Gold chrome: `app/(dashboard)/admin/mockups/chrome.tsx`

The index is not in the sidebar. `lib/nav/items.ts` was left alone. Open `/admin/mockups` while signed in as an internal admin.

### Tests

`npx vitest run "app/(dashboard)/admin/mockups"` (26 tests).

- `require-admin.test.ts`: signed-out and non-admin sessions 404; an allowlisted email passes. The helper is the real `isInternalAdmin`.
- `mockups.test.tsx`: each route renders the banner, an unknown show id 404s after the admin check, rendered text has no em dash, and the click paths stay local (upgrade card, contact and note, import through consent, exclusive toggle, CSV preview, roster approve/reject, API key shown once then hidden, approval approve/reject). Rep deals render no dollar amounts.

### Known gaps

- Nothing is saved. There is no database read or write, no server action, and no request from these pages. A refresh restores the fixtures.
- The import review always loads sample rows, including after a real file is chosen, so CSV, XLSX, and PDF can be clicked through without a parser. The roster CSV screen does read a chosen text file in the browser.
- The Free upgrade button only switches this preview to Starter. It does not bill.
- The client does not import `lib/entitlements/plan.ts`, because that module opens a server client. `previewCanUseCrm` matches `canUseCrm`.
- Rep deal fixtures have no amount fields, so that screen cannot show CPM, rate, or spend.
- Sidebar entry, real persistence, file parsing for XLSX and PDF, and wiring approve/reject to roster status are later jobs. Migrations 053, 054, and 055 are not applied here. The fixtures follow their column shapes only.

## A1: API keys and request plumbing for the public API (migration 057)

### What was built

Per-brand API keys and the request plumbing for `/api/v1`. A key is a bearer token `ts_live_<prefix>_<secret>`. The secret comes from `crypto.randomBytes` and is returned once from `createKey`. The database stores a SHA-256 hex digest of the full token plus the prefix used for lookup. Keys are revocable. `/api/v1` requests resolve through `Authorization: Bearer`, compare digests in constant time, reject revoked keys, and write an `api_call` row via `recordEvent`. A Postgres counter on `api_rate_windows` limits each key to 60 requests per UTC minute. The only route is `GET /api/v1/health`.

`authenticated` may select `id`, `brand_id`, `name`, `prefix`, `scopes`, `created_at`, `last_used_at`, and `revoked_at` on its own rows. `key_hash` is revoked from that role. Writes stay on `service_role`.

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
- `proxy.ts` (`pathname === "/api/v1" || pathname.startsWith("/api/v1/")`; `/api/*` stays public)

### Tests

`npx vitest run supabase/migrations/057_api_keys.test.ts lib/api app/api/v1 proxy.test.ts`

Covers the migration grants, revokes, RLS, and the select policy; authenticated column select that omits `key_hash`; key create, list, and revoke; resolver 401s; scope 403; the per-minute counter and 429 `Retry-After`; health 401, 403, 429, 200, and 500; and the signed-out proxy allowlist.

### Known gaps

- Migration 057 is not applied. Apply on `ldtmhafewfifdizgfrnn` only after merge and Chris's OK, then run the introspection query in the file header.
- No settings UI (A4) and no data endpoints (A2).
- No plan check. Operator `apiAccess` is for A7.
- The limit is 60 requests per minute per key, in code, not an env var.
- `lib/utils/rate-limit.ts` is still the in-process limiter for outreach actions.
- `last_used_at` is best-effort. A failed touch does not fail the request.
- Old rate windows for a key are deleted on that key's next increment once they are an hour old. Windows for idle keys stay until the key is used again or the key row is deleted.
- `listKeys` and `revokeKey` are service-role helpers. Nothing in the app calls them yet.

## R2: Rep store and API

### What was built

Rep read API for roster, participant deals, and one approved show. `importShows` no longer takes an agent id. It reads the signed-in user, requires role `agent`, and writes the roster link as service role with status `pending`, source `import`, and `is_exclusive` true unless the row sets `is_exclusive` to false. A body `agent_id` is not written onto the show or the link.

`GET /api/reps/roster`, `GET /api/reps/deals`, and `GET /api/reps/shows/[showId]` take the agent id from the session. A missing session is 401. Any other role is 403. Query, body, and headers are ignored.

An approved roster link can read that show's deals as id, status, flight_start, flight_end, and brand display name. Brand display name is `brand_profiles.brand_name`, then `profiles.company_name`, then `profiles.full_name`. Price, CPM, totals, and payment fields are not selected. Pending and rejected links see none of that, and the show route returns 404. `GET /api/reps/deals` is the participant list (`deals.agent_id`), the full row, same as a deal the rep is already on.

No migration and no RLS change. Roster-show deals are not visible under deals RLS, so that read uses the service role only after `getAgentShowRelationship` returns an approved link.

### Where

- `lib/reps/store.ts`
- `lib/reps/session.ts`
- `lib/reps/store.test.ts`
- `app/api/reps/roster/route.ts`
- `app/api/reps/deals/route.ts`
- `app/api/reps/shows/[showId]/route.ts`
- `lib/data/queries.ts` (`importShows` only)
- `app/api/shows/import/route.ts`
- `lib/data/roster-links.test.ts`

### Tests

`npx vitest run lib/reps lib/data/roster-links.test.ts app/api/reps app/api/shows/import` (32 passed). `npx tsc --noEmit` is clean. The full suite passed (1940).

Covers session binding, 403 for non-agents, exclusive default and an explicit false, pending and rejected links seeing nothing, and an approved link returning status and flight with no amount keys. Supabase is mocked. No live writes.

### Known gaps

- No page was added or changed. The admin mockups are still fixtures.
- 055 and 056 are applied. These reads select `status` and `source`.
- There is no single route that lists limited deals for every approved show. The show route is one show at a time.
- The per-show payload is name, platform, description, audience size, categories, and the approved link. Rate card and contact stay off this response.
- Approval of a pending import is still a later job. This PR does not add a roster write other than the import fix.
