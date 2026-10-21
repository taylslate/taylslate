-- ============================================================
-- 049: revoke anon privileges on show_surfaces
--
-- Migration 044 created public.show_surfaces and granted
-- service_role and authenticated. It did not revoke anon.
-- A new public table still receives the default anon grants,
-- and RLS has no policy for anon.
--
-- This revokes those privileges and re-asserts the 044 grants
-- and policies. It does not change user_owns_show.
--
-- NOT applied. Paste into the SQL editor, then introspect.
-- Idempotent. Safe to re-run. No backfill.
--
-- Numbered 049 so it does not collide with draft migrations
-- 045–048. It only touches show_surfaces, which 044 already
-- created, so it can be applied before those drafts.
--
-- Introspection (run after applying):
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'show_surfaces'
--    order by grantee, privilege_type;
--   Expected: authenticated and service_role only. No anon.
--   select polname, polroles::regrole[]
--     from pg_policy
--    where polrelid = 'public.show_surfaces'::regclass
--    order by polname;
-- ============================================================

revoke all privileges on table public.show_surfaces from anon;
revoke all privileges on table public.show_surfaces from public;

grant select, insert, update, delete on public.show_surfaces to service_role;
grant select, insert, update, delete on public.show_surfaces to authenticated;

alter table public.show_surfaces enable row level security;

drop policy if exists "Show owner manages own surfaces" on public.show_surfaces;
create policy "Show owner manages own surfaces"
  on public.show_surfaces
  for all
  to authenticated
  using (owner_user_id = auth.uid())
  with check (
    owner_user_id = auth.uid()
    and public.user_owns_show(show_id)
  );

drop policy if exists "Buyers read published surfaces" on public.show_surfaces;
create policy "Buyers read published surfaces"
  on public.show_surfaces
  for select
  to authenticated
  using (published = true);

drop policy if exists "Service role manages show surfaces" on public.show_surfaces;
create policy "Service role manages show surfaces"
  on public.show_surfaces
  for all
  to service_role
  using (true)
  with check (true);
