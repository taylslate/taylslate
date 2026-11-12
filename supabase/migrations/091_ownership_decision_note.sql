-- ============================================================
-- 091: decision_note on show_ownership_proofs
--
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and
-- Chris's OK. Paste into the Supabase SQL Editor. Do not run this
-- from the app, a seed script, or a deploy hook.
--
-- What: one nullable text column, decision_note, and a length check.
-- Why: O2 stores why a row reached review in note (needs_admin_review,
-- or the owner's manual explanation). The admin's reason is a second
-- fact. Writing it into note would erase the first. The owner reads
-- decision_note through the existing authenticated SELECT and the
-- RLS policy "Owners read own ownership proofs". That is intended.
--
-- No new table, policy, or function. 091 does not depend on 090.
-- They touch different objects. Idempotent. Safe to re-run.
--
-- Apply order: before or after the O4 deploy. The review routes
-- treat a missing decision_note column as 503
-- "Ownership review needs migration 091."
--
-- Grants are restated from 061. service_role keeps select, insert,
-- update, and delete. authenticated keeps select only. anon and
-- public keep nothing. authenticated loses insert, update, delete,
-- truncate, references, and trigger. service_role loses truncate,
-- references, and trigger.
--
-- Live verify (SELECT only, after Chris applies this file):
--   select column_name
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'show_ownership_proofs'
--      and column_name = 'decision_note';
--   Expected: 1 row.
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'show_ownership_proofs'
--    order by grantee, privilege_type;
--   Expected: authenticated SELECT, and service_role SELECT,
--   INSERT, UPDATE, and DELETE. No anon. No public.
-- ============================================================

alter table public.show_ownership_proofs
  add column if not exists decision_note text;

alter table public.show_ownership_proofs
  drop constraint if exists show_ownership_proofs_decision_note_check;
alter table public.show_ownership_proofs
  add constraint show_ownership_proofs_decision_note_check
  check (decision_note is null or char_length(decision_note) between 1 and 500);

comment on column public.show_ownership_proofs.decision_note is
  'Why an admin verified or rejected this proof. note stays the reason the row reached review.';

-- -------------------- grants (restated from 061) --------------------

revoke all on table public.show_ownership_proofs from public;
revoke all on table public.show_ownership_proofs from anon;
revoke all on table public.show_ownership_proofs from authenticated;
revoke all on table public.show_ownership_proofs from service_role;

grant select, insert, update, delete on table public.show_ownership_proofs to service_role;
grant select on table public.show_ownership_proofs to authenticated;

revoke insert, update, delete, truncate, references, trigger
  on table public.show_ownership_proofs from authenticated;
revoke truncate, references, trigger
  on table public.show_ownership_proofs from service_role;
revoke all on table public.show_ownership_proofs from anon;
revoke all on table public.show_ownership_proofs from public;
