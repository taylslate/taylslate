# VERIFY-RANK1: claimed ownership feeds ranking

Migration 100 is not applied. The header says NOT APPLIED LIVE, CHRIS MUST NAME IT. Do not paste it until Chris names it. Do not run it from the app.

## States

`shows.ownership_status` is `unclaimed`, `claimed`, or `verified`.

| State | Meaning | Ranking bonus |
| --- | --- | --- |
| `unclaimed` | No show account controls the show. This is the Podscan default. | 0 |
| `claimed` | The tight rule below holds. Ownership is not verified. | 1 |
| `verified` | A verified `show_ownership_proofs` row set the column. O2 and O4 still do that. | 3 |

Pending is still a tag. It is true while a proof or a rep link is pending. It is not a stored value. `shows.is_claimed` stays deprecated and is not read. `shows.is_verified` stays in the schema and is not read by ranking. Nothing new sets it.

The bonus is `OWNERSHIP_RANK_BONUS` in `lib/ownership/tier.ts`. It is added to the 0-100 conviction composite on every campaign, then clamped to 0-100. Verified is more than claimed. Both are small next to audience fit and reach. An unclaimed show is not filtered, penalized, or hidden. Brands can still find it, plan it, and send an offer. The score does not add a "Claimed show" or "Verified show" line to brand-facing guidance.

The live ranker is `scoreShowConviction` in `lib/scoring/conviction.ts`, sorted by `scoreCandidatesAgainstRings`. `lib/scoring/index.ts` is the old Podscan scorer. It does not see catalog ownership, and this job does not wire it back in.

## Claimed rule

A deal profile id is not enough. A brand can choose `show_id` and type `sent_to_email`, so that link can be forged. Claimed requires one of these, and the matched auth user must have `email_confirmed_at`. That flag is read with `supabaseAdmin.auth.admin.getUserById`, in small chunks. The auth schema is not queried. A lookup error fails closed and logs the code only.

1. Deal. The outreach `response_status` is `accepted`, or `deals.show_signed_at` is set. Declined and cancelled deals are out. Unsigned deals that were not accepted are out. `show_profiles.user_id` is `domain_events.actor_id` on `deal.created`, `io.show_signed`, or `io.counter_accepted` for that deal or outreach. `outreaches.sent_to_email` matches `show_contacts.email` for this show with source `podscan` or `apple_rss`. A brand-typed address does not count.
2. Owner row. `data_sources` contains `show_owner`, `slug` is `owner-` plus that `show_profiles.user_id` (the slug `resolveOwnerShowId` writes through `ownerShowSlug`), and `contact_email` is that user's confirmed login.

Not a claim:

- A pending, rejected, contested, or expired proof.
- A verified proof. That show is `verified`.
- An agent roster claim (`POST /api/shows/[id]/claim`).
- `shows.is_claimed` or a matching `show_profiles.podscan_id`.
- A deal whose only tie is `show_profile_id`.
- Token accept (`app/api/outreach/[token]/_shared.ts`) logs `deal.created` with no actor. Accept-counter records the brand. The DocuSign webhook logs `io.show_signed` with no actor. None of those routes record `auth.uid()` for the show. Deal-based claims stay off until a later lane records a signed-in show action that way. This lane does not add that plumbing. The code path stays, and its test is labeled as a future signed-in show action, not a current route.
- Until that actor exists, claimed comes only from the owner-row branch.

Onboarding backfill still attaches `show_profile_id` so the show can work the deal. That attachment does not by itself mark the show claimed.

`user_owns_show` and `getVerifiedProfileTies` still treat the looser deal and email links as edit rights. That is a separate security item. This lane does not change those functions.

`show_contacts` stays off brand APIs. The claim read is service role only. `lib/podscan-import/exposure.test.ts` allows `lib/ownership/` and migration 100 to name that table so this check can exist. It does not copy the email into a response.

Verified is never downgraded. `writeOwnershipStatus` adds `ownership_status <> verified` on every claimed or unclaimed update, so a verify that lands between the read and the write is kept.

## Writes

`syncShowClaim` runs when a deal is created with a `show_profile_id`, when onboarding backfills that id onto accepted deals, when a show account resolves or creates its owner show, and when a deal is deleted. If the rule no longer holds, a claimed row goes back to unclaimed. A verified row stays verified.

`writeOwnershipStatus` is the only writer of the column from the app. O2 (`markShowVerified`) and O4 (`finishAdminVerify`) call it with `verified`. A client patch cannot set `ownership_status`. Non-admin patches cannot set `data_sources` or `slug`. `importShows` drops `data_sources` and `ownership_status`. `updateShow` and `createShow` drop `ownership_status`.

## Before migration 100

The live check constraint allows only `unclaimed` and `verified`. A write of `claimed` returns Postgres `23514`. That write logs `[ownership] 23514` and returns. Claim, verify, profile, and deal flows continue. The column stays `unclaimed`.

Ranking does not wait on the column. Hydration calls the injected `stampOwnership` dep, which defaults to `stampRankingOwnership`. It copies a stored `claimed` or `verified` value onto the candidate. When the stored value is still `unclaimed`, it applies the tight rule in memory and does not write. A stored `unclaimed` is not reported as claimed on `/api/v1/shows` or MCP. Those reads do not include `ownership_status`. Whether they should is an open decision for Chris. `transformShow` does not copy `ownership_status`, so brand campaign reads (`getConvictionUniverse` and the conviction score reader) do not put the label on the client payload. Scoring copies the raw column in `getShowsBySlugs`, the lookup `hydrate-demographics` uses. `GET /api/shows` and `GET /api/shows/[id]` read the raw column and omit it unless the caller is the show owner or an admin. A brand with a deal still sees the rest of the full row. Non-admin patches cannot set `slug`. `getOwnershipState` passes `slug` so an owner row can show Claimed on the owner and admin view. Those labels are not rendered on brand surfaces.

After 100 is applied, the same writes store `claimed`, and the backfill sets it where the rule already holds.

## Security

No new grant. No RLS change. No anon access. The column is not client-writable. Logs for this path are a Postgres code, or the fixed text `claim read` / `claim sync`. They do not include a show id, an email, or database message text. Error responses are unchanged and still carry no database text.

Migration 100 does not add a function, so it does not set `search_path`.
