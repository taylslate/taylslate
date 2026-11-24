-- ============================================================
-- 094: outreach relay threads and brand CRM show links
--
-- NOT APPLIED LIVE, CHRIS MUST NAME IT.
-- Do not run this from the app, a seed script, or a deploy hook.
-- Paste it into the Supabase SQL Editor only after Chris names it.
--
-- Four tables:
--   relay_threads: one private reply address per outreach. The
--     address token is a bearer secret. service_role only.
--   relay_messages: stripped text RELAY1b will store. Created now
--     so 1b needs no migration. service_role only.
--   relay_inbound_events: svix-id replay guard for RELAY1b.
--     service_role only.
--   brand_crm_shows: a catalog show added to a brand's CRM when
--     outreach is sent. Name is read from shows. No email column.
--     No phone column. The owner may select. Inserts are
--     service_role after the plan check. authenticated cannot
--     insert, update, or delete.
--
-- The app keeps working when this file is not applied. Thread
-- and CRM writes fail soft.
--
-- Idempotent. Safe to re-run.
--
-- Introspection (run after applying, read only):
--   select grantee, table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name in (
--        'relay_threads',
--        'relay_messages',
--        'relay_inbound_events',
--        'brand_crm_shows'
--      )
--    order by table_name, grantee, privilege_type;
--   Expected: service_role has select, insert, update, delete
--   on all four. authenticated has select on brand_crm_shows
--   only. anon and public have nothing.
--   select c.relname, c.relrowsecurity
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname in (
--        'relay_threads',
--        'relay_messages',
--        'relay_inbound_events',
--        'brand_crm_shows'
--      )
--    order by 1;
--   Expected: relrowsecurity true for all four.
--   select schemaname, tablename, policyname, roles, cmd
--     from pg_policies
--    where schemaname = 'public'
--      and tablename in (
--        'relay_threads',
--        'relay_messages',
--        'relay_inbound_events',
--        'brand_crm_shows'
--      )
--    order by tablename, policyname;
--   Expected: exactly one policy, on brand_crm_shows, select,
--   authenticated.
-- ============================================================

create table if not exists public.relay_threads (
  id uuid primary key default gen_random_uuid(),
  outreach_id uuid not null references public.outreaches(id) on delete cascade,
  deal_id uuid null references public.deals(id) on delete set null,
  brand_user_id uuid not null references public.profiles(id) on delete cascade,
  brand_profile_id uuid not null references public.brand_profiles(id) on delete cascade,
  address_token text not null,
  brand_display_name text not null,
  show_display_name text not null,
  created_at timestamptz not null default now()
);

alter table public.relay_threads drop constraint if exists relay_threads_outreach_id_key;
alter table public.relay_threads
  add constraint relay_threads_outreach_id_key unique (outreach_id);

alter table public.relay_threads drop constraint if exists relay_threads_deal_id_key;
alter table public.relay_threads
  add constraint relay_threads_deal_id_key unique (deal_id);

alter table public.relay_threads drop constraint if exists relay_threads_address_token_key;
alter table public.relay_threads
  add constraint relay_threads_address_token_key unique (address_token);

alter table public.relay_threads drop constraint if exists relay_threads_address_token_check;
alter table public.relay_threads
  add constraint relay_threads_address_token_check
  check (address_token ~ '^[a-z2-7]{26}$');

alter table public.relay_threads drop constraint if exists relay_threads_brand_display_name_check;
alter table public.relay_threads
  add constraint relay_threads_brand_display_name_check
  check (char_length(btrim(brand_display_name)) between 1 and 120);

alter table public.relay_threads drop constraint if exists relay_threads_show_display_name_check;
alter table public.relay_threads
  add constraint relay_threads_show_display_name_check
  check (char_length(btrim(show_display_name)) between 1 and 120);

create table if not exists public.relay_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.relay_threads(id) on delete cascade,
  direction text not null,
  body_text text not null,
  contact_details_removed boolean not null default false,
  attachments_dropped integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.relay_messages drop constraint if exists relay_messages_direction_check;
alter table public.relay_messages
  add constraint relay_messages_direction_check
  check (direction in ('brand_to_show', 'show_to_brand'));

alter table public.relay_messages drop constraint if exists relay_messages_body_text_check;
alter table public.relay_messages
  add constraint relay_messages_body_text_check
  check (char_length(body_text) between 1 and 20000);

create table if not exists public.relay_inbound_events (
  provider_event_id text primary key,
  received_at timestamptz not null default now()
);

create table if not exists public.brand_crm_shows (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.profiles(id) on delete cascade,
  show_id uuid not null references public.shows(id) on delete cascade,
  source text not null,
  outreach_id uuid null references public.outreaches(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.brand_crm_shows drop constraint if exists brand_crm_shows_source_check;
alter table public.brand_crm_shows
  add constraint brand_crm_shows_source_check
  check (source in ('outreach'));

alter table public.brand_crm_shows drop constraint if exists brand_crm_shows_brand_show_key;
alter table public.brand_crm_shows
  add constraint brand_crm_shows_brand_show_key unique (brand_id, show_id);

-- -------------------- grants (before RLS) --------------------

revoke all on table public.relay_threads from public, anon, authenticated;
revoke all on table public.relay_messages from public, anon, authenticated;
revoke all on table public.relay_inbound_events from public, anon, authenticated;
revoke all on table public.brand_crm_shows from public, anon, authenticated;

grant select, insert, update, delete on table public.relay_threads to service_role;
grant select, insert, update, delete on table public.relay_messages to service_role;
grant select, insert, update, delete on table public.relay_inbound_events to service_role;
grant select, insert, update, delete on table public.brand_crm_shows to service_role;

grant select on table public.brand_crm_shows to authenticated;
revoke truncate, references, trigger on table public.brand_crm_shows from authenticated;

-- -------------------- RLS --------------------

alter table public.relay_threads enable row level security;
alter table public.relay_messages enable row level security;
alter table public.relay_inbound_events enable row level security;
alter table public.brand_crm_shows enable row level security;

drop policy if exists "Brand selects own crm shows" on public.brand_crm_shows;
create policy "Brand selects own crm shows"
  on public.brand_crm_shows
  for select
  to authenticated
  using (brand_id = (select auth.uid()));
