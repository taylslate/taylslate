-- ============================================================
-- Migration 020 — Data API grants (re-assert on all tables)
-- ============================================================
--
-- WHY THIS EXISTS:
--   Supabase is changing Data API behavior: new tables in the `public`
--   schema are no longer auto-exposed to supabase-js / PostgREST / GraphQL.
--   Enforced on all existing projects Oct 30, 2026.
--
--   Existing tables (migrations 001-019) are grandfathered and keep their
--   current grants, so this migration is NOT required to keep production
--   working today. It exists to:
--     1. Document in migration history that the project is handling the change.
--     2. Make grants reproducible — if the project is ever rebuilt from
--        migration files (staging env, DR), grants come with it instead of
--        silently breaking.
--
--   GRANT is idempotent. Re-running this migration is safe and a no-op.
--
-- GOING FORWARD:
--   Every new `CREATE TABLE` in `public` must include its own grant block.
--   See "Supabase Conventions" in CLAUDE.md for the standard block and the
--   rule on when `anon` is appropriate.
--
-- ANON ACCESS POLICY:
--   `anon` is granted SELECT ONLY on genuinely public-facing tables:
--     - shows                  (publicly readable per Wave 1 RLS design)
--     - show_profiles          (backs the public pitch page at /outreach/[token])
--   Everything else: NO anon grant. Public flows (pitch page, claim show)
--   go through server-side API routes using service_role, not direct anon access.
--   RLS still applies on top of all grants.
-- ============================================================


-- ============================================================
-- service_role — full access on EVERY table.
-- Server-side code (lib/supabase/server.ts, admin.ts) depends on this.
-- Grants are checked BEFORE RLS, so a missing grant here breaks
-- server queries even when RLS would allow them.
-- ============================================================

grant select, insert, update, delete on public.agent_show_relationships to service_role;
grant select, insert, update, delete on public.analog_matches           to service_role;
grant select, insert, update, delete on public.api_cache_log            to service_role;
grant select, insert, update, delete on public.brand_profiles           to service_role;
grant select, insert, update, delete on public.campaign_patterns        to service_role;
grant select, insert, update, delete on public.campaigns                to service_role;
grant select, insert, update, delete on public.conviction_scores        to service_role;
grant select, insert, update, delete on public.deals                    to service_role;
grant select, insert, update, delete on public.domain_events            to service_role;
grant select, insert, update, delete on public.founder_annotations      to service_role;
grant select, insert, update, delete on public.insertion_orders         to service_role;
grant select, insert, update, delete on public.invoice_line_items       to service_role;
grant select, insert, update, delete on public.invoices                 to service_role;
grant select, insert, update, delete on public.io_line_items            to service_role;
grant select, insert, update, delete on public.outcomes                 to service_role;
grant select, insert, update, delete on public.outreaches               to service_role;
grant select, insert, update, delete on public.payments                 to service_role;
grant select, insert, update, delete on public.profiles                 to service_role;
grant select, insert, update, delete on public.ring_hypotheses          to service_role;
grant select, insert, update, delete on public.show_claims              to service_role;
grant select, insert, update, delete on public.show_profiles            to service_role;
grant select, insert, update, delete on public.show_sponsors            to service_role;
grant select, insert, update, delete on public.shows                    to service_role;


-- ============================================================
-- authenticated — read/write on tables the app touches as a
-- logged-in user. RLS policies still filter which ROWS are visible;
-- these grants are the table-level gate.
--
-- Append-only audit logs (domain_events, api_cache_log) are intentionally
-- service_role-only — the app never reads/writes them as a normal user.
-- ============================================================

grant select, insert, update, delete on public.agent_show_relationships to authenticated;
grant select, insert, update, delete on public.analog_matches           to authenticated;
grant select, insert, update, delete on public.brand_profiles           to authenticated;
grant select, insert, update, delete on public.campaign_patterns        to authenticated;
grant select, insert, update, delete on public.campaigns                to authenticated;
grant select, insert, update, delete on public.conviction_scores        to authenticated;
grant select, insert, update, delete on public.deals                    to authenticated;
grant select, insert, update, delete on public.founder_annotations      to authenticated;
grant select, insert, update, delete on public.insertion_orders         to authenticated;
grant select, insert, update, delete on public.invoice_line_items       to authenticated;
grant select, insert, update, delete on public.invoices                 to authenticated;
grant select, insert, update, delete on public.io_line_items            to authenticated;
grant select, insert, update, delete on public.outcomes                 to authenticated;
grant select, insert, update, delete on public.outreaches               to authenticated;
grant select, insert, update, delete on public.payments                 to authenticated;
grant select, insert, update, delete on public.profiles                 to authenticated;
grant select, insert, update, delete on public.ring_hypotheses          to authenticated;
grant select, insert, update, delete on public.show_claims              to authenticated;
grant select, insert, update, delete on public.show_profiles            to authenticated;
grant select, insert, update, delete on public.show_sponsors            to authenticated;
grant select, insert, update, delete on public.shows                    to authenticated;


-- ============================================================
-- anon — SELECT only, public-facing tables only.
-- Deliberately narrow. Do NOT add tables here without a reason.
-- ============================================================

grant select on public.shows         to anon;
grant select on public.show_profiles to anon;
