-- ============================================================
-- Migration 043: shows.surfaces + shows.medium_priors (columns only)
-- ============================================================
-- One show can be a podcast and a long-form YouTube channel. These two
-- JSONB columns hold that without a second shows row.
--
--   shows.surfaces       JSONB, nullable.
--                        Set only when the same show is on both mediums.
--                        Shape:
--                          {
--                            podcast?: {
--                              audience_size, cpm_range: {min, max},
--                              links: {rss}, rate_card, rss_url
--                            },
--                            youtube?: {
--                              audience_size, cpm_range: {min, max},
--                              links: {channel}, rate_card, youtube_channel_id
--                            }
--                          }
--                        Single-medium shows leave it null. Audiences are
--                        stored per medium and are not summed.
--   shows.medium_priors  JSONB, nullable.
--                        Per medium: cpm_min, cpm_max, engagement_weight,
--                        frequency_spots. engagement_weight is recorded at
--                        1 for launch. Scoring does not filter on it.
--
-- Migration 026 added the same two columns. This file is the copy-paste
-- for any database that does not have them yet. ADD COLUMN IF NOT EXISTS
-- is a no-op when 026 already ran; the comments record the shape this
-- code writes.
--
-- Columns only. No backfill, no index, no new table. `shows` is a
-- grandfathered table — column access inherits its grants. No grant block.
--
-- Idempotent. Safe to re-run. Do not treat this file as applied until the
-- introspection check below returns both rows.
--
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'shows'
--      and column_name in ('surfaces', 'medium_priors')
--    order by column_name;

ALTER TABLE public.shows
  ADD COLUMN IF NOT EXISTS surfaces JSONB DEFAULT NULL;

ALTER TABLE public.shows
  ADD COLUMN IF NOT EXISTS medium_priors JSONB DEFAULT NULL;

COMMENT ON COLUMN public.shows.surfaces IS
  'Simulcast: one show on podcast + long-form YouTube. Per medium: audience_size, cpm_range {min,max} dollars, links {rss|channel}, rate_card. Null for a single-medium show. Audiences are not summed.';

COMMENT ON COLUMN public.shows.medium_priors IS
  'Per-medium priors: cpm_min, cpm_max, engagement_weight, frequency_spots. Launch engagement_weight is 1 and is not a discovery filter. Null when unset.';
