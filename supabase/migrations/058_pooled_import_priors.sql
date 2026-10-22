-- ============================================================
-- 058: anonymized pooled import priors
--
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK.
-- Do not run the refresh from a deploy hook or cron in this job.
-- Paste into the Supabase SQL Editor, then introspect.
--
-- One table, public.pooled_import_priors, rebuilt by
-- public.refresh_pooled_import_priors(). The function reads
-- confirmed past_campaign_imports where pooling_consent is true,
-- joins past_campaign_records, and takes category from
-- shows.categories through matched_show_id. Rows with no match,
-- or a matched show with no category, are skipped.
-- Groups are (category, placement, price_type). A group is kept
-- only when count(distinct brand_id) >= 5.
--
-- The table has no brand_id, import_id, record id, or show id.
-- The function deletes and inserts only pooled_import_priors.
-- It does not write shows, show_profiles, show_surfaces,
-- benchmarks, or any other public stats table.
--
-- Median matches percentile_cont(0.5): position 1 + 0.5 * (n - 1),
-- interpolated between adjacent values.
-- lib/learning/pooled-priors.ts uses the same formula.
-- median_cpm is set only when price_type is cpm.
-- median_conversions_per_1k_downloads uses rows that have a
-- positive download count and a conversions value.
--
-- Idempotent. Safe to re-run. No backfill. No cron.
-- Grants come before RLS. service_role only. No authenticated
-- grant and no authenticated policy. anon and public lose every
-- privilege. authenticated loses truncate, references, and
-- trigger (and every other default privilege).
--
-- Introspection (run after applying):
--   select column_name
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'pooled_import_priors'
--    order by ordinal_position;
--   Expected: id, category, placement, price_type, brand_count,
--   record_count, median_cpm, median_conversions_per_1k_downloads,
--   refreshed_at. No brand_id, import_id, show_id, or record id.
--   select c.relname, c.relrowsecurity
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname = 'pooled_import_priors';
--   Expected: relrowsecurity true.
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'pooled_import_priors'
--    order by grantee, privilege_type;
--   Expected: service_role has select, insert, update, and delete.
--   anon, authenticated, and public have none. authenticated has
--   no truncate, references, or trigger.
--   select schemaname, tablename, policyname
--     from pg_policies
--    where schemaname = 'public'
--      and tablename = 'pooled_import_priors';
--   Expected: no rows.
--   select grantee, privilege_type
--     from information_schema.routine_privileges
--    where routine_schema = 'public'
--      and routine_name = 'refresh_pooled_import_priors';
--   Expected execute: service_role. Not anon, not authenticated,
--   not public.
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.pooled_import_priors'::regclass
--    order by conname;
--   Expected: brand_count >= 5, and unique
--   (category, placement, price_type).
-- ============================================================

create table if not exists public.pooled_import_priors (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  placement text,
  price_type text,
  brand_count integer not null,
  record_count integer not null,
  median_cpm numeric,
  median_conversions_per_1k_downloads numeric,
  refreshed_at timestamptz not null default now()
);

alter table public.pooled_import_priors
  drop constraint if exists pooled_import_priors_brand_count_check;
alter table public.pooled_import_priors
  add constraint pooled_import_priors_brand_count_check
  check (brand_count >= 5);

alter table public.pooled_import_priors
  drop constraint if exists pooled_import_priors_group_key;
alter table public.pooled_import_priors
  add constraint pooled_import_priors_group_key
  unique nulls not distinct (category, placement, price_type);

comment on table public.pooled_import_priors is
  'Anonymized priors from consented confirmed imports. No brand, import, record, or show identifier. Rebuilt only by refresh_pooled_import_priors().';

comment on column public.pooled_import_priors.brand_count is
  'Distinct brands in the group. The check requires at least 5. The brand ids are not stored.';

comment on column public.pooled_import_priors.median_cpm is
  'percentile_cont(0.5) of rate when price_type is cpm. Null for any other price type.';

comment on column public.pooled_import_priors.median_conversions_per_1k_downloads is
  'percentile_cont(0.5) of conversions * 1000 / downloads. Null when no row in the group has both.';

-- -------------------- grants (before RLS) --------------------

revoke all on table public.pooled_import_priors from public;
revoke all on table public.pooled_import_priors from anon;
revoke all on table public.pooled_import_priors from authenticated;

grant select, insert, update, delete on public.pooled_import_priors to service_role;

-- Default privileges also grant truncate, references, and trigger
-- to authenticated. revoke all above clears them. Repeat the three
-- so a later reader can see those privileges are gone.
revoke truncate, references, trigger on table public.pooled_import_priors from authenticated;

-- -------------------- RLS --------------------

alter table public.pooled_import_priors enable row level security;

-- No authenticated policy. service_role bypasses RLS and is the
-- only role that can read or write this table.

-- -------------------- refresh --------------------

create or replace function public.refresh_pooled_import_priors()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  inserted_count integer;
begin
  -- This delete and the insert below are the only writes.
  -- shows is read for categories. It is not updated.
  delete from public.pooled_import_priors;

  insert into public.pooled_import_priors (
    category,
    placement,
    price_type,
    brand_count,
    record_count,
    median_cpm,
    median_conversions_per_1k_downloads,
    refreshed_at
  )
  select
    grouped.category,
    grouped.placement,
    grouped.price_type,
    grouped.brand_count,
    grouped.record_count,
    case
      when grouped.price_type = 'cpm' then grouped.median_rate
      else null
    end,
    grouped.median_conversions_per_1k,
    now()
  from (
    select
      cats.category,
      rec.placement,
      rec.price_type,
      count(distinct rec.brand_id)::integer as brand_count,
      count(*)::integer as record_count,
      percentile_cont(0.5) within group (order by rec.rate)
        filter (where rec.rate is not null) as median_rate,
      percentile_cont(0.5) within group (
        order by (rec.conversions::numeric * 1000) / nullif(rec.downloads, 0)
      ) filter (
        where rec.downloads is not null
          and rec.downloads > 0
          and rec.conversions is not null
      ) as median_conversions_per_1k
    from public.past_campaign_records rec
    join public.past_campaign_imports imp
      on imp.id = rec.import_id
     and imp.brand_id = rec.brand_id
    join public.shows sh
      on sh.id = rec.matched_show_id
    cross join lateral (
      select distinct btrim(cat) as category
      from unnest(coalesce(sh.categories, '{}'::text[])) as cat
      where cat is not null
        and btrim(cat) <> ''
    ) cats
    where imp.status = 'confirmed'
      and imp.pooling_consent = true
      and rec.matched_show_id is not null
    group by cats.category, rec.placement, rec.price_type
    having count(distinct rec.brand_id) >= 5
  ) grouped;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.refresh_pooled_import_priors() from public;
revoke all on function public.refresh_pooled_import_priors() from anon;
revoke all on function public.refresh_pooled_import_priors() from authenticated;
grant execute on function public.refresh_pooled_import_priors() to service_role;

comment on function public.refresh_pooled_import_priors() is
  'Rebuilds pooled_import_priors from consented confirmed imports. service_role only. Does not write shows or public stats. Do not schedule from a deploy hook or cron in this job.';
