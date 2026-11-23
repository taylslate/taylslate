# PODSCAN-IMPORT2

Same local command as PODSCAN-IMPORT1. The checkpoint already on disk resumes without `--fresh`. Search params, slicing, and the queue are unchanged.

Migration `097_podscan_catalog_scoring_fields.sql` is NOT applied. The CEO must name 097 before anyone applies it. A commit prints `Migration 097 is not applied.` and writes nothing until those columns exist.

## Listener data with --no-enrich

`--no-enrich` skips demographics, analysis, and the podcast detail call. The catalog keeps `listener_engagement` from the search hit. Demographics stay null unless that show already has an enrich entry in the checkpoint.

## Fields saved from search

Each new search hit stores `podcast_reach_score` and the `brand_safety` object. That uses the search response already in hand. No extra Podscan call. Rows saved before this code do not grow those fields during search. They stay null until the backfill below. The search is not run again to fill them.

## Enrich gate

One gate decides which kept shows get enrich calls.

- `--enrich-min-audience N` compares Podscan `reach.audience_size`.
- `--enrich-min-panel-listeners M` compares `listener_engagement.total_listeners`.
- A kept show qualifies when audience is at least N, or panel listeners are at least M.
- Either flag works on its own. A missing audience does not pass the audience flag. A missing panel count does not pass the panel flag.
- With neither flag, every kept show is enriched.

Shows that do not qualify are still written. They keep the search listener data, the reach score, brand safety, and their contacts. If a commit hits the daily Podscan limit during enrich, those shows and their contact rows are upserted on that run. Qualifying shows are written once their enrich entry includes the analysis result.

## Analysis

A qualifying show calls `GET /podcasts/{id}/analysis` in addition to demographics. The stored `sponsor_history` is the sponsor list (name and episode count) plus the episode counts on that response. A 404 is stored as null. Guests, hosts, urls, and product names are not stored.

An enrich entry written by the older code has demographics and listener data only. Resume calls analysis for that show and does not repeat the demographics call.

The dry run line `Podscan calls for these flags` and the write-run day counts include the analysis call, and they leave out shows the gate skips.

## Backfill

`--backfill-scoring-fields` runs only after search, probe, contacts, and gated enrich have finished and the catalog write has succeeded. It fills `podcast_reach_score` and `brand_safety` for kept shows whose checkpoint rows do not have those fields yet.

Order: gated kept shows first, highest audience first, then the other kept shows, highest audience first. Shows that fail the keep rule are not called.

Each show starts with `GET /podcasts/{id}`. That response is the podcast object, the same shape as a search hit. If that call 404s or returns no `brand_safety`, the run calls `GET /podcasts/{id}/brand-safety` once before it saves, and stores that response's aggregation object. A show is marked done with nulls only after that second call. The backfill only targets rows saved before the reach score and brand safety fields existed, so a new search hit with an explicit null is not retried.

Each finished show is upserted before the next call. A small `scoring-backfill.json` file records the show. The main checkpoint is saved on the same 30 second cadence as enrich, and again when the run stops. A daily limit or the call budget stops the backfill the same way enrich stops. Already upserted shows stay. A later run continues with the rest.

A commit without the flag does not run this phase. The dry run prints `Backfill scoring calls` and `Backfill scoring days` on their own lines when the flag is on, and `Backfill scoring: off` when it is not. Those numbers are not added to `Podscan calls for these flags`.

## Commands

Must-have commit. `--floor-sponsored` stays off because the flag is omitted. `--confirm` is the kept count for floor 1000, not the enrich count.

```
npm run podscan:import -- --commit --floor 1000 --confirm=<kept count at 1000> --enrich-min-audience 5000 --enrich-min-panel-listeners 10
```

Follow-on backfill, after that commit has finished:

```
npm run podscan:import -- --commit --floor 1000 --confirm=<kept count at 1000> --enrich-min-audience 5000 --enrich-min-panel-listeners 10 --backfill-scoring-fields
```

Apply migration 097 only after the CEO names it, before either commit.
