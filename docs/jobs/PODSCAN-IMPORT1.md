# PODSCAN-IMPORT1: Local Podscan catalog import

One local command pulls Podscan shows worth keeping into two internal tables. Brands cannot read those tables. This lane does not write `public.shows`, does not add columns to `shows`, and does not set `shows.contact_email`.

Migration `093_podscan_import.sql` was applied on 2026-11-20 by apply_migration. Migration `096_podscan_catalog_show_id_idx.sql` is in the repo only. It is not applied. Apply 096 only after merge and Chris's OK.

PODSCAN-CUTOVER1 decides how any of this reaches shows or discovery.

## Keep rule

1. A show with a sponsor seen in the last 12 months is kept, whatever the audience number. Audience 0 or null still stays. A missing audience never passes a floor by itself.
2. No sponsor in 12 months: keep only at or above the floor. The dry run counts 1000, 2500, and 5000. The write run takes `--floor` and `--confirm` equal to that floor's kept count. `--floor-sponsored` also applies that floor to sponsored shows. It is off unless the flag is passed. With the flag, the sponsor probe skips shows under the floor.
3. Every kept show needs an email check. Store Podscan `reach.email` and the `itunes:owner` / `itunes:email` value from the RSS feed. `reach.feed_email` is left unused. Before the syntax check, `mailto:` is stripped, the address is taken from `Name <addr>`, and a comma-separated list is split. The report counts syntax-failure reasons and does not include the addresses. The same address from both sources is stored once per source.
4. `podscan_audience_estimate` is an internal estimate only. It is never shown, and it is not downloads.

## Search

Podscan search requires `query`. `*` returns no rows. Every search sends:

`a OR b OR c OR d OR e OR f OR g OR h OR i OR j OR k OR l OR m OR n OR o OR p OR q OR r OR s OR t OR u OR v OR w OR x OR y OR z`

Two passes: `has_sponsors=true` with no audience filter, then `has_sponsors=false` with `min_audience_size=1000`. If a slice reports 10,000 or more, it is split by audience band, then by category, until the slice is under 10,000. When the sponsored pass is split into audience bands, a second sponsored walk has no audience filter and is sliced by category only. Those rows are merged and deduped with the rest by `podcast_id`. A category that is still at the cap is logged in the dry-run report and the run keeps going. `is_duplicate` is dropped. The report counts kept shows that have no audience number.

## Rate limits

Podscan is throttled to 100 calls per minute under the live `X-RateLimit-Limit` of 120, with concurrency 2. A 429 waits on `Retry-After` and on `X-RateLimit-Remaining`. The per-run budget defaults to 4500 (`--max-podscan-calls`). A daily-limit 429 stops, saves the checkpoint, and prints:

`Daily Podscan limit reached. Re-run the same command tomorrow to resume.`

Apple lookup is 20 calls per minute. A 403 or 429 backs off from 30 seconds, doubling, up to 5 minutes, for 5 tries.

`GET /podcasts/{id}` is skipped when the search hit already has `listener_engagement`.

## Sponsor probe

`POST /podcasts/batch-probe` sends up to 100 podcast ids. The gate retries a timeout or a 5xx first. If that chunk still fails with a timeout that has no HTTP status, or with a 5xx, the chunk is split in half and each half is probed. That repeats down to one id. Each half that succeeds is merged into `checkpoint.probe` and saved before the next call.

A null probe value means no recent sponsor. A single id that still times out or returns 5xx is not stored as null. It is appended to `checkpoint.probeFailed` (duplicates dropped) and the probe continues. The run does not exit on that id.

After the batches, each id still in `probeFailed` gets one `GET /podcasts/{id}/latest/sponsor`, the same call the 20-show check uses. `posted_at` inside 365 days is a recent sponsor, and the episode id is written into `probe`. A 404, or a `posted_at` older than 365 days, is no sponsor (`probe` null). The id is then removed from `probeFailed`. If that GET still fails, the id stays in `probeFailed`. The show does not pass the probe on this run. The next run tries it again.

A 429, including the daily limit, stops the run the same way as before. The chunk is not split. Any other 4xx is not split either. Every extra call uses the same call budget and the 100-per-minute gate. The dry run prints `Probe failed shows: N`. Split calls are included in `Podscan calls used`.

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

`--confirm` must equal the kept count for that floor. The dry run prints `Kept for --floor N` when `--floor` is set, and it prints both the default kept counts and the `--floor-sponsored` counts. It also prints `Podscan calls for these flags`. A second run upserts the same keys and does not insert duplicates. If the write run hits the daily limit or the call budget after the kept set is known, it upserts `podscan_catalog` and `show_contacts` for every chosen show that already has an enrich entry and prints `Upserted N of M. Re-run the same command to continue.` `--confirm` stays the full kept count.

`--no-enrich` skips the demographics, analysis, and podcast detail calls. Listener data already on the search hit is kept. Demographics stay null unless the checkpoint already has them. See `docs/jobs/PODSCAN-IMPORT2.md` for the enrich gate, sponsor history, scoring fields, and the backfill flag. `--partial` with `--commit` writes the current checkpoint and does not finish the search. It still requires `--floor`, `--confirm`, and migration 093.

Resume: re-run the same command. The checkpoint is `.podscan-import/checkpoint.json` (gitignored, mode 0600). A dry run does not drop a finished search or a stale one. `--fresh` is the only flag that drops the saved search, the probe, and `probeFailed`. Search progress is written when a slice finishes, and at most every 60 seconds while a slice is still paging. A probe batch that succeeds is saved before the next batch, including each half of a split. Ids already in `probe` are not sent again. Ids in `probeFailed` are. Contact lookup saves every 500 feeds. Enrichment saves at most every 30 seconds. Enrichment already stored for a podcast id is kept when that id is still in the set.

## Tables

`public.podscan_catalog` and `public.show_contacts`. service_role only. RLS on, no policy, no function, no view. `show_id` is set only when exactly one `shows` row has the same `podscan_id`. That is a data link, not a trust or ownership tie.

## Known gaps

- No letters a-z. A show whose name and description contain none of the letters a through z is invisible to this query.
- The extra sponsored walk has no audience filter and is sliced by category only. A category that is still at 10,000 is logged and paged up to the cap, ordered by audience, so a null audience in that capped category can still be missed. The unsponsored pass starts at 1,000, so a null audience does not pass that floor.
- `reach.feed_email` is unused. The feed email still comes from `itunes:owner`.
- A category inside one audience band that is still at 10,000 is logged and the run keeps going. That slice is paged only up to the cap.
- `latest_sponsored_at` is filled only for the 20 sponsored shows whose `latest/sponsor` check fetched `posted_at`.
- A rerun upserts current emails. It does not delete an email the source later dropped.
- This lane does not touch `public.shows`.
