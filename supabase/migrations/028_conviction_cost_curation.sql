-- ============================================================
-- Migration 028 — Phase 2C: per-show derived cost + tier curation
-- on conviction_scores. Idempotent. No new grants required
-- (table grants from migration 020 cover added columns).
-- 027 is discovery_locks; this is 028.
--
-- NOTE: this file documents columns that are ALREADY applied to the live DB
-- (pasted into the Supabase SQL Editor + introspected). It exists so the repo
-- and the database agree. It is idempotent and safe to re-run, but does not
-- need to be — every statement is a no-op against the live schema.
-- ============================================================

alter table public.conviction_scores
  add column if not exists per_spot_cents    bigint,
  add column if not exists three_spot_cents  bigint,
  add column if not exists cpm_used_cents    integer,
  add column if not exists cost_basis        text,
  add column if not exists cost_is_estimate  boolean,
  add column if not exists needs_quote       boolean default false,
  add column if not exists brand_saved       boolean default false,
  add column if not exists brand_dismissed   boolean default false;

-- cost_basis is a small controlled vocabulary, not a hard enum
-- (keep it text + check so the set can evolve without an enum migration).
alter table public.conviction_scores
  drop constraint if exists conviction_scores_cost_basis_chk;
alter table public.conviction_scores
  add  constraint conviction_scores_cost_basis_chk
  check (cost_basis is null or cost_basis in ('derived','flat_fee','rate_card'));

-- tier already exists (migration 019, ConvictionTier enum: test/scale/dropped),
-- dormant until 2C populates it. No change here — documented for the reader.

-- NOTE: conviction_scores has NO campaign_id column — it links to a campaign
-- via campaign_pattern_id. The tier-lookup index keys on campaign_pattern_id.
create index if not exists conviction_scores_pattern_tier_idx
  on public.conviction_scores (campaign_pattern_id, tier);
