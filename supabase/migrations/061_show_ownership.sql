-- ============================================================
-- 061: show ownership status and proofs
--
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK.
-- Paste into the Supabase SQL Editor, then introspect. Do not run
-- this from the app, a seed script, or a deploy hook.
--
-- 061 is reserved for this drop of show_claims. 065 and 066 are
-- already applied on the live project. This file does not grant
-- or revoke on public.shows, so the 066 write revoke stays.
-- A from-scratch paste runs this file before 065 because of the
-- number. 065 then revokes anon and public on every public table,
-- including this new one. It does not grant authenticated writes
-- back.
--
-- show_claims had 0 rows on Oct 24, 2026. Before Chris applies
-- this file, re-confirm that count read-only:
--   select count(*) from public.show_claims;
-- Expected: 0. Do not apply if the count is not 0.
--
-- Two ownership states on shows.ownership_status: unclaimed
-- (the default) and verified. Pending is not a state. It is a
-- tag while a proof or a rep link is pending. shows.is_claimed
-- stays. It is deprecated. Nothing should branch on it.
-- Existing rows become unclaimed from the column default.
-- is_claimed is not copied.
--
-- public.show_ownership_proofs is sized for O2 and O4. Those
-- jobs write the rows. This file does not. One verified proof
-- per show. code_hash is sha256 of the code. The plaintext is
-- never stored. podscan_id is not a column and is not a tie.
--
-- Grants come before RLS. service_role gets select, insert,
-- update, and delete. authenticated gets select only, and the
-- policy limits that to user_id = auth.uid(). anon and public
-- get nothing. authenticated loses insert, update, delete,
-- truncate, references, and trigger. service_role loses
-- truncate, references, and trigger.
--
-- Idempotent. Safe to re-run. No backfill.
--
-- Introspection (run after applying):
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name in ('show_ownership_proofs', 'shows')
--    order by table_name, grantee, privilege_type;
--   select polname
--     from pg_policy
--    where polrelid = 'public.show_ownership_proofs'::regclass;
--   Expected: one select policy, Owners read own ownership proofs.
--   select to_regclass('public.show_claims');
--   Expected: null.
--   select column_name, column_default
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'shows'
--      and column_name in ('ownership_status', 'is_claimed');
--   Expected: ownership_status default 'unclaimed', is_claimed still present.
-- ============================================================

alter table public.shows
  add column if not exists ownership_status text not null default 'unclaimed';

alter table public.shows
  drop constraint if exists shows_ownership_status_check;
alter table public.shows
  add constraint shows_ownership_status_check
  check (ownership_status in ('unclaimed', 'verified'));

comment on column public.shows.ownership_status is
  'Unclaimed or verified. Pending is not a state. It is a tag while a proof or a rep link is pending.';

comment on column public.shows.is_claimed is
  'Deprecated. Do not branch on this flag. Ownership is ownership_status plus show_ownership_proofs.';

create table if not exists public.show_ownership_proofs (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null,
  user_id uuid not null,
  show_profile_id uuid,
  method text,
  status text not null default 'pending',
  code_hash text,
  code_expires_at timestamptz,
  target text,
  check_count integer not null default 0,
  miss_count integer not null default 0,
  last_checked_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  verified_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.show_ownership_proofs
  add column if not exists show_id uuid;
alter table public.show_ownership_proofs
  add column if not exists user_id uuid;
alter table public.show_ownership_proofs
  add column if not exists show_profile_id uuid;
alter table public.show_ownership_proofs
  add column if not exists method text;
alter table public.show_ownership_proofs
  add column if not exists status text not null default 'pending';
alter table public.show_ownership_proofs
  add column if not exists code_hash text;
alter table public.show_ownership_proofs
  add column if not exists code_expires_at timestamptz;
alter table public.show_ownership_proofs
  add column if not exists target text;
alter table public.show_ownership_proofs
  add column if not exists check_count integer not null default 0;
alter table public.show_ownership_proofs
  add column if not exists miss_count integer not null default 0;
alter table public.show_ownership_proofs
  add column if not exists last_checked_at timestamptz;
alter table public.show_ownership_proofs
  add column if not exists decided_by uuid;
alter table public.show_ownership_proofs
  add column if not exists decided_at timestamptz;
alter table public.show_ownership_proofs
  add column if not exists verified_at timestamptz;
alter table public.show_ownership_proofs
  add column if not exists note text;
alter table public.show_ownership_proofs
  add column if not exists created_at timestamptz not null default now();
alter table public.show_ownership_proofs
  add column if not exists updated_at timestamptz not null default now();

alter table public.show_ownership_proofs
  drop constraint if exists show_ownership_proofs_method_check;
alter table public.show_ownership_proofs
  add constraint show_ownership_proofs_method_check
  check (method is null or method in ('rss_code', 'youtube_code', 'admin'));

alter table public.show_ownership_proofs
  drop constraint if exists show_ownership_proofs_status_check;
alter table public.show_ownership_proofs
  add constraint show_ownership_proofs_status_check
  check (status in ('pending', 'verified', 'rejected', 'expired', 'contested'));

alter table public.show_ownership_proofs
  drop constraint if exists show_ownership_proofs_show_id_fkey;
alter table public.show_ownership_proofs
  add constraint show_ownership_proofs_show_id_fkey
  foreign key (show_id) references public.shows (id) on delete cascade;

alter table public.show_ownership_proofs
  drop constraint if exists show_ownership_proofs_user_id_fkey;
alter table public.show_ownership_proofs
  add constraint show_ownership_proofs_user_id_fkey
  foreign key (user_id) references public.profiles (id);

alter table public.show_ownership_proofs
  drop constraint if exists show_ownership_proofs_show_profile_id_fkey;
alter table public.show_ownership_proofs
  add constraint show_ownership_proofs_show_profile_id_fkey
  foreign key (show_profile_id) references public.show_profiles (id);

create unique index if not exists show_ownership_proofs_one_verified_per_show
  on public.show_ownership_proofs (show_id)
  where status = 'verified';

create index if not exists show_ownership_proofs_status_created_at
  on public.show_ownership_proofs (status, created_at);

comment on table public.show_ownership_proofs is
  'Ownership checks. Later jobs write the rows. A verified row ties show_id to show_profile_id.';

comment on column public.show_ownership_proofs.code_hash is
  'sha256 of the ownership code. Never store the plaintext.';

comment on column public.show_ownership_proofs.target is
  'Normalized feed URL or UC channel id the code was placed on.';

-- -------------------- grants (before RLS) --------------------

revoke all on table public.show_ownership_proofs from public;
revoke all on table public.show_ownership_proofs from anon;
revoke all on table public.show_ownership_proofs from authenticated;
revoke all on table public.show_ownership_proofs from service_role;

grant select, insert, update, delete on table public.show_ownership_proofs to service_role;
grant select on table public.show_ownership_proofs to authenticated;

revoke insert, update, delete, truncate, references, trigger
  on table public.show_ownership_proofs from authenticated;
revoke truncate, references, trigger
  on table public.show_ownership_proofs from service_role;
revoke all on table public.show_ownership_proofs from anon;
revoke all on table public.show_ownership_proofs from public;

-- -------------------- RLS --------------------

alter table public.show_ownership_proofs enable row level security;

drop policy if exists "Owners read own ownership proofs" on public.show_ownership_proofs;
create policy "Owners read own ownership proofs"
  on public.show_ownership_proofs
  for select
  to authenticated
  using (user_id = auth.uid());

-- show_claims was confirmed empty on Oct 24, 2026. Re-confirm
-- the count read-only before applying. Dropped last so a failure
-- above leaves the old table in place.
drop table if exists public.show_claims;
