# RELAY1c: hide show contact from the data API

File only. Migration 102 is not applied. Skeen applies it on ldtmhafewfifdizgfrnn only after Chris names 102.

## What changed

- `authenticated` loses table SELECT on `public.shows`, `public.outreaches`, and `public.insertion_orders`, then receives column SELECT on every column except `contact_email`, `sent_to_email`, and `publisher_contact_email`. `anon` keeps nothing. `service_role` and the policies are unchanged.
- The same statement removes `contactEmail` from `campaigns.scored_shows` and `contact_email` from `recommendations`, `youtube_recommendations`, and `expansion_opportunities`. On 2026-11-23 that was 2 campaigns and 39 scored show elements. A second run updates 0 rows. `updated_at` moves on those 2 rows because the existing trigger stays on.
- Every user-scoped read of those three tables names `lib/shows/read-columns.ts`. Owners, roster agents, admins, and unlocked parties get the address back through `attachVisibleShowContacts` or `attachVisibleOutreachEmails` after the existing visibility check.
- Campaign writers strip the contact keys. Outreach recipients come from the server catalog only. A hidden show is used only when it is discoverable, the caller has an approved roster row, or the caller is on a deal that came from an accepted outreach.
- GET `/api/deals/[id]/io` and POST `/api/deals/[id]/io/send` require a deal party (admins included). A brand does not receive `publisher_contact_email` before unlock, and a blank brand save does not wipe the stored address. The send response no longer includes `senderEmail`. The send recipient is the agency or advertiser address.
- POST and PATCH `/api/deals/[id]/io`, including the 409 when an IO already exists, blank `publisher_contact_email` the same way GET does and set `publisher_contact_hidden`. A locked brand cannot set that field on PATCH or on a new POST. IO route errors are generic and log `error.code` only.
- generate-ios reuses a slug match only when `pitchableShowIds` allows it, and does not store that show's address otherwise. A shared Podscan id prefers the discoverable row, then a tied row, ordered by id. The static guard also rejects star and withheld-column embeds on any non-admin select.
- POST `/api/campaigns/deals` and POST `/api/campaigns/plan/generate-ios` cannot create a discoverable show or set a show contact from brand-supplied data.

102 does not revoke UPDATE on `campaigns.selected_show_ids`. The brand can also write the JSON arrays, so one column revoke would not close the path. The send path refuses a hidden show with no real tie.

`lib/pdf`, `lib/io`, DocuSign, the preview route, io/generate, and io/pdf are unchanged. io/generate's response for the agent side lacks the publisher address until RELAY1d.

## Left alone

These are not brand-reachable and were not changed: `show_profiles.ad_copy_email`, `show_profiles.billing_email`, `profiles.email`, `brand_show_contacts.email` and `phone`, `invoices.bill_to_email` and `from_email`, `show_contacts.email`, `youtube_channel_emails.email`, `podscan_catalog`, `deals`, `past_campaign_records.raw`. No public views. No authenticated function returns a contact column.

## Needs Chris

Name 102. Skeen applies it. It scrubs 2 live campaigns and 39 saved contact entries. 28 Podscan-only saved shows in one April campaign will show "No contact on file yet". After it is applied, run the introspection block in the migration header. RELAY1d is next and has no migration.
