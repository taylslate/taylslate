-- ============================================================
-- 067: roster link review note
--
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK.
-- Apply only after 066. Paste into the Supabase SQL
-- Editor, then introspect. Do not run this from the app, a seed
-- script, or a deploy hook.
--
-- Rejecting a pending roster link stores a required note. 055 has
-- status, source, approved_by, and approved_at, and no place for
-- that note. This adds:
--
--   review_note  text null          1 to 500 characters when set
--   rejected_by  uuid null          -> public.profiles(id)
--   rejected_at  timestamptz null
--
-- A pending or approved row leaves all three null. This file does
-- not UPDATE or DELETE rows, and it does not write public.shows.
--
-- Grants. No change beyond re-asserting service_role select,
-- insert, update, and delete. Authenticated stays as 065 left it
-- (SELECT only, from 055). Anon and public are not granted
-- anything. RLS stays enabled. No new policy.
--
-- Idempotent. Safe to re-run.
--
-- Introspection (run after applying):
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'agent_show_relationships'
--      and column_name in ('review_note', 'rejected_by', 'rejected_at')
--    order by column_name;
--   Expected:
--     rejected_at  timestamp with time zone  YES
--     rejected_by  uuid                      YES
--     review_note  text                      YES
--
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'agent_show_relationships'
--      and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
--    order by grantee, privilege_type;
--   Expected: anon none, PUBLIC none, authenticated SELECT only,
--   service_role SELECT, INSERT, UPDATE, DELETE.
-- ============================================================

alter table public.agent_show_relationships
  add column if not exists review_note text;

alter table public.agent_show_relationships
  add column if not exists rejected_by uuid;

alter table public.agent_show_relationships
  add column if not exists rejected_at timestamptz;

alter table public.agent_show_relationships
  drop constraint if exists agent_show_relationships_rejected_by_fkey;
alter table public.agent_show_relationships
  add constraint agent_show_relationships_rejected_by_fkey
  foreign key (rejected_by) references public.profiles (id) on delete set null;

alter table public.agent_show_relationships
  drop constraint if exists agent_show_relationships_review_note_check;
alter table public.agent_show_relationships
  add constraint agent_show_relationships_review_note_check
  check (review_note is null or char_length(review_note) between 1 and 500);

grant select, insert, update, delete on table public.agent_show_relationships to service_role;

alter table public.agent_show_relationships enable row level security;

comment on column public.agent_show_relationships.review_note is
  'Required note when an admin rejects a pending roster link. Null until a reject. One to 500 characters when set.';
comment on column public.agent_show_relationships.rejected_by is
  'Profile that rejected the link. Null until an admin rejects it.';
comment on column public.agent_show_relationships.rejected_at is
  'When an admin rejected the link. Null until then.';
