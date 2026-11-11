# U1b: YouTube library creators in brand show search

Grounded at main `80f451c` (AC-YT, #100). No migration. Nothing in this job was applied to `ldtmhafewfifdizgfrnn`. `lib/youtube-library/read.ts`, `store.ts`, and `quota.ts` are imported and not edited.

## Precheck

Read only, project `ldtmhafewfifdizgfrnn`, Nov 11, 2026. No rows written.

```sql
select
  (select count(*) from public.youtube_channels where passed_market_filter and brand_flag is null) as passed,
  (select count(*) from public.youtube_channels where show_id is not null) as library_linked,
  (select count(*) from public.shows where coalesce(youtube_channel_id, '') <> '') as shows_with_channel,
  (select count(*) from information_schema.role_table_grants
     where table_schema = 'public' and table_name in ('youtube_channels', 'youtube_channel_emails')
       and grantee in ('anon', 'authenticated', 'PUBLIC')) as browser_grants;
```

| Check | Result |
| --- | --- |
| passed, no brand flag | 5442 |
| library rows with `show_id` | 2 |
| shows with a channel id | 14 |
| grants to anon, authenticated, or PUBLIC | 0 |

That matches the expected Nov 11, 2026 snapshot. Coding continued.

Broader counts from the same day, not re-run here: `youtube_channels` 8,740; 5,479 passed the market filter; 1,692 channels have a row in `youtube_channel_emails` (2,161 rows). This job does not read that table.

## What the data allows

`youtube_channels` is service_role only (migration 074). RLS is on and there is no policy. `youtube_channel_emails` is service_role only (076). The browser cannot select either table, and this job does not grant anything.

The link from a library channel to a show is `shows.youtube_channel_id` (the UC id) or `youtube_channels.show_id`. Either one means the creator is already a show, so the library result is dropped. That is the same both-ways dedupe `mergeLibraryFirst` uses.

A channel is eligible when all of these hold:

- `passed_market_filter` is true
- `brand_flag` is null
- `stats_refreshed_at` is at or after `statsFreshCutoff(now)` (30 days)
- `channelPassesLibraryFloors` passes (10 videos, and 10,000 recent views or 5,000 fallback views)

`/shows/search` over `shows` alone can surface at most the 14 discoverable shows that already store a channel id. The library rows that pass the rules above and are not already a show are what this search adds. Campaign discovery already reads the library server-side in `readYoutubeLibraryMatches`. That path stays inside a media plan.

## Field allowlist

`SAFE_COLUMNS` selects the public fields plus the columns the floor check and the show link need. The filter columns are stripped before the return.

Returned:

- `channelId`, `title`, `thumbnailUrl`, `country`, `subscriberCount`, `videoCount`
- `averageViews` from `avg_recent_views`
- `averageViewsLabel`: `recent` when `avg_views_method` is `recent`, otherwise `average`
- `nicheTags`
- `youtubeUrl`, always `https://www.youtube.com/channel/{channelId}`
- `description` on the profile only, cut to 300 characters

Selected for the check, then dropped:

- `total_view_count`, `avg_views_method`, `stats_refreshed_at`, `show_id`, `passed_market_filter`, `brand_flag`

Never selected and never returned: any `youtube_channel_emails` row or column, `source`, `source_query`, `keywords`, raw `topic_categories`, `tagged_at`, `niche_tags_version`, `created_at`, `first_seen_at`.

The search handler rebuilds each object from those keys, so an extra field on the row cannot ride along in the JSON.

## Why there is no view

A `security_invoker` view needs `authenticated` to hold `SELECT` on `youtube_channels`. That grant is every column, and the table is meant to stay service-only. A `security definer` view bypasses RLS and is flagged by the Supabase linter (`0010_security_definer_view`).

The read model is a server module. `lib/youtube-library/brand-read.ts` uses `supabaseAdmin` and `SAFE_COLUMNS`. The search page and the profile page both require a brand or agency effective role before they call it. The route does the same.

## The next free migration (090 at the time of writing), not built

A database function is the right shape if `/api/v1` or PostgREST ever needs this read. It is not in this PR. When it is needed, the next free migration (090 at the time of writing) should add:

`public.library_creators_search(p_query text, p_limit integer)`

- `language plpgsql`
- `security definer`
- `set search_path = ''`
- returns only the safe columns above
- inside the function, the caller's `profiles.role` must be `brand` or `agency`
- `revoke all` from `public` and `anon`
- `grant execute` to `authenticated` only
- no grant on `youtube_channels` or `youtube_channel_emails`

## YouTube III.E.4

YouTube API Services Terms III.E.4 limits how long API statistics may be stored without a refresh. The library already treats 30 days as that limit (`YOUTUBE_STATS_MAX_AGE_DAYS` and `statsFreshCutoff` in `store.ts`). This search uses that cutoff. A channel whose `stats_refreshed_at` is older than 30 days is not returned and is not rendered.

## What shipped

`GET /api/library/creators?search=` runs on the Node.js runtime. No session is 401. A role other than brand or agency is 403. A query whose unescaped length is over 100 characters is 400. An escaped term is accepted up to 200 characters, which is the longest value the search box can send after `\` `%` and `_` are escaped. `enforceRules` uses `library_creators_user_minute` (30 per minute per user) and `library_creators_user_day` (1,000 per day). Failure mode is closed, so a limiter error is 503. The response is `Cache-Control: no-store` and the body is `LibraryCreator[]` only.

`/shows/search/youtube/[channelId]` is a server page with the same gate as `/shows/search`. `getLibraryCreator` returns null for a bad id, a stale row, a flagged row, a row under the floors, or a channel that is already a show, and the page calls `notFound()`. The page shows the thumbnail, title, country, subscribers, videos, average views with the recent or average label, niche tags, the 300-character description, a "View on YouTube" link (`target="_blank"`, `rel` includes `noopener`), and the line "Channel data from YouTube". There is no outreach, contact, or add-to-campaign action.

`/shows/search` keeps the existing show list. The same debounced query also calls `/api/library/creators` with the escaped term. Matching creators render under the shows in a group headed "YouTube creators", using the existing row classes. Each row shows the title, "YouTube", average views, and the first niche tag, and links to `/shows/search/youtube/{channelId}`. A library error renders nothing for that group. A library 401 shows the existing sign-in message only when the shows call failed too. The show copy, the 50-row cap, and the CRM links are unchanged. Deduping stays on the server.

## Where

- `lib/youtube-library/brand-read.ts`
- `lib/youtube-library/brand-read.test.ts`
- `app/api/library/creators/route.ts`
- `app/api/library/creators/route.test.ts`
- `app/(dashboard)/shows/search/youtube/[channelId]/page.tsx`
- `app/(dashboard)/shows/search/youtube/[channelId]/page.test.tsx`
- `app/(dashboard)/shows/search/search-client.tsx`
- `app/(dashboard)/shows/search/search-client.test.tsx`
- `docs/jobs/U1b.md`
- `docs/SENIOR_DEV_HANDOFF.md`

## Tests

`npx tsc --noEmit` is clean.

`npx vitest run`: 387 files, 3262 passed, 41 skipped.

`npx vitest run lib/youtube-library/brand-read.test.ts app/api/library 'app/(dashboard)/shows/search'`: 4 files, 47 passed.

`npx next build` compiled successfully and generated 147 pages. `/shows/search`, `/shows/search/youtube/[channelId]`, and `/api/library/creators` are dynamic.

Covers the select list, the public key list, exclusion for a failed market filter, a brand flag, a 31-day-old refresh, both view floors, a `show_id` link, and a `shows.youtube_channel_id` link. Wildcard escaping is idempotent for an already escaped term. The page size stays at 20 and null view counts sort last. A missing library table returns an empty list or null. A bad channel id returns null without a query. A thrown error does not include the query text.

The route covers 401, 403 for show and agent, 400 for 101 characters, 429, fail-closed 503, and a 200 body whose keys are exactly the public creator keys, with `Cache-Control: no-store`.

The profile page covers the signed-out redirect, the show and agent redirect to `/dashboard`, `notFound` for an ineligible id, the public fields, the attribution, and no address in the rendered HTML.

The search client keeps every previous assertion. The new group renders under the shows and links to the profile. A library failure leaves the show results in place.

## Known gaps

- A library creator has no outreach, contact, or add-to-campaign action. The profile is read-only.
- The match is `ilike` on `title` only.
- The database page is capped at 20 before the in-code floor check and the show-link drop, so a page can come back shorter than 20.
- The next free migration (090 at the time of writing) is not written. No view, no policy, and no grant.
- `youtube_channels` and `youtube_channel_emails` stay service_role only.
- The Search nav item was not changed. `read.ts`, `store.ts`, `quota.ts`, `lib/nav`, `lib/security/rate-limit.ts`, and `app/api/shows` were not edited.
- No live write.
