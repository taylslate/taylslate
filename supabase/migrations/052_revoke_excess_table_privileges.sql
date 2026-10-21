-- ============================================================
-- 052: revoke excess privileges on learning and surface tables
--
-- Supabase's default privileges grant anon, authenticated, and
-- service_role every table privilege when a public table is
-- created: select, insert, update, delete, truncate, references,
-- and trigger. Migrations 044, 047, and 049 then grant select,
-- insert, update, and delete. A grant does not remove the other
-- three.
--
-- 047 revokes anon and public on deal_conversion_reports and
-- learning_overrides. 049 revokes anon and public on
-- show_surfaces. Neither revokes authenticated first, so
-- authenticated keeps truncate, references, and trigger from
-- the default grant. Truncate ignores row level security.
-- References and trigger let that role add foreign keys and
-- triggers. Anon is included so a leftover default grant loses
-- the same three.
--
-- This revokes only those three privileges from anon and
-- authenticated. It does not grant or revoke select, insert,
-- update, or delete. It does not change service_role, public,
-- or any policy. The select/insert/update/delete grants that
-- RLS relies on stay as 044, 047, and 049 left them.
--
-- NOT applied. Paste into the SQL editor, then introspect.
-- Do not run this from the app, a seed script, or a deploy hook.
-- Idempotent. Safe to re-run. Revoking a privilege the role
-- does not hold changes nothing. No backfill.
--
-- Introspection (run after applying):
--   select grantee, table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name in (
--        'learning_overrides',
--        'deal_conversion_reports',
--        'show_surfaces'
--      )
--      and grantee in ('anon', 'authenticated')
--    order by table_name, grantee, privilege_type;
--   Expected: no truncate, references, or trigger for anon or
--   authenticated. authenticated still has select, insert,
--   update, and delete. anon still has whatever 047 and 049
--   left (no privileges, once those have been applied).
--   service_role is unchanged. Compare it with a query that
--   does not filter grantee.
-- ============================================================

revoke truncate, references, trigger on table public.learning_overrides from anon;
revoke truncate, references, trigger on table public.learning_overrides from authenticated;

revoke truncate, references, trigger on table public.deal_conversion_reports from anon;
revoke truncate, references, trigger on table public.deal_conversion_reports from authenticated;

revoke truncate, references, trigger on table public.show_surfaces from anon;
revoke truncate, references, trigger on table public.show_surfaces from authenticated;
