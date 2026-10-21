-- ============================================================
-- 054: brand-private past campaign imports
--
-- NOT applied. Apply after merge and Chris's OK.
-- Paste into the Supabase SQL Editor, then introspect.
-- Do not run this from the app, a seed script, or a deploy hook.
-- Migration 053 is reserved for the CRM job. This file stays 054.
--
-- Two tables for a brand's own imported campaign history:
--   past_campaign_imports — one uploaded file (csv, xlsx, or pdf)
--     and the consent choice for that file.
--   past_campaign_records — the rows parsed from that file.
--
-- Both tables are private to the brand (profiles.id = auth.uid()).
-- pooling_consent and terms_version record whether this import may
-- later be anonymized into a shared pool, and which consent text
-- the brand accepted. This migration does not create that pool,
-- an aggregate table, or a view over other brands' rows.
--
-- matched_show_id is an optional catalog suggestion (shows.id).
-- It is advisory only. Deleting the show clears the suggestion
-- and leaves the brand's row in place. It does not let the show
-- read the import.
--
-- brand_id on a record is the RLS key, copied from the import so
-- a policy can stay owner-only without joining. Records are removed
-- with their import. Imports are removed with the profile.
--
-- Idempotent. Safe to re-run. No backfill. No anon grant.
-- Supabase default privileges grant anon and authenticated
-- truncate, references, and trigger when a public table is
-- created. Truncate ignores row level security. Those three are
-- revoked from authenticated after the DML grant. anon and public
-- lose every privilege.
--
-- Introspection (run after applying):
--   select c.relname, c.relrowsecurity
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname in ('past_campaign_imports', 'past_campaign_records')
--    order by c.relname;
--   Expected: relrowsecurity true for both.
--   select grantee, table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name in ('past_campaign_imports', 'past_campaign_records')
--    order by table_name, grantee, privilege_type;
--   Expected: authenticated and service_role have select, insert,
--   update, and delete. anon and public have none. authenticated
--   has no truncate, references, or trigger. service_role may still
--   hold truncate, references, and trigger from default privileges.
--   select schemaname, tablename, policyname, roles, cmd, qual, with_check
--     from pg_policies
--    where schemaname = 'public'
--      and tablename in ('past_campaign_imports', 'past_campaign_records')
--    order by tablename, policyname;
--   Expected: eight policies, authenticated only. Each USING and
--   WITH CHECK is brand_id = auth.uid(). No pooled or aggregate
--   relation.
-- ============================================================

-- -------------------- past_campaign_imports --------------------

create table if not exists public.past_campaign_imports (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references public.profiles(id) on delete cascade,
  source_kind      text,
  file_name        text,
  status           text not null default 'parsed',
  pooling_consent  boolean not null default false,
  terms_version    text,
  created_at       timestamptz not null default now()
);

alter table public.past_campaign_imports
  drop constraint if exists past_campaign_imports_source_kind_check;
alter table public.past_campaign_imports
  add constraint past_campaign_imports_source_kind_check
  check (source_kind is null or source_kind in ('csv', 'xlsx', 'pdf'));

alter table public.past_campaign_imports
  drop constraint if exists past_campaign_imports_status_check;
alter table public.past_campaign_imports
  add constraint past_campaign_imports_status_check
  check (status in ('parsed', 'confirmed', 'discarded'));

create index if not exists idx_past_campaign_imports_brand
  on public.past_campaign_imports (brand_id);

comment on table public.past_campaign_imports is
  'One brand-private upload of past campaign history. pooling_consent records permission for a later anonymized pool. This table is not that pool.';
comment on column public.past_campaign_imports.pooling_consent is
  'True only when the brand agreed this import may later be anonymized into a shared pool. Default false. No pool is created here.';
comment on column public.past_campaign_imports.terms_version is
  'Identifier of the consent text accepted when pooling_consent was set. Null when the brand has not consented.';
comment on column public.past_campaign_imports.brand_id is
  'profiles.id of the owning brand. RLS is brand_id = auth.uid().';

-- -------------------- past_campaign_records --------------------

create table if not exists public.past_campaign_records (
  id               uuid primary key default gen_random_uuid(),
  import_id        uuid not null references public.past_campaign_imports(id) on delete cascade,
  brand_id         uuid not null references public.profiles(id),
  show_name        text not null,
  -- Advisory catalog match. Not a share with the show.
  matched_show_id  uuid references public.shows(id) on delete set null,
  flight_start     date,
  flight_end       date,
  placement        text,
  price_type       text,
  rate             numeric,
  episodes         integer,
  spend            numeric,
  conversions      integer,
  downloads        integer,
  raw              jsonb,
  created_at       timestamptz not null default now()
);

alter table public.past_campaign_records
  drop constraint if exists past_campaign_records_price_type_check;
alter table public.past_campaign_records
  add constraint past_campaign_records_price_type_check
  check (price_type is null or price_type in ('cpm', 'flat'));

create index if not exists idx_past_campaign_records_brand
  on public.past_campaign_records (brand_id);

create index if not exists idx_past_campaign_records_import
  on public.past_campaign_records (import_id);

comment on table public.past_campaign_records is
  'Parsed rows from one brand-private past campaign import. Visible only to that brand.';
comment on column public.past_campaign_records.brand_id is
  'Owner copied from the import so RLS can use brand_id = auth.uid() without a join.';
comment on column public.past_campaign_records.matched_show_id is
  'Optional shows.id suggestion. Advisory only. Clearing it does not delete the brand row, and the show cannot read this row.';
comment on column public.past_campaign_records.raw is
  'Original parsed cells for this row, kept so a later confirm step can show what was imported.';

-- -------------------- grants (before RLS) --------------------

revoke all on table public.past_campaign_imports from public;
revoke all on table public.past_campaign_imports from anon;
revoke all on table public.past_campaign_records from public;
revoke all on table public.past_campaign_records from anon;

grant select, insert, update, delete on public.past_campaign_imports to service_role;
grant select, insert, update, delete on public.past_campaign_imports to authenticated;
grant select, insert, update, delete on public.past_campaign_records to service_role;
grant select, insert, update, delete on public.past_campaign_records to authenticated;

-- Default privileges also grant truncate, references, and trigger
-- to authenticated. A later grant of DML does not remove them.
revoke truncate, references, trigger on table public.past_campaign_imports from authenticated;
revoke truncate, references, trigger on table public.past_campaign_records from authenticated;

-- -------------------- RLS --------------------

alter table public.past_campaign_imports enable row level security;
alter table public.past_campaign_records enable row level security;

-- Owner-only. INSERT and UPDATE repeat the predicate in WITH CHECK
-- so a brand cannot write a row onto another brand_id. service_role
-- bypasses RLS and is not given a policy here.

drop policy if exists "Brand selects own past campaign imports"
  on public.past_campaign_imports;
create policy "Brand selects own past campaign imports"
  on public.past_campaign_imports
  for select
  to authenticated
  using (brand_id = auth.uid());

drop policy if exists "Brand inserts own past campaign imports"
  on public.past_campaign_imports;
create policy "Brand inserts own past campaign imports"
  on public.past_campaign_imports
  for insert
  to authenticated
  with check (brand_id = auth.uid());

drop policy if exists "Brand updates own past campaign imports"
  on public.past_campaign_imports;
create policy "Brand updates own past campaign imports"
  on public.past_campaign_imports
  for update
  to authenticated
  using (brand_id = auth.uid())
  with check (brand_id = auth.uid());

drop policy if exists "Brand deletes own past campaign imports"
  on public.past_campaign_imports;
create policy "Brand deletes own past campaign imports"
  on public.past_campaign_imports
  for delete
  to authenticated
  using (brand_id = auth.uid());

drop policy if exists "Brand selects own past campaign records"
  on public.past_campaign_records;
create policy "Brand selects own past campaign records"
  on public.past_campaign_records
  for select
  to authenticated
  using (brand_id = auth.uid());

drop policy if exists "Brand inserts own past campaign records"
  on public.past_campaign_records;
create policy "Brand inserts own past campaign records"
  on public.past_campaign_records
  for insert
  to authenticated
  with check (brand_id = auth.uid());

drop policy if exists "Brand updates own past campaign records"
  on public.past_campaign_records;
create policy "Brand updates own past campaign records"
  on public.past_campaign_records
  for update
  to authenticated
  using (brand_id = auth.uid())
  with check (brand_id = auth.uid());

drop policy if exists "Brand deletes own past campaign records"
  on public.past_campaign_records;
create policy "Brand deletes own past campaign records"
  on public.past_campaign_records
  for delete
  to authenticated
  using (brand_id = auth.uid());
