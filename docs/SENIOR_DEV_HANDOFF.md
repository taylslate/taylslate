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
- Correction: the Deals list show name always links to `/deals/[id]`, for every status. A brand-side card with a show id adds a separate CRM link in the card footer, before View IO. That footer link is the only Deals-list path to `/crm/[showId]`. Show users, agent users, and deals with no show id do not get it.

## I3: Past-campaign import review and confirm

### What was built

A brand can upload a past campaign file, fix the parsed rows, choose pooling consent, and confirm. The screen posts the file to the existing parse API (`POST /api/deals/import?mode=past_campaign`) and the edited rows to the existing save API (`POST /api/imports/past-campaigns`). Discard resets local state before that save. There is no discard endpoint, and a confirmed import is not discarded here. A saved import does not need a discard in this job: I4 learns from confirmed rows, and adding a discard would be a new write this screen does not own.

Catalog text uses the same one-exact-name rule as `lookupShowHints`. The label is advisory. The save body always sends `matched_show_id: null`. The save route still computes its own hint. This screen never writes `shows`.

The only change to an existing screen is an "Import past campaigns" link in the CRM index header.

Import is not plan gated. Brand and agency accounts on any plan can open it, including Free. Show and agent accounts redirect to `/dashboard`, same as `/crm`. I do not think import should be plan gated. Free is the entry plan, and the learning feed stays empty without confirmed imports. The CRM link itself only renders on the unlocked CRM page, so a Free brand does not see the link and opens `/imports/past-campaigns` directly.

### Where

- `app/(dashboard)/imports/past-campaigns/page.tsx` at `/imports/past-campaigns`
- `app/(dashboard)/imports/past-campaigns/import-review-client.tsx`
- `app/(dashboard)/imports/past-campaigns/import-review.test.tsx`
- `lib/imports/review.ts`
- `lib/imports/review.test.ts`
- `app/(dashboard)/crm/crm-client.tsx` (one header link)
- `docs/jobs/I3.md`

### Tests

`npx vitest run` (2059 passed). `npx tsc --noEmit` is clean.

Covers draft-to-body mapping, an invalid price blocked, consent defaulting to false, a removed row left out, step transitions, the advisory label, confirm calling the save API once, and that call carrying only the session brand id. Show and agent sessions redirect to `/dashboard`. A Free brand still sees the screen. Supabase is mocked. No live writes.

### Known gaps

- No migration. Migration 054 is already applied on `ldtmhafewfifdizgfrnn` (the two tables are present). This job did not apply or edit it.
- No sidebar item. `lib/nav/items.ts` was left alone.
- The catalog lookup reads `shows` and can fail soft to "No catalog suggestion." It does not block confirm.
- Parse errors are shown as returned. The screen does not rewrite MIME or extension failures.
- A confirmed import cannot be undone from this screen.
- The CRM link is not on the Free upgrade card.

## S1: public table grant hardening

### What was built

Migration 060 revokes excess privileges on the 26 public tables from the 2026-10-25 grant audit. Anon keeps a single privilege, `SELECT` on `public.shows`, because `GET /api/shows` and `GET /api/shows/[id]` read the catalog with the anon key when no session is present. Anon and public lose every other privilege on those tables. Authenticated loses `TRUNCATE`, `REFERENCES`, and `TRIGGER` on all 26 and keeps `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on the 22 tables the signed-in app uses.

`api_cache_log`, `domain_events`, `event_log`, and `show_claims` are service_role only. No policies were added. `service_role` grants are unchanged. RLS is enabled on every table the migration touches. The "Shows are publicly readable" policy is unchanged. The migration is not applied on `ldtmhafewfifdizgfrnn`.

### Where

- `supabase/migrations/060_public_grant_hardening.sql`
- `supabase/migrations/060_public_grant_hardening.test.ts`
- `docs/jobs/S1.md`

### Tests

`npx vitest run` (2062 passed, 5 skipped without Postgres). With Postgres binaries the same suite is 2067 passed. `npx tsc --noEmit` is clean. `npx next build` is green. No live writes.

The SQL checks always run. The throwaway database checks apply migrations 001 through 058, grant the live excess privileges, apply 060 twice, and check anon has only `SELECT` on `shows`, anon and authenticated cannot truncate `shows`, `payments`, or `payouts`, anon insert on `shows` is denied, both roles can select `shows`, and authenticated has no privileges on the four service_role tables. Those five tests are skipped when Postgres binaries are absent.

### Known gaps

- The anon read of `shows` returns every column. `GET /api/shows` and `GET /api/shows/[id]` select `*` through the signed-in server client, which is the anon role when signed out. Table-level `SELECT` cannot hide a column. Sensitive columns on `public.shows`: `contact_email`, `contact_name`, and `contact_method`; `rate_card`, `price_type`, and `min_buy`; `surfaces` and `medium_priors`, which can carry a rate card or a CPM range; `agent_id`, `data_sources`, and `last_api_refresh`. `demographics` includes household-income shares. There is no notes column on `shows`. `transformShow` nests the contact fields and passes `rate_card` through. It leaves `slug`, `data_sources`, and `last_api_refresh` off the JSON after the row is fetched. A direct anon read can still see those columns. The follow-up is to give those two routes an explicit column list through `supabaseAdmin`, or to add a column-level anon grant.
- The shows-update policy. "Shows insert by authenticated" and "Shows update by authenticated" only check `auth.uid() IS NOT NULL`, so any signed-in user can insert or update any show through PostgREST. Authenticated still has insert and update on `shows`. The fix needs `updateShow`, `importShows`, and `updateShowEnrichment` moved to `supabaseAdmin` first. This migration does not change policies.
- `show_claims` is locked here and dropped in O1 (061).

## S2: show data is login-only

### What was built

Signed-out callers no longer receive show rows. `GET /api/shows` and `GET /api/shows/[id]` return 401 without a session. Dashboard pages, including `/shows`, already redirect to `/login` through `proxy.ts`. There is no MCP server. v1 bearer keys are the agent path, and a key is rejected unless `api_keys.brand_id` is a `profiles.id`. Signed-in brands still get the full show, including contact and rate card, on the session routes and on v1. v1 `contact` is `name`, `email`, and `method`. Rates, sponsors, slots, and income demographics stay on that payload. They are not available signed out, because the routes and the anon grant are both closed.

Migration 065 revokes every anon and public table privilege in `public`, including the `SELECT` on `shows` that the first paste of 060 left. The 060 file no longer grants that select back. On live Supabase, 065 runs as `postgres` and fixes default privileges for `postgres` only. New tables, sequences, and functions created by `postgres` grant nothing to anon or public. `postgres` cannot change `supabase_admin`'s default privileges (`insufficient_privilege`). The migration logs `065 follow-up: could not change default privileges for role supabase_admin` and continues. Changing `supabase_admin`'s defaults is a follow-up. Authenticated DML on tables outside 060's 26 is unchanged. 065 revokes `TRUNCATE`, `REFERENCES`, and `TRIGGER` on those tables when they exist. The list and the reasons are in `docs/jobs/S2.md`. 065 and 066 are not applied. 060 is applied.

### Where

- `app/api/shows/route.ts` (`GET`)
- `app/api/shows/[id]/route.ts` (`GET`)
- `lib/api/auth.ts`
- `lib/api/memory-admin.ts`
- `lib/api/v1/reads.ts`
- `lib/api/v1/serializers.ts`
- `lib/api/v1/openapi.ts`
- `proxy.test.ts`
- `supabase/migrations/065_shows_login_only.sql`
- `docs/jobs/S2.md`

### Tests

Route tests for the two GETs, `lib/api/public-api.test.ts` (key not tied to a user), serializer and OpenAPI contact coverage, and `065_shows_login_only.test.ts`. The throwaway Postgres checks skip when binaries are absent. No UI change.

### Known gaps

- `/outreach/[token]` stays public. The token is the credential. It is not a catalog read.
- Other show-returning routes already required a session. They are listed in `docs/jobs/S2.md`.
- `supabase_admin` default privileges are not changed on live Supabase. Only `postgres` defaults are fixed. See `docs/jobs/S2.md`.

## S3: shows writes are owner or admin

### What was built

Only an owner or an admin can write a show through the edit, enrich, import, and create routes. `canEditShow` allows an internal admin (`INTERNAL_ADMIN_EMAILS` or profile role `admin`), an agent with an approved `agent_show_relationships` row, or a show user tied by `getVerifiedProfileTies`. `shows.agent_id` alone is not a grant. A pending or rejected roster link is not. `show_profiles.podscan_id` is not a tie. `updateShow`, `importShows`, and `updateShowEnrichment` write through `supabaseAdmin`. Import sets `agent_id` from the session and ignores a body value. A non-admin import inserts `is_discoverable` false. An admin import is discoverable unless the row sets it false. `approveRosterLink` approves a pending link and sets `is_discoverable` true only when `shows.agent_id` equals that link's `agent_id`. `GET /api/shows/[id]` returns a hidden show to the creating agent or an admin, and 404s it for everyone else. `POST /api/shows/[id]/claim` does the same 404 check and does not return the hidden row. The PATCH denylist adds `agent_id`, `is_verified`, `is_claimed`, `podscan_id`, and `is_discoverable` unless the caller is an admin. `POST /api/shows` allows an agent or an admin. Everyone else gets 403. A non-admin create forces `is_discoverable` false and `agent_id` to the caller, and ignores `is_verified`, `is_claimed`, and `podscan_id`. `POST /api/shows/enrich-batch` skips a show that fails `canEditShow`, reports it as `not_permitted`, and keeps going.

Migration 066 drops "Shows insert by authenticated" and "Shows update by authenticated" and revokes insert, update, and delete on `public.shows` from authenticated. Authenticated keeps SELECT. "Shows are publicly readable" stays. 066 is not applied.

A search for cookie-client `insert`, `update`, `upsert`, or `delete` on `shows` found none after this change. The remaining writers are already on `supabaseAdmin`, or are scripts that use the service role key. The list is in `docs/jobs/S3.md`.

### Where

- `lib/shows/can-edit-show.ts`
- `lib/data/queries.ts` (`updateShow`, `importShows`, `updateShowEnrichment`)
- `lib/reps/store.ts` (`approveRosterLink`)
- `app/api/shows/[id]/route.ts` (`GET`, `PATCH`)
- `app/api/shows/[id]/enrich/route.ts`
- `app/api/shows/enrich-batch/route.ts`
- `app/api/shows/import/route.ts`
- `supabase/migrations/066_shows_write_policy.sql`
- `docs/jobs/S3.md`

### Tests

`lib/shows/can-edit-show.test.ts`, the four route test files, `lib/data/roster-links.test.ts`, and `066_shows_write_policy.test.ts`. The throwaway Postgres checks skip when binaries are absent. No UI change.

### Known gaps

- `createShow` without an `actor` option, the backfill helpers, `lib/shows/apply-geography.ts`, and `app/api/admin/seed-deal` still write `shows` as service_role. Those callers were left as they were.

## B3: admin roster-link approval

### What was built

Admins get `/admin/roster-requests`. It lists pending roster links, oldest first, with the agent email, show name, discoverable flag, source, exclusive flag, created time, and live conflict context. Approve calls `approveRosterLink` and does not edit that helper. A link that is not pending shows "Not pending" and writes nothing. Discoverable still flips only when `shows.agent_id` matches the link's agent. Reject requires a note of 1 to 500 characters, sets status `rejected` only while the row is pending, and writes nothing on `shows`. An exclusive conflict asks for a confirm before approve.

The page 404s unless `isShowsAdmin` is true. The routes return 401 signed out and 403 for anyone else. Writes use `supabaseAdmin`.

Migration 067 adds nullable `review_note`, `rejected_by`, and `rejected_at`. It is not applied. The list does not select those columns, so it works before the paste. Reject returns 503 until the paste.

### Where

- `app/(dashboard)/admin/roster-requests/page.tsx` at `/admin/roster-requests`
- `app/(dashboard)/admin/roster-requests/roster-requests-client.tsx`
- `app/api/admin/roster-links/route.ts` (`GET`)
- `app/api/admin/roster-links/[id]/route.ts` (`POST` approve or reject)
- `lib/reps/roster-review.ts`
- `supabase/migrations/067_roster_link_review_note.sql` (not applied)
- `docs/jobs/B3.md`

### Tests

`lib/reps/roster-review.test.ts`, `app/api/admin/roster-links/route.test.ts`, `app/api/admin/roster-links/[id]/route.test.ts`, `app/(dashboard)/admin/roster-requests/roster-requests.test.tsx`, and `supabase/migrations/067_roster_link_review_note.test.ts`.

The throwaway Postgres applied 001 through 067 and then 067 again. anon and PUBLIC have no grants on `agent_show_relationships`. authenticated has SELECT. service_role has SELECT, INSERT, UPDATE, and DELETE. That matches what 065 left.

### Known gaps

- Ownership proof is omitted. `lib/ownership` is not on this branch. This job does not import it. Wire the pending or verified proof after O1 merges.
- The page is not in the sidebar. `lib/nav/items.ts` was left alone. Open `/admin/roster-requests` directly.
- Migration 067 is not applied on `ldtmhafewfifdizgfrnn`. Apply only after merge and Chris's OK. Until then, reject returns "Roster review notes are not available yet."
- No email is sent. Other roster links are not changed. Conflicts are not auto-resolved.
- The mockup at `/admin/mockups/roster-requests` is unchanged.

## I2b: confident past-campaign show match

### What was built

The past-campaign save stores `matched_show_id` only when the normalized show name matches exactly one eligible show. Eligible means `shows.is_discoverable` is true, or the show is hidden and `shows.agent_id` is the signed-in caller. That is the creator stored on a non-admin show create. Zero matches and two or more matches leave `matched_show_id` null and mark the row `ambiguous` with confidence `0`. A unique match stores confidence `1` and reason `unique_normalized_name`.

The key folds U+2019 to an apostrophe and U+00A0 to a space, replaces U+0130 with i plus a combining dot, then lowercases one code point at a time. A final capital sigma stays σ. `ΣΊΣΥΦΟΣ` becomes `σίσυφοσ`. ASCII punctuation is removed, a leading `the` is removed, and a trailing `podcast` or `show` is removed. The same rules are in `normalizeShowMatchKey` and in `normalize_show_match_key`. That SQL function sets `search_path` to empty. A body `matched_show_id` is ignored. A before-write trigger overwrites a brand insert or update. It leaves the row unchanged when `auth.role()` is `service_role`, or when `current_user` is `service_role` or `postgres`. The status check still applies. The trigger and the route do not write `shows`.

A `service_role` or `postgres` write skips matching. A row that write leaves with a null status and a set show id enters the pool when the show is discoverable. The user-session save route is the only writer today. A `service_role` or `postgres` insert is a trust boundary.

Ambiguous rows stay on the brand's private records. `refresh_pooled_import_priors` skips status `ambiguous` and skips a show that is not discoverable. A pre-068 row has a null status and still enters the pool when `matched_show_id` is already set and the show is discoverable. If a show is hidden later, its rows leave the pool on the next refresh. That is intended. There is no brand matching screen.

Migration 068 is not applied. A read-only count on `ldtmhafewfifdizgfrnn`, taken before this renumber, found 0 `past_campaign_records` rows and 0 with `matched_show_id` set. Nothing was rewritten. 067 on main is the roster-link review note.

### Where

- `lib/imports/past-campaigns.ts`
- `app/api/imports/past-campaigns/route.ts`
- `supabase/migrations/068_past_campaign_show_match.sql`
- `docs/jobs/I2b.md`

### Tests

`lib/imports/past-campaigns.test.ts`, `app/api/imports/past-campaigns/route.test.ts`, and `068_past_campaign_show_match.test.ts`. The throwaway Postgres checks ran here. `npx vitest run` passed 2198 tests. `npx tsc --noEmit` was clean. `npx next build` succeeded. No UI change.

### Known gaps

- Apply 068 after 067, only after merge and Chris's OK. Until then the save route writes columns and calls a function the live database does not have.
- Ambiguous rows are not resolved. They stay private and out of the pool.
- `lib/imports/review.ts` still labels an exact case-insensitive name. That label is not the stored link.
- A consented unique match of a discoverable show can feed the pool. The pool does not store the show id. A hidden show does not enter.
- Suffix stripping means `My Show` normalizes to `my`. An em dash stays in the key.
- Outreach-materialized hidden shows have no `agent_id`, so they are not matched.

## O1: show ownership status, proofs, and the verified tie

### What was built

Two states, unclaimed and verified, plus a Pending tag. `shows.ownership_status` defaults to `unclaimed` and only allows those two values. Pending is not stored as a state. `getOwnershipState` sets `pending` when a `show_ownership_proofs` row is pending or an `agent_show_relationships` row is pending. The labels Verified, Unclaimed, and Pending are exported for owner and admin views. No screen renders them. There is no public badge. Discovery, scoring, booking, and visibility do not read the state.

`public.show_ownership_proofs` is the table O2 and O4 will write. This job does not write rows. Columns cover the code check (`code_hash` is sha256, never the plaintext), the target feed or channel, check and miss counts, and the decision fields. One verified proof per show. `getVerifiedProfileTies` treats a verified row as a tie on `(show_id, show_profile_id)`. Pending, rejected, contested, and expired rows are not ties. A null `show_profile_id` is not a tie. `podscan_id` is not read.

`isPayoutOwnerVerified(showId, showProfileId)` is true only when a verified proof ties that pair. It is not imported by `lib/payouts`, and it does not import payout, Stripe, billing, or aircheck code. Wiring it before the first payout is a separate job.

The three production writers that set `is_claimed: true` now pass false, matching `createShow`'s default. Search, not the stale line numbers in the job note: `importShows` in `lib/data/queries.ts`, `buildShowFromForm` in `app/(dashboard)/shows/shows-client.tsx` (add and edit), and `resolveOwnerShowId` in `lib/data/show-surfaces.ts`. The Shows form does not render the flag. `shows.is_claimed` is not dropped. The column comment marks it deprecated. `show_claims` is dropped at the end of 061. A DO block raises and stops the paste if the table has any rows. The check uses `to_regclass('public.show_claims')`, so a rerun after the drop still succeeds. It had 0 rows on Oct 24, 2026. Re-confirm that count read-only before applying.

Migration 061 is not applied. 065 and 066 are already on main. 061 does not grant or revoke on `shows`, so authenticated keeps SELECT only from 066.

### Where

- `supabase/migrations/061_show_ownership.sql`
- `supabase/migrations/061_show_ownership.test.ts`
- `lib/ownership/status.ts`
- `lib/ownership/status.test.ts`
- `lib/ownership/payout-gate.ts`
- `lib/ownership/payout-gate.test.ts`
- `lib/shows/apply-geography.ts` (third tie branch only)
- `lib/shows/apply-geography.test.ts`
- `lib/data/queries.ts` (`importShows` `is_claimed`)
- `app/(dashboard)/shows/shows-client.tsx` (`buildShowFromForm` `is_claimed`)
- `lib/data/show-surfaces.ts` (`resolveOwnerShowId` `is_claimed`)
- `docs/jobs/O1.md`

### Tests

`npx vitest run`: 2135 passed. The throwaway Postgres suite applies 001 through 060, then 065, then 066, then 061 twice. Anon cannot read proofs. Authenticated can read only its own proofs and cannot write. The policy `Owners read own ownership proofs` exists. Seeding one `show_claims` row makes 061 fail and leaves that row in place. Grant rows are in `docs/jobs/O1.md`. `npx tsc --noEmit` is clean and `npx next build` is green. No live writes.

### Known gaps

- `isPayoutOwnerVerified` is not called from `lib/payouts`. A payout can still run for an unverified owner until a separate job wires the helper. Do not wire it without Chris's OK.
- `lib/data/seed.ts` still sets `is_claimed: true` on demo rows. `scripts/seed-from-podscan.ts` and `scripts/seed-shows-only.ts` copy the field through. Those files are outside this job.
- No `updated_at` trigger on `show_ownership_proofs`. O2 sets `updated_at` when it writes.
- Ownership labels are not on any screen. Brand-facing UI must not grow a badge from this export.
- 061 is not applied on `ldtmhafewfifdizgfrnn`.

## L2

### What was built

Anonymized priors from booked on-platform deals. Booked means `signed`, `live`, `delivering`, or `completed`, with `cancelled_at` null. `show_signed` does not enter. A hidden show does not enter. A group needs at least 5 distinct brands (`coalesce(brand_profile_id, brand_id)`). The deal table stores no brand, deal, show, or user id. `agreed_cpm`, `agreed_placement`, and `agreed_episode_count` win when set. Outcome impressions are used only when `outcomes.booking_id` matches the deal. 069 does not replace `refresh_pooled_import_priors`. 068 is the only definition. A row stays out unless `matched_show_id` is set, `show_match_status` is null or `matched`, and the show is discoverable. Ambiguous rows and hidden shows stay out.

`loadPooledPriors` merges the two tables. Deal priors win on a shared key. Import priors fill the rest. Discovery already calls that loader. A daily cron rebuilds both tables behind `CRON_SECRET`. `/terms` shows the approved consent line.

### Where

- `supabase/migrations/069_pooled_deal_priors.sql` (not applied)
- `supabase/migrations/069_pooled_deal_priors.test.ts`
- `lib/learning/pooled-deal-priors.ts`
- `lib/learning/pooled-deal-priors.test.ts`
- `lib/learning/pooled-priors.ts`
- `lib/learning/pooled-priors.test.ts`
- `app/api/cron/pooled-priors/route.ts`
- `app/api/cron/pooled-priors/route.test.ts`
- `vercel.json` (one cron, `0 16 * * *`)
- `app/terms/page.tsx`
- `docs/jobs/L2.md`

### Tests

`npx vitest run supabase/migrations/069_pooled_deal_priors.test.ts lib/learning/pooled-deal-priors.test.ts lib/learning/pooled-priors.test.ts app/api/cron/pooled-priors/route.test.ts`

The throwaway Postgres suite applies 001 through 069, including 061 from main `4c5aa7b`. It checks 4 brands against 5, ignores cancelled, `show_signed`, and unsigned deals, drops five booked brands on a hidden show, keeps ambiguous and hidden-show rows out of the import pool, denies anon and authenticated select, execute, and truncate, and re-runs 069. It is skipped when Postgres binaries are absent. No live writes.

### Known gaps

- 069 is not applied. Do not refresh the hosted pool until Chris says so. 068 is on main.
- Backlog item j. On main `4c5aa7b`, `/terms` is not in `proxy.ts` `isPublicRoute`, and the footer Terms link is still `#`.
- The two pools are not summed. Each source keeps its own 5-brand bar so one brand cannot be counted twice.
- `outcomes` is joined on `booking_id = deals.id`. A `show_id`-only join is not used.

## A3: public API v1 writes recorded as pending actions (migration 070)

### What was built

The first public API v1 writes. `POST /api/v1/campaigns` (`write:campaigns`) and `POST /api/v1/outreach` (`write:outreach`) validate a JSON body and insert one `api_write_actions` row. The response is `202` with `{ action_id, status: "pending" }`. The same `Idempotency-Key` and the same payload hash returns that row with `200`. The same key with a different payload returns `409`. A unique-violation race re-reads and settles the same way.

Nothing is executed. These routes do not insert or update campaigns, deals, outreach, shows, or `agent_show_relationships`. They do not send email and they do not charge.

`withApiWrite` sits next to `withApiRead`. It resolves the bearer key, applies the same per-key rate limit, then requires the named scope. `Idempotency-Key` must be 1 to 128 printable ASCII characters after trim. A body over 64 KB is `413`. A body that is not `application/json`, or that fails `JSON.parse`, is `415`. Scope is checked before the body, so a read-only key is `403` without a body. A key whose `brand_id` is not a `profiles` row is `401` through the existing `keyTiedToUser` check.

`GET /api/v1/actions` and `GET /api/v1/actions/{id}` use `withApiRead` and the `read` scope. They return only the calling brand's rows, newest first, with the same cursor as the other lists. Another brand's id is `404`.

An outreach draft's show must be discoverable, or owned by the brand through a deal (`deals.brand_id` or a `brand_profiles` row for that user). Otherwise the response is `404` and no row is inserted. A replay of an already stored action skips that check.

The campaign body matches the manual brief submit checks: product, customer text or a reused pattern uuid, one to three goals, budget at least $5,000, and a flight preset or dates. Unknown keys are `422`. The outreach body requires a show id, a subject of 1 to 200 printable characters, and a body of 30 to 5000 characters.

Migration 070 creates `api_write_actions` with RLS on and zero policies. `service_role` is granted all privileges. `anon`, `public`, and `authenticated` are revoked, including `truncate`, `references`, and `trigger` on `authenticated`. The job placeholder was 069. That file was not created. 070 is not applied.

### Where

- `supabase/migrations/070_api_write_actions.sql`
- `supabase/migrations/070_api_write_actions.test.ts`
- `lib/api/v1/writes.ts`
- `lib/api/v1/writes.test.ts`
- `lib/api/v1/handler.ts` (`withApiWrite` added; `withApiRead` unchanged)
- `lib/api/v1/openapi.ts`
- `lib/api/v1/openapi.test.ts`
- `app/api/v1/campaigns/route.ts` (`POST` added; `GET` unchanged)
- `app/api/v1/outreach/route.ts`
- `app/api/v1/actions/route.ts`
- `app/api/v1/actions/[id]/route.ts`
- `app/api/v1/writes.route.test.ts`
- `docs/jobs/A3.md`

### Tests

`lib/api/v1/writes.test.ts`, `app/api/v1/writes.route.test.ts`, `supabase/migrations/070_api_write_actions.test.ts`, and `lib/api/v1/openapi.test.ts`. The route test asserts the only mutation is an insert into `api_write_actions`. The throwaway Postgres suite applies migrations 001 through 070, then applies 070 again, and checks RLS, constraints, and grants. No UI change, so no screenshots.

### Known gaps

- No approve or reject path. Status stays `pending` until a later job.
- A reused campaign pattern id is checked as a uuid. It is not loaded, so ownership of that pattern is not checked until something executes the action.
- `api_key_id` does not cascade when a key row is deleted. Deleting the profile still cascades the action through `brand_id`.
- The campaign payload has no derived name. The manual brief route builds that name when it creates the row. This route only records the brief fields.

## S4: signed-in shows SELECT

### What was built

Migration 071 replaces "Shows are publicly readable" (`USING (true)`) with "Shows readable by signed-in participants" `FOR SELECT TO authenticated`. A signed-in user sees a `shows` row when it is discoverable, when `shows.agent_id` is the caller, when the caller has an approved roster link, when the caller is `brand_id`, `agency_id`, or `agent_id` on a deal for that show, or when the caller has a verified tie. The tie is a deal whose `show_profile_id` is the caller's `show_profiles` row, or a `show_owner` row whose `contact_email` matches the caller's `profiles.email` and the caller has a `show_profiles` row. `show_profiles.podscan_id` is not a tie. There is no admin branch. The live `profiles_role_check` allows `brand`, `agency`, `agent`, and `show`.

O1 has not merged and `show_ownership_proofs` does not exist, so that third tie is a follow-up. Policies on `agent_show_relationships`, `deals`, `show_profiles`, and `profiles` do not read `shows`, so the checks stay inline. `idx_agent_shows_show_agent_approved` is new. Anon and public still have nothing on `shows`. Authenticated keeps `SELECT` only. `service_role` is unchanged. 071 is not applied.

No app code was edited. The session-read audit is in `docs/jobs/S4.md`.

### Where

- `supabase/migrations/071_shows_select_policy.sql`
- `supabase/migrations/071_shows_select_policy.test.ts`
- `docs/jobs/S4.md`

### Tests

`supabase/migrations/071_shows_select_policy.test.ts`. SQL checks always run. The throwaway Postgres suite applies 001 through 066, adds `shows.agent_id`, then main's 067 and every migration up to 070 that exists on disk, including PR 42's `068_past_campaign_show_match.sql`, then 071 twice. The #42 case fails when that 068 file is missing. The suite is skipped when Postgres binaries are absent. No UI change. Screenshots are not applicable.

### Known gaps

- An admin who is not the creator, an approved rep, a deal participant, or a verified tie no longer receives a hidden show from the session client. `GET` and `PATCH /api/shows/[id]`, `POST /api/shows/[id]/claim`, and `POST /api/shows/[id]/enrich` read `shows` before `isShowsAdmin` / `canEditShow`, so those routes 404 that case. Those files were not edited. There is no database admin signal to add to the policy.
- `getShowBySlug` (`lib/data/queries.ts:1113`) is a session read. A hidden show the caller cannot see returns null, including `createShow`'s slug-conflict return. `queries.ts` belongs to O1 and was not edited.
- The `show_ownership_proofs` branch waits until O1 has merged and the table exists.
- `001_initial_schema.sql` omits `shows.agent_id`. The live table has it. 071 reads it and does not add it.

## S-B: Secret scan

### What was built

A docs-only scan of the working tree and of every commit reachable from this clone (426 commits, 2655 blobs). Gitleaks 8.30.1 reported no leaks. The required prefix grep found zero credential-shaped values: no live Stripe key, no test Stripe key, no webhook secret with a real body, no JWT, no PEM private key, and no long `api_key` assignment. The report lists every prefix hit with file, commit, a 4-character prefix, and whether the line is in HEAD. The rotation list is empty. The report also records the GitHub clicks for Secret Protection and push protection, and the clicks to install the Socket GitHub app on `taylslate/taylslate`. No setting was changed.

### Where

- `docs/security/S-B_SECRET_SCAN.md`

### Tests

No vitest test. The check is re-running the two gitleaks commands in the report (history walk and `--no-git` tree walk) and `npx next build`. No page or component was edited. Screenshots are not applicable.

### Known gaps

- Gitleaks reports 401 commits scanned. `git rev-list --all` is 426, including 22 merges. The blob walk covers every object those 426 commits reach.
- Vercel env, Stripe, Supabase, DocuSign, and Resend dashboards were not read. A key that never entered git is outside this result.
- GitHub secret-scanning alerts were not downloaded, because the alert payload can contain the secret.
- `.gitignore` does not name `*.key`, `*.p12`, `*.pfx`, or `id_rsa`. None of those names are in history. The file was not edited.
- After `npx next build`, `gitleaks detect --no-git` also walks gitignored `.next` and flags local Next preview and cache keys. Those values are not in git. The clean-tree result is 0.

## H1

### What was built

Migration 072 locks the money columns on `profiles` and the writes on `payments`. `profiles_protect_money_columns` rejects a change to `platform_fee_percentage`, `plan`, `subscription_status`, `stripe_customer_id`, `stripe_subscription_id`, `stripe_connect_account_id`, `role`, `tier`, `seat_count`, or `campaigns_this_month` unless the caller is `service_role` or a migration role. A non-service insert may only start as `tier` `free`, `role` `brand` or `show`, and the defaults for the fee, plan, subscription status, Stripe ids, seat count, and monthly counter. `ensureProfile` still inserts `role` `brand` and `tier` `free` through the cookie client. Authenticated loses insert, update, delete, truncate, references, and trigger on `payments`. INSERT and UPDATE policies on `payments` are dropped. SELECT policies stay. Column UPDATE on the locked profile columns is revoked from authenticated. The table-level UPDATE grant stays so `full_name` still updates. The trigger is the enforcement.

`POST /api/onboarding/role` takes `{role}` for the signed-in user and writes `role` plus `tier` `free` with `supabaseAdmin`. The allowlist is `brand`, `agency`, and `agent`. `admin` is rejected. The write is allowed only before brand or show `onboarded_at` is set, and only while `role` is null or `brand` and the user has no campaigns, show profile, or roster link. `handleRoleSelect` calls this route. The picker, loading, and redirects are unchanged.

`POST /api/campaigns/outreach/send` requires `getAuthenticatedUser`, a `campaign_id`, and ownership (`campaigns.user_id`). It sends only when `show_id` and `contact_email` match a recommendation, YouTube recommendation, or expansion row stored on that campaign. Anything else is dropped. Caps are 50 drafts, 200 characters per subject, 10 KB per body, and 512 KB for the request. The From address and the email template are unchanged. Both outreach fetches in `campaign-detail.tsx` now send `campaign_id`.

072 is applied and verified on 2026-10-26: `payments` is SELECT-only for authenticated, trigger `profiles_protect_money_columns` exists, and a fee update as authenticated is rejected with 42501.

### Where

- `supabase/migrations/072_lock_money_columns.sql`
- `supabase/migrations/072_lock_money_columns.test.ts`
- `app/api/onboarding/role/route.ts`
- `app/api/onboarding/role/route.test.ts`
- `app/api/campaigns/outreach/send/route.ts`
- `app/api/campaigns/outreach/send/route.test.ts`
- `app/onboarding/page.tsx` (`handleRoleSelect` only)
- `app/(dashboard)/campaigns/[id]/campaign-detail.tsx` (the two outreach/send bodies only)
- `docs/security/S-A_FINDINGS.md` (copied from open PR 50, then SA-01, SA-02, and SA-03 status lines)
- `package.json` and `package-lock.json` (`@electric-sql/pglite`, dev dependency for the migration test)

### Tests

`npx vitest run supabase/migrations/072_lock_money_columns.test.ts app/api/onboarding/role/route.test.ts app/api/campaigns/outreach/send/route.test.ts`

PGlite proves an authenticated user cannot insert or update `payments`, cannot change any locked profile column, can update `full_name`, and `service_role` can change the fee. The `ensureProfile` insert passes. `tier` `pro` and `role` `agent` inserts from authenticated fail. Route tests cover 401, 403, the caps, 413, a dropped recipient, and the mocked Resend happy path. No live database write and no real email.

### Known gaps

- 072 is applied and verified on 2026-10-26. SA-01 and SA-02 are closed on `ldtmhafewfifdizgfrnn`.
- SA-03's route checks ship with this PR and do not wait on 072. There is still no cross-request rate limit. The per-request caps are the limit this job adds.
- The recipient allowlist is the contact email stored on the campaign JSON. The owner can still edit that JSON through the campaigns update policy, then send. Shows are not re-read from `shows.contact_email`.
- `ensureProfile` remains a cookie-client insert of `role` `brand` and `tier` `free`. The insert guard allows that shape and rejects anything else.
- A table-level UPDATE grant still covers the locked columns. The column revoke does not remove it. The trigger rejects the write.
- `reset_monthly_campaigns` is invoker and updates `campaigns_this_month`. Nothing in the app calls it. An authenticated call would now fail the trigger.

## S-A

### What was built

Read-only security inventory. Live `SELECT` against project `ldtmhafewfifdizgfrnn` on 2026-10-26. 43 public tables, 120 `app/api` routes, findings SA-01 through SA-24. No app code, migration, config, or settings change. No live writes, charges, or sends.

### Where

- `docs/security/S-A_FINDINGS.md`

### Tests

No new vitest tests. This job is docs only. Verification: the table count in the doc is 43, matching `pg_tables` for `public`. The route table has 120 rows, matching `route.ts` files under `app/api`. `git diff --stat` is only this file and the findings doc. `npx next build` is recorded on the PR. No page or component was touched. Screenshots are not applicable.

### Known gaps

- The audit did not send a user JWT. PostgREST writes in SA-01 through SA-05 and SA-24 are inferred from grants, policies, and the charge code, not from a live probe.
- `/callback` was not re-walked.
- `lib/stripe`, `lib/payouts`, `lib/billing`, and `lib/airchecks` were read and not edited.
- No migration was applied. Paul reviews. Do not merge.

## U1

### What was built

A brand or agency can search discoverable shows by name at `/shows/search`. The page calls the existing `GET /api/shows?search=` with `limit=50`. The typed value is trimmed, cut at 100 characters, and `%`, `_`, and `\` are escaped before they are sent. Results show name, platform, audience size, and category. Each row links to the existing brand show page at `/crm/[showId]`. Empty, loading, and error states are on the page. A hidden show (`is_discoverable` false) is dropped before render. Contact email, rate card, and the rest of the catalog payload are not rendered. An agent or a show who opens the URL is sent to `/dashboard`. `/shows` is unchanged.

The brand and agency nav in `lib/nav/items.ts` gained one entry, Search, pointing at `/shows/search`. Show and agent nav are the same list as before.

### Where

- `app/(dashboard)/shows/search/page.tsx`
- `app/(dashboard)/shows/search/search-client.tsx`
- `app/(dashboard)/shows/search/search-client.test.tsx`
- `lib/nav/items.ts` (the `BRAND_NAV` line only)
- `lib/nav/items.test.ts` (brand label list now includes Search; show and agent assertions are unchanged)
- `PRODUCT_BACKLOG.md` (Direct show search)

### Tests

`app/(dashboard)/shows/search/search-client.test.tsx` and `lib/nav/items.test.ts`.

Covers a hidden show excluded from the list, a brand seeing name, platform, audience, and category, the CRM link, an empty query making no request, a 401 response rendering the sign-in error, a failed search, wildcard escaping on the query string, the 50 row cap, and role gates: brand and agency render the page, signed-out goes to `/login`, no role goes to `/onboarding`, agent and show go to `/dashboard`. `GET /api/shows` already returns 401 with no session (`app/api/shows/route.test.ts`). No live writes.

### Known gaps

- `GET /api/shows` and `GET /api/shows/[id]` still return the full show, including contact and rate card, to any signed-in caller. This page does not render those fields. Those routes were not edited.
- Name search is `ilike` on `shows.name` only. A topic that is not in the name does not match. The API category param is an exact `categories` contains check and is not wired to this one box.
- `limit=50` is what this page sends. Other callers can still pass a limit up to 100.
- Wildcard escaping is on this page's request. A direct call to `GET /api/shows?search=` can still pass raw `%` and `_`.
- `/crm/[showId]` is the existing brand show page. It 404s unless that brand already has a contact, note, or deal for the show. There is no catalog profile route, and this job could not add one.
- `isRouteAllowedForRole("/shows/search", "brand")` stays false. The segment rule was not changed. This page checks brand or agency itself.
- `lib/brand/tokens.css` still does not list `/shows/search` in its page comment. That file was not edited.

## R1a: Onboarding rename: Sales Agent / Manager

### What was built

The onboarding role picker label for role id `agent` now reads "Sales Agent / Manager". The role value stays `agent`. Routes, the H1 role allowlist, login, OTP, and the show option are unchanged. Show self-sign-up stays out of this job.

The only user-facing copy of that label was the role card title in `app/onboarding/roles.tsx`. A search of the repo found no other "Agent / Talent Manager" or "Talent Agent" string. Fixture names such as "Northwind Talent" and the IO line "Publisher / Talent Representative" are not this label and were left alone.

### Where

- `app/onboarding/roles.tsx` (title text only)
- `docs/SENIOR_DEV_HANDOFF.md` (this section)

### Tests

`npx vitest run` (255 files, 2245 passed, 40 skipped), `npx tsc --noEmit`, and `npx next build` all passed. `app/onboarding/roles.test.tsx` still asserts the ids are brand, agency, and agent, with show excluded. No migration. No live data writes.

### Known gaps

- The card description is still "I represent shows and manage their ad inventory". Only the title changed.
- R1b (show self-sign-up) is not in this change. It waits for S-E rate limits.
- Screenshots were taken against a local mock auth server so the signed-in picker could render without a live Supabase write.

## S-K

### What was built

`GET /api/shows`, `GET /api/shows/[id]`, `GET /api/v1/shows`, and `GET /api/v1/shows/[id]` no longer return the show object to every caller. The JSON is built from an allowlist: `id`, `name`, `platform`, `audience_size`, `categories`, plus `image_url` and `description` when those values are non-empty strings. `image_url` is the existing image column. Contact, rate card, sponsors, slots, demographics, and every other key are absent for a caller with no tie.

The full show object is still returned for a show the caller owns or is otherwise tied to. A tie is the caller's `show_profiles` row in `getVerifiedProfileTies` (a deal `show_profile_id`, a `show_owner` contact email, or a verified ownership proof). `show_profiles.podscan_id` is not read and is not a tie. A brand or agency with a `deals` row on that show (`brand_id`, `agency_id`, or the caller's `brand_profile_id`) also receives the full object for that show only. An approved `agent_show_relationships` row does too. An agent still receives their own roster from the approved-link query on `GET /api/shows`, in full, and that path does not call `getVerifiedProfileTies`. A requested `limit` is still forwarded and still clamps at 100. There is no new default of 50. The U1 search client sends `limit=50`. Signed-out callers still receive 401. A missing API key on `/api/v1/shows` still receives 401. A key without `read` still receives 403. `POST /api/shows` and `PATCH /api/shows/[id]` are unchanged. Hidden-show visibility on `GET /api/shows/[id]` is unchanged: a non-creator who is not an admin still gets 404. A creator or admin with no tie gets the public allowlist.

New Deal reads `rate_card` only through an optional lookup. With no rate card the CPM field stays empty and the page does not throw. A present card still fills the CPM for the selected placement.

SA-25 is marked fixed for those four GET handlers.

### Where

- `app/api/shows/route.ts` (`GET` only)
- `app/api/shows/route.test.ts`
- `app/api/shows/[id]/route.ts` (`GET` only)
- `app/api/shows/[id]/route.test.ts`
- `app/api/v1/shows/route.ts` (`GET` only)
- `app/api/v1/shows/[id]/route.ts` (`GET` only)
- `app/api/v1/reads.route.test.ts` (show field assertions and owner / verified-rep cases; scope test unchanged)
- `app/(dashboard)/deals/new/page.tsx` (rate card handling only)
- `app/(dashboard)/deals/new/page.test.tsx`
- `lib/shows/public-fields.ts`
- `lib/shows/public-fields.test.ts`
- `docs/security/S-A_FINDINGS.md` (SA-25)

### Tests

`npx vitest run lib/shows/public-fields.test.ts app/api/shows/route.test.ts app/api/shows/[id]/route.test.ts app/api/v1/reads.route.test.ts app/(dashboard)/deals/new/page.test.tsx`

Covers a brand with no tie (public fields only, no contact, no rate card, podscan id not passed into the tie lookup), an owner (full row), a verified rep (full row), and an anonymous caller (401) on `GET /api/shows`, `GET /api/shows/[id]`, and both `/api/v1/shows` handlers. The v1 scope test still expects 403 `API key lacks the required scope.` for a write-only key. New Deal renders when the catalog row has no `rate_card`, leaves the CPM input empty, and still fills 25 when `midroll_cpm` is present.

Clients of `GET /api/shows` on this branch:

- `app/(dashboard)/dashboard/dashboard-client.tsx` reads `length` and `platform` only. Both remain.
- `app/(dashboard)/deals/new/page.tsx` reads `name`, `audience_size`, and `rate_card`. A missing card leaves the rate empty.
- `app/(dashboard)/shows/shows-client.tsx` fetches `GET /api/shows` only when `initialShows` is omitted. `/shows` always passes `initialShows` from the server query, so that fetch does not run. The fallback would read `contact` and `rate_card`. Not edited.
- U1 (`origin/cursor/u1-brand-show-search-4cb2`, not on main) `toPublicShow` reads `id`, `name`, `platform`, `audience_size`, `categories`, and `is_discoverable`. It does not read `contact` or `rate_card`. A missing `is_discoverable` does not drop the row. That file was not edited.

`/deals/new` is behind the auth gate, so this run did not capture a signed-in before/after screenshot. The page layout is unchanged. The rate field behavior is covered by `page.test.tsx`.

### Known gaps

- The server does not add a 50-row cap. `limit` still clamps at 100, and a request with no limit still returns the discoverable catalog. The 50 cap lives on the U1 search client, which is not merged.
- An admin or creating agent with no tie receives public fields on `GET /api/shows/[id]`. There is no admin branch for the field allowlist, matching the shows SELECT policy. Hidden-show visibility is unchanged.
- A tie lookup that throws returns public fields for that request. The sensitive keys stay off the JSON.
- `shows-client.tsx` still has an unused fallback that would read `contact` and `rate_card`. It does not run while `/shows` passes `initialShows`.
- No migration. Nothing was applied to `ldtmhafewfifdizgfrnn`. No live write, charge, or send.

## V1

### What was built

An internal admin can switch the dashboard between Brand, Show, and Sales Agent from the signed-in admin account. The session user does not change. The view is one of the admin-owned test accounts in `lib/admin/test-accounts.ts` (Test Brand 1, Test Show 1). The cookie value is `test:<key>`. It is not a user id. Every read of that cookie checks the verified session email against `INTERNAL_ADMIN_EMAILS` again.

Non-admins keep the existing brand/show switch. A non-admin who posts `agent`, or a role they do not own, is rejected. Agent has an entry, `ADMIN_VIEW_AGENT`, whose user id is the empty constant `ADMIN_TEST_AGENT_USER_ID`. While that constant is empty, the Agent control is disabled with "No test agent configured" and `POST /api/view-mode` rejects `agent`. No user or profile is created.

The sidebar (`components/layout/Sidebar.tsx`) shows "Viewing as Test Brand 1" or "Viewing as Test Show 1" and an Exit button that clears the cookie. Admin pages still check `isInternalAdmin` on the session email. The view cookie does not open them.

Charges, payouts, and card changes return 403 while that admin view cookie is active. A forged `test:` cookie on a non-admin session is ignored, and those routes keep their previous behavior. The existing `brand` / `show` cookie is not a money block.

There is no `audit_log` table (S-F has not shipped one). TODO: when `audit_log` exists, write one row for each admin view switch (who, from, to, when).

### Where

- `app/api/view-mode/route.ts` (POST admin branch and GET)
- `components/layout/Sidebar.tsx` (view switch and banner)
- `lib/admin/test-accounts.ts` (`ADMIN_TEST_AGENT_USER_ID`, `ADMIN_VIEW_AGENT`)
- `lib/admin/view-guard.ts`
- `lib/data/queries.ts` (`getEffectiveRole` only)
- `app/(dashboard)/layout.tsx` (stale view cookie clear only)
- Guard at the top of `app/api/deals/[id]/charge-episode/route.ts`, `app/api/deals/[id]/setup-intent/route.ts`, `app/api/payouts/early/route.ts`, `app/api/stripe/payment-method/setup-intent/route.ts`, `app/api/stripe/payment-method/[id]/route.ts`, `app/api/stripe/customer/create/route.ts`

### Tests

`npx vitest run app/api/view-mode/route.test.ts lib/data/effective-role.test.ts lib/admin/view-guard.test.ts components/layout/Sidebar.test.tsx`

Covers a non-admin rejected for agent and for a role they do not own, a forged `test:` cookie ignored without an admin session, admin brand and show switches, agent rejected while `ADMIN_TEST_AGENT_USER_ID` is empty, and each listed money route returning 403 in the switched view and the previous result outside it.

### Known gaps

- TODO: log each admin view switch to `audit_log` when S-F adds that table. Nothing is written today.
- `ADMIN_TEST_AGENT_USER_ID` is empty. Agent cannot be selected. No agent user was created.
- The view changes the dashboard role and the banner. Reads and writes stay on the signed-in admin id. Test Show 1's rows are not loaded, and nothing is written as that user.
- `lib/stripe`, `lib/payouts`, and `lib/billing` were not changed. No migration.

## S-E: Rate limits

### What was built

Migration 073 adds `public.rate_limit_events` and `public.rate_limit_hit(bucket, key, max, window_seconds)`. The function is `SECURITY DEFINER` with `search_path = public`. It locks the bucket and key, deletes rows older than 2 days, and inserts a hit only when the count inside the window is still under max. RLS is on with no policy. `service_role` has select, insert, update, delete, and execute. anon, authenticated, and public have none. Authenticated also has truncate, references, and trigger revoked. 073 is not applied. Nothing was run against `ldtmhafewfifdizgfrnn`.

`lib/security/rate-limit.ts` calls that function through `supabaseAdmin`. Email keys are the SHA-256 of the lowercased address. User keys are the user id. IP keys are the first `x-forwarded-for` hop, then `x-real-ip`. Over the limit the route returns 429, `Retry-After`, and `Too many requests. Try again later.` A database error fails closed on code send, verify, magic, outreach send, and uploads (503 `unavailable`). `failureMode: "open"` is for a read. No read route uses it.

Checks sit at the top of the handler, after the existing auth or token gate where that gate has to run first. Login code send runs before the profile lookup, so a known email and an unknown email get the same 429. The existing `login_otp_consume` rules are unchanged.

### Where

- `supabase/migrations/073_rate_limits.sql`
- `supabase/migrations/073_rate_limits.test.ts`
- `lib/security/rate-limit.ts`
- `lib/security/rate-limit.test.ts`
- `docs/security/RATE_LIMITS.md`
- `app/api/auth/magic/route.ts` (10 per IP per hour)
- `app/api/auth/login/otp/route.ts` (3 per email per 15 minutes, 10 per IP per hour)
- `app/api/auth/login/otp/verify/route.ts` (5 per email per 15 minutes)
- `app/api/campaigns/outreach/send/route.ts` (20 per user per hour, 100 per user per day)
- `app/api/outreach/route.ts` (same outreach caps)
- `app/api/deals/import/route.ts` (20 per IP per hour)
- `app/api/shows/import/route.ts` (20 per user per hour)
- `app/api/show-profile/media-kit/route.ts` (20 per user per hour)

B1 route, not on this branch: `POST /api/reps/roster/import` (open PR 48). The limit is 10 per user per hour via `enforceRosterImport`. Its 500-row and 1 MB caps stay on that branch.

Route tests that already mocked `rpc` or `supabaseAdmin` now let `rate_limit_hit` return true, or mock `enforceUpload` as allowed, so the previous success responses stay. Those files are `app/api/auth/login/otp/route.test.ts`, `app/api/auth/login/otp/verify/route.test.ts`, `app/api/campaigns/outreach/send/route.test.ts`, `app/api/outreach/route.test.ts`, `app/api/deals/import/route.test.ts`, `app/api/shows/import/route.test.ts`, and `app/api/show-profile/media-kit/route.test.ts`.

### Tests

`npx vitest run lib/security/rate-limit.test.ts supabase/migrations/073_rate_limits.test.ts`

The helper test trips and resets every constant, checks email-hash and IP keys, verify lockout, identical 429 bodies for a known and an unknown email, fail-closed send and outreach, fail-open reads, and unchanged under-limit responses for magic, campaign outreach send, deal import, media kit, and show import. PGlite applies 073 twice and shows anon and authenticated cannot select, insert, update, delete, or execute. `service_role` can execute and select. Each window denies at max and allows again after the rows are older than the window. No live database write and no real email.

No page or component was edited. Screenshots are not applicable.

### Known gaps

- 073 is not applied. Wired routes fail closed until Chris applies it after merge.
- `POST /api/reps/roster/import` is not in this tree. The one-line `enforceRosterImport` call is still to be added on that branch. The 500-row and 1 MB caps were not edited.
- `POST /api/deals/import` is limited by IP. Adding `getAuthenticatedUser` on the PDF branch would change a path that currently does not load a session.
- Verify counts every 6-digit attempt, including one that will succeed. `login_otp_consume` still locks wrong codes until a later send.
- `POST /api/auth/magic/start`, outreach generate, pitch accept/counter/decline, and the discovery, interpret, and enrich routes are outside this job's file list and are still unlimited.
- Show CSV import still has no byte or row cap. Media-kit inflate still has no output cap.

## D1

### What was built

A new campaign created by `POST /api/campaigns/brief` stores `platforms: ["podcast", "youtube"]` on both inserts (draft, and submit when no campaign id exists). Conviction discovery still uses the stored list when it is non-empty, so that new campaign's `discover()` brief includes `youtube`. When `platforms` is missing or empty, the fallback is `["podcast", "youtube"]`. A campaign that already stores `["podcast"]` stays podcast-only. Seed and admin routes are unchanged. No platform picker. Scoring, YouTube filters, quotas, and enrichment are unchanged. No backfill.

### Where

- `app/api/campaigns/brief/route.ts` (both `createCampaign` platform defaults)
- `app/api/campaigns/brief/route.test.ts`
- `lib/discovery/conviction-discovery.ts` (empty-platforms fallback only)
- `lib/discovery/conviction-discovery.test.ts`
- `docs/SENIOR_DEV_HANDOFF.md`

### Tests

`npx vitest run app/api/campaigns/brief/route.test.ts lib/discovery/conviction-discovery.test.ts` (75 passed).

The brief route test asserts both inserts pass `platforms: ["podcast", "youtube"]`. Conviction discovery asserts a new campaign (`["podcast", "youtube"]`) and an empty platform list both pass `youtube` into `discover()`, and a stored `["podcast"]` list does not.

Full `npx vitest run`: 263 files, 2338 passed, 40 skipped. `npx tsc --noEmit` clean. `npx next build` compiled and generated 134 pages.

No page or component was edited. Screenshots are not applicable.

### Known gaps

- Existing campaigns are not backfilled. Discovery for a row that already stores `["podcast"]` does not call YouTube.
- There is still no platform picker. Every new brief-route campaign searches both.
- YouTube filters, quotas, and enrichment are unchanged. A YouTube API error still lands in discovery `errors` and `sources.youtube` can stay 0.
- Live confirmation waits on deploy. Chris runs a new campaign. YouTube calls should show in the runtime logs within the hour, and the discovery report should have `sources.youtube > 0` or a YouTube error.
- No migration. Nothing was applied to `ldtmhafewfifdizgfrnn`. No live write, charge, or send.

## D2

### What was built

YouTube discovery search now sends `regionCode=US` and `relevanceLanguage=en`. That covers both `search.list` calls in `YouTubeClient`: channel search (`searchChannels`) and the recent-video search inside `getRecentVideoStats`. The same two methods are what `discoverFromYoutube` calls. Min-views, video-count, quotas, weights, bands, and tiering are unchanged.

Audience fit was not changed. A YouTube channel with no demographics already takes the podcast path: no age, gender, or country signal means audience fit 50, `degraded: true`, `coverage: 0` (`NEUTRAL_DEGRADED_SCORE`). A structured target on the brief does not turn that gap into a low measured score. `hydrateCandidateDemographics` already skips non-podcast platforms on the Podscan fetch, so a discovered YouTube channel stays at `{}` unless a same-slug catalog row already has demographics.

What pulled campaign `17e94ff3`'s YouTube channels into the low band is not missing audience data. `youtubeChannelToShow` copies YouTube topic categories into `categories` and `audience_interests`. Those categories are a measured topical score: zero token overlap with the ring scores 20 and `degraded: false`, while a channel with no categories stays unmeasured at 50. `fillPurchasePower` then writes a purchase-power proxy from the same categories before scoring. The exact topic `Entertainment` maps to 25. With audience pinned at the unmeasured 50, a low measured topical score (and, when the topic is low-tier, purchase power 25) composites under the medium floor of 50. Off-market channels from the unfiltered search are the inventory that hits that path. The US/English search params are the change that should shrink that inventory. Scoring was left alone.

### Where

- `lib/enrichment/youtube.ts` (search params on both `/search` calls only)
- `lib/enrichment/youtube.test.ts`
- `lib/scoring/conviction.test.ts` (missing-data equality only; `conviction.ts` unchanged)
- `docs/SENIOR_DEV_HANDOFF.md`

`lib/discovery/hydrate-demographics.ts` was read and not edited. Its existing test already skips a YouTube candidate with a podscan id.

### Tests

`npx vitest run lib/enrichment/youtube.test.ts lib/scoring/conviction.test.ts` (29 passed).

Channel search and recent-video search both assert `regionCode=US` and `relevanceLanguage=en`. Conviction asserts a YouTube channel with empty demographics matches a podcast with the same inputs on audience fit, degraded flag, coverage, and composite, including when the brief has an age and gender target. A third case shows an `Entertainment` topic drops topical relevance and the composite while audience fit stays 50.

Full `npx vitest run`: 264 files, 2343 passed, 40 skipped. `npx tsc --noEmit` clean. `npx next build` compiled and generated 134 pages.

No page or component was edited. Screenshots are not applicable.

### Known gaps

- `searchChannels` and `getRecentVideoStats` are shared with `POST /api/shows/[id]/enrich` and the enrich-batch route. Those admin searches now send the same US/English params. A non-US channel looked up by name can miss.
- `regionCode` on the recent-video search can drop videos that are not viewable in the US. That can change average views. The 10,000-view and 20-video filters were not edited.
- `relevanceLanguage` is a YouTube relevance hint, not a hard language filter. `regionCode` is the country constraint.
- Same-slug DB hydration can still copy a catalog show's demographics onto a YouTube candidate. That is measured data, not the missing-data path.
- Weights, band thresholds, and tiering were not changed. A US/English channel whose topics do not overlap the ring can still land in the low band.
- No migration. Nothing was applied to `ldtmhafewfifdizgfrnn`. No live write, charge, or send.
- Live confirmation waits on deploy. Chris runs a new campaign. Compare that run's YouTube band spread, read-only, to campaign `17e94ff3` (18 YouTube channels, all low, average composite 42, against 152 medium or high podcasts).

## D3

### What was built

The "Scoring the show universe" state now leaves on its own when discovery finishes. Campaign `17e94ff3` had already finished discover with no errors, and the scoring state stayed up until a reload.

`runDiscovery` was calling `startTransition(() => router.refresh())` and treating `useTransition`'s `isPending` as the bridge until the server component re-read. On Next 16 that pending flag does not settle, so the scoring branch stayed true and the refreshed props did not replace it. A reload worked because it never entered that transition.

The success path now calls `router.refresh()` on its own. `discovering` stays true until the server props (`universe`, `discoveryRan`, or `tiered`) change identity, which is the re-read landing. Results render then, and the re-run button returns to "Re-run discovery". An HTTP error, a thrown request, and a 409 clear `discovering` immediately and do not refresh. Layout, copy, styles, animations, and the discover API are unchanged.

### Where

- `app/(dashboard)/campaigns/[id]/conviction-discovery-view.tsx` (discover-completion state only)
- `app/(dashboard)/campaigns/[id]/conviction-discovery-view.test.tsx`
- `docs/SENIOR_DEV_HANDOFF.md`

### Tests

`npx vitest run "app/(dashboard)/campaigns/[id]/conviction-discovery-view.test.tsx"` (35 passed).

The new cases cover a refresh that never resolves: scored props replace the scoring state and show the result, an empty re-read shows the empty copy, an HTTP 500 shows the error, and a thrown request shows the network error. In each failure the scoring state is gone and `router.refresh` is not called. The 409 notice still replaces the scoring state.

Full `npx vitest run`: 264 files, 2347 passed, 40 skipped. `npx tsc --noEmit` clean. `npx next build` compiled and generated 134 pages.

A local render of this component (fetch stubbed, so no discover POST) went from "Scoring the show universe" to The Recovery Lab with "Re-run discovery" enabled, without a reload. The error query cleared the scoring state to "Discovery didn't complete". Shots: `d3-before-scoring.png`, `d3-after-results.png`, `d3-error-cleared.png`.

### Known gaps

- Completion is a change in server prop identity. If `router.refresh()` bails out because the RSC payload is unchanged, `discovering` stays true. A discover that writes scores, or that flips `discoveryRan`, changes that payload.
- The portfolio-override refresh still uses its own `startTransition`. It keys the busy state off `recomputing`, which is cleared in `finally`, not off `isPending`.
- No live discover was run. Campaign `17e94ff3` was not loaded. No migration. Nothing was applied to `ldtmhafewfifdizgfrnn`. No live write, charge, or send.

## D4

### What was built

YouTube discovery runs one search per confirmed ring, from that ring's own label, capped at `MAX_YOUTUBE_SEARCHES = 4`. Each search uses `maxResults` 25. `searchChannels` still sends `regionCode=US` and `relevanceLanguage=en`. Channels are deduped by channel id across the searches. A brief with no ring labels still uses the single interest/keyword query.

After the channel-details call, a channel is kept only when `snippet.country` is US, or when country is missing and `snippet.defaultLanguage` or the title/description reads as English. Any other set country (IN, GB, and the rest) is dropped before the view and video filters and before scoring. The min average views, video-count, and brand-channel filters are unchanged. The zero-view YouTube filter and simulcast merge are unchanged. Podcast query building is unchanged.

Channel details now request `snippet,statistics,topicDetails,brandingSettings`. `statistics` stays because the video-count and view filters read it. Wikipedia topic URLs become readable labels. `brandingSettings.channel.keywords` is split (quoted phrases stay together). Both land on `categories` and `audience_interests`, the same fields a podcast's genres use. Topical relevance reads those two fields and nothing else. A channel with neither topics nor keywords stays on the unmeasured path (topical relevance 50, degraded).

Quota per run, Data API units (`search.list` = 100, `channels.list` = 1, `videos.list` = 1): channel search 4 x 100 = 400; channel details 1 per batch of 50 ids, worst case 4 x 25 = 100 channels = 2; recent video stats still run for the top 3 channels that pass the market filter, each one search.list (100) plus one videos.list (1) = 303. Worst case 400 + 2 + 303 = 705. A failed ring search is recorded on `errors` and the other rings still return.

### Where

- `lib/discovery/category-mapping.ts` (`buildYouTubeQueries`, `MAX_YOUTUBE_SEARCHES`)
- `lib/discovery/category-mapping.test.ts`
- `lib/discovery/discover-shows.ts` (per-ring search, dedupe, market filter, quota constant)
- `lib/discovery/discover-shows.test.ts`
- `lib/enrichment/youtube.ts` (detail parts, topic labels, keywords, `defaultLanguage`)
- `lib/enrichment/youtube.test.ts`
- `lib/discovery/format-discovered-show.ts` (`youtubeChannelToShow` topic mapping)
- `lib/discovery/format-discovered-show.test.ts`
- `lib/discovery/conviction-discovery.ts` (`ring_terms` on the brief only)
- `lib/discovery/conviction-discovery.test.ts` (that field only)
- `lib/scoring/conviction.ts` (`topicalRelevanceInputs` only)
- `lib/scoring/conviction.test.ts`
- `docs/SENIOR_DEV_HANDOFF.md`

### Tests

`npx vitest run lib/discovery/category-mapping.test.ts lib/discovery/discover-shows.test.ts lib/discovery/format-discovered-show.test.ts lib/enrichment/youtube.test.ts lib/scoring/conviction.test.ts lib/discovery/conviction-discovery.test.ts` (120 passed).

Covers the 4-search cap, per-ring queries that do not mix in other rings' keywords, duplicate labels, dedupe across searches, detail batches of 50, US kept, IN dropped, missing country + English kept, missing country + non-English dropped, a failed ring search, topic URL to label, keyword splitting, the detail `part` list, and a YouTube show with fitness/nutrition topics scoring topical relevance 85 on the same inputs as a podcast with those genres. A recovery podcast fixture stays at topical relevance 85, audience fit 50, purchase power 50. The podcast query list for a health brief is unchanged.

Full `npx vitest run`: 265 files, 2371 passed, 40 skipped. `npx tsc --noEmit` clean. `npx next build` compiled and generated 134 pages.

No page or component was edited. Screenshots are not applicable.

### Known gaps

- Country other than US is dropped even when the copy is English. A UK, CA, or AU channel with `snippet.country` set does not reach scoring. A channel with no country and English copy does.
- When country and `defaultLanguage` are both missing, Latin-script titles with no foreign function words are treated as English. A non-English name in Latin letters can pass. Devanagari, Arabic, CJK, and Latin function words such as para/los/und are dropped.
- If `defaultLanguage` is not English but the title or description reads as English, the channel is kept. The rule is country missing AND (language tag OR the text).
- Recent video stats still cost 3 search.list calls (300 units) on top of the 400 channel-search units. The documented worst case is 705, not 400.
- `searchChannels` is shared with the enrich routes. Those admin lookups still send `regionCode=US` and `relevanceLanguage=en` (D2).
- A channel whose topics do not overlap the ring can still score topical relevance at 20 (measured, not degraded) and land in the low band. Weights, band thresholds, and tiering were not changed.
- No migration. `categories` is already `string[]` and holds the labels. Nothing was applied to `ldtmhafewfifdizgfrnn`. No live write, charge, or send.
- Live confirmation waits on deploy. Chris or Angus runs a new More/Less campaign. Compare, read-only, to `cd7d3972`: YouTube channel count, countries, band spread, and topical relevance average. Quota errors show on the discovery `errors` list and in the runtime log as `YouTube query ... failed`.

## D5

### What was built

YouTube discovery was searching one raw ring label. Campaign `25f63dd0` sent `ingredient-literate women's wellness`, got 0 channels, and never reached the market filter. D4 builds queries from ring labels only and drops the interest query whenever any ring exists.

`buildYouTubeQueries` now normalizes each ring label before search. Hyphens and slashes become spaces, possessive `'s` is removed, other punctuation is dropped, and only the first 5 words are kept. `ingredient-literate women's wellness` becomes `ingredient literate women wellness`. A curly apostrophe is treated the same way.

When that list is shorter than `MAX_YOUTUBE_SEARCHES` (4), the function tops up with `buildYouTubeQuery(brief)` (the existing interest and keyword query), then shorter tails of each ring: the last 3 words, then the last 2. A tail drops punctuation but keeps the letter s, so `women's wellness` becomes `womens wellness`. Duplicates are skipped. The list never exceeds 4. Four ring queries still do not take a top-up. A brief with no ring labels still uses the single interest query.

`discoverFromYoutube` still logs each query and its channel count. If every search returns 0 channels, it runs the interest query once more when that string was not already searched and the run is still under 4 searches. Four empty searches do not add a fifth. Channels from that retry go through the same dedupe and market filter, then the same view and video filters. Those filters, scoring, weights, bands, podcast queries, the UI, env, and the database were not changed. The quota worst case stays 4 channel searches (705 units).

### Where

- `lib/discovery/category-mapping.ts` (`buildYouTubeQueries`, label normalization, top-up)
- `lib/discovery/category-mapping.test.ts`
- `lib/discovery/discover-shows.ts` (YouTube query loop and the empty retry only)
- `lib/discovery/discover-shows.test.ts`
- `docs/SENIOR_DEV_HANDOFF.md`

### Tests

`npx vitest run lib/discovery/category-mapping.test.ts lib/discovery/discover-shows.test.ts` (2 files, 27 passed).

Covers label normalization (hyphen, slash, straight and curly possessive `'s`, punctuation, 5-word cap), top-up for one ring `ingredient-literate women's wellness` plus Health & Wellness (`ingredient literate women wellness`, `fitness workout`, `literate womens wellness`, `womens wellness`), 4 rings with no top-up, the cap when tails would exceed 4, blank labels, the no-ring interest fallback, the podcast query list unchanged, one empty retry, no second interest search, no fifth search, no retry after a hit, and retry hits still passing the market filter.

Full `npx vitest run`: 265 files, 2380 passed, 40 skipped. `npx tsc --noEmit` clean. `npx next build` compiled and generated 134 pages.

No page or component was edited. Screenshots are not applicable.

### Known gaps

- Four ring queries that all return 0 do not get the interest retry. That would be a fifth `search.list` (100 more units). The cap stays at 4.
- When top-up already included the interest query, the empty retry does not search it again.
- A ring brief with no mapped interests and no keywords tops up with `buildYouTubeQuery`'s existing fallback, `popular creator`.
- The full ring query drops possessive `'s` (`women`). The shorter tail keeps the s (`womens`). Both can run when the cap has room.
- Normalization changes search text only. Stored ring labels are unchanged.
- Market filter, min views, video count, brand-channel filter, scoring, weights, bands, and podcast query building were not changed.
- No migration. Nothing was applied to `ldtmhafewfifdizgfrnn`. No live write, charge, or send.
- Live confirmation waits on deploy. Rerun a 1-ring campaign. Read-only: more than one YouTube query in the logs, a nonzero channel count, then the market filter count and YouTube rows in `conviction_scores`. Campaign `25f63dd0` is the reference (one query, `ingredient-literate women's wellness`, 0 channels).

## D6

### What was built

YouTube discovery now logs every stage where a channel can disappear. Filters, thresholds, scoring, weights, the returned shows, the UI, env, and the database are unchanged.

`discoverFromYoutube`, after the existing market-filter line, logs exclusive drop counts for the three post-filters in the same order they already ran: `videoCount < 20`, brand-keyword description match, and `avgViews < 10000`. A channel dropped by an earlier check is not counted again. The brand-keyword line names the first matching keyword for the first 5 channels (channel title and keyword). It also logs the median average views of the channels that survive all three, and the count returned. The median of an even count is the average of the two middle values. When nothing survives, the median is `n/a`.

The outer catch still pushes `YouTube discovery failed: ...` and returns `[]`. It also `console.error`s the message and stack. A `key=` value in that message, in a per-query YouTube error, and in the stack is replaced with `key=[redacted]` before it is logged or pushed onto `errors`.

`runConvictionDiscovery` logs podcast and YouTube counts at five points: after discover, after `excludeExcludedGenres`, after `excludeDeadYouTube`, after `mergeSimulcasts`, and after scoring. The scoring line counts kept entries, so a show on two rings is counted twice. A simulcast YouTube row counts as podcast after the merge, because the podcast row is the one that remains. Each string in `discovery.errors` is redacted with the same helper, `console.warn`ed, and copied onto the result `errors` array. `redactSecretParams` lives in `lib/discovery/redact-secrets.ts`.

### Where

- `lib/discovery/discover-shows.ts` (log lines and the catch only)
- `lib/discovery/conviction-discovery.ts` (log lines only)
- `lib/discovery/redact-secrets.ts` (`redactSecretParams`)
- `lib/discovery/discover-shows.test.ts`
- `lib/discovery/conviction-discovery.test.ts`
- `docs/SENIOR_DEV_HANDOFF.md`

### Tests

`npx vitest run lib/discovery/discover-shows.test.ts lib/discovery/conviction-discovery.test.ts` (2 files, 74 passed).

The YouTube fixture asserts the returned shows equal the shows `youtubeChannelToShow` builds for the four survivors (including a channel at exactly 20 videos and exactly 10,000 average views). The same run asserts the drop counts, the two named keywords, the survivor median, and the returned count. A six-channel brand fixture returns `[]` and names only the first 5 keywords. A thrown channel-details error returns `[]`, stores the redacted message on `errors`, and logs the message and stack with `key=` redacted. A non-Error throw logs `unknown error`. A conviction run whose discovery error is `key=ABC` warns and stores `key=[redacted]` and does not contain `ABC`.

The conviction fixture runs the same shows through `excludeExcludedGenres`, `excludeDeadYouTube`, `mergeSimulcasts`, `fillPurchasePower`, and `scoreCandidatesAgainstRings`, and asserts the orchestrator returns those shows and scores. The five log lines are `podcast=1 youtube=4`, then `1/3`, `1/2`, `1/1`, and after two rings `podcast=2 youtube=2`. Both discovery errors are warned and still present on the result.

Full `npx vitest run`: 265 files, 2386 passed, 40 skipped. `npx tsc --noEmit` clean. `npx next build` compiled and generated 134 pages.

No page or component was edited. Screenshots are not applicable.

### Known gaps

- These lines go to the runtime log only. They are not stored on the campaign.
- Early returns before the post-filters (no client, no queries, no channel ids, no details, or zero channels after the market filter) do not print the post-filter lines. The market-filter line still prints when channel details came back.
- The brand-keyword line uses the first keyword in the existing list, and only the first 5 dropped channels. Later matches are a count only.
- `key=` values are redacted in the YouTube error log, the per-query YouTube warning, and the discovery `errors` entries those paths produce. Other error strings are unchanged.
- The scoring count is entries, not distinct shows. A simulcast's YouTube row is gone after merge and the podcast row carries that surface.
- Filters, thresholds, scoring, weights, and the shows returned were not changed. This does not fix campaign `ce672dc1`. It names the stage.
- No migration. Nothing was applied to `ldtmhafewfifdizgfrnn`. No live write, charge, or send.
- Live confirmation waits on deploy. Rerun `ce672dc1` or a new 1-ring campaign within the hour. Read the YouTube count at each logged stage, and any `YouTube discovery failed` error. D7 is the fix against that stage.

## D7

### What was built

YouTube pre-filters keep more real US creators. The dead-YouTube filter, the market filter, scoring, weights, bands, tiers, podcast discovery, the UI, env, and the database are unchanged.

Brand check is `youtubeBrandMatch`. Phrases match on word boundaries. Bare "shop" and "store" are not description keywords, so "shop my favorites" and "merch store" stay, and so do "workshop" and "restore". A description marks a brand only when it has a strong commercial phrase and no creator signal. The phrases are "official website", "our products", "buy now", "free shipping", "use code", "customer service", and "order now". Creator signals, also word boundaries in the description, are: i, i'm, i am, my, me, host, creator, podcast, youtuber, vlog, vlogs, vlogger, merch, favorite, favorites. A title that ends with Inc, LLC, Official, Store, Shop, or Co is a brand even when the description has a creator signal. A trailing period on the title is ignored. The D6 match log is the same shape: the drop count, then the first 5 `"title" matched "keyword"` pairs. The logged keyword is the first matching phrase, or the title marker when the phrase did not fire.

`MIN_YOUTUBE_VIDEO_COUNT` is 10 (was 20). A channel with 10 videos can pass. 9 still drops.

Recent video stats are fetched for the top 10 market survivors by subscriber count (was 3). When that call returns stats, the average-views floor stays 10,000. When it does not (the channel is outside the top 10, or the call returns null or throws), the floor is 5,000 on total views divided by video count. The views drop line names both floors. A separate line logs how many channels that reached the views check used each method, including channels the views check then dropped. Channels dropped earlier for video count or brand are not in that count.

Quota, Data API units: channel search 4 x 100 = 400; channel details worst case 2; recent stats 10 x (search.list 100 + videos.list 1) = 1,010. 1,010 + 402 = 1,412, about 1.4k per run. A cap of 6 would be 6 x 101 + 402 = 1,008, about 1k. This change uses 10.

`key=` redaction on the YouTube error path is unchanged. This change does not log the API key.

### Where

- `lib/discovery/discover-shows.ts` (post-filter block, brand match, video-count floor, average-views floors, quota)
- `lib/discovery/discover-shows.test.ts`
- `docs/SENIOR_DEV_HANDOFF.md`

### Tests

`npx vitest run lib/discovery/discover-shows.test.ts` (29 passed).

Brand cases: "shop my favorites" and "merch store" stay, including The Dr. Gundry Podcast and Jordan Dorn | Zuma Nutrition titles; bare "shop" and "store" stay; "workshop" and "restore" stay; "official website" plus "use code" drops as "official website"; each strong phrase drops on its own; "buy nowadays", "use codec", "unofficial website", and "our production" stay; a creator signal ("I'm", "my", "merch") keeps a commercial phrase; title endings Inc, LLC, Official, Store, Shop, and Co drop even with "shop my favorites"; "founded in", "we manufacture", "shop now", and "discount code" no longer drop. "Costco", "Shop Talk", and "Official Gear" do not match a title marker.

Funnel fixture: video count 9 drops and 10 stays; video count 19 stays; recent stats 6,000 and 9,999 drop while 10,000 stays; catalog fallback 6,000 and 5,000 stay while 4,999 drops. Recent stats are requested for the top 10 market survivors only. The log lines assert both floors, the method counts (recent=6, fallback=3), the two named brand matches, and the survivor median. A six-channel brand fixture still returns none and names only the first 5. The redacted `key=` error cases are unchanged.

Full `npx vitest run`: 265 files, 2393 passed, 40 skipped. `npx tsc --noEmit` clean. `npx next build` compiled and generated 134 pages.

No page or component was edited. Screenshots are not applicable.

### Known gaps

- A brand description that also says I, my, me, host, creator, podcast, merch, favorite, or vlog is not dropped by the phrase list. A title marker still drops it.
- "discount code", "shop now", "our company", "founded in", and "we manufacture" no longer drop a channel. "use code" still does, when the description has no creator signal.
- Recent stats still run on the top 10 after the market filter, before the video-count and brand checks. A tiny or brand channel in that ten uses a stats call (101 units) and can push a real creator onto the 5,000 fallback.
- The fallback divides lifetime views by every video, so a long back catalog still looks smaller than recent uploads. The 5,000 floor is the allowance for that. Channels inside the top 10 use the 10,000 floor on the fetched stats.
- A title that ends in the word Co is dropped. "Costco" is not, because Co is not its own word.
- The method line counts channels that reached the views check, not every market survivor.
- No migration. Nothing was applied to `ldtmhafewfifdizgfrnn`. No live write, charge, or send.
- Live confirmation waits on deploy. Rerun a 1-ring Ritual campaign within the hour. Target: at least 10 YouTube channels returned, no obvious brand channels, and YouTube rows in `conviction_scores`. Campaign `67cada7c` is the reference (3 returned: Healing Cave Lady, KenDBerryMD, Brandon Shepherd).

## D8

### What was built

YouTube discovery finds creators from popular videos. `search.list` with `type=channel` was matching channel names, so niche phrases returned small channels. `YouTubeClient.searchVideos` calls `search.list` with `part=snippet`, `type=video`, `order=viewCount`, `videoDuration=medium`, `publishedAfter` set to 12 months before the call, `regionCode=US`, `relevanceLanguage=en`, and `maxResults` 50. It costs 100 units, the same as a channel search. Each hit keeps `snippet.channelId` in the order YouTube returned. A video with no channel id is dropped. A channel that appears twice on one page is kept twice so the caller can take the first occurrence.

`discoverFromYoutube` runs each planned query through `searchVideos` only. It does not also call `searchChannels`. The cap stays at 4 searches, including the empty-result interest retry. Unique channel ids are collected in rank order: query order, then view-count order inside that query, first occurrence wins. Each query logs how many distinct channels it found. After dedupe the run logs `YouTube unique channels: N`. Channel details still batch at 50. The market filter, the D7 brand check, the video-count floor, the two view floors, and recent stats for the top 10 are unchanged. `searchChannels` remains for the enrich routes.

Quota, Data API units: video search 4 x 100 = 400; channel details worst case is 4 x 50 = 200 unique channels, which is 4 calls; recent stats 10 x (search.list 100 + videos.list 1) = 1,010. 400 + 4 + 1,010 = 1,414, about 1.4k per run. `YOUTUBE_DISCOVERY_QUOTA.videoSearch` replaces `channelSearch`. This path does not log the API key. `key=` redaction on the YouTube error path is unchanged.

### Where

- `lib/enrichment/youtube.ts` (`searchVideos`)
- `lib/enrichment/youtube.test.ts`
- `lib/discovery/discover-shows.ts` (the `discoverFromYoutube` search step and `YOUTUBE_DISCOVERY_QUOTA`)
- `lib/discovery/discover-shows.test.ts`
- `docs/SENIOR_DEV_HANDOFF.md`

### Tests

`npx vitest run lib/enrichment/youtube.test.ts lib/discovery/discover-shows.test.ts` (2 files, 37 passed).

`searchVideos` asserts `part=snippet`, `type=video`, `order=viewCount`, `videoDuration=medium`, `publishedAfter` of `2025-10-26T21:46:00.000Z` when the clock is `2026-10-26T21:46:00.000Z`, `regionCode=US`, `relevanceLanguage=en`, and `maxResults=50`. Duplicate channel ids stay in that rank order. A video with no channel id is dropped. The request sends the key. The test does not log it.

Discovery turns 4 queries of 50 videos into 196 deduped channel ids in rank order. The shared channel is first. The second video of the first query repeats that channel and is dropped. Detail calls batch at 50 (50, 50, 50, 46). A fifth ring is not searched. `searchChannels` is not called. `maxResults` is 50 on every call. The log names 49 channels on the first query, 50 on each of the other three, and a unique total of 196. The 4-search cap, the empty retry, the market filter, the brand check, the floors, and the top-10 recent-stats fixture still pass. Quota worst case is 1,414.

Full `npx vitest run`: 265 files, 2395 passed, 40 skipped. `npx tsc --noEmit` clean. `npx next build` compiled and generated 134 pages.

No page or component was edited. Screenshots are not applicable.

### Known gaps

- `videoDuration=medium` is 4 to 20 minutes. A popular video longer than 20 minutes is not in this search.
- `publishedAfter` uses calendar months. A February 29 call looks back to March 1 of the previous year.
- The 1,414 worst case assumes 200 unique channels. Overlap spends fewer `channels.list` units.
- `searchChannels` is still what `POST /api/shows/[id]/enrich` and the enrich-batch route call. Those lookups are unchanged.
- `lib/discovery/category-mapping.ts` comments still say channel search. The cap constant was not edited. The search that runs is `searchVideos`.
- Recent stats still run on the top 10 after the market filter, before the video-count and brand checks (D7). A tiny or brand channel in that ten can still use a stats call.
- No migration. Nothing was applied to `ldtmhafewfifdizgfrnn`. No live write, charge, or send.
- Live confirmation waits on deploy. This PR does not merge and does not rerun a campaign. After deploy, rerun the 1-ring Ritual campaign within the hour. Target: at least 10 YouTube channels reach scoring. Read the funnel logs. Campaign `48925bc6` is the reference (4 channel searches, 3 returned, the views floors dropped 47).

## L1 YouTube channel library

### What was built

A private YouTube creator catalog. Discovery reads it before a live search. The rows are not shows. `show_id` is set only when `shows.youtube_channel_id` matches, or a podcast show's stored YouTube link resolves to that channel exactly once. Zero matches and two or more matches stay unlinked. The pull never inserts a `shows` row.

Migration 074 adds `public.youtube_channels` and `public.youtube_pull_queue`. RLS is on. There are no policies. `service_role` has select, insert, update, and delete. `anon`, `authenticated`, and `public` have nothing. `authenticated` also has truncate, references, and trigger revoked. `youtube_pull_queue.created_at` is the resume order. The pull stamps it one millisecond apart so a single insert keeps category order.

Twenty category sets (4 to 6 phrases each) and `data/youtube-seeds.csv` (header only) seed the queue on the first pull. The daily pull budget is 8,000 units. A video search is 100. `channels.list` is 1 per 50 ids. A search that would pass the budget is not started, and that queue row stays pending. Seed handles and usernames resolve with one `channels.list` (1 unit). A bare channel id costs 0 to resolve, then 1 to fetch details. Each channel is stored whether or not it passes the same market filter, brand check, and view floors discovery already uses. The API key is never logged. Errors keep the HTTP status and a quota reason only.

Step A writes deterministic niche tags from topic labels and keywords onto the existing 17-name taxonomy. Step B runs inside the refresh cron. Untagged or old-version rows go to the existing LLM (`callLLMWithFallback`, `maxRetries: 0`) in batches of 50. The daily cap is 400 channels. Tags outside the taxonomy are dropped. `niche_tags_version` and `tagged_at` are set.

The refresh cron walks oldest `stats_refreshed_at` first, 1,000 units a day. A row older than 30 days that this run did not refresh is deleted when it has no show, or has its YouTube-sourced fields cleared when it does. A channel missing from `channels.list`, or a 404, is deleted.

`discoverFromYoutube` reads eligible library rows first: passed the market filter, no brand flag, same video-count and view floors, stats under 30 days, scored by niche tag and topic overlap with the ring terms and interests, top 60. The live video search runs only when fewer than 10 match. Those live results are upserted with source `discovery`. The returned shape is still `Show`. Scoring, weights, bands, and tiers are unchanged. A missing table, or no Supabase service key, is a no-op and discovery falls through to the live search.

Crons: `GET /api/cron/youtube-library-pull` at 17:00 UTC and `GET /api/cron/youtube-library-refresh` at 18:00 UTC. Both require `Authorization: Bearer <CRON_SECRET>`. A missing secret is 401. `vercel.json` regions are unchanged. `app/api/cron/pooled-priors/route.test.ts` asserts the full cron list, so those two entries were added there.

### Where

- `supabase/migrations/074_youtube_channels.sql`
- `supabase/migrations/074_youtube_channels.test.ts`
- `lib/youtube-library/categories.ts`, `seeds.ts`, `pull.ts`, `store.ts`, `tags.ts`, `refresh.ts`, `read.ts`, and each `.test.ts`
- `data/youtube-seeds.csv`
- `app/api/cron/youtube-library-pull/route.ts` and `route.test.ts`
- `app/api/cron/youtube-library-refresh/route.ts` and `route.test.ts`
- `vercel.json` (two cron entries only)
- `app/api/cron/pooled-priors/route.test.ts` (cron-list assertion)
- `lib/discovery/discover-shows.ts` (`discoverFromYoutube` reads the library first)
- `docs/SENIOR_DEV_HANDOFF.md`

### Tests

`npx vitest run supabase/migrations/074_youtube_channels.test.ts lib/youtube-library app/api/cron/youtube-library-pull app/api/cron/youtube-library-refresh lib/discovery/discover-shows.test.ts app/api/cron/pooled-priors/route.test.ts` (12 files, 66 passed).

PGlite: RLS on for both tables; `anon` and `authenticated` denied; `service_role` allowed; queue unique on kind and value; `show_id` `on delete set null`.

Unit: budget stop at 250 units (two searches, 202 units, the third query stays pending and runs the next day); queue dedupe; handle resolution without the API key in the error; unique-only show linking; deterministic tag mapping; batch cap of 400; refresh order, 30-day null or delete, and 404 delete; cron auth; library-first reads with and without the live top-up. Existing discovery fixtures still pass because a missing library returns no rows and the live search runs.

Full `npx vitest run`: 275 files, 2429 passed, 40 skipped. `npx tsc --noEmit` clean. `npx next build` compiled and generated 136 pages.

No page or component was edited. Screenshots are not applicable.

### Known gaps

- Migration 074 is in the PR and was not applied. Apply on `ldtmhafewfifdizgfrnn` only after merge and Chris's own-words OK. Until then both crons no-op when the table is missing.
- `data/youtube-seeds.csv` is a header. Chris fills channel URLs or ids. An empty file still queues the category phrases.
- A category query that spends its search (100) and then runs out of budget before `channels.list` stays pending and is searched again the next day.
- Refresh treats every id omitted from a `channels.list` response as gone and deletes it. A 404 on the batch deletes that batch.
- Deterministic tags that match the current taxonomy version are kept. The LLM runs only for untagged rows and rows below `niche_tags_version`.
- Library reads page at most 50,000 eligible rows. Ranking still returns at most 60.
- `custom_url` is used in memory for the show-link check. It is not a column. The database link uses `shows.youtube_channel_id` and stored surface links.
- No live write, charge, or send. This PR does not merge. After 074 is applied, the day-1 check is row count, units logged, and category spread. Do not rerun a campaign to prove the library until that apply.
