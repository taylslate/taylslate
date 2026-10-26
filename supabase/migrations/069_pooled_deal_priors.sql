-- ============================================================
-- 069: anonymized priors from booked on-platform deals
--
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK.
-- Paste into the Supabase SQL Editor, then introspect.
-- Do not run this from a deploy hook. The daily cron is
-- /api/cron/pooled-priors, and it calls the two refresh functions
-- with the service role.
--
-- 061 on main is show ownership. 062, 063, and 064 are not in the repo.
-- 067 is the roster-link review note. 068 (PR 42) is the only
-- definition of refresh_pooled_import_priors(). This file is 069.
-- It does not create, replace, revoke, or grant that function.
-- Apply 069 after 068.
--
-- public.pooled_deal_priors is rebuilt by
-- public.refresh_pooled_deal_priors(). The source is deals whose
-- status is booked: signed, live, delivering, or completed. A
-- cancelled deal stays out, including a booked status with
-- cancelled_at set. show_signed does not enter. A hidden show
-- (is_discoverable false) does not enter. Category comes from
-- shows.categories through deals.show_id. A show with no category
-- contributes nothing. Groups are (category, placement, price_type).
-- A group is kept only when count(distinct coalesce(brand_profile_id,
-- brand_id)) >= 5. The table stores no brand, deal, show, booking,
-- or user identifier.
--
-- agreed_cpm wins over cpm_rate. agreed_placement wins over
-- placement. agreed_episode_count wins over num_episodes.
-- Placement and price type are stored in the same vocabulary as
-- pooled_import_priors (mid-roll, flat). median_cpm is set only
-- when the stored price type is cpm.
--
-- median_conversions_per_1k_downloads prefers public.outcomes when
-- booking_id, show_id, reported_impressions, and
-- reported_conversions all exist. The join is booking_id = deals.id,
-- and show_id must match the deal when it is set. A show_id-only
-- join is not used. Otherwise the value comes from
-- deal_conversion_reports.reported_conversions and
-- guaranteed_downloads times the coalesced episode count.
--
-- Uploaded rows are not rebuilt here. 068 keeps them out unless
-- matched_show_id is set and show_match_status is null or matched.
--
-- The function deletes with WHERE true because of safeupdate.
-- It writes only pooled_deal_priors.
-- It does not write shows, show_profiles, show_surfaces, benchmarks,
-- or pooled_import_priors.
--
-- Idempotent. Safe to re-run. No backfill.
-- Grants come before RLS. service_role only. anon, authenticated,
-- and public have no table privileges. authenticated has no
-- truncate, references, or trigger. Execute is service_role only.
--
-- Introspection (run after applying):
--   select column_name
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'pooled_deal_priors'
--    order by ordinal_position;
--   Expected: id, category, placement, price_type, brand_count,
--   deal_count, median_cpm, median_conversions_per_1k_downloads,
--   refreshed_at. No brand_id, deal_id, show_id, or user_id.
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'pooled_deal_priors'
--    order by grantee, privilege_type;
--   Expected: service_role has select, insert, update, and delete.
--   anon, authenticated, and public have none.
--   select grantee, privilege_type
--     from information_schema.routine_privileges
--    where routine_schema = 'public'
--      and routine_name = 'refresh_pooled_deal_priors'
--    order by grantee, privilege_type;
--   Expected execute: service_role. Not anon, not authenticated,
--   not public. refresh_pooled_import_priors is unchanged by 069.
-- ============================================================

create table if not exists public.pooled_deal_priors (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  placement text,
  price_type text,
  brand_count integer not null,
  deal_count integer not null,
  median_cpm numeric,
  median_conversions_per_1k_downloads numeric,
  refreshed_at timestamptz not null default now()
);

alter table public.pooled_deal_priors
  drop constraint if exists pooled_deal_priors_brand_count_check;
alter table public.pooled_deal_priors
  add constraint pooled_deal_priors_brand_count_check
  check (brand_count >= 5);

alter table public.pooled_deal_priors
  drop constraint if exists pooled_deal_priors_group_key;
alter table public.pooled_deal_priors
  add constraint pooled_deal_priors_group_key
  unique nulls not distinct (category, placement, price_type);

comment on table public.pooled_deal_priors is
  'Anonymized priors from booked on-platform deals. No brand, deal, show, or user identifier. Rebuilt only by refresh_pooled_deal_priors().';

comment on column public.pooled_deal_priors.brand_count is
  'Distinct brands in the group. The check requires at least 5. The brand ids are not stored.';

comment on column public.pooled_deal_priors.deal_count is
  'Deals in the group. A brand with two deals counts once toward brand_count and twice toward deal_count.';

comment on column public.pooled_deal_priors.median_cpm is
  'percentile_cont(0.5) of agreed_cpm, or cpm_rate when agreed_cpm is null. Null unless price_type is cpm.';

comment on column public.pooled_deal_priors.median_conversions_per_1k_downloads is
  'percentile_cont(0.5) of conversions per 1,000 impressions or downloads. Null when the group has none.';

-- -------------------- grants (before RLS) --------------------

revoke all on table public.pooled_deal_priors from public;
revoke all on table public.pooled_deal_priors from anon;
revoke all on table public.pooled_deal_priors from authenticated;

grant select, insert, update, delete on public.pooled_deal_priors to service_role;

revoke truncate, references, trigger on table public.pooled_deal_priors from authenticated;

-- -------------------- RLS --------------------

alter table public.pooled_deal_priors enable row level security;

-- No authenticated policy. service_role bypasses RLS and is the
-- only role that can read or write this table.

-- -------------------- deal refresh --------------------

create or replace function public.refresh_pooled_deal_priors()
returns integer
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  inserted_count integer;
  has_outcomes boolean;
  has_outcome_created boolean;
begin
  delete from public.pooled_deal_priors where true;

  drop table if exists l2_deal_rows;
  create temporary table l2_deal_rows (
    deal_id uuid not null,
    category text not null,
    placement text,
    price_type text,
    brand_key uuid not null,
    cpm numeric,
    per1k numeric
  ) on commit drop;

  insert into l2_deal_rows (
    deal_id,
    category,
    placement,
    price_type,
    brand_key,
    cpm,
    per1k
  )
  select
    d.id,
    cats.category,
    placed.placement,
    priced.price_type,
    coalesce(d.brand_profile_id, d.brand_id),
    case
      when priced.price_type = 'cpm' then coalesce(d.agreed_cpm, d.cpm_rate)
      else null
    end,
    (cr.reported_conversions::numeric * 1000)
      / nullif(
          d.guaranteed_downloads::numeric
            * nullif(coalesce(d.agreed_episode_count, d.num_episodes), 0),
          0
        )
  from public.deals d
  join public.shows sh
    on sh.id = d.show_id
   and sh.is_discoverable
  left join public.deal_conversion_reports cr
    on cr.deal_id = d.id
  cross join lateral (
    select distinct btrim(cat) as category
    from unnest(coalesce(sh.categories, '{}'::text[])) as cat
    where cat is not null
      and btrim(cat) <> ''
  ) cats
  cross join lateral (
    select
      case
        when src.raw is null then null
        when src.key in ('preroll', 'pre-roll') then 'pre-roll'
        when src.key in ('midroll', 'mid-roll') then 'mid-roll'
        when src.key in ('postroll', 'post-roll') then 'post-roll'
        else src.raw
      end as placement
    from (
      select
        nullif(
          btrim(coalesce(nullif(btrim(d.agreed_placement), ''), d.placement)),
          ''
        ) as raw,
        regexp_replace(
          lower(
            btrim(coalesce(nullif(btrim(d.agreed_placement), ''), d.placement, ''))
          ),
          '[\s_]+',
          '-',
          'g'
        ) as key
    ) src
  ) placed
  cross join lateral (
    select
      case
        when src.key = 'cpm' then 'cpm'
        when src.key in ('flat', 'flat_rate', 'fixed', 'fixed_rate') then 'flat'
        else null
      end as price_type
    from (
      select regexp_replace(
        lower(btrim(coalesce(d.price_type, ''))),
        '[\s-]+',
        '_',
        'g'
      ) as key
    ) src
  ) priced
  where d.cancelled_at is null
    and d.status in ('signed', 'live', 'delivering', 'completed')
    and coalesce(d.brand_profile_id, d.brand_id) is not null;

  select
    exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'outcomes'
         and column_name = 'booking_id'
    )
    and exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'outcomes'
         and column_name = 'show_id'
    )
    and exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'outcomes'
         and column_name = 'reported_impressions'
    )
    and exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'outcomes'
         and column_name = 'reported_conversions'
    )
  into has_outcomes;

  if has_outcomes then
    select exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'outcomes'
         and column_name = 'created_at'
    ) into has_outcome_created;

    if has_outcome_created then
      execute $outcomes$
        update l2_deal_rows as t
           set per1k = src.per1k
          from (
            select distinct on (d.id)
                   d.id as deal_id,
                   (o.reported_conversions::numeric * 1000)
                     / nullif(o.reported_impressions, 0) as per1k
              from public.deals d
              join public.outcomes o
                on o.booking_id = d.id
             where o.show_id is null
                or o.show_id = d.show_id
             order by d.id, o.created_at desc nulls last, o.id desc
          ) src
         where t.deal_id = src.deal_id
           and src.per1k is not null
      $outcomes$;
    else
      execute $outcomes$
        update l2_deal_rows as t
           set per1k = src.per1k
          from (
            select distinct on (d.id)
                   d.id as deal_id,
                   (o.reported_conversions::numeric * 1000)
                     / nullif(o.reported_impressions, 0) as per1k
              from public.deals d
              join public.outcomes o
                on o.booking_id = d.id
             where o.show_id is null
                or o.show_id = d.show_id
             order by d.id, o.id desc
          ) src
         where t.deal_id = src.deal_id
           and src.per1k is not null
      $outcomes$;
    end if;
  end if;

  insert into public.pooled_deal_priors (
    category,
    placement,
    price_type,
    brand_count,
    deal_count,
    median_cpm,
    median_conversions_per_1k_downloads,
    refreshed_at
  )
  select
    grouped.category,
    grouped.placement,
    grouped.price_type,
    grouped.brand_count,
    grouped.deal_count,
    case
      when grouped.price_type = 'cpm' then grouped.median_cpm
      else null
    end,
    grouped.median_per1k,
    now()
  from (
    select
      rows.category,
      rows.placement,
      rows.price_type,
      count(distinct rows.brand_key)::integer as brand_count,
      count(*)::integer as deal_count,
      percentile_cont(0.5) within group (order by rows.cpm)
        filter (where rows.cpm is not null) as median_cpm,
      percentile_cont(0.5) within group (order by rows.per1k)
        filter (where rows.per1k is not null) as median_per1k
    from l2_deal_rows rows
    group by rows.category, rows.placement, rows.price_type
    having count(distinct rows.brand_key) >= 5
  ) grouped;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$fn$;

revoke all on function public.refresh_pooled_deal_priors() from public;
revoke all on function public.refresh_pooled_deal_priors() from anon;
revoke all on function public.refresh_pooled_deal_priors() from authenticated;
grant execute on function public.refresh_pooled_deal_priors() to service_role;

comment on function public.refresh_pooled_deal_priors() is
  'Rebuilds pooled_deal_priors from booked, uncancelled deals. service_role only. Does not write shows, public show stats, or pooled_import_priors.';
