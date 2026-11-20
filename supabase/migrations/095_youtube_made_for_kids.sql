-- ============================================================
-- 095: youtube_channels.made_for_kids
--
-- 092 is the latest file on main. 093 is not in the repo.
-- 094 is reserved for RELAY1. This file is the next free number.
--
-- Adds a nullable boolean. Existing rows stay null until the
-- library refresh stores YouTube status.madeForKids. True fails
-- the market filter. Null keeps the previous row and the read
-- path applies a narrow topic fallback.
--
-- Partial index on the true rows, for a count of designated
-- kids channels without scanning the catalog.
--
-- Privileges and policies stay as migration 074 left them.
-- service_role already holds select, insert, update, and delete.
-- A new column inherits those table privileges. anon,
-- authenticated, and public stay without access. RLS stays on.
-- No new policy.
--
-- Idempotent. Safe to re-run.
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge
-- and Chris's own-words OK. Do not run this from the app, a
-- seed script, or a deploy hook. Reads omit this column until
-- it exists, so the library crons keep running before apply.
--
-- Introspection (run after applying):
--   select data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'youtube_channels'
--      and column_name = 'made_for_kids';
--   Expected: boolean, YES
--   select indexdef
--     from pg_indexes
--    where schemaname = 'public'
--      and indexname = 'idx_youtube_channels_made_for_kids_true';
--   Expected: a partial index where made_for_kids is true
-- ============================================================

alter table public.youtube_channels
  add column if not exists made_for_kids boolean;

comment on column public.youtube_channels.made_for_kids is
  'YouTube channels.list status.madeForKids. Null until a refresh stores it. True fails the market filter.';

create index if not exists idx_youtube_channels_made_for_kids_true
  on public.youtube_channels (channel_id)
  where made_for_kids is true;
