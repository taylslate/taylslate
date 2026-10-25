-- ============================================================
-- 060: public table grant hardening
--
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK.
-- Paste into the Supabase SQL Editor, then introspect. Do not run this
-- from the app, a seed script, or a deploy hook.
--
-- Live read on 2026-10-25: anon, authenticated, and service_role each
-- hold select, insert, update, delete, truncate, references, and
-- trigger on the 26 tables below. The public role holds none.
-- RLS is already on for all 26. Truncate is not checked by RLS.
--
-- This revokes anon and public write, truncate, references, and
-- trigger on every listed table. It also revokes anon select on
-- every listed table, including public.shows. A re-run must not
-- grant that select back. The first paste of this file did grant
-- it; that line is gone. 065 revokes it on a database that still
-- has the old grant. The policy "Shows are publicly readable"
-- is not changed.
--
-- authenticated keeps select, insert, update, and delete on the
-- 22 tables the signed-in app uses. authenticated loses truncate,
-- references, and trigger on all 26.
--
-- api_cache_log, domain_events, event_log, and show_claims become
-- service_role only. No policies are added. show_claims has no
-- rows and is dropped in O1 (061). This migration only locks it.
--
-- service_role is not granted or revoked.
-- Idempotent. Safe to re-run. No backfill. No table shape change.
--
-- Introspection (run after applying):
--   select grantee, table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and grantee in ('anon', 'PUBLIC')
--    order by grantee, table_name, privilege_type;
--   Expected: no rows. Anon and PUBLIC have no privileges on
--   these tables. A re-run does not grant anon SELECT on shows.
--   select table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and grantee = 'authenticated'
--      and table_name in (
--        'analog_matches', 'api_cache_log', 'brand_profiles',
--        'campaign_patterns', 'campaigns', 'conviction_scores',
--        'deals', 'discovery_locks', 'domain_events', 'event_log',
--        'founder_annotations', 'insertion_orders',
--        'interpretation_locks', 'invoice_line_items', 'invoices',
--        'io_line_items', 'outcomes', 'outreaches', 'payments',
--        'payouts', 'profiles', 'ring_hypotheses', 'show_claims',
--        'show_profiles', 'show_sponsors', 'shows'
--      )
--      and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
--    order by table_name, privilege_type;
--   Expected: no rows.
--   select privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and grantee = 'authenticated'
--      and table_name in (
--        'api_cache_log', 'domain_events', 'event_log', 'show_claims'
--      );
--   Expected: no rows.
--   select c.relname, c.relrowsecurity
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname in (
--        'analog_matches', 'api_cache_log', 'brand_profiles',
--        'campaign_patterns', 'campaigns', 'conviction_scores',
--        'deals', 'discovery_locks', 'domain_events', 'event_log',
--        'founder_annotations', 'insertion_orders',
--        'interpretation_locks', 'invoice_line_items', 'invoices',
--        'io_line_items', 'outcomes', 'outreaches', 'payments',
--        'payouts', 'profiles', 'ring_hypotheses', 'show_claims',
--        'show_profiles', 'show_sponsors', 'shows'
--      )
--    order by c.relname;
--   Expected: relrowsecurity true for all 26.
-- ============================================================

-- -------------------- shows --------------------
-- Anon loses every privilege, including SELECT. Do not grant it
-- back. A re-run of this file must not restore anon SELECT.

revoke all on table public.shows from public;
revoke all on table public.shows from anon;
revoke truncate, references, trigger on table public.shows from authenticated;
alter table public.shows enable row level security;

-- -------------------- authenticated app tables --------------------
-- Anon and public lose every privilege. authenticated keeps
-- select, insert, update, and delete.

revoke all on table public.analog_matches from public;
revoke all on table public.analog_matches from anon;
revoke truncate, references, trigger on table public.analog_matches from authenticated;
alter table public.analog_matches enable row level security;

revoke all on table public.brand_profiles from public;
revoke all on table public.brand_profiles from anon;
revoke truncate, references, trigger on table public.brand_profiles from authenticated;
alter table public.brand_profiles enable row level security;

revoke all on table public.campaign_patterns from public;
revoke all on table public.campaign_patterns from anon;
revoke truncate, references, trigger on table public.campaign_patterns from authenticated;
alter table public.campaign_patterns enable row level security;

revoke all on table public.campaigns from public;
revoke all on table public.campaigns from anon;
revoke truncate, references, trigger on table public.campaigns from authenticated;
alter table public.campaigns enable row level security;

revoke all on table public.conviction_scores from public;
revoke all on table public.conviction_scores from anon;
revoke truncate, references, trigger on table public.conviction_scores from authenticated;
alter table public.conviction_scores enable row level security;

revoke all on table public.deals from public;
revoke all on table public.deals from anon;
revoke truncate, references, trigger on table public.deals from authenticated;
alter table public.deals enable row level security;

revoke all on table public.discovery_locks from public;
revoke all on table public.discovery_locks from anon;
revoke truncate, references, trigger on table public.discovery_locks from authenticated;
alter table public.discovery_locks enable row level security;

revoke all on table public.founder_annotations from public;
revoke all on table public.founder_annotations from anon;
revoke truncate, references, trigger on table public.founder_annotations from authenticated;
alter table public.founder_annotations enable row level security;

revoke all on table public.insertion_orders from public;
revoke all on table public.insertion_orders from anon;
revoke truncate, references, trigger on table public.insertion_orders from authenticated;
alter table public.insertion_orders enable row level security;

revoke all on table public.interpretation_locks from public;
revoke all on table public.interpretation_locks from anon;
revoke truncate, references, trigger on table public.interpretation_locks from authenticated;
alter table public.interpretation_locks enable row level security;

revoke all on table public.invoice_line_items from public;
revoke all on table public.invoice_line_items from anon;
revoke truncate, references, trigger on table public.invoice_line_items from authenticated;
alter table public.invoice_line_items enable row level security;

revoke all on table public.invoices from public;
revoke all on table public.invoices from anon;
revoke truncate, references, trigger on table public.invoices from authenticated;
alter table public.invoices enable row level security;

revoke all on table public.io_line_items from public;
revoke all on table public.io_line_items from anon;
revoke truncate, references, trigger on table public.io_line_items from authenticated;
alter table public.io_line_items enable row level security;

revoke all on table public.outcomes from public;
revoke all on table public.outcomes from anon;
revoke truncate, references, trigger on table public.outcomes from authenticated;
alter table public.outcomes enable row level security;

revoke all on table public.outreaches from public;
revoke all on table public.outreaches from anon;
revoke truncate, references, trigger on table public.outreaches from authenticated;
alter table public.outreaches enable row level security;

revoke all on table public.payments from public;
revoke all on table public.payments from anon;
revoke truncate, references, trigger on table public.payments from authenticated;
alter table public.payments enable row level security;

revoke all on table public.payouts from public;
revoke all on table public.payouts from anon;
revoke truncate, references, trigger on table public.payouts from authenticated;
alter table public.payouts enable row level security;

revoke all on table public.profiles from public;
revoke all on table public.profiles from anon;
revoke truncate, references, trigger on table public.profiles from authenticated;
alter table public.profiles enable row level security;

revoke all on table public.ring_hypotheses from public;
revoke all on table public.ring_hypotheses from anon;
revoke truncate, references, trigger on table public.ring_hypotheses from authenticated;
alter table public.ring_hypotheses enable row level security;

revoke all on table public.show_profiles from public;
revoke all on table public.show_profiles from anon;
revoke truncate, references, trigger on table public.show_profiles from authenticated;
alter table public.show_profiles enable row level security;

revoke all on table public.show_sponsors from public;
revoke all on table public.show_sponsors from anon;
revoke truncate, references, trigger on table public.show_sponsors from authenticated;
alter table public.show_sponsors enable row level security;

-- -------------------- service_role only --------------------
-- No policies. Authenticated session code does not read or write
-- these tables. service_role is left as it is.

-- api_cache_log is service_role only.
revoke all on table public.api_cache_log from public;
revoke all on table public.api_cache_log from anon;
revoke all on table public.api_cache_log from authenticated;
revoke truncate, references, trigger on table public.api_cache_log from authenticated;
alter table public.api_cache_log enable row level security;

-- domain_events is service_role only.
revoke all on table public.domain_events from public;
revoke all on table public.domain_events from anon;
revoke all on table public.domain_events from authenticated;
revoke truncate, references, trigger on table public.domain_events from authenticated;
alter table public.domain_events enable row level security;

-- event_log is service_role only.
revoke all on table public.event_log from public;
revoke all on table public.event_log from anon;
revoke all on table public.event_log from authenticated;
revoke truncate, references, trigger on table public.event_log from authenticated;
alter table public.event_log enable row level security;

-- show_claims is service_role only. The table has no rows and is
-- dropped in O1 (061). This migration only locks it.
revoke all on table public.show_claims from public;
revoke all on table public.show_claims from anon;
revoke all on table public.show_claims from authenticated;
revoke truncate, references, trigger on table public.show_claims from authenticated;
alter table public.show_claims enable row level security;
