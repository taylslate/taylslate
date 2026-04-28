-- Wave 13: extend the payments table for the pay-as-delivers Stripe flow.
--
-- Pre-Wave-13 the payments table was invoice-scoped (one row per
-- invoice settlement). Wave 13 charges fire per verified episode delivery
-- and don't go through an invoice — every IO line item that hits its
-- guaranteed downloads triggers a PaymentIntent.
--
-- This migration ADDS the columns Wave 13 needs alongside the legacy
-- columns, preserves invoice-scoped writes by relaxing `invoice_id` to
-- nullable, and extends the status enum with `succeeded` and `disputed`
-- to match Stripe's terminology.
--
-- Idempotent per CLAUDE.md Supabase Conventions.

-- ---- Relax invoice_id to nullable ----
-- Wave 13 charges don't have an invoice, but legacy invoice-driven payments
-- still do. Drop the NOT NULL so both can coexist on the same table.

ALTER TABLE public.payments ALTER COLUMN invoice_id DROP NOT NULL;

-- ---- Wave 13 columns ----

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS deal_id                            UUID REFERENCES public.deals(id),
  ADD COLUMN IF NOT EXISTS io_line_item_id                    UUID REFERENCES public.io_line_items(id),
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id           TEXT,
  ADD COLUMN IF NOT EXISTS amount_charged_cents               INTEGER,
  ADD COLUMN IF NOT EXISTS application_fee_amount_cents       INTEGER,
  ADD COLUMN IF NOT EXISTS platform_fee_percentage_at_charge  NUMERIC(5, 4),
  ADD COLUMN IF NOT EXISTS charged_at                         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settled_at                         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at                         TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ---- Status enum: add `succeeded` and `disputed` ----
-- Stripe's PaymentIntent terminology uses `succeeded`. Keep the legacy
-- values (pending, processing, completed, failed, refunded) so old
-- invoice-scoped rows still validate.

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_status_check
  CHECK (status IN (
    'pending', 'processing', 'succeeded', 'completed',
    'failed', 'refunded', 'disputed'
  ));

-- ---- Uniqueness on stripe_payment_intent_id (idempotent webhook handling) ----
-- Partial unique index so legacy rows with NULL stripe_payment_intent_id
-- don't collide. Wave 13 webhooks rely on this for upsert-by-PI-id.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_payments_stripe_payment_intent_id
  ON public.payments(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- ---- Indexes ----

CREATE INDEX IF NOT EXISTS idx_payments_deal
  ON public.payments(deal_id) WHERE deal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_io_line_item
  ON public.payments(io_line_item_id) WHERE io_line_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_charged_at
  ON public.payments(charged_at DESC) WHERE charged_at IS NOT NULL;

-- ---- updated_at trigger (idempotent) ----

DROP TRIGGER IF EXISTS update_payments_timestamp ON public.payments;
CREATE TRIGGER update_payments_timestamp
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---- RLS policies for the Wave 13 deal-scoped access path ----
-- Pre-Wave-13 RLS already allows brands/agents/agencies to read payments
-- via invoice → IO → deal. Wave 13 charges have NULL invoice_id, so we
-- need a direct deal_id-based policy too. Drop & recreate so re-runs are
-- clean.
--
-- NOTE: deals.brand_id is the canonical column (not brand_user_id). Both
-- agent_id and agency_id are also checked so participants can see the
-- payment record without elevated access.

DROP POLICY IF EXISTS "Brand reads own payments via deal" ON public.payments;
CREATE POLICY "Brand reads own payments via deal"
  ON public.payments FOR SELECT
  USING (
    deal_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.deals d
      WHERE d.id = payments.deal_id
        AND (d.brand_id = auth.uid() OR d.agent_id = auth.uid() OR d.agency_id = auth.uid())
    )
  );

-- Wave 12 brought brand_profile_id onto deals; brands flow through that
-- when the deal originated from an outreach. Mirror the policy.

DROP POLICY IF EXISTS "Brand reads own payments via brand_profile" ON public.payments;
CREATE POLICY "Brand reads own payments via brand_profile"
  ON public.payments FOR SELECT
  USING (
    deal_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.deals d
      JOIN public.brand_profiles bp ON bp.id = d.brand_profile_id
      WHERE d.id = payments.deal_id
        AND bp.user_id = auth.uid()
    )
  );

-- Service role bypasses RLS by default; webhook handler writes use the
-- admin client. No user-facing INSERT/UPDATE policy is added here.
