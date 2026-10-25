-- ============================================================
-- 066: shows writes are owner or admin, through service_role
--
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK.
-- Apply only after 065. Paste into the Supabase SQL
-- Editor, then introspect. Do not run this from the app, a seed
-- script, or a deploy hook.
--
-- Policies "Shows insert by authenticated" and "Shows update by
-- authenticated" (003) only check auth.uid() IS NOT NULL, so any
-- signed-in user can insert or update any show through PostgREST.
-- This drops those two policies and revokes insert, update, and
-- delete on public.shows from authenticated. Truncate, references,
-- and trigger are revoked again. Authenticated keeps SELECT.
--
-- The policy "Shows are publicly readable" is not dropped. Anon
-- has no table privilege after 065, so that policy does not expose
-- rows to a signed-out caller. This file does not grant anon
-- select. It does not revoke select from authenticated.
--
-- App writes go through supabaseAdmin after canEditShow, or after
-- an agent or admin check on import. service_role is not granted
-- or revoked here. It already has the write grants from 020.
--
-- Idempotent. Safe to re-run. No backfill. No table shape change.
--
-- Introspection (run after applying):
--   select privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'shows'
--      and grantee = 'authenticated'
--    order by privilege_type;
--   Expected: SELECT only.
--   select polname
--     from pg_policy
--    where polrelid = 'public.shows'::regclass
--    order by polname;
--   Expected: "Shows are publicly readable" still present.
--   "Shows insert by authenticated" and "Shows update by
--   authenticated" absent.
--   As authenticated, insert and update on public.shows fail with
--   permission denied. As service_role, insert succeeds.
-- ============================================================

drop policy if exists "Shows insert by authenticated" on public.shows;
drop policy if exists "Shows update by authenticated" on public.shows;

revoke insert, update, delete on table public.shows from authenticated;
revoke truncate, references, trigger on table public.shows from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.shows from public;

-- Authenticated select stays. Anon is not granted anything.
