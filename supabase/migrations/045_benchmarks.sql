-- ============================================================
-- 045: genre benchmarks + media-kit geography
--
-- Benchmarks are cited reference figures (genre, metric, value,
-- source, as_of). Scoring may quote them and nudge a sub-score.
-- They never hide a show. value stays null until a real citation
-- is inserted — this migration seeds nothing.
--
-- show_profiles gains the media-kit text a show pasted or uploaded,
-- the country shares parsed from it, and a display slug. Geography
-- is copied onto a catalog show only through a verified tie
-- (a deal, or a show_owner contact email). A client-supplied
-- podscan_id and a shared slug are not ties.
-- show_profiles is a pre-020 table; these columns inherit its grants.
-- No new grant block for them.
--
-- Idempotent. Safe to re-run. Do not apply from the app.
--
-- Introspection check (run after applying):
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'benchmarks'
--    order by ordinal_position;
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'benchmarks'
--    order by grantee, privilege_type;
--   select polname, polroles::regrole[], polcmd
--     from pg_policy
--    where polrelid = 'public.benchmarks'::regclass
--    order by polname;
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'show_profiles'
--      and column_name in ('media_kit_text', 'audience_geography', 'show_slug')
--    order by column_name;
--   Expected benchmarks columns: id, genre, metric, value, source,
--   as_of, created_at. Expected grants: authenticated SELECT only,
--   service_role SELECT/INSERT/UPDATE/DELETE (no anon). Expected
--   policies: authenticated SELECT, service_role ALL. Expected row
--   count: 0.
-- ============================================================

create table if not exists public.benchmarks (
  id          uuid primary key default gen_random_uuid(),
  genre       text not null,
  metric      text not null,
  -- Cited number only. Null until a source is recorded.
  -- purchase_rate is a fraction (0.024 = 2.4%). Do not invent one.
  value       numeric,
  source      text,
  as_of       date,
  created_at  timestamptz not null default now()
);

alter table public.benchmarks drop constraint if exists benchmarks_genre_not_blank;
alter table public.benchmarks
  add constraint benchmarks_genre_not_blank
  check (char_length(btrim(genre)) > 0);

alter table public.benchmarks drop constraint if exists benchmarks_metric_not_blank;
alter table public.benchmarks
  add constraint benchmarks_metric_not_blank
  check (char_length(btrim(metric)) > 0);

alter table public.benchmarks drop constraint if exists benchmarks_value_nonnegative;
alter table public.benchmarks
  add constraint benchmarks_value_nonnegative
  check (value is null or value >= 0);

alter table public.benchmarks drop constraint if exists benchmarks_genre_metric_key;
alter table public.benchmarks
  add constraint benchmarks_genre_metric_key unique (genre, metric);

comment on table public.benchmarks is
  'Cited genre benchmarks for scoring guidance. Empty until a real source is inserted. Never a filter.';

comment on column public.benchmarks.value is
  'Cited figure. Null when the row is a placeholder. purchase_rate is a fraction (0.024 = 2.4%). Never fill with an invented number.';

comment on column public.benchmarks.source is
  'Publication or dataset the value came from. Required in practice whenever value is set.';

comment on column public.benchmarks.as_of is
  'Date the cited figure applies to.';

-- Data API grants. Revoke first so default privileges cannot leave
-- anon (or PUBLIC) with access, and so a re-run drops any earlier
-- write grant on authenticated. Authenticated may read; RLS below
-- is what makes the read succeed. service_role manages rows.
revoke all on table public.benchmarks from public;
revoke all on table public.benchmarks from anon;
revoke all on table public.benchmarks from authenticated;
grant select, insert, update, delete on public.benchmarks to service_role;
grant select on public.benchmarks to authenticated;

alter table public.benchmarks enable row level security;

drop policy if exists "Authenticated users can read benchmarks" on public.benchmarks;
create policy "Authenticated users can read benchmarks"
  on public.benchmarks
  for select
  to authenticated
  using (true);

drop policy if exists "Service role manages benchmarks" on public.benchmarks;
create policy "Service role manages benchmarks"
  on public.benchmarks
  for all
  to service_role
  using (true)
  with check (true);

-- No seed. A purchase-rate row is inserted only with a citation, e.g.
--   insert into public.benchmarks (genre, metric, value, source, as_of)
--   values ('True Crime', 'purchase_rate', 0.024, 'Publisher, report name', '2024-06-01')
--   on conflict on constraint benchmarks_genre_metric_key do nothing;

alter table public.show_profiles
  add column if not exists media_kit_text text;

alter table public.show_profiles
  add column if not exists audience_geography jsonb;

alter table public.show_profiles
  add column if not exists show_slug text;

create index if not exists idx_show_profiles_show_slug
  on public.show_profiles (show_slug);

comment on column public.show_profiles.media_kit_text is
  'Media kit text the show pasted or uploaded. Geography is parsed from this; the raw text is kept so the parse can be checked.';

comment on column public.show_profiles.audience_geography is
  'Country shares parsed from media_kit_text: us, uk, canada, australia, each 0-100. Guidance for scoring, not a filter.';

comment on column public.show_profiles.show_slug is
  'generateSlug(show_name). Display only. Do not attach audience_geography to a catalog show by this slug.';
