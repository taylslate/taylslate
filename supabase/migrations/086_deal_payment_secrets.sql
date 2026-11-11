-- ============================================================
-- 086: move the SetupIntent client secret off deals
--
-- NOT applied. Apply only after merge and Chris's OK.
-- Paste into the Supabase SQL Editor, then introspect. Do not run
-- this from the app, a seed script, or a deploy hook.
--
-- deals.setup_intent_client_secret is a confirmable Stripe
-- credential. Every deals SELECT policy covers every column, and
-- authenticated holds table SELECT, so a show, a rep, an agency,
-- and a brand can read it through the Data API. This file moves
-- the value to deal_payment_secrets. That table is service_role
-- only: RLS on, no policies, anon and authenticated revoked.
--
-- Do not apply this before the SEC4 code is live. The code on main
-- before that merge still writes the column. After merge and before
-- this file is applied, the new code writes nothing to the column,
-- reads a table that may not exist (fail soft to null), and the
-- brand card form falls back to POST /api/deals/[id]/setup-intent.
--
-- Apply order: any order among 084, 085, and 086 is safe.
-- 084 only adds an index on command_agent_conversations.
-- 085 (SEC3, PR 90) re-grants deals INSERT on the legacy column list:
--   campaign_id, show_id, brand_id, agent_id, agency_id, status,
--   num_episodes, placement, ad_format, price_type, cpm_rate,
--   gross_cpm, guaranteed_downloads, net_per_episode,
--   gross_per_episode, total_net, total_gross, is_scripted,
--   is_personal_experience, reader_type, content_type,
--   pixel_required, competitor_exclusion, exclusivity_days,
--   rofr_days, flight_start, flight_end, notes.
-- That list does not include setup_intent_client_secret, so 085
-- does not need to drop the name. This file does not grant or
-- revoke anything on deals. Dropping the column leaves 085's
-- INSERT grant intact. Applying this file first, then that GRANT,
-- succeeds. Applying the GRANT first, then this drop, succeeds.
-- If a later 085 draft adds setup_intent_client_secret to that
-- GRANT list, drop the name before applying 085 after this file.
-- A GRANT that names a dropped column fails with undefined_column.
--
-- Idempotent. Safe to re-run. The backfill runs only while the
-- deals column still exists. The second run leaves the secret rows
-- unchanged.
--
-- Introspection (run after applying, read only):
--   select c.relrowsecurity
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname = 'deal_payment_secrets';
--   Expected: true.
--   select count(*) from pg_policies
--    where schemaname = 'public'
--      and tablename = 'deal_payment_secrets';
--   Expected: 0.
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'deal_payment_secrets'
--      and grantee in ('anon', 'PUBLIC', 'authenticated', 'service_role')
--    order by grantee, privilege_type;
--   Expected: service_role only.
--   select count(*)
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'deals'
--      and column_name = 'setup_intent_client_secret';
--   Expected: 0.
-- ============================================================

create table if not exists public.deal_payment_secrets (
  deal_id uuid primary key references public.deals(id) on delete cascade,
  setup_intent_client_secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Grants before RLS. service_role only. anon holds nothing.

revoke all on table public.deal_payment_secrets from public;
revoke all on table public.deal_payment_secrets from anon;
revoke all on table public.deal_payment_secrets from authenticated;
grant all on table public.deal_payment_secrets to service_role;
revoke truncate, references, trigger on table public.deal_payment_secrets from authenticated;

alter table public.deal_payment_secrets enable row level security;

-- Backfill while the column still exists. Dynamic SQL so a second
-- run, after the column is gone, does not plan a missing column.
-- 085's INSERT grant is not touched.

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'deals'
       and column_name = 'setup_intent_client_secret'
  ) then
    execute $backfill$
      insert into public.deal_payment_secrets (deal_id, setup_intent_client_secret)
      select d.id, d.setup_intent_client_secret
        from public.deals d
       where d.setup_intent_client_secret is not null
      on conflict (deal_id) do update
        set setup_intent_client_secret = excluded.setup_intent_client_secret,
            updated_at = now()
    $backfill$;
  end if;
end
$$;

alter table public.deals drop column if exists setup_intent_client_secret;
