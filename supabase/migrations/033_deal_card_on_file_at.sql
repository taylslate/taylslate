-- ============================================================
-- Migration 033: Card-on-file timestamp (Pile A — A3 enrichment)
-- ============================================================
-- Records WHEN the brand's card-on-file landed for a deal. Card presence
-- was previously inferable only from `deals.payment_method_id IS NOT NULL`,
-- with no timestamp — the Pile A plan's A3 requirement explicitly lists a
-- `card_on_file_at` marker. This adds it.
--
--   deals.card_on_file_at  TIMESTAMPTZ, nullable, default null.
--                          Set by the Stripe rail webhook when
--                          `setup_intent.succeeded` fires (server-authoritative,
--                          not the browser confirm). Null until a card is
--                          actually attached, so it doubles as a clean
--                          "ready to charge" signal alongside payment_method_id.
--
-- Idempotent. Re-running is safe.
-- No Data API grant block: `deals` is an existing (grandfathered) table,
-- created in 001_initial_schema.sql — pre-020, covered by the table-level
-- grants in migration 020. Columns added later inherit those grants.

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS card_on_file_at TIMESTAMPTZ;

COMMENT ON COLUMN public.deals.card_on_file_at IS
  'Pile A A3. Timestamp the brand card-on-file was attached to this deal, set by the Stripe rail webhook on setup_intent.succeeded (server-authoritative). Null until a payment method lands; pairs with payment_method_id as the card-on-file / ready-to-charge signal.';
