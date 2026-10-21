-- ============================================================
-- 044: creator-attached sellable surfaces
--
-- A show's newsletter, social clip, community mention, live event,
-- or bonus episode is an add-on on that show. It is not its own
-- paid-media placement and it does not change discovery scores.
--
-- show_surfaces belongs to one shows row. owner_user_id is the
-- creator who listed it (profiles.id). Buyers read published rows.
-- io_line_items.show_surface_id points a line on the same IO at
-- one of those add-ons. Null on every existing line.
--
-- NOT applied in this change. Paste into the SQL editor, then
-- introspect before treating it as live.
--
-- Idempotent. Safe to re-run. No backfill.
--
-- Introspection check (run after applying):
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'show_surfaces'
--    order by ordinal_position;
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'io_line_items'
--      and column_name = 'show_surface_id';
--   select polname, polroles::regrole[] from pg_policy
--    where polrelid = 'public.show_surfaces'::regclass
--    order by polname;
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'show_surfaces'
--    order by grantee, privilege_type;
-- ============================================================

create table if not exists public.show_surfaces (
  id                    uuid primary key default gen_random_uuid(),
  show_id               uuid not null references public.shows(id) on delete cascade,
  owner_user_id         uuid not null references public.profiles(id) on delete cascade,
  type                  text not null,
  audience_size         integer,
  format                text,
  min_buy               numeric(10, 2),
  creative_constraints  text,
  lead_time_days        integer,
  posting_owner         text not null default 'creator',
  price                 numeric(10, 2),
  notes                 text,
  published             boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.show_surfaces drop constraint if exists show_surfaces_type_check;
alter table public.show_surfaces
  add constraint show_surfaces_type_check
  check (type in (
    'newsletter', 'instagram', 'tiktok', 'reels', 'shorts', 'x', 'linkedin',
    'patreon', 'discord', 'community', 'live_event', 'bonus_episode'
  ));

alter table public.show_surfaces drop constraint if exists show_surfaces_posting_owner_check;
alter table public.show_surfaces
  add constraint show_surfaces_posting_owner_check
  check (posting_owner in ('creator', 'brand'));

alter table public.show_surfaces drop constraint if exists show_surfaces_audience_size_check;
alter table public.show_surfaces
  add constraint show_surfaces_audience_size_check
  check (audience_size is null or audience_size >= 0);

alter table public.show_surfaces drop constraint if exists show_surfaces_min_buy_check;
alter table public.show_surfaces
  add constraint show_surfaces_min_buy_check
  check (min_buy is null or min_buy >= 0);

alter table public.show_surfaces drop constraint if exists show_surfaces_lead_time_check;
alter table public.show_surfaces
  add constraint show_surfaces_lead_time_check
  check (lead_time_days is null or lead_time_days >= 0);

alter table public.show_surfaces drop constraint if exists show_surfaces_price_check;
alter table public.show_surfaces
  add constraint show_surfaces_price_check
  check (price is null or price >= 0);

create index if not exists idx_show_surfaces_show
  on public.show_surfaces (show_id);

create index if not exists idx_show_surfaces_owner
  on public.show_surfaces (owner_user_id);

create index if not exists idx_show_surfaces_published
  on public.show_surfaces (show_id)
  where published;

-- Data API grants. No anon: unpublished rows and prices are not public.
grant select, insert, update, delete on public.show_surfaces to service_role;
grant select, insert, update, delete on public.show_surfaces to authenticated;

alter table public.show_surfaces enable row level security;

-- True when the signed-in creator owns this catalog show: their show
-- profile shares its Podscan id, a deal already ties their show profile
-- to it, or it is the private owner row this app creates for them
-- (data_sources contains show_owner and contact_email is their login).
create or replace function public.user_owns_show(target_show uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      exists (
        select 1
        from public.show_profiles sp
        join public.shows s on s.id = target_show
        where sp.user_id = auth.uid()
          and sp.podscan_id is not null
          and s.podscan_id is not null
          and s.podscan_id = sp.podscan_id
      )
      or exists (
        select 1
        from public.deals d
        join public.show_profiles sp on sp.id = d.show_profile_id
        where d.show_id = target_show
          and sp.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.shows s
        join public.profiles p on p.id = auth.uid()
        where s.id = target_show
          and 'show_owner' = any (s.data_sources)
          and s.contact_email is not null
          and p.email is not null
          and lower(s.contact_email) = lower(p.email)
      )
    );
$$;

revoke all on function public.user_owns_show(uuid) from public;
revoke all on function public.user_owns_show(uuid) from anon;
grant execute on function public.user_owns_show(uuid) to authenticated;
grant execute on function public.user_owns_show(uuid) to service_role;

drop policy if exists "Show owner manages own surfaces" on public.show_surfaces;
create policy "Show owner manages own surfaces"
  on public.show_surfaces
  for all
  to authenticated
  using (owner_user_id = auth.uid())
  with check (
    owner_user_id = auth.uid()
    and public.user_owns_show(show_id)
  );

drop policy if exists "Buyers read published surfaces" on public.show_surfaces;
create policy "Buyers read published surfaces"
  on public.show_surfaces
  for select
  to authenticated
  using (published = true);

drop policy if exists "Service role manages show surfaces" on public.show_surfaces;
create policy "Service role manages show surfaces"
  on public.show_surfaces
  for all
  to service_role
  using (true)
  with check (true);

drop trigger if exists update_show_surfaces_timestamp on public.show_surfaces;
create trigger update_show_surfaces_timestamp
  before update on public.show_surfaces
  for each row execute function update_updated_at();

comment on table public.show_surfaces is
  'Creator-attached sellable add-ons (newsletter, social, community, live, bonus). Not a discovery score input.';
comment on column public.show_surfaces.owner_user_id is
  'Creator who listed the surface (profiles.id). Writes require this to be auth.uid().';
comment on column public.show_surfaces.published is
  'Buyers can read the row only when this is true. The owner can read their own unpublished rows.';
comment on column public.show_surfaces.min_buy is
  'Suggested minimum. Displayed as guidance. Never used to exclude the show or the add-on.';
comment on column public.show_surfaces.posting_owner is
  'Who publishes the add-on: creator or brand.';

-- Grandfathered table. The new column inherits existing grants.
alter table public.io_line_items
  add column if not exists show_surface_id uuid references public.show_surfaces(id) on delete set null;

create index if not exists idx_io_line_items_show_surface
  on public.io_line_items (show_surface_id);

comment on column public.io_line_items.show_surface_id is
  'Optional add-on on this show. Null means a normal episode line. Does not change the platform fee.';
