-- Wave 8: Brand conversational onboarding + brand profile entity
-- Each brand user fills out a multi-page onboarding flow that builds a
-- durable profile. Campaigns reference the profile so the scoring engine
-- can pull foundational targeting from it and let campaign briefs override
-- situationally.

CREATE TABLE IF NOT EXISTS public.brand_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Step 2 (free text): brand identity / what the brand sells
  brand_identity      TEXT,
  -- Step 3 (text input): brand website
  brand_website       TEXT,
  -- Step 4 (free text): ideal customer description
  target_customer     TEXT,

  -- Step 5 (age range)
  target_age_min      INT,
  target_age_max      INT,

  -- Step 6 (single select): mostly_men / mostly_women / mixed / no_preference
  target_gender       TEXT CHECK (target_gender IN ('mostly_men', 'mostly_women', 'mixed', 'no_preference')),

  -- Step 7 (multi-select): content category buckets
  content_categories  TEXT[] DEFAULT '{}',

  -- Step 8 (single select): primary campaign goal
  campaign_goal       TEXT CHECK (campaign_goal IN ('direct_sales', 'brand_awareness', 'new_product', 'test_podcast')),

  -- Step 9 (free text, optional): exclusions
  exclusions          TEXT,

  -- Completion timestamp — null until the brand confirms the summary page.
  onboarded_at        TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brand_profiles_user ON public.brand_profiles(user_id);

ALTER TABLE public.brand_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own brand profile"
  ON public.brand_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own brand profile"
  ON public.brand_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own brand profile"
  ON public.brand_profiles FOR UPDATE USING (auth.uid() = user_id);

-- Link campaigns back to the brand profile used to create them.
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS brand_profile_id UUID REFERENCES public.brand_profiles(id) ON DELETE SET NULL;
