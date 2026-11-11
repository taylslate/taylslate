# IO1: Promo code on the IO PDF

No migration. Nothing was applied on `ldtmhafewfifdizgfrnn`. No live write, no charge, and no DocuSign envelope.

## What shipped

`generateIoPdfFromDeal` prints a promo code on the insertion order when the deal has one. The row sits after the last terms row and before Standard Terms. The label is `Promo Code:`. The value is the normalized slug, in the same column and with the same line step as the other terms.

`normalizePromoCode` is both the blank check and the printed value. Null, a missing field, `""`, whitespace, and punctuation-only input print nothing, and `y` does not move. The text-call list for those cases equals `lib/pdf/__fixtures__/io-anchor-baseline.json`, recorded from this generator on `dc67a96` before the row was added. That list is each drawn string with its x, y, and page, including the four DocuSign anchors.

The printed value is the normalized slug: `[A-Z0-9]`, at most 24 characters, no spaces. The raw stored string is not drawn. An authenticated user can update `deals.promo_code` through the Data API, so a raw value such as `X Publisher Signature Tab` must not become a second DocuSign anchor. The slug of that value is `X`.

`getWave12DealById` selects `*`, so `promo_code` is on the deal. Preview (`app/api/deals/[id]/preview/route.ts`) and send (`app/api/deals/[id]/send-to-docusign/route.ts`) pass that deal into `generateIoPdfFromDeal`. Those files were not edited.

## Not covered

`lib/pdf/io-pdf.ts` is the legacy insertion-order generator used by `io/send` and `io/pdf`. It does not print `promo_code`. This job does not change it.

`lib/docusign`, `lib/pdf/io-terms.ts`, `lib/stripe`, `lib/payouts`, `lib/billing`, and `plans.ts` were not edited. No route and no UI was edited.

## Anchors

The fixture deal draws `Advertiser Signature Tab` at x 40 and `Publisher Signature Tab` at x 316, on page 2, y 120. Each date anchor is 30pt below its signature anchor, in white, at font size 6. A blank code leaves those calls where the baseline recorded them. On this fixture, `SHOW20` and a 64-character code (printed as its 24-character slug) both fit on one line.

## Tests

`lib/pdf/io-generator.anchors.test.ts` and the existing `lib/pdf/io-generator.test.ts` (unmodified).

`RECORD_IO_BASELINE=1` rewrites the fixture from a null promo code. The committed fixture was written before the generator change.
