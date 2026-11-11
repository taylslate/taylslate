-- ============================================================
-- 084: one command agent turn per brand
--
-- NOT applied. Apply only after merge and Chris's OK.
-- Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK.
-- 083 is already applied. Apply this file after 083.
-- Paste into the Supabase SQL Editor. Do not run this from
-- the app, a seed script, or a deploy hook.
--
-- Clears duplicate non-null turn_started_at values per brand,
-- keeping the latest, then adds a partial unique index so only
-- one conversation per brand can hold a turn.
--
-- No new table. No grant change. No RLS change.
-- Idempotent. Safe to re-run.
--
-- Introspection (run after applying):
--   select indexdef
--     from pg_indexes
--    where schemaname = 'public'
--      and indexname = 'command_agent_conversations_one_turn_per_brand';
--   Expected: a unique index on (brand_id)
--   where turn_started_at is not null.
-- ============================================================

with ranked as (
  select
    id,
    row_number() over (
      partition by brand_id
      order by turn_started_at desc, id desc
    ) as rn
  from public.command_agent_conversations
  where turn_started_at is not null
)
update public.command_agent_conversations as conversation
set turn_started_at = null
from ranked
where conversation.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists command_agent_conversations_one_turn_per_brand
  on public.command_agent_conversations (brand_id)
  where turn_started_at is not null;
