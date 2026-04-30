-- ============================================================
-- Migration 019: Discovery Agent Foundation (Wave 14 Phase 1)
-- ============================================================
-- Adds the pattern library — the structured data asset that compounds
-- with every campaign — and a `brand_history` field on show_profiles
-- so shows can self-report their top advertiser categories at onboarding.
--
-- Tables added:
--   campaign_patterns       — one row per campaign, captures the brief
--                              decomposition + product attributes the
--                              system reasoned over
--   ring_hypotheses         — per campaign, 1 primary + 2-4 lateral
--                              candidate rings with confidence and
--                              reasoning. Survives even when a campaign
--                              is abandoned (training data).
--   conviction_scores       — per (campaign, show) pair, the three-
--                              dimensional conviction with reasoning
--                              text. Replaces flat fit_score over time.
--   analog_matches          — per campaign, which historical campaigns
--                              the LLM matched against and why.
--   founder_annotations     — Chris's manual labels on shows. Free text
--                              "why this show is worth picking" or
--                              "why this show is wrong-ring." Used as
--                              context for future ring location.
--
-- Columns added:
--   show_profiles.brand_history       — JSONB. Self-reported top brand
--                                        categories + annual deals.
--   shows.audience_purchase_power     — INT 0-100. Estimated purchase
--                                        power score for high-AOV scoring.
--                                        Populated lazily / future ML.
--
-- All idempotent. Re-running this migration is safe.

-- ====================
-- Pattern library: campaign_patterns
-- ====================

CREATE TABLE IF NOT EXISTS campaign_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  -- Product attribute snapshot at campaign time. JSON because attributes
  -- evolve; we don't want to migrate every time we capture a new field.
  product_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Customer description in brand's own words. Free text. The interpretive
  -- agent reasons over this; future embedding retrieval indexes on it.
  customer_description TEXT,
  -- Inferred AOV bucket: 'low' (<$200), 'mid' ($200-$1000), 'high' ($1000+)
  aov_bucket TEXT CHECK (aov_bucket IN ('low', 'mid', 'high')),
  -- Snapshot of weights actually used for scoring this campaign. Lets us
  -- A/B test weight schemes and learn over time.
  scoring_weights JSONB
);

CREATE INDEX IF NOT EXISTS idx_campaign_patterns_customer
  ON campaign_patterns(customer_id);
CREATE INDEX IF NOT EXISTS idx_campaign_patterns_campaign
  ON campaign_patterns(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_patterns_aov
  ON campaign_patterns(aov_bucket);

ALTER TABLE campaign_patterns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage all campaign_patterns"
  ON campaign_patterns;
CREATE POLICY "Service role can manage all campaign_patterns"
  ON campaign_patterns FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ====================
-- Pattern library: ring_hypotheses
-- ====================

CREATE TABLE IF NOT EXISTS ring_hypotheses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_pattern_id UUID REFERENCES campaign_patterns(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  -- 'primary' is the AI's main read. 'lateral' is a candidate ring offered
  -- as alternative interpretation. 'confirmed' is the brand's chosen ring.
  kind TEXT NOT NULL CHECK (kind IN ('primary', 'lateral', 'confirmed')),
  -- Short label like "biohacking-adjacent wellness" or "performance recovery"
  label TEXT NOT NULL,
  -- Free-text reasoning for why this ring fits the product
  reasoning TEXT,
  -- 'high', 'medium', 'low', 'speculative'
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'speculative')),
  -- Numeric confidence 0-100 if produced by the LLM
  confidence_score INT CHECK (confidence_score BETWEEN 0 AND 100),
  -- Brand confirmed (TRUE), rejected (FALSE), or hasn't responded (NULL)
  brand_confirmed BOOLEAN
);

CREATE INDEX IF NOT EXISTS idx_ring_hypotheses_pattern
  ON ring_hypotheses(campaign_pattern_id);
CREATE INDEX IF NOT EXISTS idx_ring_hypotheses_kind
  ON ring_hypotheses(kind);

ALTER TABLE ring_hypotheses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage all ring_hypotheses"
  ON ring_hypotheses;
CREATE POLICY "Service role can manage all ring_hypotheses"
  ON ring_hypotheses FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ====================
-- Pattern library: conviction_scores
-- ====================

CREATE TABLE IF NOT EXISTS conviction_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_pattern_id UUID REFERENCES campaign_patterns(id) ON DELETE CASCADE,
  show_id UUID REFERENCES shows(id) ON DELETE CASCADE,
  ring_hypothesis_id UUID REFERENCES ring_hypotheses(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  -- Three-dimensional conviction (0-100 each)
  audience_fit_score INT CHECK (audience_fit_score BETWEEN 0 AND 100),
  topical_relevance_score INT CHECK (topical_relevance_score BETWEEN 0 AND 100),
  purchase_power_score INT CHECK (purchase_power_score BETWEEN 0 AND 100),
  -- Composite conviction (0-100). Computed by scoring engine; stored for
  -- reproducibility — weights may change later but stored composite is
  -- what was shown to the brand.
  composite_score INT CHECK (composite_score BETWEEN 0 AND 100),
  -- Conviction band the UI surfaces
  conviction_band TEXT CHECK (conviction_band IN ('high', 'medium', 'low', 'speculative')),
  -- Free-text reasoning surfaced to the brand
  reasoning TEXT,
  -- Was this show in the test portfolio, scale tier, or filler/dropped?
  tier TEXT CHECK (tier IN ('test', 'scale', 'dropped'))
);

CREATE INDEX IF NOT EXISTS idx_conviction_scores_pattern
  ON conviction_scores(campaign_pattern_id);
CREATE INDEX IF NOT EXISTS idx_conviction_scores_show
  ON conviction_scores(show_id);
CREATE INDEX IF NOT EXISTS idx_conviction_scores_tier
  ON conviction_scores(tier);

ALTER TABLE conviction_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage all conviction_scores"
  ON conviction_scores;
CREATE POLICY "Service role can manage all conviction_scores"
  ON conviction_scores FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ====================
-- Pattern library: analog_matches
-- ====================

CREATE TABLE IF NOT EXISTS analog_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_pattern_id UUID REFERENCES campaign_patterns(id) ON DELETE CASCADE,
  -- Free text — name of the analog brand/product the AI matched against.
  -- Examples: "Plunge", "Therabody", "Higher Dose"
  analog_name TEXT NOT NULL,
  -- Why this analog. Free text reasoning.
  reasoning TEXT,
  -- 0-100 similarity score
  similarity_score INT CHECK (similarity_score BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analog_matches_pattern
  ON analog_matches(campaign_pattern_id);
CREATE INDEX IF NOT EXISTS idx_analog_matches_name
  ON analog_matches(analog_name);

ALTER TABLE analog_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage all analog_matches"
  ON analog_matches;
CREATE POLICY "Service role can manage all analog_matches"
  ON analog_matches FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ====================
-- Founder annotations on shows
-- ====================

CREATE TABLE IF NOT EXISTS founder_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id UUID REFERENCES shows(id) ON DELETE CASCADE,
  -- Who wrote it (Chris initially; later other admins/agents)
  author_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  -- Free-text observation. Examples:
  --   "More faith-based than seems on the surface — host is conservative
  --    Christian, audience over-indexes on faith communities"
  --   "Host personally uses cold plunge, talks about it organically"
  --   "Audience overlap with Therabody listeners ~60%, recovery converters"
  note TEXT NOT NULL,
  -- Optional category tags for retrieval. Free strings.
  tags JSONB DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_founder_annotations_show
  ON founder_annotations(show_id);

ALTER TABLE founder_annotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage all founder_annotations"
  ON founder_annotations;
CREATE POLICY "Service role can manage all founder_annotations"
  ON founder_annotations FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ====================
-- show_profiles.brand_history (self-reported)
-- ====================

ALTER TABLE show_profiles
  ADD COLUMN IF NOT EXISTS brand_history JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN show_profiles.brand_history IS
  'Self-reported list of top advertisers and categories. Shape: [{brand_name, category, deal_type (one-off|annual), notes}]. Used as conviction signal in discovery.';

-- ====================
-- shows.audience_purchase_power (estimated)
-- ====================

ALTER TABLE shows
  ADD COLUMN IF NOT EXISTS audience_purchase_power INT
  CHECK (audience_purchase_power BETWEEN 0 AND 100);

COMMENT ON COLUMN shows.audience_purchase_power IS
  'Estimated audience purchase power 0-100. Populated lazily by enrichment + future ML. Heavier weight in scoring for high-AOV products.';

-- ====================
-- Done
-- ====================
