-- Wave 7: Media plan builder persistence
-- Stores per-campaign plan: default placement, default episodes, spacing,
-- and per-show line items (placement + episodes). Derived financials are
-- recomputed on render from scored_shows + these choices.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS media_plan JSONB DEFAULT NULL;
