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

## A2: Public API v1 read endpoints

### What was built

Brand-scoped read endpoints on the A1 key plumbing. `withApiRead` resolves the bearer key, enforces the per-key rate limit, then requires the `read` scope. A missing row and a row owned by another brand both return 404. Responses send `Cache-Control: no-store`.

Lists return `{ data, next_cursor }`. The cursor is an opaque base64url token over `(created_at, id)`, newest first. `limit` defaults to 25 and clamps at 100.

Shows are the discoverable catalog, plus shows linked from this brand's deals. `verified` is true only when `getVerifiedProfileTies` reports a tie. `shows.is_verified` is not copied. Campaigns match `campaigns.user_id`. Deals match `deals.brand_id`, or a `brand_profiles` row whose `user_id` is the key's brand (the Wave 12 path `getWave12DealsForBrand` filters, without selecting every column). Scores and the media plan load only after that campaign ownership check. Scores come from the latest `campaign_patterns` row.

Serializers build a new object field by field. Show responses use public catalog fields and rename the rate card to `rates`. Deal responses keep the rate the brand agreed to (`cpm_rate`, gross amounts, `agreed_cpm`) and leave out net amounts, notes, payment, payout, fee, envelope, and other party ids. `GET /api/v1/openapi.json` is an OpenAPI 3.1 document generated from those allowlists. It does not require a key.

### Where

- `lib/api/v1/handler.ts`
- `lib/api/v1/pagination.ts`
- `lib/api/v1/reads.ts`
- `lib/api/v1/serializers.ts`
- `lib/api/v1/openapi.ts`
- `app/api/v1/test-admin.ts` (unit-test double only)
- `app/api/v1/shows/route.ts`
- `app/api/v1/shows/[id]/route.ts`
- `app/api/v1/campaigns/route.ts`
- `app/api/v1/campaigns/[id]/route.ts`
- `app/api/v1/campaigns/[id]/scores/route.ts`
- `app/api/v1/campaigns/[id]/plan/route.ts`
- `app/api/v1/deals/route.ts`
- `app/api/v1/deals/[id]/route.ts`
- `app/api/v1/openapi.json/route.ts`

### Tests

`npx vitest run app/api/v1 lib/api`

Covers 401, 403, 429, and a generic 500; campaign and deal isolation (foreign rows are 404 and absent from lists); a non-discoverable show with no deal for this brand is 404; cursor round trip and the limit clamp; serializer keys equal the allowlists and none match `stripe|payment|payout|fee|card|setup_intent|envelope`; OpenAPI field lists match the serializers. Existing health and public-api tests still pass. No UI, so no screenshots.

### Known gaps

- No write endpoints, no MCP server, no settings UI, and no plan gating. Operator `apiAccess` stays A7. `lib/billing/plans.ts` is unchanged.
- No migration. Reads use the service role on tables that already exist.
- `lib/data` query helpers are not used. Session-scoped lists cannot run on an API key, and `getDealById` / `getWave12DealsForBrand` do not apply this owner filter with a column allowlist.
- Score lists follow the same `(created_at, id)` cursor as the other lists, not composite score order. They read the newest pattern only.
- A campaign with no saved plan returns `{ data: null }`. A campaign with no pattern returns an empty score page.
- The cursor keeps the stored timestamp string. A value that is not already a safe ISO timestamp is normalized with `toISOString`, which drops microseconds.
- Contact email is read only to pass into `getVerifiedProfileTies` and is not returned. `show_profiles.podscan_id` is not read.

## I4: Learning feed from past-campaign imports

### What was built

Confirmed past-campaign imports are now a private signal in that brand's discovery sort and learning review. A second, anonymized table, `pooled_import_priors`, can be rebuilt from rows whose import is `confirmed` and `pooling_consent` is true. A group is kept only when at least 5 distinct brands share a category, placement, and price type. The table stores no brand, import, record, or show id. Category comes from `shows.categories` through `matched_show_id`. Unmatched rows are skipped. The refresh does not write `shows`, `show_profiles`, `show_surfaces`, or `benchmarks`.

Discovery applies `applyImportLift` after the existing post-air lift, for the same brand user. The brand's own imports add 6 points only when that show has conversions above zero in this brand's confirmed imports. A pooled group adds 2 points only when its median conversions per 1,000 downloads is above zero. The two lifts share the post-air cap of 100. Neither lowers a score, invents one from a missing composite, or removes a show. With no imports and an empty pool, `getTieredUniverse` matches the golden snapshot taken on main `1f06f63` before this change.

The learning review gets a separate `importedHistory` list, source `imported`, label "From your past campaigns". Those rows are not copied into `deal_conversion_reports` and do not change the measured sections.

`refresh_pooled_import_priors` is not called from the app, a cron, or a deploy hook.

### Where

- `supabase/migrations/058_pooled_import_priors.sql` (applied live)
- `supabase/migrations/058_pooled_import_priors.test.ts`
- `lib/learning/past-imports.ts`
- `lib/learning/pooled-priors.ts`
- `lib/scoring/import-lift.ts`
- `lib/discovery/tiered-universe.ts` (two optional deps, lift applied after post-air)
- `lib/learning/load.ts`, `lib/learning/assemble.ts`, `lib/learning/review.ts`

### Tests

`npx vitest run supabase/migrations/058_pooled_import_priors.test.ts lib/learning lib/scoring/import-lift.test.ts lib/discovery/tiered-universe.test.ts`

Covers grants, revokes, RLS, the `brand_count >= 5` check, the consent and confirmed filters, and the absence of a brand identifier on the pool. Brand A's imports do not move brand B's composite or tier unless a consented group of 5 brands exists, and then only by the 2 point nudge. Four consented brands produce no prior. A fixed fixture with no import deps, with empty deps, and with the default loaders stubbed empty matches the golden snapshot. Lift is never negative, the cap holds, and a null composite stays null. Supabase is mocked. No live writes. The refresh was not run.

No screenshots. This job has no UI.

### Known gaps

- Refresh scheduling. `refresh_pooled_import_priors` is in the migration and `refreshPooledImportPriors` can call it. Nothing schedules it. Do not add a cron or a deploy hook until Chris asks. Run it by hand after 058 is applied and there is consented data.
- Pool display. No UI. `importedHistory` is on the learning review object and the learning page does not render it. The pooled prior is not shown anywhere.
- Category coverage for unmatched rows. A record with no `matched_show_id`, or a matched show with no category, never enters the pool. It can still show in that brand's private history. It does not score a catalog show unless `matched_show_id` is set, and that id is only a hint for this brand plus the category lookup.
- Migration 058 is applied live. Do not run the refresh unless Chris asks.
- A pooled group with no positive median conversions per 1,000 downloads does not nudge. The group has to exist and the median has to be above zero.

## C3

### What was built

Brand CRM screens for Starter, Operator, and the legacy agency plan. `/crm` lists the signed-in brand's shows from `listCrmShows`. `/crm/[showId]` has Contacts (add, edit, delete), Notes (add, newest first), and read-only Deal history. A Free brand sees only the upgrade card. The card uses the approved copy, reads the Starter price and campaign caps from `PLANS`, and links to `/settings/billing`. It does not call the CRM store.

The sidebar gains one brand nav item, CRM, after Deals. It reuses the existing shows icon. Show and agent navs are unchanged. A show or agent who opens `/crm` is sent to `/dashboard`.

API routes under `/api/crm` require a session (401), a brand-side role (403), and `canUseCrm` (403). `brandId` is the session user. A `brandId` in the body or query is ignored. Input is checked against the store limits before the store is called.

Client adds are optimistic. A failed request rolls the row back and restores the draft.

### Where

- `app/(dashboard)/crm/page.tsx` at `/crm`
- `app/(dashboard)/crm/crm-client.tsx`
- `app/(dashboard)/crm/[showId]/page.tsx` at `/crm/[showId]`
- `app/(dashboard)/crm/[showId]/show-client.tsx`
- `app/(dashboard)/crm/access.ts`
- `app/(dashboard)/crm/components/` (chrome, upgrade card, contacts, notes, deal history)
- `app/api/crm/shows/route.ts`
- `app/api/crm/shows/[showId]/contacts/route.ts`
- `app/api/crm/shows/[showId]/contacts/[contactId]/route.ts`
- `app/api/crm/shows/[showId]/notes/route.ts`
- `app/api/crm/shows/[showId]/deals/route.ts`
- `lib/nav/items.ts` (CRM const and its place in `BRAND_NAV` only)

### Tests

`npx vitest run` (2034 passed). Includes `app/(dashboard)/crm`, `app/api/crm`, and `lib/nav`.

Covers 401, 403 for show and agent, 403 on Free, Starter / Operator / agency allowed, session `brandId` when the body or query names another brand, store limits, render of the index, the show page, and the upgrade card, optimistic add and delete with rollback, no em dash, and no import of the admin mockups. `npx tsc --noEmit` is clean. Supabase is mocked. No live writes.

### Known gaps

- Migration 053 is applied live. Deal history reads `deals`, which already exists.
- `listCrmShows` returns id and name only. The index does not show the medium line from the mockup.
- Notes cannot be deleted. The store has no delete, and this job did not add one. The mockup's local Remove note button is not in the product.
- The upgrade link opens billing. It does not change the plan.
- The homepage sample dashboard still lists the five-item nav. That copy lives in `lib/marketing/launch-copy.ts`, which this job does not own.
- Show and agent accounts are not given a `/crm` route rule in `isRouteAllowedForRole`. The page redirects them. The nav item is brand-side only.

## C3b

### What was built

A brand-side viewer can open a show's CRM page from the show name on the Deals list and on the legacy deal detail. Show and agent viewers keep the show name as it was: the list still links to the deal, and the legacy detail stays plain text. A deal with no show id stays that way too. Each CRM deal history row links to `/deals/[id]`, the same href the Deals list uses. A Free brand who follows a CRM link still sees the existing upgrade card. No new gate.

`crmFailure` maps PostgREST code `PGRST116` to 404 `{ error: "Not found" }`. The CRM store throws `new Error(error.message)` from `.single()`, which drops the code, so the same 404 is returned when the message is the PostgREST single-row message. Every other CRM error is unchanged. PATCH on another brand's contact now returns 404. DELETE already returned 404 when no row matched.

Migrations 053 and 058 are applied live. The status lines in the I4 and C3 sections say so.

### Where

- `app/(dashboard)/deals/deals-client.tsx` (show name href only)
- `app/(dashboard)/deals/[id]/legacy-client.tsx` (show name on the legacy deal detail)
- `app/(dashboard)/crm/components/show-panels.tsx` (`DealsPanel` row link)
- `app/api/crm/http.ts`
- `app/api/crm/http.test.ts`
- `app/api/crm/shows/[showId]/contacts/[contactId]/route.test.ts`

Brand-side is `isBrandSide` when a role is passed. The deals page and the legacy detail page do not pass one. Those clients then follow the dashboard nav CRM item, which is already rendered only for `isBrandSide`.

### Tests

`npx vitest run`

Covers the CRM show-name link for brand and agency, the existing deal link for show and agent users and for a deal with no show id, plain text on the legacy detail in those cases, the CRM history href `/deals/[id]`, and PATCH plus DELETE of another brand's contact returning 404. Supabase is mocked. No live writes.

### Known gaps

- Outreach deal detail renders the show name in `components/deals/Wave12DealClient.tsx` as `{brandName} x {showName}`. That file is outside this job. The heading there stays plain text. `deals.show_id` is on the loaded row, and `viewerRole` is already `brand` or `show`.
- On the Deals list, a brand-side show name with a show id points at `/crm/[showId]`. That name was the link into the deal. Planning cards have no other deal link. Later statuses still have View IO. Show and agent cards keep the deal link.
- The deals page and the legacy detail page do not pass a role. The first paint uses the non-brand treatment until the CRM nav item is read.
- `lib/crm/store.ts` still uses `.single()` and still drops `error.code`. The 404 uses the code when it is still on the error, and the single-row message when the store has wrapped it.
- Legacy price type copy used an em dash. This file now uses a hyphen so the changed file has none.
