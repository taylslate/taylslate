# S-A security findings

Read-only inventory of Taylslate as of 2026-10-26. Live checks are `SELECT` only against project `ldtmhafewfifdizgfrnn`. No rows were written, no migration was applied, and no Stripe call was made. App code, config, and settings were not changed.

H1 status: SA-01, SA-02, and SA-03 were fixed by H1 (commit 632f420, migration 072_lock_money_columns). 072 is applied and verified on 2026-10-26: `payments` is SELECT-only for authenticated, trigger `profiles_protect_money_columns` exists, and a fee update as authenticated is rejected with 42501. The table inventory below is the earlier 2026-10-26 read and does not include 072.

S-K status: SA-25 is fixed for `GET /api/shows`. A caller with no tie receives `id`, `name`, `platform`, `audience_size`, and `categories`, plus `image_url` and `description` when those strings are non-empty. Contact and rate card stay on the object for the owner, a `getVerifiedProfileTies` match on the caller's `show_profiles` row, an agent's own roster, or a brand or agency with a deal on that show. `show_profiles.podscan_id` is not a tie. `GET /api/shows/[id]` and `GET /api/v1/shows` are unchanged.

Counts to verify:

- Public tables: 43. `SELECT count(*) FROM pg_tables WHERE schemaname = 'public'` returned 43.
- API routes: 120. That is the number of `route.ts` files under `app/api`.
- Anon table privileges in `public`: none. The grant query returned no `anon` or `PUBLIC` rows.

`service_role` and `postgres` have `rolbypassrls`. `anon` and `authenticated` do not. RLS is enabled on every public table and is not forced, so the bypass roles skip policies. The Data API roles that a browser can use do not.

## 1. Tables

Source: `pg_class` (RLS), `pg_policies`, `information_schema.role_table_grants`. Advisor run at 2026-10-26T14:53:08Z.

Anon cannot select, insert, update, or delete any public table. Policies aimed at role `public` still name anon, and the missing grant is what stops the call.

There is no view or materialized view in `public`.

### Grants that repeat

`service_role` has `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` on every public table except `show_ownership_proofs`, where it has `SELECT, INSERT, UPDATE, DELETE` only.

`authenticated` write below means `SELECT, INSERT, UPDATE, DELETE` unless a narrower list is given.

### Tables with RLS and no policy

These eight tables are deny-by-default for `anon` and `authenticated`. Only `service_role` (bypass) can use them. Supabase linter `rls_enabled_no_policy` lists the same eight.

| Table | authenticated | Notes |
| --- | --- | --- |
| api_cache_log | none | service_role only |
| api_rate_windows | none | counter for `/api/v1` |
| api_write_actions | none | pending API writes |
| domain_events | none | audit log |
| event_log | none | operation log |
| login_otp_limits | none | OTP buckets and pending code hashes |
| pooled_deal_priors | none | anonymized aggregates |
| pooled_import_priors | none | anonymized aggregates |

### Tables, policies, and grants

Predicates are the live `pg_policies` rows, shortened only where the SQL is a repeated "deal participant" check. "Participant" means `deals.agent_id`, `deals.brand_id`, or `deals.agency_id` equals `auth.uid()`.

**agent_show_relationships.** RLS on. authenticated: `SELECT` only.

- `Agents read own relationships`, `SELECT`, role `public`, `auth.uid() = agent_id`.

**airchecks.** RLS on. authenticated: none. Policy `Service role can manage all airchecks`, `ALL`, `service_role`, `USING (true)` and `WITH CHECK (true)`.

**analog_matches.** RLS on. authenticated: full write grant. Policy is service_role `ALL` only. Authenticated writes fail RLS. See SA-10.

**api_keys.** RLS on. authenticated: `SELECT` only.

- `Brand selects own api keys`, `SELECT`, `authenticated`, `brand_id = auth.uid()`.

**benchmarks.** RLS on. authenticated: `SELECT` only.

- `Authenticated users can read benchmarks`, `SELECT`, `authenticated`, `USING (true)`.
- `Service role manages benchmarks`, `ALL`, `service_role`, `true`.

**brand_profiles.** RLS on. authenticated: full write grant. Policies are role `public`:

- `Users insert own brand profile`, `INSERT`, `WITH CHECK (auth.uid() = user_id)`.
- `Users read own brand profile`, `SELECT`, `auth.uid() = user_id`.
- `Users update own brand profile`, `UPDATE`, `auth.uid() = user_id` (same expression for the new row).
- No `DELETE` policy. The `DELETE` grant does not currently allow a delete.

**brand_show_contacts.** RLS on. authenticated: full write grant. Four policies, all `authenticated`, all `brand_id = auth.uid()`: delete, insert (`WITH CHECK`), select, update (`USING` and `WITH CHECK`).

**brand_show_notes.** Same shape as contacts.

**campaign_patterns.** RLS on. authenticated: full write grant. Policy is service_role `ALL` only. Authenticated writes fail RLS. See SA-10.

**campaigns.** RLS on. authenticated: full write grant. Role `public`, all four commands, `auth.uid() = user_id` (insert uses `WITH CHECK`).

**conviction_scores.** RLS on. authenticated: full write grant. Policy is service_role `ALL` only. See SA-10.

**deal_conversion_reports.** RLS on. authenticated: full write grant.

- `Campaign owner manages own conversion reports`, `ALL`, `authenticated`. Caller owns `campaigns.user_id` for `campaign_id`, and a `deals` row with that id is tied to the same campaign directly or through `outreaches`. `USING` and `WITH CHECK` match.
- `Service role can manage deal conversion reports`, `ALL`, `service_role`, `true`.

**deals.** RLS on. authenticated: full write grant. Role `public`:

- `Deal participants insert deals`, `INSERT`, caller is `agent_id`, `brand_id`, or `agency_id`.
- `Deal participants read deals`, `SELECT`, same three ids.
- `Deal participants update deals`, `UPDATE`, same three ids. No column list.
- `Brand reads own deals via brand_profile`, `SELECT`, `brand_profile_id` joins `brand_profiles.user_id`.
- `Brand updates own deals via brand_profile`, `UPDATE`, same join. No column list.
- `Show reads own deals via show_profile`, `SELECT`, `show_profile_id` joins `show_profiles.user_id`.
- No show `UPDATE` or `DELETE` policy. The show side cannot update a deal through this table. A participant can. See SA-04.

**discovery_locks.** RLS on. authenticated: full write grant. Policy is service_role `ALL` only. See SA-10.

**founder_annotations.** RLS on. authenticated: full write grant. Policy is service_role `ALL` only. See SA-10.

**insertion_orders.** RLS on. authenticated: full write grant. Role `public`. Insert, select, and update each require a parent deal where the caller is a participant. No column list. No delete policy.

**interpretation_locks.** RLS on. authenticated: full write grant. Policy is service_role `ALL` only. See SA-10.

**invoice_line_items.** RLS on. authenticated: full write grant. Role `public`. Insert and select require the invoice's IO's deal to have the caller as a participant. No update policy and no delete policy.

**invoices.** RLS on. authenticated: full write grant. Role `public`. Insert, select, and update through the parent deal's participants. No column list. No delete policy.

**io_line_items.** RLS on. authenticated: full write grant. Role `public`. Insert, select, and update through the parent deal's participants. No column list. `gross_rate` is included. See SA-04.

**learning_overrides.** RLS on. authenticated: full write grant.

- `Service role can manage learning overrides`, `ALL`, `service_role`, `true`.
- `Author deletes own learning overrides`, `DELETE`, `authenticated`, `author_id = auth.uid()`.
- `Brand inserts own learning overrides`, `INSERT`, `authenticated`. `author_role = 'brand'`, `author_id = auth.uid()`, and the campaign's `user_id` is the caller.
- `Rep inserts own learning overrides`, `INSERT`, `authenticated`. `author_role = 'rep'`, `author_id = auth.uid()`, the caller is `deals.agent_id` or has an approved `agent_show_relationships` row on a deal in the campaign, and a `show` target must be an approved roster show or a deal the agent is on.
- `Campaign readers select learning overrides`, `SELECT`, `authenticated`. Campaign owner, the author, or an agent or approved rep on a deal in the campaign.
- `Author updates own learning overrides`, `UPDATE`, `authenticated`. `author_id = auth.uid()` plus the brand or rep constraints above.

**make_goods.** RLS on. authenticated: `SELECT` only.

- `Service role manages make_goods`, `ALL`, `service_role`, `true`.
- `Brand reads make-goods on own deals`, `SELECT`, `authenticated`, `deals.brand_id` or `brand_profiles.user_id`.
- `Show reads make-goods on own deals`, `SELECT`, `authenticated`, `show_profiles.user_id`.

**outcomes.** RLS on. authenticated: full write grant. Role `public`:

- `Users insert own outcomes`, `INSERT`, `auth.uid() = user_id`. The predicate does not require the caller to own `booking_id`.
- `Users read own outcomes`, `SELECT`, `auth.uid() = user_id`.
- No update or delete policy.

**outreaches.** RLS on. authenticated: full write grant. Role `public`:

- `Brand inserts own outreach`, `INSERT`, `brand_profiles.user_id = auth.uid()`.
- `Brand reads own outreach`, `SELECT`, same.
- `Brand updates own outreach`, `UPDATE`, same. No column list. `response_status` is included.
- `Show reads outreach to their email`, `SELECT`, caller's `profiles.role = 'show'` and `lower(profiles.email) = lower(outreaches.sent_to_email)`.
- No delete policy.

**past_campaign_imports.** RLS on. authenticated: full write grant. Four `authenticated` policies, `brand_id = auth.uid()` for delete, insert, select, and update.

**past_campaign_records.** Same four policies. Trigger `past_campaign_records_show_match` rewrites the show match for any caller other than `service_role` or `postgres`.

**payments.** RLS on. authenticated: full write grant. Role `public`:

- `Payments insert via deal`, `INSERT`. `payments.invoice_id` joins an invoice, IO, and deal, and the caller is a participant. No column list. `stripe_payment_intent_id`, `status`, `deal_id`, and `io_line_item_id` are writable on that insert. See SA-02.
- `Brand reads own payments via brand_profile`, `SELECT`.
- `Brand reads own payments via deal`, `SELECT`, participant on `payments.deal_id`.
- `Payments access via deal`, `SELECT`, participant through `invoice_id`.
- No update or delete policy. A later `UPDATE` from `authenticated` fails RLS.

**payouts.** RLS on. authenticated: full write grant. Policies are select only:

- `Brand reads own payouts via deal`, `SELECT`, role `public`, participant or brand profile on the payment's deal.
- `Show reads own payouts via show_profile`, `SELECT`, role `public`.
- No insert, update, or delete policy. The write grant is latent. See SA-10.

**profiles.** RLS on. authenticated: full write grant. Role `public`:

- `Users insert own profile`, `INSERT`, `auth.uid() = id`.
- `Users read own profile`, `SELECT`, `auth.uid() = id`.
- `Users update own profile`, `UPDATE`, `auth.uid() = id`. No column list.
- Trigger `profiles_protect_is_managed` rejects an `is_managed` change unless `current_user` is `service_role`, `postgres`, or `supabase_admin`.
- No trigger and no check covers `platform_fee_percentage`, `plan`, `role`, `stripe_customer_id`, `stripe_connect_account_id`, `stripe_subscription_id`, `subscription_status`, `seat_count`, `tier`, or `campaigns_this_month`. See SA-01 and SA-05.
- Checks that do exist: `profiles_plan_check` (`pay_as_you_go`, `starter`, `operator`, `agency`), `profiles_role_check` (`brand`, `agency`, `agent`, `show`), `profiles_subscription_status_check`, `profiles_tier_check`. `admin` is not a legal role. `platform_fee_percentage` is `numeric(5,4)` with default `0.10` and no range check, so `0` is a legal value.

**ring_hypotheses.** RLS on. authenticated: full write grant. Policy is service_role `ALL` only. See SA-10.

**show_ownership_proofs.** RLS on. authenticated: `SELECT` only.

- `Owners read own ownership proofs`, `SELECT`, `authenticated`, `user_id = auth.uid()`.

**show_profiles.** RLS on. authenticated: full write grant. Role `public`: insert, select, and update where `auth.uid() = user_id`. No delete policy. Trigger `show_profiles_guard_podscan_id` runs `private.show_profiles_guard_podscan_id()`, which is `SECURITY DEFINER`.

**show_sponsors.** RLS on. authenticated: full write grant.

- `Sponsors are publicly readable`, `SELECT`, role `public`, `USING (true)`.
- Anon still cannot read, because anon has no table grant. Authenticated can read every row. There is no write policy, so the write grant is latent. See SA-10.

**show_surfaces.** RLS on. authenticated: full write grant.

- `Service role manages show surfaces`, `ALL`, `service_role`, `true`.
- `Show owner manages own surfaces`, `ALL`, `authenticated`, `owner_user_id = auth.uid()` and `WITH CHECK` also calls `user_owns_show(show_id)`.
- `Buyers read published surfaces`, `SELECT`, `authenticated`, `published = true`.

**shows.** RLS on. authenticated: `SELECT` only.

- `Shows readable by signed-in participants`, `SELECT`, `authenticated`. A row is visible when `is_discoverable` is true, or `agent_id` is the caller, or the caller has an approved roster link, or the caller is `brand_id`, `agency_id`, or `agent_id` on a deal for the show, or the caller has a `show_profiles` row on such a deal, or the row's `data_sources` contains `show_owner` and `contact_email` matches the caller's `profiles.email` and that caller has a `show_profiles` row. `show_profiles.podscan_id` is not part of the predicate.

### Flags from this section

- Anon can touch no public table.
- No public table has RLS off.
- Authenticated can write rows, with an ownership predicate, on: `brand_profiles`, `brand_show_contacts`, `brand_show_notes`, `campaigns`, `deal_conversion_reports`, `deals`, `insertion_orders`, `invoices`, `io_line_items`, `invoice_line_items` (insert and select only), `learning_overrides`, `outcomes` (insert), `outreaches`, `past_campaign_imports`, `past_campaign_records`, `payments` (insert), `profiles`, `show_profiles`, `show_surfaces`.
- The ownership predicate on `profiles`, `deals`, `insertion_orders`, `io_line_items`, `invoices`, `payments`, and `outreaches` does not restrict columns. That is SA-01, SA-02, SA-04, and SA-05.
- Authenticated holds `INSERT`, `UPDATE`, or `DELETE` with no matching policy on: `analog_matches`, `campaign_patterns`, `conviction_scores`, `discovery_locks`, `founder_annotations`, `interpretation_locks`, `payouts`, `ring_hypotheses`, `show_sponsors`, plus `DELETE` (and some `UPDATE`) on the deal, invoice, profile, and outreach tables listed above. Those calls fail today. See SA-10.

### Functions

Live `pg_proc` in `public`, plus the one definer function in `private`.

| Function | Security | Execute for anon or authenticated | Notes |
| --- | --- | --- | --- |
| cleanup_test_data | invoker, search_path set | service_role only | Refuses proof deals and Stripe charges |
| cleanup_test_data_delete_batch | invoker | service_role only | Dynamic delete, table name allowlisted |
| cleanup_test_data_log_batch | invoker | service_role only | Writes `domain_events` |
| enforce_past_campaign_show_match | invoker | authenticated and service_role | Trigger. Authenticated can also call it as an RPC |
| get_avg_negotiated_cpm(uuid) | DEFINER, owner `postgres`, search_path unset | anon, authenticated, and PUBLIC | Reads `public.deals`. See SA-06 |
| increment_api_rate_window | invoker | service_role only | |
| login_otp_consume | invoker | service_role only | Returns the pending code hash to the caller on a successful verify action. The route is the only caller |
| normalize_show_match_key(text) | invoker | authenticated and service_role | Pure text function |
| past_campaign_show_candidates(text) | invoker | authenticated and service_role | `SELECT` on `shows` still passes through RLS |
| persist_confirmation | invoker | anon, authenticated, and PUBLIC | RLS on `ring_hypotheses` is service_role only, so the call fails for those roles. See SA-19 |
| persist_interpretation | invoker | anon, authenticated, and PUBLIC | Same |
| persist_refinement | invoker | anon, authenticated, and PUBLIC | Same |
| protect_profiles_is_managed | invoker | anon and authenticated | Trigger. RPC use does not bypass the trigger body |
| refresh_pooled_deal_priors | invoker | service_role only | Deletes and rebuilds pooled rows |
| refresh_pooled_import_priors | invoker | service_role only | Same |
| reset_monthly_campaigns | invoker, search_path unset | anon, authenticated, and PUBLIC | Updates `profiles.campaigns_this_month`. As invoker, RLS limits this to the caller's row. See SA-19 |
| update_updated_at | invoker, search_path unset | anon, authenticated, and PUBLIC | Trigger. Body sets `NEW.updated_at` |
| user_owns_show(uuid) | invoker | authenticated and service_role | Used by the show_surfaces policy |
| private.show_profiles_guard_podscan_id | DEFINER | anon and authenticated have EXECUTE | Trigger on `show_profiles`. Schema `private` is outside `/rest/v1`. See SA-19 |

`public` schema ACL grants `USAGE` to anon and authenticated, not `CREATE`. A search_path hijack that depends on creating an object in `public` is not available to those roles. `get_avg_negotiated_cpm` also schema-qualifies `public.deals`, so the live issue is the definer read, not a shadowed table name.

## 2. API routes

`proxy.ts` treats every path under `/api/` as public (`proxy.ts:64`), including `/api/v1`. The handler is the auth boundary. Pages outside that list redirect signed-out users to `/login?next=<path>`.

One row per `route.ts`. "Session" means `supabase.auth.getUser()` through `getAuthenticatedUser` (`lib/data/queries.ts:47`) or a direct server client. The user client is the anon key plus the user JWT, so RLS applies. `supabaseAdmin` bypasses RLS.

| Route | Methods | Auth | Ownership or role | supabaseAdmin | Validation | Rate limit | Body cap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| app/api/admin/aircheck/review/route.ts | POST | yes. Session, then isInternalAdmin (route.ts:32) | INTERNAL_ADMIN_EMAILS (lib/auth/admin.ts:9). Check at route.ts:32 | no | field checks in the handler | no | none in route |
| app/api/admin/aircheck/route.ts | POST | yes. Session, then isInternalAdmin (route.ts:29) | INTERNAL_ADMIN_EMAILS (lib/auth/admin.ts:9). Check at route.ts:29 | no | field checks in the handler | no | none in route |
| app/api/admin/annotations/[id]/route.ts | DELETE | yes. Session, then isInternalAdmin (route.ts:23) | INTERNAL_ADMIN_EMAILS (lib/auth/admin.ts:9). Check at route.ts:23 | no | field checks in the handler | no | none in route |
| app/api/admin/managed-brands/[id]/handoff/route.ts | POST | yes. Session, then isInternalAdmin (route.ts:28) | INTERNAL_ADMIN_EMAILS (lib/auth/admin.ts:9). Check at route.ts:28 | no | field checks in the handler | no | none in route |
| app/api/admin/managed-brands/route.ts | GET,PATCH | yes. Session, then isInternalAdmin (route.ts:25) | INTERNAL_ADMIN_EMAILS (lib/auth/admin.ts:9). Check at route.ts:25 | yes, after the auth check (route.ts:58) | field checks in the handler | no | none in route |
| app/api/admin/mark-delivered/route.ts | POST | yes. Session, then isInternalAdmin (route.ts:42) | INTERNAL_ADMIN_EMAILS (lib/auth/admin.ts:9). Check at route.ts:42 | no | field checks in the handler | no | none in route |
| app/api/admin/return-to-admin/route.ts | POST | yes. Opaque return-token cookie, hashed and matched to an admin.impersonate event. The plaintext origin cookie is not read (route.ts:13) | isInternalAdmin on the admin email loaded by getUserById (route.ts:108) | yes, after the token lookup (route.ts:77) | field checks in the handler | no | none in route |
| app/api/admin/roster-links/[id]/route.ts | POST | yes. Session (route.ts:17) | see route.ts:24 | no | field checks in the handler | no | none in route |
| app/api/admin/roster-links/route.ts | GET | yes. Session (route.ts:15) | see route.ts:22 | no | field checks in the handler | no | none in route |
| app/api/admin/seed-deal/route.ts | POST,DELETE | yes. Session, then isInternalAdmin (route.ts:54) | INTERNAL_ADMIN_EMAILS (lib/auth/admin.ts:9). Check at route.ts:54 | yes, after the auth check (route.ts:75) | field checks in the handler | no | none in route |
| app/api/admin/seed-outreach/route.ts | POST | yes. Session, then isInternalAdmin (route.ts:66) | INTERNAL_ADMIN_EMAILS (lib/auth/admin.ts:9). Check at route.ts:66 | yes, after the auth check (route.ts:104) | field checks in the handler | no | none in route |
| app/api/admin/shows/[showId]/annotations/route.ts | POST | yes. Session, then isInternalAdmin (route.ts:53) | INTERNAL_ADMIN_EMAILS (lib/auth/admin.ts:9). Check at route.ts:53 | no | field checks in the handler | no | none in route |
| app/api/admin/test-login/route.ts | POST | yes. Session, then isInternalAdmin (route.ts:47) | INTERNAL_ADMIN_EMAILS (lib/auth/admin.ts:9). Check at route.ts:47 | yes, after the auth check (route.ts:66) | field checks in the handler | no | none in route |
| app/api/auth/login/otp/route.ts | POST | no session. Public code send. Account existence is not revealed | optional outreach token must verify; show signup is limited to that contact | yes, after the auth check (route.ts:91) | field checks in the handler | yes. login_otp_consume, 5 sends per hour per email, 20 per hour per IP | none in route |
| app/api/auth/login/otp/verify/route.ts | POST | no session until the code matches. Wrong codes lock the bucket | pending hash from login_otp_consume | yes, after the auth check (route.ts:126) | field checks in the handler | yes. login_otp_consume | none in route |
| app/api/auth/magic/route.ts | GET | yes. Magic-link JWT, 24h expiry (lib/io/tokens.ts:146). No login session required | token email. Existing profile is signed in; a missing profile is created as role show (route.ts:49) | yes, after the auth check (route.ts:41) | field checks in the handler | no | none in route |
| app/api/auth/magic/start/route.ts | POST | yes. Outreach JWT (route.ts:40). The posted email is not checked against the outreach contact | any address with a valid outreach token. No expiry on that token | yes, after the auth check (route.ts:58) | field checks in the handler | no | none in route |
| app/api/billing/downgrade/route.ts | POST | yes. Session | downgrade is for the session user | no | field checks in the handler | no | none in route |
| app/api/billing/seats/route.ts | POST,DELETE | yes. Session | seat change is for the session user | no | field checks in the handler | no | none in route |
| app/api/billing/upgrade/route.ts | POST | yes. Session (route.ts:12) | upgradeByProfileId(user.id) (route.ts:29) | no | field checks in the handler | no | none in route |
| app/api/brand-profile/complete/route.ts | POST | yes. Session (route.ts:3) | no explicit id compare in the route. User-scoped client calls are limited by RLS | no | field checks in the handler | no | none in route |
| app/api/brand-profile/route.ts | GET,PUT | yes. Session (route.ts:3) | no explicit id compare in the route. User-scoped client calls are limited by RLS | no | field checks in the handler | no | none in route |
| app/api/campaigns/[id]/derive-product/route.ts | POST | yes. Session (route.ts:33) | see route.ts:40 | no | field checks in the handler | no | none in route |
| app/api/campaigns/[id]/discover/route.ts | POST | yes. Session (route.ts:25) | see route.ts:32 | no | field checks in the handler | no | none in route |
| app/api/campaigns/[id]/interpret/add-ring/route.ts | POST | yes. Session (route.ts:40) | see route.ts:47 | no | field checks in the handler | no | none in route |
| app/api/campaigns/[id]/interpret/confirm/route.ts | POST | yes. Session (route.ts:29) | see route.ts:36 | no | field checks in the handler | no | none in route |
| app/api/campaigns/[id]/interpret/refine/route.ts | POST | yes. Session (route.ts:46) | see route.ts:53 | no | field checks in the handler | no | none in route |
| app/api/campaigns/[id]/interpret/route.ts | POST | yes. Session (route.ts:32) | see route.ts:105 | no | field checks in the handler | no | none in route |
| app/api/campaigns/[id]/learning/conversions/route.ts | POST | yes. Session via resolveLearningPageForRequest (lib/learning/load.ts:104). 401 at route.ts:17 | decideConversionWrite: campaign owner or admin | no | field checks in the handler | no | none in route |
| app/api/campaigns/[id]/learning/overrides/route.ts | POST | yes. Session via resolveLearningPageForRequest (lib/learning/load.ts:104). 401 at route.ts:17 | decideOverrideWrite: brand owner or representing rep | no | field checks in the handler | no | none in route |
| app/api/campaigns/[id]/outreach/route.ts | GET | yes. Session (route.ts:3) | see route.ts:17 | no | field checks in the handler | no | none in route |
| app/api/campaigns/[id]/plan-handoff/route.ts | POST | yes. Session (route.ts:14) | see route.ts:46 | no | field checks in the handler | no | none in route |
| app/api/campaigns/[id]/portfolio-overrides/route.ts | POST | yes. Session (route.ts:92) | see route.ts:99 | no | field checks in the handler | no | none in route |
| app/api/campaigns/[id]/scale-watchlist/route.ts | POST | yes. Session (route.ts:35) | see route.ts:42 | no | field checks in the handler | no | none in route |
| app/api/campaigns/brief/route.ts | POST | yes. Session (route.ts:20) | see route.ts:110 | no | field checks in the handler | no | none in route |
| app/api/campaigns/deals/route.ts | POST | yes. Session (route.ts:25) | no explicit id compare in the route. User-scoped client calls are limited by RLS | no | field checks in the handler | no | none in route |
| app/api/campaigns/outreach/generate/route.ts | POST | no | none | no | field checks in the handler | no | none in route |
| app/api/campaigns/outreach/send/route.ts | POST | no | none | no | field checks in the handler | no | none in route |
| app/api/campaigns/plan/generate-ios/route.ts | POST | yes. Session (route.ts:3) | see route.ts:107 | no | field checks in the handler | no | none in route |
| app/api/campaigns/plan/route.ts | PUT | yes. Session (route.ts:10) | no explicit id compare in the route. User-scoped client calls are limited by RLS | no | field checks in the handler | no | none in route |
| app/api/campaigns/route.ts | GET | yes. Session (route.ts:5) | no explicit id compare in the route. User-scoped client calls are limited by RLS | no | field checks in the handler | no | none in route |
| app/api/campaigns/selections/route.ts | PUT | yes. Session (route.ts:5) | no explicit id compare in the route. User-scoped client calls are limited by RLS | no | field checks in the handler | no | none in route |
| app/api/crm/shows/[showId]/contacts/[contactId]/route.ts | PATCH,DELETE | yes. requireCrmBrand (app/api/crm/gate.ts:12): session, brand-side role, CRM plan | brandId is the session user (gate.ts:40) | no | field checks in the handler | no | none in route |
| app/api/crm/shows/[showId]/contacts/route.ts | GET,POST | yes. requireCrmBrand (app/api/crm/gate.ts:12): session, brand-side role, CRM plan | brandId is the session user (gate.ts:40) | no | field checks in the handler | no | none in route |
| app/api/crm/shows/[showId]/deals/route.ts | GET | yes. requireCrmBrand (app/api/crm/gate.ts:12): session, brand-side role, CRM plan | brandId is the session user (gate.ts:40) | no | field checks in the handler | no | none in route |
| app/api/crm/shows/[showId]/notes/route.ts | GET,POST | yes. requireCrmBrand (app/api/crm/gate.ts:12): session, brand-side role, CRM plan | brandId is the session user (gate.ts:40) | no | field checks in the handler | no | none in route |
| app/api/crm/shows/route.ts | GET | yes. requireCrmBrand (app/api/crm/gate.ts:12): session, brand-side role, CRM plan | brandId is the session user (gate.ts:40) | no | field checks in the handler | no | none in route |
| app/api/cron/conversion-alerts/route.ts | GET | yes. Bearer CRON_SECRET (route.ts:39). Same non-production fail-open (route.ts:35) | cron job | yes, after the auth check (route.ts:70) | field checks in the handler | no | none in route |
| app/api/cron/deal-timeouts/route.ts | GET | yes. Bearer CRON_SECRET (route.ts:38). If the secret is unset, non-production requests are allowed (route.ts:33) | cron job | yes, after the auth check (route.ts:60) | field checks in the handler | no | none in route |
| app/api/cron/pooled-priors/route.ts | GET | yes. Bearer CRON_SECRET (route.ts:17). Unset secret is 401 | cron job | no | field checks in the handler | no | none in route |
| app/api/deals/[id]/cancel/route.ts | POST | yes. Session (route.ts:7) | see route.ts:46 | yes, after the auth check (route.ts:92) | field checks in the handler | no | none in route |
| app/api/deals/[id]/charge-episode/route.ts | POST | yes. Session (route.ts:30). Brand on the deal, or isInternalAdmin (route.ts:56) | brandProfile.id must equal deal.brand_profile_id unless the caller is an internal admin (route.ts:58) | no | field checks in the handler | no | none in route |
| app/api/deals/[id]/docusign-return/route.ts | GET | no. Redirect only. No session and no DB write (route.ts:22) | none | no | thin | no | none in route |
| app/api/deals/[id]/io/generate/route.ts | POST | yes. Session (route.ts:3) | see route.ts:43 | no | field checks in the handler | no | none in route |
| app/api/deals/[id]/io/pdf/route.ts | POST,GET | yes. Session (route.ts:21) | see route.ts:33 | no | field checks in the handler | no | none in route |
| app/api/deals/[id]/io/route.ts | GET,POST,PATCH | yes. Session (route.ts:196) | see route.ts:174 | yes, after the auth check (route.ts:334) | field checks in the handler | no | none in route |
| app/api/deals/[id]/io/send/route.ts | POST | yes. Session (route.ts:95) | no explicit id compare in the route. User-scoped client calls are limited by RLS | no | field checks in the handler | no | none in route |
| app/api/deals/[id]/make-goods/[makeGoodId]/approve/route.ts | POST | yes. gateMakeGood in decide mode | brand only | no | field checks in the handler | no | none in route |
| app/api/deals/[id]/make-goods/[makeGoodId]/decline/route.ts | POST | yes. gateMakeGood in decide mode | brand only | no | field checks in the handler | no | none in route |
| app/api/deals/[id]/make-goods/route.ts | GET,POST | yes. gateMakeGood (lib/make-goods/gate.ts:26) | brand or show party on the deal | no | field checks in the handler | no | none in route |
| app/api/deals/[id]/preview/route.ts | GET | yes. Session (route.ts:8) | see route.ts:36 | yes, after the auth check (route.ts:60) | field checks in the handler | no | none in route |
| app/api/deals/[id]/promo-code/route.ts | PATCH | yes. Session (route.ts:12) | see route.ts:32 | no | field checks in the handler | no | none in route |
| app/api/deals/[id]/route.ts | GET,PATCH,DELETE | yes. Session (route.ts:3) | see route.ts:34 | yes, after the auth check (route.ts:21) | field checks in the handler | no | none in route |
| app/api/deals/[id]/send-to-docusign/route.ts | POST | yes. Session (route.ts:13) | see route.ts:88 | yes, after the auth check (route.ts:163) | field checks in the handler | no | none in route |
| app/api/deals/[id]/setup-intent/route.ts | POST | yes. Session (route.ts:24) | see route.ts:56 | yes, after the auth check (route.ts:96) | field checks in the handler | no | none in route |
| app/api/deals/import/route.ts | POST | split. past_campaign requires a session (route.ts:153). PDF (route.ts:32) and manual JSON (route.ts:128) do not | past_campaign: profile.role brand or agency (route.ts:158). Other branches: none | no | field checks in the handler | no | PDF 10MB (route.ts:41). past_campaign 10MB and 2000 rows. Manual JSON has no cap |
| app/api/deals/route.ts | GET,POST | yes. Session (route.ts:3) | no explicit id compare in the route. User-scoped client calls are limited by RLS | no | field checks in the handler | no | none in route |
| app/api/imports/past-campaigns/route.ts | POST | yes. Session (route.ts:14) | no explicit id compare in the route. User-scoped client calls are limited by RLS | no | field checks in the handler | no | none in route |
| app/api/invoices/[id]/pdf/route.ts | GET | yes. Session (route.ts:10) | no explicit id compare in the route. User-scoped client calls are limited by RLS | no | field checks in the handler | no | none in route |
| app/api/invoices/[id]/route.ts | GET,PATCH | yes. Session (route.ts:11) | no explicit id compare in the route. User-scoped client calls are limited by RLS | no | field checks in the handler | no | none in route |
| app/api/invoices/generate/route.ts | POST | yes. Session (route.ts:19) | no explicit id compare in the route. User-scoped client calls are limited by RLS | no | field checks in the handler | no | none in route |
| app/api/invoices/pdf/route.ts | POST | no. PDF from the posted JSON. No DB read | none | no | field checks in the handler | no | none in route |
| app/api/invoices/route.ts | GET | yes. Session (route.ts:7) | no explicit id compare in the route. User-scoped client calls are limited by RLS | no | field checks in the handler | no | none in route |
| app/api/invoices/send/route.ts | POST | yes. Session (route.ts:30) | no explicit id compare in the route. User-scoped client calls are limited by RLS | no | field checks in the handler | no | none in route |
| app/api/outreach/[token]/accept-counter/route.ts | POST | yes. Session getAuthenticatedUser (route.ts:38) | brand profile must match outreach.brand_profile_id (route.ts:49) | yes, after the auth check (route.ts:67) | field checks in the handler | no | none in route |
| app/api/outreach/[token]/accept/route.ts | POST | yes. Outreach JWT via resolveOutreachOr400 (_shared.ts:54). No login session | payload.outreach_id. Token does not expire (lib/io/tokens.ts:117) | no | field checks in the handler | yes. In-process 5 per 60s per outreach (_shared.ts:63). Not shared across instances | none in route |
| app/api/outreach/[token]/counter/route.ts | POST | yes. Outreach JWT via _shared.ts:54 | payload.outreach_id. Token does not expire | no | field checks in the handler | yes. In-process 5 per 60s per outreach (_shared.ts:63) | none in route |
| app/api/outreach/[token]/decline/route.ts | POST | yes. Outreach JWT via _shared.ts:54 | payload.outreach_id. Token does not expire | no | field checks in the handler | yes. In-process 5 per 60s per outreach (_shared.ts:63) | none in route |
| app/api/outreach/draft/route.ts | POST | yes. Session (route.ts:12) | no explicit id compare in the route. User-scoped client calls are limited by RLS | no | field checks in the handler | no | none in route |
| app/api/outreach/route.ts | POST | yes. Session (route.ts:8) | see route.ts:107 | yes, after the auth check (route.ts:147) | field checks in the handler | no | none in route |
| app/api/payouts/early/route.ts | POST | yes. Session (route.ts:40) | show_profiles.user_id must equal the session user (route.ts:96), checked before the transfer | yes, after the auth check (route.ts:58) | field checks in the handler | no | none in route |
| app/api/reps/deals/route.ts | GET | yes. requireAgent (route.ts:7) | agent id from the session | no | field checks in the handler | no | none in route |
| app/api/reps/roster/route.ts | GET | yes. requireAgent (route.ts:7) | agent id from the session | no | field checks in the handler | no | none in route |
| app/api/reps/shows/[showId]/route.ts | GET | yes. requireAgent (route.ts:10) | agent id from the session | no | field checks in the handler | no | none in route |
| app/api/show-profile/complete/route.ts | POST | yes. Session (route.ts:4) | no explicit id compare in the route. User-scoped client calls are limited by RLS | no | field checks in the handler | no | none in route |
| app/api/show-profile/lookup/route.ts | POST | yes. Session (route.ts:29) | no explicit id compare in the route. User-scoped client calls are limited by RLS | no | field checks in the handler | no | none in route |
| app/api/show-profile/media-kit/route.ts | POST | yes. Session (route.ts:14) | preview only, stored later on the caller's show profile | no | field checks in the handler | no | 2_000_000 bytes (route.ts:26). No MIME allowlist. PDF inflate is uncapped |
| app/api/show-profile/route.ts | GET,PUT | yes. Session (route.ts:3) | no explicit id compare in the route. User-scoped client calls are limited by RLS | no | field checks in the handler | no | none in route |
| app/api/show-surfaces/route.ts | GET,PUT | yes. Session (route.ts:4) | no explicit id compare in the route. User-scoped client calls are limited by RLS | no | field checks in the handler | no | none in route |
| app/api/shows/[id]/claim/route.ts | POST | yes. Session (route.ts:17) | see route.ts:40 | no | field checks in the handler | no | none in route |
| app/api/shows/[id]/enrich/route.ts | POST | yes. Session (route.ts:38) | see route.ts:56 | no | field checks in the handler | no | none in route |
| app/api/shows/[id]/route.ts | GET,PATCH | yes. Session (route.ts:15) | see route.ts:31 | no | field checks in the handler | no | none in route |
| app/api/shows/enrich-batch/route.ts | POST | yes. Session (route.ts:37) | see route.ts:63 | no | field checks in the handler | no | none in route |
| app/api/shows/import/route.ts | POST | yes. Session auth.getUser (route.ts:15) | isShowsAdmin or profile.role agent (route.ts:22). Body agent id is ignored | no | field checks in the handler | no | none. CSV is read with file.text() with no size or row cap (route.ts:37) |
| app/api/shows/route.ts | GET,POST | yes. Session | GET: public fields unless owner, getVerifiedProfileTies, agent roster, or a deal (SA-25). POST: agent or shows admin | yes, after the auth check, for the tie and deal reads | field checks in the handler | no | none in route |
| app/api/stripe/config/route.ts | GET | no. Returns the Stripe publishable key | none | no | field checks in the handler | no | none in route |
| app/api/stripe/connect/create-account/route.ts | POST | yes. Session (route.ts:8) | no explicit id compare in the route. User-scoped client calls are limited by RLS | yes, after the auth check (route.ts:13) | field checks in the handler | no | none in route |
| app/api/stripe/connect/onboarding-link/route.ts | POST | yes. Session (route.ts:14) | no explicit id compare in the route. User-scoped client calls are limited by RLS | yes, after the auth check (route.ts:19) | field checks in the handler | no | none in route |
| app/api/stripe/connect/status/route.ts | GET | yes. Session (route.ts:8) | no explicit id compare in the route. User-scoped client calls are limited by RLS | yes, after the auth check (route.ts:13) | field checks in the handler | no | none in route |
| app/api/stripe/customer/create/route.ts | POST | yes. Session (route.ts:8) | no explicit id compare in the route. User-scoped client calls are limited by RLS | yes, after the auth check (route.ts:13) | field checks in the handler | no | none in route |
| app/api/stripe/payment-method/[id]/route.ts | DELETE | yes. Session (route.ts:13) | no explicit id compare in the route. User-scoped client calls are limited by RLS | yes, after the auth check (route.ts:18) | field checks in the handler | no | none in route |
| app/api/stripe/payment-method/list/route.ts | GET | yes. Session (route.ts:8) | no explicit id compare in the route. User-scoped client calls are limited by RLS | yes, after the auth check (route.ts:13) | field checks in the handler | no | none in route |
| app/api/stripe/payment-method/setup-intent/route.ts | POST | yes. Session (route.ts:12) | no explicit id compare in the route. User-scoped client calls are limited by RLS | yes, after the auth check (route.ts:17) | field checks in the handler | no | none in route |
| app/api/v1/actions/[id]/route.ts | GET | yes. Bearer API key via withApiRead (lib/api/v1/handler.ts:42), read scope | brandId from the key. Another brand's id is 404 | no | thin | yes. enforceApiRateLimit 60/min inside the wrapper | none in route |
| app/api/v1/actions/route.ts | GET | yes. Bearer API key via withApiRead (lib/api/v1/handler.ts:42), read scope | brandId from the key. Another brand's id is 404 | no | thin | yes. enforceApiRateLimit 60/min inside the wrapper | none in route |
| app/api/v1/campaigns/[id]/plan/route.ts | GET | yes. Bearer API key via withApiRead (lib/api/v1/handler.ts:42), read scope | brandId from the key. Another brand's id is 404 | no | thin | yes. enforceApiRateLimit 60/min inside the wrapper | none in route |
| app/api/v1/campaigns/[id]/route.ts | GET | yes. Bearer API key via withApiRead (lib/api/v1/handler.ts:42), read scope | brandId from the key. Another brand's id is 404 | no | thin | yes. enforceApiRateLimit 60/min inside the wrapper | none in route |
| app/api/v1/campaigns/[id]/scores/route.ts | GET | yes. Bearer API key via withApiRead (lib/api/v1/handler.ts:42), read scope | brandId from the key. Another brand's id is 404 | no | thin | yes. enforceApiRateLimit 60/min inside the wrapper | none in route |
| app/api/v1/campaigns/route.ts | GET,POST | yes. Bearer API key via withApiWrite (lib/api/v1/handler.ts:92). Scope is the write scope named in the file | brandId from the key. Writes record a pending action and do not run the campaign | no | thin | yes. enforceApiRateLimit 60/min inside the wrapper | 64KB (lib/api/v1/handler.ts:81) |
| app/api/v1/deals/[id]/route.ts | GET | yes. Bearer API key via withApiRead (lib/api/v1/handler.ts:42), read scope | brandId from the key. Another brand's id is 404 | no | thin | yes. enforceApiRateLimit 60/min inside the wrapper | none in route |
| app/api/v1/deals/route.ts | GET | yes. Bearer API key via withApiRead (lib/api/v1/handler.ts:42), read scope | brandId from the key. Another brand's id is 404 | no | thin | yes. enforceApiRateLimit 60/min inside the wrapper | none in route |
| app/api/v1/health/route.ts | GET | yes. Bearer API key resolveApiRequest (lib/api/auth.ts:94), then read scope | key brand_id must match a profiles row | no | field checks in the handler | yes. enforceApiRateLimit 60/min (lib/api/rate-limit.ts:42). Failure is 500, not a bypass | none in route |
| app/api/v1/openapi.json/route.ts | GET | no. Public API description | none | no | thin | no | none in route |
| app/api/v1/outreach/route.ts | POST | yes. Bearer API key via withApiWrite (lib/api/v1/handler.ts:92). Scope is the write scope named in the file | brandId from the key. Writes record a pending action and do not run the campaign | no | thin | yes. enforceApiRateLimit 60/min inside the wrapper | 64KB (lib/api/v1/handler.ts:81) |
| app/api/v1/shows/[id]/route.ts | GET | yes. Bearer API key via withApiRead (lib/api/v1/handler.ts:42), read scope | brandId from the key. Another brand's id is 404 | no | thin | yes. enforceApiRateLimit 60/min inside the wrapper | none in route |
| app/api/v1/shows/route.ts | GET | yes. Bearer API key via withApiRead (lib/api/v1/handler.ts:42), read scope | brandId from the key. Another brand's id is 404 | no | thin | yes. enforceApiRateLimit 60/min inside the wrapper | none in route |
| app/api/view-mode/clear/route.ts | GET | no. Deletes the view-as cookie and redirects (route.ts:11) | none | no | thin | no | none in route |
| app/api/view-mode/route.ts | POST | yes. Session auth.getUser (route.ts:17) | brand or show mode requires that profile (route.ts:42 and route.ts:50) | no | field checks in the handler | no | none in route |
| app/api/webhooks/docusign/route.ts | POST | yes. HMAC verifyDocuSignSignature (route.ts:261) before any write. No session | deal looked up by envelope id after the signature check (route.ts:288) | yes, after the auth check (route.ts:55) | field checks in the handler | no | none in route |
| app/api/webhooks/stripe/route.ts | POST | yes. stripe-signature checked in verifyAndHandleStripeEvent (lib/stripe/webhook.ts:73). No session | Stripe event, not a user id | no | thin | no | none in route |


### Routes that do not require a login

These are reachable with no session because `proxy.ts` does not gate `/api`.

| Route | What protects it |
| --- | --- |
| POST /api/campaigns/outreach/generate | Nothing. See SA-08 |
| POST /api/campaigns/outreach/send | Nothing. See SA-03 |
| POST /api/deals/import (PDF and manual JSON) | Nothing on those branches. past_campaign is gated. See SA-07 |
| POST /api/invoices/pdf | Nothing. The body is the invoice. See SA-23 |
| GET /api/deals/[id]/docusign-return | Redirect only. No write |
| GET /api/stripe/config | Returns the publishable key on purpose |
| GET /api/v1/openapi.json | Public description |
| GET /api/view-mode/clear | Cookie clear plus redirect. See SA-12 |
| POST /api/auth/login/otp and /verify | Durable OTP limits. No session yet |
| GET /api/auth/magic | Magic-link JWT, 24h |
| POST /api/auth/magic/start | Outreach JWT. Posted email is not the outreach contact. See SA-09 |
| POST /api/outreach/[token]/accept, /counter, /decline | Outreach JWT, no expiry. See SA-11 |
| POST /api/webhooks/stripe | Stripe signature |
| POST /api/webhooks/docusign | HMAC |
| GET /api/cron/* | Bearer `CRON_SECRET` |
| /api/v1 except openapi.json | Bearer API key |

## 3. Uploads

| Path | Auth | Size | Type | Parsing |
| --- | --- | --- | --- | --- |
| POST /api/deals/import PDF branch (`route.ts:32`) | none | 10MB (`route.ts:41`) | `application/pdf` only | Whole file is base64-sent to the model. No page or inflate cap |
| POST /api/deals/import manual JSON (`route.ts:128`) | none | none | JSON | Local validation only. No model call |
| POST /api/deals/import `mode=past_campaign` | session, brand or agency (`route.ts:153`) | 10MB, 2000 data rows | extension plus MIME | XLSX rejected before parse when inflated entries exceed 32MB (`lib/imports/xlsx-limit.ts`), including a zip header that under-reports size. First sheet only |
| POST /api/imports/past-campaigns | session, brand or agency | uses the parsed drafts | n/a | Saves under the session `brand_id`. A body `brand_id` is ignored |
| POST /api/shows/import | session, agent role or shows admin (`route.ts:22`) | none (`route.ts:37` reads `file.text()`) | CSV text or a JSON `shows` array | No row cap. Names are stored as text. A cell that starts with `=`, `+`, `-`, or `@` is not neutralized. See SA-14 |
| POST /api/show-profile/media-kit | session (`route.ts:14`) | 2,000,000 bytes (`route.ts:26`) | none | PDF streams are inflated with `inflateSync` and no output cap (`lib/shows/media-kit-text.ts:68`). Non-PDF bytes are decoded as UTF-8. Result is sliced to 20,000 chars after inflate. See SA-13 |
| POST /api/v1 writes | API key | 64KB (`lib/api/v1/handler.ts:81` and the byte length after read) | `application/json` | Pending action only |
| DocuSign signed PDF | HMAC webhook, then service role | bucket limit | not checked in the bucket | Upload to `signed-ios` |

Storage, live:

- Bucket `signed-ios`: `public` false, file size limit 52428800 (50MB), `allowed_mime_types` null.
- `storage.objects` and `storage.buckets` have RLS on. The only objects policy is `Service role full access to signed-ios`, `ALL`, `service_role`, `bucket_id = 'signed-ios'`.
- `anon` and `authenticated` still have `SELECT, INSERT, UPDATE, DELETE` on `storage.objects` and `storage.buckets`. With RLS on and no policy for them, those calls are denied. The grants are latent.

No other bucket exists.

## 4. Auth and sessions

Sign-in that the product describes as primary is a 6-digit email code: `POST /api/auth/login/otp` and `POST /api/auth/login/otp/verify`. Limits live in `login_otp_consume` (5 sends per email per hour, 60 seconds between sends, 20 requests per IP per hour, lock after 5 wrong codes). The code is stored as a hash. The HTTP answer does not say whether the address has an account.

The login page also still offers a password (`app/(auth)/login/page.tsx:37`, `signInWithPassword`). There is no `signInWithOAuth` call in the repo. MFA enrollment is absent in application code. Email templates for MFA enrolled and unenrolled exist in `lib/email/templates/auth.ts`. The Supabase advisor reports leaked-password protection disabled. See SA-18.

Sessions are Supabase SSR cookies. Server code uses `getUser()`, which checks the token with the Auth server. `getAuthenticatedUser` returns null when that check fails.

Magic links are still implemented:

- `GET /api/auth/magic` verifies `MAGIC_LINK_TOKEN_SECRET` (24h `exp`). A matching profile is signed in. A missing profile is created with `email_confirm: true` and `role` `show` (`route.ts:49`), then `generateLink` issues a `token_hash` for `/callback`.
- `POST /api/auth/magic/start` mints that token for the email in the body and sends it. See SA-09.
- Outreach pitch URLs use a separate HS256 secret, `OUTREACH_TOKEN_SECRET`. `verifyOutreachToken` checks the signature and `v === 1`. It does not check `iat` or an expiry (`lib/io/tokens.ts:117`).

Admin:

- `isInternalAdmin` compares the email to `INTERNAL_ADMIN_EMAILS` (`lib/auth/admin.ts:9`). It is not a `profiles.role` value. The live role check does not allow `admin`.
- `isShowsAdmin` is true for that allowlist or for `profiles.role === 'admin'` (`lib/shows/can-edit-show.ts:45`). The role branch cannot be set through RLS because of `profiles_role_check`.
- `POST /api/admin/test-login` is allowlist plus a `TEST_ACCOUNTS` key, then `generateLink`. It still sets the unsigned `tslate_impersonation_origin` cookie (`route.ts:117`). `POST /api/admin/return-to-admin` does not read that cookie. It hashes an opaque return token and reloads the admin with `getUserById` before `isInternalAdmin` (`route.ts:108`). See SA-20.

`/callback` is the only auth callback route. This audit did not re-walk that handler. The standing rule is `token_hash` for admin-minted links and a same-origin `next`.

### Paths `proxy.ts` leaves open

`proxy.ts:54` through `proxy.ts:69`:

- `/`, `/for-shows`, `/login`, `/login/show`, `/signup`, `/callback`, `/forgot-password`, `/reset-password`
- `/api/v1` and every other `/api/` path
- `/outreach/` (pitch page)
- `/auth/magic`
- `/sitemap.xml`, `/robots.txt`, `/opengraph-image`

Everything else with no user redirects to `/login`. The `next` parameter there is the pathname the proxy itself set.

## 5. Secrets and server boundaries

Client and `NEXT_PUBLIC_` names seen in app code:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`

Those are publishable or site configuration. `lib/supabase/client.ts` uses the URL and the anon key. No `"use client"` file reads `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, or `DOCUSIGN_RSA_PRIVATE_KEY`.

`GET /api/stripe/config` returns `STRIPE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. That value is a publishable key.

`POST /api/stripe/payment-method/setup-intent` logs the first 8 characters of `STRIPE_SECRET_KEY` (`route.ts:9`). The value is not in this document. See SA-21.

Server-only names, cited and not printed: `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `DOCUSIGN_RSA_PRIVATE_KEY`, `DOCUSIGN_WEBHOOK_SECRET`, `CRON_SECRET`, `OUTREACH_TOKEN_SECRET`, `MAGIC_LINK_TOKEN_SECRET`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `INTERNAL_ADMIN_EMAILS`.

Cron:

- `GET /api/cron/pooled-priors` rejects a missing `CRON_SECRET`.
- `GET /api/cron/deal-timeouts` (`route.ts:33`) and `GET /api/cron/conversion-alerts` (`route.ts:35`) allow the request when `CRON_SECRET` is unset and `NODE_ENV` is not `production`. See SA-16.

Webhooks:

- Stripe: `verifyAndHandleStripeEvent` requires `STRIPE_WEBHOOK_SECRET` and a `stripe-signature` header, then `constructEvent` (`lib/stripe/webhook.ts:63`). The route returns `err.message` to the caller (`app/api/webhooks/stripe/route.ts:42`). A verified event whose handler throws is still acknowledged 200 (`lib/stripe/webhook.ts:55`). See SA-17.
- DocuSign: `verifyDocuSignSignature` is constant-time and fails closed when the secret or the header is missing (`route.ts:266` returns 401). The route passes only the first signature header (`route.ts:43`). See SA-21.

`lib/stripe` (read only, not edited):

- `chargeForEpisode` loads `profiles.platform_fee_percentage` at charge time (`lib/stripe/payment-intent.ts:193` and `:258`). `computeApplicationFeeCents` accepts `0` and rejects a fee outside 0 to 1 (`:84`).
- An existing `payments` row for the same deal and line, with `status` other than `failed` and a non-null `stripe_payment_intent_id`, is returned without calling Stripe (`:224`).
- The PaymentIntent amount is gross plus the fee. The fee snapshot is written on the payment row.

`lib/payouts` (read only, not edited):

- `transferPayoutForPayment` returns null when `settled_at` is null (`lib/payouts/transfer.ts:180`).
- The transfer sends `source_transaction` from the PaymentIntent's latest charge (`:242`). A missing PaymentIntent id throws (`:202`).
- The transfer amount is `payments.gross_amount_cents` on the row (`:206`), not an amount re-read from the Stripe charge. See SA-17.
- `POST /api/payouts/early` checks `show_profiles.user_id` against the session (`route.ts:96`) before `transferEarlyPayoutForPayment`.

`lib/billing` and `lib/airchecks` were not edited. Billing upgrade and downgrade routes take the session user id. Aircheck routes are `isInternalAdmin`.

## 6. Findings

Ranked. Each item has a location, the exploit in one sentence, a fix, and a lane. Lanes: S-D isolation tests, S-E rate limits, S-F audit log, S-G grants and definer functions, S-H/S-I money controls (the Phase 2 money lane), or new.

### Critical

**SA-01. A brand can set their own platform fee to zero.** `profiles` update policy (section 1) and `lib/stripe/payment-intent.ts:258`. A signed-in user `PATCH`es `/rest/v1/profiles` and sets `platform_fee_percentage` to 0, which the column allows, and the next `chargeForEpisode` snapshots that 0 and adds no platform fee. Fix: revoke column `UPDATE` on `platform_fee_percentage`, `plan`, `subscription_status`, `stripe_customer_id`, `stripe_subscription_id`, and `stripe_connect_account_id` from `authenticated`, and reject changes in a trigger the way `is_managed` already does. Lane: S-H/S-I. Cover it with an S-D test that the user JWT cannot change the fee.

Status: fixed by H1 (commit 632f420, migration 072_lock_money_columns). Applied and verified on 2026-10-26.

**SA-02. A deal participant can insert a payment row that skips the charge.** `payments` insert policy (section 1) and `lib/stripe/payment-intent.ts:145`. The caller inserts a `payments` row for their invoice with `status` `pending` and any non-null `stripe_payment_intent_id`, and `findExistingPayment` returns that row so Stripe is never called. Fix: remove the `authenticated` insert policy and grant on `payments`. Only `service_role` should insert payments. Lane: S-H/S-I, with an S-D test.

Status: fixed by H1 (commit 632f420, migration 072_lock_money_columns). Applied and verified on 2026-10-26.

**SA-03. Unauthenticated outreach send is an open mailer.** `app/api/campaigns/outreach/send/route.ts:15`. Anyone who can reach the route posts drafts and `resend.emails.send` delivers them from the outreach From address, with the caller's subject and body, and with no session, no recipient allowlist, and no cap on the array (`route.ts:68`). Fix: require a session and ownership of the campaign, cap the draft count and body size, and rate limit. Lane: new (public-route auth). Add an S-E limit even after auth.

Status: fixed by H1 (commit 632f420, migration 072_lock_money_columns). Applied and verified on 2026-10-26.

### High

**SA-04. Deal participants can rewrite commercial terms through the Data API.** Policies on `deals`, `insertion_orders`, `io_line_items`, `invoices`, and `outreaches` (section 1). `chargeForEpisode` bills `io_line_items.gross_rate` (`lib/stripe/payment-intent.ts:266`). A participant changes `gross_rate`, deal `status`, or `payment_method_id` with the user JWT, and the route-level status machine in `app/api/deals/[id]/route.ts` never runs. Fix: authenticated `UPDATE` on those tables should be limited to non-money columns, or removed so only the service role writes money and status. Lane: S-H/S-I and S-D.

**SA-05. The same profile update sets plan, role, and Stripe ids.** `profiles` policy and `profiles_plan_check` / `profiles_role_check` (section 1). The caller sets `plan` to `operator` or `agency` and `subscription_status` to `active` without a Stripe subscription, sets `role` to `agent` and then passes `POST /api/shows/import` (`route.ts:22`), or points `stripe_customer_id` and a deal's `payment_method_id` at ids they have learned. `is_managed` stays protected. `role` cannot become `admin`. Fix: same column lock as SA-01. Lane: S-H/S-I for the Stripe columns, S-D for `role` and `plan`.

**SA-06. Anon can execute a definer function that reads deal CPMs.** `public.get_avg_negotiated_cpm(uuid)`, owner `postgres`, `SECURITY DEFINER`, `EXECUTE` granted to `anon` and `PUBLIC`. Advisor `anon_security_definer_function_executable`. The body averages `deals.cpm_rate` for a show once three rows match, and RLS does not apply. Fix: `REVOKE EXECUTE FROM PUBLIC, anon, authenticated`, set `search_path`, and switch to invoker if a signed-in caller should ever see it. Lane: S-G.

**SA-07. The IO PDF import calls the model with no session.** `app/api/deals/import/route.ts:32` through the Anthropic call at `route.ts:64`. A 10MB PDF is enough. The `past_campaign` branch below it is authenticated. Fix: require the same session and role as `handlePastCampaignImport` before the model call, and rate limit. Lane: S-E.

**SA-08. Outreach generation calls the model with no session.** `app/api/campaigns/outreach/generate/route.ts:9`. The body is a campaign object and there is no auth check and no body cap. Fix: require a session and a campaign the caller owns. Lane: S-E.

**SA-09. A pitch token sends a login email to any address.** `app/api/auth/magic/start/route.ts:40` and `:53`. The outreach JWT has no expiry, the body email is not compared to `sent_to_email`, `bypassManagedReroute` is true, and there is no rate limit. The message is a real Taylslate login link. `GET /api/auth/magic` will create or sign in that email when the link is opened (`route.ts:49`). Fix: send only to the outreach contact, expire the pitch token, and rate limit. Lane: new (public-route auth) and S-E.

**SA-25. GET /api/shows returned contact and rate card to any signed-in brand.** `app/api/shows/route.ts` GET, found during U1 (PR #52). A brand with no relationship to the show received `contact` (name, email, method) and `rate_card`, plus sponsors, slots, and income demographics. The U1 search client drops those fields in the browser after the response is already sent. Fix: build the JSON from an allowlist on the server. Return contact and rate card only to the owner, a verified tie from `getVerifiedProfileTies`, an agent's own roster, or a brand or agency with a deal on that show. Lane: S-K.

Status: fixed for `GET /api/shows` by S-K. `GET /api/shows/[id]` and `GET /api/v1/shows` still return the full show. Those routes are outside this job.

### Medium

**SA-10. Authenticated still has write grants that no policy allows.** Section 1, latent-grant list, including `payments` `UPDATE`/`DELETE`, `payouts` insert/update/delete, and the pattern-library tables. Dropping RLS, or adding a permissive policy later, turns those grants into writes. `show_sponsors` is `SELECT` `true` for role `public`, and anon is stopped only by the missing grant. Storage objects have the same shape: DML grants for anon and authenticated, RLS on, no policy for them. Fix: revoke `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, and `TRIGGER` from `authenticated` where the app does not write as the user, and revoke the storage DML grants the policies do not use. Lane: S-G.

**SA-11. The pitch token is a bearer credential with no expiry.** `lib/io/tokens.ts:117`. Anyone who holds the URL can accept, counter, or decline until the outreach is no longer open, and the in-process limiter (`_shared.ts:63`) resets on a new instance. Fix: add `exp`, and keep the S-E limit in a shared store. Lane: S-D for the token scope, S-E for the limiter.

**SA-12. Two redirects accept a `next` that leaves the site.** Password login uses `searchParams.get("next")` and `router.push` (`app/(auth)/login/page.tsx:55`) and does not call `safeLoginNext`. The OTP path does (`lib/auth/login-magic.ts:28`). `GET /api/view-mode/clear` accepts any `next` that starts with `/` (`route.ts:14`), which includes a protocol-relative `//` URL. Fix: use `safeLoginNext` on both. Lane: new (public-route auth).

**SA-13. Media-kit PDF inflate has no output cap.** `lib/shows/media-kit-text.ts:68`, called from an authenticated route capped at 2MB compressed and 40 streams. One FlateDecode stream can expand far past that before the 20,000 character slice. Fix: inflate with a max output, as `lib/imports/xlsx-limit.ts` already does for XLSX. Lane: S-E.

**SA-14. Show CSV import has no size or row cap.** `app/api/shows/import/route.ts:37`. A signed-in agent (or a caller who reached `role` `agent` through SA-05) can post a very large file, and formula-looking names are stored unchanged. Fix: cap bytes and rows, and reject or prefix formula cells. Lane: S-E.

**SA-15. Authenticated spend routes have no rate limit and no body cap.** Examples: `POST /api/campaigns/[id]/discover`, `POST /api/campaigns/[id]/interpret`, enrich routes. Discovery also fails open when the lock table errors (`app/api/campaigns/[id]/discover/route.ts:39`), so two requests can both run the model. `/api/v1` is the exception: 60 per minute per key, and a failed counter throws (`lib/api/rate-limit.ts:56`). Fix: a shared limit and a body cap on model and enrich routes, and fail closed on the discovery lock. Lane: S-E.

**SA-16. Two crons treat a missing secret as success outside production.** `app/api/cron/deal-timeouts/route.ts:33` and `app/api/cron/conversion-alerts/route.ts:35`. A deployment whose `NODE_ENV` is not `production` and whose `CRON_SECRET` is empty will run the job, including cancellation and mail. `pooled-priors` already fails closed. Fix: use that same check. Lane: new (public-route auth).

**SA-17. Money webhooks and payouts trust the row and the HTTP status.** `app/api/webhooks/stripe/route.ts:42` returns the verifier error string (the text names `STRIPE_WEBHOOK_SECRET` when it is unset, and does not include the secret). `lib/stripe/webhook.ts:55` acknowledges a verified event with 200 when the handler throws, so Stripe will not retry a failed transfer. `lib/payouts/transfer.ts:206` transfers `gross_amount_cents` from the row. Fix: return a fixed error body, record a durable retry row when the handler fails (lane S-F), and cap the transfer at the Stripe charge amount (lane S-H/S-I).

**SA-18. Password login is still enabled, and MFA is not.** `app/(auth)/login/page.tsx:37`. The advisor reports leaked-password protection disabled (`auth_leaked_password_protection`). Nothing in the app calls an MFA enroll API. Fix: remove the password form if codes are the only sign-in, turn on leaked-password protection while any password remains, and decide whether MFA is required for admin and payout actions. Lane: new (session hardening).

### Low

**SA-19. Extra EXECUTE grants on public and private functions.** `persist_confirmation`, `persist_interpretation`, `persist_refinement`, and `reset_monthly_campaigns` are invoker and executable by anon. RLS or missing table grants make them fail, and `reset_monthly_campaigns` can still zero the caller's own `campaigns_this_month` when `campaigns_reset_at` is before this month. `private.show_profiles_guard_podscan_id` is `SECURITY DEFINER` and executable by anon and authenticated. `update_updated_at`, `get_avg_negotiated_cpm`, and `reset_monthly_campaigns` have a mutable search_path (advisor). Fix: revoke anon and authenticated execute except on functions the browser must call (`user_owns_show`, `normalize_show_match_key`). Lane: S-G. SA-06 is the definer case that matters now.

**SA-20. The impersonation origin cookie is still written.** `app/api/admin/test-login/route.ts:117` stores `adminId` and `adminEmail` in an unsigned cookie. The return route does not trust it (`route.ts:13`). Fix: stop setting the cookie so a later reader cannot. Lane: S-F, because the hashed return token is already the audit record.

**SA-21. DocuSign verification uses one header, and a setup-intent log keeps a key prefix.** The webhook reads `x-docusign-signature-1` only (`app/api/webhooks/docusign/route.ts:43`). A second active secret in `signature-2` would fail closed, which is safe and would drop events. `setup-intent` logs 8 characters of `STRIPE_SECRET_KEY` (`route.ts:9`). Fix: try each signature header the helper already documents, and log a boolean instead of a prefix. Lane: new (webhook hygiene).

**SA-22. Signed-IO storage allows any MIME, up to 50MB.** Bucket `signed-ios`, `allowed_mime_types` null. Writes are service role after the DocuSign HMAC check. Fix: restrict the bucket to `application/pdf`. Lane: S-G.

**SA-23. Invoice PDF generation is unauthenticated.** `app/api/invoices/pdf/route.ts:7`. It does not read the database. `invoice_number` is placed in `Content-Disposition` after whitespace is replaced (`route.ts:20`), so a quote or newline in that field can break the header. Fix: require a session, or delete the route if nothing calls it, and strip header metacharacters. Lane: new (public-route auth).

**SA-24. Outcomes insert does not check booking ownership.** `outcomes` insert policy, `auth.uid() = user_id` only. A caller can attach an outcome row to a `booking_id` they do not own. `refresh_pooled_deal_priors` will later read `outcomes` by `booking_id`. Fix: require the booking to be the caller's deal. Lane: S-D.

## What this pass did not do

No exploit was sent against production. Policies and grants were read, not probed with a user JWT. `lib/stripe`, `lib/payouts`, `lib/billing`, and `lib/airchecks` were read and not edited. Screenshot proof does not apply: no page or component was changed.
