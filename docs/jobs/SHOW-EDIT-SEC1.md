# SHOW-EDIT-SEC1: close forgeable show edit rights

Migration 101 is not applied. The header says NOT APPLIED LIVE, CHRIS MUST NAME IT. Do not paste it until Chris names it. Do not run it from the app.

## Rule

A caller may edit a show only when one of these holds for `auth.uid()`:

1. Admin. `isShowsAdmin` is unchanged. It reads `INTERNAL_ADMIN_EMAILS` against the auth login from `getUserById`. `profiles.email` is not an admin grant. SQL has no admin branch because the allowlist is not in the database. App writes use the service role after this check.
2. Server owner row. `data_sources` contains `show_owner`, `slug` is `ownerShowSlug(uid)` (the slug `resolveOwnerShowId` writes), a `show_profiles` row exists for that user, `contact_email` equals that user's auth login, and `email_confirmed_at` is not null. Same owner-row rule as `claimLookup` in `lib/ownership/persist.ts`.
3. Verified proof. `show_ownership_proofs.status` is `verified` and `user_id` is this auth user. The verify flow (`lib/ownership/check.ts`) inserts `user_id` and later sets that same row to `verified`. Admin approve (`lib/ownership/review.ts`) sets `decided_by` and does not replace `user_id`. A `shows.ownership_status` of `verified` with no proof for this user does not grant edit. Pending, rejected, contested, and expired proofs do not grant edit.
4. Deal. The same rule as `claimLookup`. The outreach was accepted or `deals.show_signed_at` is set. Declined and cancelled deals are out. `show_profiles.user_id` is `domain_events.actor_id` on `deal.created`, `io.show_signed`, or `io.counter_accepted` for that deal or outreach. `outreaches.sent_to_email` matches `show_contacts.email` for this show with source `podscan` or `apple_rss`. The auth user has `email_confirmed_at`. No current route records that actor. Token accept logs `deal.created` with no actor. Accept-counter records the brand. The DocuSign webhook logs `io.show_signed` with no actor. This lane does not add that plumbing. The branch stays, and its test is a future signed-in show action.

Not an edit grant:

- `deals.show_profile_id` by itself.
- A brand-typed outreach email, including a second account the brand controls.
- A `show_owner` row whose slug is not `owner-` plus this user id.
- An unconfirmed login.
- `profiles.email` or `profiles.role`.
- An approved `agent_show_relationships` row, or `shows.agent_id`. Roster create, import, and `POST /api/shows/[id]/claim` are unchanged. They are not catalog edit.

`showEditGrant` / `showEditGrantIds` in `lib/ownership/edit-rights.ts` is the only app check. `canEditShow` calls it. `ownershipVisibleIds` calls it for who may see `ownership_status`. `replaceOwnerSurfaces` calls it before attaching a catalog show, so a bare deal no longer receives surfaces. The owner slug path still creates or reuses `owner-{uid}`.

`getVerifiedProfileTies` is unchanged. Geography, the v1 show `verified` flag, and `fullShowIdsForCaller` still use it. Those are not edit rights. The brand verified badge is a separate job. A brand deal still returns the full show object through `brand_id`, `agency_id`, or `brand_profile_id`, and `ownership_status` is still stripped unless the edit grant or an admin says otherwise.

## Migration 101

`public.user_owns_show(uuid)` stays `SECURITY INVOKER` with `search_path = ''`. It calls `private.show_edit_grant(uuid)`, which is `SECURITY DEFINER` with `search_path = ''`, because the deal rule reads `show_contacts`, `domain_events`, and `auth.users`. Authenticated has no select on those. The helper returns a boolean for `auth.uid()` only. It does not return an email.

Execute stays with `authenticated` and `service_role`. `anon` and `PUBLIC` stay revoked. Usage on schema `private` is granted to `authenticated` and `service_role` so the invoker function can call the helper. No new table.

The app does not call either function. Owner and admin edits work before 101 is applied, because those writes use the service role after `canEditShow`. Until 101 is applied, a direct PostgREST write to `show_surfaces` still uses the previous function body.

## Security

Logs on this path are `[show-edit]` plus a Postgres code, or the fixed text `unknown`. They do not include an email, a show id, or database message text. Error responses are unchanged.

No screen, style, or animation was edited. `lib/stripe`, `lib/payouts`, `lib/billing`, `lib/airchecks`, `plans.ts`, and the Podscan importer were not edited. `lib/podscan-import/exposure.test.ts` allowlists `supabase/migrations/101_` so the migration may name `show_contacts`, the same way 100 does. Nothing was written to `ldtmhafewfifdizgfrnn`.
