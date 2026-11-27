# ERR-LEAK1: stop raw error text on plan IO generate

No page or component was edited. The response shape and status codes are unchanged.

## What changed

`POST /api/campaigns/plan/generate-ios` no longer puts `err.message` on the `errors` array.

Both catch blocks (persist a scored show, then create the deal and IO) push `Could not create the IO for "<show name>"`. `console.error` still logs the real message. A thrown value that is not an `Error` is logged as `Unknown error` and the client still gets the same generic line.

`errors` stays a string array. A run that creates nothing is still 500 `{ error: "No deals or IOs were created", errors }`. A run that creates at least one IO is still 200 with `created_count`, `total_count`, `created`, `errors`, and `campaign_id`. Auth, ownership (`campaign.user_id` against the profile id), and the `invalid_surface` 400 are unchanged.

## Unused `agent` binding

`app/api/io/generate/**` is not in the tree. The unused binding is `const agent` in `app/api/deals/[id]/io/generate/route.ts` (line 86). That file is outside Owns. ESLint reports one warning and zero errors:

```
86:11  warning  'agent' is assigned a value but never used  @typescript-eslint/no-unused-vars
```

It was not removed. The line is the only read of that profile, so deleting it would drop the `getProfileById(deal.agent_id)` call. The JSON response does not use the result.

## Other routes that still return error text

Not fixed. Other lanes own them. Logged-only `err.message` sites are omitted.

Raw `Error.message`, provider text, or Supabase `error.message` in the JSON body:

- `app/api/campaigns/deals/route.ts` puts `Show ${show_id}: ${err.message}` on `errors`.
- `app/api/campaigns/outreach/generate/route.ts` returns `Outreach generation failed: ${err.message}` at 500.
- `app/api/deals/route.ts` returns `Failed to create deal: ${err.message}` at 500.
- `app/api/deals/import/route.ts` returns `Extraction failed: ${err.message}` at 500 for a general throw, and `PastCampaignImportError.message` for that class.
- `app/api/deals/[id]/send-to-docusign/route.ts` appends `err.message` on the show signing URL (502), IO persistence (500), envelope create (502), and brand signing URL (502).
- `app/api/deals/[id]/setup-intent/route.ts` returns Supabase `updErr.message` at 500 and `err.message` at 502.
- `app/api/deals/[id]/charge-episode/route.ts` returns `err.message` at 502. `ChargeOwnershipError` stays a fixed 404.
- `app/api/invoices/route.ts`, `app/api/invoices/generate/route.ts`, `app/api/invoices/[id]/route.ts` (GET and PATCH), `app/api/invoices/[id]/pdf/route.ts`, and `app/api/invoices/send/route.ts` interpolate `err.message`. The send route also returns the mail provider `error.message`.
- `app/api/billing/upgrade/route.ts`, `app/api/billing/downgrade/route.ts`, and `app/api/billing/seats/route.ts` (POST and DELETE) interpolate `err.message`.
- `app/api/stripe/connect/create-account/route.ts`, `app/api/stripe/connect/onboarding-link/route.ts`, `app/api/stripe/connect/status/route.ts`, `app/api/stripe/customer/create/route.ts`, `app/api/stripe/payment-method/list/route.ts`, `app/api/stripe/payment-method/[id]/route.ts`, and `app/api/stripe/payment-method/setup-intent/route.ts` interpolate `err.message`. The setup-intent Stripe branch also returns `message`, `code`, and `type`.
- `app/api/shows/route.ts` returns `claimError.message` when the roster link fails after the show is created.
- `app/api/shows/enrich-batch/route.ts` puts `err.message` on `details[].status`.
- `app/api/shows/[id]/enrich/route.ts` returns `PodscanError.message`.
- `app/api/webhooks/stripe/route.ts` returns `err.message` at 400.
- `app/api/admin/seed-deal/route.ts` builds `SeedTeardownQueryError` from Supabase `error.message` (event scan and restrict checks) and returns that message on DELETE. Delete failures return `error.message` for outreaches, deal verification, shows, and campaigns.
- `app/api/admin/aircheck/route.ts` returns `err.message` at 500 for an unknown throw. `AircheckLineNotFound` returns `err.message` at 404, and that string includes the IO line item id.
- `app/api/crm/http.ts` `crmFailure` returns `error.message` on the 400 phrase branch. `lib/crm/store.ts` throws `new Error(error.message)` from PostgREST, so a database message that contains those phrases is returned. Other CRM failures return `CRM request failed.`

Application error classes whose `.message` is the JSON `error` (authored copy, still `err.message`):

- `app/api/imports/past-campaigns/route.ts` returns `PastCampaignImportError.message`. Other throws return `Could not save this import`.
- `app/api/reps/roster/import/route.ts` returns `RosterImportError.message`. Other throws return `Roster import failed.`
- `app/api/v1/health/route.ts` returns `ApiAuthError.message` and `code`. Other throws return `API request failed.`
- `app/api/v1/mcp/route.ts` returns `ApiAuthError.message` and `ApiWriteError.message`. Other throws return `API request failed.`
- `app/api/admin/aircheck/review/route.ts` returns the message for `AircheckReviewNotFound`, `AircheckConfirmUnavailable`, `AircheckReviewConflict`, and `AircheckConfirmInProgress`. Those strings are fixed product copy. The 500 path returns `Review failed.`

`app/api/campaigns/brief/route.ts` returns `validationError.message`. That value is authored submit validation, not a database or library throw.

`app/api/deals/[id]/io/route.ts` reads `err.message` only to choose a generic body. It does not return the raw text.

## Tests

`npx tsc --noEmit` exited 0 with no output.

`npx vitest run`: 500 files, 4060 passed, 41 skipped.

`npx eslint` on `app/api/campaigns/plan/generate-ios/route.ts` and `route.test.ts`: 0 errors, 0 warnings.

`npx next build` compiled successfully and generated 149 pages.

New tests cover a persist throw, an IO insert throw, a non-Error PostgREST-shaped throw, and a 200 where one show fails and another IO is created. Each asserts the generic line, the status, and that the raw text is absent from the JSON. The server log assertion checks that `console.error` still receives the real message.
