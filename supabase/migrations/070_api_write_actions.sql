-- ============================================================
-- 070: public API write actions
--
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK.
-- Paste into the Supabase SQL Editor, then introspect. Do not run
-- this from the app, a seed script, or a deploy hook.
--
-- The job placeholder was 069. This file is 070. Do not reuse 059.
--
-- api_write_actions records a v1 write. It does not create a
-- campaign, outreach, deal, or show, and it does not send or
-- charge. status stays pending until a later approval step.
-- Idempotency is unique per brand. service_role is the only
-- role that can touch the table. RLS is on and there is no
-- policy, so anon and authenticated cannot read or write it
-- even if a grant is added later by mistake.
--
-- Idempotent. Safe to re-run. No backfill.
-- Supabase default privileges can grant anon and authenticated
-- truncate, references, and trigger when a public table is
-- created. Those are revoked. anon, public, and authenticated
-- lose every privilege. service_role is granted all privileges.
--
-- Introspection (run after applying):
--   select c.relname, c.relrowsecurity
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname = 'api_write_actions';
--   Expected: relrowsecurity true.
--   select conname, contype
--     from pg_constraint
--    where conrelid = 'public.api_write_actions'::regclass
--    order by conname;
--   Expected: primary key, brand_id and api_key_id foreign
--   keys, unique (brand_id, idempotency_key), and checks for
--   kind, status, and idempotency_key length.
--   select indexname
--     from pg_indexes
--    where schemaname = 'public'
--      and tablename = 'api_write_actions'
--    order by indexname;
--   Expected: an index on (brand_id, status, created_at).
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'api_write_actions'
--    order by grantee, privilege_type;
--   Expected: service_role only. Nothing for anon, public,
--   or authenticated. The table owner may also be listed.
--   select count(*)
--     from pg_policies
--    where schemaname = 'public'
--      and tablename = 'api_write_actions';
--   Expected: 0.
-- ============================================================

create table if not exists public.api_write_actions (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references public.profiles(id) on delete cascade,
  api_key_id       uuid not null references public.api_keys(id),
  kind             text not null,
  payload          jsonb not null,
  payload_hash     text not null,
  idempotency_key  text not null,
  status           text not null default 'pending',
  decided_by       uuid,
  decided_at       timestamptz,
  created_at       timestamptz not null default now()
);

alter table public.api_write_actions add column if not exists brand_id uuid;
alter table public.api_write_actions add column if not exists api_key_id uuid;
alter table public.api_write_actions add column if not exists kind text;
alter table public.api_write_actions add column if not exists payload jsonb;
alter table public.api_write_actions add column if not exists payload_hash text;
alter table public.api_write_actions add column if not exists idempotency_key text;
alter table public.api_write_actions add column if not exists status text default 'pending';
alter table public.api_write_actions add column if not exists decided_by uuid;
alter table public.api_write_actions add column if not exists decided_at timestamptz;
alter table public.api_write_actions add column if not exists created_at timestamptz default now();

alter table public.api_write_actions alter column brand_id set not null;
alter table public.api_write_actions alter column api_key_id set not null;
alter table public.api_write_actions alter column kind set not null;
alter table public.api_write_actions alter column payload set not null;
alter table public.api_write_actions alter column payload_hash set not null;
alter table public.api_write_actions alter column idempotency_key set not null;
alter table public.api_write_actions alter column status set not null;
alter table public.api_write_actions alter column status set default 'pending';
alter table public.api_write_actions alter column created_at set not null;
alter table public.api_write_actions alter column created_at set default now();

alter table public.api_write_actions drop constraint if exists api_write_actions_brand_id_fkey;
alter table public.api_write_actions
  add constraint api_write_actions_brand_id_fkey
  foreign key (brand_id) references public.profiles(id) on delete cascade;

alter table public.api_write_actions drop constraint if exists api_write_actions_api_key_id_fkey;
alter table public.api_write_actions
  add constraint api_write_actions_api_key_id_fkey
  foreign key (api_key_id) references public.api_keys(id);

alter table public.api_write_actions drop constraint if exists api_write_actions_kind_check;
alter table public.api_write_actions
  add constraint api_write_actions_kind_check
  check (kind in ('campaign.create', 'outreach.draft'));

alter table public.api_write_actions drop constraint if exists api_write_actions_status_check;
alter table public.api_write_actions
  add constraint api_write_actions_status_check
  check (status in ('pending', 'approved', 'rejected', 'expired'));

alter table public.api_write_actions drop constraint if exists api_write_actions_idempotency_key_len_check;
alter table public.api_write_actions
  add constraint api_write_actions_idempotency_key_len_check
  check (char_length(idempotency_key) between 1 and 128);

alter table public.api_write_actions drop constraint if exists api_write_actions_brand_idempotency_key;
alter table public.api_write_actions
  add constraint api_write_actions_brand_idempotency_key
  unique (brand_id, idempotency_key);

create index if not exists idx_api_write_actions_brand_status_created
  on public.api_write_actions (brand_id, status, created_at);

comment on table public.api_write_actions is
  'Pending v1 writes. Recording does not execute the action. service_role only.';
comment on column public.api_write_actions.brand_id is
  'profiles.id of the key owner. Deletes follow the profile.';
comment on column public.api_write_actions.api_key_id is
  'api_keys.id that recorded the action.';
comment on column public.api_write_actions.kind is
  'campaign.create or outreach.draft.';
comment on column public.api_write_actions.payload_hash is
  'SHA-256 hex of the canonical JSON payload. Same idempotency key and hash replays.';
comment on column public.api_write_actions.idempotency_key is
  'Caller key, 1 to 128 characters. Unique with brand_id.';
comment on column public.api_write_actions.status is
  'pending, approved, rejected, or expired. New rows are pending.';
comment on column public.api_write_actions.decided_by is
  'Set when a later approval step decides the row. Null while pending.';

-- -------------------- grants (before RLS) --------------------

revoke all on table public.api_write_actions from public;
revoke all on table public.api_write_actions from anon;
revoke all on table public.api_write_actions from authenticated;

grant all on table public.api_write_actions to service_role;

revoke truncate, references, trigger on table public.api_write_actions from authenticated;

-- -------------------- RLS --------------------
-- No policies. service_role bypasses RLS. anon and authenticated
-- have no grant and no policy.

alter table public.api_write_actions enable row level security;
