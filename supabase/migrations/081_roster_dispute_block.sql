-- ============================================================
-- 081: roster dispute block and owner-verified notices
--
-- Depends on live 075 (roster_link_disputes), 055
-- (agent_show_relationships status), 061 (show_ownership_proofs),
-- and 067 (roster review note). 080 is reserved for AC3.
-- This file does not edit 075.
--
-- An open dispute blocks a status change to approved. The block
-- is a BEFORE UPDATE OF status trigger, so reject and updates
-- that do not touch status are left alone. The app check is
-- still required. This trigger closes the race and any later
-- writer.
--
-- resolution_note is null or 1 to 500 characters. open means
-- resolved_at is null. resolved means resolved_at is set.
--
-- roster_owner_verified_notices records one rep heads-up per
-- roster link and verified proof. Unique (link_id, proof_id).
-- RLS is on. There is no policy. service_role has select,
-- insert, update, delete. anon, authenticated, and public have
-- nothing. Authenticated and service_role also have truncate,
-- references, and trigger revoked.
--
-- The trigger function is security definer with search_path
-- public, so it can see disputes whoever writes the link.
-- Execute is revoked from public, anon, and authenticated.
-- service_role keeps execute because the app writes as that
-- role.
--
-- Idempotent. Safe to re-run. No backfill.
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge
-- and Chris's OK naming 081. Do not run this from the app, a
-- seed script, or a deploy hook.
--
-- Introspection (run after applying):
--   select column_name
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'roster_link_disputes'
--      and column_name = 'resolution_note';
--   Expected: one row
--   select conname
--     from pg_constraint
--    where conrelid = 'public.roster_link_disputes'::regclass
--      and conname in (
--        'roster_link_disputes_resolution_note_check',
--        'roster_link_disputes_resolved_state_check'
--      );
--   Expected: both names
--   select tgname
--     from pg_trigger
--    where tgname = 'roster_link_block_approve_on_dispute'
--      and not tgisinternal;
--   Expected: one row
--   select has_function_privilege('anon', 'public.roster_link_block_approve_on_dispute()', 'execute')
--        , has_function_privilege('authenticated', 'public.roster_link_block_approve_on_dispute()', 'execute')
--        , has_function_privilege('service_role', 'public.roster_link_block_approve_on_dispute()', 'execute');
--   Expected: false, false, true
--   select c.relrowsecurity
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname = 'roster_owner_verified_notices';
--   Expected: true
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'roster_owner_verified_notices'
--    order by grantee, privilege_type;
--   Expected grantee: service_role only
--   (select, insert, update, delete).
--   select conname
--     from pg_constraint
--    where conrelid = 'public.roster_owner_verified_notices'::regclass
--      and contype = 'u';
--   Expected: roster_owner_verified_notices_link_proof_key
-- ============================================================

alter table public.roster_link_disputes
  add column if not exists resolution_note text;

alter table public.roster_link_disputes
  drop constraint if exists roster_link_disputes_resolution_note_check;
alter table public.roster_link_disputes
  add constraint roster_link_disputes_resolution_note_check
  check (
    resolution_note is null
    or (char_length(resolution_note) >= 1 and char_length(resolution_note) <= 500)
  );

alter table public.roster_link_disputes
  drop constraint if exists roster_link_disputes_resolved_state_check;
alter table public.roster_link_disputes
  add constraint roster_link_disputes_resolved_state_check
  check (
    (status = 'open' and resolved_at is null)
    or (status = 'resolved' and resolved_at is not null)
  );

create or replace function public.roster_link_block_approve_on_dispute()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    if exists (
      select 1
        from public.roster_link_disputes
       where link_id = new.id
         and status = 'open'
    ) then
      raise exception 'roster link has an open dispute'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.roster_link_block_approve_on_dispute() is
  'Blocks approving a roster link while an owner dispute is open.';

revoke all on function public.roster_link_block_approve_on_dispute() from public;
revoke all on function public.roster_link_block_approve_on_dispute() from anon;
revoke all on function public.roster_link_block_approve_on_dispute() from authenticated;
grant execute on function public.roster_link_block_approve_on_dispute() to service_role;

drop trigger if exists roster_link_block_approve_on_dispute on public.agent_show_relationships;
create trigger roster_link_block_approve_on_dispute
  before update of status on public.agent_show_relationships
  for each row
  when (new.status = 'approved' and old.status is distinct from 'approved')
  execute function public.roster_link_block_approve_on_dispute();

create table if not exists public.roster_owner_verified_notices (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null,
  proof_id uuid not null,
  rep_user_id uuid not null,
  trigger text not null,
  result text not null default 'claimed',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.roster_owner_verified_notices
  add column if not exists link_id uuid;
alter table public.roster_owner_verified_notices
  add column if not exists proof_id uuid;
alter table public.roster_owner_verified_notices
  add column if not exists rep_user_id uuid;
alter table public.roster_owner_verified_notices
  add column if not exists trigger text;
alter table public.roster_owner_verified_notices
  add column if not exists result text default 'claimed';
alter table public.roster_owner_verified_notices
  add column if not exists created_at timestamptz default now();
alter table public.roster_owner_verified_notices
  add column if not exists sent_at timestamptz;

alter table public.roster_owner_verified_notices
  alter column link_id set not null;
alter table public.roster_owner_verified_notices
  alter column proof_id set not null;
alter table public.roster_owner_verified_notices
  alter column rep_user_id set not null;
alter table public.roster_owner_verified_notices
  alter column trigger set not null;
alter table public.roster_owner_verified_notices
  alter column result set not null;
alter table public.roster_owner_verified_notices
  alter column result set default 'claimed';
alter table public.roster_owner_verified_notices
  alter column created_at set not null;
alter table public.roster_owner_verified_notices
  alter column created_at set default now();

alter table public.roster_owner_verified_notices
  drop constraint if exists roster_owner_verified_notices_link_id_fkey;
alter table public.roster_owner_verified_notices
  add constraint roster_owner_verified_notices_link_id_fkey
  foreign key (link_id) references public.agent_show_relationships (id) on delete cascade;

alter table public.roster_owner_verified_notices
  drop constraint if exists roster_owner_verified_notices_proof_id_fkey;
alter table public.roster_owner_verified_notices
  add constraint roster_owner_verified_notices_proof_id_fkey
  foreign key (proof_id) references public.show_ownership_proofs (id) on delete cascade;

alter table public.roster_owner_verified_notices
  drop constraint if exists roster_owner_verified_notices_trigger_check;
alter table public.roster_owner_verified_notices
  add constraint roster_owner_verified_notices_trigger_check
  check (trigger in ('import', 'verified_later'));

alter table public.roster_owner_verified_notices
  drop constraint if exists roster_owner_verified_notices_result_check;
alter table public.roster_owner_verified_notices
  add constraint roster_owner_verified_notices_result_check
  check (result in ('claimed', 'sent', 'no_api_key', 'managed_inbox_unset'));

alter table public.roster_owner_verified_notices
  drop constraint if exists roster_owner_verified_notices_link_proof_key;
alter table public.roster_owner_verified_notices
  add constraint roster_owner_verified_notices_link_proof_key
  unique (link_id, proof_id);

comment on table public.roster_owner_verified_notices is
  'One rep heads-up per roster link and verified ownership proof. service_role only.';

revoke all on table public.roster_owner_verified_notices from public;
revoke all on table public.roster_owner_verified_notices from anon;
revoke all on table public.roster_owner_verified_notices from authenticated;
revoke all on table public.roster_owner_verified_notices from service_role;
grant select, insert, update, delete on public.roster_owner_verified_notices to service_role;
revoke truncate, references, trigger on table public.roster_owner_verified_notices from authenticated;
revoke truncate, references, trigger on table public.roster_owner_verified_notices from service_role;

alter table public.roster_owner_verified_notices enable row level security;
