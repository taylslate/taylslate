-- ============================================================
-- 037: store the IO gross separately from the brand charge
--
-- A card charge bills the brand the IO rate plus the platform fee.
-- amount_charged_cents is that total. The show is paid the IO gross,
-- so the gross has to live on the payments row on its own. The legacy
-- payments.amount column is the invoice-era dollar amount, not this
-- cents figure.
--
-- Nullable: rows written before this column have no separate gross.
-- The transfer refuses those rather than subtracting the fee from
-- amount_charged_cents. No backfill.
--
-- payments is a pre-020 table. No new table, so no Data API grant
-- block. The new column inherits the table's existing grants.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Safe to re-run.
-- ============================================================

alter table public.payments
  add column if not exists gross_amount_cents integer;

-- Introspection check (run after applying):
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'payments'
--      and column_name = 'gross_amount_cents';
--   Expected: gross_amount_cents | integer | YES
