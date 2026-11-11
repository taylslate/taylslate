# AC3: a person confirms one aircheck, then the existing charge runs

Migration number is **080**. It is not applied. Apply it on `ldtmhafewfifdizgfrnn` only after merge, only when Chris names 080, in the same release as the deploy, and only after 079 and 040, which are already live.

## What shipped

`POST /api/admin/aircheck/review` still requires a session, then `isInternalAdmin`. A bad `ioLineItemId` is 400. `decidedBy` and `actorId` come from the session. The body cannot set them.

Confirm loads the aircheck. An already confirmed row returns `alreadyCharged` and does not charge. A rejected row is 409: reopening a rejected line is not supported. A non-failed payment on the same `deal_id` and `io_line_item_id` is reconciled to `confirmed` and does not charge. A payment for that line on a different deal does not count.

Otherwise the row must be `transcribed` with `match_result` `matched` or `not_matched`, and the deal must be booked and not cancelled. A `not_matched` confirm needs no typed reason. The event sets `override: true`. Skipped, failed, pending, unjudged, and a cancelled or unbooked deal are 409 and do not charge.

Confirm and reject then take one claim (`confirm_claimed_at`, `confirm_claimed_by`). The claim is one conditional update: `review_decision` is null, and the claim is null or older than 5 minutes. Zero rows is 409, in progress, and does not charge. Inside the claim, confirm calls `deliverAndChargeLine` and nothing else that charges. The success write sets `confirmed` and clears the claim. A failed charge stores `charge_error`, emits `aircheck.charge_failed`, releases the claim, and leaves the decision empty so a retry is allowed. If the charge succeeded and saving `confirmed` throws, the claim is released. A retry hits the already-charged reconcile and does not charge again.

Reject claims, then refuses a confirmed row or a non-failed payment. It stores `rejected`, emits `aircheck.rejected`, and runs the make-good hook once. It never calls `deliverAndChargeLine`.

If `confirm_claimed_at` is missing (42703 or PGRST204), confirm and reject return 503, "Confirm is unavailable until migration 080 is applied.", and do not charge.

`/admin/airchecks` is a read-only queue for the same admin gate. It lists up to 50 ready rows and a second group of charge-failed rows. It does not select `transcript_text`, `audio_url`, or `decided_by`. The page is URL only. The admin dashboard was not edited. The existing review screen was not edited. Ineligible confirms show in its existing error notice.

Events: `aircheck.confirmed` (now includes `match_result`, `confidence`, `override`, and `payment_id`), `aircheck.rejected`, `aircheck.confirm_blocked`, and `aircheck.charge_failed`. Each carries `actorId` from the session. Payloads have no transcript, audio URL, or client secret.

## Access

080 adds two columns on `public.airchecks`. It re-asserts row level security, revokes `public`, `anon`, and `authenticated`, and grants `select, insert, update, delete` to `service_role`. No policy for `authenticated`. No backfill.

## Decisions

- (a) Rejected is final. Confirm on a rejected line is 409. There is no reopen path.
- (b) Confirming `not_matched` needs no typed reason. The event sets `override: true`.
- (c) The three Stripe limits stay out. A retry after a decline within 24 hours can replay Stripe's idempotent decline. A PaymentIntent created but not persisted, retried after the 24 hour key window, could double charge. `isPayoutOwnerVerified` is not wired into payouts.
- (d) 040 and 079 are already live. This job does not query the live project.
- (e) The queue page is reachable by URL only.

## Known gaps

- Migration 080 is not applied. Confirm and reject return 503 until Chris applies it with the deploy.
- `lib/stripe`, `lib/payouts`, `lib/billing`, and `lib/delivery` were not edited. `lineAlreadyCharged` was re-keyed in `lib/airchecks/review.ts` only.
- The cron, webhooks, and scripts still cannot confirm or charge. Charging stays on the two admin routes.
- No auto-confirm, auto-reject, or batch confirm.
- The three Stripe limits in (c) are unchanged.
