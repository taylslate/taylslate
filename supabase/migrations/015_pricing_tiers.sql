-- Wave 13: pricing tier scaffolding on the profiles table.
--
-- Locks in the three-tier model from PRICING_DECISIONS.md:
--   pay_as_you_go: 10% transaction, no subscription (default for new accounts)
--   operator:     $499/mo + 6% transaction
--   agency:       $5,000/mo + 4% transaction
--
-- Notes:
--   * The legacy `tier` column (free/starter/growth/business from migration 001)
--     is INTENTIONALLY preserved for backwards compatibility with any code
--     still reading it. Do not drop. Wave 13+ writes target `plan` instead.
--   * `stripe_customer_id` and `stripe_subscription_id` already exist on
--     `profiles` from migration 001. Not re-added here.
--   * `platform_fee_percentage` is per-customer and read at every charge
--     (NEVER hardcoded). Default 0.10 matches the PAYG entry rate.
--   * Idempotent per CLAUDE.md Supabase Conventions — every statement is
--     safely re-runnable when pasted into the Supabase SQL Editor.

-- ---- Columns ----

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'pay_as_you_go';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS platform_fee_percentage NUMERIC(5, 4) NOT NULL DEFAULT 0.10;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS seat_count INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'none';

-- ---- Check constraints (drop-then-add so re-runs are clean) ----

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_plan_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_plan_check
  CHECK (plan IN ('pay_as_you_go', 'operator', 'agency'));

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_subscription_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_subscription_status_check
  CHECK (subscription_status IN ('none', 'active', 'past_due', 'canceled', 'trialing'));

-- ---- Backfill ----
-- Defaults already cover newly-inserted rows; this catches any pre-existing
-- rows where the column existed with NULL (e.g. from a partial earlier run).

UPDATE public.profiles
   SET plan = 'pay_as_you_go'
 WHERE plan IS NULL;

UPDATE public.profiles
   SET platform_fee_percentage = 0.10
 WHERE platform_fee_percentage IS NULL;

UPDATE public.profiles
   SET seat_count = 1
 WHERE seat_count IS NULL;

UPDATE public.profiles
   SET subscription_status = 'none'
 WHERE subscription_status IS NULL;

-- ---- Indexes ----
-- Plan lookups drive billing operations; subscription_status drives the
-- conversion-alert and dunning flows in Wave 13.

CREATE INDEX IF NOT EXISTS idx_profiles_plan
  ON public.profiles(plan);

CREATE INDEX IF NOT EXISTS idx_profiles_subscription_status
  ON public.profiles(subscription_status);
