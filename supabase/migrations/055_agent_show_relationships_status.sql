-- ============================================================
-- 055: agent_show_relationships status
--
-- NOT applied. Paste into the SQL editor after this merges and
-- Chris says OK, then introspect. Do not run this from the app,
-- a seed script, or a deploy hook.
--
-- Rep screens and bulk roster import build on this table. The
-- insert and delete policies let any signed-in agent claim or
-- drop any show where auth.uid() equals agent_id. Those
-- self-serve writes come off. An imported link waits for an
-- admin to approve it. Writes after this file is applied go
-- through service_role.
--
-- New columns. Existing rows become status 'approved' and
-- source 'admin' from the defaults. approved_by and approved_at
-- stay null. This file does not UPDATE or DELETE rows.
--
--   status       text not null default 'approved'
--                pending, approved, or rejected
--   source       text not null default 'admin'
--                admin, import, or claim
--   approved_by  uuid null -> public.profiles(id)
--   approved_at  timestamptz null
--
-- Index on (agent_id, status).
--
-- Policies: drop "Agents insert own relationships" and
-- "Agents delete own relationships". Keep "Agents read own
-- relationships" (recreated with the same predicate). Reads are
-- not filtered by status here. Migration 047's learning policies
-- stay as written in that file. 056 recreates the live policies
-- so a rep read requires status 'approved'. repMayWrite is
-- unchanged; its caller filters the show set.
--
-- Grants. agent_show_relationships predates migration 020, which
-- granted authenticated select, insert, update, and delete.
-- Default privileges can also leave truncate, references, and
-- trigger. This leaves:
--   service_role   select, insert, update, delete
--   authenticated  select only
--   anon, public   nothing
-- Authenticated loses insert, update, delete, truncate,
-- references, and trigger. service_role's extra default
-- privileges are left as they are.
--
-- Idempotent. Safe to re-run.
--
-- Introspection (run after applying):
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'agent_show_relationships'
--      and column_name in ('status', 'source', 'approved_by', 'approved_at')
--    order by column_name;
--   Expected:
--     approved_at  timestamp with time zone  YES  (null)
--     approved_by  uuid                      YES  (null)
--     source       text                      NO   'admin'::text
--     status       text                      NO   'approved'::text
--
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.agent_show_relationships'::regclass
--      and conname in (
--        'agent_show_relationships_status_check',
--        'agent_show_relationships_source_check',
--        'agent_show_relationships_approved_by_fkey'
--      )
--    order by conname;
--
--   select indexname
--     from pg_indexes
--    where schemaname = 'public'
--      and tablename = 'agent_show_relationships'
--      and indexname = 'idx_agent_shows_agent_status';
--
--   select polname, polcmd
--     from pg_policy
--    where polrelid = 'public.agent_show_relationships'::regclass
--    order by polname;
--   Expected: "Agents read own relationships" (polcmd r) only.
--
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'agent_show_relationships'
--      and grantee in ('anon', 'authenticated', 'service_role')
--    order by grantee, privilege_type;
--   Expected: authenticated has select only. service_role has
--   select, insert, update, and delete (truncate, references,
--   and trigger may still be there from the table default).
--   anon has none. PUBLIC has none:
--   select privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'agent_show_relationships'
--      and grantee = 'PUBLIC';
-- ============================================================

alter table public.agent_show_relationships
  add column if not exists status text not null default 'approved';

alter table public.agent_show_relationships
  add column if not exists source text not null default 'admin';

alter table public.agent_show_relationships
  add column if not exists approved_by uuid;

alter table public.agent_show_relationships
  add column if not exists approved_at timestamptz;

alter table public.agent_show_relationships
  drop constraint if exists agent_show_relationships_status_check;
alter table public.agent_show_relationships
  add constraint agent_show_relationships_status_check
  check (status in ('pending', 'approved', 'rejected'));

alter table public.agent_show_relationships
  drop constraint if exists agent_show_relationships_source_check;
alter table public.agent_show_relationships
  add constraint agent_show_relationships_source_check
  check (source in ('admin', 'import', 'claim'));

alter table public.agent_show_relationships
  drop constraint if exists agent_show_relationships_approved_by_fkey;
alter table public.agent_show_relationships
  add constraint agent_show_relationships_approved_by_fkey
  foreign key (approved_by) references public.profiles (id) on delete set null;

create index if not exists idx_agent_shows_agent_status
  on public.agent_show_relationships (agent_id, status);

-- Data API grants. Revoke first so a re-run clears a partial apply.
-- authenticated keeps select and loses every write and the three
-- privileges that ignore or extend row level security.
revoke all on table public.agent_show_relationships from anon;
revoke all on table public.agent_show_relationships from public;

grant select, insert, update, delete on table public.agent_show_relationships to service_role;
grant select on table public.agent_show_relationships to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.agent_show_relationships from authenticated;

alter table public.agent_show_relationships enable row level security;

drop policy if exists "Agents insert own relationships" on public.agent_show_relationships;
drop policy if exists "Agents delete own relationships" on public.agent_show_relationships;

drop policy if exists "Agents read own relationships" on public.agent_show_relationships;
create policy "Agents read own relationships"
  on public.agent_show_relationships
  for select
  using (auth.uid() = agent_id);

comment on column public.agent_show_relationships.status is
  'pending waits for admin approval. approved is a live roster link. rejected is kept and is not a live link. Existing rows default to approved.';
comment on column public.agent_show_relationships.source is
  'admin: an internal admin wrote the link. import: a bulk roster import. claim: an agent asked to represent a catalog show. Imported and claimed links start pending.';
comment on column public.agent_show_relationships.approved_by is
  'Profile that approved the link. Null until an admin approves, and null on rows that were already on the roster when this column was added.';
comment on column public.agent_show_relationships.approved_at is
  'When an admin approved the link. Null on rows that were already on the roster when this column was added.';
