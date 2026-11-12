-- ============================================================
-- 092: OAuth 2.1 for the remote MCP server
--
-- NOT applied. Apply only after merge and Chris's OK.
-- Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK.
-- Paste into the Supabase SQL Editor. Do not run this from
-- the app, a seed script, or a deploy hook.
--
-- Public MCP clients (PKCE, no client secret) register, get a
-- consent from the signed-in brand, and exchange a code for an
-- access token and a refresh token. Only the SHA-256 hex of a
-- code or token is stored. The plaintext is returned once.
--
-- Every grant is backed by one api_keys row so the existing
-- per-key rate limit and the settings revoke button apply.
-- Revoking that key cuts the client off. These four tables do
-- not change api_keys, api_rate_windows, or api_write_actions.
--
-- service_role only. No policy. No function. No view.
-- Idempotent. Safe to re-run.
--
-- Introspection (run after applying, read only):
--   select c.relname, c.relrowsecurity
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname in (
--        'mcp_oauth_clients',
--        'mcp_oauth_requests',
--        'mcp_oauth_codes',
--        'mcp_oauth_tokens'
--      )
--    order by c.relname;
--   Expected: four rows, relrowsecurity true.
--   select count(*) from pg_policies
--    where schemaname = 'public'
--      and tablename in (
--        'mcp_oauth_clients',
--        'mcp_oauth_requests',
--        'mcp_oauth_codes',
--        'mcp_oauth_tokens'
--      );
--   Expected: 0.
--   select grantee, table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name in (
--        'mcp_oauth_clients',
--        'mcp_oauth_requests',
--        'mcp_oauth_codes',
--        'mcp_oauth_tokens'
--      )
--    order by table_name, grantee, privilege_type;
--   Expected grantee: service_role only.
-- ============================================================

-- -------------------- mcp_oauth_clients --------------------

create table if not exists public.mcp_oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  client_name text not null,
  redirect_uris text[] not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.mcp_oauth_clients add column if not exists id uuid default gen_random_uuid();
alter table public.mcp_oauth_clients add column if not exists client_id text;
alter table public.mcp_oauth_clients add column if not exists client_name text;
alter table public.mcp_oauth_clients add column if not exists redirect_uris text[];
alter table public.mcp_oauth_clients add column if not exists created_at timestamptz default now();
alter table public.mcp_oauth_clients add column if not exists last_used_at timestamptz;

alter table public.mcp_oauth_clients alter column client_id set not null;
alter table public.mcp_oauth_clients alter column client_name set not null;
alter table public.mcp_oauth_clients alter column redirect_uris set not null;
alter table public.mcp_oauth_clients alter column created_at set not null;
alter table public.mcp_oauth_clients alter column created_at set default now();

alter table public.mcp_oauth_clients drop constraint if exists mcp_oauth_clients_client_id_key;
alter table public.mcp_oauth_clients
  add constraint mcp_oauth_clients_client_id_key unique (client_id);

alter table public.mcp_oauth_clients drop constraint if exists mcp_oauth_clients_client_id_check;
alter table public.mcp_oauth_clients
  add constraint mcp_oauth_clients_client_id_check
  check (client_id ~ '^tsc_[0-9a-f]{32}$');

alter table public.mcp_oauth_clients drop constraint if exists mcp_oauth_clients_client_name_check;
alter table public.mcp_oauth_clients
  add constraint mcp_oauth_clients_client_name_check
  check (char_length(client_name) between 1 and 100);

alter table public.mcp_oauth_clients drop constraint if exists mcp_oauth_clients_redirect_uris_check;
alter table public.mcp_oauth_clients
  add constraint mcp_oauth_clients_redirect_uris_check
  check (cardinality(redirect_uris) between 1 and 5);

comment on table public.mcp_oauth_clients is
  'Public OAuth clients for remote MCP. No client secret. service_role only.';
comment on column public.mcp_oauth_clients.client_id is
  'Public client id, tsc_ plus 32 hex chars. Not a secret.';
comment on column public.mcp_oauth_clients.redirect_uris is
  'Exact redirect URIs registered for this client. One to five.';

-- -------------------- mcp_oauth_requests --------------------

create table if not exists public.mcp_oauth_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  redirect_uri text not null,
  scopes text[] not null,
  state text,
  code_challenge text not null,
  resource text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

alter table public.mcp_oauth_requests add column if not exists id uuid default gen_random_uuid();
alter table public.mcp_oauth_requests add column if not exists client_id uuid;
alter table public.mcp_oauth_requests add column if not exists redirect_uri text;
alter table public.mcp_oauth_requests add column if not exists scopes text[];
alter table public.mcp_oauth_requests add column if not exists state text;
alter table public.mcp_oauth_requests add column if not exists code_challenge text;
alter table public.mcp_oauth_requests add column if not exists resource text;
alter table public.mcp_oauth_requests add column if not exists created_at timestamptz default now();
alter table public.mcp_oauth_requests add column if not exists expires_at timestamptz;
alter table public.mcp_oauth_requests add column if not exists consumed_at timestamptz;

alter table public.mcp_oauth_requests alter column client_id set not null;
alter table public.mcp_oauth_requests alter column redirect_uri set not null;
alter table public.mcp_oauth_requests alter column scopes set not null;
alter table public.mcp_oauth_requests alter column code_challenge set not null;
alter table public.mcp_oauth_requests alter column resource set not null;
alter table public.mcp_oauth_requests alter column created_at set not null;
alter table public.mcp_oauth_requests alter column created_at set default now();
alter table public.mcp_oauth_requests alter column expires_at set not null;

alter table public.mcp_oauth_requests drop constraint if exists mcp_oauth_requests_client_id_fkey;
alter table public.mcp_oauth_requests
  add constraint mcp_oauth_requests_client_id_fkey
  foreign key (client_id) references public.mcp_oauth_clients (id) on delete cascade;

alter table public.mcp_oauth_requests drop constraint if exists mcp_oauth_requests_scopes_check;
alter table public.mcp_oauth_requests
  add constraint mcp_oauth_requests_scopes_check
  check (
    scopes <@ array['read', 'write:campaigns', 'write:outreach']::text[]
  );

alter table public.mcp_oauth_requests drop constraint if exists mcp_oauth_requests_state_check;
alter table public.mcp_oauth_requests
  add constraint mcp_oauth_requests_state_check
  check (state is null or char_length(state) <= 500);

alter table public.mcp_oauth_requests drop constraint if exists mcp_oauth_requests_code_challenge_check;
alter table public.mcp_oauth_requests
  add constraint mcp_oauth_requests_code_challenge_check
  check (code_challenge ~ '^[A-Za-z0-9_-]{43}$');

comment on table public.mcp_oauth_requests is
  'Authorization requests waiting for consent. Ten minute expiry. service_role only.';
comment on column public.mcp_oauth_requests.code_challenge is
  'S256 PKCE challenge. The verifier is not stored.';
comment on column public.mcp_oauth_requests.consumed_at is
  'Set when the brand allows or denies. A consumed request cannot be reused.';

-- -------------------- mcp_oauth_codes --------------------

create table if not exists public.mcp_oauth_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null,
  request_id uuid not null,
  client_id uuid not null,
  user_id uuid not null,
  redirect_uri text not null,
  code_challenge text not null,
  scopes text[] not null,
  resource text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.mcp_oauth_codes add column if not exists id uuid default gen_random_uuid();
alter table public.mcp_oauth_codes add column if not exists code_hash text;
alter table public.mcp_oauth_codes add column if not exists request_id uuid;
alter table public.mcp_oauth_codes add column if not exists client_id uuid;
alter table public.mcp_oauth_codes add column if not exists user_id uuid;
alter table public.mcp_oauth_codes add column if not exists redirect_uri text;
alter table public.mcp_oauth_codes add column if not exists code_challenge text;
alter table public.mcp_oauth_codes add column if not exists scopes text[];
alter table public.mcp_oauth_codes add column if not exists resource text;
alter table public.mcp_oauth_codes add column if not exists expires_at timestamptz;
alter table public.mcp_oauth_codes add column if not exists used_at timestamptz;
alter table public.mcp_oauth_codes add column if not exists created_at timestamptz default now();

alter table public.mcp_oauth_codes alter column code_hash set not null;
alter table public.mcp_oauth_codes alter column request_id set not null;
alter table public.mcp_oauth_codes alter column client_id set not null;
alter table public.mcp_oauth_codes alter column user_id set not null;
alter table public.mcp_oauth_codes alter column redirect_uri set not null;
alter table public.mcp_oauth_codes alter column code_challenge set not null;
alter table public.mcp_oauth_codes alter column scopes set not null;
alter table public.mcp_oauth_codes alter column resource set not null;
alter table public.mcp_oauth_codes alter column expires_at set not null;
alter table public.mcp_oauth_codes alter column created_at set not null;
alter table public.mcp_oauth_codes alter column created_at set default now();

alter table public.mcp_oauth_codes drop constraint if exists mcp_oauth_codes_code_hash_key;
alter table public.mcp_oauth_codes
  add constraint mcp_oauth_codes_code_hash_key unique (code_hash);

alter table public.mcp_oauth_codes drop constraint if exists mcp_oauth_codes_request_id_fkey;
alter table public.mcp_oauth_codes
  add constraint mcp_oauth_codes_request_id_fkey
  foreign key (request_id) references public.mcp_oauth_requests (id) on delete cascade;

alter table public.mcp_oauth_codes drop constraint if exists mcp_oauth_codes_client_id_fkey;
alter table public.mcp_oauth_codes
  add constraint mcp_oauth_codes_client_id_fkey
  foreign key (client_id) references public.mcp_oauth_clients (id) on delete cascade;

alter table public.mcp_oauth_codes drop constraint if exists mcp_oauth_codes_user_id_fkey;
alter table public.mcp_oauth_codes
  add constraint mcp_oauth_codes_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

alter table public.mcp_oauth_codes drop constraint if exists mcp_oauth_codes_code_hash_check;
alter table public.mcp_oauth_codes
  add constraint mcp_oauth_codes_code_hash_check
  check (code_hash ~ '^[0-9a-f]{64}$');

alter table public.mcp_oauth_codes drop constraint if exists mcp_oauth_codes_code_challenge_check;
alter table public.mcp_oauth_codes
  add constraint mcp_oauth_codes_code_challenge_check
  check (code_challenge ~ '^[A-Za-z0-9_-]{43}$');

alter table public.mcp_oauth_codes drop constraint if exists mcp_oauth_codes_scopes_check;
alter table public.mcp_oauth_codes
  add constraint mcp_oauth_codes_scopes_check
  check (
    scopes <@ array['read', 'write:campaigns', 'write:outreach']::text[]
  );

comment on table public.mcp_oauth_codes is
  'Authorization codes. code_hash is SHA-256 hex. The plaintext code is not stored. Five minute expiry. service_role only.';
comment on column public.mcp_oauth_codes.code_hash is
  'SHA-256 hex of the authorization code. Never the plaintext code.';
comment on column public.mcp_oauth_codes.used_at is
  'Set on the first token exchange. A second use revokes tokens issued from this code.';

-- -------------------- mcp_oauth_tokens --------------------

create table if not exists public.mcp_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  kind text not null,
  family_id uuid not null,
  code_id uuid not null,
  client_id uuid not null,
  user_id uuid not null,
  api_key_id uuid not null,
  scopes text[] not null,
  resource text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.mcp_oauth_tokens add column if not exists id uuid default gen_random_uuid();
alter table public.mcp_oauth_tokens add column if not exists token_hash text;
alter table public.mcp_oauth_tokens add column if not exists kind text;
alter table public.mcp_oauth_tokens add column if not exists family_id uuid;
alter table public.mcp_oauth_tokens add column if not exists code_id uuid;
alter table public.mcp_oauth_tokens add column if not exists client_id uuid;
alter table public.mcp_oauth_tokens add column if not exists user_id uuid;
alter table public.mcp_oauth_tokens add column if not exists api_key_id uuid;
alter table public.mcp_oauth_tokens add column if not exists scopes text[];
alter table public.mcp_oauth_tokens add column if not exists resource text;
alter table public.mcp_oauth_tokens add column if not exists expires_at timestamptz;
alter table public.mcp_oauth_tokens add column if not exists used_at timestamptz;
alter table public.mcp_oauth_tokens add column if not exists revoked_at timestamptz;
alter table public.mcp_oauth_tokens add column if not exists created_at timestamptz default now();

alter table public.mcp_oauth_tokens alter column token_hash set not null;
alter table public.mcp_oauth_tokens alter column kind set not null;
alter table public.mcp_oauth_tokens alter column family_id set not null;
alter table public.mcp_oauth_tokens alter column code_id set not null;
alter table public.mcp_oauth_tokens alter column client_id set not null;
alter table public.mcp_oauth_tokens alter column user_id set not null;
alter table public.mcp_oauth_tokens alter column api_key_id set not null;
alter table public.mcp_oauth_tokens alter column scopes set not null;
alter table public.mcp_oauth_tokens alter column resource set not null;
alter table public.mcp_oauth_tokens alter column expires_at set not null;
alter table public.mcp_oauth_tokens alter column created_at set not null;
alter table public.mcp_oauth_tokens alter column created_at set default now();

alter table public.mcp_oauth_tokens drop constraint if exists mcp_oauth_tokens_token_hash_key;
alter table public.mcp_oauth_tokens
  add constraint mcp_oauth_tokens_token_hash_key unique (token_hash);

alter table public.mcp_oauth_tokens drop constraint if exists mcp_oauth_tokens_code_id_fkey;
alter table public.mcp_oauth_tokens
  add constraint mcp_oauth_tokens_code_id_fkey
  foreign key (code_id) references public.mcp_oauth_codes (id) on delete cascade;

alter table public.mcp_oauth_tokens drop constraint if exists mcp_oauth_tokens_client_id_fkey;
alter table public.mcp_oauth_tokens
  add constraint mcp_oauth_tokens_client_id_fkey
  foreign key (client_id) references public.mcp_oauth_clients (id) on delete cascade;

alter table public.mcp_oauth_tokens drop constraint if exists mcp_oauth_tokens_user_id_fkey;
alter table public.mcp_oauth_tokens
  add constraint mcp_oauth_tokens_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

alter table public.mcp_oauth_tokens drop constraint if exists mcp_oauth_tokens_api_key_id_fkey;
alter table public.mcp_oauth_tokens
  add constraint mcp_oauth_tokens_api_key_id_fkey
  foreign key (api_key_id) references public.api_keys (id) on delete cascade;

alter table public.mcp_oauth_tokens drop constraint if exists mcp_oauth_tokens_token_hash_check;
alter table public.mcp_oauth_tokens
  add constraint mcp_oauth_tokens_token_hash_check
  check (token_hash ~ '^[0-9a-f]{64}$');

alter table public.mcp_oauth_tokens drop constraint if exists mcp_oauth_tokens_kind_check;
alter table public.mcp_oauth_tokens
  add constraint mcp_oauth_tokens_kind_check
  check (kind in ('access', 'refresh'));

alter table public.mcp_oauth_tokens drop constraint if exists mcp_oauth_tokens_scopes_check;
alter table public.mcp_oauth_tokens
  add constraint mcp_oauth_tokens_scopes_check
  check (
    scopes <@ array['read', 'write:campaigns', 'write:outreach']::text[]
  );

create index if not exists idx_mcp_oauth_tokens_family_id
  on public.mcp_oauth_tokens (family_id);

create index if not exists idx_mcp_oauth_tokens_api_key_id
  on public.mcp_oauth_tokens (api_key_id);

create index if not exists idx_mcp_oauth_tokens_expires_at
  on public.mcp_oauth_tokens (expires_at);

create index if not exists idx_mcp_oauth_tokens_code_id
  on public.mcp_oauth_tokens (code_id);

comment on table public.mcp_oauth_tokens is
  'Access and refresh tokens. token_hash is SHA-256 hex. The plaintext token is not stored. service_role only.';
comment on column public.mcp_oauth_tokens.token_hash is
  'SHA-256 hex of the access or refresh token. Never the plaintext token.';
comment on column public.mcp_oauth_tokens.family_id is
  'Refresh rotation family. Reuse of an old refresh token revokes every row in the family.';
comment on column public.mcp_oauth_tokens.api_key_id is
  'Backing api_keys row. Revoking that key stops access and refresh.';
comment on column public.mcp_oauth_tokens.used_at is
  'Set when a refresh token is rotated. Access tokens stay unused until they expire.';

-- -------------------- grants (before RLS) --------------------

revoke all on table public.mcp_oauth_clients from public;
revoke all on table public.mcp_oauth_clients from anon;
revoke all on table public.mcp_oauth_clients from authenticated;
revoke all on table public.mcp_oauth_clients from service_role;
grant select, insert, update, delete on table public.mcp_oauth_clients to service_role;
revoke truncate, references, trigger on table public.mcp_oauth_clients from authenticated;
revoke truncate, references, trigger on table public.mcp_oauth_clients from anon;
revoke truncate, references, trigger on table public.mcp_oauth_clients from public;

revoke all on table public.mcp_oauth_requests from public;
revoke all on table public.mcp_oauth_requests from anon;
revoke all on table public.mcp_oauth_requests from authenticated;
revoke all on table public.mcp_oauth_requests from service_role;
grant select, insert, update, delete on table public.mcp_oauth_requests to service_role;
revoke truncate, references, trigger on table public.mcp_oauth_requests from authenticated;
revoke truncate, references, trigger on table public.mcp_oauth_requests from anon;
revoke truncate, references, trigger on table public.mcp_oauth_requests from public;

revoke all on table public.mcp_oauth_codes from public;
revoke all on table public.mcp_oauth_codes from anon;
revoke all on table public.mcp_oauth_codes from authenticated;
revoke all on table public.mcp_oauth_codes from service_role;
grant select, insert, update, delete on table public.mcp_oauth_codes to service_role;
revoke truncate, references, trigger on table public.mcp_oauth_codes from authenticated;
revoke truncate, references, trigger on table public.mcp_oauth_codes from anon;
revoke truncate, references, trigger on table public.mcp_oauth_codes from public;

revoke all on table public.mcp_oauth_tokens from public;
revoke all on table public.mcp_oauth_tokens from anon;
revoke all on table public.mcp_oauth_tokens from authenticated;
revoke all on table public.mcp_oauth_tokens from service_role;
grant select, insert, update, delete on table public.mcp_oauth_tokens to service_role;
revoke truncate, references, trigger on table public.mcp_oauth_tokens from authenticated;
revoke truncate, references, trigger on table public.mcp_oauth_tokens from anon;
revoke truncate, references, trigger on table public.mcp_oauth_tokens from public;

-- -------------------- RLS --------------------

alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_requests enable row level security;
alter table public.mcp_oauth_codes enable row level security;
alter table public.mcp_oauth_tokens enable row level security;

-- No policies. service_role bypasses RLS on Supabase. anon and
-- authenticated have no grant and no policy.
