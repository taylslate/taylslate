# Taylslate — STATUS

_Volatile snapshot. Updated through Wave 14 Phase 2C Layer 4 + 3.5._

## Current wave
**Wave 14 Phase 2C — Test portfolio + scale tier dual output.** Layers 1, 1b,
2, 3, 3.5, 4 shipped and live. Layer 5 (overrides + recompute) remaining —
optional polish, not GTM-blocking.

## Tests
756 passing. tsc + eslint clean.

## Migration state
001–028 applied and introspected. 028 (per-show cost + tier curation columns on
`conviction_scores`) applied via SQL Editor, confirmed by introspection (8
columns + cost_basis check + `(campaign_pattern_id, tier)` index). The 028 file
in `supabase/migrations/` documents what is live; never re-run.

## What works end to end
`/campaigns/[id]` renders the dual output: test portfolio (selectable, budget
meter), scale tier (watchlist, "deferred" framing), bench (collapsed). CTA
writes selected test-tier IDs to the Wave 7 plan path and navigates. Verified
live in-browser against real campaigns. Rejected-ring leakage closed (3.5) —
filter to confirmed rings before rollup in both persist and read paths.

## 2C deferred (logged in PRODUCT_BACKLOG.md)
- flat_fee meter-vs-plan mismatch — moot at launch (podcast-only discovery);
  Wave 7/2D.
- scale-watchlist not tier-validated; plan-handoff non-atomic double-write —
  both degrade safely.
- Q5 invariant: stale-tier safety relies on "only composite ≥ MEDIUM_FLOOR rows
  persist." If below-floor rows ever persist, the confirmed-ring stale-tier
  case reopens.

## Next
Layer 5 (overrides + recompute: spot-count, placement, per-show CPM) — carries
the Layer 3 request-scope footgun (`tierCampaignPortfolio`'s default
`loadShowsByIds` needs a request scope or admin deps on override re-run).
