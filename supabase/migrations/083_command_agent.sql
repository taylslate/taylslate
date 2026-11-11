-- ============================================================
-- 083: command agent conversations and a session actor
--
-- NOT applied. Apply only after merge and Chris's OK.
-- Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK.
-- Paste into the Supabase SQL Editor, then introspect. Do not run
-- this from the app, a seed script, or a deploy hook.
--
-- 080 is reserved for AC3. 081 is Q12. 082 is A4 and is live.
-- This file is 083. Do not use 080, 081, or 082.
--
-- api_write_actions.api_key_id becomes nullable. source is
-- api_key or command_agent. An API key row keeps a key and a
-- null requested_by. A command agent row has a null key and
-- requested_by equal to brand_id. Existing rows pick up source
-- api_key from the column default. No other backfill.
--
-- command_agent_conversations, command_agent_messages, and
-- command_agent_usage are service_role only. RLS is on. There
-- is no policy. turn_started_at is the in-row marker for one
-- turn at a time for the whole brand.
--
-- command_agent_usage is append-only token accounting. It has
-- no foreign key to a conversation, so deleting a conversation
-- does not reset the daily cap.
--
-- Idempotent. Safe to re-run.
--
-- Introspection (run after applying):
--   select column_name, is_nullable
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'api_write_actions'
--      and column_name in ('api_key_id', 'source', 'requested_by')
--    order by column_name;
--   Expected: api_key_id YES, requested_by YES, source NO.
--   select conname
--     from pg_constraint
--    where conrelid = 'public.api_write_actions'::regclass
--      and conname in (
--        'api_write_actions_source_check',
--        'api_write_actions_actor_check',
--        'api_write_actions_requested_by_fkey'
--      )
--    order by conname;
--   Expected: those three constraints.
--   select c.relname, c.relrowsecurity
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname in (
--        'api_write_actions',
--        'command_agent_conversations',
--        'command_agent_messages',
--        'command_agent_usage'
--      )
--    order by c.relname;
--   Expected: relrowsecurity true for all four.
--   select tablename, count(*)
--     from pg_policies
--    where schemaname = 'public'
--      and tablename in (
--        'api_write_actions',
--        'command_agent_conversations',
--        'command_agent_messages',
--        'command_agent_usage'
--      )
--    group by tablename;
--   Expected: no rows.
--   select table_name, grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name in (
--        'api_write_actions',
--        'command_agent_conversations',
--        'command_agent_messages',
--        'command_agent_usage'
--      )
--    order by table_name, grantee, privilege_type;
--   Expected: service_role only. Nothing for anon, public,
--   or authenticated. The table owner may also be listed.
-- ============================================================

alter table public.api_write_actions alter column api_key_id drop not null;

alter table public.api_write_actions
  add column if not exists source text not null default 'api_key';

alter table public.api_write_actions alter column source set default 'api_key';
alter table public.api_write_actions alter column source set not null;

alter table public.api_write_actions
  add column if not exists requested_by uuid;

alter table public.api_write_actions
  drop constraint if exists api_write_actions_requested_by_fkey;

alter table public.api_write_actions
  add constraint api_write_actions_requested_by_fkey
  foreign key (requested_by) references public.profiles(id) on delete cascade;

alter table public.api_write_actions
  drop constraint if exists api_write_actions_source_check;

alter table public.api_write_actions
  add constraint api_write_actions_source_check
  check (source in ('api_key', 'command_agent'));

alter table public.api_write_actions
  drop constraint if exists api_write_actions_actor_check;

alter table public.api_write_actions
  add constraint api_write_actions_actor_check
  check (
    (
      source = 'api_key'
      and api_key_id is not null
      and requested_by is null
    )
    or (
      source = 'command_agent'
      and api_key_id is null
      and requested_by is not null
      and requested_by = brand_id
    )
  );

comment on column public.api_write_actions.source is
  'api_key or command_agent. Existing rows default to api_key.';

comment on column public.api_write_actions.requested_by is
  'profiles.id of the signed-in brand when source is command_agent. Null for an API key.';

comment on column public.api_write_actions.api_key_id is
  'api_keys.id that recorded the action. Null when source is command_agent.';

-- -------------------- conversations --------------------

create table if not exists public.command_agent_conversations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  turn_started_at timestamptz
);

alter table public.command_agent_conversations add column if not exists brand_id uuid;
alter table public.command_agent_conversations add column if not exists title text;
alter table public.command_agent_conversations add column if not exists created_at timestamptz default now();
alter table public.command_agent_conversations add column if not exists updated_at timestamptz default now();
alter table public.command_agent_conversations add column if not exists turn_started_at timestamptz;

alter table public.command_agent_conversations alter column brand_id set not null;
alter table public.command_agent_conversations alter column created_at set not null;
alter table public.command_agent_conversations alter column created_at set default now();
alter table public.command_agent_conversations alter column updated_at set not null;
alter table public.command_agent_conversations alter column updated_at set default now();

alter table public.command_agent_conversations
  drop constraint if exists command_agent_conversations_brand_id_fkey;

alter table public.command_agent_conversations
  add constraint command_agent_conversations_brand_id_fkey
  foreign key (brand_id) references public.profiles(id) on delete cascade;

alter table public.command_agent_conversations
  drop constraint if exists command_agent_conversations_title_len_check;

alter table public.command_agent_conversations
  add constraint command_agent_conversations_title_len_check
  check (title is null or char_length(title) <= 120);

create index if not exists command_agent_conversations_brand_updated_idx
  on public.command_agent_conversations (brand_id, updated_at desc);

comment on table public.command_agent_conversations is
  'One command agent thread for a brand. service_role only.';

comment on column public.command_agent_conversations.turn_started_at is
  'Set while a turn is running. A second turn is rejected until this is cleared or 120 seconds old.';

-- -------------------- messages --------------------

create table if not exists public.command_agent_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.command_agent_conversations(id) on delete cascade,
  brand_id uuid not null references public.profiles(id) on delete cascade,
  role text not null,
  content jsonb not null,
  action_ids uuid[] not null default '{}',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.command_agent_messages add column if not exists conversation_id uuid;
alter table public.command_agent_messages add column if not exists brand_id uuid;
alter table public.command_agent_messages add column if not exists role text;
alter table public.command_agent_messages add column if not exists content jsonb;
alter table public.command_agent_messages add column if not exists action_ids uuid[] default '{}';
alter table public.command_agent_messages add column if not exists input_tokens integer default 0;
alter table public.command_agent_messages add column if not exists output_tokens integer default 0;
alter table public.command_agent_messages add column if not exists created_at timestamptz default now();

alter table public.command_agent_messages alter column conversation_id set not null;
alter table public.command_agent_messages alter column brand_id set not null;
alter table public.command_agent_messages alter column role set not null;
alter table public.command_agent_messages alter column content set not null;
alter table public.command_agent_messages alter column action_ids set not null;
alter table public.command_agent_messages alter column action_ids set default '{}';
alter table public.command_agent_messages alter column input_tokens set not null;
alter table public.command_agent_messages alter column input_tokens set default 0;
alter table public.command_agent_messages alter column output_tokens set not null;
alter table public.command_agent_messages alter column output_tokens set default 0;
alter table public.command_agent_messages alter column created_at set not null;
alter table public.command_agent_messages alter column created_at set default now();

alter table public.command_agent_messages
  drop constraint if exists command_agent_messages_conversation_id_fkey;

alter table public.command_agent_messages
  add constraint command_agent_messages_conversation_id_fkey
  foreign key (conversation_id) references public.command_agent_conversations(id) on delete cascade;

alter table public.command_agent_messages
  drop constraint if exists command_agent_messages_brand_id_fkey;

alter table public.command_agent_messages
  add constraint command_agent_messages_brand_id_fkey
  foreign key (brand_id) references public.profiles(id) on delete cascade;

alter table public.command_agent_messages
  drop constraint if exists command_agent_messages_role_check;

alter table public.command_agent_messages
  add constraint command_agent_messages_role_check
  check (role in ('user', 'assistant', 'tool'));

alter table public.command_agent_messages
  drop constraint if exists command_agent_messages_input_tokens_check;

alter table public.command_agent_messages
  add constraint command_agent_messages_input_tokens_check
  check (input_tokens >= 0);

alter table public.command_agent_messages
  drop constraint if exists command_agent_messages_output_tokens_check;

alter table public.command_agent_messages
  add constraint command_agent_messages_output_tokens_check
  check (output_tokens >= 0);

alter table public.command_agent_messages
  drop constraint if exists command_agent_messages_content_len_check;

alter table public.command_agent_messages
  add constraint command_agent_messages_content_len_check
  check (octet_length(content::text) <= 65536);

create index if not exists command_agent_messages_conversation_created_idx
  on public.command_agent_messages (conversation_id, created_at);

create index if not exists command_agent_messages_brand_created_idx
  on public.command_agent_messages (brand_id, created_at);

comment on table public.command_agent_messages is
  'Messages in a command agent thread. service_role only. Deleting a conversation cascades.';

-- -------------------- usage (append-only, no conversation fk) --------------------

create table if not exists public.command_agent_usage (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.profiles(id) on delete cascade,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.command_agent_usage add column if not exists brand_id uuid;
alter table public.command_agent_usage add column if not exists input_tokens integer default 0;
alter table public.command_agent_usage add column if not exists output_tokens integer default 0;
alter table public.command_agent_usage add column if not exists created_at timestamptz default now();

alter table public.command_agent_usage alter column brand_id set not null;
alter table public.command_agent_usage alter column input_tokens set not null;
alter table public.command_agent_usage alter column input_tokens set default 0;
alter table public.command_agent_usage alter column output_tokens set not null;
alter table public.command_agent_usage alter column output_tokens set default 0;
alter table public.command_agent_usage alter column created_at set not null;
alter table public.command_agent_usage alter column created_at set default now();

alter table public.command_agent_usage
  drop constraint if exists command_agent_usage_brand_id_fkey;

alter table public.command_agent_usage
  add constraint command_agent_usage_brand_id_fkey
  foreign key (brand_id) references public.profiles(id) on delete cascade;

alter table public.command_agent_usage
  drop constraint if exists command_agent_usage_input_tokens_check;

alter table public.command_agent_usage
  add constraint command_agent_usage_input_tokens_check
  check (input_tokens >= 0);

alter table public.command_agent_usage
  drop constraint if exists command_agent_usage_output_tokens_check;

alter table public.command_agent_usage
  add constraint command_agent_usage_output_tokens_check
  check (output_tokens >= 0);

create index if not exists command_agent_usage_brand_created_idx
  on public.command_agent_usage (brand_id, created_at);

comment on table public.command_agent_usage is
  'Append-only model token counts for a brand. No conversation foreign key. Deleting a conversation does not remove these rows. service_role only.';

-- -------------------- grants (before RLS) --------------------

revoke all on table public.api_write_actions from public;
revoke all on table public.api_write_actions from anon;
revoke all on table public.api_write_actions from authenticated;
grant all on table public.api_write_actions to service_role;
revoke truncate, references, trigger on table public.api_write_actions from authenticated;

revoke all on table public.command_agent_conversations from public;
revoke all on table public.command_agent_conversations from anon;
revoke all on table public.command_agent_conversations from authenticated;
grant all on table public.command_agent_conversations to service_role;
revoke truncate, references, trigger on table public.command_agent_conversations from authenticated;

revoke all on table public.command_agent_messages from public;
revoke all on table public.command_agent_messages from anon;
revoke all on table public.command_agent_messages from authenticated;
grant all on table public.command_agent_messages to service_role;
revoke truncate, references, trigger on table public.command_agent_messages from authenticated;

revoke all on table public.command_agent_usage from public;
revoke all on table public.command_agent_usage from anon;
revoke all on table public.command_agent_usage from authenticated;
grant all on table public.command_agent_usage to service_role;
revoke truncate, references, trigger on table public.command_agent_usage from authenticated;

-- -------------------- RLS --------------------
-- No policies. service_role bypasses RLS. anon and authenticated
-- have no grant and no policy.

alter table public.api_write_actions enable row level security;
alter table public.command_agent_conversations enable row level security;
alter table public.command_agent_messages enable row level security;
alter table public.command_agent_usage enable row level security;
