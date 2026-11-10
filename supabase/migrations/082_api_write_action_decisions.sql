-- ============================================================
-- 082: decisions on public API write actions
--
-- NOT applied. Apply only after merge and Chris's OK.
-- Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK.
-- Paste into the Supabase SQL Editor, then introspect. Do not run
-- this from the app, a seed script, or a deploy hook.
--
-- 080 is reserved for AC3 and 081 for Q12. This file is 082.
-- It alters public.api_write_actions only. It does not backfill.
-- All live rows are pending, so the decision check validates.
--
-- A brand approves or rejects a pending row in a later request.
-- Approving campaign.create may create one draft campaign.
-- Approving outreach.draft records the decision only. It does
-- not send, and it does not insert an outreach row.
--
-- service_role remains the only role that can touch the table.
-- RLS stays enabled. There is still no policy.
--
-- Idempotent. Safe to re-run. No backfill.
--
-- Introspection (run after applying):
--   select column_name
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'api_write_actions'
--      and column_name in (
--        'decision_note', 'execution_started_at', 'executed_at',
--        'result_campaign_id', 'execution_error'
--      )
--    order by column_name;
--   Expected: those five columns.
--   select conname
--     from pg_constraint
--    where conrelid = 'public.api_write_actions'::regclass
--      and conname in (
--        'api_write_actions_decision_note_len_check',
--        'api_write_actions_execution_error_len_check',
--        'api_write_actions_decision_present_check',
--        'api_write_actions_result_campaign_id_fkey'
--      )
--    order by conname;
--   Expected: those four constraints.
--   select c.relrowsecurity
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname = 'api_write_actions';
--   Expected: true.
--   select count(*)
--     from pg_policies
--    where schemaname = 'public'
--      and tablename = 'api_write_actions';
--   Expected: 0.
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'api_write_actions'
--    order by grantee, privilege_type;
--   Expected: service_role only. Nothing for anon, public,
--   or authenticated.
-- ============================================================

alter table public.api_write_actions
  add column if not exists decision_note text;

alter table public.api_write_actions
  add column if not exists execution_started_at timestamptz;

alter table public.api_write_actions
  add column if not exists executed_at timestamptz;

alter table public.api_write_actions
  add column if not exists result_campaign_id uuid;

alter table public.api_write_actions
  add column if not exists execution_error text;

alter table public.api_write_actions
  drop constraint if exists api_write_actions_result_campaign_id_fkey;

alter table public.api_write_actions
  add constraint api_write_actions_result_campaign_id_fkey
  foreign key (result_campaign_id) references public.campaigns(id) on delete set null;

alter table public.api_write_actions
  drop constraint if exists api_write_actions_decision_note_len_check;

alter table public.api_write_actions
  add constraint api_write_actions_decision_note_len_check
  check (decision_note is null or char_length(decision_note) <= 500);

alter table public.api_write_actions
  drop constraint if exists api_write_actions_execution_error_len_check;

alter table public.api_write_actions
  add constraint api_write_actions_execution_error_len_check
  check (execution_error is null or char_length(execution_error) <= 300);

alter table public.api_write_actions
  drop constraint if exists api_write_actions_decision_present_check;

alter table public.api_write_actions
  add constraint api_write_actions_decision_present_check
  check (
    status not in ('approved', 'rejected')
    or (decided_by is not null and decided_at is not null)
  );

comment on column public.api_write_actions.decision_note is
  'Optional note from the brand who decided the row. At most 500 characters.';

comment on column public.api_write_actions.execution_started_at is
  'Set when a campaign.create approval claims execution. A claim older than 5 minutes can be retried.';

comment on column public.api_write_actions.executed_at is
  'Set when campaign.create finishes and result_campaign_id is stored.';

comment on column public.api_write_actions.result_campaign_id is
  'Draft campaign created from an approved campaign.create action. Null until then.';

comment on column public.api_write_actions.execution_error is
  'Short reason when an approved campaign.create did not create a campaign. At most 300 characters.';

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
