-- ============================================================
-- Migration 029 — Phase 2C Layer 5: portfolio override INPUTS.
--
-- Layer 5 lets the brand reshape the test/scale split with three overrides:
--   1. campaign-level spot-count (default 3)         -> campaigns.test_spot_count
--   2. placement (campaign default + per-show)       -> campaigns.test_placement
--                                                       + conviction_scores.placement_override
--   3. per-show CPM edit                             -> conviction_scores.cpm_override_cents
--
-- These are the durable override *inputs* (system of record for what the brand
-- chose). They are kept SEPARATE from the recomputed cost/tier cache on
-- conviction_scores (per_spot_cents / three_spot_cents / cpm_used_cents /
-- cost_basis / tier — migration 028), because a campaign-level recompute
-- re-derives that cache across the whole universe and would otherwise clobber a
-- per-show edit. The recompute reads inputs + band tables -> rewrites the cache.
--   - effective spot count = campaigns.test_spot_count ?? 3
--   - effective placement  = placement_override ?? campaigns.test_placement ?? 'midroll'
--   - effective CPM        = cpm_override_cents ?? band-derived
-- Reset-to-default clears every input (null) -> recompute -> derived cost at
-- mid-roll, 3 spots.
--
-- Campaign-level overrides live on `campaigns` (NOT campaign_patterns) so the
-- brand's test config survives a discovery re-run, which mints a new pattern.
-- Per-show overrides live on `conviction_scores` (per-pattern grain; a full
-- re-discovery legitimately resets them). Per-show values are written to ALL of
-- a show's ring rows, same as the 028 cost columns.
--
-- Idempotent per the required pattern. No new grant block needed: `campaigns`
-- (migration <=005) and `conviction_scores` (grants in migration 020) are both
-- grandfathered, and Postgres table-level grants cover columns added later.
-- 028 is conviction cost/curation; this is 029.
--
-- Nullable + code-default (NOT a NOT NULL DEFAULT): null means "untouched / use
-- default", avoids a backfill rewrite on existing rows, and reset writes null.
-- ============================================================

-- ---- Campaign-level test overrides ----
alter table public.campaigns
  add column if not exists test_spot_count integer,
  add column if not exists test_placement  text;

-- spot count: a sane positive range (a podcast test is 1-3 spots; cap generous).
alter table public.campaigns
  drop constraint if exists campaigns_test_spot_count_chk;
alter table public.campaigns
  add  constraint campaigns_test_spot_count_chk
  check (test_spot_count is null or (test_spot_count >= 1 and test_spot_count <= 12));

-- placement: the discovery vocabulary (preroll/midroll/postroll), NOT the Wave 7
-- hyphenated form — mapping to Wave 7 happens at the media-plan handoff boundary.
alter table public.campaigns
  drop constraint if exists campaigns_test_placement_chk;
alter table public.campaigns
  add  constraint campaigns_test_placement_chk
  check (test_placement is null or test_placement in ('preroll','midroll','postroll'));

-- ---- Per-show overrides (written to every ring row for a show) ----
alter table public.conviction_scores
  add column if not exists cpm_override_cents integer,
  add column if not exists placement_override text;

-- a CPM override is a real (positive) rate the brand supplied; null = derive.
alter table public.conviction_scores
  drop constraint if exists conviction_scores_cpm_override_chk;
alter table public.conviction_scores
  add  constraint conviction_scores_cpm_override_chk
  check (cpm_override_cents is null or cpm_override_cents > 0);

alter table public.conviction_scores
  drop constraint if exists conviction_scores_placement_override_chk;
alter table public.conviction_scores
  add  constraint conviction_scores_placement_override_chk
  check (placement_override is null or placement_override in ('preroll','midroll','postroll'));
