# STRIPE1: the charged line must belong to the deal

`chargeForEpisode` refuses, before any Stripe call and before any write, to charge an `io_line_items` row unless that line's insertion order belongs to the deal being charged. The charged brand stays the deal's own brand, resolved on the server. The happy path is the same charge: same deal, profile, and payment-method queries, same PaymentIntent params, same idempotency key, same payments row.

No page or component was edited. Screenshots are not applicable. No migration.

## Gap

Read on main `b7efa4a`. `lib/stripe/payment-intent.ts` has not changed since before `2732ccd`.

`chargeForEpisode` loads the deal by `input.dealId`, then loads the line by id alone: `io_line_items` select `id,gross_rate` where `id = input.ioLineItemId`. Nothing ties that line to the deal. The amount comes from the line. The customer and card come from the deal's brand (`loadBrandProfile`, then the saved payment method). The PaymentIntent metadata and the payments row carry both ids as given.

`POST /api/deals/[id]/charge-episode` checks that the caller owns the deal (`brand_profile_id` match, or an internal admin), then passes the body's `ioLineItemId` through unchecked. `lib/delivery/mark-delivered.ts` is safe: it derives the deal from the line's own insertion order, then calls `chargeForEpisode` with that pair. That file was not edited.

What a signed-in brand gets by posting a line id from another deal:

- A real off-session charge on its own card for the other line's gross plus fee.
- The other line's price back in the response (`amountChargedCents`).
- A payments row with its own `deal_id` and the foreign `io_line_item_id`.

That row then poisons line-only checks elsewhere. `lib/io/persist-io.ts` blocks the other IO's repair and resend with `payments_reference`. `lib/airchecks/review.ts` `lineAlreadyCharged` would treat the other line as already charged and skip its real charge. The payout follows `payment.deal_id` (`lib/payouts/transfer.ts`), so the money goes to the caller's own deal's show, not the victim's. It needs the foreign line's UUID, which is not guessable.

## Severity

Medium. Cross-tenant price disclosure, griefing of another deal's IO edits and aircheck charge, and an arbitrary-amount charge between a colluding brand and show with chargeback exposure for the platform.

Not exploited. Live precheck below is 0, 0, 0.

## Evidence

- `lib/stripe/payment-intent.ts` line load was by id only. The amount is `gross_rate`. The customer is `loadBrandProfile` (`deals.brand_id`, else `brand_profiles.user_id`).
- `app/api/deals/[id]/charge-episode/route.ts` authorizes the deal, then forwards `ioLineItemId`.
- `lib/delivery/mark-delivered.ts` loads the line, then the insertion order, and charges `io.deal_id`. That path already pairs the line with its own deal.
- `lib/io/persist-io.ts` refuses an IO repair when a payments row names one of its lines.
- `lib/airchecks/review.ts` skips a line that already has a charge.
- `lib/payouts/transfer.ts` pays the show on `payment.deal_id`.

## Precheck

Read only, project `ldtmhafewfifdizgfrnn`, Nov 11, 2026. No rows written. No Stripe call.

```sql
select
  (select count(*) from public.payments) as payments,
  (select count(*) from public.payments p
     join public.io_line_items li on li.id = p.io_line_item_id
     join public.insertion_orders io on io.id = li.io_id
    where io.deal_id is distinct from p.deal_id) as mismatched,
  (select count(*) from public.insertion_orders where deal_id is null) as io_without_deal;
```

| payments | mismatched | io_without_deal |
| --- | --- | --- |
| 0 | 0 | 0 |

That matches the Nov 11, 2026 expectation (0, 0, 0). Coding continued.

## What changed

`ChargeOwnershipError` is exported from `lib/stripe/payment-intent.ts`. Name `ChargeOwnershipError`. Message `IO line item does not belong to this deal.`

The line select is `id,gross_rate,io_id`. Right after the line loads, and before `loadBrandProfile`, the helper loads `insertion_orders` `id,deal_id` by `line.io_id` with `supabaseAdmin`. It throws `ChargeOwnershipError` when `io_id` is null, the insertion order is missing (no row, or PostgREST `PGRST116`), or `io.deal_id` is not `deal.id`. A read error on that lookup throws a plain `Error` and does not call Stripe. Nothing before this point calls Stripe. `customers.retrieve` and `paymentIntents.create` stay later.

`findExistingPayment` stays first and unchanged. It keys on `(deal, line)`. With this check a mismatched pair cannot get a payments row through `chargeForEpisode`. Live has none.

No other edit in `lib/stripe`. Amount math, fee, payment-method fallback, metadata, insert, and the `23505` replay are unchanged. The idempotency key stays `pi:v3:{dealId}:{ioLineItemId}`. The create params did not change, so the version was not bumped.

The charged customer is always the deal's brand from `loadBrandProfile`. The helper does not take a brand, customer, or amount from the input. Who may call is still the route: the session user owns `deals.brand_profile_id`, or `isInternalAdmin`. `lib/stripe` has no session.

The charge-episode route catches `ChargeOwnershipError` before the generic 502 and returns 404 `{ error: "IO line item not found" }`. A foreign line and a missing parent insertion order get that same body, with no amount. The log is one line and does not include the foreign line's amount. Other errors stay 502.

## What did not change

- `lib/stripe/customer.ts`, `setup-intent.ts`, `webhook.ts`, `server.ts`.
- `lib/payouts`, `lib/billing`, `lib/billing/plans.ts`, `lib/delivery/mark-delivered.ts`, `lib/airchecks`.
- No migration, constraint, trigger, or SQL.
- No screen, style, animation, or existing route behavior other than this 404.
- No live write, charge, or Vercel env change.

## Follow-ups

Not in this PR.

- There is still no database constraint that `payments.deal_id` equals the line's insertion order `deal_id`. A service-role insert outside `chargeForEpisode` could write a mismatched pair. This job adds no migration.
- `findExistingPayment` still returns before the ownership check. A mismatched row that already existed would short-circuit. The precheck found none, and this path can no longer write one.
- A line id that does not exist is still a plain `Error` and 502. Only the ownership failures (`null` `io_id`, missing insertion order, other deal) are 404.
- `lib/delivery/mark-delivered.ts` already passes the line's own deal. It was not edited. If that charge throws `ChargeOwnershipError`, the existing rollback still runs.
- SA-26 records the separate Data API write on `gross_rate`. That lock is migration 085, not this job.
