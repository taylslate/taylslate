# RELAY1: outreach relay

Chris locked this on 2026-11-23. Brand and show talk through Taylslate. Real contact details stay hidden until the IO is signed.

## Locked decisions

1. Reply domain `reply.taylslate.com` with a per-outreach reply address. The sender display name is "<Brand or Show name> via Taylslate".
2. Emails, phone numbers, and links that expose contact info are stripped from relayed messages until the IO is signed. Signing unlocks them.
3. No relayed attachments. The only attachment ever emailed is the final signed IO.
4. Signing stays as it is today. The brand signs embedded in Taylslate. The show signs from the DocuSign email.
5. The show responds with in-app buttons (accept, counter, decline) as the primary path. Email replies are relayed text, and that forwarding is RELAY1b.
6. CRM: the show is added to the brand's CRM when outreach is sent, if the brand has CRM access. The brand is added to the show's CRM at the show's first response, only if that side has CRM access. Name and details only, never the real email, until signing.
7. Brands do not see a show's contact email or phone anywhere until the IO is signed, so outreach goes through Taylslate. The address stays visible to the show owner for their own show, to admins, and to either party after unlock (both sides signed, deal not cancelled).

## What 1a ships

- Migration `094_outreach_relay.sql` as a file only. It is not applied. Tables: `relay_threads`, `relay_messages`, `relay_inbound_events`, `brand_crm_shows`.
- A private relay thread per outreach, with a random 26-character address token. Reply-To stays `outreach@taylslate.com` until `RELAY_INBOUND_ENABLED` is exactly `"true"`.
- From on brand outreach is "<Brand> via Taylslate <outreach@taylslate.com>".
- Server-side stripping of pitch bodies, counter messages, decline reasons, and legacy bulk bodies before they are stored or sent.
- The show is added to `brand_crm_shows` after a successful send when the brand's plan includes CRM and the outreach has a catalog show id. No email or phone is written.
- `addBrandToShowCrmOnFirstResponse` runs on the first in-app response and writes nothing. Shows have no CRM.
- Show contact email is removed server-side from brand-facing payloads until unlock. Outreach recipients are resolved on the server from the show id. The composer says "Sent through Taylslate".

## What 1b will ship

Inbound mail for `reply.taylslate.com` does not exist yet. RELAY1b is a separate job after 1a merges: the Resend inbound webhook, signature check, replay guard, text-only forwarding, and contact stripping on replies. Nothing in 1a forwards a reply. Forged or unknown inbound mail is out of scope here because there is no route.

## Env flag

Code reads `RELAY_INBOUND_ENABLED`. It is not set in this PR. While it is unset, or set to anything other than the string `"true"`, Reply-To stays `outreach@taylslate.com`.

Flip it to `"true"` only after RELAY1b has shipped and the inbound DNS and Resend route are live. Flipping it earlier makes replies bounce.

## Needs Chris

- Apply migration 094 on `ldtmhafewfifdizgfrnn` only when he names 094.
- RELAY1b infra, after 1a merges:
  - MX for `reply.taylslate.com`
  - Resend inbound route for that domain
  - `RESEND_INBOUND_WEBHOOK_SECRET` for the webhook
  - Then set `RELAY_INBOUND_ENABLED=true`
- Name a migration number for RELAY1c if he wants the items under "Not closed in 1a" closed. That work is not in this PR.

## Known conflicts

- Brand-facing payloads are redacted in the app, but the database still lets a signed-in brand read some contact data directly through the Supabase data API with its own session. See "Not closed in 1a".
- Threads exist before deals. The reply address is per outreach and is linked to the deal on accept. One outreach makes at most one deal.
- Shows have no CRM, so the show-side add is a no-op until Chris decides on a show CRM.
- The legacy bulk send has no thread and no relay. Its body is stripped and its recipient is resolved on the server.

## Not closed in 1a

Propose as RELAY1c. It needs its own migration number, named by Chris.

- Direct data API reads with the brand's own session. `authenticated` holds table-level SELECT on `public.shows` (migration 071, policy from 077), so a brand can select `contact_email` on discoverable shows from PostgREST. Closing it needs a column-level revoke on `shows.contact_email` plus replacing the `select("*")` user-client reads of `shows` with explicit column lists. That set includes about 21 reads in `lib/data/queries.ts` and a few in `lib/reps/store.ts`, `app/api/deals/route.ts`, `lib/discovery/direct-search.ts`, `app/api/shows/[id]/enrich/route.ts`, and `app/(dashboard)/imports/past-campaigns/page.tsx`.
- The same for campaign JSON (`scored_shows[].contactEmail`, legacy `recommendations[].contact_email`) and `outreaches.sent_to_email`, readable by the owning brand through RLS. Closing it means stop writing contact into campaign JSON, scrub existing rows (a live data write, Chris only), and a brand read path for outreaches without `sent_to_email`.
- IO documents before signing. The IO preview, IO generate, IO pdf, IO send, plan IO generation, and the legacy deal `insertion_order.publisher_contact_email` put the show's email in the IO the brand sees before signing. Decision 4 says signing stays as today, so this needs Chris's call.
