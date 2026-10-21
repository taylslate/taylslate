-- ============================================================
-- 057: public API keys and per-key rate windows
--
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK.
-- Paste into the Supabase SQL Editor, then
-- introspect. Do not run this from the app, a seed script, or
-- a deploy hook.
--
-- api_keys stores a SHA-256 hex digest of the full bearer
-- token (ts_live_<prefix>_<secret>). The secret is not stored.
-- prefix is the lookup key and is unique. Writes run as
-- service_role. authenticated may select its own rows
-- (brand_id = auth.uid()) on every column except key_hash,
-- and has no write policy.
--
-- api_rate_windows is the durable per-key per-minute counter.
-- service_role only. No authenticated grant and no policy.
-- increment_api_rate_window upserts that counter in one
-- statement. SECURITY INVOKER, search_path = public.
-- Execute is service_role only.
--
-- Idempotent. Safe to re-run. No backfill.
-- Supabase default privileges grant anon and authenticated
-- truncate, references, and trigger when a public table is
-- created. Truncate ignores row level security. Those three
-- are revoked from authenticated after the DML grant. anon
-- and public lose every privilege. authenticated loses every
-- privilege on api_rate_windows.
--
-- Introspection (run after applying):
--   select c.relname, c.relrowsecurity
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname in ('api_keys', 'api_rate_windows')
--    order by c.relname;
--   Expected: relrowsecurity true for both.
--   select grantee, table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name in ('api_keys', 'api_rate_windows')
--    order by table_name, grantee, privilege_type;
--   Expected: service_role has select, insert, update, and
--   delete on both. authenticated has no table-level select,
--   insert, update, or delete on api_keys (column select is
--   below). authenticated has nothing on api_rate_windows.
--   anon and public have none. authenticated has no truncate,
--   references, or trigger. service_role may still hold
--   truncate, references, and trigger from default privileges.
--   select grantee, column_name, privilege_type
--     from information_schema.column_privileges
--    where table_schema = 'public'
--      and table_name = 'api_keys'
--      and grantee = 'authenticated'
--    order by column_name, privilege_type;
--   Expected: select on id, brand_id, name, prefix, scopes,
--   created_at, last_used_at, and revoked_at. Selecting
--   key_hash as authenticated is denied: no key_hash row.
--   select schemaname, tablename, policyname, roles, cmd, qual
--     from pg_policies
--    where schemaname = 'public'
--      and tablename in ('api_keys', 'api_rate_windows')
--    order by tablename, policyname;
--   Expected: one policy, "Brand selects own api keys",
--   authenticated, select, qual brand_id = auth.uid().
--   No policy on api_rate_windows.
--   select grantee, privilege_type
--     from information_schema.routine_privileges
--    where routine_schema = 'public'
--      and routine_name = 'increment_api_rate_window';
--   Expected execute: service_role. Not anon, not
--   authenticated, not public.
-- ============================================================

-- -------------------- api_keys --------------------

create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references public.profiles(id) on delete cascade,
  name         text,
  prefix       text not null,
  key_hash     text not null,
  scopes       text[] not null default '{}',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

alter table public.api_keys add column if not exists brand_id uuid;
alter table public.api_keys add column if not exists name text;
alter table public.api_keys add column if not exists prefix text;
alter table public.api_keys add column if not exists key_hash text;
alter table public.api_keys add column if not exists scopes text[] default '{}';
alter table public.api_keys add column if not exists created_at timestamptz default now();
alter table public.api_keys add column if not exists last_used_at timestamptz;
alter table public.api_keys add column if not exists revoked_at timestamptz;

alter table public.api_keys alter column brand_id set not null;
alter table public.api_keys alter column prefix set not null;
alter table public.api_keys alter column key_hash set not null;
alter table public.api_keys alter column scopes set not null;
alter table public.api_keys alter column scopes set default '{}';
alter table public.api_keys alter column created_at set not null;
alter table public.api_keys alter column created_at set default now();

alter table public.api_keys drop constraint if exists api_keys_brand_id_fkey;
alter table public.api_keys
  add constraint api_keys_brand_id_fkey
  foreign key (brand_id) references public.profiles(id) on delete cascade;

alter table public.api_keys drop constraint if exists api_keys_prefix_key;
alter table public.api_keys
  add constraint api_keys_prefix_key unique (prefix);

alter table public.api_keys drop constraint if exists api_keys_prefix_format_check;
alter table public.api_keys
  add constraint api_keys_prefix_format_check
  check (prefix ~ '^[0-9a-f]{16}$');

alter table public.api_keys drop constraint if exists api_keys_key_hash_check;
alter table public.api_keys
  add constraint api_keys_key_hash_check
  check (key_hash ~ '^[0-9a-f]{64}$');

alter table public.api_keys drop constraint if exists api_keys_scopes_check;
alter table public.api_keys
  add constraint api_keys_scopes_check
  check (
    scopes <@ array['read', 'write:campaigns', 'write:outreach']::text[]
  );

create index if not exists idx_api_keys_brand_id
  on public.api_keys (brand_id);

comment on table public.api_keys is
  'Per-brand public API keys. key_hash is the SHA-256 hex of the bearer token. The secret is not stored.';
comment on column public.api_keys.brand_id is
  'profiles.id of the owning brand. RLS select is brand_id = auth.uid(). Deletes follow the profile.';
comment on column public.api_keys.prefix is
  'Public lookup id embedded in the bearer token. Unique. Not the secret.';
comment on column public.api_keys.key_hash is
  'SHA-256 hex of the full bearer token. Never a plaintext secret.';
comment on column public.api_keys.scopes is
  'Subset of read, write:campaigns, write:outreach.';
comment on column public.api_keys.revoked_at is
  'Set when the key is revoked. Revoked keys fail authentication.';

-- -------------------- api_rate_windows --------------------

create table if not exists public.api_rate_windows (
  key_id        uuid not null references public.api_keys(id) on delete cascade,
  window_start  timestamptz not null,
  count         int not null,
  primary key (key_id, window_start)
);

alter table public.api_rate_windows add column if not exists key_id uuid;
alter table public.api_rate_windows add column if not exists window_start timestamptz;
alter table public.api_rate_windows add column if not exists count int;

alter table public.api_rate_windows alter column key_id set not null;
alter table public.api_rate_windows alter column window_start set not null;
alter table public.api_rate_windows alter column count set not null;

alter table public.api_rate_windows drop constraint if exists api_rate_windows_key_id_fkey;
alter table public.api_rate_windows
  add constraint api_rate_windows_key_id_fkey
  foreign key (key_id) references public.api_keys(id) on delete cascade;

alter table public.api_rate_windows drop constraint if exists api_rate_windows_count_nonneg;
alter table public.api_rate_windows
  add constraint api_rate_windows_count_nonneg check (count >= 0);

comment on table public.api_rate_windows is
  'Per-key per-minute request counters for the public API. service_role only.';
comment on column public.api_rate_windows.count is
  'Requests seen in this window. Incremented by increment_api_rate_window.';

-- -------------------- grants (before RLS) --------------------

revoke all on table public.api_keys from public;
revoke all on table public.api_keys from anon;
revoke all on table public.api_keys from authenticated;

revoke all on table public.api_rate_windows from public;
revoke all on table public.api_rate_windows from anon;
revoke all on table public.api_rate_windows from authenticated;

grant select, insert, update, delete on public.api_keys to service_role;
grant select, insert, update, delete on public.api_rate_windows to service_role;
grant select (
  id,
  brand_id,
  name,
  prefix,
  scopes,
  created_at,
  last_used_at,
  revoked_at
) on public.api_keys to authenticated;
revoke select (key_hash) on public.api_keys from authenticated;

-- Default privileges also grant truncate, references, and trigger
-- to authenticated. revoke all above clears them. Repeat the three
-- so a later grant of select cannot be mistaken for those privileges.
revoke truncate, references, trigger on table public.api_keys from authenticated;
revoke truncate, references, trigger on table public.api_rate_windows from authenticated;

-- -------------------- RLS --------------------

alter table public.api_keys enable row level security;
alter table public.api_rate_windows enable row level security;

-- Read own keys. No insert, update, or delete policy: writes run
-- as service_role, which bypasses RLS. api_rate_windows has no
-- policy, so authenticated and anon cannot read or write it.

drop policy if exists "Brand selects own api keys" on public.api_keys;
create policy "Brand selects own api keys"
  on public.api_keys
  for select
  to authenticated
  using (brand_id = auth.uid());

-- -------------------- rate window increment --------------------

create or replace function public.increment_api_rate_window(
  p_key_id uuid,
  p_window_start timestamptz
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.api_rate_windows (key_id, window_start, count)
  values (p_key_id, p_window_start, 1)
  on conflict (key_id, window_start)
  do update set count = api_rate_windows.count + 1
  returning count into v_count;

  delete from public.api_rate_windows
  where key_id = p_key_id
    and window_start < p_window_start - interval '1 hour';

  return v_count;
end;
$$;

revoke all on function public.increment_api_rate_window(uuid, timestamptz) from public;
revoke all on function public.increment_api_rate_window(uuid, timestamptz) from anon;
revoke all on function public.increment_api_rate_window(uuid, timestamptz) from authenticated;
grant execute on function public.increment_api_rate_window(uuid, timestamptz) to service_role;

comment on function public.increment_api_rate_window(uuid, timestamptz) is
  'Atomic per-key per-minute counter. Returns the count after this request. service_role only.';
