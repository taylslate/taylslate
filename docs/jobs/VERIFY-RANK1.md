# VERIFY-RANK1: claimed ownership feeds ranking

Migration 100 is not applied. The header says NOT APPLIED LIVE, CHRIS MUST NAME IT. Do not paste it until Chris names it. Do not run it from the app.

## States

`shows.ownership_status` is `unclaimed`, `claimed`, or `verified`.

| State | Meaning | Ranking bonus |
| --- | --- | --- |
| `unclaimed` | No show account controls the show. This is the Podscan default. | 0 |
| `claimed` | A show account controls the profile, rates, and replies. Ownership is not verified. | 1 |
| `verified` | A verified `show_ownership_proofs` row set the column. O2 and O4 still do that. | 3 |

Pending is still a tag. It is true while a proof or a rep link is pending. It is not a stored value. `shows.is_claimed` stays deprecated and is not read. `shows.is_verified` stays in the schema and is not read by ranking. Nothing new sets it.

The bonus is `OWNERSHIP_RANK_BONUS` in `lib/ownership/tier.ts`. It is added to the 0-100 conviction composite on every campaign, then clamped to 0-100. Verified is more than claimed. Both are small next to audience fit and reach. An unclaimed show is not filtered, penalized, or hidden. Brands can still find it, plan it, and send an offer.

The live ranker is `scoreShowConviction` in `lib/scoring/conviction.ts`, sorted by `scoreCandidatesAgainstRings`. `lib/scoring/index.ts` is the old Podscan scorer. It does not see catalog ownership, and this job does not wire it back in.

## Claimed rule

Claimed matches the control tie already used by `public.user_owns_show` (migration 077) and the non-proof branches of `getVerifiedProfileTies`:

1. A `deals` row has this `show_id` and a non-null `show_profile_id`. That profile replies on the deal and can edit the show.
2. `data_sources` contains `show_owner`, `contact_email` is set, and that email matches `auth.users.email` for a user who has a `show_profiles` row. That is the private show `resolveOwnerShowId` creates.

Not a claim:

- A pending, rejected, contested, or expired proof.
- A verified proof. That show is `verified`.
- An agent roster claim (`POST /api/shows/[id]/claim`). That link stays pending until an admin approves it.
- `shows.is_claimed`.
- A matching `show_profiles.podscan_id`.

Verified is never downgraded to claimed. The migration backfill and `syncShowClaim` both skip a verified row.

## Writes

`syncShowClaim` runs when a deal is created with a `show_profile_id`, when onboarding backfills that id onto accepted deals, when a show account resolves or creates its owner show, and when a deal is deleted. If the rule no longer holds, a claimed row goes back to unclaimed. A verified row stays verified.

`writeOwnershipStatus` is the only writer of the column from the app. O2 (`markShowVerified`) and O4 (`finishAdminVerify`) call it with `verified`. A client patch cannot set `ownership_status`. `showWritePatch`, `updateShow`, `createShow`, and roster import drop the field.

## Before migration 100

The live check constraint allows only `unclaimed` and `verified`. A write of `claimed` returns Postgres `23514`. That write logs `[ownership] 23514` and returns. Claim, verify, profile, and deal flows continue. The column stays `unclaimed`.

Ranking and the owner read do not wait on the column. `stampRankingOwnership` copies a stored `claimed` or `verified` value onto the discovery candidate. When the stored value is still `unclaimed`, it applies the rule in memory and does not write. `getOwnershipState` does the same for an unclaimed column. `GET /api/v1/shows` and MCP `get_show` / `list_shows` return `ownership_status`. `verified` on that payload stays the profile-tie flag from `getVerifiedProfileTies`. A tie with an unclaimed column is reported as `claimed`. A stored `verified` stays `verified`.

After 100 is applied, the same writes store `claimed`, and the backfill sets it where the rule already holds.

## Security

No new grant. No RLS change. No anon access. The column is not client-writable. Logs for this path are a Postgres code, or the fixed text `claim read` / `claim sync`. They do not include a show id, an email, or database message text. Error responses are unchanged and still carry no database text.

Migration 100 does not add a function, so it does not set `search_path`.
