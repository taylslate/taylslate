-- Wave 11: Outreach
-- A brand sends a personalized pitch to a show with proposed deal terms.
-- The show responds via a tokenized public pitch page (accept/counter/decline).
-- This is the bridge between discovery (Wave 6) and IO generation (Wave 12+).

CREATE TABLE IF NOT EXISTS public.outreaches (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Sender (the brand)
  brand_profile_id         UUID NOT NULL REFERENCES public.brand_profiles(id) ON DELETE CASCADE,
  campaign_id              UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,

  -- Receiver (the show). Either references shows.id (onboarded/imported) or a
  -- raw Podscan id when the show is ephemeral. Nullable FK keeps both shapes.
  show_id                  UUID REFERENCES public.shows(id) ON DELETE SET NULL,
  podscan_id               TEXT,
  show_name                TEXT NOT NULL,

  -- Proposed deal terms (what the brand is offering)
  proposed_cpm             NUMERIC(8, 2) NOT NULL,
  proposed_episode_count   INT NOT NULL,
  proposed_placement       TEXT NOT NULL CHECK (proposed_placement IN ('pre-roll', 'mid-roll', 'post-roll')),
  proposed_flight_start    DATE NOT NULL,
  proposed_flight_end      DATE NOT NULL,

  -- The editable pitch body the brand sent
  pitch_body               TEXT NOT NULL,

  -- Send metadata
  sent_at                  TIMESTAMPTZ,
  sent_to_email            TEXT NOT NULL,

  -- Response state
  response_status          TEXT NOT NULL DEFAULT 'pending'
                             CHECK (response_status IN ('pending', 'accepted', 'countered', 'declined', 'no_response')),
  responded_at             TIMESTAMPTZ,
  counter_cpm              NUMERIC(8, 2),
  counter_message          TEXT,
  decline_reason           TEXT,

  -- Token signature stored for auditing only — verification is by HMAC at request
  -- time, never by DB lookup. Unique so we can spot replay or duplicate inserts.
  token                    TEXT NOT NULL UNIQUE,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Brand can't send two outreaches for the same show in the same campaign.
  CONSTRAINT outreaches_unique_per_campaign_show UNIQUE (campaign_id, show_id, podscan_id)
);

CREATE INDEX IF NOT EXISTS idx_outreaches_brand        ON public.outreaches(brand_profile_id);
CREATE INDEX IF NOT EXISTS idx_outreaches_campaign     ON public.outreaches(campaign_id);
CREATE INDEX IF NOT EXISTS idx_outreaches_show         ON public.outreaches(show_id);
CREATE INDEX IF NOT EXISTS idx_outreaches_email        ON public.outreaches(sent_to_email);
CREATE INDEX IF NOT EXISTS idx_outreaches_status       ON public.outreaches(response_status);

CREATE TRIGGER update_outreaches_timestamp
  BEFORE UPDATE ON public.outreaches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.outreaches ENABLE ROW LEVEL SECURITY;

-- Brands read/write their own outreach (via the brand_profile they own).
CREATE POLICY "Brand reads own outreach"
  ON public.outreaches FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.brand_profiles bp
      WHERE bp.id = outreaches.brand_profile_id
        AND bp.user_id = auth.uid()
    )
  );

CREATE POLICY "Brand inserts own outreach"
  ON public.outreaches FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.brand_profiles bp
      WHERE bp.id = outreaches.brand_profile_id
        AND bp.user_id = auth.uid()
    )
  );

CREATE POLICY "Brand updates own outreach"
  ON public.outreaches FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.brand_profiles bp
      WHERE bp.id = outreaches.brand_profile_id
        AND bp.user_id = auth.uid()
    )
  );

-- Shows can read outreach addressed to their email (once they've onboarded).
-- Match on the auth user's email column in profiles.
CREATE POLICY "Show reads outreach to their email"
  ON public.outreaches FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'show'
        AND lower(p.email) = lower(outreaches.sent_to_email)
    )
  );
