-- ============================================================
-- 048: make-goods — underdelivery found from an aircheck
--
-- A missed spot (the aircheck did not find the read, or a person
-- rejected it) or a short spot (the aircheck says the read ran and
-- downloads fell more than make_good_threshold below the guarantee)
-- becomes one row per IO line. The brand on the deal approves one
-- option in the app. Approval records amended terms and, for a
-- replacement or re-air, an unpaid unverified line. It does not
-- send DocuSign and it does not charge.
--
-- The show on the row is deals.show_id. show_profiles.podscan_id
-- is not a source.
--
-- Idempotent. Safe to re-run. No backfill. Do not apply from the
-- app. Apply in the Supabase SQL editor, then introspect.
--
-- Introspection check (run after applying):
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'make_goods'
--    order by ordinal_position;
--   select conname from pg_constraint
--    where conrelid = 'public.make_goods'::regclass
--    order by conname;
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'make_goods'
--    order by grantee, privilege_type;
--   select polname, polcmd, polroles::regrole[]
--     from pg_policy
--    where polrelid = 'public.make_goods'::regclass
--    order by polname;
--   Expected: no grant to anon. authenticated has SELECT only
--   (no insert, update, or delete). service_role has select,
--   insert, update, and delete. RLS enabled. Brand can select.
--   Show can select. No authenticated update policy. Service role
--   can do all. Writes go through service_role routes.
-- ============================================================

create table if not exists public.make_goods (
  id                        uuid primary key default gen_random_uuid(),
  deal_id                   uuid not null references public.deals(id) on delete cascade,
  io_id                     uuid not null references public.insertion_orders(id) on delete cascade,
  io_line_item_id           uuid not null references public.io_line_items(id) on delete cascade,
  aircheck_id               uuid references public.airchecks(id) on delete set null,
  -- Copied from deals.show_id at detection. Not show_profiles.podscan_id.
  show_id                   uuid not null references public.shows(id) on delete cascade,
  kind                      text not null,
  status                    text not null default 'proposed',
  delivery_state            text not null default 'pending_approval',
  reason                    text not null,
  show_name                 text not null,
  placement                 text not null,
  post_date                 date not null,
  guaranteed_downloads      integer not null,
  actual_downloads          integer,
  shortfall_pct             numeric(6,4),
  threshold                 numeric(4,3) not null,
  options                   jsonb not null,
  selected_option           text,
  amended_terms             text not null,
  credit_amount             numeric(10,2),
  replacement_line_item_id  uuid references public.io_line_items(id) on delete set null,
  replacement_post_date     date,
  decided_by                uuid references public.profiles(id) on delete set null,
  decided_at                timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

alter table public.make_goods drop constraint if exists make_goods_kind_check;
alter table public.make_goods
  add constraint make_goods_kind_check
  check (kind in ('missed', 'short'));

alter table public.make_goods drop constraint if exists make_goods_status_check;
alter table public.make_goods
  add constraint make_goods_status_check
  check (status in ('proposed', 'approved', 'declined'));

alter table public.make_goods drop constraint if exists make_goods_delivery_state_check;
alter table public.make_goods
  add constraint make_goods_delivery_state_check
  check (delivery_state in ('pending_approval', 'scheduled', 'credited', 'declined'));

alter table public.make_goods drop constraint if exists make_goods_selected_option_check;
alter table public.make_goods
  add constraint make_goods_selected_option_check
  check (
    selected_option is null
    or selected_option in ('replacement_spot', 'reair', 'credit_shortfall')
  );

alter table public.make_goods drop constraint if exists make_goods_io_line_item_id_key;
alter table public.make_goods
  add constraint make_goods_io_line_item_id_key unique (io_line_item_id);

create index if not exists idx_make_goods_deal on public.make_goods(deal_id);
create index if not exists idx_make_goods_status on public.make_goods(status);

-- Data API grants. No anon. Grants are the table gate; RLS filters rows.
-- ASSERT: authenticated has no write grant on public.make_goods (SELECT only).
-- A brand must not INSERT, UPDATE, or DELETE make_goods through the Data API
-- and skip decide.ts. Approval and decline run as service_role.
revoke all on public.make_goods from anon;
revoke all on public.make_goods from authenticated;
grant select, insert, update, delete on public.make_goods to service_role;
grant select on public.make_goods to authenticated;

alter table public.make_goods enable row level security;

drop policy if exists "Service role manages make_goods" on public.make_goods;
create policy "Service role manages make_goods"
  on public.make_goods for all to service_role
  using (true) with check (true);

-- Brand of the deal: deals.brand_id or the user on deals.brand_profile_id.
-- Read only. The brand update policy is dropped and not recreated so a
-- re-run removes it. Writes are service_role routes only.
drop policy if exists "Brand reads make-goods on own deals" on public.make_goods;
create policy "Brand reads make-goods on own deals"
  on public.make_goods for select to authenticated
  using (
    exists (
      select 1
      from public.deals d
      left join public.brand_profiles bp on bp.id = d.brand_profile_id
      where d.id = make_goods.deal_id
        and (d.brand_id = auth.uid() or bp.user_id = auth.uid())
    )
  );

drop policy if exists "Brand updates make-goods on own deals" on public.make_goods;

-- Show reads through deals.show_profile_id. Not show_profiles.podscan_id.
drop policy if exists "Show reads make-goods on own deals" on public.make_goods;
create policy "Show reads make-goods on own deals"
  on public.make_goods for select to authenticated
  using (
    exists (
      select 1
      from public.deals d
      join public.show_profiles sp on sp.id = d.show_profile_id
      where d.id = make_goods.deal_id
        and sp.user_id = auth.uid()
    )
  );

drop trigger if exists update_make_goods_timestamp on public.make_goods;
create trigger update_make_goods_timestamp
  before update on public.make_goods
  for each row execute function update_updated_at();

comment on table public.make_goods is
  'One make-good per IO line. Detected from an aircheck when insertion_orders.make_good_enabled is on. Brand approval records amended terms in the app. Does not send DocuSign and does not charge.';
comment on column public.make_goods.show_id is
  'deals.show_id at detection. Do not resolve the show through show_profiles.podscan_id.';
comment on column public.make_goods.kind is
  'missed: the aircheck did not find the spot, or the review rejected it. short: the aircheck says the spot ran and downloads fell more than the IO threshold below the guarantee.';
comment on column public.make_goods.delivery_state is
  'pending_approval until the brand decides. scheduled: an unpaid unverified replacement line is on the IO. credited: the shortfall is recorded and no line is added. declined: the brand waived the remedy.';
comment on column public.make_goods.amended_terms is
  'Draft the brand reads before approval, then the chosen remedy. Not sent to DocuSign.';
