-- ============================================================
-- Migration 023 — Wave 13 financial-layer reconciliation
-- ============================================================
--
-- WHY THIS EXISTS:
--   A schema audit (during 022) found the Wave 13 financial layer
--   missing from production. Migrations 015, 016, and 018 never executed
--   in this environment ("applied" had been recorded on code shipping,
--   not verified SQL execution). 017 (event_log) is present — it was
--   created out-of-cycle in the 021/022 batch — so this migration treats
--   it as belt-and-suspenders (IF NOT EXISTS, currently a no-op).
--
--   Confirmed missing vs. live state:
--     015  profiles.plan / platform_fee_percentage / seat_count /
--          subscription_status            -> absent
--     016  payments deal_id-centric reshape (still Wave 3 shape)
--     018  deals.setup_intent_id (+2)      -> absent
--          payouts table                   -> absent
--
--   The database is EMPTY (0 rows in every table) as of the audit, so
--   there is no data-migration risk. payments is reshaped in place via
--   ALTERs (faithful to 016 as written), not dropped/recreated.
--
-- IDEMPOTENCY:
--   Safe to re-run. Pasted manually into the Supabase SQL Editor.
--   Tables: CREATE TABLE IF NOT EXISTS. Columns: ADD COLUMN IF NOT EXISTS.
--   Constraints: DROP CONSTRAINT IF EXISTS then ADD. Indexes: IF NOT EXISTS.
--   Triggers/policies: DROP ... IF EXISTS then CREATE.
--
-- DEPENDENCIES (all confirmed present in live schema):
--   profiles, deals, io_line_items, payments, brand_profiles,
--   show_profiles, and the update_updated_at() trigger function (from 001).
-- ============================================================


-- ============================================================
-- SECTION 1 — Migration 015: pricing-tier columns on profiles
-- ============================================================

alter table public.profiles
  add column if not exists plan                    text          not null default 'pay_as_you_go',
  add column if not exists platform_fee_percentage numeric(5,4)  not null default 0.10,
  add column if not exists seat_count              integer       not null default 1,
  add column if not exists subscription_status     text          not null default 'none';

-- CHECK constraints (drop-then-add for idempotency)
alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles
  add constraint profiles_plan_check
  check (plan in ('pay_as_you_go', 'operator', 'agency'));

alter table public.profiles drop constraint if exists profiles_subscription_status_check;
alter table public.profiles
  add constraint profiles_subscription_status_check
  check (subscription_status in ('none', 'active', 'past_due', 'canceled', 'trialing'));

-- NOTE: 015's backfill UPDATEs are intentionally omitted. The columns are
--       added NOT NULL DEFAULT, so any existing rows receive the defaults
--       automatically; the table is empty regardless. Legacy `tier` and the
--       existing stripe_customer_id / stripe_subscription_id (from 001) are
--       left untouched.

create index if not exists idx_profiles_plan
  on public.profiles (plan);
create index if not exists idx_profiles_subscription_status
  on public.profiles (subscription_status);


-- ============================================================
-- SECTION 2 — Migration 016: payments reshape (pay-as-delivers)
--   Faithful in-place ALTER of the existing Wave 3 payments table.
-- ============================================================

-- Relax the legacy Wave 3 NOT NULL (idempotent: no-op if already nullable)
alter table public.payments alter column invoice_id drop not null;

-- Wave 13 columns
alter table public.payments
  add column if not exists deal_id                           uuid,
  add column if not exists io_line_item_id                   uuid,
  add column if not exists stripe_payment_intent_id          text,
  add column if not exists amount_charged_cents              integer,
  add column if not exists application_fee_amount_cents      integer,
  add column if not exists platform_fee_percentage_at_charge numeric(5,4),
  add column if not exists charged_at                        timestamptz,
  add column if not exists settled_at                        timestamptz,
  add column if not exists updated_at                        timestamptz not null default now();

-- FKs (guarded — ADD CONSTRAINT has no IF NOT EXISTS, so drop-then-add)
alter table public.payments drop constraint if exists payments_deal_id_fkey;
alter table public.payments
  add constraint payments_deal_id_fkey
  foreign key (deal_id) references public.deals (id);

alter table public.payments drop constraint if exists payments_io_line_item_id_fkey;
alter table public.payments
  add constraint payments_io_line_item_id_fkey
  foreign key (io_line_item_id) references public.io_line_items (id);

-- Expanded status CHECK (replaces the legacy Wave 3 value set)
alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments
  add constraint payments_status_check
  check (status in ('pending', 'processing', 'succeeded', 'completed', 'failed', 'refunded', 'disputed'));

-- Indexes
create unique index if not exists uniq_payments_stripe_payment_intent_id
  on public.payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
create index if not exists idx_payments_deal
  on public.payments (deal_id)
  where deal_id is not null;
create index if not exists idx_payments_io_line_item
  on public.payments (io_line_item_id)
  where io_line_item_id is not null;
create index if not exists idx_payments_charged_at
  on public.payments (charged_at desc)
  where charged_at is not null;

-- updated_at trigger (function update_updated_at() defined in 001)
drop trigger if exists update_payments_timestamp on public.payments;
create trigger update_payments_timestamp
  before update on public.payments
  for each row execute function public.update_updated_at();

-- RLS policies (verbatim from 016, confirmed against the file).
--   016 ADDS two deal-path SELECT policies. It intentionally leaves the
--   pre-Wave-13 invoice-path policies ("Payments access via deal",
--   "Payments insert via deal") in place so legacy invoice-scoped rows
--   (deal_id NULL) and Wave 13 rows (invoice_id NULL) are both readable.
--   We do NOT drop those legacy policies — dropping them would diverge
--   from 016 and strip the legacy read/insert path. Tightening payments
--   to service-role-writes-only, if wanted, belongs in its own migration.
--   Writes here remain service-role via the admin client (RLS bypassed).
drop policy if exists "Brand reads own payments via deal"      on public.payments;
drop policy if exists "Brand reads own payments via brand_profile" on public.payments;

create policy "Brand reads own payments via deal"
  on public.payments for select
  using (
    deal_id is not null
    and exists (
      select 1 from public.deals d
      where d.id = payments.deal_id
        and (d.brand_id = auth.uid() or d.agent_id = auth.uid() or d.agency_id = auth.uid())
    )
  );

create policy "Brand reads own payments via brand_profile"
  on public.payments for select
  using (
    deal_id is not null
    and exists (
      select 1 from public.deals d
      join public.brand_profiles bp on bp.id = d.brand_profile_id
      where d.id = payments.deal_id
        and bp.user_id = auth.uid()
    )
  );


-- ============================================================
-- SECTION 3 — Migration 018a: SetupIntent fields on deals
-- ============================================================

alter table public.deals
  add column if not exists setup_intent_id            text,
  add column if not exists setup_intent_client_secret text,
  add column if not exists payment_method_id          text;

create index if not exists idx_deals_setup_intent
  on public.deals (setup_intent_id)
  where setup_intent_id is not null;


-- ============================================================
-- SECTION 4 — Migration 018b: payouts table
-- ============================================================

create table if not exists public.payouts (
  id                     uuid        primary key default gen_random_uuid(),
  payment_id             uuid        not null references public.payments (id) on delete restrict,
  stripe_transfer_id     text,
  amount_cents           integer     not null,
  early_payout_fee_cents integer     not null default 0,
  transferred_at         timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index if not exists uniq_payouts_payment_id
  on public.payouts (payment_id);
create unique index if not exists uniq_payouts_stripe_transfer_id
  on public.payouts (stripe_transfer_id)
  where stripe_transfer_id is not null;
create index if not exists idx_payouts_transferred_at
  on public.payouts (transferred_at desc)
  where transferred_at is not null;

drop trigger if exists update_payouts_timestamp on public.payouts;
create trigger update_payouts_timestamp
  before update on public.payouts
  for each row execute function public.update_updated_at();

alter table public.payouts enable row level security;

-- RLS: users read-only via payment -> deal joins. Service role (transfers)
--   bypasses RLS. Policies below are verbatim from 018 (confirmed; the join
--   alias differs cosmetically — pm here vs p in the file).
drop policy if exists "Brand reads own payouts via deal"        on public.payouts;
drop policy if exists "Show reads own payouts via show_profile" on public.payouts;

create policy "Brand reads own payouts via deal"
  on public.payouts for select
  using (
    exists (
      select 1
      from public.payments pm
      join public.deals d on d.id = pm.deal_id
      where pm.id = payouts.payment_id
        and (
          d.brand_id  = auth.uid()
          or d.agent_id  = auth.uid()
          or d.agency_id = auth.uid()
          or exists (
            select 1 from public.brand_profiles bp
            where bp.id = d.brand_profile_id and bp.user_id = auth.uid()
          )
        )
    )
  );

create policy "Show reads own payouts via show_profile"
  on public.payouts for select
  using (
    exists (
      select 1
      from public.payments pm
      join public.deals d on d.id = pm.deal_id
      join public.show_profiles sp on sp.id = d.show_profile_id
      where pm.id = payouts.payment_id
        and sp.user_id = auth.uid()
    )
  );


-- ============================================================
-- SECTION 5 — Migration 017 (belt-and-suspenders): event_log
--   Present in live schema already; IF NOT EXISTS makes this a no-op.
--   Included so 023 fully reconciles the 015-018 range in a DR rebuild.
-- ============================================================

create table if not exists public.event_log (
  id             uuid        primary key default gen_random_uuid(),
  customer_id    uuid        references public.profiles (id) on delete cascade,
  timestamp      timestamptz not null default now(),
  operation_type text        not null,
  metadata       jsonb       not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists idx_event_log_customer_timestamp
  on public.event_log (customer_id, timestamp desc);
create index if not exists idx_event_log_operation_timestamp
  on public.event_log (operation_type, timestamp desc);

alter table public.event_log enable row level security;
-- deny-by-omission: service-role-only metering log, no user policy
drop policy if exists "No user access to event_log" on public.event_log;


-- ============================================================
-- SECTION 6 — Data API grants
--   020 enumerated grants for 23 tables but did NOT include event_log
--   or payouts (both created after 020 was authored). New tables in
--   `public` are not auto-exposed to the Data API post-Oct-30-2026, so
--   these explicit grants are required, not optional.
-- ============================================================

-- payments — re-assert (table is grandfathered; included because 023 reshapes it)
grant select, insert, update, delete on public.payments  to service_role;
grant select, insert, update, delete on public.payments  to authenticated;

-- event_log — service-role-only (audit/metering, same class as domain_events)
grant select, insert, update, delete on public.event_log to service_role;

-- payouts — service role full; users read-only (matches its SELECT-only RLS)
grant select, insert, update, delete on public.payouts   to service_role;
grant select                          on public.payouts   to authenticated;

-- No anon grants on any financial/metering table. Deliberate.
