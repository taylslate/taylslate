# CA1: brand command agent

Migration number is **083**. 080 is reserved for AC3. 081 is Q12. 082 is A4 and is live. 083 is not applied. Apply it on `ldtmhafewfifdizgfrnn` only after merge and Chris's OK.

The user-facing name is **Tay**. Chris named it. Internal identifiers stay `command_agent`, `lib/command-agent`, and `/assistant`.

## What shipped

A signed-in brand can open `/assistant` and ask Tay in plain language. Tay answers by calling the M1 tool registry in process (`callTool`). Reads return through the existing tools. `propose_campaign` and `propose_outreach` insert one pending `api_write_actions` row. The brand approves or rejects that row at `/settings/agent-actions`. Tay never approves, executes, sends, charges, or calls discovery, scoring, or plan endpoints.

Approving an agent `campaign.create` still creates one draft through the unchanged A4 path. Approving an agent `outreach.draft` still says "Approved. Nothing was sent."

`/assistant` has no nav item and no link from an existing screen. The inbox screen was not edited. A command agent row is labeled Tay because `toListed` sets `key.name` to Tay. An API key row is unchanged.

## Access

083 drops `NOT NULL` on `api_write_actions.api_key_id`, adds `source` (`api_key` or `command_agent`, default `api_key`), and adds `requested_by`. The actor check requires an API key row to have a key and a null `requested_by`, and a command agent row to have a null key with `requested_by` equal to `brand_id`. Existing rows take `source` `api_key` from the column default. There is no other backfill. The `api_key_id` foreign key stays.

`command_agent_conversations` and `command_agent_messages` are new. `turn_started_at` is the in-row marker so one conversation runs one turn at a time. A claim older than 120 seconds can be taken again. RLS is on. There are no policies. `anon`, `public`, and `authenticated` have no privileges, including `truncate`, `references`, and `trigger` on `authenticated`. `service_role` has all privileges. Every read and write filters `brand_id` to the session user id.

## Routes

All assistant routes are node, `force-dynamic`, and `Cache-Control: no-store`. `requireBrand` reads `profiles.role` by the auth user id. No session is 401. Any other role, including show, agent, admin, and an admin view-switch, is 403. The page redirects to `/login?next=/assistant` and calls `notFound` for a non-brand.

`POST` requires the Origin host to match the request host. The JSON body cap is 16 KB. Unknown keys are 422. A message is trimmed, printable, and 1 to 4000 characters.

Message posts are limited to 20 per user per hour and 60 per user per day (`command_agent_user_hour`, `command_agent_user_day`), fail closed. The daily token cap sums `input_tokens + output_tokens` for the brand since 00:00 UTC. At or over 300000 the route returns 429 with "Daily assistant limit reached. Try again tomorrow." and logs `command_agent.cap_hit`. A cap read error is 503. A second post while a turn is claimed is 409. Another brand's conversation id is 404. `DELETE` removes the conversation and its messages and does not touch `api_write_actions`.

## Agent loop

The tool context is built on the server: `{ brandId: user.id, keyId: null, source: "command_agent", scopes: ["read", "write:campaigns", "write:outreach"] }`. The model sees exactly the M1 tools. Any other tool name returns an error tool result and is not passed to `callTool`. Propose calls get a server idempotency key `ca:{user message id}:{n}`, so a retried turn with the same message id replays instead of inserting again. Tool results go back as `tool_result` blocks, wrapped as data and truncated to 16000 characters with a `truncated` marker. Stored tool text is capped at 4000 characters.

Caps per turn: 6 model calls, 8 tool calls, `max_tokens` 1500, `timeoutMs` 25000, `maxRetries` 1, and a 90 second deadline. The messages route sets `maxDuration` 120. History is the last 20 messages of this conversation. The model is `getLLMModel()` with the existing refusal fallback. `lib/llm/client.ts` was not edited.

`command_agent.turn` records the conversation id, tool names, token totals, and action ids. Message text, arguments, and results are not logged.

## Decisions for Chris

These are defaults pending confirmation, except the name, which Chris set.

- (a) Where the chat lives. Default: `/assistant`, by URL only. No nav item and no link from an existing screen. The route is not `/agent` because agent is already a role. A follow-up can add a nav item once Chris names the placement.
- (b) Which plans get it. Default: every brand plan. No new plan gate. The active-campaign cap in `plans.ts` is still not enforced. Enforcing it on approval is a separate job and pairs with A7.
- (c) Usage caps. Default: 20 messages per hour, 60 per day, 300000 tokens per day, 6 model calls and 8 tool calls per turn. The model stays `LLM_MODEL`, default `claude-opus-4-8`.
- (d) Retention. Default: stored per brand, `service_role` only, until the brand deletes the conversation. No automatic purge in this job.
- (e) Model. Default: `getLLMModel()` and the existing Anthropic SDK. No env change and no new provider.
- (f) Agency role. Default: brand role only, same as A4. Agency accounts are a later job.

Name: Tay. Confirmed. Shown on the `/assistant` heading and empty state, in the system prompt, and as the approvals label. The empty state is "Ask Tay for a campaign plan, a show lookup, or an outreach draft. Anything that changes your account waits for your approval."

## Known gaps

- 083 is not applied. Tay cannot insert a pending row until Chris applies it.
- `/assistant` is not in the nav. Adding it changes an existing screen, so it waits for a follow-up.
- There is no 90-day purge.
- An API caller who deliberately reuses a `ca:{message id}:{n}` idempotency key can collide with Tay on the shared unique key. The API path was not changed.
- A crashed turn keeps `turn_started_at` set until 120 seconds pass.
- Plan caps are still not enforced on approval.
