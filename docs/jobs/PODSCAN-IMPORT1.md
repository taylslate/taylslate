# PODSCAN-IMPORT1: Local Podscan catalog import

One local command pulls Podscan shows worth keeping into two internal tables. Brands cannot read those tables. This lane does not write `public.shows`, does not add columns to `shows`, and does not set `shows.contact_email`.

Migration `093_podscan_import.sql` is in the repo only. It is not applied. Apply it only after merge and Chris's OK. Do not run `--commit` until 093 is applied and Chris picks the floor.

PODSCAN-CUTOVER1 decides how any of this reaches shows or discovery.

## Keep rule

1. A show with a sponsor seen in the last 12 months is kept, whatever the audience number. Audience 0 or null still stays. A missing audience never passes a floor by itself.
2. No sponsor in 12 months: keep only at or above the floor. The dry run counts 1000, 2500, and 5000. The write run takes `--floor` and `--confirm` equal to that floor's kept count.
3. Every kept show needs an email check. Store Podscan `reach.email` and the `itunes:owner` / `itunes:email` value from the RSS feed. `reach.feed_email` is left unused. The same address from both sources is stored once per source.
4. `podscan_audience_estimate` is an internal estimate only. It is never shown, and it is not downloads.

## Search

Podscan search requires `query`. `*` returns no rows. Every search sends:

`a OR b OR c OR d OR e OR f OR g OR h OR i OR j OR k OR l OR m OR n OR o OR p OR q OR r OR s OR t OR u OR v OR w OR x OR y OR z`

Two passes: `has_sponsors=true` with no audience filter, then `has_sponsors=false` with `min_audience_size=1000`. If a slice reports 10,000 or more, it is split by audience band, then by category, until the slice is under 10,000. A category that is still at the cap is logged in the dry-run report and the run keeps going. Rows are deduped by `podcast_id`. `is_duplicate` is dropped.

## Rate limits

Podscan is throttled to 100 calls per minute under the live `X-RateLimit-Limit` of 120, with concurrency 2. A 429 waits on `Retry-After` and on `X-RateLimit-Remaining`. The per-run budget defaults to 4500 (`--max-podscan-calls`). A daily-limit 429 stops, saves the checkpoint, and prints:

`Daily Podscan limit reached. Re-run the same command tomorrow to resume.`

Apple lookup is 20 calls per minute. A 403 or 429 backs off from 30 seconds, doubling, up to 5 minutes, for 5 tries.

`GET /podcasts/{id}` is skipped when the search hit already has `listener_engagement`.

## How to run

Dry run (default). No database writes:

```
npm run podscan:import -- --dry-run --sample 25
```

A sample is not the catalog. The full dry run omits `--sample`.

Write run, only after 093 is applied and the dry-run count is known:

```
npm run podscan:import -- --commit --floor 1000 --confirm=<kept count at 1000>
```

`--confirm` must equal the kept count for that floor. A second run upserts the same keys and does not insert duplicates.

Resume: re-run the same command. The checkpoint is `.podscan-import/checkpoint.json` (gitignored, mode 0600). Candidate, probe, and contact data older than 7 days is fetched again. Enrichment already stored for a podcast id is kept when that id is still in the set.

## Tables

`public.podscan_catalog` and `public.show_contacts`. service_role only. RLS on, no policy, no function, no view. `show_id` is set only when exactly one `shows` row has the same `podscan_id`. That is a data link, not a trust or ownership tie.

## Known gaps

- No letters a-z. A show whose name and description contain none of the letters a through z is invisible to this query.
- Once the sponsored search is sliced by audience band, a show with a null audience is not returned by those band filters. The unsponsored pass already starts at 1,000, so a null audience was never going to pass that floor.
- `reach.feed_email` is unused. The feed email still comes from `itunes:owner`.
- A category inside one audience band that is still at 10,000 is logged and the run keeps going. That slice is paged only up to the cap.
- `latest_sponsored_at` is filled only for the 20 sponsored shows whose `latest/sponsor` check fetched `posted_at`.
- A rerun upserts current emails. It does not delete an email the source later dropped.
- This lane does not touch `public.shows`.
