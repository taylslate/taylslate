# HARDEN1: backlog hardening batch

Grounded at main `71a26ec` (#102). No migration. One lane: the import items and the YouTube and U1b items share no file. Owns are disjoint from SEC7 (090) and O2. PR only. Do not merge.

## A. Hidden-show feed match

Before: `findCatalogDuplicates` treated any show with the same feed as a duplicate, including another rep's hidden show. Roster preview returned that hidden show's id and name on a feed match.

After: a feed match counts only when the show is discoverable or `agent_id` is the caller, the same rule as a name match. Another rep's hidden feed is not a duplicate, so the legacy import inserts a new hidden show for the caller. Roster import still classifies the strong-tier match and still writes the pending link. The result keeps the class, the tier, and the reasons, and sets `show_id` and `show_name` to null when the matched show is not discoverable and is not the caller's. A discoverable show or the caller's own show still returns the id and name. Commit re-classifies on the server and still links the hidden show. The roster test that used to expect the hidden id and name was changed on purpose.

## B. SA-14 caps, batching, and error text

Before: `POST /api/shows/import` read the file or JSON with no byte cap and no row cap. `importShows` put `showError.message`, `relError.message`, `deleteError.message`, and the new show id in `errors`. Catalog name and feed lookups ran one `ilike` at a time.

After: a Content-Length over 1 MB is 413 before the body is read. The route then counts bytes, checks `file.size`, and checks the length of the text. Over 1 MB returns "This file is larger than 1 MB." More than 500 parsed shows returns "Send at most 500 shows." The numbers are `ROSTER_IMPORT_MAX_BYTES` and `ROSTER_IMPORT_MAX_ROWS`. 401, 403, and `enforceUpload` still run first. Lookups run in chunks of 20 with `Promise.all` per chunk. The per-query limits and the "Show lookup failed." error are unchanged. `importShows` errors are `${name}: could not be imported.` A failed cleanup is `${name}: could not be imported. Contact support.` The log line is the error code only. Response keys are unchanged.

SA-14 status: caps and batched lookups are done. Formula-cell neutralizing is open. `docs/security/S-A_FINDINGS.md` is owned by SEC7 this round. Paul updates the SA-14 row in a docs pass.

## C. Google revoke

Before: `revokeGoogleToken` swallowed every failure and returned void. Disconnect revoked once, then deleted the tokens. A failed revoke looked the same as a success.

After: `revokeGoogleToken` returns `Promise<boolean>`. It tries at 0 ms, 250 ms, and 1000 ms, and retries only a network error or a 5xx. A 200 returns true. A 400 `invalid_token` counts as revoked and returns true. Anything else returns false. The waits add up to 1.25 seconds. It never throws. Callers that ignore the result still compile. Disconnect still revokes, then deletes. Tokens are deleted even when revoke fails. On a failure the route logs `youtube.google_revoke_failed` with `{ connection_id, attempts }` only and returns `{ ok: true, google_revoke: "failed" }`. The client shows "Disconnected. To finish, remove Taylslate from your Google Account permissions." The link opens `https://myaccount.google.com/permissions` in a new tab with `rel="noopener"`. Success stays `{ ok: true }`. A channel switch logs the same event when revoke returns false. The other callback revoke calls ignore the result.

Keeping the ciphertext until a later retry succeeds is not built. It would contradict the LG2 privacy copy. It is on the Chris list.

## D. Status route and settings page

Before: a `readYoutubeStatus` throw returned the empty "not connected" body with 200. `/settings/youtube` gated on `profile.role === "show"` only, and a read failure rendered "No YouTube channel is connected."

After: a read throw returns 503 `{ error: "unavailable" }` with `Cache-Control: no-store`. The empty constant is gone. After the role check, the page requires `requireShowProfile(user.id).ok` and calls `notFound()` otherwise. A read failure passes `loadError` and the client renders "We could not load your YouTube connection. Refresh to try again." Connect and Disconnect are hidden. The rest of the screen is unchanged.

## E. Domain event types

Before: `youtube.channel_connected` was written with `as LogEventInput["eventType"]`. `youtube.google_revoke_failed` did not exist.

After: both strings are on `DomainEventType`. The cast and the unused `LogEventInput` import are gone.

## F. U1b library search

Before: search applied `.limit(20)` in SQL before `passesFloors` and `excludeLinked`, so floor drops and linked channels could return fewer than 20. `escapeLibrarySearch` escaped `\`, `%`, and `_`, and left `*`. PostgREST treats `*` in `ilike` as `%`, and a backslash does not escape it.

After: `LIBRARY_CREATOR_FETCH` is 60. Search keeps the same order, applies the floors and `excludeLinked` (still one `.in()` call), then slices to the clamped limit of at most 20. `escapeLibrarySearch` removes every `*` after trimming. If the term is empty after that, search returns `[]` with no query. `a*b` is sent as `%ab%`. `*` returns `[]` with no read.

## Needs Chris's OK

Not in this job:

1. AC3 reconcile guard. `lib/airchecks/review.ts` `finishAlreadyCharged` calls `saveConfirmed` unconditionally. `saveAircheckReview` updates by `io_line_item_id` with no `review_decision` guard. A concurrent reject on a line charged through `/api/admin/mark-delivered` can be overwritten with "confirmed". Fix: a guarded update with `.is("review_decision", null)` on the reconcile path, and a 409 when 0 rows change.
2. AC3 charge error text. `lib/airchecks/review.ts` stores and returns the raw Stripe message plus rollback DB text. The admin review route returns it. Fix: fixed wording in the response, with the detail kept in `charge_error` for admins only.
3. Caption fallback order. `lib/airchecks/select.ts` builds the library Map last-wins from an unordered select, while 089 picks the lowest `channel_id`. Fix: order by `channel_id` so they agree. Live: no show has more than one library channel.
4. Google revoke retry that keeps ciphertext after disconnect. It contradicts the LG2 privacy copy ("delete your tokens right away"). If Chris wants it, it needs new privacy wording and a migration (a pending-revoke marker, plus `youtube_oauth_disconnect` changes).
5. AC3 stale-claim clock. `lib/airchecks/store.ts` uses the app clock rather than DB `now()`. Low risk.

## Known gaps

- Formula cells in the legacy CSV import are not neutralized (the rest of SA-14).
- `/api/shows` search still passes `*` through to `ilike`. That route is outside Owns.
- Catalog name lookup still returns at most 25 rows per token and feed lookup at most 10, and does not fail closed when the cap is hit.
- No live write. Nothing applied on `ldtmhafewfifdizgfrnn`.

## Tests

`npx tsc --noEmit` is clean.

`npx vitest run lib/shows lib/reps app/api/shows/import lib/data/roster-links.test.ts lib/youtube-oauth app/api/youtube 'app/(dashboard)/settings/youtube' lib/youtube-library/brand-read.test.ts`: 30 files, 264 passed.

`npx vitest run`: 388 files, 3286 passed, 41 skipped.

`npx next build` compiled successfully and generated 147 pages. `/settings/youtube` stays dynamic.

`git diff --stat main` for `supabase`, `lib/stripe`, `lib/airchecks`, `lib/billing`, `lib/payouts`, `app/api/cron`, `proxy.ts`, `vercel.json`, `lib/youtube-oauth/store.ts`, and `lib/youtube-oauth/feed.ts` is empty.

`rg -n "\.message" app/api/shows/import/route.ts` has no matches. `importShows` `errors.push` lines do not read `.message`.

Screenshots of `/settings/youtube` use the production stylesheet. A signed-in session was not available, so the shots render the page markup rather than a live login. Normal before and normal after are the resting not-connected screen. The load-error shot hides Connect and Disconnect. The disconnect-notice shot is the line shown when Google revoke fails and the tokens are still deleted.
