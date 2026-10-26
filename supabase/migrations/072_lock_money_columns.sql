-- ============================================================
-- 072: lock profile money columns and payments writes
--
-- SA-01 / SA-05. "Users update own profile" lets a signed-in user
-- set platform_fee_percentage, plan, role, tier, seat_count,
-- campaigns_this_month, subscription_status, and the Stripe ids.
-- chargeForEpisode snapshots platform_fee_percentage. This trigger
-- rejects those changes unless the caller is service_role (or a
-- migration role with no end-user JWT). A non-service_role insert
-- may only start as tier free, role brand or show, and the column
-- defaults for the fee, plan, subscription status, Stripe ids,
-- seat_count, and campaigns_this_month. That is the ensureProfile
-- insert. Any other value raises.
--
-- SA-02. authenticated still has insert, update, and delete on
-- payments, and "Payments insert via deal" lets a deal participant
-- insert a row. findExistingPayment then skips Stripe. This
-- revokes those writes from authenticated, anon, and public, and
-- drops every INSERT and UPDATE policy. Participant SELECT
-- policies stay. service_role keeps full access.
--
-- Column UPDATE is revoked from authenticated on the locked
-- profile columns as a second layer. The table-level UPDATE grant
-- remains so a normal column such as full_name still updates. The
-- trigger is what rejects a locked column when that table grant
-- is present.
--
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and
-- Chris's OK. Do not run this from the app, a seed script, or a
-- deploy hook.
--
-- Idempotent. Safe to re-run. No backfill.
--
-- Introspection (run after applying, read only):
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'payments'
--      and grantee in ('authenticated', 'anon', 'PUBLIC')
--    order by grantee, privilege_type;
--   Expected: authenticated has SELECT only. anon and PUBLIC have
--   no rows. service_role is unchanged (compare a query that does
--   not filter grantee).
--   select tgname from pg_trigger
--    where tgname = 'profiles_protect_money_columns';
--   Expected: one row.
-- ============================================================

revoke insert, update, delete, truncate, references, trigger
  on table public.payments from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.payments from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.payments from public;

revoke all on table public.payments from anon;
revoke all on table public.payments from public;

-- service_role already has full access (020 / 023). Re-assert the
-- Data API DML grants. Do not revoke anything from service_role.
grant select, insert, update, delete on table public.payments to service_role;

-- Keep the participant read. 020 and 023 granted this. Do not
-- revoke SELECT from authenticated.
grant select on table public.payments to authenticated;

alter table public.payments enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename = 'payments'
       and cmd in ('INSERT', 'UPDATE')
  loop
    execute format('drop policy if exists %I on public.payments', pol.policyname);
  end loop;
end $$;

revoke update (
  platform_fee_percentage,
  plan,
  subscription_status,
  stripe_customer_id,
  stripe_subscription_id,
  stripe_connect_account_id,
  role,
  tier,
  seat_count,
  campaigns_this_month
) on table public.profiles from authenticated;

create or replace function public.protect_profiles_money_columns()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  claims text;
  jwt_role text;
  allowed boolean;
begin
  -- 041 allows service_role and the migration roles via current_user.
  -- auth.role() and request.jwt.claims cover a service JWT. An
  -- end-user JWT stays on authenticated and is not allowed.
  allowed := current_user in ('service_role', 'postgres', 'supabase_admin');

  if not allowed then
    claims := nullif(current_setting('request.jwt.claims', true), '');
    if claims is not null and left(btrim(claims), 1) = '{' then
      jwt_role := claims::json ->> 'role';
    end if;
    if jwt_role = 'service_role' or auth.role() = 'service_role' then
      allowed := true;
    end if;
  end if;

  if tg_op = 'INSERT' then
    if allowed then
      return new;
    end if;
    -- Defaults are already applied. Null means the column was
    -- explicitly null. Fee, plan, subscription status, seat count,
    -- and the monthly counter accept null or the column default.
    -- Stripe ids accept null only. tier is free. role is brand or show.
    if new.tier is distinct from 'free'
       or new.role is null
       or new.role not in ('brand', 'show')
       or (
         new.platform_fee_percentage is not null
         and new.platform_fee_percentage is distinct from 0.10
       )
       or (new.plan is not null and new.plan is distinct from 'pay_as_you_go')
       or (
         new.subscription_status is not null
         and new.subscription_status is distinct from 'none'
       )
       or new.stripe_customer_id is not null
       or new.stripe_subscription_id is not null
       or new.stripe_connect_account_id is not null
       or (new.seat_count is not null and new.seat_count is distinct from 1)
       or (
         new.campaigns_this_month is not null
         and new.campaigns_this_month is distinct from 0
       )
    then
      raise exception 'profile insert rejected'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if not allowed and (
    new.platform_fee_percentage is distinct from old.platform_fee_percentage
    or new.plan is distinct from old.plan
    or new.subscription_status is distinct from old.subscription_status
    or new.stripe_customer_id is distinct from old.stripe_customer_id
    or new.stripe_subscription_id is distinct from old.stripe_subscription_id
    or new.stripe_connect_account_id is distinct from old.stripe_connect_account_id
    or new.role is distinct from old.role
    or new.tier is distinct from old.tier
    or new.seat_count is distinct from old.seat_count
    or new.campaigns_this_month is distinct from old.campaigns_this_month
  ) then
    raise exception 'locked profile column rejected'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.protect_profiles_money_columns() is
  'Rejects locked profiles column changes from any role other than service_role or a migration role.';

revoke all on function public.protect_profiles_money_columns() from public;
grant execute on function public.protect_profiles_money_columns() to authenticated;
grant execute on function public.protect_profiles_money_columns() to service_role;

drop trigger if exists profiles_protect_money_columns on public.profiles;
create trigger profiles_protect_money_columns
  before insert or update on public.profiles
  for each row
  execute function public.protect_profiles_money_columns();
