# RELAY1b: narrow public outreach profile reads

Code half only. The public accept, counter, and decline routes no longer load a full `brand_profiles` or `profiles` row.

## Columns now selected

`brand_profiles` (`BRAND_PROFILE_SELECT`):

| Column | Who reads it |
| --- | --- |
| `user_id` | `resolveOutreachOr400` loads `profiles` by this id. On accept, `createWave12Deal` stores it as `brand_id`. Every response passes it to `addBrandToShowCrmOnFirstResponse`. |
| `brand_name` | `notificationBrandName` via `brandNameFromProfile`. That name is the brand name on the response email and, on accept, the IO-ready email. |
| `brand_identity` | Same helper. Used when `brand_name` is empty. |
| `brand_website` | Same helper. Domain fallback when the name and the identity are both empty. |

`profiles` (`BRAND_USER_SELECT`):

| Column | Who reads it |
| --- | --- |
| `id` | `sendEmail` `recipientProfileId` on the response email (accept, counter, decline) and on the IO-ready email (accept, when a deal is created). |
| `email` | `sendEmail` `to` on those same messages. The HTTP JSON does not include it. |
| `full_name` | Name fallback after the profile name. |
| `company_name` | Name fallback after `full_name`. |

POST `/api/outreach/[token]/accept`, `/counter`, and `/decline` are the callers. They pass the resolved row into `applyAndNotify` and return `redactOutreach(outreach)` only. POST `/api/outreach/[token]/accept-counter` does not call `resolveOutreachOr400`. It is session-authenticated and was left as it is.

`OutreachTokenBrandProfile` and `OutreachTokenBrandUser` are those columns. The select object must list every key of the type (`satisfies`). A missing key, an extra key, or a read of any other field is a tsc error. The parsed value copies only those keys.

A `brand_profiles` row with an empty `user_id` is "Brand profile missing" (500). A `profiles` row with an empty `id` or `email` is "Brand user missing" (500). `profiles.email` is `NOT NULL` in the schema, so a live row still notifies.

## Inbound

No function in `lib/relay` forwards an inbound message. `app/api/webhooks` has DocuSign and Stripe only. Migration 094 creates `relay_messages` and `relay_inbound_events` for a later webhook. Nothing in this job writes them, and nothing copies `From`, `Reply-To`, `Sender`, or `Return-Path`.

Outbound outreach already sets Reply-To with `relayReplyTo` in `app/api/outreach/route.ts`. That path is unchanged.

## Left alone

`app/outreach/[token]/page.tsx` already selects `brand_name`, `brand_identity`, `brand_website`, `user_id` and `company_name`, `full_name`. It is outside this job's file list.

No migration. No new route. No env var. No email copy change. No live send. `lib/stripe`, `lib/payouts`, `lib/billing`, `lib/airchecks`, and `plans.ts` were not edited.

## Needs Chris

Nothing to apply. The Resend inbound webhook, its signature check, and header replacement stay a later job. Leave `RELAY_INBOUND_ENABLED` unset until that route and `reply.taylslate.com` are live. When forwarding exists, the show must see the relay address in `From`, `Reply-To`, `Sender`, and `Return-Path`.
