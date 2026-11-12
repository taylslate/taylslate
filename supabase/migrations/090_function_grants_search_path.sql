-- ============================================================
-- 090: function EXECUTE grants and pinned search_path
--
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge,
-- and only when Chris names 090. Paste into the Supabase SQL
-- Editor. Do not run this from the app, a seed script, or a
-- deploy hook.
--
-- What: pin search_path to '' on update_updated_at(),
-- reset_monthly_campaigns(), and get_avg_negotiated_cpm(uuid).
-- Revoke EXECUTE on get_avg_negotiated_cpm(uuid) from PUBLIC,
-- anon, and authenticated. service_role keeps EXECUTE.
-- Restate the live auth_login_email() grants. authenticated
-- keeps EXECUTE.
--
-- Why: get_avg_negotiated_cpm(uuid) is SECURITY DEFINER, owned
-- by postgres, with search_path unset. RLS does not apply.
-- A signed-out caller can read the average negotiated CPM for
-- any show through /rest/v1/rpc/get_avg_negotiated_cpm
-- (advisor anon_security_definer_function_executable, SA-06).
-- authenticated can call it too. update_updated_at,
-- reset_monthly_campaigns, and get_avg_negotiated_cpm have a
-- mutable search_path (advisor function_search_path_mutable,
-- SA-19).
--
-- Caller finding, grepped at 71a26ec: nothing in app, lib, or
-- scripts calls get_avg_negotiated_cpm. No policy, view, or
-- function body references it. Revoking PUBLIC, anon, and
-- authenticated is safe.
--
-- auth_login_email() has no supabase.rpc caller. RLS calls it
-- as the querying role:
--   policy "Shows readable by signed-in participants"
--     on public.shows (071 and 077);
--   policy "Show reads outreach to their email"
--     on public.outreaches (077);
--   public.user_owns_show(uuid), which the show_surfaces
--     policy calls (077).
-- A policy expression runs with the caller's privileges.
-- Revoking EXECUTE from authenticated would make every
-- signed-in SELECT on shows and outreaches fail. authenticated
-- keeps EXECUTE. anon and PUBLIC already hold none (071 and
-- 077). The authenticated advisor warning is accepted: the
-- function returns only the login email for auth.uid().
--
-- Bodies stay byte for byte. This file is ALTER and REVOKE
-- only. Every name in the three bodies is schema-qualified
-- (public.profiles, public.deals) or in pg_catalog (now,
-- date_trunc, avg, count), so search_path '' is safe.
-- Grants on update_updated_at and reset_monthly_campaigns
-- are not changed.
--
-- Apply order: any time after merge, when Chris names 090.
-- Independent of deploy. No app code changes.
-- Idempotent. Safe to re-run.
--
-- Live verify, SELECT only, after apply:
--   select p.oid::regprocedure as fn, p.prosecdef, p.proconfig,
--          has_function_privilege('anon', p.oid, 'execute') as anon_x,
--          has_function_privilege('authenticated', p.oid, 'execute') as auth_x,
--          has_function_privilege('service_role', p.oid, 'execute') as svc_x,
--          coalesce(p.proacl::text, '') like '%{=X%' or coalesce(p.proacl::text, '') like '%,=X%' as public_x
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('get_avg_negotiated_cpm', 'auth_login_email', 'update_updated_at', 'reset_monthly_campaigns')
--    order by 1;
--   Expected. p.proconfig is a text array, so a value that contains
--   quotes, commas, or spaces is printed with extra quotes.
--   Empty search_path prints as {"search_path=\"\""}.
--     get_avg_negotiated_cpm(uuid): definer, {"search_path=\"\""}, anon false, authenticated false, service_role true, public false.
--     auth_login_email(): definer, {"search_path=auth, public, pg_temp"}, anon false, authenticated true, service_role true, public false.
--     reset_monthly_campaigns() and update_updated_at(): invoker, {"search_path=\"\""}, grants unchanged.
-- ============================================================

alter function public.update_updated_at() set search_path = '';

alter function public.reset_monthly_campaigns() set search_path = '';

alter function public.get_avg_negotiated_cpm(uuid) set search_path = '';

revoke all on function public.get_avg_negotiated_cpm(uuid) from public;
revoke all on function public.get_avg_negotiated_cpm(uuid) from anon;
revoke all on function public.get_avg_negotiated_cpm(uuid) from authenticated;
grant execute on function public.get_avg_negotiated_cpm(uuid) to service_role;

-- auth_login_email() grants, restated as live. No-op guard.
-- Callers that run as authenticated and need EXECUTE:
--   "Shows readable by signed-in participants" on public.shows
--   "Show reads outreach to their email" on public.outreaches
--   public.user_owns_show(uuid), called by the show_surfaces policy
-- authenticated stays. anon and PUBLIC stay revoked.
revoke all on function public.auth_login_email() from public;
revoke all on function public.auth_login_email() from anon;
grant execute on function public.auth_login_email() to authenticated;
grant execute on function public.auth_login_email() to service_role;
