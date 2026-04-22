-- Wave 9: Show/creator conversational onboarding
-- Each show/creator user fills out an 11-step onboarding flow that captures
-- durable info about their show (cadence, audience size, ad formats,
-- placements, exclusions, etc.) plus the Podscan-enriched metadata from
-- their feed URL. Data lives in show_profiles rather than extending the
-- shows table because:
--   * shows is agent inventory, shared across agents
--   * show_profiles is 1:1 with the authenticated user
--   * the onboarding data doesn't change deal-to-deal; it's "who I am"

CREATE TABLE IF NOT EXISTS public.show_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Step 1: RSS feed or Apple Podcasts URL they pasted
  feed_url            TEXT,

  -- Step 2: Podscan-enriched metadata (editable by the user)
  podscan_id          TEXT,
  show_name           TEXT,
  show_description    TEXT,
  show_image_url      TEXT,
  show_categories     TEXT[] DEFAULT '{}',
  episode_count       INT,

  -- Step 3: podcast / youtube / both
  platform            TEXT CHECK (platform IN ('podcast', 'youtube', 'both')),

  -- Step 4: daily / weekly / biweekly / monthly / irregular
  episode_cadence     TEXT CHECK (episode_cadence IN ('daily', 'weekly', 'biweekly', 'monthly', 'irregular')),

  -- Step 5: avg downloads per episode in the first 30 days
  audience_size       INT,

  -- Step 6: CPM expectation (for education + future pricing)
  expected_cpm        INT,

  -- Step 7: host_read_baked / dynamic_insertion
  ad_formats          TEXT[] DEFAULT '{}',

  -- Step 8: personal_experience / scripted / talking_points / any
  ad_read_types       TEXT[] DEFAULT '{}',

  -- Step 9: pre_roll / mid_roll / post_roll
  placements          TEXT[] DEFAULT '{}',

  -- Step 10: categories this show refuses to advertise
  -- gambling / alcohol / supplements / political / crypto / adult / none
  category_exclusions TEXT[] DEFAULT '{}',

  -- Completion marker — null until confirmed on the summary page.
  onboarded_at        TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_show_profiles_user ON public.show_profiles(user_id);

ALTER TABLE public.show_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own show profile"
  ON public.show_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own show profile"
  ON public.show_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own show profile"
  ON public.show_profiles FOR UPDATE USING (auth.uid() = user_id);
