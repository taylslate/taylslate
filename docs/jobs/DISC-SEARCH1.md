# DISC-SEARCH1: Direct show search on the media plan

Grounded on `origin/main` at `8873684` (Add OAuth so remote MCP clients can connect, #110). No migration. Nothing in this job was written to the live database.

## Flow

On `/campaigns/[id]/plan`, a brand or agency opens "Add a show by name", types a name, and adds one result to the media plan. The page remounts `MediaPlanBuilder` after the add so the new show is a normal line, priced the way the builder already prices a show. Search is one entry point above the builder. The builder, the discovery views, `/shows/search`, plan handoff, and selections are unchanged.

## Routes

- `GET /api/campaigns/[id]/show-search?q=` returns `{ results, podscanAvailable }`.
- `POST /api/campaigns/[id]/show-search/add` accepts JSON `{ key }` only, at most 2 KB. Success is `{ ok: true, showId, alreadyInPlan }`.

Both routes are `dynamic = "force-dynamic"`, `runtime = "nodejs"`, and every response sets `Cache-Control: no-store`, including 401, 403, 404, 400, 429, and 503.

## Gates

Session first. No session is 401. The role is `profiles.role` from `getUserProfile`, not the effective role. `isBrandSide` allows brand and agency. A show or agent is 403, and the campaign is not loaded. Then the campaign id must be a UUID and `campaign.user_id` must equal the session user id. Anything else is 404, and nothing beyond the campaign is read. Email is never an access check.

`q` missing, under 2 characters, or over 100 characters is 400 "Enter 2 to 100 characters." That check runs before the rate limit. A POST body that is not JSON is 400 "Send JSON." Over 2 KB is 400 "Request is too large." A key that is not `show:<uuid>` or `podscan:<id>` is 400 "That show key is not valid." and does not spend the hourly quota.

## Rate limits

Closed, keyed by the session user id.

- Search: `disc_search_user_min` 20 per 60 seconds, and `disc_search_user_day` 300 per 86400 seconds.
- Add: `disc_search_add_user_hour` 60 per 3600 seconds, after the key is syntactically valid and before any Podscan or show read.

A denied call is 429. A store error is 503. The route copies `Cache-Control: no-store` onto that response.

## Public result shape

Each result is rebuilt as exactly these keys, in order: `key`, `name`, `platform`, `audienceSize`, `categories` (at most 5), `imageUrl`, `origin`, then `inPlan` from the route. `key` is `show:<uuid>` or `podscan:<podcast_id>`. `origin` is `taylslate` or `podscan`. `inPlan` is true only for a catalog key whose uuid is in `selected_show_ids`. Podscan rows are not in the plan until they are saved.

Catalog search uses `sanitizeDirectSearch` (same trim, 100 character cap, and `\` `%` `_` escaping as `sanitizeShowSearch`; `*` stays literal). Podscan gets the trimmed name, not the LIKE-escaped string. Up to 10 catalog rows from `getShowsFiltered`, projected with `fullShowIdsForCaller` and `projectShows`, then rebuilt so a tied caller still does not receive contact, email, rate card, or description. Up to 10 Podscan name matches. A Podscan row whose `podcast_id` equals a catalog `podscan_id` is dropped. The catalog id is read before projection, because the public show drops `podscan_id`. A Podscan failure or a missing client sets `podscanAvailable: false` and hides only that group. A thrown catalog error becomes "Search failed. Try again."

## Add

The server trusts only `key` and loads the show again.

- `show:<uuid>`: cookie client, `shows` row with `is_discoverable = true`, passed through `transformShow`. Hidden or missing is 404 "Show not found."
- `podscan:<id>` must match `^pd_[A-Za-z0-9]{1,40}$`. A discoverable catalog row with that `podscan_id` is used and nothing is inserted. Otherwise, if the plan already has 50 shows, the route returns 409 "The plan is full." before `createShow`. Otherwise `GET /podcasts/<id>`. The body may be the podcast or `{ podcast }`, and `podcast_id` must match. A 404 throw means the podcast is missing. Any other failure, or a 200 body that is not that podcast, runs `searchPodcasts` with the podcast id as the query and keeps an exact `podcast_id`. The save uses `podscanPodcastToShow` and `createShow` with `data_sources: ["direct_search"]`, `is_claimed: false`, `is_verified: false`, contact as Podscan gives it, and no `actor` (so those flags stick and `is_discoverable` stays true). The stored `podcastId` is the new `shows.id`, never `discovered-podscan-...`. If `createShow` returns `is_discoverable: false`, the route answers 404 and does not add the show.

`lib/podscan` is imported and not edited. `podscanPodcastToShow` is typed against the enrichment client, so the search podcast is mapped onto that shape before the call. No new Podscan wrapper was added.

## Append rule

`appendShowToPlan` reads `scored_shows`, `selected_show_ids`, and `updated_at` through the cookie client, so RLS applies. It does not call `updateCampaignPlanHandoff`. An id already selected (case-insensitive) returns `{ ok: true, alreadyInPlan: true }` and writes nothing. 50 selected shows is 409 "The plan is full." and writes nothing. Otherwise one update sets `scored_shows` (add, or replace the same `podcastId`), `selected_show_ids` (id appended), and a new `updated_at`, filtered on `id`, `user_id`, and the `updated_at` just read. The update uses `.select("id")`. Zero rows is 409 "The plan changed. Reload and try again." and is not retried. A database error is 500 "Search failed. Try again." and the response does not include `error.message`. No other campaign column is written. The only insert is `createShow` for a Podscan show that is not already in the catalog.

The stored record uses `source: "search"`, base midroll CPM (or a flat rate turned back into a CPM so the builder's mid-roll price matches it), `compositeScore: 0`, no `placement`, `contactEmail: null`, and `description: ""`. `costIsEstimate` is false only when `min_buy` is a number greater than 0. `audienceIsEstimate` is false in that same onboarded case. Otherwise it is true when `data_sources` includes `direct_search`, `podscan`, or `discovery`, or when `podscan_id` is set.

## Page

`plan/page.tsx` renders `<DirectShowSearch campaignId={campaign.id} />` directly above `<MediaPlanBuilder>`. The builder `key` is `selectedShows.map((show) => show.podcastId).join(",")`. The redirect to `/campaigns/[id]` when nothing is selected is unchanged and still runs before `listPublishedSurfacesForShows`. After a successful add the client sets that row to "In plan" and calls `router.refresh()`.

The panel debounces 300 ms from the input handler. "Searching..." is set inside the request, after the debounce. A later response cannot overwrite an earlier one. Server error text is shown only when it is one of the fixed strings.

## Tests

Vitest, with Supabase, Podscan, the rate-limit helper, and `createShow` mocked.

- Gates on GET and POST: 401, 403 for show and agent, 404 for another user's campaign with no further reads, 400 for a short or long `q`.
- `sanitizeDirectSearch` matches `sanitizeShowSearch` on a fixed list, escapes `%`, `_`, and `\`, and leaves `*` literal.
- Public keys only, including when the caller is tied to the show. Catalog wins on a shared `podscan_id`. Podscan throw or a missing client sets `podscanAvailable: false`.
- Add: hidden show 404, bad key 400 before the rate limit, body fields other than `key` ignored, catalog Podscan id not inserted, new Podscan show saved once with `is_claimed: false` and `is_verified: false`, update columns and filters as above, already in plan writes nothing, zero rows is 409, 50 shows is 409 before `createShow`.
- `MediaPlanBuilder` renders the catalog record. Audience 200,000, CPM 40, 3 mid-roll episodes, line total `$24,000`, and no estimate tag.
- 429 and 503 on search and on add. `secret-db-text` from mocked Supabase and Podscan errors is absent from response bodies and rendered text.
- UI: debounce, loading, empty, error, Podscan-unavailable line, disabled "In plan", add then `router.refresh()`. Page key and the empty-selection redirect.

Ship checks are recorded in the PR. `lib/stripe`, `lib/payouts`, `lib/billing`, `lib/airchecks`, and `lib/billing/plans.ts` were not read or changed.

## Known gaps

- The copy is exactly the DISC-SEARCH1 default. Chris can change it.
- No plan gate. Every brand and agency account gets the search, the same as `/shows/search`. Podscan cost is bounded by the rate limits. `lib/billing/plans.ts` was not read or changed.
- `getShowsFiltered` swallows a catalog database error as an empty list. That file was not edited. Only a thrown catalog error becomes "Search failed. Try again."
- If `GET /podcasts/:id` is not on the plan, the fallback name search queries the podcast id, because the add body has no name, and keeps an exact `podcast_id`. It can miss.
- The button sits directly above `MediaPlanBuilder`, not inside the builder header, because the builder file is not owned.
- The search is on the plan page. The discovery list was not given a second search bar.
- No migration. This PR does not merge. Paul reviews.
