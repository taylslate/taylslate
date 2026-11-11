# Senior dev handoff

## Automated airchecks, parts 1 and 2

### What was built

A daily job pulls the episode for each booked IO spot whose air window is open, transcribes that episode, and stores a match that is ready for a person to review. Part 3, the review screen that marks delivery and charges, was left as it is. No screen, style, or animation was edited. `lib/stripe`, `lib/payouts`, and `lib/billing` were not edited.

Booked means deal status `show_signed`, `delivering`, `signed`, `live`, or `completed`, and `cancelled_at` is empty. A cancelled IO is skipped. The air window starts on `io_line_items.post_date` and runs 7 days, through `post_date` plus 6 days. The job keeps looking for 7 days after the window closes. At most 25 spots run per cron. A show with no booked line is never fetched.

Part 1. A podcast spot fetches that show's RSS and downloads the enclosure published inside the window, or the enclosure for the episode URL already on the line. A YouTube spot uses `YouTubeClient.recentUploadsStats` for that channel's recent long-form uploads, or `getVideo` when the line already names a video id. That is the same client the YouTube library uses. The library pull, the search catalog, and `youtube_pull_queue` are not called. The audio is written to a temp file and deleted when transcription finishes, including when transcription throws. The publisher URL is kept on `audio_url`. The file is not uploaded to storage.

Transcription goes through `TranscriptProvider`. The first provider is OpenAI `whisper-1` (`lib/airchecks/openai-whisper.ts`). `OPENAI_API_KEY` is read from the environment. It is not set. The cron then returns 200 with `skipped: "missing_openai_api_key"` and writes nothing. An mp3 over 24MB is split on frame boundaries so each upload stays under Whisper's 25MB limit. A file that large that is not mp3 is stored as failed. Segments are `{ start_seconds, end_seconds, text }`.

Cost. whisper-1 is priced at $0.006 per minute in `WHISPER_USD_PER_MINUTE`. A 30-minute episode is $0.18. A 45-minute episode is $0.27. A 60-minute episode is $0.36. `AIRCHECK_RUN_COST_CAP_USD` defaults to $1 when unset, about 166 minutes, about three 45-minute episodes. `0` stops the run before any download. The next episode is skipped when its estimate would pass the cap. The log line is `[aircheck] line=... minutes=... estimated_cost_usd=... provider=openai-whisper`. The key and the transcript are not logged. The stored cost uses the duration Whisper returns. A guess from file size, at 128 kbps, is used only to decide whether to start.

Part 2. The read is located from the brand name, `deals.promo_code`, the brand URL, and bullet lines in the outreach pitch. The IO has no talking-points column. The judgment checks placement (pre-roll, mid-roll, post-roll, by where the read starts in the episode) and approximate length (about 30s pre-roll, 60s mid-roll, 30s post-roll, counted when the measured span is between half and double that). Confidence is 0 to 1: brand 0.40, code or URL 0.30, placement 0.15, length 0.10, talking points 0.05. `ready_for_review` is set for `matched` and `not_matched`. A skipped row stays false. `review_decision` is not set. `io_line_items.verified` is not set. No payment row is written. The make-good hook is not called from this cron.

Migration 079 adds the columns and the checks. It is in the repo and is not applied. `service_role` is the only grant. `authenticated` and `anon` have no select and no policy, so `decided_by`, errors, `audio_url`, and the transcript are not on the Data API. Every reader uses the service role. RSS and enclosure fetches resolve the host once, connect to that address, stream the body, and abort at 5MB (RSS) or 200MB (audio). Whisper and YouTube calls use an AbortSignal. The cost cap is checked again before each Whisper chunk, the estimate is the larger of the feed duration and the file-size guess, and money already spent is counted when a later save fails. New spots stop at 200 seconds.

Cron: `GET /api/cron/airchecks` at 20:00 UTC. Bearer `CRON_SECRET`. A missing secret is 401. `maxDuration` is 300. `vercel.json` regions stay `pdx1`. `/api/cron/*` was already public in `proxy.ts`.

### Where

- `supabase/migrations/079_airchecks_automated.sql` and its test
- `lib/airchecks/cost.ts`, `window.ts`, `provider.ts`, `openai-whisper.ts`, `audio.ts`, `locate.ts`, `episode.ts`, `select.ts`, `persist.ts`, `run.ts`, and their tests
- `lib/airchecks/rss.ts` (itunes duration on the parsed item)
- `lib/airchecks/match.ts` (shared phrase helpers exported)
- `lib/enrichment/youtube.ts` (`getVideo`, one videos.list call)
- `app/api/cron/airchecks/route.ts` and `route.test.ts`
- `vercel.json` (one cron entry)
- `app/api/cron/pooled-priors/route.test.ts` (cron list)
- `lib/data/types.ts` (`aircheck.transcribed`, `aircheck.ready_for_review`)
- `STATUS.md`, `PRODUCT_BACKLOG.md`, `docs/SENIOR_DEV_HANDOFF.md`

### Tests

`npx vitest run`: 315 files, 2752 passed, 40 skipped. `npx tsc --noEmit` clean. `npx next build` compiled and generated 140 pages.

Covers private and NAT64 addresses, a pinned DNS answer, capped response bodies, the RSS item cap, the Whisper chunk cap, spend kept when a save fails, the 200 second stop, no authenticated select on airchecks, and the cron bearer comparison.

No page or component was edited. Screenshots are not applicable.

### Known gaps

- Migration 079 is in the repo and is not applied. Apply it on `ldtmhafewfifdizgfrnn` only after merge and Chris's OK, in the same release as this deploy. Until then the cron returns `skipped: "migration_079"`.
- `OPENAI_API_KEY` is not set in Vercel by this PR. The cron skips until it is. `AIRCHECK_RUN_COST_CAP_USD` is optional.
- YouTube's Data API does not return an audio file. A YouTube spot is identified and then stored as failed, with no Whisper call, unless `episode_url` is already a media file. No HTML scrape was added.
- Recent uploads are the latest long-form page the existing client already reads (about 15 videos, inside 90 days). A named video id uses `videos.list` for that id only.
- Talking points are bullet lines in `outreaches.pitch_body`. The IO table has no column for them. Approximate length is the placement default above. It is not a stored IO term.
- The cron does not call the make-good hook. The existing admin aircheck route and the review confirm path still do.
- This PR does not merge. Paul reviews.

### Env

`OPENAI_API_KEY` is required before any episode is transcribed. It is not set. `AIRCHECK_RUN_COST_CAP_USD` is optional. Unset uses 1. This PR does not change Vercel env vars.

### Choices to confirm

- (a) The air window is 7 days from `post_date`, plus 7 days of catch-up.
- (b) Booked statuses are show_signed, delivering, signed, live, and completed.
- (c) The default cap is $1 per run, at $0.006 per minute.
- (d) A YouTube spot without a media file is stored as failed and is not transcribed.
- (e) `ready_for_review` does not charge. The existing review screen still does, after a person confirms.
- (f) Paul Jones reviews. This PR does not merge.

## ADM1: Internal operations dashboard

### What was built

A read-only founder page at `/admin`. No ADM1 spec was in the backlog or `docs/jobs`. The page follows the existing admin gate and the Ink & Gold admin pages.

Signed out, `proxy.ts` sends the browser to `/login` before this page runs. Signed in, the only gate is `isInternalAdmin` on the session email (`INTERNAL_ADMIN_EMAILS`). Anyone else gets `notFound()`. `profiles.email` is not read. A signed-in user can update that column, so it must not grant this page. `profiles.role` is not read either. The check constraint does not allow `admin`. The allowlisted founder address is `chris@taylslate.com` only when that address is in `INTERNAL_ADMIN_EMAILS`. No new env var.

The page is not in the sidebar. `lib/nav/items.ts` was not edited. Existing admin screens were not edited.

Sections:

- Accounts: counts for brand, show, agency, and sales agent, plus signups in the last 24 hours and 7 days. The list filters by role and searches name, email, and company. Latest 40.
- Campaigns: counts by status. Active means status `active`. The list opens on active and can search the campaign name or the account.
- Deals: counts by status. Active means every status except `completed` and `cancelled`. The list opens on active and can search the show name or the brand account. Gross is `deals.total_gross` when that column is set.
- Platform fees: sum of `payments.application_fee_amount_cents` where status is `succeeded` or `completed`. The last 30 days use `charged_at`, then `created_at`. Pending and processing are labeled not yet collected. Refunded and disputed stay out of the collected total. This does not call Stripe.
- YouTube library: total channels, `passed_market_filter`, created in the last 24 hours and 7 days, and `youtube_pull_queue` by status. If a column name contains "email", the page counts non-empty values. If no such column exists, it says so. A missing table is a note. The other sections still render.
- Recent errors and jobs: domain events whose type contains fail, error, rolled_back, or unverified, plus `payment.disputed`. Payloads are not selected. Failed payments show id and date only. YouTube pull errors and the latest finished jobs are listed. Error text is shortened and secret-shaped values are stripped.

Every query is a select through the service role, after the gate. There is no insert, update, delete, or rpc on this path.

### Where

- `app/(dashboard)/admin/page.tsx` at `/admin`
- `app/(dashboard)/admin/ops-view.tsx`
- `app/(dashboard)/admin/page.test.tsx`
- `lib/admin/ops-dashboard.ts` and `lib/admin/ops-dashboard.test.ts`
- `lib/admin/ops-db.ts` and `lib/admin/ops-db.test.ts`
- `lib/admin/ops-filters.ts`
- `PRODUCT_BACKLOG.md`
- `STATUS.md`

`lib/stripe`, `lib/payouts`, `lib/billing`, `lib/airchecks`, and `lib/youtube-library` were not edited. No migration. Nothing was applied on `ldtmhafewfifdizgfrnn`. No Vercel env change.

### Tests

`npx vitest run lib/admin/ops-dashboard.test.ts lib/admin/ops-db.test.ts "app/(dashboard)/admin/page.test.tsx" proxy.test.ts`

Covers the session-email allowlist, a 404 with no read when `profiles.email` is the founder address but the session email is not, a 404 with no read for signed-out and non-admin sessions, fee sums, list filters, YouTube counts, a missing YouTube table, no email column, redaction of key and payment identifiers, and that the selects do not ask for payment intent ids or event payloads. The page source does not call `isShowsAdmin`. The view renders the fee total, the email-column note, and the existing admin links. Rendered text has no em dash.

`npx tsc --noEmit` clean.

`proxy.test.ts` asserts a signed-out `GET /admin` redirects to `/login?next=/admin`, and a signed-in session is not redirected by the proxy. The page then 404s unless the session is an admin. A local `next dev` check did the same: `GET /admin` returned 307 to `/login?next=%2Fadmin`, and the login HTML did not include the dashboard. This environment has no `.env.local`, so the filled dashboard was not clicked through as a signed-in admin. The view assertions are the rendered component.

### Known gaps

- The page sits under the dashboard layout. A profile with no role, or a brand or show that has not finished onboarding, is redirected by that layout before this page renders. Chris's founder account already has a role and has finished onboarding, so `/admin` opens for that login.
- There is no sidebar link. Open `/admin` directly.
- Email totals depend on a column whose name contains "email". Migration 074 has no email column. Until one exists, the page says so.
- `youtube_channels` and `youtube_pull_queue` are read if they are present. A missing table does not fail the page.
- Fee totals stop after 5,000 payment rows and say so. Collected revenue is the stored fee snapshot, not a Stripe balance.
- Deal gross uses `total_gross`. A Wave 12 deal can have that empty. The status still shows.
- Search ignores characters other than letters, numbers, space, and `@.+_-`, and it keeps 80 characters.
- While an admin is impersonating a test account, the session email is the test account, so this page 404s. That is the same gate as the other admin tools.

### Follow-up, not in this PR

`canEditShow` in `lib/shows/can-edit-show.ts` has the same `profiles.email` trust bug. `isShowsAdmin` returns true when `profiles.email` is on `INTERNAL_ADMIN_EMAILS`, or when `profiles.role` is `admin`. A signed-in user can update their own `profiles.email`. The role check is dead: the `profiles.role` check constraint does not allow `admin`. Do not change `canEditShow` or `isShowsAdmin` in this PR. A later change should decide show edits from the session email only.

### Choices to confirm

- (a) `/admin` is the URL. It is not linked from the sidebar.
- (b) Active campaigns are status `active`. Active deals exclude `completed` and `cancelled`.
- (c) Collected fees are `succeeded` and `completed` only.
- (d) Sales agents are listed with brands, shows, and agencies.
- (e) YouTube email stats appear only when a matching column exists.
- (f) Paul Jones reviews. This PR does not merge until then.

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
- Settings UI shipped in A5 at `/settings/api-keys`. Data endpoints shipped in A2.
- No plan check. Operator `apiAccess` is for A7.
- The limit is 60 requests per minute per key, in code, not an env var.
- `lib/utils/rate-limit.ts` is still the in-process limiter for outreach actions.
- `last_used_at` is best-effort. A failed touch does not fail the request.
- Old rate windows for a key are deleted on that key's next increment once they are an hour old. Windows for idle keys stay until the key is used again or the key row is deleted.
- `listKeys` and `revokeKey` are service-role helpers. A5 calls them from `/settings/api-keys` and `/api/settings/api-keys` for the signed-in brand. The plaintext secret is still returned only from `createKey`.

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

- Approve and reject are on `/settings/agent-actions` (A4). A pending row stays pending until the brand decides there.
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

Twenty category sets (4 to 6 phrases each) and `data/youtube-seeds.csv` (header only) seed the queue on the first pull. The daily pull budget is 8,000 units. A video search is 100. `searchVideos` takes an `order` argument and defaults to `relevance`. The category pull and the live discovery top-up both pass `relevance`. `channels.list` is 1 per 50 ids. A search that would pass the budget is not started, and that queue row stays pending. Seed handles and usernames resolve with one `channels.list` (1 unit). A bare channel id costs 0 to resolve, then 1 to fetch details. Each channel is stored whether or not it passes the same market filter, brand check, and view floors discovery already uses. The API key is never logged. Cron and tag errors go through `redactSecretParams` before they are logged. Pull errors keep the HTTP status and a quota reason only.

Step A writes deterministic niche tags from topic labels and keywords onto the existing 17-name taxonomy. Step B runs inside the refresh cron. Untagged or old-version rows go to the existing LLM (`callLLMWithFallback`, `maxRetries: 0`) in batches of 50. The daily cap is 400 channels. Tags outside the taxonomy are dropped. `niche_tags_version` and `tagged_at` are set.

The refresh cron walks oldest `stats_refreshed_at` first, 1,000 units a day. A row older than 30 days that this run did not refresh is deleted when it has no show, or has its YouTube-sourced fields cleared when it does. A channel missing from `channels.list`, or a 404, is deleted.

`discoverFromYoutube` reads eligible library rows first: passed the market filter, no brand flag, same video-count and view floors, stats under 30 days, scored by niche tag and topic overlap with the ring terms and interests, top 60. The live video search runs only when fewer than 10 match, with `order=relevance`. Those live results are upserted with source `discovery`. The returned shape is still `Show`. Scoring, weights, bands, and tiers are unchanged. This does not re-add the D8 channel-to-video search or the `maxResults` change. Those already shipped on main. A missing table, or no Supabase service key, is a no-op and discovery falls through to the live search.

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
- `lib/discovery/discover-shows.ts` (`discoverFromYoutube` reads the library first; live top-up uses `order=relevance`)
- `lib/discovery/discover-shows.test.ts` (live top-up passes `relevance`)
- `lib/enrichment/youtube.ts` (`searchVideos` `order` argument, default `relevance`)
- `lib/enrichment/youtube.test.ts`
- `docs/SENIOR_DEV_HANDOFF.md`

### Tests

`npx vitest run supabase/migrations/074_youtube_channels.test.ts lib/youtube-library app/api/cron/youtube-library-pull app/api/cron/youtube-library-refresh lib/discovery/discover-shows.test.ts app/api/cron/pooled-priors/route.test.ts` (12 files, 66 passed).

PGlite: RLS on for both tables; `anon` and `authenticated` denied; `service_role` allowed; queue unique on kind and value; `show_id` `on delete set null`.

Unit: budget stop at 250 units (two searches, 202 units, the third query stays pending and runs the next day); queue dedupe; handle resolution without the API key in the error; unique-only show linking; deterministic tag mapping; batch cap of 400; refresh order, 30-day null or delete, and 404 delete; cron auth; library-first reads with and without the live top-up. Existing discovery fixtures still pass because a missing library returns no rows and the live search runs.

Full `npx vitest run`: 275 files, 2429 passed, 40 skipped. `npx tsc --noEmit` clean. `npx next build` compiled and generated 136 pages. The live top-up asserts `searchVideos` is called with `relevance`. `searchVideos` still sends `viewCount` when that order is passed.

No page or component was edited. Screenshots are not applicable.

### Known gaps

- Migration 074 is in the PR and was not applied. Apply on `ldtmhafewfifdizgfrnn` only after merge and Chris's own-words OK. Until then both crons no-op when the table is missing.
- `data/youtube-seeds.csv` is a header. Chris fills channel URLs or ids. An empty file still queues the category phrases.
- A category query that spends its search (100) and then runs out of budget before `channels.list` stays pending and is searched again the next day.
- Refresh treats every id omitted from a `channels.list` response as gone and deletes it. A 404 on the batch deletes that batch.
- Deterministic tags that match the current taxonomy version are kept. The LLM runs only for untagged rows and rows below `niche_tags_version`.
- Library reads page at most 50,000 eligible rows. C1 replaced the top-60 rank cap with a 500 safety cap.
- `custom_url` is used in memory for the show-link check. It is not a column. The database link uses `shows.youtube_channel_id` and stored surface links.
- No live write, charge, or send. This PR does not merge. After 074 is applied, the day-1 check is row count, units logged, and category spread. Do not rerun a campaign to prove the library until that apply.

## C1

### What was built

Confirmed rings now map onto broad YouTube library categories, plus a fixed set of neighbors. A ring is matched, with no LLM call, against each category's pull phrases, the niche-tag taxonomy, and a synonym table. Health includes wellness and supplements. Fitness includes workout and gym. Lifestyle includes daily routine and women's lifestyle. Health's neighbors are fitness, nutrition, lifestyle, women's health, and mental health. Finance's neighbors are business and investing. A ring that matches nothing falls back to the brief's top-level category.

Discovery selects eligible library channels for every confirmed ring: passed the market filter, no brand flag, stats under 30 days, and the same video-count and view floors as live YouTube discovery. A channel matches when its niche tags or its source category (the pull phrase, or the discovery query stored on the row) sit in that ring's primary or adjacent categories. Results are combined and deduped by channel id. Each channel records the rings it matched and whether each ring was primary or adjacent. Primary sorts ahead of adjacent. Within a level, higher views sort first, then subscriber count, then channel id. The old top-60 keyword cap is gone. A named safety cap, `YOUTUBE_LIBRARY_CAP`, stops the list at 500. The live video search still runs only when the combined total is under 10.

A library channel that matched at either level gets the same topical input: the matched ring's terms, added to `audience_interests`. The channel's own topic labels stay on `categories`, so purchase power still reads those. Scoring weights, bands, thresholds, and the topical formula are unchanged. Podcast discovery is unchanged.

### Where

- `lib/youtube-library/ring-categories.ts`
- `lib/youtube-library/ring-categories.test.ts`
- `lib/youtube-library/read.ts`
- `lib/youtube-library/read.test.ts`
- `lib/discovery/discover-shows.ts` (YouTube library topical input only)
- `lib/discovery/discover-shows.test.ts`
- `docs/SENIOR_DEV_HANDOFF.md`

### Tests

`npx vitest run lib/youtube-library/ring-categories.test.ts lib/youtube-library/read.test.ts lib/discovery/discover-shows.test.ts` (3 files, 50 passed).

Full `npx vitest run`: 276 files, 2443 passed, 40 skipped. `npx tsc --noEmit` clean. `npx next build` compiled and generated 136 pages.

Ring map: protein gummies; "women's daily-wellness routine buyers"; a personal-finance ring; a ring that matches nothing and falls back to "Business & Finance". Channel categories from niche tags and source phrases.

Read: protein gummies returns health, wellness, fitness, and lifestyle channels and drops music. Rings combine. A duplicate channel id is one row and keeps both ring hits. Primary sorts ahead of a higher-view adjacent channel. The cap is 500. Live top-up runs at 9 matches and does not run at 10. A category match with a keyword score of 0 is kept.

Topical input: primary and adjacent both receive `["protein gummies"]`. Their topical scores are both 85. Weights equal `convictionWeights("mid")`. The fitness channel's categories stay `["Gym workout"]`. Without the shared input that channel scores 20. A podcast fixture snapshot is byte-identical for the stable show fields (`discovered-podscan-pd_fixture`, Health Cast, audience 20,000, CPM 22/15/10).

No page or component was edited. Screenshots are not applicable.

### Known gaps

- Lifestyle is not one of the 20 pull categories. A channel counts as lifestyle when its niche tag is Self-Improvement or Fashion & Beauty, or when its source query hits a lifestyle phrase (daily routine, wellness routine, vlog, lifestyle). An entertainment-tagged vlog with none of those signals is not included.
- Niche tags still collapse fitness, nutrition, and wellness into "Health & Wellness". Source category is what separates a gym channel from a health channel. A discovery row whose `source_query` is a long joined query can pick up every category phrase inside that string.
- The video-count and view floors still drop a category match that would not survive live discovery. The 500 cap is a safety stop, not a rank of the best 500.
- Keyword overlap (`libraryMatchScore`) is no longer the selection or the sort. It remains in the module and is not called on the read path.
- Adjacent and primary matches share ring terms on `audience_interests`. They do not share the full `topicalRelevanceInputs` list, because categories stay the channel's own topics. The direct-match rule then scores both at 85 for that ring.
- No migration. Nothing was applied to `ldtmhafewfifdizgfrnn`. No live write, charge, or send. This PR does not merge. After the library has rows, rerun the c0be25d4-style brief and report the YouTube count. Do not rerun it from this PR.

## C2 Cheaper recent-views stats from the uploads playlist

### What was built

Recent average views now come from the channel uploads playlist instead of a `search.list` (100 units). `YouTubeClient.recentUploadsStats` derives the playlist id by replacing the channel id's `UC` prefix with `UU`, or uses `contentDetails.relatedPlaylists.uploads` when the caller already has it. It calls `playlistItems.list` with `maxResults` 15, then one `videos.list` for `statistics` and `contentDetails`. That is 2 units.

The mean and the median are taken from long-form videos published in the last 90 days. A video of 60 seconds or less is a Short and is left out. A video with no duration is left out. `uploadCount` is how many of those long-form videos were in the window, on that page of 15. `avg_recent_views` stores the mean. `averageViews` is the same mean, so the existing floors still compare one number.

On an API error the call returns method `estimate` on the stats object and the catalog average (total views divided by video count). The row stores `avg_views_method` `estimated`. The warning goes through `redactSecretParams`. A successful call with no qualifying long-form video returns method `uploads` on the stats object and a mean of 0, and the row stores `recent`, so the 10,000 floor applies.

Call sites:

- Discovery asks for every channel that passes the market filter. The top-10 cap is gone. Floors stay 10,000 on an uploads measurement and 5,000 on the estimate. Worst case is 200 channels x 2 = 400, plus video search 400 and channel details 4. 804, down from 1,414.
- The daily pull charges 2 units per channel at upsert, and only when those 2 units still fit in the 8,000 budget. The constants stay 8,000 and 1,000.
- The daily refresh does the same inside the 1,000 budget. A channel it cannot afford is left unstamped so the next run still sees it as oldest.

`avg_views_method` is `recent` when the playlist measurement is stored, and `estimated` when that call fell back or never ran. Those are the only values migration 074 allows. The 10,000 floor applies to `recent`. The 5,000 floor applies to `estimated`. The stats object's own `method` stays `uploads` or `estimate` so callers can tell a playlist read from the catalog fallback before they write the row.

### Where

- `lib/enrichment/youtube.ts` (`recentUploadsStats`, playlist id, Shorts and 90-day summary)
- `lib/enrichment/youtube.test.ts`
- `lib/youtube-library/store.ts` (method on the upsert record, 2-unit budget check)
- `lib/youtube-library/store.test.ts`
- `lib/youtube-library/pull.ts` (charge 2 units per upsert inside the 8,000 budget)
- `lib/youtube-library/pull.test.ts`
- `lib/youtube-library/refresh.ts`
- `lib/youtube-library/refresh.test.ts`
- `lib/youtube-library/read.ts` (10,000 floor stays on `recent`)
- `lib/youtube-library/read.test.ts`
- `lib/discovery/discover-shows.ts` (the recent-stats call and the quota constant)
- `lib/discovery/discover-shows.test.ts`
- `docs/SENIOR_DEV_HANDOFF.md`

`pull.ts` and `read.ts` are outside the original owns list. The pull loop is what holds the 8,000 budget, and the library floor only treated `recent` as a real measurement. Both had to change for the new method to be counted and floored.

### Tests

`npx vitest run lib/enrichment/youtube.test.ts lib/youtube-library/store.test.ts lib/youtube-library/pull.test.ts lib/youtube-library/refresh.test.ts lib/youtube-library/read.test.ts lib/discovery/discover-shows.test.ts` (6 files, 63 passed).

UU id derivation, a known uploads playlist id, Shorts at 60 seconds, the 90-day window, median and mean, the error fallback, `key=` redaction, pull and refresh budget accounting, and discovery calling recent stats for every market survivor (not the top 10, and not the search.list stats call). Quota worst case is 804.

Full `npx vitest run`: 275 files, 2438 passed, 40 skipped. `npx tsc --noEmit` clean. `npx next build` compiled and generated 136 pages.

No page or component was edited. Screenshots are not applicable.

### Known gaps

- No migration. `avg_views_method` is only `recent` or `estimated`, which is what migration 074 already allows. Nothing was applied on `ldtmhafewfifdizgfrnn`. After a refresh run, the read-only check is `avg_views_method` counts on `youtube_channels`, plus the units logged per pull and per discovery run.
- The caller reserves 2 units even when the playlist is empty (1 unit) or the first call fails before `videos.list` (1 unit).
- Only the newest 15 uploads are read. A long-form video older than that page, inside 90 days, is not in the mean.
- A successful read with zero qualifying videos stores mean 0 and `avg_views_method` `recent`. The 10,000 floor drops that channel. An API error stores `estimated` and uses the 5,000 catalog floor.
- Discovery still fetches stats before the video-count and brand checks, now for every market survivor. A brand channel still spends 2 units.
- `getRecentVideoStats` (the 100-unit search) remains for the enrich routes. Discovery, pull, and refresh do not call it.
- No live write, charge, or send. This PR does not merge.

## L3

### What was built

After Send code, `/login` shows: "If an account exists for this email, we sent a 6-digit code. New here? Sign up." Sign up links to `/signup`. The same sentence shows for every email. The page does not say whether that address has an account.

`POST /api/auth/login/otp` is unchanged. A known email and an unknown email both get `{ ok: true }`. An unknown email still sends nothing.

### Where

- `app/(auth)/login/page.tsx` (the sentence and the link)
- `app/(auth)/login/page.test.tsx`
- `components/auth/show-email-code.tsx`
- `docs/SENIOR_DEV_HANDOFF.md`

`show-email-code.tsx` is outside the owns list. That component renders the sentence, and the pitch page uses it too. `/login` passes `sentNotice`. The pitch page leaves it unset and keeps "If there's an account for that email, we sent a 6-digit code."

### Tests

`npx vitest run`: 276 files, 2452 passed, 40 skipped. `npx tsc --noEmit` clean. `npx next build` compiled and generated 136 pages.

The login page test checks the sentence and the `/signup` link after submit for `jane@example.com` and `nobody@example.com`.

Review of `app/api/auth/login/otp/route.test.ts` (not edited): "emails a 6-digit code for an existing show", "emails a 6-digit code for an existing brand", and "returns ok for an unknown email and does not create a user or send mail" all expect status 200 and `{ ok: true }`. The route file is not in the diff.

### Known gaps

- The line above the form still says "We'll email a 6-digit code." This job only changes the sentence after submit.
- The footer "Don't have an account? Sign up" is unchanged.
- The pitch page code form keeps the previous sentence. That screen can create a show from an outreach token.
- No migration. Nothing was applied on `ldtmhafewfifdizgfrnn`. No live write, charge, or send. Screenshots intercepted the code request. This PR does not merge.

## V2-test-agent-account

### What was built

The admin view switch can open Chris's test agent account. `ADMIN_TEST_AGENT_USER_ID` is `e0592378-1981-4f44-98a1-db67fee0ea79`. `ADMIN_VIEW_AGENT` keeps key `agent1` and label `Test Agent 1`, and its email is `chris+agent@taylslate.com`. That account was created Oct 29 2026. It is confirmed, and its profile role is agent.

`configuredAdminViewAccount("agent")` returns that account. The view-mode route and sidebar already enable Agent when that lookup returns an account, so those files were not edited. The cookie value is `test:agent1`. The account is not on `TEST_ACCOUNTS`, so test-login impersonation is unchanged.

The view guard source is unchanged. A configured `test:agent1` cookie now resolves, so the existing money block applies to an admin agent view the same way it applies to brand and show.

### Where

- `lib/admin/test-accounts.ts` (`ADMIN_TEST_AGENT_USER_ID`, `ADMIN_VIEW_AGENT.email`)
- `lib/admin/test-accounts.test.ts`
- `docs/SENIOR_DEV_HANDOFF.md`

Three tests asserted the empty id and would have failed `npx vitest run`. They were updated. No production file outside `lib/admin/test-accounts.ts` changed:

- `app/api/view-mode/route.test.ts` (admin agent view sets `test:agent1` and GET reports `agentConfigured: true`; a non-admin still gets `agentConfigured: false` and `POST` agent is still `Invalid mode`)
- `lib/data/effective-role.test.ts` (admin `test:agent1` resolves to Test Agent 1)
- `lib/admin/view-guard.test.ts` (admin `test:agent1` is blocked by the existing guard)

`components/layout/Sidebar.test.tsx` was not edited. The disabled-agent case stubs `agentConfigured: false` from the view-mode response, so it does not depend on the empty id and still passes.

### Tests

`npx vitest run lib/admin/test-accounts.test.ts`

Covers `configuredAdminViewAccount("agent")`, key `agent1`, label `Test Agent 1`, the user id and email above, cookie `test:agent1`, and that the test-login list stays `brand1` and `show1`.

`npx vitest run app/api/view-mode/route.test.ts lib/data/effective-role.test.ts lib/admin/view-guard.test.ts components/layout/Sidebar.test.tsx` (48 passed).

Full `npx vitest run`: 277 files, 2456 passed, 40 skipped. `npx tsc --noEmit` clean. `npx next build` compiled and generated 136 pages.

### Known gaps

- Reads and writes stay on the signed-in admin id. The view changes the dashboard role and the banner. Test Agent 1's rows are not loaded, and nothing is written as that user.
- The guard, cookie format, sidebar styles, and payments and payouts code were not edited. Once the agent account is configured, the existing money block includes that view.
- No migration. Nothing was applied to `ldtmhafewfifdizgfrnn`. No charge. This PR does not merge.
- Two sign-in codes were emailed so the preview check could open a session: one to chris@taylslate.com and one to chris+agent@taylslate.com. No product email was sent.
- Local preview on this branch, signed in as chris@taylslate.com: Agent is enabled, the agent view shows "Viewing as Test Agent 1" with Import Shows, and Exit returns to the brand admin view. Signed in as chris+agent@taylslate.com, the switch is absent. `GET /api/view-mode` returns `agentConfigured: false`, and `POST` mode `agent` returns 400 `Invalid mode`. Production, before this branch, still shows "No test agent configured".

## D0 DocuSign envelope counter

### What was built

An admin-only read of how many DocuSign envelopes the app has sent in the current America/Denver calendar month, against the Starter allowance of 40. The line warns at 35 or more. Sends are not blocked, and nothing is emailed, posted, or pushed.

`GET /api/admin/docusign-usage` checks the session with `getAuthenticatedUser` and `isInternalAdmin` before any database call. No session is 401. A signed-in brand, show, or agent is 403. An admin gets the usage object. A failed read is 500 with `{ error: "Could not read DocuSign usage" }`, never a zero count. The route is node, force-dynamic, and `Cache-Control: no-store`.

The count is one head query on `domain_events`: `event_type` `io.sent_for_signature`, `created_at` from the Denver month start inclusive to the next month start exclusive. `DOCUSIGN_ENV` is read in `lib/docusign/usage.ts` and defaults to sandbox, same as the DocuSign client. Sandbox state is always `ok`. Production state is `ok` below 35, `warn` from 35 through 40, and `over` above 40.

`/admin/brands` renders the line once, above `ManagedBrandsClient`, inside the admin branch only. The non-admin branch is unchanged. A 401 or 403 renders nothing. A 500 renders "DocuSign usage unavailable". One fetch on mount. No polling.

### Where

- `lib/docusign/usage.ts`
- `lib/docusign/usage.test.ts`
- `app/api/admin/docusign-usage/route.ts`
- `app/api/admin/docusign-usage/route.test.ts`
- `app/(dashboard)/admin/brands/docusign-usage-line.tsx`
- `app/(dashboard)/admin/brands/docusign-usage-line.test.tsx`
- `app/(dashboard)/admin/brands/page.tsx` (the one admin line only)
- `app/(dashboard)/admin/brands/page.test.tsx`
- `docs/SENIOR_DEV_HANDOFF.md`

### Tests

`npx vitest run` : 280 files, 2480 passed, 40 skipped. `rm -rf .next && npx tsc --noEmit` clean. `npx next build` compiled and generated 136 pages.

The usage tests assert one head count on `domain_events` for `io.sent_for_signature` and the Denver bounds, with a mocked `supabaseAdmin`. They cover 2026-11-01 05:59:59 UTC (still October) versus 2026-11-01 06:00:00 UTC (November 1 00:00 MDT), November 2026 (`2026-11-01T06:00:00.000Z` to `2026-12-01T07:00:00.000Z`), March 2027 (`2027-03-01T07:00:00.000Z` to `2027-04-01T06:00:00.000Z`), states at 34, 35, 40, and 41, sandbox staying `ok`, and a thrown read error. The route test proves 401 and 403 make no database call, and a failed read returns 500 rather than `used: 0`. The page test renders a signed-in non-admin and finds only "This page is for Taylslate admins."

Read-only live count of `io.sent_for_signature` on `ldtmhafewfifdizgfrnn`: 0. No live write, charge, or send. This PR does not merge.

### Known gaps

- The count comes from `io.sent_for_signature` rows only, so an envelope created while `logEvent` failed (it never throws) would be missed.
- The window is the America/Denver calendar month. DocuSign bills on its own plan period, which may not start on the 1st.
- `domain_events` has no `event_type` index. The table is small today, so the count query is fine. Do not add an index in this job.
- Sandbox rows are not separable in past months because the payload does not record the environment. The current `DOCUSIGN_ENV` decides whether this month's count warns.
- No allowance error exists in the code to surface at 40. Sends stay unblocked.
- Embedded signing stays parked.

## P1 YouTube library pull: stop the 300 second timeout

### What was built

`GET /api/cron/youtube-library-pull` still has `maxDuration` 300. That is the Hobby plan Fluid Compute cap. A production run on Oct 29 2026 was killed at 300 seconds. The route now stops on a 240 second wall clock (`YOUTUBE_LIBRARY_PULL_TIME_BUDGET_MS`) before that kill. A time stop is a normal HTTP 200. `stopped` is `"time"`, `"budget"`, `"quota"`, or null.

The pull no longer awaits one channel at a time. After `channels.list`, found channels are taken in chunks of 10. Show linking and saves run at a concurrency of 4. Uploads stats for the channels in a chunk that are not already fresh go through `recentUploadsStatsBatch`: one `playlistItems.list` per channel, four at a time, then `videos.list` in groups of 50 across those videos. `channels.list` and `videos.list` never send more than 50 ids. Each YouTube call from the library client is bounded at 20 seconds. A timed out stats call stores `avg_views_method` `estimated`. A timed out search or `channels.list` leaves that queue row pending, adds one attempt, and the run continues.

A stats chunk also gets its own deadline: the lesser of the time still left and 40 seconds (`YOUTUBE_LIBRARY_PULL_CHUNK_STATS_MS`). `recentUploadsStatsBatch` receives that absolute time. Once it passes, remaining playlist and `videos.list` calls are not started. Channels that did not get a finished read are `estimated`, including through the existing `failedVideoIds` path when the playlist was already read. The pull also wraps the batch in `withTimeout` of at most 45 seconds, so a client that ignores the deadline still cannot add the ~120 seconds a fully stalled chunk would take. A chunk that starts at 239 seconds therefore ends well under the 300 second function limit. The clock is also checked before search and before `channels.list`, and either of those stops the run with `stopped: "time"`.

An empty uploads page, or a page with no qualifying long-form video, used to come back as method `uploads` with mean 0. `draftToRecord` then stored `avg_views_method` `recent` and `avg_recent_views` 0, including for channels that have videos. That 0 is not a measurement. It is now stored as `estimated` (the catalog average, total views divided by video count) or left null when that average cannot be computed. A recent mean above the channel's lifetime `total_view_count` is stored as `estimated` as well, not capped and labeled recent. A positive mean that does not exceed the lifetime total is still `recent`.

Units are the calls that actually ran: 100 per search, 1 per `channels.list`, 1 per `playlistItems.list`, 1 per `videos.list`. Before a chunk, the worst case (one playlist per channel that needs stats, plus the `videos.list` calls for 15 uploads each) has to fit in the remaining 8,000. Otherwise the run stops with `stopped: "budget"`. The 8,000 and 1,000 budgets are unchanged. `UPLOADS_STATS_UNITS` stays exported for refresh.

A channel whose `stats_refreshed_at` is within 24 hours and whose `avg_views_method` is set does not spend uploads stats units again. The row is still upserted, so `first_seen_at`, `created_at`, and `source` stay as saved. `saveChannel` skips its extra read when the caller passes the existing row. There is no new table or column. A query stays pending until every channel from that search is saved. The next run continues from `youtube_pull_queue`. The JSON report and the `[youtube-library] pull` log line include `elapsedMs`, `searched`, and `chunks`. Errors go through `redactSecretParams` or `scrubYoutubeError`. The API key is not logged, returned, or stored on `last_error`.

### Where

- `app/api/cron/youtube-library-pull/route.ts` and `route.test.ts`
- `lib/youtube-library/pull.ts` and `pull.test.ts`
- `lib/youtube-library/store.ts` and `store.test.ts` (`getChannels`, `saveChannel` skips the extra read when the row is passed)
- `lib/enrichment/youtube.ts` and `youtube.test.ts` (`chunk`, `recentUploadsStatsBatch`; `recentUploadsStats` is unchanged)
- `docs/SENIOR_DEV_HANDOFF.md`

`vercel.json`, refresh, discovery callers, scoring, categories, seeds, and the UI were not edited.

### Tests

`npx vitest run lib/enrichment/youtube.test.ts lib/youtube-library/pull.test.ts lib/youtube-library/store.test.ts app/api/cron/youtube-library-pull/route.test.ts lib/youtube-library/refresh.test.ts` (5 files, 51 passed).

Clock stop leaves the current queue row pending and earlier rows done. A second `runPullQueue` on the same memory store continues from the pending rows and does not insert a duplicate channel. A time stop before search does not call search. A time stop during search does not call `channels.list`. A channel refreshed in the last 24 hours spends no stats units. `chunk` makes 1 `channels.list` call for 50 ids and 2 for 51. Batched `videos.list` never receives more than 50 ids. The concurrency helper never has more than 4 in flight and keeps order. A timed out playlist call is `estimated` for that channel and the other channel is still measured. A stalled YouTube client finishes the run in under 300 seconds, and a stats batch that ignores its deadline is cut when the chunk starts near 240 seconds. Ten stalled playlist calls stop at the 40 second chunk deadline (8 calls, the rest skipped, all `estimated`). An empty uploads page is `estimate`, not a recent mean of 0. A mean of 0 or a mean above lifetime total views is stored as `estimated`. Real calls are what the unit total counts, and the total does not pass 8,000. A quota error stops cleanly. A thrown message containing `key=TESTKEY` is redacted in the log, the report, and `last_error`. The route returns 200 for a time stop and 401 without the bearer token.

Full `npx vitest run`: 276 files, 2474 passed, 40 skipped. `npx tsc --noEmit` clean. `npx next build` compiled and generated 136 pages.

No page or component was edited. Screenshots are not applicable.

### Known gaps

- Refresh (`lib/youtube-library/refresh.ts`, `GET /api/cron/youtube-library-refresh`, 18:00 UTC) still walks channels one at a time inside a 1,000 unit budget, about 450 channels. It can time out the same way. A separate job, P2, should give it the same deadline and batch. This job did not change `refresh.ts`. Calls that refresh makes through `createLibraryYoutubeApi` are now bounded at 20 seconds, because that factory is shared. A stats timeout there still falls through to the existing estimate path. A `channels.list` timeout stops that refresh run with `stopped: "error"`.
- The 8,000 pull budget and the 1,000 refresh budget are per run, not per day. YouTube's free daily quota is 10,000 units. A manual pull plus the 17:00 cron plus the 18:00 refresh can pass it. This job does not add a daily quota tracker and does not raise either budget.
- No migration. Nothing was applied on `ldtmhafewfifdizgfrnn`. No live write, charge, or send. This PR does not merge. After merge and Chris's OK, Chris runs the two pulls from his own shell (the agent does not read `CRON_SECRET`): `time curl -s -o /tmp/pull1.json -w "%{http_code} %{time_total}\n" -H "Authorization: Bearer $CRON_SECRET" https://www.taylslate.com/api/cron/youtube-library-pull`, then the same for `/tmp/pull2.json`. Expect HTTP 200 and under 300 seconds on both, with `elapsedMs` at or under about 255000. Read-only counts before and after each run: `youtube_channels` count, `youtube_pull_queue` by status, channels updated in the last 10 minutes, and `avg_views_method` counts. Rows should grow or pending should shrink. Baseline on Oct 29 2026 before this fix: 403 channels, 100 queue rows (11 done, 89 pending), `avg_views_method` recent 403. Vercel runtime logs for those two runs should not contain "Task timed out".

## B1: bulk roster import API for reps

### What was built

`POST /api/reps/roster/import` previews a rep's show list or commits it. Preview is the default and writes nothing. Commit creates pending `agent_show_relationships` rows with `source` `import` and `is_exclusive` true unless the row opts out. The agent id is the session from `requireAgent`. New shows go through `supabaseAdmin` with the caller's `agent_id`, `is_discoverable` false unless `isShowsAdmin`, and no `is_exclusive` on the show. `is_claimed` and `ownership_status` are not set. An existing show is not updated. A name match is a suggestion until `confirm` is set. Hidden shows owned by another agent match only on feed, YouTube `UC` id, or `shows.apple_id`, and the result returns their id and name only. `podscan_id` is ignored. Nothing is approved.

`enforceRosterImport` runs after `requireAgent` and before the body is read. The limit is 10 requests per hour per session user id, closed on failure. A 429 (with `Retry-After`) or a 503 is returned as is, and the body is not read. A `Content-Length` above 1 MB is 413 before the body is read. The read counts bytes and returns 413 as soon as the running total passes 1 MB, so a missing or low `Content-Length` cannot buffer the rest. The 500-row cap stays.

No migration. The next free number is 075. Grants on `shows` and `agent_show_relationships` were read and are unchanged: anon and public have nothing, authenticated has `SELECT` only on `shows`. Nothing was written to `ldtmhafewfifdizgfrnn`.

Rebased onto main `08d9bc4`. The only rebase conflict was this file. Main's sections stay, and this section is last.

### Where

- `lib/reps/roster-import.ts`
- `lib/reps/roster-import.test.ts`
- `app/api/reps/roster/import/route.ts`
- `app/api/reps/roster/import/route.test.ts`
- `docs/jobs/B1.md`
- `docs/security/RATE_LIMITS.md` (the roster import row and the paragraph under the table)
- `docs/SENIOR_DEV_HANDOFF.md`

### Tests

`npx vitest run lib/reps/roster-import.test.ts app/api/reps/roster/import/route.test.ts`

Covers each match tier and class, both caps, idempotent commit, `podscan_id` ignored, no `is_claimed` write, no show update on `link_existing`, caller `agent_id` and non-discoverable insert, `exclusive_conflict`, 401, 403, preview with no writes, and commit on a mocked `supabaseAdmin` with no authenticated-client use. The route test mocks `@/lib/security/rate-limit` and checks that the limiter is called with the session agent id after auth and before the body is read, that 429 and 503 pass through with no read and no write, that an oversized `Content-Length` is 413 before the body is read, and that a body without `Content-Length` (and one whose `Content-Length` is lower than the real size) returns 413 once the running count passes 1 MB.

`npx vitest run`: 283 files, 2542 passed, 40 skipped. `npx tsc --noEmit` clean. `npx next build` compiled and generated 137 pages. No UI change. Screenshots are not applicable. No throwaway database. No live writes.

### Known gaps

- The docblock on `enforceRosterImport` in `lib/security/rate-limit.ts` still says `POST /api/reps/roster/import` is not on this branch. That file was not edited. The route does call it.
- Migration 073 must be applied live before this route can pass the limiter. Until `rate_limit_hit` exists, `enforceRosterImport` fails closed with 503.
- `exclusive_conflict` tells the importing rep that an approved exclusive link exists. It is a boolean and nothing more about the other link. That flag is the original B1 spec.
- A name lookup that hits 50 rows is treated as ambiguous. A feed or Apple lookup that hits 1,000 rows fails the request.
- An unconfirmed name match is not inserted as a new show.
- YouTube handles are not resolved. Multipart upload is not accepted.
- No domain event on the pending link.

## P2 YouTube library refresh: stop the 300 second timeout

### What was built

`GET /api/cron/youtube-library-refresh` still has `maxDuration` 300. That is the Hobby plan Fluid Compute cap. Do not raise it. The route now stops on a wall clock before that kill. A time stop is a normal HTTP 200. `stopped` is `"time"`, `"budget"`, `"quota"`, `"error"`, or null.

The refresh pass stops starting new work at 200 seconds (`YOUTUBE_LIBRARY_REFRESH_PASS_BUDGET_MS`). The 30-day sweep and niche tagging stop at 240 seconds (`YOUTUBE_LIBRARY_REFRESH_TIME_BUDGET_MS`), so they keep about 40 seconds after the pass. The unit budget stays 1,000. There is no new table or column. A channel this run does not save keeps its old `stats_refreshed_at`, so the next run starts at the oldest remaining rows. `oldestChannels(50)` is unchanged.

After `channels.list` (at most 50 ids), found channels are taken in chunks of 10. Existing rows are read once with `getChannels`. Show linking and saves run at a concurrency of 4. `saveChannel` receives the existing row, so it does not read the channel again. Uploads stats for a chunk go through `recentUploadsBatch` (imported from the pull client, not copied). The chunk deadline is the lesser of the time still left before the pass deadline and 40 seconds. The batch is also wrapped in `withTimeout` of at most 45 seconds. A batch that throws or times out stores `avg_views_method` `estimated` for that chunk. A fake API with no `recentUploadsBatch` still uses per-channel `recentUploads`, with a clock check before each call, and still charges 2 units per read.

Units are the calls that actually ran: 1 per `channels.list`, then `playlistCalls` + `videoListCalls` from the batch. Before a chunk, the worst case (`uploadsBatchWorstCaseUnits`) has to fit in the remaining 1,000, or the run stops with `stopped: "budget"`. Before a new group, 1 unit has to be left for `channels.list`. A quota error stops with `"quota"`. A 404 on `channels.list` still deletes that group's ids. Ids missing from `channels.list` are still deleted. Any other `channels.list` error, including a timeout, stops with `"error"`.

`draftToRecord` is unchanged. A recent mean of 0, or a mean above the channel's lifetime `total_view_count`, is stored as `estimated` (the catalog average). A positive mean that does not exceed the lifetime total is `recent`. The only values written are null, `recent`, and `estimated`.

The 30-day sweep runs only when the pass finishes with `stopped` null. A time, budget, quota, or error stop skips it and logs one line, because rows the run did not reach are not stale. When it does run, deletes go out as one `deleteChannels` call per 50 ids, and nulls run at a concurrency of 4. The clock is checked between those batches. The 30-day rule itself is unchanged: delete when there is no show, clear YouTube fields when there is a show.

`runNicheTagBatches` takes an optional `deadlineMs` and `clock`. It does not start a call when under 15 seconds remain. Each call is wrapped in `withTimeout` of the lesser of the time left and 40 seconds. A timeout is `stopped: "time"`. Those rows stay untagged and are retried next run. Saves in a batch run at a concurrency of 4. `TAG_DAILY_CAP` stays 400. The taxonomy, prompt, parsing, and version are unchanged.

The JSON report and the single `[youtube-library] refresh` log line include `elapsedMs` and `chunks`. Errors go through `redactSecretParams` or `queueErrorText` / `scrubYoutubeError`. The API key is not logged or returned. The bearer check is unchanged: a missing `CRON_SECRET`, or a missing or wrong bearer, is 401, and the refresh is not called.

### Where

- `app/api/cron/youtube-library-refresh/route.ts` and `route.test.ts`
- `lib/youtube-library/refresh.ts` and `refresh.test.ts`
- `lib/youtube-library/tags.ts` and `tags.test.ts` (deadline, clock, and the per-call timeout only)
- `docs/SENIOR_DEV_HANDOFF.md`

`lib/youtube-library/pull.ts`, `lib/enrichment/youtube.ts`, the pull route, `vercel.json`, discovery, scoring, the tag taxonomy, and the UI were not edited. No migration.

### Tests

`npx vitest run lib/youtube-library/refresh.test.ts lib/youtube-library/tags.test.ts app/api/cron/youtube-library-refresh/route.test.ts` (3 files, 26 passed).

The clock stops the loop with `stopped: "time"` before the next `channels.list` and leaves unreached rows on their old `stats_refreshed_at`. A second `runRefreshQueue` on the same memory store starts at those oldest rows and does not insert a duplicate channel. After a time stop or a budget stop the sweep does not run, and no unreached row is deleted or nulled. A finished pass still deletes a 404, deletes ids missing from `channels.list`, and deletes or nulls rows older than 30 days. A stalled stats batch is cut at `min(remaining, 40 seconds)` and those channels are `estimated`. A mean of 0 and a mean above `total_view_count` are stored as `estimated`. A good mean is `recent`. Show linking and saves never have more than 4 in flight, and each channel keeps the show id from its own lookup. `saveChannel` receives the existing row, and `getChannel` is not called per channel. Real batch calls are what the unit total counts, and the run stops at 1,000 with `stopped: "budget"`. `channels.list` is never given more than 50 ids, and a stats batch is never given more than 10 channels. A quota error stops cleanly. Tagging stops with `stopped: "time"` before an LLM call it cannot finish, and a stalled LLM call is cut and leaves rows untagged. A thrown message containing `key=TESTKEY` is redacted in the log and the report. The route returns 200 for a time stop, 401 without the bearer, and 401 when `CRON_SECRET` is missing. It calls nothing without auth.

Full `npx vitest run`: 281 files, 2521 passed, 40 skipped. `npx tsc --noEmit` clean. `npx next build` compiled and generated 136 pages.

No page or component was edited. Screenshots are not applicable.

### Known gaps

- The 1,000 refresh budget and the 8,000 pull budget are per run, not per day. YouTube's free daily quota is 10,000 units. A manual pull plus the 17:00 cron plus the 18:00 refresh can pass it. This job does not add a daily quota tracker and does not raise either budget.
- A stats chunk that starts with 40 seconds of pass time left can still run about 45 seconds, because the backstop is `min(45 seconds, chunk budget + 5 seconds)`. The pass deadline is 200 seconds so that overshoot still lands inside the 240 second route budget.
- No migration. Nothing was applied on `ldtmhafewfifdizgfrnn`. No live write, charge, or send. This PR does not merge. After merge and Chris's OK, Chris runs the two refreshes from his own shell (the agent does not read `CRON_SECRET`): `time curl -s -o /tmp/refresh1.json -w "%{http_code} %{time_total}\n" -H "Authorization: Bearer $CRON_SECRET" https://www.taylslate.com/api/cron/youtube-library-refresh`, then the same for `/tmp/refresh2.json`. Expect HTTP 200 and under 300 seconds both times, with `elapsedMs` at or under about 255000. Read-only SQL before and after each run: `select count(*) from youtube_channels`; `select count(*) from youtube_channels where stats_refreshed_at >= now() - interval '10 minutes'`; `select avg_views_method, count(*) from youtube_channels group by 1`; `select min(stats_refreshed_at) from youtube_channels`. The count must not drop after a time stop. The refreshed count must be above 0 on both runs. `min(stats_refreshed_at)` must move forward across the two runs. `avg_views_method` may only show null, recent, and estimated. Vercel runtime logs for those two runs should not contain "Task timed out".

## LG1

### What was built

Public draft Terms of Service (`/terms`) and Privacy Policy (`/privacy`). A signed-out visit no longer redirects to `/login`. The marketing footer Terms and Privacy links go to those pages. The approved L2 consent line is `CONSENT_LINE` in `app/terms/page.tsx`. Privacy imports that constant. The visible banner lives in `components/marketing/legal-document.tsx` so the terms page file can stay free of the word "draft", which `lib/learning/pooled-deal-priors.test.ts` rejects. Both pages show a draft banner and square-bracket placeholders. Both are `noindex` and out of the sitemap while `marketing` is false.

The sentences under "How the product applies that line" describe the pooled dataset, the import checkbox (off by default, terms version `pooling-v1`), and that an upload stays private unless the brand opted in. Those sentences are not the approved consent line.

### Where

- `app/terms/page.tsx`
- `app/privacy/page.tsx`
- `app/terms/page.test.tsx`
- `app/privacy/page.test.tsx`
- `components/marketing/legal-document.tsx`
- `components/marketing/marketing-chrome.tsx` (the two footer hrefs only)
- `proxy.ts` (`/terms` and `/privacy` exact matches)
- `proxy.test.ts`
- `lib/marketing/site.ts`
- `lib/marketing/site.test.ts`
- `docs/jobs/LG1.md`
- `PRODUCT_BACKLOG.md` (item j)
- `docs/SENIOR_DEV_HANDOFF.md`

### Tests

Page tests assert the exact consent string, the draft banner, the placeholders, the footer hrefs, and no em dash in the rendered text. The terms test also asserts no percentage figure. The proxy test allows `/terms` and `/privacy` while signed out, still redirects `/dashboard`, and redirects `/terms/extra`. `lib/marketing/site.test.ts` expects the new paths with `marketing: false`, so they stay out of the sitemap. `lib/learning/pooled-deal-priors.test.ts` still requires the consent sentence inside `app/terms/page.tsx` and rejects the word "draft" in that file.

`npx vitest run`: 283 files, 2512 passed, 40 skipped. `npx tsc --noEmit` clean. `npx next build` compiled and generated 137 pages.

No migration. `lib/stripe`, `lib/payouts`, `lib/billing`, and `lib/airchecks` were not edited.

### Known gaps

- Every legal conclusion that is not already in the repo is marked [CONFIRM WITH COUNSEL]. The list is in `docs/jobs/LG1.md`.
- Placeholders for the legal entity, address, governing law, venue, effective date, and contact emails are still empty. `ops@taylslate.com` was not used.
- Fee percentages and plan prices are not on the page. The payments section says to see the pricing shown in the account, with [CONFIRM CURRENT PRICING].
- The draft banner stays until Chris removes `LEGAL_DRAFT_BANNER` and sets `marketing: true` if these pages should be indexed.
- No signup checkbox and no new consent capture. Login and signup behavior are unchanged apart from the shared footer hrefs.
- This PR does not merge. A lawyer should review the draft before launch.

## N1: Roster link notifications

### What was built

After a roster import commit that creates at least one pending link, Taylslate sends one admin email. It names the rep (company, else full name, else "A Taylslate sales agent"), the count, how many rows are new shows, and how many link to shows already in the catalog. It names at most five shows. The button goes to `https://www.taylslate.com/admin/roster-requests`. Preview sends nothing. A retry sends nothing, because those rows are not `committed`. A daily digest was considered and skipped: it would need a cron, a state table, and it can repeat. This job adds no cron.

The same commit emails each verified owner of a show that already existed (`link_existing` or `exclusive_conflict`, not `new_show`). A verified owner is `shows.ownership_status = verified` and a `show_ownership_proofs` row for that show with `status = verified`. The address is `profiles.email` on `user_id`. This is the proof branch of `getVerifiedProfileTies` only. Deal ties and show-owner contact-email ties from that helper are not mailed. An unclaimed show gets no email and no proof lookup. The rep is skipped when `user_id` is the rep. One owner with several shows gets one email. The cap is 50 owner emails per commit; the overflow count is logged with no address. The mail says the rep listed the show, Taylslate is reviewing it, and nothing is live yet. "This is not right" goes to `https://www.taylslate.com/shows/roster-links/<link id>`. It does not include another rep, a rep email, commission, exclusivity, any other show, or an admin note. There is no second email on approval.

`/admin/roster-requests` shows "N pending" from the rows already loaded, and a "Disputed by owner" badge when that link has an open dispute. In N1 the badge was not a block. Q12 blocks approve while that dispute is open. See Q12.

After approve or reject flips a pending link, the rep gets one email. Approve has no note. Reject includes the stored trimmed note, HTML escaped, at most 500 characters. `recipientProfileId` is the rep. A second call is 409 and sends nothing. If the rep has no email, the send is skipped and the log has no address. A rejected link is still `already_on_roster` on re-import, with `committed` false and no insert. The existing test around the pending, approved, and rejected cases already asserts both. It was not duplicated.

`POST /api/roster-links/[id]/dispute` is signed in. The limit is 10 per hour per user, closed on failure. An optional note is trimmed and must be 1 to 500 characters when set. The caller must be a verified owner of that link's show, same check as the owner email. A missing link and a non-owner both return 404 `{ error: "Not found" }`. A rejected link returns 200 `{ ok: true, result: "already declined" }` and writes nothing. The first insert returns 200 `{ ok: true, result: "flagged" }` and emails the admin (show name, rep company or name, owner email, note, review link). A unique violation returns 200 `{ ok: true, result: "already flagged" }` when the row is still open, and sends nothing. The link status does not change. N1 left rows `open`. Q12 adds resolve. See Q12.

`/shows/roster-links/[id]` is the page the owner email links to. Signed out and anyone who is not a verified owner get `notFound()`. The page shows the show name, the rep's company or name, a short explanation, and "Flag this to Taylslate" with an optional note. A rejected link shows "This link was already declined." and hides the form.

Import `parseRecord` rejects a name over 300 characters, an `rss_url` over 2000, and a contact email over 320, and an `rss_url` that does not parse as http or https. `POST /api/reps/roster/import` exports `maxDuration = 60`. The stale docblock on `enforceRosterImport` now says the route exists and calls it.

Every send runs after the database write succeeded. A send that returns not ok, or that throws, is logged as a name, a code, or a reason. The log does not include an address, a note, a token, or a row. The import, approve, reject, and dispute responses do not change. Mail uses the default sender, `notifications@taylslate.com`. `auth@taylslate.com` is sign-in only. No new env var. The admin address is `INTERNAL_ALERT_EMAIL`, or `chris@taylslate.com`.

At most once is the design. The call that wins the write sends. A crash between the write and the send loses that email. There is no sent-mail log and no retry queue.

### Where

- `lib/reps/roster-notify.ts` and `lib/reps/roster-notify.test.ts`
- `lib/email/templates/roster-links.ts` and `lib/email/templates/roster-links.test.ts`
- `lib/email/preview.ts` and `lib/email/preview.test.ts` (four templates)
- `docs/EMAILS.md`
- `lib/reps/roster-import.ts` and `lib/reps/roster-import.test.ts` (caps and scheme only)
- `app/api/reps/roster/import/route.ts` and `route.test.ts`
- `app/api/admin/roster-links/[id]/route.ts` and `route.test.ts`
- `lib/reps/roster-review.ts` and `lib/reps/roster-review.test.ts`
- `app/(dashboard)/admin/roster-requests/page.tsx` is unchanged. `roster-requests-client.tsx` and `roster-requests.test.tsx` gained the count and the badge
- `app/api/roster-links/[id]/dispute/route.ts` and `route.test.ts`
- `app/(dashboard)/shows/roster-links/[id]/page.tsx`, `owner-roster-link-client.tsx`, and `page.test.tsx`
- `lib/security/rate-limit.ts` and `lib/security/rate-limit.test.ts`
- `supabase/migrations/075_roster_link_disputes.sql` and `075_roster_link_disputes.test.ts`
- `docs/SENIOR_DEV_HANDOFF.md`

`lib/stripe`, `lib/payouts`, `lib/billing`, `lib/airchecks`, and `lib/billing/plans.ts` were not edited. No Vercel env change. No live write, charge, or send.

### Tests

`npx vitest run`: 288 files, 2601 passed, 40 skipped. `npx tsc --noEmit` clean. `npx next build` compiled and generated 137 pages.

Covers a commit of three pending links sending one admin email, a retry and a zero-commit sending none, five names and not a sixth, send failure and a thrown send leaving the HTTP body alone and logging no address or note, one rep email on approve and none on the 409, the stored note HTML escaped, a 501-character reject note before any send, `recipientProfileId` on the rep mail, owner mail only for a verified proof, not an unclaimed show, a pending proof, a contact email, or the rep who is also the owner, two shows for one owner in one email, no other rep, rep email, commission, or exclusivity in that mail, a cap of 50, dispute 401, identical 404 bodies, 429, one insert and one admin email, already flagged with no second email, already declined with no insert, the migration grants (authenticated cannot select), RLS, the unique key, and the note check, name 301, rss 2001, email 321, `ftp://` and `javascript:` feeds, and `maxDuration` on the import route. The sender is mocked. Nothing was applied on `ldtmhafewfifdizgfrnn`.

Screenshots of `/admin/roster-requests` before and after, and of the new owner page, are the real components with the production CSS. The routes require a signed-in session. This run did not sign in and did not write a session.

### Known gaps

- Migration 075 is live on `ldtmhafewfifdizgfrnn`. Q12 does not edit it.
- Q12 closed the open-dispute gap. Approve reads the dispute and a trigger blocks the status change. An internal admin can resolve it. See Q12.
- Q12 closed the later-verification gap for a pending or approved link. The daily sweep and `notifyRepsOfOwnerVerification` send one heads-up. O2 and O4 should call that helper when they write a verified proof. They are still unmerged, so live data still has a verified owner only by an admin SQL insert.
- Unclaimed shows get no email, including no mail to `contact_email`. That is intentional.
- At most once. A crash after the write and before the send drops that email. A digest was skipped on purpose.
- `docs/security/RATE_LIMITS.md` lists the dispute bucket: 10 per hour per user id, closed on failure.
- The owner page is under the dashboard layout. A profile with no role, or a show profile that has not finished onboarding, is redirected by that layout before this page renders.

### Choices to confirm

- (a) Owner email goes out on creation, while the link is pending, and not again on approval.
- (b) The rep shown to the owner is company name, else full name, else "A Taylslate sales agent". No rep email.
- (c) The admin alert goes to `INTERNAL_ALERT_EMAIL` (fallback `chris@taylslate.com`) from `notifications@taylslate.com`, not `auth@`.
- (d) N1 did not block approve. Q12 changed that. An open dispute blocks approve until an admin resolves it.
- (e) Owner recipients are verified proofs only (`ownership_status` verified plus a verified proof, `user_id`). Not deal ties or contact-email ties from `getVerifiedProfileTies`.
- (f) Cap of 50 owner emails per commit.
- (g) A daily digest was skipped.
- (h) N1 left the later owner notice unbuilt. Q12 sends one heads-up for a verified proof. A pending claim still sends nothing.

## DOC1: Multi-channel creator profiles and the restyle pass (Nov 1, 2026)

### What was built

Docs only. Recorded two launch-build additions Chris approved on Nov 1, 2026. No code, migrations, styles, or plan changes.

**Multi-channel creator profiles (approved Nov 1, 2026, launch foundation)** sits under Foundational Architecture in `PRODUCT_BACKLOG.md`. "Show" generalizes to "creator". One creator profile holds any number of channels: podcast, YouTube, newsletter, Rumble, Twitch, Kick, Instagram, TikTok, own site. Each channel carries its own audience numbers and its own ad formats. Content labels sit on the creator and the channel, so each brand sets its own brand-safety line (Taylslate labels, the brand decides). Launch scope is the foundation only: data model, profile, display, discovery reading channels. Platform connectors follow after launch, one at a time, newsletters first.

This entry supersedes and absorbs "Multi-medium creator inventory abstraction" and "Creator-attached sellable surfaces". Both are marked "Folded into Multi-channel creator profiles (Nov 1, 2026)". Their original text is kept for reference.

**Restyle and design polish pass (approved Nov 1, 2026, last on the build list)** is the last item under Polish. Ink & Gold palette (navy #1B2A4A, ink #141C2B, canvas #F6F5F2, gold #8C6E1F), HubSpot-style layout (crisp white cards, strong contrast, Fraunces headings), via theme tokens. It runs after all feature lanes finish. One surface per job. No new features in a restyle job.

### Where

- `PRODUCT_BACKLOG.md`
- `docs/SENIOR_DEV_HANDOFF.md`

### Tests

No application code changed. `git diff --stat` is these two docs only.

`npx vitest run`: 290 files, 2613 passed, 40 skipped. `npx tsc --noEmit` clean. `npx next build` compiled and generated 138 pages.

Screenshots are not applicable. No page or component was touched.

### Known gaps

- No schema, column names, or connector details were added. Those were not in the approved note.
- The two folded entries keep their original text. They are not deleted.
- The restyle pass is last on the build list. It is not started here.
- This PR does not merge. Paul reviews.

## YT2 YouTube library contact emails, daily quota, and queue refill (Nov 2, 2026)

### What was built

Three additions to the YouTube channel library. No screen, style, or animation was edited. `lib/stripe`, `lib/payouts`, `lib/billing`, and `lib/airchecks` were not edited.

**Contact emails.** For each channel, addresses are taken from the stored channel description, from About links inside that text, and from recent upload descriptions. About links mean `mailto:` URLs, an email in a URL query string, and the `q` target of a `youtube.com/redirect` link. Those URLs are parsed. They are not fetched. There is no YouTube HTML scrape and no captcha path. Recent upload text comes from `playlistItems.list` plus `videos.list` with `part=snippet` (2 units). Rows go to `youtube_channel_emails` with `source` (`channel_description`, `about_link`, or `video_description`) and `found_at`. A repeat of the same channel, address, and source keeps the original `found_at`. Junk addresses (`noreply@youtube.com`, `example.com`, and similar) are dropped.

The description pass reads `youtube_channels.description` and spends 0 units. `emails_checked_at` marks a channel done. The video pass sets `video_emails_checked_at`. A video read that fails three times is marked checked so one dead channel cannot block the rest. The live library is about 3,102 channels. The description pass covers that set on the first email cron after migration 076 is applied. The video pass continues across Pacific days inside the cap.

**Daily quota.** `youtube_quota_days` stores units for one Pacific calendar day (`America/Los_Angeles`, the YouTube Data API reset). `youtube_quota_commit` adds units up to the cap and writes `youtube_quota_log`. The cap is `YOUTUBE_DAILY_QUOTA_CAP`. Unset or invalid uses 8,000, which is 80% of the default 10,000 unit day. The pull stops before a call that would pass its spend cap. It leaves 1,000 units for the refresh cron. While any channel still needs a video-description scan, it also leaves 2,000 units for the email cron. The email cron may spend up to 2,000 units above the total it sees at start, and never past the hard cap. Each job logs one `[youtube-library] quota day=... job=... total=... cap=...` line. The API key is not logged. Email addresses are not logged. A stop for this cap is `stopped: "cap"`. A YouTube `quotaExceeded` response is still `stopped: "quota"`.

**Queue refill.** When `youtube_pull_queue` has no pending rows, the pull inserts the next searches before it spends units. A finished search with `next_page_token` gets a follow-up row. A finished first page (`page_token` empty) also gets `order:date` and `order:viewCount`. Phrases come from keywords, niche tags, and topic labels on channels that passed the market filter, have no brand flag, and have `avg_recent_views` above 0. At most 10 page rows and 20 phrases per refill. Dedupe is `(kind, value, page_token)`, case-insensitive on the phrase. Real YouTube page tokens are stored as `page:...` so they are not read as an order variant.

Until migration 076 is applied, `yt2Ready()` is false. The pull and refresh keep the previous budgets, do not write page tokens, and do not open the ledger. The email cron returns `missing_yt2`.

Cron: `GET /api/cron/youtube-library-emails` at 19:00 UTC. Bearer `CRON_SECRET`, same as the other library crons. `maxDuration` stays 300. `vercel.json` regions stay `pdx1`.

### Where

- `supabase/migrations/076_youtube_library_yt2.sql`
- `supabase/migrations/076_youtube_library_yt2.test.ts`
- `lib/youtube-library/emails.ts` and `emails.test.ts`
- `lib/youtube-library/emails-backfill.ts` and `emails-backfill.test.ts`
- `lib/youtube-library/quota.ts` and `quota.test.ts`
- `lib/youtube-library/refill.ts` and `refill.test.ts`
- `lib/youtube-library/page-token.ts`
- `lib/youtube-library/store.ts` (queue page fields, email rows, quota ledger; channel upsert columns unchanged)
- `lib/youtube-library/pull.ts` and `pull.test.ts` (daily cap, refill when the pending queue is empty, next page token)
- `lib/youtube-library/refresh.ts` (same ledger)
- `lib/enrichment/youtube.ts` and `youtube.test.ts` (`searchLibraryPage`, `listRecentVideoDescriptions`)
- `app/api/cron/youtube-library-emails/route.ts` and `route.test.ts`
- `vercel.json` (one cron entry)
- `app/api/cron/pooled-priors/route.test.ts` (cron list)
- `STATUS.md`, `PRODUCT_BACKLOG.md`, `docs/SENIOR_DEV_HANDOFF.md`

### Tests

`npx vitest run`: 296 files, 2639 passed, 40 skipped. `npx tsc --noEmit` clean.

PGlite runs 074 then 076 twice. RLS on for the three new tables. `anon` and `authenticated` cannot read them or execute `youtube_quota_commit`. `service_role` can. The quota function accepts 100 then 50 against a cap of 150 and writes two log rows. A second email of the same source is rejected. A different source is allowed. Deleting the channel deletes the emails. The queue unique key is `(kind, value, page_token)`.

Unit: description, mailto, redirect, and obfuscated addresses; junk dropped; video descriptions stay `video_description`; Pacific midnight in November (PST) and July (PDT); cap default 8000; commit stops at the cap and the next day starts at 0; pull spend cap 5000 while video scans remain and 7000 after; refill pages and keywords, and a second call while those rows are pending adds nothing; email backfill stores `found_at` and does not log the address; a cap stop does not call YouTube, and the next Pacific day reads the video description; pull stops with `stopped: "cap"` and the pending query runs the next day.

No page or component was edited. Screenshots are not applicable.

### Known gaps

- Migration 076 is in the repo and is not applied. Apply it on `ldtmhafewfifdizgfrnn` only after merge and Chris's OK, naming 076, in the same release as this deploy. 076 drops `youtube_pull_queue_kind_value_uidx`. The previous pull upserts on `(kind, value)` and fails once that index is gone. Do not apply 076 while that deploy is still serving. Until 076 is applied, both existing crons behave as they do today, and the email cron no-ops with `missing_yt2`.
- A refresh stats read that stops for time, quota, or an error keeps the stored `avg_recent_views`, `avg_views_method`, and `stats_refreshed_at`. Other channel fields from `channels.list` still update. The 30-day sweep runs whenever the sweep clock has room, including after a budget, cap, or quota stop. Rows this run failed to remeasure are left for the next run. Rows it did not reach that are older than 30 days are still deleted or nulled.
- Refill keywords rotate through the top 200 high-scoring channels, 40 at a time. Queue reads page past 1,000 rows.
- The description pass covers the stored 3,102 channels without API units once 076 is applied. Video descriptions are 2 units each, about 6,204 units, spread across days. The email job takes at most 2,000 units on a day. A time stop at 240 seconds can scan fewer than that.
- Discovery's live video search is not on this ledger. A campaign that still calls `search.list` can spend units outside the 8,000 library cap.
- A stored YouTube page token can expire before the next pull. That queue row then fails like any other search error and stops after 3 attempts. Order variants do not depend on a page token.
- `custom_url` is still not a column. This change does not add it.
- No live write, charge, or send. This PR does not merge. After 076 is applied, the read-only checks are `youtube_channel_emails` count by source, `youtube_quota_days` for the Pacific day, and `youtube_pull_queue` pending count after a pull that emptied the previous queue. Do not print API keys or the addresses in those checks; count rows instead.

### Env

`YOUTUBE_DAILY_QUOTA_CAP` is optional. Unset uses 8000. This PR does not change Vercel env vars.

### Choices to confirm

- (a) Default cap is 8,000 units, not the full 10,000.
- (b) The pull leaves 1,000 for refresh and 2,000 for video-email backfill while scans remain.
- (c) High-scoring channels for refill are market-filter passes with no brand flag and `avg_recent_views` above 0.
- (d) About links are parsed from API text. The YouTube website is not fetched.
- (e) Paul Jones reviews. This PR does not merge.

## SEC1: profiles.email is not an authorization source

### What was built

`profiles.email` is updated by the signed-in user. Several checks treated that column as the login. A user who stored another person's address could pass them. A known user id is read with `getUserById`. An email is resolved with `public.auth_user_ids_for_email`, which is `service_role` only. Session checks use `supabase.auth.getUser().email`.

`isShowsAdmin` no longer treats `profiles.role = admin` as a grant. That value is not in `profiles_role_check`. Admin is `INTERNAL_ADMIN_EMAILS` on the auth email only.

Migration 077 copies `auth.users.email` onto `profiles.email` on profile insert and update, and again when `auth.users.email` changes. The trigger overwrite is the protection. A column `REVOKE UPDATE (email)` does nothing while `authenticated` still has table `UPDATE`, so 077 does not revoke the column and does not replace that table grant. The trigger function has no `EXECUTE` grant. 077 must ship with the deploy. It is not applied yet. Until it is applied, live `user_owns_show`, the outreach read policy, the shows participant policy, and the podscan guard still trust `profiles.email`.

071 is already applied on `ldtmhafewfifdizgfrnn`. This PR also edits that file. Those edits only affect a fresh database that runs 071 again. Live policies change when 077 is applied.

No screen, style, or animation change. `lib/stripe`, `lib/payouts`, `lib/billing`, and `lib/airchecks` were not edited. No Vercel env change.

### Audit

| Place | Result |
| --- | --- |
| `lib/shows/can-edit-show.ts` `isShowsAdmin` / `canEditShow` | Fixed. Auth email. Role admin branch removed. |
| `lib/data/queries.ts` `importShows` | Fixed. `user.email` from `getUser()`. |
| `lib/data/queries.ts` `backfillShowProfileOnAcceptedDeals` | Fixed. Auth email. Profile-email shareholder scan removed. |
| `lib/shows/apply-geography.ts` show-owner ties and geography writes | Fixed. Auth email. |
| `app/api/auth/login/otp/route.ts` and `verify/route.ts` | Fixed. Account exists when `auth.users` has the address. Profile is loaded by that user id. |
| `app/api/auth/magic/route.ts` | Fixed. Same directory. A profile row does not skip creating the auth user. |
| `app/outreach/[token]/page.tsx`, `app/api/outreach/[token]/_shared.ts`, `accept-counter/route.ts` | Fixed. Show party is `profileByLoginEmail`. |
| `app/api/deals/[id]/send-to-docusign/route.ts` show signer | Fixed. Auth email, then the outreach address if the directory read fails. |
| `lib/accounts/handoff.ts` | Before the login moves, the audit records the auth login. If the login already moved, the audit records the address still stored on the profile. The taken check reads both. Not an access grant. |
| `app/(dashboard)/admin/page.tsx` | Already session email. Does not call `isShowsAdmin`. |
| Admin API routes, `lib/admin/view-guard.ts`, `lib/learning/load.ts`, `getEffectiveRole` | Already `getUser().email` or `getUserById`. |
| `profiles.role` on brand, agent, and show gates | Left. Migration 072 locks role (applied 2026-10-26). `is_managed` is locked by 041. |
| `full_name`, `company_name` | Display and labels only. Not access. |
| `lib/email/send.ts` managed lookup by email | Left. `is_managed` is trigger-locked, so a copied address does not flip the flag. |
| `lib/alerts/conversion.ts`, roster owner mail, IO contact fields, layout display name | Left. Delivery or document text, not access. |
| `lib/stripe/customer.ts`, `app/api/stripe/*`, `app/api/deals/[id]/setup-intent`, DocuSign webhook SetupIntent | Not changed. `profiles.email` is the Stripe customer contact. Not an access check. Listed here instead of editing `lib/stripe`. After 077 the column matches the login. |
| `lib/payouts`, `lib/billing`, `lib/airchecks` | No `profiles.email` access check found. Not edited. |
| RLS `user_owns_show` (050), outreach policy (011), shows policy (071), podscan guard (046) | Fixed in 077, which must ship with the deploy. 071 is already applied. The 071 file edit only affects a fresh database. |

### Where

- `lib/auth/auth-email.ts` and `auth-email.test.ts`
- `lib/shows/can-edit-show.ts` and its test
- `lib/shows/apply-geography.ts` and its test
- `lib/data/queries.ts`, `lib/data/backfill-login.test.ts`, `lib/data/roster-links.test.ts`
- `lib/accounts/handoff.ts`
- login OTP routes and tests, magic route and test, rate-limit test mock
- outreach pitch page, `_shared.ts`, accept-counter route and test
- `app/api/deals/[id]/send-to-docusign/route.ts` and its test
- `app/api/v1/reads.route.test.ts`
- `supabase/migrations/071_shows_select_policy.sql` and its test
- `supabase/migrations/077_lock_profile_email.sql` and its test
- `STATUS.md`, `PRODUCT_BACKLOG.md`, `docs/SENIOR_DEV_HANDOFF.md`

### Tests

Regression: `profiles.email` set to the victim while the session or auth login differs is denied for show edit, roster discoverability, geography ties, deal backfill, login verify, magic account lookup, the API show row, and the DocuSign show signer. PGlite covers the email trigger, `user_owns_show`, outreach select, shows select, and the podscan guard.

### Known gaps

- Migration 077 is applied. Migration 078 is written and not applied. It stops a null `auth.users.email` from raising 42501 through the profile sync. Apply 078 on `ldtmhafewfifdizgfrnn` only after merge and Chris's OK.
- 071 is already applied. This PR edits that file. Re-running the edited 071 only changes a fresh database. Live rows change when 077 replaces those policies.
- Stripe customer creation still passes `profiles.email` until 077 is applied. After that the column matches the login, including when the auth email changes.
- A directory error fails closed (no tie, login returns 500).

### Choices to confirm

- (a) Paul Jones reviews. This PR does not merge.
- (b) 077 is not applied from this run.
- (c) Show signer falls back to the outreach address only when the auth read fails, not to `profiles.email`.

## SEC1 follow-up: null auth email and handoff audit

### What was built

Migration 078 replaces `private.sync_profile_email_from_auth_user`. A null or blank `auth.users.email` returns without updating `profiles` and without raising 42501. A real address is still copied. 078 is not applied.

Handoff writes the previous login to `domain_events` before `updateUserById`. A retry, after the auth trigger has already copied the new address onto `profiles.email`, reads that row for `old_email`.

`anon` and `authenticated` cannot execute `auth_user_ids_for_email`. That grant was already revoked in 077. The test now asserts it.

### Where

- `supabase/migrations/078_auth_email_null_guard.sql` and its test
- `lib/accounts/handoff.ts` and `app/api/admin/managed-brands/[id]/handoff/route.test.ts`
- `supabase/migrations/077_lock_profile_email.test.ts` (execute privilege assertion)
- `STATUS.md`, `PRODUCT_BACKLOG.md`, `docs/SENIOR_DEV_HANDOFF.md`

### Known gaps

- 078 is not applied. Until it is, clearing `auth.users.email` can still roll back through the 077 profile trigger.

## M1: MCP tool layer over the public API v1

### What was built

`POST /api/v1/mcp` is a stateless MCP server over the existing public API. One JSON-RPC 2.0 message per POST. The response is JSON, or `202` with an empty body for a notification. No SSE, no session, no server-initiated request. No new business action. No migration. No screen, style, or animation change. `lib/stripe`, `lib/payouts`, `lib/billing`, `lib/airchecks`, `proxy.ts`, and the existing `/api/v1` routes were not edited.

The server speaks `2026-07-28`, `2025-11-25`, and `2025-06-18`. The current version uses `server/discover`. The 2025 versions use `initialize`. All three support `ping`, `tools/list`, and `tools/call`. Capabilities advertise tools only. `serverInfo.name` is `taylslate`.

Request order matches `withApiRead`: Origin, then `resolveApiRequest`, then `enforceApiRateLimit`, then the 64 KB body cap and JSON content type, then dispatch. A foreign Origin is `403`. Auth failures are `401` with `WWW-Authenticate: Bearer` and the existing `ApiAuthError` message, including a revoked key and a key whose `brand_id` is not a `profiles` row. The limit is 60 POSTs per key per UTC minute, with `Retry-After`. `GET`, `PUT`, `PATCH`, and `DELETE` are `405` with `Allow: POST`.

`tools/list` returns only the tools the key's scopes allow. A `tools/call` the key cannot use is a tool error, `API key lacks the required scope.`, and does not read or write the row. Read tools call `listShows`, `getShow`, `listCampaigns`, `getCampaign`, `listScores`, `getPlan`, `listDeals`, `getDeal`, `listWriteActions`, and `getWriteAction`. Show results use the same `fullShowIdsForCaller` projection as `GET /api/v1/shows`, so contact and rates stay off an untied show. `propose_campaign` calls `recordCampaignCreate`. `propose_outreach` calls `recordOutreachDraft`. Both only insert one pending `api_write_actions` row. A replay of the same idempotency key and payload returns that `action_id` with `replayed: true`. A changed payload is `isError` with status `409`. Nothing is sent, created, signed, or charged.

`callTool(ctx, name, args)` is the in-process entry. `ctx` is `{ brandId, keyId, scopes }`. The HTTP request does not reach a handler. The route uses `callTool` too. Arguments cannot carry a brand id, user id, or key id.

Each request logs one line: method, tool name, outcome code, elapsed ms. Arguments, outreach text, and the Authorization value are not logged. `resolveApiRequest` still writes the single `api_call` row. This job does not add a second metering write.

### Where

- `app/api/v1/mcp/route.ts` and `route.test.ts`
- `lib/mcp/protocol.ts` and `protocol.test.ts`
- `lib/mcp/tools.ts` and `tools.test.ts`
- `lib/mcp/args.ts` and `args.test.ts`
- `docs/api/MCP.md`
- `docs/jobs/M1.md`
- `docs/SENIOR_DEV_HANDOFF.md` (this section)

### Tests

`npx vitest run lib/mcp app/api/v1/mcp`: 4 files, 22 passed. Covers 401 (missing, bad format, revoked, untied), 403 foreign Origin, 429 with Retry-After, 413, 415, 405 on GET/PUT/PATCH/DELETE, batch 400, notification 202, unsupported version 400, initialize and tools/list per version, tools/list filtered by scope, tool scope error, cross-brand id not found, limit clamp at 100, propose replay and conflict, the only domain write is one `api_write_actions` insert, and no Authorization value or argument text in console output. A test asserts each tool's output keys equal the matching v1 serializer allowlist and that no output key matches stripe, payment, payout, fee, card, setup_intent, or envelope.

`npx tsc --noEmit` clean. `npx vitest run`: 319 files, 2774 passed, 40 skipped. `npx next build` compiled and generated 140 pages. `/api/v1/mcp` is dynamic. No page or component was edited. Screenshots are not applicable.

### Known gaps

- CA1 records a command-agent action with `api_key_id` null, `source` `command_agent`, and `requested_by` equal to the brand id. `callTool` accepts that actor. The insert needs migration 083, which is applied (Nov 11, 2026 UTC). An API key caller is unchanged.
- No OAuth, dynamic client registration, or protected-resource metadata.
- No tool approves, sends, signs, charges, or pays.
- `tools/list` is one page. A non-empty cursor is invalid params.
- `lib/data/event-log.ts` still has the MCP TODO. That file is outside this job. The `api_call` row is the existing `resolveApiRequest` write.
- No Vercel env change. No migration to apply.

### Choices to confirm

- (a) Paul reviews. This PR does not merge.
- (b) Protocol versions are `2026-07-28`, `2025-11-25`, and `2025-06-18`. JSON only. No session.
- (c) `propose_campaign` and `propose_outreach` stay pending until a later job approves them.

## Q12: Roster dispute block and rep owner heads-up

### What was built

An open owner dispute blocks approve. `assertNoOpenDispute` runs after the admin check. A read error fails closed. Migration 081 adds `resolution_note`, a resolved-state check, and a BEFORE UPDATE OF status trigger on `agent_show_relationships` that raises P0001 `roster link has an open dispute`. The trigger does not fire on reject or on other columns. `approveRosterLink` maps that error and does not publish. 081 also adds `roster_owner_verified_notices` (unique link and proof, RLS on, no policy, service_role only). 081 is not applied. 075 is live and was not edited.

Resolve is `POST /api/admin/roster-links/[id]` with `{ action: "resolve_dispute", note }`. The note is 1 to 500 characters. `resolved_by` is the session user. A non-admin is 403. A repeat or a link with no open dispute is 409. A missing `resolution_note` column is 503. Resolve does not change the link and sends no email.

The dispute route writes `roster_link.dispute_opened` on the first insert. A 23505 on an open row stays "already flagged". A 23505 on a resolved row is "already reviewed" with no email. Approve blocked, resolve, and the rep heads-up write `roster_link.approve_blocked`, `roster_link.dispute_resolved`, and `roster_link.owner_heads_up`. Payloads are ids, counts, and lengths.

The admin list disables Approve on a disputed row, shows the blocked line, and opens a resolve dialog. Success clears the pill locally and leaves the row pending. Reject stays available.

The rep heads-up goes out once per link and verified proof. Import commit sends the import variant for `link_existing` and `exclusive_conflict` after the owner notice. The 7-day sweep sends the verified-later variant. `GET /api/cron/roster-owner-notices` runs daily at 21:00 UTC. `POST /api/admin/roster-links/owner-notices` is the admin trigger. `send_failed` deletes the claim. `no_api_key` and `managed_inbox_unset` are not retried. The owner-as-rep is skipped. A missing notices table sends nothing.

O2 and O4 should call `notifyRepsOfOwnerVerification` after they write a verified proof. They were not edited.

### Where

- `supabase/migrations/081_roster_dispute_block.sql` and `081_roster_dispute_block.test.ts`
- `lib/reps/roster-disputes.ts` and `roster-disputes.test.ts`
- `lib/reps/store.ts` (`approveRosterLink` only) and `lib/reps/store.test.ts`
- `lib/reps/roster-notify.ts` and `roster-notify.test.ts`
- `lib/email/templates/roster-links.ts` and `roster-links.test.ts`
- `lib/email/preview.ts` and `preview.test.ts`
- `docs/email-previews/roster-rep-owner-heads-up-import.html` and `roster-rep-owner-heads-up-verified.html`
- `app/api/admin/roster-links/[id]/route.ts` and `route.test.ts`
- `app/api/admin/roster-links/owner-notices/route.ts` and `route.test.ts`
- `app/api/cron/roster-owner-notices/route.ts` and `route.test.ts`
- `app/api/roster-links/[id]/dispute/route.ts` and `route.test.ts`
- `app/(dashboard)/admin/roster-requests/roster-requests-client.tsx` and `roster-requests.test.tsx`
- `lib/data/types.ts` (event strings and `roster_link`)
- `vercel.json` (one cron entry, regions unchanged)
- `app/api/cron/pooled-priors/route.test.ts` (one expectation: that test freezes the full cron list, so the new 21:00 entry had to be added there or vitest fails. No route behavior changed.)
- `docs/EMAILS.md`, `docs/jobs/Q12.md`, `STATUS.md`, `PRODUCT_BACKLOG.md`, `docs/SENIOR_DEV_HANDOFF.md`

`lib/stripe`, `lib/payouts`, `lib/billing`, `lib/airchecks`, and `lib/billing/plans.ts` were not edited. No Vercel env change. No live write, charge, or send. 081 was not applied.

### Tests

`npx vitest run`: 334 files, 2903 passed, 40 skipped. `npx tsc --noEmit` clean. `npx next build` compiled and generated 142 pages.

Covers open, none, and read-error dispute checks; approve blocked with no update and no publish; trigger P0001 mapped to 409; route 401, 403, 409 disputed, 503, 400 note, resolve 200, 403, 409 repeat, 409 none, 503 without 081; `resolved_by` from the session; no link change and no email on resolve; dispute 23505 open and resolved; the opened event once; import heads-up for an owned link and an exclusive conflict; none for a new show, a retry, the owner-as-rep, or an unclaimed show; pending and approved links; rejected skipped; one send on a double call; `send_failed` retry; `no_api_key` and `managed_inbox_unset` kept; missing table sends nothing; the cap of 50; sweep window and rerun; cron 401; admin sweep 401 and 403; the blocked line, disabled Approve, resolve dialog, local re-enable, other rows unchanged, and no em dash; both template variants escaped with no owner data; preview registration; migration grants, RLS, the trigger, the unique key, and a rerun.

### Known gaps

- Migration 081 is not applied. Apply it on `ldtmhafewfifdizgfrnn` only after merge and Chris's OK, naming 081. Until then resolve returns 503 and the heads-up sends nothing.
- The same owner cannot flag again after a resolve. That is the 075 unique key. Withdraw is not built.
- A dispute on an already approved link does not demote the link.
- The admin page does not show the owner's dispute note.
- The legacy `/shows` CSV upload (`POST /api/shows/import`) still inserts a new show. No owner notice, dispute, or heads-up runs from that screen. Out of scope.
- O2 and O4 are unmerged. Until they call `notifyRepsOfOwnerVerification`, a later verification is picked up only by the 7-day sweep.
- Open questions 1 through 7 and 9 are defaults pending Chris. Question 8 is noted only. See `docs/jobs/Q12.md`.
- This PR does not merge. Paul reviews.

### Choices to confirm

- (a) Any `INTERNAL_ADMIN_EMAILS` user resolves. There is no teammate table.
- (b) The owner cannot withdraw, and cannot flag again after resolve.
- (c) An approved link is not demoted by a later dispute.
- (d) The dispute note stays off the admin page.
- (e) The heads-up is the import email plus the 7-day sweep. The copy says the owner was told only when that notice was sent. It does not mention a dispute. A claimed notice older than one hour is retried.
- (f) Preview setup is a throwaway project, not a Supabase branch.
- (g) Test Agent 1 is not added to "Log in as".

## A4: brand approvals inbox for agent actions (migration 082)

### What was built

A brand can open `/settings/agent-actions` and review the pending rows its API keys recorded through `/api/v1`. The screen has Pending, Approved, Rejected, and Expired tabs. Approve and Reject take an optional note and a confirm step. The actor is the session user id. Role is read from `profiles` by that id and must be `brand`. Another brand's action id is 404.

Approving `campaign.create` creates one draft campaign through `createCampaign`, the same insert the manual brief submit uses: status `draft`, platforms podcast and youtube, recommendations empty, brief version 2. The brief stores `source_action_id`. Before creating, execution looks up `campaigns` for this user with `brief->>source_action_id` equal to the action id and links that row when it exists. The campaign name follows `deriveCampaignName`, with ` - ` in place of the em dash that route uses. A reused pattern id is loaded with `getCampaignPatternById` and must have `customer_id` equal to the session user. A foreign or missing pattern leaves the row approved, stores a generic `execution_error`, and returns 502. Retry is allowed only for an approved `campaign.create` whose `result_campaign_id` and `executed_at` are both null. The claim and the error write use the same `executed_at` check.

Approving `outreach.draft` checks the show is still visible with `getShow` and then records the decision only. Nothing is sent. The row and the screen say "Approved. Nothing was sent." A missing show returns 409 and leaves the row pending. A show check that fails for another reason returns 500 and leaves the row pending.

A pending row older than 14 days is shown as expired. Deciding one returns 409 and sets status `expired`. The decision update matches `status = pending` and `created_at` inside 14 days, so two approvals produce one decision.

Migration 082 is in the PR and is not applied. Apply it on `ldtmhafewfifdizgfrnn` only after merge and Chris's OK.

### Where

- `supabase/migrations/082_api_write_action_decisions.sql` (not applied)
- `supabase/migrations/082_api_write_action_decisions.test.ts`
- `lib/api/approvals/list.ts` and `list.test.ts`
- `lib/api/approvals/decide.ts` and `decide.test.ts`
- `lib/api/approvals/execute.ts` and `execute.test.ts`
- `app/api/settings/agent-actions/route.ts` and `route.test.ts`
- `app/api/settings/agent-actions/[id]/route.ts` and `[id]/route.test.ts`
- `app/(dashboard)/settings/agent-actions/page.tsx`
- `app/(dashboard)/settings/agent-actions/agent-actions-client.tsx` and `agent-actions.test.tsx`
- `lib/data/types.ts` (the four `api_action.*` event types and the `api_action` entity type)
- `docs/jobs/A4.md`

### Tests

`npx vitest run supabase/migrations/082_api_write_action_decisions.test.ts lib/api/approvals app/api/settings/agent-actions "app/(dashboard)/settings/agent-actions"`

The PGlite suite applies the on-disk migrations through 082 (080 and 081 are absent), applies 082 again, and checks the new columns, checks, service_role-only grants, RLS, and zero policies. No live database write.

### Known gaps

- 082 is not applied. Do not approve live rows until Chris says so.
- Approving outreach does not send email and does not insert an outreach row. Sending needs a later job and Chris's OK.
- The page is reachable by URL. A5 adds the link from the API keys page. This job does not edit settings or nav.
- The draft campaign name uses ` - ` instead of the em dash in `deriveCampaignName`.
- There is no unique index on `campaigns`. A retry finds the draft by `brief.source_action_id` before it inserts. A deleted draft clears `result_campaign_id` and leaves `executed_at` set, so retry does not create another. If the brand manually re-submits that draft after a failed link, `source_action_id` is lost.

## A5: API key settings for brands

### What was built

A brand can create, list, and revoke its own API keys at `/settings/api-keys`. The plaintext secret is returned once from `POST /api/settings/api-keys` and is not stored, logged, or shown again. `/settings` has one new brand-only link card, placed directly after Brand profile. Show, agent, and agency do not see it. Nothing else on that page changed.

The brand id is the session user id. Role and plan are read from `profiles` by that id. A role other than `brand` is 403 on the routes and `notFound` on the page. No session is 401 on the routes and a redirect to `/login?next=/settings/api-keys` on the page.

Creating a key requires `PLANS[plan].features.apiAccess` (Operator, and the legacy agency plan). Free and Starter can still list and revoke. They see "API keys are part of the Operator plan." with a link to `/settings/billing`, and `POST` returns 403. `plans.ts` was not edited.

`POST` accepts `{ name, scopes }` only. The name is trimmed to 1-60 printable characters. Scopes are a non-empty deduped subset of `read`, `write:campaigns`, and `write:outreach`. Ten active keys is the cap (409). The response is `{ key, secret }` with `Cache-Control: no-store`. `key` is `id, name, prefix, scopes, created_at, last_used_at, revoked_at`. `GET` returns `{ keys }` on that allowlist. `DELETE` revokes one active key owned by this brand. A foreign id, a bad id, and an already revoked id are 404.

`POST` and `DELETE` require the Origin host to match the request host. Create is 10 per user per hour (`api_key_create_user_hour`). Revoke is 30 per user per hour (`api_key_revoke_user_hour`). Both use `enforceRules` with `failureMode: "closed"`. `lib/security/rate-limit.ts` was not edited. The JSON body cap is 8 KB.

The client keeps the secret in component state, in a read-only field with Copy, until Done or unmount. It is not put in a URL, storage, a cookie, or a log. A revoked key then gets 401 from `GET /api/v1/health` in the route test, using the existing in-memory admin double.

### Where

- `app/(dashboard)/settings/api-keys/page.tsx`
- `app/(dashboard)/settings/api-keys/api-keys-client.tsx`
- `app/(dashboard)/settings/api-keys/api-keys.test.tsx`
- `app/api/settings/api-keys/route.ts`
- `app/api/settings/api-keys/route.test.ts`
- `app/api/settings/api-keys/[id]/route.ts`
- `app/api/settings/api-keys/[id]/route.test.ts`
- `lib/api/key-settings.ts`
- `lib/api/key-settings.test.ts`
- `app/(dashboard)/settings/page.tsx` (one brand link card)
- `docs/jobs/A5.md`

### Tests

`npx vitest run lib/api/key-settings "app/api/settings/api-keys" "app/(dashboard)/settings/api-keys" "app/(dashboard)/settings"`

Covers 401, 403 for show and agent, 403 without `apiAccess`, 422 on a bad name and an unknown scope, 409 at 10 active keys, 429 on both buckets, 503 when the rate-limit RPC fails, a foreign id and an already revoked id as 404, cross-origin 403, response keys equal to the allowlist with no `key_hash`, the secret only in the POST body and never in a console call, the client clearing the secret on Done, and the settings card for brand only. The settings page source with that card removed hashes to the pre-change file. `npx tsc --noEmit` is clean. `npx vitest run` passed 2789 tests (40 skipped). `npx next build` completed.

### Known gaps

- Request-time plan checks on `/api/v1` and MCP are A7. A key minted on Operator still resolves after a downgrade until it is revoked. List and revoke keep working.
- `/settings/agent-actions` is a static link. A4 builds that page.
- The disabled Generate API Key button on `/settings` is unchanged.
- Two overlapping revokes can both see the key as active and both return 200. A later revoke is 404.
- No migration. If `api_keys` from A1 is not on the database, the page shows a generic load error and the routes return 500.
- A brand whose plan is the legacy agency record can create keys, because that plan's `apiAccess` is true. The agency role cannot open the page.

## CA1: brand command agent (Tay)

### What was built

A signed-in brand can open `/assistant` and talk to Tay. Tay calls the M1 registry in process. Reads answer directly. `propose_campaign` and `propose_outreach` insert one pending `api_write_actions` row with `source` `command_agent`, `api_key_id` null, and `requested_by` equal to the brand. The brand approves or rejects it on the existing `/settings/agent-actions` screen, which was not edited. The row's key name is Tay. Approving `campaign.create` still creates one draft through A4. Approving `outreach.draft` still sends nothing.

The page is URL-only. Nav, layout, settings, and the inbox client were not edited. Discovery, `lib/stripe`, `lib/payouts`, `lib/billing`, `lib/airchecks`, and `plans.ts` were not edited. `lib/llm/client.ts` was not edited. The model is `getLLMModel()`.

083 is applied on `ldtmhafewfifdizgfrnn` (Nov 11, 2026 UTC). It makes `api_key_id` nullable, adds `source` and `requested_by` with the actor check, and adds `command_agent_conversations`, `command_agent_messages`, and `command_agent_usage`. `turn_started_at` is the one-turn marker for the whole brand. Usage rows are append-only and are not tied to a conversation. RLS is on, there are no policies, and only `service_role` is granted. `anon`, `public`, and `authenticated` have nothing, including `truncate`, `references`, and `trigger`.

Caps: 20 messages an hour, 60 a day, 300000 tokens a day, 6 model calls and 8 tool calls a turn, 90 second deadline. The daily cap sums `command_agent_usage`, which has no conversation foreign key, so a delete does not reset it. The loop checks that sum before every model call and writes one usage row after each call. A fresh turn anywhere for the brand is 409. A foreign conversation is 404. `DELETE` checks Origin and returns 409 while that conversation's turn is fresh. Full tool results are `tool_result` blocks only in the turn that produced them. Later turns send the tool name and status as their own turn, not concatenated with the brand's message, and not copied into the system prompt. The thread shows a short line such as "Looked up a show" instead of the raw tool JSON.

Chris named the agent Tay. Decisions (a) through (f) in `docs/jobs/CA1.md` are defaults pending confirmation.

### Where

- `supabase/migrations/083_command_agent.sql` and `083_command_agent.test.ts`
- `lib/command-agent/run.ts`, `tools.ts`, `store.ts`, `limits.ts`, and their tests
- `lib/prompts/command-agent.md`
- `app/api/assistant/route.ts`, `app/api/assistant/[id]/route.ts`, `app/api/assistant/[id]/messages/route.ts`, and their tests
- `app/(dashboard)/assistant/page.tsx`, `assistant-client.tsx`, `assistant.test.tsx`
- `lib/mcp/tools.ts` (`ToolContext.source`, propose handlers pass the actor)
- `lib/api/v1/writes.ts` (command agent actor on `recordAction`; API key inserts are unchanged)
- `lib/api/approvals/list.ts` (null `api_key_id` kept, Tay label, key lookup skipped)
- `lib/data/types.ts` (`command_agent.turn`, `command_agent.cap_hit`, `command_agent_conversation`)
- `docs/api/MCP.md`, `docs/jobs/M1.md`, `docs/jobs/A4.md`, `docs/jobs/CA1.md`

### Tests

`npx tsc --noEmit` is clean.

`npx vitest run supabase/migrations/083_command_agent.test.ts lib/command-agent lib/mcp lib/api/v1 lib/api/approvals app/api/assistant app/api/v1 app/api/settings/agent-actions "app/(dashboard)/assistant" "app/(dashboard)/settings/agent-actions"` passed. The PGlite suite applies on-disk migrations through 083 (059, 062, 063, 064, and 080 are absent), applies 083 again, and checks columns, both actor checks, a valid command agent insert as `service_role`, permission denied for `anon` and `authenticated`, RLS, zero policies, and `service_role`-only grants.

Security coverage: 401 and 403 for show, agent, and admin on every assistant handler and the page gate; foreign Origin 403 on both POSTs; brand B's id is 404; tool context brand id is the session user when the model sends `brand_id`; unknown tools never reach `callTool`; the tool list matches the M1 names; a propose inserts one pending command agent row and nothing into campaigns, outreach, deals, or shows; the same message id replays the action id; approving that outreach row returns "Approved. Nothing was sent." with Resend, email, and outreach generate/send uncalled; `lib/command-agent` does not import decide or execute; an injected tool result stays inside a `tool_result` block and out of the system prompt; a stored tool result does not appear in user-role content on the next turn; a script tag renders as text and a tool row renders as a short line; hour and day buckets return 429 with Retry-After; the token cap returns 429 at 300000 and 503 on a read error; deleting a conversation leaves the usage sum in place; the loop stops before the next model call once the cap is reached; per-turn caps store the stop message; a second conversation is 409 while a turn runs; `DELETE` is 403 for a foreign Origin and 409 during a fresh turn; console output and events omit message text.

`npx vitest run`: 343 files, 2965 passed, 40 skipped. `npx next build` completed. `/assistant` and `/api/assistant` are dynamic. The messages route `maxDuration` is 120.

### Known gaps

- 083 is applied (Nov 11, 2026 UTC). Tay can insert pending rows.
- `/assistant` is not in the nav and is not linked from an existing screen.
- No 90-day purge. The brand deletes a conversation with DELETE.
- An API caller who sends the same `ca:{message id}:{n}` idempotency key can collide with Tay. The API key insert path was not changed.
- A crashed turn holds `turn_started_at` for up to 120 seconds, and that fresh lock blocks every conversation for the brand.
- A model call killed before its usage row is inserted is not counted. The next call is checked against the rows that were written.
- Plan campaign caps are still not enforced on approval. That pairs with A7.
- This environment has no Supabase or app env, so the signed-in `/assistant` and inbox screenshots could not be taken against a live session. The page tests cover the gate, the Tay empty state, literal model text, and the approval link.

## DOC3

### What changed

Docs only. Recorded Chris's November 4, 2026 approval of the LG1 data-pooling narrowing, and corrected the live migration claims on `ldtmhafewfifdizgfrnn`. No code, test, or migration file was edited. Nothing was applied.

LG1 (`docs/jobs/LG1.md`):

- Line 88. "Chris has not approved them." is now "Chris approved the data-pooling narrowing in the upload and imported-IO sentences below on 2026-11-04 (relayed by Angus). See CB-D-002 in company-brain/DECISION_INDEX.md." The sentences are still not the approved L2 line.
- Line 92. "This narrowing still needs Chris's approval." is now "Chris approved this narrowing on 2026-11-04." The narrowing itself is unchanged: an uploaded past-campaign file stays out of the pool unless the brand opted in, and an imported insertion-order PDF becomes an ordinary deal and is pooled once it is signed.

`company-brain/DECISION_INDEX.md`: CB-D-002 is appended after CB-D-001.

`STATUS.md` (line numbers unchanged):

- :5 `OPENAI_API_KEY` is confirmed not set in Vercel as of November 10, 2026 (Chris). The airchecks cron returns 200 and skips, so it cannot transcribe yet.
- :7 Migration 079 is applied (Nov 2, 2026 UTC).
- :11 Migration 081 is applied (Nov 10, 2026 UTC).
- :15 Migration 078 is applied (Nov 2, 2026 UTC). The "do not paste" sentence is removed.
- :33 Migrations 065 and 066 are applied. 061 (`show_ownership`) is applied. 041, 042, and 053 to 058 were applied by hand and are not in the tracked migration list. 082 is applied (Nov 10, 2026 UTC). 083 (CA1 command agent) is applied (Nov 11, 2026 UTC). 080 is reserved for AC3. "001–051 applied" is unchanged. 052 is not stated.
- :36 Migration 076 is applied (Nov 2, 2026 UTC). The library pull and refresh write the new tables.
- :46 Migration 076 is applied (Nov 2, 2026 UTC). The dropped-index sentence now says 076 shipped with the deploy.
- :58 and :68 Migration 040 is applied. The rg pass: those lines still said 040 was written and not applied, and the live list says 040 is tracked as applied. On :58 the em dash before "the columns inherit" is now a period, so the edited line adds no em dash. The words are the same.
- :74 Migration 040 is applied. The five review columns are on the live table. The stale Supabase MCP auth sentence is removed. The old "cannot record success" sentence was the false not-applied claim, so it is removed.

`PRODUCT_BACKLOG.md`:

- :109 Migration 079 is applied (Nov 2, 2026 UTC).
- :110 `OPENAI_API_KEY` is confirmed not set in Vercel as of November 10, 2026 (Chris). The cron cannot transcribe until it is.
- :114 Migration 081 is applied (Nov 10, 2026 UTC).
- :119 Migration 078 is applied (Nov 2, 2026 UTC).
- :306 The YT2 heading now says applied Nov 2, 2026 UTC.
- :308 Migration 076 is applied (Nov 2, 2026 UTC).
- :311 Tense only: "after 076 was applied."
- :315 Tense only: "076 was applied together with the deploy."

### Where

- `docs/jobs/LG1.md`
- `company-brain/DECISION_INDEX.md`
- `STATUS.md`
- `PRODUCT_BACKLOG.md`
- `docs/SENIOR_DEV_HANDOFF.md`

### Tests

None. Docs only. No page or component was edited. Screenshots are not applicable.

Commands: `git diff --stat main` (five Owns files only), `rg -n -i "not applied|written and not|apply .* only after" STATUS.md PRODUCT_BACKLOG.md` (no hits), `rg -n "still needs Chris's approval|Chris has not approved them" docs/jobs/LG1.md` (no hits), `git diff main | rg "^\+.*\x{2014}"` (empty). `npx vitest run`: 343 files, 2965 passed, 40 skipped. `npx next build` compiled and generated 142 pages.

### Known gaps

- The November 4, 2026 approval is second-hand through Angus. This file does not quote Chris directly.
- 052 only revokes and was not verified. It is not stated as applied or not applied.
- 041, 042, and 053 to 058 were applied by hand and are not in the tracked `schema_migrations` list.
- 059 and 062 to 064 are not in the repo. 080 is reserved for AC3 and is not in the repo.
- `OPENAI_API_KEY` is confirmed not set in Vercel as of November 10, 2026 (Chris). The airchecks cron cannot transcribe yet.
- STATUS.md:154 still contains the words "not yet applied" inside a superseded note about migration 033. 033 is applied. That line was left.

## A7: Plan gate on every API key use

### What was built

Every API key request now checks the brand's plan at request time. `assertBrandApiAccess` reads `profiles.role` and `profiles.plan` with the service-role client. The key is allowed only when the role is `brand` and `PLANS[plan].features.apiAccess` is true, the same rule as `brandHasApiAccess`. Operator and the legacy agency plan pass. Free, Starter, an unknown plan, a missing profile, and any other role are HTTP 403 `{ "error": "Your plan does not include API access.", "code": "plan_no_api_access" }`. Auth errors without a code still return `{ "error": "<message>" }`.

The check runs after the key is tied to a user and before `last_used_at` and the `api_call` event. A denied call does not touch either. A profiles read error throws a plain Error and the route returns 500. The key and the brand email are not logged.

Tay is unchanged. It calls `callTool` in process with `keyId: null` and does not go through `resolveApiRequest`, so it still works on Free. `lib/billing/plans.ts` was not edited. No migration.

This closes the A5 gap where a key minted on Operator kept resolving after a downgrade.

### Where

- `lib/api/plan-gate.ts` and `lib/api/plan-gate.test.ts`
- `lib/api/plan-gate.route.test.ts`
- `lib/api/auth.ts` (`ApiAuthError` optional `code`, gate before `last_used_at`)
- `lib/api/v1/handler.ts`, `app/api/v1/mcp/route.ts`, `app/api/v1/health/route.ts` (include `code` only when set)
- `lib/api/memory-admin.ts` (profile selects return the requested columns, so a fixture's `role` and `plan` are visible)
- `docs/api/MCP.md`, `docs/jobs/A5.md`, `docs/jobs/A7.md`

Existing v1 and MCP fixtures that seeded `{ id }` now seed `{ id, role: "brand", plan: "operator" }`. Assertions were not changed. The same data-only edit is in `app/api/settings/api-keys/route.test.ts` because that file calls `GET /api/v1/health`.

### Tests

`npx tsc --noEmit` is clean.

`npx vitest run lib/api app/api/v1 lib/command-agent` passed 153 tests.

`npx vitest run` passed 2974 tests (40 skipped). `npx next build` completed.

Covers operator and agency allowed; Free, Starter, unknown plan, missing row, agent, and admin denied with 403 `plan_no_api_access`; a profiles read error is not an `ApiAuthError` and does not log the email; `brandHasApiAccess` and the gate agree for every `PlanId` plus an unknown plan; a starter key is 403 with `code` on a v1 read, a v1 write, MCP `tools/call`, and `/api/v1/health`, with `last_used_at` unchanged and no `api_call` event; the same key returns 200 on health, the read, and MCP after the plan is operator, and the write returns 202 then 200 on replay; a revoked key is still 401 with no `code`. Tay's `list_campaigns` call succeeds for a Free brand with `keyId: null` and does not call the gate. `lib/command-agent` and `lib/mcp/tools.ts` do not import `lib/api/auth` or `lib/api/plan-gate`.

No page or component changed, so there are no before/after screenshots.

### Known gaps

- Tay is not plan-gated. Every brand plan can use the assistant.
- Key creation is still A5. This job does not change who can mint a key.
- The per-key rate limit is unchanged.
- `plans.ts` was not edited.
- No migration and no live data write.

## IO1

### What was built

The deal IO PDF prints `deals.promo_code` when the brand and show have agreed one. `generateIoPdfFromDeal` draws one terms row, label `Promo Code:`, after the last term and before Standard Terms. The printed value is the normalized slug (`[A-Z0-9]`, at most 24 characters, no spaces), in the same value column as the other terms.

`normalizePromoCode` is the blank check and the value that is drawn. Null, a missing field, an empty string, whitespace, and punctuation-only input draw nothing, and `y` does not move. The raw stored string is not drawn. An authenticated user can update `deals.promo_code` through the Data API, so a value such as `X Publisher Signature Tab` must not become a second DocuSign anchor. That input prints `X`. The full jsPDF text-call list for a blank code equals `lib/pdf/__fixtures__/io-anchor-baseline.json`, recorded from the generator on `dc67a96` before this row existed. Each anchor string, x, y, and page is in that list.

Preview and send already pass the deal from `getWave12DealById` (`select *`), which includes `promo_code`. Those routes were not edited. No screen was edited.

### Where

- `lib/pdf/io-generator.ts` (one row after the terms loop)
- `lib/pdf/io-generator.anchors.test.ts`
- `lib/pdf/__fixtures__/io-anchor-baseline.json` (committed from the pre-change generator)
- `docs/jobs/IO1.md`

`lib/docusign`, `lib/pdf/io-terms.ts`, `lib/pdf/io-pdf.ts`, `lib/stripe`, `lib/payouts`, `lib/billing`, and `plans.ts` were not edited. No migration. Nothing was applied on `ldtmhafewfifdizgfrnn`. No live write, charge, or DocuSign send.

### Tests

`npx tsc --noEmit` is clean. `npx vitest run`: 346 files, 2982 passed, 41 skipped. `npx next build` completed and generated 142 pages before the slug fix.

`lib/pdf/io-generator.anchors.test.ts` covers a null, missing, empty, and blank code against the baseline, the four anchor strings, `SHOW20` once between Make-Good and Standard Terms, anchor x/y/page/font/color, a 64-character code printing as its 24-character slug on one line, and the injection input `X Advertiser Signature Tab Publisher Date Tab` drawing `X` with each of the four anchor strings present exactly once. `lib/pdf/io-generator.test.ts` was not edited.

`RECORD_IO_BASELINE=1` rewrites the fixture. It is skipped otherwise. The committed fixture was taken before the generator change.

Local fixture PDFs: with no code, page 1 and page 2 pixels match the pre-change PDF. With `SHOW20`, the code is a terms row and the signature page pixels still match.

### Known gaps

- The backlog line for this gap is left for a later docs pass. `PRODUCT_BACKLOG.md` was not edited.
- No envelope was sent. Preview and send pick the code up because they already pass the deal row.

### Follow-ups, not built here

- (a) `app/(dashboard)/deals/deals-client.tsx` line 192, View IO, opens the legacy PDF at `/deals/${id}/io` even on DocuSign deals. It should point at `/preview` or the signed PDF.
- (b) Legacy `lib/pdf/io-pdf.ts` (the `io/pdf` download and the `io/send` email attachment) has no promo code.

## SEC2: constant-time cron auth and a race-free turn lock

### What was built

Five crons now compare `Authorization: Bearer <CRON_SECRET>` with `timingSafeEqual` through `isCronAuthorized`. A missing secret is unauthorized. Both sides are buffered, and a different length returns false before the compare. The header and the secret are not logged. `conversion-alerts` and `deal-timeouts` still allow an unset secret when `NODE_ENV` is not `production`. `pooled-priors`, `youtube-library-pull`, and `youtube-library-refresh` stay fail-closed. Status codes and 401 bodies are unchanged. `airchecks`, `roster-owner-notices`, and `youtube-library-emails` were not edited.

`claimTurn` nulls this brand's locks older than 120 seconds, keeps the fresh pre-check, then sets `turn_started_at` only where it is null. A unique violation 23505 is busy. Zero rows still falls back to the conversation check. After a successful claim, the earliest-turn post-check remains. Without 084 it releases the later lock. With 084 it sees one row and changes nothing. Return values are unchanged. The assistant route and `run.ts` were not edited.

A refusal fallback now has a test. The primary call records 11 in and 7 out. The fallback call records 13 in and 5 out on `FALLBACK_MODEL`, and that text is the turn reply. `command_agent_usage` has no model column, so the model is asserted on the fallback `messages.create` call that produced the second usage row.

No page or component was edited. Screenshots are not applicable.

083 is applied on `ldtmhafewfifdizgfrnn`. 084 is in this PR and was not applied to any database. Merge first, then apply 084 any time after Chris names it.

### Where

- `lib/security/cron-auth.ts` and `cron-auth.test.ts`
- `app/api/cron/conversion-alerts/route.ts`
- `app/api/cron/deal-timeouts/route.ts`
- `app/api/cron/pooled-priors/route.ts`
- `app/api/cron/youtube-library-pull/route.ts`
- `app/api/cron/youtube-library-refresh/route.ts`
- `app/api/cron/cron-auth.routes.test.ts`
- `app/api/cron/youtube-library-pull/route.test.ts` and `youtube-library-refresh/route.test.ts` (one assertion each: the source check now looks for `isCronAuthorized`, because `` Bearer ${secret} `` moved into the helper)
- `lib/command-agent/store.ts`
- `lib/command-agent/claim-turn.test.ts` (084 suite, plus one case on migrations through 083 only)
- `lib/command-agent/run.test.ts` (one new test)
- `supabase/migrations/084_command_agent_turn_lock.sql` and its test
- `docs/jobs/SEC2.md`
- `docs/jobs/CA1.md` (turn-lock note)

### Tests

`npx tsc --noEmit` is clean.

`npx vitest run`: 347 files, 2982 passed, 40 skipped.

PGlite covers two parallel claims on one brand with 084, the same case with migrations through 083 only, the same conversation twice, a lock older than 120 seconds, release then claim, and a second brand. 084 applies twice. The index is unique and partial. Anon holds nothing on `command_agent_conversations`. No live database write. `npx next build` was not rerun for this review fix.

### Known gaps

- 084 is not applied. Merge first, then apply 084 any time after Chris names it. Do not apply 084 before this code is live. The claim path on production today treats 23505 as an error, so a stale lock under the new index would return 503.
- A crashed turn still holds `turn_started_at` for up to 120 seconds, and that fresh lock still blocks every conversation for the brand.
- The two youtube route tests above are outside the Owns list. Only the source assertion changed.
- No page or component was edited. This PR does not merge. Paul reviews.

## SEC6: Bind the pitch magic link to the outreach recipient

### What was built

`POST /api/auth/magic/start` emails a sign-in link only to `outreaches.sent_to_email`. The posted address is normalized the same way as the email-code route. A missing address, bad JSON, or an invalid address is still 400. A bad outreach token is still 401. An unknown outreach is still 404. After the outreach loads, the route limits the request and then compares the address. A mismatch, including an empty recipient, logs `[magic.start] recipient mismatch` with the outreach id only, sends nothing, and returns `{ ok: true }`. A match signs a magic token for the recipient with a 1 hour expiry, sends it to that address, and returns `{ ok: true }` even when the send fails. `email_sent` and `email_reason` are gone. The pitch page still treats `res.ok` as "check your inbox".

The limit is `enforceMagicStart`, failure closed, in this order: IP (`magic_start_ip`, 10 per hour), outreach (`magic_start_outreach`, 5 per hour, key the outreach id), email (`magic_start_email`, 3 per 15 minutes, key the email hash). A mismatch consumes those buckets too. A `rate_limit_hit` error is 503 and sends nothing. No new table. `rate_limit_hit` already accepts a bucket name.

`GET /api/auth/magic` checks the magic token, then parses `return_url` before any user lookup or create. The URL must be this origin and the path must be exactly `/outreach/<token>`. That token must verify, the outreach must exist, and `sent_to_email` must be the magic email. Any failure redirects to `/auth/magic?error=invalid_or_expired` and creates nothing. A match still signs in, still sets the onboarding return cookie from that URL, and still sends the browser to `/callback` with `next=/onboarding/show`.

Links are not single-use. Mail scanners that prefetch GET links would burn a one-time token. The expiry is 1 hour instead. The token helper's default stays 24 hours. This caller passes 3600.

No page or component was edited. Screenshots are not applicable. `lib/stripe`, `lib/payouts`, `lib/billing`, `lib/airchecks`, `lib/io/tokens.ts`, and the callback route were not edited. No migration. Nothing was applied on `ldtmhafewfifdizgfrnn`. No live write and no email send.

Precheck (read only, Nov 11, 2026): outreaches 1, outreaches without a recipient 0, magic_link users 0, `rate_limit_hit(text,text,integer,integer)` present, `rate_limit_events` 5.

### Where

- `app/api/auth/magic/start/route.ts` and `app/api/auth/magic/start/route.test.ts`
- `app/api/auth/magic/route.ts` and `app/api/auth/magic/route.test.ts`
- `lib/security/rate-limit.ts` (`enforceMagicStart` and `MAGIC_START_OUTREACH_MAX` only) and `lib/security/rate-limit.test.ts`
- `docs/jobs/SEC6.md`
- `docs/security/S-A_FINDINGS.md` (SA-09 status, SEC6 finding)
- `docs/SENIOR_DEV_HANDOFF.md`

### Tests

`npx tsc --noEmit` is clean.

`npx vitest run app/api/auth lib/security app/outreach components/auth`: 10 files, 152 passed.

`npx vitest run`: 351 files, 3018 passed, 41 skipped. `npx next build` compiled and generated 142 pages.

Covers a mismatch with a body identical to the match and no send, case and whitespace on the recipient, an empty recipient, the 6th outreach call, the 4th email call, the 11th IP call, a mismatch filling the outreach and IP buckets, a limiter error returning 503, unchanged 400/401/404, a failed send still returning `{ ok: true }`, and an emailed token that lands on `/callback` with `token_hash` and `next=/onboarding/show`. GET refuses a different email, another origin, a path that is not `/outreach/<token>`, and a bad outreach signature, and does not call `createUser`, `generateLink`, or the profiles insert. A match still sets the return cookie. `enforceMagicStart` sends the three buckets and fails closed.

### Known gaps

- The setup email still says the link expires in 24 hours (`lib/email/templates/magic-link.ts`). That file is outside this job. The token expires in 1 hour.
- `docs/security/RATE_LIMITS.md` still lists `POST /api/auth/magic/start` as unlimited. That file is outside this job. The limit is `enforceMagicStart`.
- The pitch page still shows `sent_to_email` to anyone holding the outreach token. Masking it is a later UI job. SEC5 owns `app/outreach/[token]/page.tsx`.
- The mismatch path skips the brand lookup and the send, so it answers faster. That matters once the address is no longer on the page.
- A brand chooses `sent_to_email`, so one invite can still open a show account at that inbox. Same as the email-code path. A confirm step before account creation is not in this job.
- `siteOrigin` uses the request host when `NEXT_PUBLIC_SITE_URL` is unset. Confirm that variable is set in production.
- Magic links are reusable until they expire. Not single-use, so a scanner prefetch does not burn the link.
- A show whose real inbox differs from the address the brand typed gets no link and no error. The brand resends to the right address.
- SEC5 follow-up "magic/start sends to any address" was not in `S-A_FINDINGS.md` on main `2732ccd`. This section and the SEC6 finding mark it closed by SEC6.
- This PR does not merge. Paul reviews.


## SEC3

### What was built

Migration 085 locks Data API writes on deals, insertion orders, IO line items, invoices, invoice line items, and outreaches. `authenticated` loses UPDATE and DELETE on deals, and INSERT is limited to the legacy columns `createDeal` and `addDeals` write. The two deal UPDATE policies and the two outreach write policies are dropped. A security definer trigger, `private.reject_client_write_on_docusign_deal`, rejects an insert or update of an IO, line, invoice, or invoice line when the parent deal is missing or has `outreach_id`, `brand_profile_id`, or `docusign_envelope_id` set. `service_role`, `postgres`, and `supabase_admin` are allowed, and so is a `service_role` JWT. The legacy IO editor can still update `IO_FIELDS`, the three totals, `updated_at`, and `LINE_FIELDS` on a legacy deal. `updateInvoiceStatus` can still set `status`, `sent_at`, `paid_at`, `payment_method`, and `updated_at`. Outreach and payout writes are revoked. SELECT grants and SELECT policies stay. `service_role` grants are untouched.

085 is written and not applied. Apply it on `ldtmhafewfifdizgfrnn` only after merge and Chris's OK. The live precheck on 2026-11-11 was SELECT only: 0 deals, 0 line items, 0 invoices, 0 payouts. No backfill.

No route, lib, or component file was edited. `lib/stripe`, `lib/payouts`, `lib/billing`, `lib/airchecks`, and `plans.ts` were not edited. No screen, style, or animation was changed.

### Where

- `supabase/migrations/085_lock_deal_io_writes.sql` (not applied)
- `supabase/migrations/085_lock_deal_io_writes.test.ts`
- `docs/jobs/SEC3.md`
- `docs/security/S-A_FINDINGS.md` (SA-26 under section 6)
- `docs/SENIOR_DEV_HANDOFF.md` (this section)

### Tests

`npx tsc --noEmit` is clean.

`npx vitest run supabase/migrations/085_lock_deal_io_writes.test.ts supabase/migrations/072_lock_money_columns.test.ts supabase/migrations/083_command_agent.test.ts app/api/deals app/api/invoices app/api/campaigns lib/data` passed 393 tests in 40 files.

`npx vitest run`: 351 files, 3008 passed, 41 skipped. `npx next build` completed and generated 142 pages.

The PGlite suite loads on-disk migrations through 085 (059, 062, 063, 064, and 080 may be absent; 084 is on main), applies 085 again, and checks the legacy insert key sets, the legacy IO and invoice writes, the DocuSign-flow rejections, outreach and payout denials, the profile money-column regression, and `service_role` writes. No hosted database is used.

### Known gaps

- 085 is not applied. Do not paste it until Chris says so.
- Service-only tables with stray authenticated grants stay as they are: `analog_matches`, `campaign_patterns`, `conviction_scores`, `discovery_locks`, `founder_annotations`, `interpretation_locks`, `ring_hypotheses`, `show_sponsors`. RLS blocks them. Grant hygiene is a follow-up.
- `deals.setup_intent_client_secret` is still selected by a participant. Column-level SELECT is a follow-up.
- `chargeForEpisode` loads `io_line_items.gross_rate` by line id and does not check that the line belongs to the deal (`lib/stripe/payment-intent.ts:240-244`). Needs Chris's OK before a code change.
- The legacy IO page's generate path uses the user client. On a DocuSign-flow deal that insert now fails. That default was accepted. The service-role create in `persistIoForDeal` is unchanged.
- Invoices page and IO form: Generate invoice (POST /api/invoices/generate, createInvoiceFromIO, which inserts with the user client at lib/data/queries.ts:462) now fails on a DocuSign-flow deal. app/(dashboard)/invoices/page.tsx:100-124 offers it for any live or completed deal whose IO has a verified or posted line, and Wave12 deals reach live and completed. createInvoice returns null on the 42501, so the route answers 400 'No delivered line items found', which is misleading. Default: accept. DocuSign deals are charged per episode through Stripe, and no DocuSign invoice exists live (0 invoices). If Chris wants invoices on DocuSign deals, a follow-up job moves that insert to the service client behind a party check.

## SEC4: card-setup client secret off deals

### What was built

`deals.setup_intent_client_secret` is a confirmable Stripe credential, and every deals SELECT policy returns it. It now lives on `deal_payment_secrets`, which is service_role only. RLS is on. There are no policies. Anon, public, and authenticated have nothing on the table, including truncate, references, and trigger.

`getDealSetupSecret` and `saveDealSetupSecret` are the only server read and write. Both fail soft when the table is missing, which is the state until 086 is applied. They log a fixed outcome line and never log the secret or the driver error.

The DocuSign webhook and `POST /api/deals/[id]/setup-intent` write `setup_intent_id` on deals and the secret on `deal_payment_secrets`. A failed secret save still returns the client secret to the brand. The deal page passes the stored secret only when the viewer owns the deal as the brand. The show viewer gets null. `Wave12DealClient` was not edited. It already POSTs the setup-intent route when the prop is null.

086 is not applied. Nothing was written on `ldtmhafewfifdizgfrnn`. Read-only precheck on Nov 11, 2026: 0 deals, 0 secrets, `deal_payment_secrets` does not exist, and the three deals SELECT policies are unchanged.

085 (SEC3, PR 90) grants deals INSERT on the legacy column list. That list does not include `setup_intent_client_secret`. 086 does not change deals grants. Either apply order works. If a later 085 draft adds the column to the GRANT, that draft has to drop the name, or the GRANT fails after 086. This PR does not edit 085.

### Where

- `supabase/migrations/086_deal_payment_secrets.sql` and `086_deal_payment_secrets.test.ts`
- `lib/deals/payment-secrets.ts` and `payment-secrets.test.ts`
- `app/api/deals/[id]/setup-intent/route.ts` and `route.test.ts`
- `app/api/webhooks/docusign/route.ts` (the SetupIntent persist block) and `route.test.ts`
- `app/(dashboard)/deals/[id]/page.tsx` (the `deal` prop only) and `page.test.tsx`
- `docs/jobs/SEC4.md`
- `docs/security/S-A_FINDINGS.md` (SA-27, after SA-26)
- `docs/SENIOR_DEV_HANDOFF.md`

`page.test.tsx` is outside the Owns list. No deal page test existed. `STATUS.md` was reverted. `lib/stripe`, `lib/payouts`, `lib/billing`, `lib/airchecks`, `plans.ts`, `lib/data/types.ts`, `lib/data/queries.ts`, and `components/deals/Wave12DealClient.tsx` were not edited.

### Tests

`npx tsc --noEmit` is clean.

PGlite covers the backfill, a second apply, 42703 on the dropped column, permission denied for the brand owner, the show owner, and anon, a deals `select *` with no secret column, service_role insert, upsert, and select, RLS with zero policies, service_role-only grants, and cascade on deal delete. A minimal database grants INSERT on another column and on the secret, then applies 086: the other grant remains, and a GRANT that names the dropped column fails. The full schema then grants 085's exact legacy list and inserts as the brand. Reapplying 086 leaves that grant working.

The helper test checks that a missing-table error returns null or false and that the log never contains the secret. The route tests keep the old response bodies. A failed secret save is still 200. A non-brand caller is still 403. The page test checks the show and brand props. `Wave12DealClient.test.tsx` was not edited and passes.

`npx vitest run`: 353 files, 3015 passed, 41 skipped. `npx next build` compiled successfully and generated 142 static pages. `/deals/[id]` stays dynamic.

### Known gaps

- 086 is not applied. Merge first, then apply it after Chris names it. Do not apply it before this code is live. Until it is applied, `GET /api/deals` and `GET /api/deals/[id]` can still return the column through `select *`. The precheck found no stored secret. The show viewer's page payload is null either way.
- `outreaches.token` is still readable by the sending brand, including through `GET /api/deals/[id]`. That is a separate job, plus SEC3's write lock.
- The page and `GET /api/deals/[id]` still send `setup_intent_id`, `payment_method_id`, and `docusign_envelope_id` to the show viewer. Those are ids. The show does not use them.
- `app/api/admin/seed-deal/route.ts:529` mentions a `deal_setup_intents` table that does not exist.
- No page markup changed. Screenshots are not applicable. This PR does not merge. Paul reviews.

## SEC5: stop storing the outreach response token

### What was built

The signed outreach link is no longer stored, and no API response or page prop returns it. `redactOutreach` / `redactOutreaches` set `token` to `""`. `POST /api/outreach` inserts `retired:<uuid>`, updates `sent_at` only, still signs the email link, and drops `pitch_url`. Accept, counter, and decline return the redacted row. The campaign outreach list, the campaign outreach page prop, the pitch page's outreach prop, and the Wave 12 deal GET do the same. The pitch page still passes the URL token separately. The admin seed route inserts the same placeholder, does not write the signed token, and still returns the signed URL to the admin caller.

Verification stays signature-only. `lib/io/tokens.ts`, `lib/data/queries.ts`, and `lib/data/types.ts` were not edited.

087 overwrites every stored token with `retired:<id>` and drops NOT NULL, only if the column exists. `outreaches_token_key` stays. No grant change, no policy change, no new table. It was not applied. Precheck on `ldtmhafewfifdizgfrnn` (11 Nov 2026, read only): 1 outreach, 0 unexpected tokens, `token` not nullable, `outreach_tokens` absent, select policies "Brand reads own outreach, Show reads outreach to their email".

No markup or copy changed. Screenshots are not included. The two page edits are the outreach prop only, and both pages need a live session or a live signed link.

### Where

- `lib/outreach/public.ts` and `public.test.ts`
- `app/api/outreach/route.ts` and `route.test.ts`
- `app/api/outreach/[token]/accept/route.ts`, `counter/route.ts`, `decline/route.ts`, and `actions.test.ts`
- `app/api/campaigns/[id]/outreach/route.ts` and `route.test.ts`
- `app/(dashboard)/campaigns/[id]/outreach/page.tsx` (the `initialOutreaches` prop)
- `app/outreach/[token]/page.tsx` (the `outreach` prop; the URL `token` prop is unchanged)
- `app/api/deals/[id]/route.ts` (the Wave 12 `outreach` field) and `route.test.ts`
- `app/api/admin/seed-outreach/route.ts`
- `app/api/admin/seed-outreach/route.test.ts` (outside the Owns list: the old assertion required storing the signed token, and the `single()` queue assumed that update)
- `supabase/migrations/087_outreach_token_retire.sql` and its test
- `docs/jobs/SEC5.md`
- `docs/security/S-A_FINDINGS.md` (SA-28)

### Tests

`npx tsc --noEmit` is clean.

`npx vitest run` after the rebase onto main (`cb12449`): 357 files, 3042 passed, 41 skipped. `npx next build` completed.

PGlite loads migrations 001 through 084, seeds two JWT-shaped tokens, and applies 087. The same assertions pass after loading through 085, which is on main. Both tokens become `retired:<id>`, `token` is nullable, and `outreaches_token_key` remains. A brand JWT sees only `retired:` values. Show A sees only the row sent to its login email. Anon is permission denied. `service_role` can select and can insert a row with no token. A second apply leaves the retired values unchanged. No hosted database.

Route tests: the send response has no `pitch_url` and `outreach.token` is `""`; the update payload has no `token`; the insert placeholder starts with `retired:`; the email html and text contain `/outreach/<jwt>` and `verifyOutreachToken` returns the new outreach id. Accept, counter, and decline still return 200 with the same status transitions and emails, with `token: ""`. A bad signature is still 401. The campaign outreach owner gets empty tokens; a non-owner gets 404. The Wave 12 deal GET redacts `outreach.token` for the brand and for the show.

### Known gaps

- 087 is not applied. Merge first, then apply it after Chris names it. Until then, the one live row still holds its JWT in the column. No response or prop returns it.
- Tokens still do not expire and cannot be revoked without rotating `OUTREACH_TOKEN_SECRET`. Default: no rotation. One live outreach, internal taylslate.com recipient.
- Contract migration (drop the column and the placeholder writes) waits until 087 is live and this code is deployed.
- `setup_intent_id`, `payment_method_id`, and `docusign_envelope_id` still reach the show viewer. SEC4 owns that. Ids, not credentials.
- `POST /api/auth/magic/start` still sends a magic link to any address for any valid outreach token. Behavior review, not this job.
- `app/api/admin/seed-outreach/route.test.ts` is outside the Owns list. Only the token-persist assertion and the `single()` queue changed.
- This PR does not merge. Paul reviews.
