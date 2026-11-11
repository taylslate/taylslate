# SEC3: lock deal, IO, invoice, and outreach writes

Migration 085 is written and not applied. Nothing here was run as a write against `ldtmhafewfifdizgfrnn`. The precheck below is SELECT only. Apply 085 any time after merge and Chris's OK. No app code depends on it. Paste the file in the SQL Editor. 080 is reserved and is not in the repo. 084 is on main and is not a prerequisite. 083 is already applied.

Screenshots are not applicable. This job changes no page, component, style, or animation.

`lib/stripe`, `lib/payouts`, `lib/billing`, `lib/airchecks`, and `plans.ts` were not edited. No route, lib, or component file was edited.

## Decisions

- (a) Drop the UPDATE policies on deals and the INSERT and UPDATE policies on outreaches once the grants are gone. Same choice as 072 for payments. Default confirmed.
- (b) The legacy `/deals/[id]/io` page, opened by direct URL on a DocuSign-flow deal that is still in planning, may no longer create a draft IO through the user client. Default confirmed. That page calls `POST /api/deals/[id]/io/generate`, which inserts with `createIO` on the session client. The new trigger rejects that insert when the deal has `outreach_id`, `brand_profile_id`, or `docusign_envelope_id`. `POST /api/deals/[id]/io` itself still uses `persistIoForDeal` on `supabaseAdmin`, so the service-role create is unchanged. DocuSign IOs are created from send-to-docusign. No screen was changed.
- Invoices page and IO form: Generate invoice (POST /api/invoices/generate, createInvoiceFromIO, which inserts with the user client at lib/data/queries.ts:462) now fails on a DocuSign-flow deal. app/(dashboard)/invoices/page.tsx:100-124 offers it for any live or completed deal whose IO has a verified or posted line, and Wave12 deals reach live and completed. createInvoice returns null on the 42501, so the route answers 400 'No delivered line items found', which is misleading. Default: accept. DocuSign deals are charged per episode through Stripe, and no DocuSign invoice exists live (0 invoices). If Chris wants invoices on DocuSign deals, a follow-up job moves that insert to the service client behind a party check.

## Live precheck (2026-11-11, SELECT only)

Project `ldtmhafewfifdizgfrnn`. Every count was 0. No backfill.

| Check | Count |
| --- | --- |
| deals | 0 |
| legacy rows with a DocuSign column set | 0 |
| insertion orders on a DocuSign-flow deal | 0 |
| io_line_items | 0 |
| invoices | 0 |
| payouts | 0 |

`authenticated` held DELETE, INSERT, SELECT, and UPDATE on `deals`, `insertion_orders`, `io_line_items`, `invoices`, `invoice_line_items`, `outreaches`, and `payouts`. `anon` and `PUBLIC` had no grants on those tables.

Write policies matched the audit:

| Table | Command | Policy |
| --- | --- | --- |
| deals | INSERT | Deal participants insert deals |
| deals | UPDATE | Brand updates own deals via brand_profile |
| deals | UPDATE | Deal participants update deals |
| insertion_orders | INSERT | IO insert via deal |
| insertion_orders | UPDATE | IO update via deal |
| io_line_items | INSERT | IO line items insert via deal |
| io_line_items | UPDATE | IO line items update via deal |
| invoices | INSERT | Invoice insert via deal |
| invoices | UPDATE | Invoice update via deal |
| invoice_line_items | INSERT | Invoice line items insert via deal |
| outreaches | INSERT | Brand inserts own outreach |
| outreaches | UPDATE | Brand updates own outreach |

`payouts` had the write grants and no write policy. `payments` stays locked by 072. `profiles` stays guarded by 041, 072, and 077.

If `legacy_with_docusign_cols` or `docusign_ios` is non-zero on a later read, 085 still applies. Those rows become service-role writes only.

## What shipped

`085_lock_deal_io_writes.sql`.

`deals`. Revoke UPDATE and DELETE from `authenticated`, `anon`, and `public`. Drop "Brand updates own deals via brand_profile" and "Deal participants update deals". Revoke INSERT, then grant INSERT on the legacy columns only: `campaign_id`, `show_id`, `brand_id`, `agent_id`, `agency_id`, `status`, `num_episodes`, `placement`, `ad_format`, `price_type`, `cpm_rate`, `gross_cpm`, `guaranteed_downloads`, `net_per_episode`, `gross_per_episode`, `total_net`, `total_gross`, `is_scripted`, `is_personal_experience`, `reader_type`, `content_type`, `pixel_required`, `competitor_exclusion`, `exclusivity_days`, `rofr_days`, `flight_start`, `flight_end`, `notes`. Naming `outreach_id`, `brand_profile_id`, `show_profile_id`, any `agreed_*` column, `docusign_envelope_id`, `brand_signed_at`, `show_signed_at`, `signed_io_pdf_url`, `signature_certificate_url`, `brand_reminder_sent_at`, `cancelled_at`, `cancellation_reason`, `setup_intent_id`, `setup_intent_client_secret`, `payment_method_id`, `promo_code`, `card_on_file_at`, `id`, `created_at`, or `updated_at` fails with 42501. "Deal participants insert deals" stays.

Those legacy columns are the keys at the three user-client insert sites. `POST /api/deals` (`createDeal`) adds `brand_id` and, for an agent or agency, `agent_id` or `agency_id` from `partiesForRole`. Optional `campaign_id`, gross fields, and `notes` are omitted when undefined. `POST /api/campaigns/plan/generate-ios` (`createDeal`) writes the same commercial columns plus `campaign_id` and the gross fields, with flight dates from `resolveDealFlight`. `POST /api/campaigns/deals` (`addDeals`) writes the podcast shape (`host_read`, `cpm`) and the YouTube shape (`integration`, `flat_rate`, `cpm_rate` 0). No user-client update or delete of deals exists. `updateDeal`, `updateWave12Deal`, `createWave12Deal`, and `deleteDeal` use `supabaseAdmin`.

Guard. `private.reject_client_write_on_docusign_deal()` is `SECURITY DEFINER` with `search_path = public, pg_temp`. Execute is revoked from `public`, `anon`, and `authenticated`. The function cannot use `current_user` the way 072 does, because inside a security definer function `current_user` is the owner. It allows the write when the JWT role or `auth.role()` is `service_role`, or when the invoker (`SET ROLE`, otherwise `session_user`) is `service_role`, `postgres`, or `supabase_admin` and the JWT is not `authenticated`. Otherwise it resolves the parent deal for NEW and, on UPDATE, OLD: `insertion_orders.deal_id`, `io_line_items.io_id` to `insertion_orders`, `invoices.io_id` to `insertion_orders`, `invoice_line_items.invoice_id` to `invoices` to `insertion_orders`. It raises 42501 when that deal is missing or `outreach_id`, `brand_profile_id`, or `docusign_envelope_id` is not null. BEFORE INSERT OR UPDATE triggers, dropped and recreated, on those four tables.

`insertion_orders`. Revoke UPDATE and DELETE. Grant UPDATE on the 25 `IO_FIELDS` plus `total_downloads`, `total_gross`, `total_net`, and `updated_at`. INSERT stays. The trigger guards it. `status`, `signed_at`, and `sent_at` are not in the grant.

`io_line_items`. Revoke UPDATE and DELETE. Grant UPDATE on `LINE_FIELDS` exactly (`id`, `io_id`, and `created_at` are not in that list). INSERT stays.

`invoices`. Revoke UPDATE and DELETE. Grant UPDATE on `status`, `sent_at`, `paid_at`, `payment_method`, and `updated_at`. INSERT stays. `total_due` is not in the grant.

`invoice_line_items`. Revoke UPDATE and DELETE. INSERT stays.

`outreaches`. Revoke INSERT, UPDATE, and DELETE. Drop "Brand inserts own outreach" and "Brand updates own outreach". SELECT policies stay. The app writes outreaches with `supabaseAdmin`.

`payouts`. Revoke INSERT, UPDATE, and DELETE. There was no write policy. SELECT stays.

Every SELECT grant and SELECT policy stays. `service_role` is not granted or revoked. No new table. anon is not granted anything.

A column-level grant is the only way to limit columns. A column revoke does nothing while the table-level privilege exists, so the table privilege is revoked first.

## Apply order

Any time after this merges and Chris says to paste it. No code reads a new column or calls a new RPC. Run the introspection query in the file header after pasting. Expected shape: anon and PUBLIC have no privileges on the seven tables; authenticated keeps SELECT; deals INSERT and the editor UPDATEs are column privileges; the four triggers exist; the four dropped policies are gone; service_role still has SELECT, INSERT, UPDATE, and DELETE.

## Known gaps

- 085 is not applied.
- Service-only tables that still have authenticated write grants, and are blocked only by RLS: `analog_matches`, `campaign_patterns`, `conviction_scores`, `discovery_locks`, `founder_annotations`, `interpretation_locks`, `ring_hypotheses`, `show_sponsors`. Hygiene follow-up. This migration does not change them.
- `deals.setup_intent_client_secret` is still readable by a deal participant. Column-level SELECT is a separate follow-up.
- `lib/stripe/payment-intent.ts:240-244` loads `io_line_items.gross_rate` by line id and does not check that the line belongs to the deal. Needs Chris's OK before any change. This job does not edit that file.
- The legacy IO page's generate path is the accepted user-client failure on a DocuSign-flow deal. `loadDealForParty` only rejects a deal that already has `docusign_envelope_id`, so a planning deal with `outreach_id` or `brand_profile_id` still opens. The generate insert then fails the trigger.
- Invoices page and IO form: Generate invoice (POST /api/invoices/generate, createInvoiceFromIO, which inserts with the user client at lib/data/queries.ts:462) now fails on a DocuSign-flow deal. app/(dashboard)/invoices/page.tsx:100-124 offers it for any live or completed deal whose IO has a verified or posted line, and Wave12 deals reach live and completed. createInvoice returns null on the 42501, so the route answers 400 'No delivered line items found', which is misleading. Default: accept. DocuSign deals are charged per episode through Stripe, and no DocuSign invoice exists live (0 invoices). If Chris wants invoices on DocuSign deals, a follow-up job moves that insert to the service client behind a party check.
