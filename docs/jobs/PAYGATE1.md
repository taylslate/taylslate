# PAYGATE1: payout owner gate

No migration. No Vercel env change. Nothing was applied on `ldtmhafewfifdizgfrnn`.

A Stripe Connect transfer runs only when `isPayoutOwnerVerified(show_id, show_profile_id)` is true for the deal's show and show profile. The brand is still charged on delivery. Only the transfer waits.

## Gated paths

Both `stripe.transfers.create` calls go through the gate:

- `lib/stripe/webhook.ts:347` calls `transferPayoutForPayment` (`lib/payouts/transfer.ts:411`). The webhook file was not edited. The gate is inside the helper. Create stays at `lib/payouts/transfer.ts:332` with key `transfer:v2:{paymentId}`.
- `app/api/payouts/early/route.ts:119` calls `transferEarlyPayoutForPayment` (`lib/payouts/transfer.ts:576`). Create stays at `lib/payouts/transfer.ts:636` with key `transfer-early:v2:{paymentId}`.

These do not transfer, so they are not gated: `deliverAndChargeLine`, the mark-delivered route, aircheck review, and `app/api/deals/[id]/charge-episode`. The PaymentIntent still has no `transfer_data`.

`isPayoutOwnerVerified` lives in `lib/ownership/payout-gate.ts`. A null `show_id` or `show_profile_id`, a proof read error, or a throw all count as not verified.

## Held state

A held payout is a `payouts` row with `stripe_transfer_id` null and `transferred_at` null. `amount_cents` is `payments.gross_amount_cents`. `early_payout_fee_cents` is 0. The hold reason is not stored. It is derived at read time from `isPayoutOwnerVerified`. `unique(payment_id)` keeps one row per payment.

`transferPayoutForPayment` inserts that row only when this call is the one that creates it, logs `payout.held` (`payment_id`, `deal_id`, `amount_cents`; no email, no destination), and sends one owner email. A second call does not write the row again and does not send again. It returns null and does not call Stripe. A row that already has a `stripe_transfer_id` is returned as-is and is not re-gated.

A failed or disputed payment with a held row stays held.

## Release

`lib/payouts/release.ts`:

- `releaseHeldPayoutsForShow` (`lib/payouts/release.ts:54`) reads the verified proof for that show, then deals with that `show_id` and `show_profile_id`, then settled payments, then up to 100 payout rows with `stripe_transfer_id` null. Each goes through `transferPayoutForPayment`, one at a time. It never throws. It returns `{ released, held, failed }`.
- `sweepHeldPayouts` (`lib/payouts/release.ts:125`) takes the oldest 100 rows with `stripe_transfer_id` null and runs the same helper, which re-gates. An unverified owner stays held with no write.

Triggers, both fail-soft (the existing response is unchanged if release throws):

- `lib/ownership/check.ts:465`, after `markShowVerified` on an O2 code hit.
- `lib/ownership/review.ts:652`, at the end of `finishAdminVerify`, including an O4 approve retry.
- `GET /api/cron/payout-releases` (`app/api/cron/payout-releases/route.ts:31`). `CRON_SECRET` bearer, `timingSafeEqual`, 401 `Unauthorized` without it. The body is only the three counts. `Cache-Control: no-store`. Daily at `0 22 * * *` in `vercel.json`.

When a held row is released, `transferPayoutForPayment` lists transfers in the deal's `transfer_group` (`lib/payouts/transfer.ts:350`) and adopts one whose `metadata.payment_id` matches, whose `metadata.early_payout` is not `"true"`, and that is not reversed. A list error throws and does not create. Otherwise it creates with the same `transfer:v2` params as before, including `source_transaction`. The row is filled with `.eq("id", existing.id).is("stripe_transfer_id", null)` (`lib/payouts/transfer.ts:378`). Zero rows means a re-read: the same transfer id is returned, a different one logs `payout_conflict` and throws. The call that persisted logs `payout.transferred` and `payout.released`.

## Idempotency

1. Stripe key `transfer:v2:{paymentId}` (and `transfer-early:v2:{paymentId}` for early). Params were not changed, so the key version stays v2.
2. Adopt check: `transfers.list` before create on a held row, so a transfer that outlived the 24 hour idempotency key is not created again.
3. Guarded update: `stripe_transfer_id is null`. A second writer cannot overwrite a transfer id.
4. `unique(payment_id)` and the partial unique index on `stripe_transfer_id`.

## Early payout and the owner

`transferEarlyPayoutForPayment` refuses when any payout row exists, held or transferred (`PayoutAlreadyExistsError`). Then it checks the owner. Not verified throws `PayoutHeldError`, creates no row, and calls no Stripe API.

`POST /api/payouts/early`:

- `PayoutHeldError` is 409 `Verify you own this show to get paid.`
- An existing payout row is 409 `This payout is already on its way.`
- Any other throw is 502 `Couldn't send the early payout.` The log is the error name only.
- Every response, including the view-as block, sets `Cache-Control: no-store`.
- `rejectSwitchedViewMoneyAction` and `sp.user_id === user.id` are unchanged.

The owner email is `lib/email/templates/payout-held.ts`, sent with the existing Resend wrapper. Subject `Verify your show to get paid`. The show name is escaped. No amount and no ids. A send failure does not undo the hold.

`/settings/ownership` counts this user's held payouts with the server Supabase client (RLS, "Show reads own payouts via show_profile"). If any exist and the view is not verified, the page says `You have a payout waiting. Verify you own your show to receive it.` A payout read error hides the banner, logs the code only, and the page still renders.

## Open questions

1. A payout can stay held forever if the deal's show profile never verifies, or if a different profile verifies the show (the proof's `show_profile_id` differs from `deals.show_profile_id`). Should it be refunded to the brand after some time, or released by an admin? This job only holds.
2. A verified owner with no Stripe Connect account still throws in `loadShowConnectAccount` and leaves no row, as today. The sweep only retries rows. Should that case also be held?
3. The email copy, and whether it should include the amount.

## Not in this job

No charge-path change. `lib/stripe`, `lib/billing`, `lib/airchecks`, `lib/delivery`, and `plans.ts` were not edited. No admin release route. No migration. No live write, charge, or send. This PR does not merge. Paul reviews.
