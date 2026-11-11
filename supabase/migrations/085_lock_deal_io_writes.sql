-- ============================================================
-- 085: lock deal, IO, invoice, and outreach writes
--
-- SEC3. A signed-in brand, show, rep, or agency can no longer use
-- the Data API to change money or state columns on deals,
-- insertion_orders, io_line_items, invoices, invoice_line_items,
-- or outreaches. service_role is not granted or revoked.
--
-- deals keeps INSERT only on the legacy columns createDeal and
-- addDeals write. UPDATE and DELETE are revoked. The two UPDATE
-- policies are dropped, the same way 072 dropped the payments
-- write policies once the grant was gone.
--
-- insertion_orders, io_line_items, and invoices keep INSERT, and
-- keep UPDATE only on the columns the legacy IO editor and
-- updateInvoiceStatus write. invoice_line_items keeps INSERT and
-- loses UPDATE and DELETE. A guard rejects those writes when the
-- parent deal is missing or is a DocuSign-flow deal (outreach_id,
-- brand_profile_id, or docusign_envelope_id is not null).
--
-- outreaches and payouts lose INSERT, UPDATE, and DELETE.
-- Outreach SELECT policies stay. Every SELECT grant stays.
--
-- NOT applied. Apply only after merge and Chris's OK. Paste this
-- file into the SQL Editor. Do not run it from the app, a seed
-- script, or a deploy hook.
--
-- Idempotent. Safe to re-run. No backfill. No new table.
--
-- Introspection (run after applying, read only):
--   select table_name, grantee,
--          string_agg(privilege_type, ',' order by privilege_type)
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and grantee in ('anon', 'authenticated', 'PUBLIC', 'service_role')
--      and table_name in (
--        'deals', 'insertion_orders', 'io_line_items', 'invoices',
--        'invoice_line_items', 'outreaches', 'payouts'
--      )
--    group by 1, 2
--    order by 1, 2;
--   Column grants (table-level INSERT/UPDATE was revoked first):
--   select table_name, grantee, column_name, privilege_type
--     from information_schema.column_privileges
--    where table_schema = 'public'
--      and grantee = 'authenticated'
--      and table_name in (
--        'deals', 'insertion_orders', 'io_line_items', 'invoices'
--      )
--    order by 1, 3, 4;
--   Expected: anon and PUBLIC have no rows. authenticated has
--   table-level SELECT on each table, no table-level UPDATE or
--   DELETE, and no table-level INSERT except where INSERT was
--   left in place (insertion_orders, io_line_items, invoices,
--   invoice_line_items). deals INSERT and the editor UPDATE lists
--   are column privileges. service_role still has SELECT, INSERT,
--   UPDATE, and DELETE on each table.
--   select c.relname, t.tgname
--     from pg_trigger t
--     join pg_class c on c.oid = t.tgrelid
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and not t.tgisinternal
--      and t.tgname = 'reject_client_write_on_docusign_deal'
--    order by 1;
--   Expected: one row each on insertion_orders, io_line_items,
--   invoices, and invoice_line_items.
--   select tablename, policyname
--     from pg_policies
--    where schemaname = 'public'
--      and policyname in (
--        'Brand updates own deals via brand_profile',
--        'Deal participants update deals',
--        'Brand inserts own outreach',
--        'Brand updates own outreach'
--      );
--   Expected: no rows. SELECT policies are unchanged.
-- ============================================================

revoke update, delete on table public.deals from authenticated, anon, public;

drop policy if exists "Brand updates own deals via brand_profile" on public.deals;
drop policy if exists "Deal participants update deals" on public.deals;

revoke insert on table public.deals from authenticated, anon, public;

-- Legacy columns written by createDeal and addDeals. Naming any
-- other deals column, including id, created_at, and updated_at,
-- fails with 42501. "Deal participants insert deals" stays.
grant insert (
  campaign_id,
  show_id,
  brand_id,
  agent_id,
  agency_id,
  status,
  num_episodes,
  placement,
  ad_format,
  price_type,
  cpm_rate,
  gross_cpm,
  guaranteed_downloads,
  net_per_episode,
  gross_per_episode,
  total_net,
  total_gross,
  is_scripted,
  is_personal_experience,
  reader_type,
  content_type,
  pixel_required,
  competitor_exclusion,
  exclusivity_days,
  rofr_days,
  flight_start,
  flight_end,
  notes
) on table public.deals to authenticated;

create schema if not exists private;

create or replace function private.reject_client_write_on_docusign_deal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claims text;
  jwt_role text;
  invoker text;
  deal_ids uuid[] := array[]::uuid[];
  parent uuid;
  one uuid;
  locked boolean;
begin
  -- SECURITY DEFINER makes current_user the function owner, so
  -- 072's current_user test cannot be copied as-is. The same three
  -- signals (service_role, postgres, supabase_admin, plus a
  -- service_role JWT or auth.role()) are read from the invoker.
  claims := nullif(current_setting('request.jwt.claims', true), '');
  if claims is not null and left(btrim(claims), 1) = '{' then
    jwt_role := claims::json ->> 'role';
  end if;

  if jwt_role = 'service_role' or auth.role() = 'service_role' then
    return new;
  end if;

  invoker := nullif(current_setting('role', true), '');
  if invoker is null or invoker = 'none' then
    invoker := session_user;
  end if;

  if invoker in ('service_role', 'postgres', 'supabase_admin')
     and jwt_role is distinct from 'authenticated'
     and auth.role() is distinct from 'authenticated'
  then
    return new;
  end if;

  if tg_table_name = 'insertion_orders' then
    deal_ids := array_append(deal_ids, new.deal_id);
    if tg_op = 'UPDATE' then
      deal_ids := array_append(deal_ids, old.deal_id);
    end if;
  elsif tg_table_name = 'io_line_items' then
    parent := null;
    select io.deal_id into parent
      from public.insertion_orders io
     where io.id = new.io_id;
    deal_ids := array_append(deal_ids, parent);
    if tg_op = 'UPDATE' then
      parent := null;
      select io.deal_id into parent
        from public.insertion_orders io
       where io.id = old.io_id;
      deal_ids := array_append(deal_ids, parent);
    end if;
  elsif tg_table_name = 'invoices' then
    parent := null;
    select io.deal_id into parent
      from public.insertion_orders io
     where io.id = new.io_id;
    deal_ids := array_append(deal_ids, parent);
    if tg_op = 'UPDATE' then
      parent := null;
      select io.deal_id into parent
        from public.insertion_orders io
       where io.id = old.io_id;
      deal_ids := array_append(deal_ids, parent);
    end if;
  elsif tg_table_name = 'invoice_line_items' then
    parent := null;
    select io.deal_id into parent
      from public.invoices inv
      join public.insertion_orders io on io.id = inv.io_id
     where inv.id = new.invoice_id;
    deal_ids := array_append(deal_ids, parent);
    if tg_op = 'UPDATE' then
      parent := null;
      select io.deal_id into parent
        from public.invoices inv
        join public.insertion_orders io on io.id = inv.io_id
       where inv.id = old.invoice_id;
      deal_ids := array_append(deal_ids, parent);
    end if;
  else
    raise exception 'client write rejected (42501)'
      using errcode = '42501';
  end if;

  foreach one in array deal_ids loop
    locked := null;
    if one is not null then
      select (
        d.outreach_id is not null
        or d.brand_profile_id is not null
        or d.docusign_envelope_id is not null
      )
        into locked
        from public.deals d
       where d.id = one;
    end if;
    if locked is null or locked then
      raise exception 'client write rejected (42501)'
        using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$$;

comment on function private.reject_client_write_on_docusign_deal() is
  'Rejects an authenticated insert or update when the parent deal is missing or is a DocuSign-flow deal.';

revoke all on function private.reject_client_write_on_docusign_deal() from public;
revoke all on function private.reject_client_write_on_docusign_deal() from anon;
revoke all on function private.reject_client_write_on_docusign_deal() from authenticated;

drop trigger if exists reject_client_write_on_docusign_deal on public.insertion_orders;
create trigger reject_client_write_on_docusign_deal
  before insert or update on public.insertion_orders
  for each row
  execute function private.reject_client_write_on_docusign_deal();

drop trigger if exists reject_client_write_on_docusign_deal on public.io_line_items;
create trigger reject_client_write_on_docusign_deal
  before insert or update on public.io_line_items
  for each row
  execute function private.reject_client_write_on_docusign_deal();

drop trigger if exists reject_client_write_on_docusign_deal on public.invoices;
create trigger reject_client_write_on_docusign_deal
  before insert or update on public.invoices
  for each row
  execute function private.reject_client_write_on_docusign_deal();

drop trigger if exists reject_client_write_on_docusign_deal on public.invoice_line_items;
create trigger reject_client_write_on_docusign_deal
  before insert or update on public.invoice_line_items
  for each row
  execute function private.reject_client_write_on_docusign_deal();

revoke update, delete on table public.insertion_orders from authenticated, anon, public;

-- IO_FIELDS from app/api/deals/[id]/io/route.ts, plus the totals
-- update and updated_at. status, signed_at, and sent_at are not
-- included. INSERT stays so createIO can still write a legacy draft.
grant update (
  advertiser_name,
  advertiser_contact_name,
  advertiser_contact_email,
  publisher_name,
  publisher_contact_name,
  publisher_contact_email,
  publisher_address,
  agency_name,
  agency_contact_name,
  agency_contact_email,
  agency_billing_contact,
  agency_address,
  send_invoices_to,
  payment_terms,
  payment_off_platform,
  competitor_exclusion,
  exclusivity_days,
  rofr_days,
  rofr_enabled,
  cancellation_notice_days,
  download_tracking_days,
  download_tracking_enabled,
  make_good_threshold,
  make_good_enabled,
  payer,
  total_downloads,
  total_gross,
  total_net,
  updated_at
) on table public.insertion_orders to authenticated;

revoke update, delete on table public.io_line_items from authenticated, anon, public;

-- LINE_FIELDS exactly. id, io_id, and created_at are not included.
-- INSERT stays.
grant update (
  format,
  spot_format,
  show_surface_id,
  post_date,
  guaranteed_downloads,
  show_name,
  placement,
  is_scripted,
  is_personal_experience,
  reader_type,
  content_type,
  pixel_required,
  gross_rate,
  gross_cpm,
  price_type,
  net_due,
  actual_post_date,
  actual_downloads,
  episode_url,
  ad_timestamp,
  verified,
  make_good_triggered,
  make_good_reason
) on table public.io_line_items to authenticated;

revoke update, delete on table public.invoices from authenticated, anon, public;

-- Columns updateInvoiceStatus writes. total_due is not included.
-- INSERT stays.
grant update (
  status,
  sent_at,
  paid_at,
  payment_method,
  updated_at
) on table public.invoices to authenticated;

revoke update, delete on table public.invoice_line_items from authenticated, anon, public;

revoke insert, update, delete on table public.outreaches from authenticated, anon, public;

drop policy if exists "Brand inserts own outreach" on public.outreaches;
drop policy if exists "Brand updates own outreach" on public.outreaches;

revoke insert, update, delete on table public.payouts from authenticated, anon, public;
