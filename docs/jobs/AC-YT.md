# AC-YT: Creator YouTube connection for caption airchecks

A show user connects their own YouTube channel. For a booked YouTube spot on a deal where that user is the show party and the connected channel is the show's channel, Taylslate downloads the creator's caption track, matches the ad read with the existing aircheck matcher, and stores raw YouTube Analytics for that video. Tokens are encrypted. Disconnect revokes at Google and deletes the data. `lib/airchecks` is not edited.

Grounded on main `7ee451d` (LRN-YT, #98), which already excludes provider `youtube-captions` from `lib/learning`. This job writes that exact provider string.

## Precheck

Read only, project `ldtmhafewfifdizgfrnn`, Nov 11, 2026. No rows written.

| Check | Result |
| --- | --- |
| `io_line_items` with format `youtube` | 0 |
| `airchecks` | 0 |
| shows with `youtube_channel_id` | 14 |
| `youtube_channels` linked to a show | 2 |
| `youtube_oauth_connections` | null |
| `youtube_aircheck_metrics` | null |
| `youtube_quota_log_job_check` | `pull`, `refresh`, `email_backfill` |
| max `youtube_quota_days.units` over 7 days | 6693 |
| `aircheck_reserve` column | 0 |

That matches the expected Nov 11, 2026 snapshot. Coding continued. Migration 088 is in this PR and is not applied.

## What changed

- `supabase/migrations/088_youtube_oauth.sql`: service-only `youtube_oauth_connections` and `youtube_aircheck_metrics`. RLS on, no policies. `youtube_quota_days.aircheck_reserve` and `youtube_quota_set_reserve`. Job `aircheck_captions` on the quota check and `youtube_quota_commit`. Disconnect and housekeeping functions clear caption text and excerpts and do not change the match judgment.
- `lib/youtube-oauth`: OAuth (two scopes only), AES-256-GCM, caption VTT parsing, raw analytics, quota against the 9,800 ceiling, and the caption feed.
- `lib/youtube-library/quota.ts` and `store.ts`: the library cap becomes `min(daily cap, 9800 - reserve)`. A missing reserve method is 0. A reserve read error is 1,800, which keeps today's 8,000 cap. No other library file changed.
- `GET /api/cron/airchecks` runs the caption feed first, in its own try, then the existing transcription run. The JSON includes `youtube`. No new cron.
- `/settings/youtube` is a new show-only page. It is not linked from any existing screen.

The code only reads. `youtube.force-ssl` is required because captions.list and captions.download accept no narrower scope. Taylslate never uploads, edits, deletes, or posts.

Aircheck rows use provider `youtube-captions`, the value `GOOGLE_DERIVED_AIRCHECK_PROVIDERS` already excludes. `DEEPGRAM_API_KEY` is named in `.env.example` because this job owns that file.

## Quota

One Google project, one ledger. Caption checks commit with job `aircheck_captions` and cap 9,800. The library yields the day's `aircheck_reserve` first. Tomorrow's reserve is `min(4000, 253 x pending caption spots)`, with a floor of 1,800 while any connection is active, else 0. YouTube Analytics `reports.query` is not written to this ledger.

Not covered: live discovery searches and the runner's own YouTube lookups in `lib/airchecks/episode.ts` still do not commit to the ledger. A `quotaExceeded` from Google stops the feed for the day. Splitting search.list into its own counter is a later L-series PR.

## Apply order

Merge, then apply 088 only after Chris names it. Do not apply it from this PR. Before 088, the routes and the feed see the missing tables and skip. 088 does not edit `lib/stripe`, `lib/payouts`, `lib/billing`, or `lib/airchecks`.

LG2 (PR 97) was still open when this page was written. The settings consent follows that draft's Google and YouTube section. After PR 97 merges, match `/settings/youtube` to the final `/privacy` text.

## Env

Chris sets these in Vercel Production. This PR does not change Vercel env.

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `YOUTUBE_TOKEN_ENC_KEY` (32 random bytes, base64)
- `DEEPGRAM_API_KEY` (named here for AC-TX; AC-TX does not own `.env.example`)

`NEXT_PUBLIC_SITE_URL` is already the redirect host. The callback is always `${NEXT_PUBLIC_SITE_URL}/api/youtube/callback`.

## Follow-ups

- A link to `/settings/youtube` from show settings (that edits an existing screen).
- Reconnect reminder email for Testing-mode creators.
- Brand-facing delivery report, after consent and the derived-metric question. `share_with_brand` is stored and this job shows captions and analytics to no brand.
- A connected channel is not show-ownership verification. The log event is `youtube.channel_connected` only.
- Track search.list calls apart from other Data API units.
- The cron route still has its own bearer check.
