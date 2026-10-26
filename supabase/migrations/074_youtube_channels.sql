-- ============================================================
-- 074: YouTube channel library
--
-- A private catalog of US YouTube creators. Discovery reads it
-- before a live search. These rows are not shows. Brand show
-- search lists public shows, and an unvetted channel must not
-- become one. show_id is set only when shows.youtube_channel_id
-- or a podcast show's stored YouTube link matches this channel
-- exactly once.
--
-- youtube_pull_queue is the daily category and seed work list.
-- created_at is the resume order. The pull cron resumes pending
-- rows. It does not restart them.
--
-- RLS is on. There is no policy. service_role has select,
-- insert, update, delete. anon, authenticated, and public have
-- nothing. Authenticated also has truncate, references, and
-- trigger revoked.
--
-- Idempotent. Safe to re-run. No backfill.
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge
-- and Chris's own-words OK. Do not run this from the app, a
-- seed script, or a deploy hook. The crons no-op until then.
--
-- Introspection (run after applying):
--   select c.relrowsecurity
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname in ('youtube_channels', 'youtube_pull_queue');
--   Expected: true, true
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name in ('youtube_channels', 'youtube_pull_queue')
--    order by table_name, grantee, privilege_type;
--   Expected grantee: service_role only
--   (select, insert, update, delete) on each table.
-- ============================================================

create table if not exists public.youtube_channels (
  channel_id text primary key,
  title text,
  description text,
  thumbnail_url text,
  country text,
  default_language text,
  subscriber_count bigint,
  video_count bigint,
  total_view_count bigint,
  avg_recent_views bigint,
  avg_views_method text,
  topic_categories text[] not null default '{}',
  keywords text[] not null default '{}',
  niche_tags text[] not null default '{}',
  niche_tags_version integer not null default 0,
  tagged_at timestamptz,
  passed_market_filter boolean not null default false,
  brand_flag text,
  show_id uuid references public.shows(id) on delete set null,
  source text not null,
  source_query text,
  first_seen_at timestamptz not null default now(),
  stats_refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.youtube_channels add column if not exists title text;
alter table public.youtube_channels add column if not exists description text;
alter table public.youtube_channels add column if not exists thumbnail_url text;
alter table public.youtube_channels add column if not exists country text;
alter table public.youtube_channels add column if not exists default_language text;
alter table public.youtube_channels add column if not exists subscriber_count bigint;
alter table public.youtube_channels add column if not exists video_count bigint;
alter table public.youtube_channels add column if not exists total_view_count bigint;
alter table public.youtube_channels add column if not exists avg_recent_views bigint;
alter table public.youtube_channels add column if not exists avg_views_method text;
alter table public.youtube_channels add column if not exists topic_categories text[] default '{}';
alter table public.youtube_channels add column if not exists keywords text[] default '{}';
alter table public.youtube_channels add column if not exists niche_tags text[] default '{}';
alter table public.youtube_channels add column if not exists niche_tags_version integer default 0;
alter table public.youtube_channels add column if not exists tagged_at timestamptz;
alter table public.youtube_channels add column if not exists passed_market_filter boolean default false;
alter table public.youtube_channels add column if not exists brand_flag text;
alter table public.youtube_channels add column if not exists show_id uuid;
alter table public.youtube_channels add column if not exists source text;
alter table public.youtube_channels add column if not exists source_query text;
alter table public.youtube_channels add column if not exists first_seen_at timestamptz default now();
alter table public.youtube_channels add column if not exists stats_refreshed_at timestamptz default now();
alter table public.youtube_channels add column if not exists created_at timestamptz default now();
alter table public.youtube_channels add column if not exists updated_at timestamptz default now();

alter table public.youtube_channels alter column topic_categories set default '{}';
alter table public.youtube_channels alter column topic_categories set not null;
alter table public.youtube_channels alter column keywords set default '{}';
alter table public.youtube_channels alter column keywords set not null;
alter table public.youtube_channels alter column niche_tags set default '{}';
alter table public.youtube_channels alter column niche_tags set not null;
alter table public.youtube_channels alter column niche_tags_version set default 0;
alter table public.youtube_channels alter column niche_tags_version set not null;
alter table public.youtube_channels alter column passed_market_filter set default false;
alter table public.youtube_channels alter column passed_market_filter set not null;
alter table public.youtube_channels alter column source set not null;
alter table public.youtube_channels alter column first_seen_at set default now();
alter table public.youtube_channels alter column first_seen_at set not null;
alter table public.youtube_channels alter column stats_refreshed_at set default now();
alter table public.youtube_channels alter column stats_refreshed_at set not null;
alter table public.youtube_channels alter column created_at set default now();
alter table public.youtube_channels alter column created_at set not null;
alter table public.youtube_channels alter column updated_at set default now();
alter table public.youtube_channels alter column updated_at set not null;

alter table public.youtube_channels drop constraint if exists youtube_channels_source_check;
alter table public.youtube_channels
  add constraint youtube_channels_source_check
  check (source in ('category', 'seed', 'discovery'));

alter table public.youtube_channels drop constraint if exists youtube_channels_avg_views_method_check;
alter table public.youtube_channels
  add constraint youtube_channels_avg_views_method_check
  check (avg_views_method is null or avg_views_method in ('recent', 'estimated'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'youtube_channels_show_id_fkey'
      and conrelid = 'public.youtube_channels'::regclass
  ) then
    alter table public.youtube_channels
      add constraint youtube_channels_show_id_fkey
      foreign key (show_id) references public.shows(id) on delete set null;
  end if;
end $$;

create index if not exists idx_youtube_channels_stats_refreshed_at
  on public.youtube_channels (stats_refreshed_at);

create index if not exists idx_youtube_channels_show_id
  on public.youtube_channels (show_id);

create index if not exists idx_youtube_channels_niche_tags
  on public.youtube_channels using gin (niche_tags);

comment on table public.youtube_channels is
  'Stored US YouTube creators. service_role only. Not a shows row.';

create table if not exists public.youtube_pull_queue (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  value text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.youtube_pull_queue add column if not exists kind text;
alter table public.youtube_pull_queue add column if not exists value text;
alter table public.youtube_pull_queue add column if not exists status text default 'pending';
alter table public.youtube_pull_queue add column if not exists attempts integer default 0;
alter table public.youtube_pull_queue add column if not exists last_error text;
alter table public.youtube_pull_queue add column if not exists done_at timestamptz;
alter table public.youtube_pull_queue add column if not exists created_at timestamptz default now();

alter table public.youtube_pull_queue alter column kind set not null;
alter table public.youtube_pull_queue alter column value set not null;
alter table public.youtube_pull_queue alter column status set default 'pending';
alter table public.youtube_pull_queue alter column status set not null;
alter table public.youtube_pull_queue alter column attempts set default 0;
alter table public.youtube_pull_queue alter column attempts set not null;
alter table public.youtube_pull_queue alter column created_at set default now();
update public.youtube_pull_queue set created_at = now() where created_at is null;
alter table public.youtube_pull_queue alter column created_at set not null;

alter table public.youtube_pull_queue drop constraint if exists youtube_pull_queue_kind_check;
alter table public.youtube_pull_queue
  add constraint youtube_pull_queue_kind_check
  check (kind in ('category_query', 'seed_channel'));

alter table public.youtube_pull_queue drop constraint if exists youtube_pull_queue_status_check;
alter table public.youtube_pull_queue
  add constraint youtube_pull_queue_status_check
  check (status in ('pending', 'done', 'error'));

create unique index if not exists youtube_pull_queue_kind_value_uidx
  on public.youtube_pull_queue (kind, value);

create index if not exists idx_youtube_pull_queue_status
  on public.youtube_pull_queue (status);

comment on table public.youtube_pull_queue is
  'Daily YouTube library work. Unique on kind and value. service_role only.';

-- Data API grants. service_role only. Revoke first so a re-run
-- drops anything a partial apply left behind.
revoke all on table public.youtube_channels from public;
revoke all on table public.youtube_channels from anon;
revoke all on table public.youtube_channels from authenticated;
revoke all on table public.youtube_channels from service_role;
grant select, insert, update, delete on public.youtube_channels to service_role;
revoke truncate, references, trigger on table public.youtube_channels from authenticated;
revoke truncate, references, trigger on table public.youtube_channels from anon;
revoke truncate, references, trigger on table public.youtube_channels from public;

revoke all on table public.youtube_pull_queue from public;
revoke all on table public.youtube_pull_queue from anon;
revoke all on table public.youtube_pull_queue from authenticated;
revoke all on table public.youtube_pull_queue from service_role;
grant select, insert, update, delete on public.youtube_pull_queue to service_role;
revoke truncate, references, trigger on table public.youtube_pull_queue from authenticated;
revoke truncate, references, trigger on table public.youtube_pull_queue from anon;
revoke truncate, references, trigger on table public.youtube_pull_queue from public;

alter table public.youtube_channels enable row level security;
alter table public.youtube_pull_queue enable row level security;

-- No policies. service_role bypasses RLS on Supabase. anon and
-- authenticated have no grant and no policy.
