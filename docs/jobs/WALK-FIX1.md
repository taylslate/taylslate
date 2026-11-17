# WALK-FIX1: Show sign-up CTA and Company Name save

A show that clicks Get started on `/for-shows` now lands on `/signup/show`. Company Name on `/settings` loads the saved value and saves it. Builds on R1 (#109) and R1-FIX (#112) for `/signup/show`, on main at 8c79cfd. No migration.

## What changed

1. `SHOWS_COPY.ctaHref` is `/signup/show`. Both Get started links on `/for-shows` use it. The header Log in link uses `LAUNCH.loginHref` (`/login`). The homepage pricing note still says "Shows are free. Log in when a brand sends an offer." and still goes to `/login`.
2. `PATCH /api/settings/profile` writes only `profiles.company_name` on the signed-in user's own row (`auth.uid()`). The body is JSON with that one key. The value is trimmed, internal whitespace runs collapse to one space, control characters are stripped, and a blank value stores null. Over 120 characters after trim is rejected. The user-scoped client is the writer. RLS and the 072 and 077 triggers stay the guard. There is no new table and no new read path.
3. `/settings` selects `role, plan, company_name`, shows the saved name in a controlled field, and saves from a Save button or Enter. The status line says "Saved." or the route error. Plan cards, links, payment sections, the disabled API card, Session, and the `lib/billing/plans.ts` import are unchanged.

## Logo finding

The walkthrough reported a missing header logo on `/for-shows`. It is not a bug. `ShowsHome` and `LaunchHome` both render `MarketingChrome` with `MarketingWordmark` (`/mark.png`). The mark is on the before and after screenshots. A regression assertion now checks `img[src="/mark.png"]` in `shows-home.test.tsx`. The header was not changed.

## Files

- `lib/marketing/shows-copy.ts`
- `components/marketing/shows-home.tsx`
- `components/marketing/shows-home.test.tsx`
- `app/(dashboard)/settings/page.tsx`
- `app/(dashboard)/settings/page.test.tsx` (new)
- `app/api/settings/profile/route.ts` (new)
- `app/api/settings/profile/route.test.ts` (new)
- `app/(dashboard)/settings/api-keys/api-keys.test.tsx` (one expected source hash)
- `docs/screenshots/WALK-FIX1/`
- `docs/SENIOR_DEV_HANDOFF.md`

The API keys test pins a sha256 of `settings/page.tsx` with the API keys card removed. That hash was updated so the suite matches this page change. No assertion in that file was otherwise edited.

`proxy.ts`, `lib/marketing/site.ts`, `lib/marketing/launch-copy.ts`, `lib/stripe`, `lib/payouts`, `lib/billing`, `lib/airchecks`, `lib/security/rate-limit.ts`, and the privacy and terms pages were not edited.

## Tests

`npx tsc --noEmit` clean. `npx vitest run`: 434 files, 3647 passed, 41 skipped. `npx eslint` on changed files: 0 errors. The pre-existing `<img>` warning in `shows-home.test.tsx` is untouched. `npx next build` compiled and generated 149 pages.

Route coverage: 401 without a session; 403 with no Origin and with a foreign Origin; 429 when the limiter denies and 503 when it is unavailable; 400 for bad JSON, an extra `role` or `plan` key, a non-string, 121 characters, and a body over 4 KB; trim and blank-to-null; the update payload is only `{ company_name }` with `.eq("id", user.id)`; a database error returns "Could not save. Try again." and the body and log omit the database message and the user id.

Page coverage: a saved name loads and Save stays disabled until the value changes; one PATCH sends `{ company_name }` and the page shows "Saved."; a failed save shows the route error; Enter in the field saves.

## Screenshots

Taken with `npx next dev` at 1280 wide. `/for-shows` is the real page. `/settings` was rendered with mocked data only. A throwaway auth bypass in `proxy.ts` and the dashboard layout was reverted before commit and is not in the diff. The after settings shot intercepted the browser profile read and `PATCH /api/settings/profile`. Nothing was written to `ldtmhafewfifdizgfrnn`.

- `01-for-shows-before.png`: both Get started links were `/login`
- `02-for-shows-after.png`: both Get started links are `/signup/show`, Log in is `/login`, the mark is still in the header
- `03-settings-before.png`: Company Name is an empty placeholder with no Save button
- `04-settings-after.png`: Company Name shows Northwind Goods, with Save and the "Saved." line

## Known gaps

- "Saved." stays under the field until the next save attempt, including after the person edits the value again.
- The sidebar name that falls back to `company_name` updates on the next full load.
- The plan summary line still contains its existing em dash. That line was not edited.
- The rate limit is 30 saves an hour per user. A denied or unavailable limiter uses the shared rate-limit responses.
- No migration. Nothing was applied on `ldtmhafewfifdizgfrnn`. No live write, charge, or send. This PR does not merge. Paul reviews.
