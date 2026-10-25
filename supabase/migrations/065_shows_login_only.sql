-- ============================================================
-- 065: shows are login-only
--
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK.
-- Apply only after 060. Paste into the Supabase SQL
-- Editor, then introspect. Do not run this from the app, a seed
-- script, or a deploy hook.
--
-- 061 is reserved for the O1 drop of show_claims. 062, 063, and
-- 064 are not in the repo. This is the next free number after 064.
-- Apply 066 after this file. Do not re-run 060 after this file:
-- 060 grants anon SELECT on public.shows back.
--
-- 060 left anon one privilege, SELECT on public.shows, and left
-- the policy "Shows are publicly readable". The app is login-only.
-- Signed-out reads are rejected in the route handlers. This
-- revokes that select, and every other anon and public privilege
-- on every table in public, so anon has nothing on public tables.
--
-- It also changes default privileges so a new table, sequence, or
-- function created in public by the pasting role, by postgres, or
-- by supabase_admin (when that role exists) does not grant anything
-- to anon or to public. Existing function execute grants are not
-- swept. No migration grants anon execute.
--
-- Authenticated DML outside the 26 tables in 060 is left in place.
-- Session clients and RLS policies still use it. The safe fix is
-- to revoke truncate, references, and trigger again. Those three
-- ignore or extend row level security. Revoke is skipped when the
-- table is absent, so a partial history does not abort the paste.
--
-- Authenticated grants that remain, and why:
--   agent_show_relationships: SELECT. Writes are service_role (055).
--   show_surfaces: SELECT, INSERT, UPDATE, DELETE. Owner policy (044).
--   benchmarks: SELECT. Read policy (045).
--   deal_conversion_reports: SELECT, INSERT, UPDATE, DELETE (047).
--   learning_overrides: SELECT, INSERT, UPDATE, DELETE (047).
--   make_goods: SELECT (048).
--   brand_show_contacts: SELECT, INSERT, UPDATE, DELETE. CRM (053).
--   brand_show_notes: SELECT, INSERT, UPDATE, DELETE. CRM (053).
--   past_campaign_imports: SELECT, INSERT, UPDATE, DELETE (054).
--   past_campaign_records: SELECT, INSERT, UPDATE, DELETE (054).
--   api_keys: column SELECT on id, brand_id, name, prefix, scopes,
--     created_at, last_used_at, revoked_at. Not key_hash (057).
-- Authenticated holds nothing, and this file does not grant it, on
-- airchecks, login_otp_limits, api_rate_windows, pooled_import_priors.
--
-- service_role is not granted or revoked. No policy change.
-- Idempotent. Safe to re-run. No backfill. No table shape change.
--
-- Introspection (run after applying):
--   select grantee, table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and grantee in ('anon', 'PUBLIC')
--    order by grantee, table_name, privilege_type;
--   Expected: no rows.
--   select table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and grantee = 'authenticated'
--      and table_name in (
--        'agent_show_relationships', 'show_surfaces', 'benchmarks',
--        'deal_conversion_reports', 'learning_overrides', 'make_goods',
--        'brand_show_contacts', 'brand_show_notes',
--        'past_campaign_imports', 'past_campaign_records', 'api_keys'
--      )
--      and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
--    order by table_name, privilege_type;
--   Expected: no rows.
--   select privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'shows'
--      and grantee = 'anon';
--   Expected: no rows.
-- ============================================================

revoke all on table public.shows from public;
revoke all on table public.shows from anon;

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from public;
revoke all on all sequences in schema public from anon;
revoke all on all sequences in schema public from public;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on tables from public;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on sequences from public;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on functions from public;

do $$
declare
  role_name text;
begin
  foreach role_name in array array['postgres', 'supabase_admin']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      begin
        execute format(
          'alter default privileges for role %I in schema public revoke all on tables from anon',
          role_name
        );
        execute format(
          'alter default privileges for role %I in schema public revoke all on tables from public',
          role_name
        );
        execute format(
          'alter default privileges for role %I in schema public revoke all on sequences from anon',
          role_name
        );
        execute format(
          'alter default privileges for role %I in schema public revoke all on sequences from public',
          role_name
        );
        execute format(
          'alter default privileges for role %I in schema public revoke all on functions from anon',
          role_name
        );
        execute format(
          'alter default privileges for role %I in schema public revoke all on functions from public',
          role_name
        );
      exception
        when insufficient_privilege then
          raise notice '065: skipped default privileges for role %', role_name;
      end;
    end if;
  end loop;
end $$;

-- Truncate, references, and trigger on tables outside 060's 26.
-- Select, insert, update, and delete are not revoked.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'agent_show_relationships',
    'show_surfaces',
    'benchmarks',
    'deal_conversion_reports',
    'learning_overrides',
    'make_goods',
    'brand_show_contacts',
    'brand_show_notes',
    'past_campaign_imports',
    'past_campaign_records',
    'api_keys',
    'api_rate_windows',
    'airchecks',
    'login_otp_limits',
    'pooled_import_priors'
  ]
  loop
    if to_regclass('public.' || table_name) is not null then
      execute format(
        'revoke truncate, references, trigger on table public.%I from authenticated',
        table_name
      );
      execute format(
        'revoke truncate, references, trigger on table public.%I from anon',
        table_name
      );
    end if;
  end loop;
end $$;
