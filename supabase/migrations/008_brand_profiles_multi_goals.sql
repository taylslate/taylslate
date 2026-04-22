-- Wave 8 patch: campaign_goal -> campaign_goals (multi-select, 1-3)
-- The onboarding goals step is now multi-select. Migrate the single-value
-- column into an array, backfilling existing rows, then drop the old column.

ALTER TABLE public.brand_profiles
  ADD COLUMN IF NOT EXISTS campaign_goals TEXT[] DEFAULT '{}';

-- Backfill: wrap any existing single goal into a one-element array.
UPDATE public.brand_profiles
SET campaign_goals = ARRAY[campaign_goal]
WHERE campaign_goal IS NOT NULL
  AND (campaign_goals IS NULL OR cardinality(campaign_goals) = 0);

ALTER TABLE public.brand_profiles
  DROP COLUMN IF EXISTS campaign_goal;
