-- ============================================================
-- 099: deal price records
--
-- NOT APPLIED LIVE, CHRIS MUST NAME IT.
-- Do not run this from the app, a seed script, or a deploy hook.
-- Paste it into the Supabase SQL Editor only after Chris names it.
--
-- One row per booked deal. The price, terms, unit, and date columns
-- are written once when the deal is booked. Outcome and rebook
-- columns are filled in later. A trigger rejects updates to the
-- snapshot columns.
--
-- RLS is on. service_role has select, insert, update, and delete.
-- authenticated has select only. anon and public have nothing.
-- The select policy mirrors the deals select policies: auth.uid()
-- is the legacy brand, agent, or agency, or the user on the brand
-- profile, or the user on the show profile. There is no
-- authenticated insert, update, or delete policy.
--
-- Idempotent. Safe to re-run. No backfill.
--
-- Introspection (run after applying, read only):
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'deal_price_records'
--    order by ordinal_position;
--   select conname
--     from pg_constraint
--    where conrelid = 'public.deal_price_records'::regclass
--    order by conname;
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'deal_price_records'
--      and grantee in ('anon', 'authenticated', 'PUBLIC', 'service_role')
--    order by grantee, privilege_type;
--   Expected: anon and PUBLIC have no rows. authenticated has
--   SELECT only. service_role has SELECT, INSERT, UPDATE, DELETE.
--   select polname, polcmd
--     from pg_policy
--    where polrelid = 'public.deal_price_records'::regclass
--    order by polname;
--   Expected: one SELECT policy, no insert, update, or delete policy.
-- ============================================================

create table if not exists public.deal_price_records (
  id                        uuid primary key default gen_random_uuid(),
  deal_id                   uuid not null,
  io_id                     uuid,
  io_number                 text,
  brand_profile_id          uuid,
  brand_id                  uuid,
  show_id                   uuid,
  agreed_total_gross        numeric(12,2),
  agreed_total_net          numeric(12,2),
  pricing_basis             text,
  unit_rate                 numeric(12,4),
  medium                    text,
  unit_format               text,
  placement                 text,
  unit_count                integer,
  guaranteed_impressions    integer,
  terms                     jsonb not null default '{}'::jsonb,
  flight_start              date,
  flight_end                date,
  booked_at                 timestamptz not null default now(),
  signed_io_pdf_url         text,
  delivered_units           integer not null default 0,
  delivered_at              timestamptz,
  make_good_count           integer not null default 0,
  make_good_credit_total    numeric(12,2) not null default 0,
  actual_downloads          integer,
  reported_conversions      integer,
  outcome_status            text not null default 'booked',
  outcome_updated_at        timestamptz,
  prior_record_id           uuid,
  rebook_sequence           integer not null default 1,
  rebooked                  boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

alter table public.deal_price_records add column if not exists io_id uuid;
alter table public.deal_price_records add column if not exists io_number text;
alter table public.deal_price_records add column if not exists brand_profile_id uuid;
alter table public.deal_price_records add column if not exists brand_id uuid;
alter table public.deal_price_records add column if not exists show_id uuid;
alter table public.deal_price_records add column if not exists agreed_total_gross numeric(12,2);
alter table public.deal_price_records add column if not exists agreed_total_net numeric(12,2);
alter table public.deal_price_records add column if not exists pricing_basis text;
alter table public.deal_price_records add column if not exists unit_rate numeric(12,4);
alter table public.deal_price_records add column if not exists medium text;
alter table public.deal_price_records add column if not exists unit_format text;
alter table public.deal_price_records add column if not exists placement text;
alter table public.deal_price_records add column if not exists unit_count integer;
alter table public.deal_price_records add column if not exists guaranteed_impressions integer;
alter table public.deal_price_records add column if not exists terms jsonb not null default '{}'::jsonb;
alter table public.deal_price_records add column if not exists flight_start date;
alter table public.deal_price_records add column if not exists flight_end date;
alter table public.deal_price_records add column if not exists booked_at timestamptz not null default now();
alter table public.deal_price_records add column if not exists signed_io_pdf_url text;
alter table public.deal_price_records add column if not exists delivered_units integer not null default 0;
alter table public.deal_price_records add column if not exists delivered_at timestamptz;
alter table public.deal_price_records add column if not exists make_good_count integer not null default 0;
alter table public.deal_price_records add column if not exists make_good_credit_total numeric(12,2) not null default 0;
alter table public.deal_price_records add column if not exists actual_downloads integer;
alter table public.deal_price_records add column if not exists reported_conversions integer;
alter table public.deal_price_records add column if not exists outcome_status text not null default 'booked';
alter table public.deal_price_records add column if not exists outcome_updated_at timestamptz;
alter table public.deal_price_records add column if not exists prior_record_id uuid;
alter table public.deal_price_records add column if not exists rebook_sequence integer not null default 1;
alter table public.deal_price_records add column if not exists rebooked boolean not null default false;
alter table public.deal_price_records add column if not exists created_at timestamptz not null default now();
alter table public.deal_price_records add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'deal_price_records_io_id_fkey'
      and conrelid = 'public.deal_price_records'::regclass
  ) then
    alter table public.deal_price_records
      add constraint deal_price_records_io_id_fkey
      foreign key (io_id) references public.insertion_orders(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'deal_price_records_brand_profile_id_fkey'
      and conrelid = 'public.deal_price_records'::regclass
  ) then
    alter table public.deal_price_records
      add constraint deal_price_records_brand_profile_id_fkey
      foreign key (brand_profile_id) references public.brand_profiles(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'deal_price_records_brand_id_fkey'
      and conrelid = 'public.deal_price_records'::regclass
  ) then
    alter table public.deal_price_records
      add constraint deal_price_records_brand_id_fkey
      foreign key (brand_id) references public.profiles(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'deal_price_records_show_id_fkey'
      and conrelid = 'public.deal_price_records'::regclass
  ) then
    alter table public.deal_price_records
      add constraint deal_price_records_show_id_fkey
      foreign key (show_id) references public.shows(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'deal_price_records_prior_record_id_fkey'
      and conrelid = 'public.deal_price_records'::regclass
  ) then
    alter table public.deal_price_records
      add constraint deal_price_records_prior_record_id_fkey
      foreign key (prior_record_id) references public.deal_price_records(id) on delete set null;
  end if;
end $$;

alter table public.deal_price_records drop constraint if exists deal_price_records_deal_id_fkey;
alter table public.deal_price_records
  add constraint deal_price_records_deal_id_fkey
  foreign key (deal_id) references public.deals(id) on delete restrict;

alter table public.deal_price_records drop constraint if exists deal_price_records_deal_id_key;
alter table public.deal_price_records
  add constraint deal_price_records_deal_id_key unique (deal_id);

alter table public.deal_price_records drop constraint if exists deal_price_records_pricing_basis_check;
alter table public.deal_price_records
  add constraint deal_price_records_pricing_basis_check
  check (pricing_basis is null or pricing_basis in ('cpm', 'flat', 'per_engaged_view'));

alter table public.deal_price_records drop constraint if exists deal_price_records_medium_check;
alter table public.deal_price_records
  add constraint deal_price_records_medium_check
  check (medium is null or medium in ('podcast', 'youtube', 'social'));

alter table public.deal_price_records drop constraint if exists deal_price_records_outcome_status_check;
alter table public.deal_price_records
  add constraint deal_price_records_outcome_status_check
  check (outcome_status in ('booked', 'delivering', 'delivered', 'make_good', 'cancelled'));

alter table public.deal_price_records drop constraint if exists deal_price_records_counts_check;
alter table public.deal_price_records
  add constraint deal_price_records_counts_check
  check (
    (unit_count is null or unit_count >= 0)
    and (guaranteed_impressions is null or guaranteed_impressions >= 0)
    and delivered_units >= 0
    and make_good_count >= 0
    and (actual_downloads is null or actual_downloads >= 0)
    and (reported_conversions is null or reported_conversions >= 0)
    and rebook_sequence >= 1
  );

create index if not exists idx_deal_price_records_show_brand_profile
  on public.deal_price_records (show_id, brand_profile_id);
create index if not exists idx_deal_price_records_show_brand
  on public.deal_price_records (show_id, brand_id);
create index if not exists idx_deal_price_records_prior
  on public.deal_price_records (prior_record_id);

revoke all on table public.deal_price_records from public;
revoke all on table public.deal_price_records from anon;
revoke all on table public.deal_price_records from authenticated;
grant select, insert, update, delete on table public.deal_price_records to service_role;
grant select on table public.deal_price_records to authenticated;

alter table public.deal_price_records enable row level security;

drop policy if exists "Deal parties insert deal price records" on public.deal_price_records;
drop policy if exists "Deal parties update deal price records" on public.deal_price_records;
drop policy if exists "Deal parties delete deal price records" on public.deal_price_records;
drop policy if exists "Deal parties read deal price records" on public.deal_price_records;

create policy "Deal parties read deal price records"
  on public.deal_price_records
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.deals d
      where d.id = deal_price_records.deal_id
        and (
          d.brand_id = (select auth.uid())
          or d.agent_id = (select auth.uid())
          or d.agency_id = (select auth.uid())
        )
    )
    or exists (
      select 1
      from public.deals d
      join public.brand_profiles bp on bp.id = d.brand_profile_id
      where d.id = deal_price_records.deal_id
        and bp.user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.deals d
      join public.show_profiles sp on sp.id = d.show_profile_id
      where d.id = deal_price_records.deal_id
        and sp.user_id = (select auth.uid())
    )
  );

create or replace function public.deal_price_records_lock_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.deal_id is distinct from old.deal_id
     or new.io_id is distinct from old.io_id
     or new.io_number is distinct from old.io_number
     or new.brand_profile_id is distinct from old.brand_profile_id
     or new.brand_id is distinct from old.brand_id
     or new.show_id is distinct from old.show_id
     or new.agreed_total_gross is distinct from old.agreed_total_gross
     or new.agreed_total_net is distinct from old.agreed_total_net
     or new.pricing_basis is distinct from old.pricing_basis
     or new.unit_rate is distinct from old.unit_rate
     or new.medium is distinct from old.medium
     or new.unit_format is distinct from old.unit_format
     or new.placement is distinct from old.placement
     or new.unit_count is distinct from old.unit_count
     or new.guaranteed_impressions is distinct from old.guaranteed_impressions
     or new.terms is distinct from old.terms
     or new.flight_start is distinct from old.flight_start
     or new.flight_end is distinct from old.flight_end
     or new.booked_at is distinct from old.booked_at
     or new.created_at is distinct from old.created_at
     or (
       new.signed_io_pdf_url is distinct from old.signed_io_pdf_url
       and not (old.signed_io_pdf_url is null and new.signed_io_pdf_url is not null)
     )
  then
    raise exception 'deal_price_record_snapshot_locked'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.deal_price_records_lock_snapshot() from public;
revoke all on function public.deal_price_records_lock_snapshot() from anon;
revoke all on function public.deal_price_records_lock_snapshot() from authenticated;
grant execute on function public.deal_price_records_lock_snapshot() to service_role;

drop trigger if exists deal_price_records_lock_snapshot on public.deal_price_records;
create trigger deal_price_records_lock_snapshot
  before update on public.deal_price_records
  for each row execute function public.deal_price_records_lock_snapshot();

drop trigger if exists update_deal_price_records_timestamp on public.deal_price_records;
create trigger update_deal_price_records_timestamp
  before update on public.deal_price_records
  for each row execute function update_updated_at();

comment on table public.deal_price_records is
  'One booked-deal price record. Snapshot columns are immutable after insert. Outcome and rebook columns are updated later by service_role.';
