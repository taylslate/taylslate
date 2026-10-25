-- ============================================================
-- 067: confident past-campaign show match
--
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK.
-- Apply only after 066. Paste into the Supabase SQL Editor, then introspect.
-- Do not run this from the app, a seed script, or a deploy hook.
--
-- 061 is reserved. 062, 063, and 064 are not in the repo. 065 and 066
-- are the show login and write migrations. This is the next number.
--
-- A past_campaign_records row stores matched_show_id only when its
-- show_name normalizes to exactly one eligible show. Eligible means
-- shows.is_discoverable is true, or shows.agent_id equals the row's
-- brand_id (the caller who created that hidden show). Zero matches
-- and two or more matches leave matched_show_id null and mark the
-- row ambiguous. Ambiguous rows stay on the brand's private table.
-- refresh_pooled_import_priors skips them. There is no screen for a
-- brand to pick a show by hand. The trigger below overwrites any
-- matched_show_id, status, reason, or confidence on insert and update,
-- so a direct write cannot force a link.
--
-- Normalization, kept in lockstep with normalizeShowMatchKey in
-- lib/imports/past-campaigns.ts:
--   ASCII lowercase, then the 32 ASCII punctuation characters and
--   tab, newline, vertical tab, form feed, and carriage return become
--   spaces. Spaces collapse. A leading "the " is removed, repeating.
--   A trailing " podcast" or " show" is removed, repeating.
--   An empty key matches nothing.
-- The punctuation string is !"#$%&'()*+,-./:;<=>?@[\]^_`{|}~
-- A later edit to normalize_show_match_key has to drop and recreate
-- idx_shows_name_match_key. This file already does that on every paste.
--
-- Existing rows are not updated. A row from before this migration has
-- show_match_status null. If it already has matched_show_id, the pool
-- refresh still accepts it. New rows always get a status from the trigger.
--
-- This migration does not write shows. It reads shows to match a name
-- and to read categories for the pool. It does not grant anon or public
-- anything. Authenticated keeps select, insert, update, and delete on
-- past_campaign_records. Truncate, references, and trigger stay revoked.
--
-- Idempotent. Safe to re-run. No backfill.
--
-- Introspection (run after applying):
--   select column_name, data_type
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'past_campaign_records'
--      and column_name in (
--        'show_match_status', 'show_match_reason', 'show_match_confidence'
--      )
--    order by column_name;
--   Expected: show_match_confidence smallint, show_match_reason text,
--   show_match_status text.
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'past_campaign_records'
--      and grantee in ('anon', 'PUBLIC')
--    order by grantee, privilege_type;
--   Expected: no rows.
--   select privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'past_campaign_records'
--      and grantee = 'authenticated'
--      and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER');
--   Expected: no rows.
--   select routine_name, grantee, privilege_type
--     from information_schema.routine_privileges
--    where routine_schema = 'public'
--      and routine_name in (
--        'normalize_show_match_key',
--        'past_campaign_show_candidates',
--        'enforce_past_campaign_show_match',
--        'refresh_pooled_import_priors'
--      )
--      and grantee in ('anon', 'PUBLIC')
--    order by routine_name, grantee;
--   Expected: no rows.
-- ============================================================

create or replace function public.normalize_show_match_key(raw text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          btrim(regexp_replace(folded.value, ' +', ' ', 'g')),
          '^(the )+',
          ''
        ),
        '( (podcast|show))+$',
        ''
      )
    ),
    ''
  )
  from (
    select translate(
      translate(
        coalesce(raw, ''),
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        'abcdefghijklmnopqrstuvwxyz'
      ),
      $punct$!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~$punct$
        || chr(9) || chr(10) || chr(11) || chr(12) || chr(13),
      repeat(' ', 37)
    ) as value
  ) folded;
$$;

comment on function public.normalize_show_match_key(text) is
  'Match key for a show name. ASCII case, ASCII punctuation, a leading the, and trailing podcast or show suffixes. Empty becomes null. Immutable so the shows index can use it.';

drop index if exists public.idx_shows_name_match_key;
create index idx_shows_name_match_key
  on public.shows (public.normalize_show_match_key(name));

alter table public.past_campaign_records
  add column if not exists show_match_status text;

alter table public.past_campaign_records
  add column if not exists show_match_reason text;

alter table public.past_campaign_records
  add column if not exists show_match_confidence smallint;

alter table public.past_campaign_records
  drop constraint if exists past_campaign_records_show_match_check;
alter table public.past_campaign_records
  add constraint past_campaign_records_show_match_check
  check (
    show_match_status is null
    or (
      show_match_status = 'matched'
      and matched_show_id is not null
      and show_match_reason = 'unique_normalized_name'
      and show_match_confidence = 1
    )
    or (
      show_match_status = 'ambiguous'
      and matched_show_id is null
      and show_match_reason in (
        'no_normalized_match',
        'multiple_normalized_matches'
      )
      and show_match_confidence = 0
    )
  );

comment on column public.past_campaign_records.matched_show_id is
  'Set only when the normalized show name matches exactly one eligible show. Eligible means is_discoverable, or agent_id equals this row''s brand_id. Null when the name matches nothing or more than one show. The show cannot read this row.';

comment on column public.past_campaign_records.show_match_status is
  'matched or ambiguous. Null only on rows written before migration 067. Ambiguous rows stay private to the brand.';

comment on column public.past_campaign_records.show_match_reason is
  'unique_normalized_name, no_normalized_match, or multiple_normalized_matches. Null only on rows written before migration 067.';

comment on column public.past_campaign_records.show_match_confidence is
  '1 when the normalized name matches one eligible show. 0 when it does not. Null only on rows written before migration 067.';

revoke all on table public.past_campaign_records from public;
revoke all on table public.past_campaign_records from anon;
revoke truncate, references, trigger on table public.past_campaign_records from authenticated;

-- Login-only read of candidate shows. auth.uid() is the caller.
-- Hidden shows are returned only when shows.agent_id is that caller.
-- Two rows are enough to prove the name is not unique.

create or replace function public.past_campaign_show_candidates(match_key text)
returns table (
  id uuid,
  name text,
  is_discoverable boolean,
  agent_id uuid
)
language sql
stable
security invoker
set search_path = public
as $$
  select s.id, s.name, s.is_discoverable, s.agent_id
  from public.shows s
  where match_key is not null
    and public.normalize_show_match_key(s.name) = match_key
    and (
      s.is_discoverable = true
      or s.agent_id = auth.uid()
    )
  limit 2;
$$;

comment on function public.past_campaign_show_candidates(text) is
  'Shows whose normalized name equals match_key and which this caller may link. Discoverable shows, plus hidden shows this caller created. At most two rows.';

create or replace function public.enforce_past_campaign_show_match()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  match_key text;
  match_ids uuid[];
begin
  match_key := public.normalize_show_match_key(new.show_name);
  if match_key is null then
    new.matched_show_id := null;
    new.show_match_status := 'ambiguous';
    new.show_match_reason := 'no_normalized_match';
    new.show_match_confidence := 0;
    return new;
  end if;

  select coalesce(array_agg(found.id), '{}'::uuid[])
    into match_ids
  from (
    select s.id
    from public.shows s
    where public.normalize_show_match_key(s.name) = match_key
      and (
        s.is_discoverable = true
        or s.agent_id = new.brand_id
      )
    limit 2
  ) found;

  if cardinality(match_ids) = 1 then
    new.matched_show_id := match_ids[1];
    new.show_match_status := 'matched';
    new.show_match_reason := 'unique_normalized_name';
    new.show_match_confidence := 1;
  elsif cardinality(match_ids) = 0 then
    new.matched_show_id := null;
    new.show_match_status := 'ambiguous';
    new.show_match_reason := 'no_normalized_match';
    new.show_match_confidence := 0;
  else
    new.matched_show_id := null;
    new.show_match_status := 'ambiguous';
    new.show_match_reason := 'multiple_normalized_matches';
    new.show_match_confidence := 0;
  end if;
  return new;
end;
$$;

comment on function public.enforce_past_campaign_show_match() is
  'Forces matched_show_id from the normalized show name. A caller-supplied show id is overwritten. Does not write shows.';

drop trigger if exists past_campaign_records_show_match on public.past_campaign_records;
create trigger past_campaign_records_show_match
  before insert or update on public.past_campaign_records
  for each row
  execute function public.enforce_past_campaign_show_match();

revoke all on function public.normalize_show_match_key(text) from public;
revoke all on function public.normalize_show_match_key(text) from anon;
grant execute on function public.normalize_show_match_key(text) to authenticated;
grant execute on function public.normalize_show_match_key(text) to service_role;

revoke all on function public.past_campaign_show_candidates(text) from public;
revoke all on function public.past_campaign_show_candidates(text) from anon;
grant execute on function public.past_campaign_show_candidates(text) to authenticated;
grant execute on function public.past_campaign_show_candidates(text) to service_role;

revoke all on function public.enforce_past_campaign_show_match() from public;
revoke all on function public.enforce_past_campaign_show_match() from anon;
grant execute on function public.enforce_past_campaign_show_match() to authenticated;
grant execute on function public.enforce_past_campaign_show_match() to service_role;

-- Pool refresh from 058, plus the I2b gate. Ambiguous rows never
-- enter the pool. A null show_match_status is a pre-067 row and
-- still enters when matched_show_id is set. No other predicate changed.
-- service_role only. Does not write shows.

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
  delete from public.pooled_import_priors where true;

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
      and (
        rec.show_match_status is null
        or rec.show_match_status = 'matched'
      )
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
  'Rebuilds pooled_import_priors from consented confirmed imports. Skips ambiguous past-campaign rows. service_role only. Does not write shows. Do not schedule from a deploy hook or cron in this job.';
