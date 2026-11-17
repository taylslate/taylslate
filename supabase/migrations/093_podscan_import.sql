-- ============================================================
-- 093: Internal Podscan catalog and show contacts
--
-- NOT applied. Apply only after merge and Chris's OK.
-- Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK.
-- Paste into the Supabase SQL Editor. Do not run this from
-- the app, a seed script, or a deploy hook.
--
-- One-time import of Podscan shows worth keeping before the
-- plan renews. Brands cannot read these tables. Nothing here
-- is written to public.shows. show_id is a data link only,
-- set when exactly one shows row has the same podscan_id.
-- It is not a trust or ownership tie.
--
-- service_role only. No policy. No function. No view.
-- Idempotent. Safe to re-run.
--
-- Introspection (run after applying, read only):
--   select c.relname, c.relrowsecurity
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname in ('podscan_catalog', 'show_contacts')
--    order by c.relname;
--   Expected: two rows, relrowsecurity true.
--   select count(*) from pg_policies
--    where schemaname = 'public'
--      and tablename in ('podscan_catalog', 'show_contacts');
--   Expected: 0.
--   select grantee, table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name in ('podscan_catalog', 'show_contacts')
--    order by table_name, grantee, privilege_type;
--   Expected grantee: service_role only.
-- ============================================================

-- -------------------- podscan_catalog --------------------

create table if not exists public.podscan_catalog (
  podscan_id text primary key,
  show_id uuid null references public.shows (id) on delete set null,
  name text not null,
  podscan_rss_url text,
  apple_itunes_id text,
  apple_feed_url text,
  feed_url text,
  language text,
  region text,
  categories text[] not null default '{}',
  last_posted_at timestamptz,
  episode_count int,
  podscan_has_sponsors boolean,
  sponsored_last_12m boolean not null default false,
  latest_sponsored_episode_id text,
  latest_sponsored_at timestamptz,
  keep_reason text not null,
  floor_used int,
  podscan_audience_estimate int,
  demographics jsonb,
  listener_engagement jsonb,
  contact_status text not null,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.podscan_catalog add column if not exists podscan_id text;
alter table public.podscan_catalog add column if not exists show_id uuid;
alter table public.podscan_catalog add column if not exists name text;
alter table public.podscan_catalog add column if not exists podscan_rss_url text;
alter table public.podscan_catalog add column if not exists apple_itunes_id text;
alter table public.podscan_catalog add column if not exists apple_feed_url text;
alter table public.podscan_catalog add column if not exists feed_url text;
alter table public.podscan_catalog add column if not exists language text;
alter table public.podscan_catalog add column if not exists region text;
alter table public.podscan_catalog add column if not exists categories text[] default '{}';
alter table public.podscan_catalog add column if not exists last_posted_at timestamptz;
alter table public.podscan_catalog add column if not exists episode_count int;
alter table public.podscan_catalog add column if not exists podscan_has_sponsors boolean;
alter table public.podscan_catalog add column if not exists sponsored_last_12m boolean default false;
alter table public.podscan_catalog add column if not exists latest_sponsored_episode_id text;
alter table public.podscan_catalog add column if not exists latest_sponsored_at timestamptz;
alter table public.podscan_catalog add column if not exists keep_reason text;
alter table public.podscan_catalog add column if not exists floor_used int;
alter table public.podscan_catalog add column if not exists podscan_audience_estimate int;
alter table public.podscan_catalog add column if not exists demographics jsonb;
alter table public.podscan_catalog add column if not exists listener_engagement jsonb;
alter table public.podscan_catalog add column if not exists contact_status text;
alter table public.podscan_catalog add column if not exists imported_at timestamptz default now();
alter table public.podscan_catalog add column if not exists updated_at timestamptz default now();

alter table public.podscan_catalog alter column name set not null;
alter table public.podscan_catalog alter column categories set not null;
alter table public.podscan_catalog alter column categories set default '{}';
alter table public.podscan_catalog alter column sponsored_last_12m set not null;
alter table public.podscan_catalog alter column sponsored_last_12m set default false;
alter table public.podscan_catalog alter column keep_reason set not null;
alter table public.podscan_catalog alter column contact_status set not null;
alter table public.podscan_catalog alter column imported_at set not null;
alter table public.podscan_catalog alter column imported_at set default now();
alter table public.podscan_catalog alter column updated_at set not null;
alter table public.podscan_catalog alter column updated_at set default now();

alter table public.podscan_catalog drop constraint if exists podscan_catalog_show_id_fkey;
alter table public.podscan_catalog
  add constraint podscan_catalog_show_id_fkey
  foreign key (show_id) references public.shows (id) on delete set null;

alter table public.podscan_catalog drop constraint if exists podscan_catalog_keep_reason_check;
alter table public.podscan_catalog
  add constraint podscan_catalog_keep_reason_check
  check (keep_reason in ('sponsored', 'floor'));

alter table public.podscan_catalog drop constraint if exists podscan_catalog_contact_status_check;
alter table public.podscan_catalog
  add constraint podscan_catalog_contact_status_check
  check (contact_status in ('ok', 'needs_manual_lookup'));

comment on table public.podscan_catalog is
  'Internal Podscan import. service_role only. Not readable by brands.';
comment on column public.podscan_catalog.show_id is
  'Set only when exactly one shows row has this podscan_id. A data link, not a trust or ownership tie.';
comment on column public.podscan_catalog.podscan_audience_estimate is
  'Internal estimate only, never shown, not downloads.';
comment on column public.podscan_catalog.feed_url is
  'The feed URL that was actually fetched.';

-- -------------------- show_contacts --------------------

create table if not exists public.show_contacts (
  id uuid primary key default gen_random_uuid(),
  podscan_id text not null references public.podscan_catalog (podscan_id) on delete cascade,
  show_id uuid null references public.shows (id) on delete set null,
  email text not null,
  source text not null,
  syntax_ok boolean not null,
  mx_ok boolean,
  mx_checked_at timestamptz,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (podscan_id, source, email)
);

alter table public.show_contacts add column if not exists id uuid default gen_random_uuid();
alter table public.show_contacts add column if not exists podscan_id text;
alter table public.show_contacts add column if not exists show_id uuid;
alter table public.show_contacts add column if not exists email text;
alter table public.show_contacts add column if not exists source text;
alter table public.show_contacts add column if not exists syntax_ok boolean;
alter table public.show_contacts add column if not exists mx_ok boolean;
alter table public.show_contacts add column if not exists mx_checked_at timestamptz;
alter table public.show_contacts add column if not exists status text;
alter table public.show_contacts add column if not exists created_at timestamptz default now();
alter table public.show_contacts add column if not exists updated_at timestamptz default now();

alter table public.show_contacts alter column podscan_id set not null;
alter table public.show_contacts alter column email set not null;
alter table public.show_contacts alter column source set not null;
alter table public.show_contacts alter column syntax_ok set not null;
alter table public.show_contacts alter column status set not null;
alter table public.show_contacts alter column created_at set not null;
alter table public.show_contacts alter column created_at set default now();
alter table public.show_contacts alter column updated_at set not null;
alter table public.show_contacts alter column updated_at set default now();

alter table public.show_contacts drop constraint if exists show_contacts_podscan_id_fkey;
alter table public.show_contacts
  add constraint show_contacts_podscan_id_fkey
  foreign key (podscan_id) references public.podscan_catalog (podscan_id) on delete cascade;

alter table public.show_contacts drop constraint if exists show_contacts_show_id_fkey;
alter table public.show_contacts
  add constraint show_contacts_show_id_fkey
  foreign key (show_id) references public.shows (id) on delete set null;

alter table public.show_contacts drop constraint if exists show_contacts_email_check;
alter table public.show_contacts
  add constraint show_contacts_email_check
  check (email = lower(btrim(email)) and length(email) <= 254);

alter table public.show_contacts drop constraint if exists show_contacts_source_check;
alter table public.show_contacts
  add constraint show_contacts_source_check
  check (source in ('podscan', 'apple_rss'));

alter table public.show_contacts drop constraint if exists show_contacts_status_check;
alter table public.show_contacts
  add constraint show_contacts_status_check
  check (status in ('ok', 'needs_manual_lookup'));

alter table public.show_contacts drop constraint if exists show_contacts_podscan_id_source_email_key;
alter table public.show_contacts
  add constraint show_contacts_podscan_id_source_email_key
  unique (podscan_id, source, email);

create index if not exists show_contacts_show_id_idx
  on public.show_contacts (show_id)
  where show_id is not null;

comment on table public.show_contacts is
  'Internal emails for the Podscan import. service_role only. No email is sent.';
comment on column public.show_contacts.show_id is
  'Same data link as podscan_catalog.show_id. Not a trust or ownership tie.';
comment on column public.show_contacts.mx_ok is
  'Null means the lookup could not decide.';

-- -------------------- grants (before RLS) --------------------

revoke all on table public.podscan_catalog from public;
revoke all on table public.podscan_catalog from anon;
revoke all on table public.podscan_catalog from authenticated;
revoke all on table public.podscan_catalog from service_role;
grant select, insert, update, delete on table public.podscan_catalog to service_role;
revoke truncate, references, trigger on table public.podscan_catalog from authenticated;
revoke truncate, references, trigger on table public.podscan_catalog from anon;
revoke truncate, references, trigger on table public.podscan_catalog from public;

revoke all on table public.show_contacts from public;
revoke all on table public.show_contacts from anon;
revoke all on table public.show_contacts from authenticated;
revoke all on table public.show_contacts from service_role;
grant select, insert, update, delete on table public.show_contacts to service_role;
revoke truncate, references, trigger on table public.show_contacts from authenticated;
revoke truncate, references, trigger on table public.show_contacts from anon;
revoke truncate, references, trigger on table public.show_contacts from public;

-- -------------------- RLS --------------------

alter table public.podscan_catalog enable row level security;
alter table public.show_contacts enable row level security;

-- No policies. service_role bypasses RLS on Supabase. anon and
-- authenticated have no grant and no policy.
