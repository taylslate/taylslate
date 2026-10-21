-- ============================================================
-- 047: campaign learning review
--
-- NOT APPLIED. Paste into the Supabase SQL Editor, then introspect.
-- Do not run this from the app, a seed script, or a deploy hook.
--
-- Two tables for the post-flight learning review:
--   deal_conversion_reports — a brand-reported conversion count for one
--     deal. Absent row means the count is unknown. Zero is a real report,
--     not a stand-in for "we didn't look."
--   learning_overrides — a brand or rep note on a show, ring, or read
--     style (for example "rep vouches, test one flight"). Notes guide
--     the next flight. They do not hide a show.
--
-- Identity: both tables hang off campaigns and deals. A show target is
-- deals.show_id (the catalog show on the deal) or a conviction-score
-- show id. Never show_profiles.podscan_id — that column is user-writable.
--
-- Idempotent. Safe to re-run. No backfill. No anon grant.
-- Table privileges are revoked from public as well as anon, then
-- re-granted to service_role and authenticated. An update of a
-- learning override must still pass the brand or rep insert checks,
-- so the author cannot move the note onto another campaign or a
-- show they do not represent.
--
-- Introspection check (run after applying):
--   select column_name from information_schema.columns
--    where table_schema = 'public'
--      and table_name in ('deal_conversion_reports', 'learning_overrides')
--    order by table_name, ordinal_position;
--   select conname from pg_constraint
--    where conrelid in (
--      'public.deal_conversion_reports'::regclass,
--      'public.learning_overrides'::regclass
--    )
--    order by conname;
--   select grantee, table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name in ('deal_conversion_reports', 'learning_overrides')
--    order by table_name, grantee, privilege_type;
--   Expected: authenticated and service_role have select/insert/update/delete.
--   anon and public have none. RLS enabled. Policies listed below exist.
--   "Author updates own learning overrides" WITH CHECK repeats the
--   brand and rep insert checks.
-- ============================================================

-- -------------------- deal_conversion_reports --------------------

create table if not exists public.deal_conversion_reports (
  id                    uuid primary key default gen_random_uuid(),
  deal_id               uuid not null references public.deals(id) on delete cascade,
  campaign_id           uuid not null references public.campaigns(id) on delete cascade,
  -- Explicit count the brand (or an internal admin acting for a managed
  -- brand) typed in. Never filled by a formula.
  reported_conversions  integer not null,
  note                  text,
  reported_by           uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.deal_conversion_reports
  drop constraint if exists deal_conversion_reports_deal_id_key;
alter table public.deal_conversion_reports
  add constraint deal_conversion_reports_deal_id_key unique (deal_id);

alter table public.deal_conversion_reports
  drop constraint if exists deal_conversion_reports_conversions_check;
alter table public.deal_conversion_reports
  add constraint deal_conversion_reports_conversions_check
  check (reported_conversions >= 0 and reported_conversions <= 1000000);

alter table public.deal_conversion_reports
  drop constraint if exists deal_conversion_reports_note_check;
alter table public.deal_conversion_reports
  add constraint deal_conversion_reports_note_check
  check (note is null or char_length(note) <= 500);

create index if not exists idx_deal_conversion_reports_campaign
  on public.deal_conversion_reports(campaign_id);

-- -------------------- learning_overrides --------------------

create table if not exists public.learning_overrides (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.campaigns(id) on delete cascade,
  -- show: catalog shows.id (deals.show_id or a conviction-score show id).
  -- ring: ring_hypotheses.id. style: a closed vocabulary
  -- (host_read, producer_read, guest_read, pre-roll, mid-roll, post-roll).
  target_kind   text not null,
  target_key    text not null,
  author_id     uuid references public.profiles(id) on delete set null,
  author_role   text not null,
  stance        text not null,
  note          text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.learning_overrides
  drop constraint if exists learning_overrides_target_kind_check;
alter table public.learning_overrides
  add constraint learning_overrides_target_kind_check
  check (target_kind in ('show', 'ring', 'style'));

alter table public.learning_overrides
  drop constraint if exists learning_overrides_author_role_check;
alter table public.learning_overrides
  add constraint learning_overrides_author_role_check
  check (author_role in ('brand', 'rep'));

alter table public.learning_overrides
  drop constraint if exists learning_overrides_stance_check;
alter table public.learning_overrides
  add constraint learning_overrides_stance_check
  check (stance in ('renew', 'test_next', 'overweight', 'avoid', 'note'));

alter table public.learning_overrides
  drop constraint if exists learning_overrides_note_check;
alter table public.learning_overrides
  add constraint learning_overrides_note_check
  check (char_length(btrim(note)) between 1 and 500);

alter table public.learning_overrides
  drop constraint if exists learning_overrides_target_key_check;
alter table public.learning_overrides
  add constraint learning_overrides_target_key_check
  check (char_length(btrim(target_key)) between 1 and 200);

-- One current note per author role on a target. A brand and a rep can
-- each leave a note. Saving again updates that pair.
alter table public.learning_overrides
  drop constraint if exists learning_overrides_target_key_unique;
alter table public.learning_overrides
  add constraint learning_overrides_target_key_unique
  unique (campaign_id, target_kind, target_key, author_role);

create index if not exists idx_learning_overrides_campaign
  on public.learning_overrides(campaign_id);

-- -------------------- grants (before RLS) --------------------

revoke all on table public.deal_conversion_reports from public;
revoke all on table public.learning_overrides from public;
revoke all on public.deal_conversion_reports from anon;
revoke all on public.learning_overrides from anon;

grant select, insert, update, delete on public.deal_conversion_reports to service_role;
grant select, insert, update, delete on public.deal_conversion_reports to authenticated;

grant select, insert, update, delete on public.learning_overrides to service_role;
grant select, insert, update, delete on public.learning_overrides to authenticated;

-- -------------------- RLS --------------------

alter table public.deal_conversion_reports enable row level security;
alter table public.learning_overrides enable row level security;

drop policy if exists "Service role can manage deal conversion reports"
  on public.deal_conversion_reports;
create policy "Service role can manage deal conversion reports"
  on public.deal_conversion_reports
  for all to service_role
  using (true) with check (true);

-- Owner of the campaign, and the deal must actually belong to that
-- campaign (outreach.campaign_id or deals.campaign_id). A matching
-- campaign_id alone must not let a brand attach a count to someone
-- else's deal.
drop policy if exists "Campaign owner manages own conversion reports"
  on public.deal_conversion_reports;
create policy "Campaign owner manages own conversion reports"
  on public.deal_conversion_reports
  for all to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = deal_conversion_reports.campaign_id
        and c.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.deals d
      left join public.outreaches o on o.id = d.outreach_id
      where d.id = deal_conversion_reports.deal_id
        and (
          d.campaign_id = deal_conversion_reports.campaign_id
          or o.campaign_id = deal_conversion_reports.campaign_id
        )
    )
  )
  with check (
    exists (
      select 1 from public.campaigns c
      where c.id = deal_conversion_reports.campaign_id
        and c.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.deals d
      left join public.outreaches o on o.id = d.outreach_id
      where d.id = deal_conversion_reports.deal_id
        and (
          d.campaign_id = deal_conversion_reports.campaign_id
          or o.campaign_id = deal_conversion_reports.campaign_id
        )
    )
  );

drop policy if exists "Service role can manage learning overrides"
  on public.learning_overrides;
create policy "Service role can manage learning overrides"
  on public.learning_overrides
  for all to service_role
  using (true) with check (true);

-- Brand owner reads every note on their campaign. A rep reads notes on a
-- campaign that has a deal whose catalog show they represent
-- (agent_show_relationships.show_id = deals.show_id, or deals.agent_id).
drop policy if exists "Campaign readers select learning overrides"
  on public.learning_overrides;
create policy "Campaign readers select learning overrides"
  on public.learning_overrides
  for select to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = learning_overrides.campaign_id
        and c.user_id = auth.uid()
    )
    or author_id = auth.uid()
    or exists (
      select 1
      from public.deals d
      left join public.outreaches o on o.id = d.outreach_id
      where (o.campaign_id = learning_overrides.campaign_id
             or d.campaign_id = learning_overrides.campaign_id)
        and (
          d.agent_id = auth.uid()
          or exists (
            select 1 from public.agent_show_relationships a
            where a.agent_id = auth.uid()
              and a.show_id = d.show_id
          )
        )
    )
  );

drop policy if exists "Brand inserts own learning overrides"
  on public.learning_overrides;
create policy "Brand inserts own learning overrides"
  on public.learning_overrides
  for insert to authenticated
  with check (
    author_role = 'brand'
    and author_id = auth.uid()
    and exists (
      select 1 from public.campaigns c
      where c.id = learning_overrides.campaign_id
        and c.user_id = auth.uid()
    )
  );

-- Rep insert: author is the caller, and a show target must be a catalog
-- show the rep represents. Ring and style notes require the rep to
-- represent at least one show already on a deal in the campaign.
drop policy if exists "Rep inserts own learning overrides"
  on public.learning_overrides;
create policy "Rep inserts own learning overrides"
  on public.learning_overrides
  for insert to authenticated
  with check (
    author_role = 'rep'
    and author_id = auth.uid()
    and exists (
      select 1
      from public.deals d
      left join public.outreaches o on o.id = d.outreach_id
      where (o.campaign_id = learning_overrides.campaign_id
             or d.campaign_id = learning_overrides.campaign_id)
        and (
          d.agent_id = auth.uid()
          or exists (
            select 1 from public.agent_show_relationships a
            where a.agent_id = auth.uid()
              and a.show_id = d.show_id
          )
        )
    )
    and (
      target_kind <> 'show'
      or exists (
        select 1 from public.agent_show_relationships a
        where a.agent_id = auth.uid()
          and a.show_id::text = learning_overrides.target_key
      )
      or exists (
        select 1 from public.deals d
        where d.agent_id = auth.uid()
          and d.show_id::text = learning_overrides.target_key
          and (
            d.campaign_id = learning_overrides.campaign_id
            or exists (
              select 1 from public.outreaches o
              where o.id = d.outreach_id
                and o.campaign_id = learning_overrides.campaign_id
            )
          )
      )
    )
  );

-- Update keeps the row with its author, and the new values must still
-- satisfy the brand or rep insert checks. Changing campaign_id,
-- target_key, or author_role is rejected unless that new shape would
-- have been allowed as an insert.
drop policy if exists "Author updates own learning overrides"
  on public.learning_overrides;
create policy "Author updates own learning overrides"
  on public.learning_overrides
  for update to authenticated
  using (author_id = auth.uid())
  with check (
    author_id = auth.uid()
    and (
      (
        author_role = 'brand'
        and exists (
          select 1 from public.campaigns c
          where c.id = learning_overrides.campaign_id
            and c.user_id = auth.uid()
        )
      )
      or (
        author_role = 'rep'
        and exists (
          select 1
          from public.deals d
          left join public.outreaches o on o.id = d.outreach_id
          where (o.campaign_id = learning_overrides.campaign_id
                 or d.campaign_id = learning_overrides.campaign_id)
            and (
              d.agent_id = auth.uid()
              or exists (
                select 1 from public.agent_show_relationships a
                where a.agent_id = auth.uid()
                  and a.show_id = d.show_id
              )
            )
        )
        and (
          target_kind <> 'show'
          or exists (
            select 1 from public.agent_show_relationships a
            where a.agent_id = auth.uid()
              and a.show_id::text = learning_overrides.target_key
          )
          or exists (
            select 1 from public.deals d
            where d.agent_id = auth.uid()
              and d.show_id::text = learning_overrides.target_key
              and (
                d.campaign_id = learning_overrides.campaign_id
                or exists (
                  select 1 from public.outreaches o
                  where o.id = d.outreach_id
                    and o.campaign_id = learning_overrides.campaign_id
                )
              )
          )
        )
      )
    )
  );

drop policy if exists "Author deletes own learning overrides"
  on public.learning_overrides;
create policy "Author deletes own learning overrides"
  on public.learning_overrides
  for delete to authenticated
  using (author_id = auth.uid());

drop trigger if exists update_deal_conversion_reports_timestamp
  on public.deal_conversion_reports;
create trigger update_deal_conversion_reports_timestamp
  before update on public.deal_conversion_reports
  for each row execute function update_updated_at();

drop trigger if exists update_learning_overrides_timestamp
  on public.learning_overrides;
create trigger update_learning_overrides_timestamp
  before update on public.learning_overrides
  for each row execute function update_updated_at();

comment on table public.deal_conversion_reports is
  'Brand-reported conversion count for one deal. No row means the count was not reported. Zero is an explicit report.';
comment on table public.learning_overrides is
  'Brand or rep note on a learning-review target. Guides the next flight and does not hide a show. Show targets are catalog show ids, never show_profiles.podscan_id.';
