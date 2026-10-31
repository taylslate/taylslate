-- ============================================================
-- 075: roster link disputes
--
-- A verified show owner can flag a pending or approved roster
-- link. The note and the owner's identity stay off
-- agent_show_relationships: authenticated has table-wide SELECT
-- there (migration 055), so a column on that table would leak
-- both to the rep. This table has no policy and no grant for
-- authenticated, anon, or public.
--
-- status stays open in this job. Resolving a dispute is not
-- built. An open row does not block approve or reject.
--
-- RLS is on. There is no policy. service_role has select,
-- insert, update, delete. anon, authenticated, and public have
-- nothing. Authenticated and service_role also have truncate,
-- references, and trigger revoked.
--
-- Idempotent. Safe to re-run. No backfill.
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge
-- and Chris's OK naming 075. Do not run this from the app, a
-- seed script, or a deploy hook.
--
-- Introspection (run after applying):
--   select c.relrowsecurity
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname = 'roster_link_disputes';
--   Expected: true
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'roster_link_disputes'
--    order by grantee, privilege_type;
--   Expected grantee: service_role only
--   (select, insert, update, delete).
--   select conname
--     from pg_constraint
--    where conrelid = 'public.roster_link_disputes'::regclass
--      and contype = 'u';
--   Expected: roster_link_disputes_link_owner_key
-- ============================================================

create table if not exists public.roster_link_disputes (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null,
  show_id uuid not null,
  owner_user_id uuid not null,
  note text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);

alter table public.roster_link_disputes add column if not exists link_id uuid;
alter table public.roster_link_disputes add column if not exists show_id uuid;
alter table public.roster_link_disputes add column if not exists owner_user_id uuid;
alter table public.roster_link_disputes add column if not exists note text;
alter table public.roster_link_disputes add column if not exists status text default 'open';
alter table public.roster_link_disputes add column if not exists created_at timestamptz default now();
alter table public.roster_link_disputes add column if not exists resolved_at timestamptz;
alter table public.roster_link_disputes add column if not exists resolved_by uuid;

alter table public.roster_link_disputes alter column link_id set not null;
alter table public.roster_link_disputes alter column show_id set not null;
alter table public.roster_link_disputes alter column owner_user_id set not null;
alter table public.roster_link_disputes alter column status set not null;
alter table public.roster_link_disputes alter column status set default 'open';
alter table public.roster_link_disputes alter column created_at set not null;
alter table public.roster_link_disputes alter column created_at set default now();

alter table public.roster_link_disputes
  drop constraint if exists roster_link_disputes_link_id_fkey;
alter table public.roster_link_disputes
  add constraint roster_link_disputes_link_id_fkey
  foreign key (link_id) references public.agent_show_relationships (id) on delete cascade;

alter table public.roster_link_disputes
  drop constraint if exists roster_link_disputes_owner_user_id_fkey;
alter table public.roster_link_disputes
  add constraint roster_link_disputes_owner_user_id_fkey
  foreign key (owner_user_id) references public.profiles (id) on delete cascade;

alter table public.roster_link_disputes
  drop constraint if exists roster_link_disputes_resolved_by_fkey;
alter table public.roster_link_disputes
  add constraint roster_link_disputes_resolved_by_fkey
  foreign key (resolved_by) references public.profiles (id) on delete set null;

alter table public.roster_link_disputes
  drop constraint if exists roster_link_disputes_status_check;
alter table public.roster_link_disputes
  add constraint roster_link_disputes_status_check
  check (status in ('open', 'resolved'));

alter table public.roster_link_disputes
  drop constraint if exists roster_link_disputes_note_check;
alter table public.roster_link_disputes
  add constraint roster_link_disputes_note_check
  check (note is null or (char_length(note) >= 1 and char_length(note) <= 500));

alter table public.roster_link_disputes
  drop constraint if exists roster_link_disputes_link_owner_key;
alter table public.roster_link_disputes
  add constraint roster_link_disputes_link_owner_key
  unique (link_id, owner_user_id);

comment on table public.roster_link_disputes is
  'Owner flags on a roster link. service_role only. The note is not on agent_show_relationships.';

-- Data API grants. service_role only. Revoke first so a re-run
-- drops anything a partial apply left behind.
revoke all on table public.roster_link_disputes from public;
revoke all on table public.roster_link_disputes from anon;
revoke all on table public.roster_link_disputes from authenticated;
revoke all on table public.roster_link_disputes from service_role;
grant select, insert, update, delete on public.roster_link_disputes to service_role;
revoke truncate, references, trigger on table public.roster_link_disputes from authenticated;
revoke truncate, references, trigger on table public.roster_link_disputes from service_role;

alter table public.roster_link_disputes enable row level security;
