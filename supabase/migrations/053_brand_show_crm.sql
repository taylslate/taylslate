-- ============================================================
-- 053: brand-private show CRM (contacts and notes)
--
-- NOT applied. Apply after merge and Chris's OK.
-- Paste into the Supabase SQL Editor, then run the introspection
-- queries below. Do not run this from the app, a seed script, or
-- a deploy hook.
--
-- Two tables, both private to the brand (profiles.id = auth.uid()):
--   brand_show_contacts — people at a show the brand is working with
--   brand_show_notes — short notes beside that brand's deal history
--
-- show_id is public.shows.id (the catalog show on the deal). It is
-- not show_profiles.podscan_id. That column is user-writable.
--
-- Idempotent. Safe to re-run. No backfill.
--
-- Grants: select, insert, update, and delete to service_role and
-- authenticated. revoke all from anon and public. Supabase's default
-- privileges also grant authenticated truncate, references, and
-- trigger when the table is created (truncate ignores row level
-- security). Those three are revoked from authenticated after the
-- DML grant, same fix as migration 052. They are revoked from anon
-- as well so a leftover default grant cannot keep them.
--
-- Introspection (run after applying):
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name in ('brand_show_contacts', 'brand_show_notes')
--    order by table_name, ordinal_position;
--   select conname from pg_constraint
--    where conrelid in (
--      'public.brand_show_contacts'::regclass,
--      'public.brand_show_notes'::regclass
--    )
--    order by conname;
--   select indexname, indexdef from pg_indexes
--    where schemaname = 'public'
--      and tablename in ('brand_show_contacts', 'brand_show_notes')
--    order by indexname;
--   select grantee, table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name in ('brand_show_contacts', 'brand_show_notes')
--    order by table_name, grantee, privilege_type;
--   select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr,
--          pg_get_expr(polwithcheck, polrelid) as check_expr
--     from pg_policy
--    where polrelid in (
--      'public.brand_show_contacts'::regclass,
--      'public.brand_show_notes'::regclass
--    )
--    order by polname;
--   select c.relname, c.relrowsecurity
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname in ('brand_show_contacts', 'brand_show_notes');
--   Expected: authenticated and service_role have select, insert,
--   update, and delete. anon and public have no privileges.
--   authenticated has no truncate, references, or trigger. RLS is
--   enabled. Each policy is owner-only (brand_id = auth.uid()).
--   Insert and update policies include WITH CHECK. No anon policy.
--   brand_show_notes_body_check is length(body) between 1 and 2000.
--   Both tables have an index on (brand_id, show_id).
-- ============================================================

-- -------------------- brand_show_contacts --------------------

create table if not exists public.brand_show_contacts (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.profiles(id) on delete cascade,
  show_id     uuid not null references public.shows(id) on delete cascade,
  name        text not null,
  email       text,
  role        text,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_brand_show_contacts_brand_show
  on public.brand_show_contacts (brand_id, show_id);

-- -------------------- brand_show_notes --------------------

create table if not exists public.brand_show_notes (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.profiles(id) on delete cascade,
  show_id     uuid not null references public.shows(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);

alter table public.brand_show_notes
  drop constraint if exists brand_show_notes_body_check;
alter table public.brand_show_notes
  add constraint brand_show_notes_body_check
  check (length(body) between 1 and 2000);

create index if not exists idx_brand_show_notes_brand_show
  on public.brand_show_notes (brand_id, show_id);

-- -------------------- grants (before RLS) --------------------

revoke all on table public.brand_show_contacts from public;
revoke all on table public.brand_show_notes from public;
revoke all on table public.brand_show_contacts from anon;
revoke all on table public.brand_show_notes from anon;
revoke all on table public.brand_show_contacts from authenticated;
revoke all on table public.brand_show_notes from authenticated;

grant select, insert, update, delete on table public.brand_show_contacts to service_role;
grant select, insert, update, delete on table public.brand_show_notes to service_role;
grant select, insert, update, delete on table public.brand_show_contacts to authenticated;
grant select, insert, update, delete on table public.brand_show_notes to authenticated;

-- Default privileges granted truncate, references, and trigger at
-- create time. revoke all above clears them; these statements keep
-- the revocation explicit on re-run (migration 052).
revoke truncate, references, trigger on table public.brand_show_contacts from anon;
revoke truncate, references, trigger on table public.brand_show_notes from anon;
revoke truncate, references, trigger on table public.brand_show_contacts from authenticated;
revoke truncate, references, trigger on table public.brand_show_notes from authenticated;

-- -------------------- RLS --------------------

alter table public.brand_show_contacts enable row level security;
alter table public.brand_show_notes enable row level security;

drop policy if exists "Brand selects own show contacts"
  on public.brand_show_contacts;
create policy "Brand selects own show contacts"
  on public.brand_show_contacts
  for select
  to authenticated
  using (brand_id = auth.uid());

drop policy if exists "Brand inserts own show contacts"
  on public.brand_show_contacts;
create policy "Brand inserts own show contacts"
  on public.brand_show_contacts
  for insert
  to authenticated
  with check (brand_id = auth.uid());

drop policy if exists "Brand updates own show contacts"
  on public.brand_show_contacts;
create policy "Brand updates own show contacts"
  on public.brand_show_contacts
  for update
  to authenticated
  using (brand_id = auth.uid())
  with check (brand_id = auth.uid());

drop policy if exists "Brand deletes own show contacts"
  on public.brand_show_contacts;
create policy "Brand deletes own show contacts"
  on public.brand_show_contacts
  for delete
  to authenticated
  using (brand_id = auth.uid());

drop policy if exists "Brand selects own show notes"
  on public.brand_show_notes;
create policy "Brand selects own show notes"
  on public.brand_show_notes
  for select
  to authenticated
  using (brand_id = auth.uid());

drop policy if exists "Brand inserts own show notes"
  on public.brand_show_notes;
create policy "Brand inserts own show notes"
  on public.brand_show_notes
  for insert
  to authenticated
  with check (brand_id = auth.uid());

drop policy if exists "Brand updates own show notes"
  on public.brand_show_notes;
create policy "Brand updates own show notes"
  on public.brand_show_notes
  for update
  to authenticated
  using (brand_id = auth.uid())
  with check (brand_id = auth.uid());

drop policy if exists "Brand deletes own show notes"
  on public.brand_show_notes;
create policy "Brand deletes own show notes"
  on public.brand_show_notes
  for delete
  to authenticated
  using (brand_id = auth.uid());

drop trigger if exists update_brand_show_contacts_timestamp
  on public.brand_show_contacts;
create trigger update_brand_show_contacts_timestamp
  before update on public.brand_show_contacts
  for each row execute function update_updated_at();

comment on table public.brand_show_contacts is
  'People at a show, private to the brand that wrote them. brand_id is profiles.id. show_id is shows.id, not show_profiles.podscan_id.';
comment on table public.brand_show_notes is
  'Short notes a brand keeps on a show, beside that brand''s deal history. show_id is shows.id, not show_profiles.podscan_id.';
comment on column public.brand_show_contacts.show_id is
  'Catalog shows.id. Not show_profiles.podscan_id.';
comment on column public.brand_show_notes.show_id is
  'Catalog shows.id. Not show_profiles.podscan_id.';
comment on column public.brand_show_notes.body is
  'Required note text. length(body) is between 1 and 2000.';
