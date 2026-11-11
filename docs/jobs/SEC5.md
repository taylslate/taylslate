# SEC5: stop storing the outreach response token

The signed outreach link still works. The token is no longer written to the database, and no API response or page prop returns it.

No markup, class, or copy changed. The campaign outreach page and the pitch page only change the outreach prop (`token` becomes `""`). The pitch page still passes the URL token as its own prop, which is what the client uses for accept, counter, decline, magic link, and the email code. Nothing on screen changes. Screenshots are not included: both pages need a live session or a live signed link, and this job does not write live data or send email.

## Precheck

Read only, on `ldtmhafewfifdizgfrnn`, 11 Nov 2026, before this file was written. The query is the one in the job prompt.

| outreaches | unexpected_tokens | token_nullable | outreach_tokens | select policies |
| --- | --- | --- | --- | --- |
| 1 | 0 | NO | null | Brand reads own outreach, Show reads outreach to their email |

That matches the 10 Nov 2026 expectation (1, 0, NO, null, those two select policies). The one stored token is a JWT or a known placeholder. `outreach_tokens` does not exist. The token value was not selected.

## Audit

`outreaches.token` is a bearer credential. `POST /api/outreach/[token]/accept`, `counter`, and `decline` call `resolveOutreachOr400`, which verifies the HMAC and does not read the column (`app/api/outreach/[token]/_shared.ts`). A brand who holds the token can accept or counter as the show.

The token is a stateless HMAC JWT over `{outreach_id, iat, v}` (`lib/io/tokens.ts`, `OUTREACH_TOKEN_SECRET`). Verification is signature only. There is no expiry. Nothing reads the stored column to verify, look up, or resend. The raw value is needed once, in memory, to build the email link.

The brand could obtain it four ways:

- RLS policy "Brand reads own outreach" covers every column. `getOutreachesForCampaign` selects `*` with the user-session client.
- `POST /api/outreach` returned the updated row and `pitch_url`. The composer uses `data.outreach.id` only.
- `GET /api/campaigns/[id]/outreach` returned the rows, and the campaign outreach page passed them to the client.
- `GET /api/deals/[id]` returned the full outreach to both deal parties.

Writers, all service role: `POST /api/outreach` (placeholder insert, then an update that stored the signed token) and `POST /api/admin/seed-outreach` (same shape). `POST /api/admin/seed-deal` inserts a non-JWT `seed-...` value. That is not a credential. It was not edited.

Readers of outreach rows do not read `token` on purpose. The email link, the pitch client, magic start, and the email-code routes take the token from the URL.

## Choice

Store nothing. A service-only `outreach_tokens` table would keep a credential at rest that no code needs. A hash table is the right shape only if verification compares against storage, which it does not. Adding that check would change the public routes and open an apply-order gap. The signed token is kept in memory for the email link and, on the admin seed route, for the URL returned to the admin caller. Every response and prop carries `token: ""`. `lib/data/types.ts` still types `token` as `string`. The redaction helper fills that field so component props stay the same.

## Expand and contract

The column is `NOT NULL` with unique constraint `outreaches_token_key`. Code on main still inserts it, so removal is expand then contract.

087 (this PR, not applied) runs only if `outreaches.token` exists. It sets every value to `retired:<id>` and drops `NOT NULL`. The unique constraint stays. Placeholders are unique. No grant change. No policy change. No new table.

Before 087: the column is still `NOT NULL`. New sends write `retired:<uuid>`, so inserts work. Old rows still hold their JWT in the column. No response or prop serializes it.

After 087: old values are placeholders too.

087 is order-independent with 084 (command agent turn index, merged in PR 88), 085 (SEC3, when that file exists: revokes outreach writes from `authenticated` and drops the two brand write policies; 087 runs as the migration owner and changes no grant or policy), and 086 (SEC4, deals and `deal_payment_secrets` only).

Merge first. Apply 087 only after Chris names it. Paste `supabase/migrations/087_outreach_token_retire.sql` into the Supabase SQL Editor, then run the introspection query in that file. Expected: `tokens_not_retired` 0, `token_nullable` YES.

Contract step, its own PR after 087 is live and this code is deployed: remove the placeholder writes and drop `outreaches.token`.

## What changed

- `lib/outreach/public.ts` exports `redactOutreach` and `redactOutreaches`. They set `token` to `""` and do not log.
- `POST /api/outreach` inserts `retired:<uuid>`, updates `sent_at` only, still signs the email link, and returns the redacted row with `email_sent` and `email_reason`. `pitch_url` is gone.
- Accept, counter, and decline return `redactOutreach(result.outreach)`.
- `GET /api/campaigns/[id]/outreach` and the campaign outreach page pass `redactOutreaches`.
- The pitch page passes `redactOutreach(outreach)`. The URL token prop is unchanged.
- `GET /api/deals/[id]` redacts the outreach on the Wave 12 response. Nothing else in that file changed.
- `POST /api/admin/seed-outreach` inserts the same placeholder, does not write the signed token, and still returns the signed URL to the admin caller.

`lib/data/queries.ts`, `lib/io/tokens.ts`, and `lib/data/types.ts` were not edited. Verification stays signature-only.

`app/api/admin/seed-outreach/route.test.ts` is outside the Owns list. The old test required the service-role update to store the signed token, and its `single()` queue assumed that second call. Leaving it would fail `npx vitest run` on the write this job removes. The persist assertion now expects a `retired:` placeholder and no `token` in any update payload, and the queue is one campaign insert. No other behavior in that file changed.

## Decisions for Chris

- Revocation and expiry. Tokens never expire and cannot be revoked short of rotating `OUTREACH_TOKEN_SECRET`, which kills every open link. Default for SEC5: no change. A later job can add `exp` to new tokens or a hashed allowlist check.
- Secret rotation for tokens already exposed to brands. The precheck found 1 outreach, sent to an internal taylslate.com address. Default: no rotation.

## Follow-ups

Not folded in. They touch files SEC4 owns, or they need a behavior review.

- Contract migration: drop `outreaches.token` and remove the placeholder writes, after 087 is live and SEC5 is deployed.
- domain_events keeps copies of the token. app/api/outreach/[token]/accept-counter/route.ts:159 and :169 log the full outreach row (io.counter_accepted, deal.created). Live has 3 domain_events payloads with a JWT-shaped string. domain_events is service-only (no anon or authenticated grant), so this is not reachable through the Data API. After 087, new rows log the retired placeholder. Cleanup: a one-off scrub of payload->outreach->token, plus redactOutreach in those two logEvent payloads, in the contract PR.
- `setup_intent_id`, `payment_method_id`, and `docusign_envelope_id` still reach the show viewer through `app/(dashboard)/deals/[id]/page.tsx` (SEC4 owns that line) and `GET /api/deals/[id]`. Ids, not credentials. Strip them for the show viewer after SEC4 lands.
- `app/api/admin/seed-deal/route.ts` comment names a `deal_setup_intents` table that does not exist.
- `POST /api/auth/magic/start` sends a magic link to any email address for any valid outreach token. It does not check `outreach.sent_to_email`, and the route has no rate limit. Review whether it should require the sent-to address.
