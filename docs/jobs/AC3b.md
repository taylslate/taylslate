# AC3b: aircheck review hardening (no migration)

Grounded at taylslate/taylslate main `71a26ec` (#102). Follow-up to AC3 (#99). No migration. Nothing was applied live, and no charge was run.

Chris approved changes in `lib/airchecks` for exactly these AC3 fixes ("yes its ok"). Angus relayed that on 2026-11-11. The approval covers this job's `lib/airchecks` edits and nothing else in `lib/airchecks`.

## Charge ordering at 71a26ec

`confirmAircheck` in `lib/airchecks/review.ts` did this:

1. `requireAircheck`. An already confirmed row returned early. A rejected row returned 409.
2. `loadAircheckLineDeal` and `paymentFor` (`lineAlreadyCharged`). If a payment existed, `finishAlreadyCharged(input, id, false)` ran with no claim held.
3. The eligibility and deal gates.
4. `claimOrUnavailable` took a 5-minute claim through `claimAircheckConfirm`, guarded on `review_decision` null.
5. It re-read. Confirmed returned early. Rejected returned 409.
6. `lineAlreadyCharged` again. If paid, `finishAlreadyCharged(input, id, true)` ran.
7. `deliverAndChargeLine` ran once, and only under the claim.
8. On a 502, it saved `charge_error`, logged `aircheck.charge_failed`, and returned `{ ok: false, chargeError }`.
9. On success, `saveConfirmed(input, true)` ran.
10. The claim was released in `finally`.

`deliverAndChargeLine` is still the only charge call, and it still runs only under the claim. This job does not add a second charge, a retry, or any new path that calls it.

`finishAlreadyCharged` called `saveConfirmed`, which called `saveAircheckReview`. That update matched only `io_line_item_id` and had no `review_decision` guard. `rejectAircheck` refuses when a payment exists, but the reconcile read `review_decision` before a concurrent reject committed and wrote `confirmed` after it. A line charged through `/api/admin/mark-delivered` could flip from rejected to confirmed.

## Fix 1: reconcile guard

Before: a confirm that found an existing payment wrote `review_decision = confirmed` even if a reject landed first. The save matched the line id only.

After: `saveAircheckConfirmedIfUndecided` does the same update as `saveAircheckReview`, plus `.is("review_decision", null)`, and uses `.select("*").maybeSingle()`. Zero rows, and `PGRST116`, return null. Any other error throws a plain `Error`, the same way `saveAircheckReview` does. `saveAircheckReview` is unchanged and still writes `charge_error` and rejections.

`saveConfirmed` uses the new function and returns `AircheckRow | null`.

- Reconcile with no claim, and reconcile under the claim: a null save throws `AircheckReviewConflict` with "This line was already decided. No new charge was made." No `aircheck.confirmed` event is written. `deliverAndChargeLine` is not called on this path.
- After a successful charge, a null save means the claim went stale and another review decided the line. There is no retry, no second charge, and no overwrite. The code logs `aircheck.confirm_blocked` with `reason: "decided_during_charge"`, `payment_id`, and `io_line_item_id`, then throws `AircheckReviewConflict` with "This line was decided while it was being charged. The charge stands. Check this line before doing anything else."
- The review route already maps `AircheckReviewConflict` to 409 with that message.

A rejected line stays rejected.

## Fix 2: fixed error text

Before: `chargeFailureMessage` joined `delivered.chargeError` and the rollback text. `POST /api/admin/aircheck/review` returned that string as `chargeError` with status 502. `publicBody` hid `transcript_text`, `audio_url`, `transcript_segments`, and `client_secret`, so the same response's `aircheck` object also carried `charge_error`. The review screen notice reads `body.chargeError`. A 500 logged the thrown message, which can carry database text, and it logged the line id.

After:

- `review.ts` still writes the full `chargeFailureMessage` into `charge_error` and into the `aircheck.charge_failed` payload. `ConfirmAircheckResult` still keeps `chargeError` for server-side callers. A failed charge with a rollback stores the full "card declined ... Delivery rollback failed: ..." text.
- The route responds 502 with `{ ok: false, chargeError: "The charge failed, so this line is not confirmed. The details are saved on this line for the team.", aircheck: publicBody(result.aircheck) }`.
- `charge_error` is in `HIDDEN_RESPONSE_KEYS`, so the raw text never leaves in any response body.
- Every response from this route sets `Cache-Control: no-store`.
- The 500 body stays "Review failed." The `console.error` logs only the error name, or the error code when one is present. It does not log the message or the line id.

The admin review page still renders the saved `charge_error` server-side, behind `isInternalAdmin`. `review-client.tsx` was not edited. After a failed confirm, the POST notice shows the fixed sentence. A refresh still shows the stored detail on that admin page, from `loadAircheckReview`, not from the JSON body.

### charge_error access

Checked live by SELECT on Nov 11, 2026. This PR does not query the live project and did not re-run that check. The reads that establish the result are:

```sql
select c.relrowsecurity as rls_on
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname = 'airchecks';

select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name = 'airchecks';

select pol.polname, pol.polcmd, pol.polroles::regrole[]
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
 where c.relname = 'airchecks';

select
  has_column_privilege('anon', 'public.airchecks', 'charge_error', 'select') as anon_select,
  has_column_privilege('authenticated', 'public.airchecks', 'charge_error', 'select') as authenticated_select;

select count(*) as aircheck_rows from public.airchecks;
```

Result of that check:

- `public.airchecks` has row level security on.
- The table grants go only to `postgres` and `service_role`.
- There is one policy, "Service role can manage all airchecks" (roles `{service_role}`, ALL).
- `has_column_privilege` for `charge_error` select is false for `anon` and `authenticated`.
- There are 0 rows.

In the app, only `lib/airchecks/store.ts` reads `charge_error`. It is imported by `app/(dashboard)/admin/airchecks/page.tsx` (gate at the admin check) and `[ioLineItemId]/page.tsx` (same gate), both `isInternalAdmin(user.email)`. `charge_error` is service-only at the database and admin-only in the app. No grant or policy change was needed, and none was made.

The assertion in `app/api/admin/aircheck/review/route.test.ts` that expected the raw "card declined" text on the 502 body was replaced on purpose. The body now has the fixed sentence, and "card declined" appears nowhere in it.

## Fix 3: caption fallback order

Before: `buildDueSpots` built `new Map(libraryChannels.map(...))`, so the last row won. The rows come from an unordered, chunked `selectIn("youtube_channels", "show_id", ...)` in `loadDueSpots`. That query is unchanged, because chunked `.in()` reads cannot give a global order. Migration 089 picks the lowest `youtube_channels.channel_id` (`order by yc.channel_id limit 1`). Live, no show has more than one library channel. The database collation is ICU `en_US.UTF-8`, and `channel_id` uses the default collation. That order is not JS `<` byte order: `'UCa' < 'UCB'` is false in JS and true in that collation.

After: `compareCaptionChannelId` sorts with `localeCompare(..., "en-US")`. The comment on that helper names migration 089. Filtered rows are sorted ascending, and each `show_id` keeps the first channel id. Input order does not change the result. `"UCa..."` wins over `"UCB..."`.

## Skipped: stale-claim clock

`claimAircheckConfirm` computes the claim cutoff from `Date.now()` and stamps `confirm_claimed_at` with the app clock (`lib/airchecks/store.ts`). A PostgREST filter value cannot reference database `now()`. Moving this to the database clock needs an RPC or SQL function, which means a migration. It is not trivial, so it stays a follow-up. Claim timing was not changed.

## mark-delivered follow-up

`app/api/admin/mark-delivered/route.ts` still returns `chargeError: result.chargeError` on a 502 (the raw Stripe or rollback text). That route was not edited. It wraps the charge path, so the same fixed-text change needs the same Chris OK. It is a follow-up.

## Out of scope

No edits to `lib/stripe`, `lib/payouts`, `lib/billing`, `lib/delivery`, `plans.ts`, `lib/data/types.ts`, `supabase/**`, `app/api/admin/mark-delivered`, `review-client.tsx`, or the admin airchecks pages. `decided_by` still stores the session email. No Vercel env change. No second charge attempt.
