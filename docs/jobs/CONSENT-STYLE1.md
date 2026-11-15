# CONSENT-STYLE1: Restyle the OAuth consent screen in Ink & Gold

Paint only. No migration. Migration 092 is in the repo and is still not applied.

## What shipped

`/oauth/consent/[requestId]` uses the signed-in Ink & Gold shell. The screen is `brand-app` with the Fraunces and Figtree variables, the warm canvas, and a white card (hairline, 8px radius, soft shadow). Allow and Billing are navy. Deny is white with a hairline. Each scope row has a gold dot. The existing mark sits above the heading and is `aria-hidden`. Copy, the allow and deny posts, and the billing link are unchanged.

## Screenshots

Taken with `npx next dev` from the real `/oauth/consent/[requestId]` page, so Tailwind, `lib/brand/tokens.css`, and the app fonts were loaded. A throwaway stub returned mocked states and was not committed. Nothing was written to the database. `proxy.ts` and `page.tsx` are not in this diff.

- `01-consent-read.png`: read only, 1280 wide
- `02-consent-read-write.png`: read, write campaigns, and write outreach, 1280 wide
- `03-consent-expired.png`: expired or already-used request, 1280 wide
- `04-consent-plan-gate.png`: plan without API access, 1280 wide
- `05-consent-mobile.png`: read only, 390 wide

## Where

- `app/oauth/consent/[requestId]/consent-client.tsx`
- `app/oauth/consent/[requestId]/consent.test.tsx`
- `docs/screenshots/CONSENT-STYLE1/`
- `docs/SENIOR_DEV_HANDOFF.md`

`page.tsx` was not edited. `lib/mcp-oauth/*`, `app/api/oauth`, `next.config.ts`, `proxy.ts`, `lib/brand/tokens.css`, `lib/brand/app-fonts.ts`, `lib/stripe`, `lib/payouts`, `lib/billing`, `lib/airchecks`, and `supabase/migrations` were not edited. No migration.

## Tests

`npx tsc --noEmit` clean. `npx vitest run`: 432 files, 3637 passed, 41 skipped. `npx eslint` on the two changed TypeScript files: 0 errors. `npx next build` compiled.

## Known gaps

- Dashboard cards are flat hairline panels. This card uses Tailwind `shadow-sm` for the soft lift.
- Migration 092 is not applied.
- No migration. This PR does not merge. Paul reviews.
