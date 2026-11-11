# SEC4: move the card-setup client secret off deals

No screen, style, or animation was edited. The deal page markup is unchanged. The only page change is the `deal` prop: a brand viewer receives the stored secret, and a show viewer receives null. There are 0 live deals, so a before/after screenshot would require writing a deal. Screenshots are not applicable.

Migration **086 is not applied**. It is in this PR only. Apply it on `ldtmhafewfifdizgfrnn` after merge and after Chris names it. Paste `supabase/migrations/086_deal_payment_secrets.sql` into the Supabase SQL Editor, then run the introspection query in that file.

## Precheck (read only, Nov 11, 2026)

Project `ldtmhafewfifdizgfrnn`. No writes.

| Check | Result |
| --- | --- |
| deals | 0 |
| deals with `setup_intent_client_secret` set | 0 |
| deals with `setup_intent_id` set | 0 |
| `public.deal_payment_secrets` | does not exist |
| deals SELECT policies | Brand reads own deals via brand_profile, Deal participants read deals, Show reads own deals via show_profile |

That matches the Nov 10 expectation in the job (0, 0, null, those three policies).

## Audit

`deals.setup_intent_client_secret` is a confirmable Stripe credential. `stripe.confirmCardSetup` accepts it with the publishable key. It sat on `deals`, and every reader of `deals` received it.

Writers, all service role, none in `lib/stripe`:

- `app/api/webhooks/docusign/route.ts` created a SetupIntent and updated `deals` with `setup_intent_id` and the secret.
- `app/api/deals/[id]/setup-intent/route.ts` compared and rewrote the secret on the reuse path, and wrote both columns on the create path.
- `lib/stripe/setup-intent.ts` only returns `clientSecret` from Stripe. It was not edited.

Readers:

- `components/deals/Wave12DealClient.tsx` reads `deal.setup_intent_client_secret` from the prop. If it is null, it POSTs `/api/deals/[id]/setup-intent` and uses the returned `client_secret`. That route is brand-only. The component was not edited.
- `GET /api/deals` returns `select *` through the user-session client, including to shows.
- `GET /api/deals/[id]` and the deal page load `getWave12DealById` (`select *`, service role) and spread the row. The show viewer is an accepted caller.
- `lib/reps/store.ts` `listRepDeals` is another `select *`. It was not edited. After 086 the column is gone, so the secret is not in that payload either.

`lib/api/v1`, `lib/mcp`, `lib/command-agent`, and `lib/reps` `ROSTER_DEAL_COLUMNS` do not name the column. `lib/data/types.ts` keeps it as a view-model field and was not edited.

## Choice

New table `deal_payment_secrets`:

- `deal_id` uuid primary key, references `deals(id)` on delete cascade
- `setup_intent_client_secret` text not null
- `created_at` and `updated_at`

RLS is on. There are no policies. `revoke all` from `public`, `anon`, and `authenticated`. `grant all` to `service_role`. `truncate`, `references`, and `trigger` are revoked from `authenticated`.

A DO block backfills non-null secrets only while `deals.setup_intent_client_secret` still exists, then the column is dropped. The second run does not plan the missing column and does not change the rows.

`lib/deals/payment-secrets.ts` is the only writer and the only server reader. `getDealSetupSecret` and `saveDealSetupSecret` fail soft. A missing table, which is the state between merge and apply, returns null or false. The log line is `[deal-payment-secrets] outcome=read_failed` or `outcome=write_failed`. The secret and the driver error are not logged.

The setup-intent route compares and saves through those helpers. The deals update on create writes `setup_intent_id` only. A failed secret save still returns 200 with `client_secret`, because the reuse path reads the open SetupIntent from Stripe by `setup_intent_id`. Response shapes and status codes are unchanged.

The DocuSign webhook updates `deals` with `setup_intent_id` only, then `saveDealSetupSecret`. The existing error return and the `deal.setup_intent_created` event are unchanged. The event payload does not include the secret.

The deal page passes `setup_intent_client_secret: ownsAsBrand ? await getDealSetupSecret(wave12.id) : null`. The show viewer always gets null, including before 086, when `select *` would still contain the column.

`app/api/deals/route.ts`, `app/api/deals/[id]/route.ts`, and `lib/data/queries.ts` were not edited. Once 086 is applied, their `select *` no longer returns the secret. Until then, those two API responses can still include the column. The precheck found no stored secret.

## Apply order

Merge first. Do not apply 086 before this code is live. The code on main before the merge still writes the column.

Between merge and apply, the new code writes nothing to `deals.setup_intent_client_secret`. Reads of `deal_payment_secrets` fail soft to null. The brand card form falls back to `POST /api/deals/[id]/setup-intent`, which reuses the SetupIntent from Stripe.

086 does not grant or revoke anything on `deals`. It is independent of 084 (PR 88, the command-agent turn index).

085 (SEC3, `cursor/sec3-deals-update-guard-7bfb` at `90ad23f`, not on main) grants `authenticated` INSERT on this legacy list only:

`campaign_id`, `show_id`, `brand_id`, `agent_id`, `agency_id`, `status`, `num_episodes`, `placement`, `ad_format`, `price_type`, `cpm_rate`, `gross_cpm`, `guaranteed_downloads`, `net_per_episode`, `gross_per_episode`, `total_net`, `total_gross`, `is_scripted`, `is_personal_experience`, `reader_type`, `content_type`, `pixel_required`, `competitor_exclusion`, `exclusivity_days`, `rofr_days`, `flight_start`, `flight_end`, `notes`.

That list does not include `setup_intent_client_secret`. 085's column list does not need to drop it. The name appears in the SEC3 doc only as a column an insert must not set.

Either apply order works:

- 085 then 086. The INSERT grant does not name the secret column. Dropping the column leaves the grant in place.
- 086 then 085. The column is already gone. 085's GRANT names only columns that still exist, so it succeeds.

A GRANT that names `setup_intent_client_secret` after 086 fails with `undefined_column` (42703). If a later 085 draft adds the name to the INSERT list, that draft has to drop the name. This PR does not edit 085.

084, 085, and 086 can be applied in any order.

## Tests

PGlite only. The suite loads on-disk migrations 001 through 083 (059, 062, 063, 064, 080, 084, and 085 may be absent), seeds two deals with a secret and one without, then applies 086.

Covered: backfill of exactly those two secrets, selecting the dropped column raises 42703, a second apply leaves the rows unchanged, brand owner and show owner are denied select, insert, update, and delete, `select *` from deals succeeds with no secret column, anon is denied, service_role can insert, upsert, and select, RLS is on with 0 policies, grants are service_role only, deleting a deal cascades the secret.

A separate PGlite database grants INSERT on `notes` and on the secret column, then applies 086. The `notes` grant remains. A later GRANT that names the dropped column fails. On the full schema, 085's exact legacy list is granted after 086 and still works after 086 is applied again.

`lib/deals/payment-secrets.test.ts` covers a stored read, an upsert, and a missing-table error. The logged text does not contain the secret or the driver message.

The setup-intent route tests assert the reuse path and the create path call `saveDealSetupSecret` and update deals with `setup_intent_id` only. A failed secret save still returns 200 with `client_secret`. A non-brand caller is still 403.

The DocuSign webhook test asserts the SetupIntent block writes `setup_intent_id` on deals and the secret through `saveDealSetupSecret`. The event payload does not contain the secret.

`app/(dashboard)/deals/[id]/page.test.tsx` asserts the show viewer's `deal.setup_intent_client_secret` is null and the brand viewer's is the stored value, not the value that was still on the row. `components/deals/Wave12DealClient.test.tsx` was not edited.

`npx tsc --noEmit` is clean.

`npx vitest run`: 353 files, 3015 passed, 41 skipped.

`npx next build` compiled successfully and generated 142 static pages. `/deals/[id]` stays dynamic.

## Follow-ups (not built here)

- `outreaches.token` is readable by the sending brand ("Brand reads own outreach", and `GET /api/deals/[id]` returns the full outreach). The token is the show's response link, so a brand can accept or counter on the show's behalf. That needs its own job (column move or a SELECT column list), plus SEC3's write lock.
- The deal page and `GET /api/deals/[id]` still send `setup_intent_id`, `payment_method_id`, and `docusign_envelope_id` to the show viewer. These are ids, not credentials. The show does not use them.
- `app/api/admin/seed-deal/route.ts:529` mentions a `deal_setup_intents` table that does not exist.

## Outside the Owns list

- `STATUS.md`. The job text said not to edit it. The task for this run asked for it.
- `app/(dashboard)/deals/[id]/page.test.tsx`. No deal page test existed. The job says to add one and list it in the handoff.

`rg -n "setup_intent_client_secret" app lib --glob '!*.test.*'` also matches `lib/deals/payment-secrets.ts`. That file is in the Owns list. It selects and upserts the column on `deal_payment_secrets`. The route files no longer name the column. `lib/data/types.ts:721` and the deal page view-model line still do.
