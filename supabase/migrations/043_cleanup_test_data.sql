-- ============================================================
-- 043: transactional test-data cleanup
--
-- scripts/cleanup-test-data.ts is a dry run until --execute. --execute
-- calls public.cleanup_test_data. This function deletes the ids it is
-- given, children before parents, and writes one domain_events row per
-- non-empty batch. A raise aborts the whole transaction.
--
-- It does not delete auth.users, profiles, or payouts. It refuses the
-- managed proof account (chris+brand1@taylslate.com /
-- 052f916b-e4a1-4f3e-8816-3cd53dbf7ccc), deal
-- ccb7db74-08bb-41d7-aa3a-dbc37daa9b55, any non-test owner, any Stripe
-- charge, any payout, and any sent or paid invoice.
--
-- SECURITY INVOKER. Execute is granted to service_role only.
-- Do not apply from this repo's tooling — paste into the SQL editor.
--
-- Idempotent. Safe to re-run.
--
-- Introspection check (run after applying):
--   select p.proname, p.prosecdef
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in (
--        'cleanup_test_data',
--        'cleanup_test_data_delete_batch',
--        'cleanup_test_data_log_batch'
--      );
--   prosecdef must be false (invoker).
--   select grantee, privilege_type
--     from information_schema.routine_privileges
--    where routine_schema = 'public'
--      and routine_name = 'cleanup_test_data';
--   service_role has EXECUTE. anon and authenticated do not.
-- ============================================================

create or replace function public.cleanup_test_data_delete_batch(
  p_table text,
  p_ids uuid[]
) returns uuid[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_deleted uuid[];
  v_expected integer;
begin
  if p_table not in (
    'invoice_line_items',
    'invoices',
    'payments',
    'airchecks',
    'io_line_items',
    'insertion_orders',
    'deals',
    'outreaches',
    'campaigns',
    'shows'
  ) then
    raise exception 'cleanup_test_data: table not deletable: %', p_table;
  end if;

  if coalesce(array_length(p_ids, 1), 0) = 0 then
    return '{}'::uuid[];
  end if;

  execute format(
    'with deleted as (delete from public.%I where id = any($1) returning id)
     select coalesce(array_agg(id), ''{}''::uuid[]) from deleted',
    p_table
  )
  into v_deleted
  using p_ids;

  select count(*) into v_expected from (select distinct unnest(p_ids) id) s;
  if coalesce(array_length(v_deleted, 1), 0) <> v_expected then
    raise exception 'cleanup_test_data: % batch deleted %, expected %',
      p_table, coalesce(array_length(v_deleted, 1), 0), v_expected;
  end if;

  return v_deleted;
end;
$$;

create or replace function public.cleanup_test_data_log_batch(
  p_batch text,
  p_ids uuid[]
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  v_count := coalesce(array_length(p_ids, 1), 0);
  if v_count = 0 then
    return 0;
  end if;

  insert into public.domain_events (
    event_type,
    entity_type,
    entity_id,
    actor_id,
    payload,
    schema_version
  ) values (
    'admin.test_data_cleanup',
    p_batch,
    p_ids[1],
    null,
    jsonb_build_object(
      'batch', p_batch,
      'ids', to_jsonb(p_ids),
      'count', v_count,
      'dry_run', false
    ),
    'v1'
  );

  return v_count;
end;
$$;

create or replace function public.cleanup_test_data(
  p_invoice_line_item_ids uuid[],
  p_invoice_ids uuid[],
  p_payment_ids uuid[],
  p_aircheck_ids uuid[],
  p_line_item_ids uuid[],
  p_io_ids uuid[],
  p_deal_ids uuid[],
  p_outreach_ids uuid[],
  p_campaign_ids uuid[],
  p_show_ids uuid[],
  p_expected_count integer
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  proof_deal constant uuid := 'ccb7db74-08bb-41d7-aa3a-dbc37daa9b55';
  proof_user constant uuid := '052f916b-e4a1-4f3e-8816-3cd53dbf7ccc';
  proof_email constant text := 'chris+brand1@taylslate.com';
  test_email constant text := '^chris\+[^@[:space:]]+@taylslate\.com$';
  v_deleted uuid[];
  v_count integer := 0;
  v_events integer := 0;
begin
  if p_expected_count is null or p_expected_count < 0 then
    raise exception 'cleanup_test_data: expected count is required';
  end if;

  p_invoice_line_item_ids := coalesce((select array_agg(distinct uid) from unnest(coalesce(p_invoice_line_item_ids, '{}'::uuid[])) as t(uid) where uid is not null), '{}'::uuid[]);
  p_invoice_ids := coalesce((select array_agg(distinct uid) from unnest(coalesce(p_invoice_ids, '{}'::uuid[])) as t(uid) where uid is not null), '{}'::uuid[]);
  p_payment_ids := coalesce((select array_agg(distinct uid) from unnest(coalesce(p_payment_ids, '{}'::uuid[])) as t(uid) where uid is not null), '{}'::uuid[]);
  p_aircheck_ids := coalesce((select array_agg(distinct uid) from unnest(coalesce(p_aircheck_ids, '{}'::uuid[])) as t(uid) where uid is not null), '{}'::uuid[]);
  p_line_item_ids := coalesce((select array_agg(distinct uid) from unnest(coalesce(p_line_item_ids, '{}'::uuid[])) as t(uid) where uid is not null), '{}'::uuid[]);
  p_io_ids := coalesce((select array_agg(distinct uid) from unnest(coalesce(p_io_ids, '{}'::uuid[])) as t(uid) where uid is not null), '{}'::uuid[]);
  p_deal_ids := coalesce((select array_agg(distinct uid) from unnest(coalesce(p_deal_ids, '{}'::uuid[])) as t(uid) where uid is not null), '{}'::uuid[]);
  p_outreach_ids := coalesce((select array_agg(distinct uid) from unnest(coalesce(p_outreach_ids, '{}'::uuid[])) as t(uid) where uid is not null), '{}'::uuid[]);
  p_campaign_ids := coalesce((select array_agg(distinct uid) from unnest(coalesce(p_campaign_ids, '{}'::uuid[])) as t(uid) where uid is not null), '{}'::uuid[]);
  p_show_ids := coalesce((select array_agg(distinct uid) from unnest(coalesce(p_show_ids, '{}'::uuid[])) as t(uid) where uid is not null), '{}'::uuid[]);

  if proof_deal = any(p_deal_ids) then
    raise exception 'cleanup_test_data: refusing proof deal %', proof_deal;
  end if;

  -- Brand-side owners only. The show on a test deal is not an owner.
  if exists (
    select 1
    from public.deals d
    left join public.campaigns c on c.id = d.campaign_id
    left join public.profiles brand on brand.id = d.brand_id
    left join public.profiles agent on agent.id = d.agent_id
    left join public.profiles agency on agency.id = d.agency_id
    left join public.profiles camp_owner on camp_owner.id = c.user_id
    left join public.brand_profiles bp on bp.id = d.brand_profile_id
    left join public.profiles bp_user on bp_user.id = bp.user_id
    where d.id = any(p_deal_ids)
      and (
        d.brand_id = proof_user
        or d.agent_id = proof_user
        or d.agency_id = proof_user
        or c.user_id = proof_user
        or bp.user_id = proof_user
        or lower(btrim(brand.email)) = proof_email
        or lower(btrim(agent.email)) = proof_email
        or lower(btrim(agency.email)) = proof_email
        or lower(btrim(camp_owner.email)) = proof_email
        or lower(btrim(bp_user.email)) = proof_email
        or (brand.email is not null and brand.email !~* test_email)
        or (agent.email is not null and agent.email !~* test_email)
        or (agency.email is not null and agency.email !~* test_email)
        or (camp_owner.email is not null and camp_owner.email !~* test_email)
        or (bp_user.email is not null and bp_user.email !~* test_email)
      )
  ) then
    raise exception 'cleanup_test_data: refusing deal owned by a non-test or proof profile';
  end if;

  if exists (
    select 1
    from public.campaigns c
    join public.profiles p on p.id = c.user_id
    where c.id = any(p_campaign_ids)
      and (
        c.user_id = proof_user
        or lower(btrim(p.email)) = proof_email
        or p.email !~* test_email
      )
  ) then
    raise exception 'cleanup_test_data: refusing campaign owned by a non-test or proof profile';
  end if;

  if exists (
    select 1
    from public.outreaches o
    join public.brand_profiles bp on bp.id = o.brand_profile_id
    join public.profiles p on p.id = bp.user_id
    where o.id = any(p_outreach_ids)
      and (
        p.id = proof_user
        or lower(btrim(p.email)) = proof_email
        or p.email !~* test_email
      )
  ) then
    raise exception 'cleanup_test_data: refusing outreach owned by a non-test or proof profile';
  end if;

  if exists (
    select 1
    from public.payments p
    where (
      p.id = any(p_payment_ids)
      or p.deal_id = any(p_deal_ids)
      or p.io_line_item_id = any(p_line_item_ids)
      or p.invoice_id = any(p_invoice_ids)
    )
    and (
      nullif(btrim(p.stripe_payment_intent_id), '') is not null
      or nullif(btrim(p.stripe_payment_id), '') is not null
      or p.charged_at is not null
      or coalesce(p.amount_charged_cents, 0) > 0
      or p.status in ('succeeded', 'completed', 'processing', 'refunded', 'disputed')
    )
  ) then
    raise exception 'cleanup_test_data: refusing stripe charge';
  end if;

  if exists (
    select 1
    from public.payouts po
    join public.payments p on p.id = po.payment_id
    where p.id = any(p_payment_ids)
      or p.deal_id = any(p_deal_ids)
      or p.io_line_item_id = any(p_line_item_ids)
      or p.invoice_id = any(p_invoice_ids)
  ) then
    raise exception 'cleanup_test_data: refusing payout / stripe transfer';
  end if;

  if exists (
    select 1
    from public.invoices i
    where (i.id = any(p_invoice_ids) or i.io_id = any(p_io_ids))
      and (
        i.status in ('paid', 'sent')
        or i.paid_at is not null
        or i.sent_at is not null
      )
  ) then
    raise exception 'cleanup_test_data: refusing sent or paid invoice';
  end if;

  if exists (
    select 1 from public.payments p
    where (
      p.deal_id = any(p_deal_ids)
      or p.io_line_item_id = any(p_line_item_ids)
      or p.invoice_id = any(p_invoice_ids)
    )
    and not (p.id = any(p_payment_ids))
  ) then
    raise exception 'cleanup_test_data: a payment on a targeted row is not in the plan';
  end if;

  if exists (
    select 1 from public.invoices i
    where i.io_id = any(p_io_ids)
      and not (i.id = any(p_invoice_ids))
  ) then
    raise exception 'cleanup_test_data: an invoice on a targeted IO is not in the plan';
  end if;

  if exists (
    select 1 from public.invoice_line_items ili
    where (ili.invoice_id = any(p_invoice_ids) or ili.io_line_item_id = any(p_line_item_ids))
      and not (ili.id = any(p_invoice_line_item_ids))
  ) then
    raise exception 'cleanup_test_data: an invoice line on a targeted row is not in the plan';
  end if;

  if exists (
    select 1 from public.io_line_items li
    where li.io_id = any(p_io_ids)
      and not (li.id = any(p_line_item_ids))
  ) then
    raise exception 'cleanup_test_data: a line item on a targeted IO is not in the plan';
  end if;

  if exists (
    select 1 from public.insertion_orders io
    where io.deal_id = any(p_deal_ids)
      and not (io.id = any(p_io_ids))
  ) then
    raise exception 'cleanup_test_data: an IO on a targeted deal is not in the plan';
  end if;

  if exists (
    select 1 from public.airchecks a
    where a.io_line_item_id = any(p_line_item_ids)
      and not (a.id = any(p_aircheck_ids))
  ) then
    raise exception 'cleanup_test_data: an aircheck on a targeted line is not in the plan';
  end if;

  if exists (
    select 1
    from public.insertion_orders io
    join public.deals d on d.id = io.deal_id
    where io.id = any(p_io_ids)
      and not (d.id = any(p_deal_ids))
  ) then
    raise exception 'cleanup_test_data: IO belongs to a deal that is not in the plan';
  end if;

  if exists (
    select 1
    from public.io_line_items li
    join public.insertion_orders io on io.id = li.io_id
    where li.id = any(p_line_item_ids)
      and not (io.id = any(p_io_ids))
  ) then
    raise exception 'cleanup_test_data: line item belongs to an IO that is not in the plan';
  end if;

  if exists (
    select 1 from public.deals d
    where d.outreach_id = any(p_outreach_ids)
      and not (d.id = any(p_deal_ids))
  ) then
    raise exception 'cleanup_test_data: outreach cascades to a deal that is not in the plan';
  end if;

  if exists (
    select 1 from public.deals d
    where d.campaign_id = any(p_campaign_ids)
      and not (d.id = any(p_deal_ids))
  ) then
    raise exception 'cleanup_test_data: campaign still has a deal that is not in the plan';
  end if;

  if exists (
    select 1
    from public.outreaches o
    join public.deals d on d.outreach_id = o.id
    where o.campaign_id = any(p_campaign_ids)
      and not (d.id = any(p_deal_ids))
  ) then
    raise exception 'cleanup_test_data: campaign outreach cascades to a deal that is not in the plan';
  end if;

  if exists (
    select 1 from public.deals d
    where d.show_id = any(p_show_ids)
      and not (d.id = any(p_deal_ids))
  ) then
    raise exception 'cleanup_test_data: show still has a deal that is not in the plan';
  end if;

  if exists (
    select 1 from public.outreaches o
    where o.show_id = any(p_show_ids)
      and not (o.id = any(p_outreach_ids))
  ) then
    raise exception 'cleanup_test_data: show is still referenced by an outreach that is not in the plan';
  end if;

  -- data_sources containing 'seed' is the Podscan catalog import, not a
  -- fabricated show. Only the [SEED] name prefix or an otr- slug qualifies.
  if exists (
    select 1 from public.shows s
    where s.id = any(p_show_ids)
      and s.name not like '[SEED]%'
      and coalesce(s.slug, '') !~* '^otr-[0-9a-f]{8}-'
  ) then
    raise exception 'cleanup_test_data: refusing a show that is not a seed show';
  end if;

  -- Children before parents. Airchecks go before line items so the
  -- line-item cascade does not remove them before this batch counts them.
  v_deleted := public.cleanup_test_data_delete_batch('invoice_line_items', p_invoice_line_item_ids);
  if coalesce(array_length(v_deleted, 1), 0) > 0 then
    v_events := v_events + 1;
    v_count := v_count + public.cleanup_test_data_log_batch('invoice_line_item', v_deleted);
  end if;

  v_deleted := public.cleanup_test_data_delete_batch('payments', p_payment_ids);
  if coalesce(array_length(v_deleted, 1), 0) > 0 then
    v_events := v_events + 1;
    v_count := v_count + public.cleanup_test_data_log_batch('payment', v_deleted);
  end if;

  v_deleted := public.cleanup_test_data_delete_batch('invoices', p_invoice_ids);
  if coalesce(array_length(v_deleted, 1), 0) > 0 then
    v_events := v_events + 1;
    v_count := v_count + public.cleanup_test_data_log_batch('invoice', v_deleted);
  end if;

  v_deleted := public.cleanup_test_data_delete_batch('airchecks', p_aircheck_ids);
  if coalesce(array_length(v_deleted, 1), 0) > 0 then
    v_events := v_events + 1;
    v_count := v_count + public.cleanup_test_data_log_batch('aircheck', v_deleted);
  end if;

  v_deleted := public.cleanup_test_data_delete_batch('io_line_items', p_line_item_ids);
  if coalesce(array_length(v_deleted, 1), 0) > 0 then
    v_events := v_events + 1;
    v_count := v_count + public.cleanup_test_data_log_batch('io_line_item', v_deleted);
  end if;

  v_deleted := public.cleanup_test_data_delete_batch('insertion_orders', p_io_ids);
  if coalesce(array_length(v_deleted, 1), 0) > 0 then
    v_events := v_events + 1;
    v_count := v_count + public.cleanup_test_data_log_batch('insertion_order', v_deleted);
  end if;

  v_deleted := public.cleanup_test_data_delete_batch('deals', p_deal_ids);
  if coalesce(array_length(v_deleted, 1), 0) > 0 then
    v_events := v_events + 1;
    v_count := v_count + public.cleanup_test_data_log_batch('deal', v_deleted);
  end if;

  v_deleted := public.cleanup_test_data_delete_batch('outreaches', p_outreach_ids);
  if coalesce(array_length(v_deleted, 1), 0) > 0 then
    v_events := v_events + 1;
    v_count := v_count + public.cleanup_test_data_log_batch('outreach', v_deleted);
  end if;

  v_deleted := public.cleanup_test_data_delete_batch('campaigns', p_campaign_ids);
  if coalesce(array_length(v_deleted, 1), 0) > 0 then
    v_events := v_events + 1;
    v_count := v_count + public.cleanup_test_data_log_batch('campaign', v_deleted);
  end if;

  v_deleted := public.cleanup_test_data_delete_batch('shows', p_show_ids);
  if coalesce(array_length(v_deleted, 1), 0) > 0 then
    v_events := v_events + 1;
    v_count := v_count + public.cleanup_test_data_log_batch('show', v_deleted);
  end if;

  if v_count <> p_expected_count then
    raise exception 'cleanup_test_data: deleted % rows, confirm %', v_count, p_expected_count;
  end if;

  return jsonb_build_object(
    'deleted_count', v_count,
    'event_count', v_events
  );
end;
$$;

revoke all on function public.cleanup_test_data_delete_batch(text, uuid[]) from public;
revoke all on function public.cleanup_test_data_delete_batch(text, uuid[]) from anon;
revoke all on function public.cleanup_test_data_delete_batch(text, uuid[]) from authenticated;
grant execute on function public.cleanup_test_data_delete_batch(text, uuid[]) to service_role;

revoke all on function public.cleanup_test_data_log_batch(text, uuid[]) from public;
revoke all on function public.cleanup_test_data_log_batch(text, uuid[]) from anon;
revoke all on function public.cleanup_test_data_log_batch(text, uuid[]) from authenticated;
grant execute on function public.cleanup_test_data_log_batch(text, uuid[]) to service_role;

revoke all on function public.cleanup_test_data(uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], integer) from public;
revoke all on function public.cleanup_test_data(uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], integer) from anon;
revoke all on function public.cleanup_test_data(uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], integer) from authenticated;
grant execute on function public.cleanup_test_data(uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], integer) to service_role;
