-- Wave 6: Add scored_shows and selected_show_ids to campaigns
-- scored_shows stores the full ScoredShow[] JSONB from the scoring engine (ephemeral)
-- selected_show_ids stores which podcast IDs the brand checked in the discovery list

ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS scored_shows JSONB DEFAULT '[]';
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS selected_show_ids TEXT[] DEFAULT '{}';
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS scoring_meta JSONB DEFAULT '{}';
