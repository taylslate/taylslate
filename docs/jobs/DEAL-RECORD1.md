# DEAL-RECORD1: Deal price record and PATCH allowlist

Migration 099 is in the repo and is not applied. Chris names it before anyone pastes it. Nothing in this job writes to the live database.

## PATCH /api/deals/[id]

The handler used to pass the JSON body to `updateDeal`, and `updateDeal` writes with the service role. A brand or a show on the deal could change money, identity, payment, and signature columns and skip migration 085.

The route now keeps two allowlists, both keyed on `auth` user id (`getAuthenticatedUser().id`), not on email.

Buyer (legacy `brand_id`, `agency_id`, or the user on `brand_profiles`):

- `notes`, `status`, `placement`, `ad_format`, `flight_start`, `flight_end`
- `is_scripted`, `is_personal_experience`, `reader_type`, `content_type`, `pixel_required`
- `competitor_exclusion`, `exclusivity_days`, `rofr_days`

Show (legacy `agent_id`, or the user on `show_profiles`):

- `notes`, `status`

Refused on every party: CPM and totals, episode counts, downloads, `price_type`, `agreed_cpm`, ids (`brand_id`, `show_id`, profile ids, `campaign_id`, `outreach_id`), payment method and SetupIntent columns, `card_on_file_at`, `promo_code`, DocuSign and signature columns, cancellation columns.

Legacy status moves that already worked still work: `planning` to `io_sent`, `io_sent` to `live`. A party cannot set `completed` (403). Once `brand_signed_at` or `show_signed_at` is set, every edit is 403. There is no post-signing field on this route.

A disallowed field is 400 for the whole body. Nothing in that body is written. Error JSON is a fixed sentence. It does not include database text or ids.

`updateDeal` itself drops the write when any key is outside the buyer list above. `POST /api/deals/[id]/io/send` still sets `status` to `io_sent` through it.

The legacy deal screen still sends CPM, downloads, and episode count in the same request as notes. That save now fails closed. The screen was not changed.

## deal_price_records

One row per deal (`deal_id` unique).

Identity: `io_id`, `io_number`, `brand_profile_id`, `brand_id`, `show_id`.

Price and unit, written only on insert: `agreed_total_gross`, `agreed_total_net`, `pricing_basis` (`cpm`, `flat`, `per_engaged_view`), `unit_rate`, `medium` (`podcast`, `youtube`, `social`), `unit_format`, `placement` (free text), `unit_count`, `guaranteed_impressions`.

Terms jsonb, copied from the insertion order when one exists: `payment_terms`, `exclusivity_days`, `rofr_days`, `cancellation_notice_days`, `make_good_threshold`, `competitor_exclusion`, `payment_off_platform`.

Dates: `flight_start`, `flight_end`, `booked_at`, `signed_io_pdf_url`.

Outcome, updated later: `delivered_units`, `delivered_at`, `make_good_count`, `make_good_credit_total`, `actual_downloads`, `reported_conversions`, `outcome_status` (`booked`, `delivering`, `delivered`, `make_good`, `cancelled`), `outcome_updated_at`.

Rebook: `prior_record_id` (self fk), `rebook_sequence`, `rebooked` (default false).

`created_at`, `updated_at`.

The signed IO is the row whose `io_number` is `IO-` plus the first 8 characters of the deal id. A legacy `IO-{year}` row on the same deal is not the snapshot. Totals come from that IO. `flat_rate` on a line is stored as `flat`. `per_engaged_view` is allowed by the check for a later price type. Current lines are `cpm` or `flat_rate`.

RLS is on. `service_role` can select, insert, update, and delete. `authenticated` can select. `anon` has no grant. The select policy mirrors the three deals select policies: `auth.uid()` is `deals.brand_id`, `agent_id`, or `agency_id`, or `brand_profiles.user_id`, or `show_profiles.user_id`. There is no authenticated insert, update, or delete policy.

Trigger `deal_price_records_lock_snapshot` rejects an update that changes a snapshot column, including price, terms, unit, flight, and the signed IO url. Outcome and rebook columns stay writable by `service_role`.

## Where the row is written

- DocuSign `show_signed` / `completed`, after the insertion order is marked signed. The first pass runs after `signed_io_pdf_url` is stored. A retry runs on the idempotent path so a missed insert can still land. `linkRebook` points the new row at the latest earlier row for the same show and the same brand (`brand_profile_id` or `brand_id`) and sets `rebooked` on that earlier row.
- `deliverAndChargeLine`, only after the charge returns. `delivered_units` becomes the count of verified lines. `actual_downloads` is their sum. The charge and the rollback are unchanged.
- `approveMakeGood`, after the approval is saved. `make_good_count` and `make_good_credit_total` are the approved rows. `outcome_status` becomes `make_good`. A decline does not change the record.
- `saveConversionReport` and `clearConversionReport`. `reported_conversions` is the number the brand saved, or null when they clear it.

Each call is wrapped. A failure is logged as a fixed scope and a short code. The log does not include the database message. The DocuSign response, the charge result, the make-good approval, and the conversion save still succeed.

Reads on `GET /api/v1` and the MCP `get_deal` tool were not extended. Those serializers are a fixed brand-key allowlist. A price record is a second table, and the show party is not a caller on that surface. Follow-up: a party-scoped read next to `get_deal`, using the same auth as the other deal reads.

`payment_off_platform` is only copied into `terms`. The invoice "Mark paid" path was not changed.
