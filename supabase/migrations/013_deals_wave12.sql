-- Wave 12: extend the deals table to track outreach-driven, DocuSign-signed
-- IOs end-to-end. Old fields stay for legacy / agent-imported deals from
-- pre-Wave-11 work; new fields are populated only when a deal is created
-- from an accepted outreach.
--
-- All statements are idempotent so this migration is safe to re-run.

-- ---- Add new columns ----

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS outreach_id              UUID REFERENCES public.outreaches(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS brand_profile_id         UUID REFERENCES public.brand_profiles(id),
  ADD COLUMN IF NOT EXISTS show_profile_id          UUID REFERENCES public.show_profiles(id),
  ADD COLUMN IF NOT EXISTS agreed_cpm               NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS agreed_episode_count     INT,
  ADD COLUMN IF NOT EXISTS agreed_placement         TEXT,
  ADD COLUMN IF NOT EXISTS agreed_flight_start      DATE,
  ADD COLUMN IF NOT EXISTS agreed_flight_end        DATE,
  ADD COLUMN IF NOT EXISTS docusign_envelope_id     TEXT,
  ADD COLUMN IF NOT EXISTS brand_signed_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS show_signed_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signed_io_pdf_url        TEXT,
  ADD COLUMN IF NOT EXISTS signature_certificate_url TEXT,
  ADD COLUMN IF NOT EXISTS brand_reminder_sent_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason      TEXT;

-- ---- Expand the status enum ----
-- Wave 1's CHECK only allowed (planning, io_sent, live, completed, etc.).
-- Wave 12 adds (brand_signed, show_signed, delivering, cancelled) — the
-- DocuSign signing lifecycle plus an explicit cancelled state.

ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_status_check;
ALTER TABLE public.deals
  ADD CONSTRAINT deals_status_check
  CHECK (status IN (
    'planning', 'io_sent', 'brand_signed', 'show_signed',
    'live', 'delivering', 'completed', 'cancelled',
    'proposed', 'negotiating', 'approved', 'signed' -- legacy values from migration 001
  ));

-- ---- Indexes ----

CREATE UNIQUE INDEX IF NOT EXISTS uniq_deals_outreach_id
  ON public.deals(outreach_id) WHERE outreach_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_brand_profile  ON public.deals(brand_profile_id);
CREATE INDEX IF NOT EXISTS idx_deals_show_profile   ON public.deals(show_profile_id);
CREATE INDEX IF NOT EXISTS idx_deals_status_v12     ON public.deals(status);
CREATE INDEX IF NOT EXISTS idx_deals_envelope       ON public.deals(docusign_envelope_id) WHERE docusign_envelope_id IS NOT NULL;

-- ---- updated_at trigger (idempotent) ----
-- Trigger already exists from migration 001 (update_deals_timestamp). Drop &
-- recreate so this migration is re-runnable without erroring.

DROP TRIGGER IF EXISTS update_deals_timestamp ON public.deals;
CREATE TRIGGER update_deals_timestamp
  BEFORE UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---- RLS — additional policies for the Wave 12 access paths ----
-- Original policies (migration 001) check brand_id/agent_id/agency_id directly.
-- Wave 12 deals are created by Taylslate via the service role on outreach
-- accept; user access flows through brand_profiles/show_profiles. Drop &
-- recreate so re-runs are clean.

DROP POLICY IF EXISTS "Brand reads own deals via brand_profile" ON public.deals;
CREATE POLICY "Brand reads own deals via brand_profile"
  ON public.deals FOR SELECT
  USING (
    brand_profile_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.brand_profiles bp
      WHERE bp.id = deals.brand_profile_id AND bp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Brand updates own deals via brand_profile" ON public.deals;
CREATE POLICY "Brand updates own deals via brand_profile"
  ON public.deals FOR UPDATE
  USING (
    brand_profile_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.brand_profiles bp
      WHERE bp.id = deals.brand_profile_id AND bp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Show reads own deals via show_profile" ON public.deals;
CREATE POLICY "Show reads own deals via show_profile"
  ON public.deals FOR SELECT
  USING (
    show_profile_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.show_profiles sp
      WHERE sp.id = deals.show_profile_id AND sp.user_id = auth.uid()
    )
  );

-- ---- Storage bucket policies ----
-- The "signed-ios" bucket was created manually in the Supabase dashboard.
-- Service role does all reads/writes — webhook handler uploads signed PDFs,
-- API routes serve them via short-lived signed URLs. No direct user access.

DROP POLICY IF EXISTS "Service role full access to signed-ios" ON storage.objects;
CREATE POLICY "Service role full access to signed-ios"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'signed-ios')
  WITH CHECK (bucket_id = 'signed-ios');
