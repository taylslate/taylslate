-- Wave 13 — pay-as-delivers SetupIntent + payouts.
--
-- Two concerns in one migration:
--
-- 1. Deal-level SetupIntent state. When DocuSign fires `brand_signed` we
--    create a Stripe SetupIntent so the brand can save a card on file
--    against their Stripe Customer. The deal record carries the
--    SetupIntent id + client_secret so the brand UI can confirm it, and
--    the payment_method id once Stripe webhooks back with success.
--
-- 2. Payouts. Show connected accounts get a Stripe Transfer once the
--    brand charge has SETTLED (charge.succeeded webhook flips
--    payments.settled_at). The payouts table records the Transfer id, the
--    show's net amount in cents, and any early-payout fee withheld.
--
-- CRITICAL FINANCIAL INVARIANT (gate on settled_at, not status):
-- The transfer helper in lib/payouts/transfer.ts refuses to fire when
-- payments.settled_at IS NULL. This is enforced in code; the schema here
-- carries the surface that code reads.
--
-- Idempotent per CLAUDE.md Supabase Conventions — every statement is
-- safely re-runnable.

-- ---- Deal columns for the SetupIntent flow ----

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS setup_intent_id            TEXT,
  ADD COLUMN IF NOT EXISTS setup_intent_client_secret TEXT,
  ADD COLUMN IF NOT EXISTS payment_method_id          TEXT;

CREATE INDEX IF NOT EXISTS idx_deals_setup_intent
  ON public.deals(setup_intent_id) WHERE setup_intent_id IS NOT NULL;

-- ---- Payouts table ----

CREATE TABLE IF NOT EXISTS public.payouts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id               UUID NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  stripe_transfer_id       TEXT,
  amount_cents             INTEGER NOT NULL,
  early_payout_fee_cents   INTEGER NOT NULL DEFAULT 0,
  transferred_at           TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One transfer per payment max. Partial unique index so retries that
-- haven't yet stamped the transfer id don't trip the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payouts_payment_id
  ON public.payouts(payment_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_payouts_stripe_transfer_id
  ON public.payouts(stripe_transfer_id) WHERE stripe_transfer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payouts_transferred_at
  ON public.payouts(transferred_at DESC) WHERE transferred_at IS NOT NULL;

-- ---- updated_at trigger (idempotent) ----

DROP TRIGGER IF EXISTS update_payouts_timestamp ON public.payouts;
CREATE TRIGGER update_payouts_timestamp
  BEFORE UPDATE ON public.payouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---- RLS ----
-- Service role does all writes. Brands and shows can SELECT their own
-- payouts via the deal → payment chain.

ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Brand reads own payouts via deal" ON public.payouts;
CREATE POLICY "Brand reads own payouts via deal"
  ON public.payouts FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.payments p
      JOIN public.deals d ON d.id = p.deal_id
      WHERE p.id = payouts.payment_id
        AND (
          d.brand_id = auth.uid()
          OR d.agent_id = auth.uid()
          OR d.agency_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.brand_profiles bp
            WHERE bp.id = d.brand_profile_id AND bp.user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS "Show reads own payouts via show_profile" ON public.payouts;
CREATE POLICY "Show reads own payouts via show_profile"
  ON public.payouts FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.payments p
      JOIN public.deals d ON d.id = p.deal_id
      JOIN public.show_profiles sp ON sp.id = d.show_profile_id
      WHERE p.id = payouts.payment_id
        AND sp.user_id = auth.uid()
    )
  );
