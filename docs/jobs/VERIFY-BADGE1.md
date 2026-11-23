# VERIFY-BADGE1: Verified badge for brands

Brands see a small "Verified" badge on a show only when that show proved ownership. Claimed and unclaimed shows show nothing.

## Rule

`verifiedShowIds` in `lib/shows/verified-flag.ts` is the only check. It uses the service-role client. A show id is returned only when both of these are true:

1. `shows.ownership_status` is `verified`.
2. A `show_ownership_proofs` row for that show has `status` `verified`.

The read is batched with `.in()` in chunks of 80. Any read error or throw returns an empty set. The log line is `[shows] verified read` plus a Postgres code, or `unknown`. It does not include a show id.

These do not count:

- `ownership_status` of `claimed` or `unclaimed`
- a verified proof without `ownership_status` `verified`
- `ownership_status` `verified` with no verified proof
- a deal, a `show_profile` tie, or a `show_owner` email
- `shows.is_claimed`, `shows.is_verified`, or `getVerifiedProfileTies`

`/api/v1` calls this helper. Its `verified` boolean is unchanged. `ownership_status` stays off that payload.

## Where brands see it

The campaign page stamps `verified` onto each test, scale, and bench card after `getTieredUniverse`. Ranking and the tier split do not read the flag. The conviction score bonus from VERIFY-RANK1 is unchanged.

`GET /api/shows` adds `verified` for the brand and show paths that feed search. The agent roster response is unchanged. `ownership_status` is still stripped unless the caller is the owner or an admin.

The badge renders only when `verified === true`, next to the show name, on:

- test, scale, and bench cards in `app/(dashboard)/campaigns/[id]/conviction-discovery-view.tsx`
- show search results in `app/(dashboard)/shows/search/search-client.tsx`

The label is "Verified". The accessible name is "Verified show". Colors are existing `--ts-*` tokens. No new animation.

## Out of scope

No migration. Nothing written to `ldtmhafewfifdizgfrnn`. No Stripe, payout, billing, aircheck, or env change. No "Claimed" label on a brand surface.
