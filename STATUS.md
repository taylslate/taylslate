# Taylslate — STATUS

_Volatile snapshot. Updated July 16, 2026 — **accept-flow launch-blocker cluster SHIPPED + Codex-clean (three passes) + LIVE-VERIFIED July 16** — the real outreach→accept loop was driven end-to-end in prod via the **accept-path seeding tool** (`POST /api/admin/seed-outreach`, both variants) and torn down clean. 1003 tests (91 files), tsc/eslint/`next build` clean. Migration 031 (`shows.is_discoverable`) applied + introspected. Resolved the parked product decision: a non-catalog accept materializes a **non-discoverable** `shows` row. Fixes #1 (accept NOT-NULL deal creation, brand_id/show_id + at-accept-time creation + onboarding backfill), #2 (show-side deal visibility), #3 (flight-date off-by-one) — plus a pre-existing `deals/[id]` authz-bypass byproduct. Commits `e3c09e7`/`7642808`/`bdca1a9`/`e971656`/`a3b1856` (+ this doc commit). **Live verify (July 16):** §1 catalog — deal created at accept, brand + show both see it, flight dates correct on deal view + IO; §2 non-catalog — materialize + backfill confirmed via real onboarding; teardown cascade clean incl. the materialized `shows` row. Codex verdict LAUNCH-READY, now live-confirmed. Brand auth hardening COMPLETE (L1-3, verified live July 8-9). Impersonation + seeding tools COMPLETE (verified live July 7). Wave 14 Phase 2D COMPLETE._

## Most recent — accept-flow live-verify FOLLOW-UP FIXES (pitch date, onboarding return, cadence gap, IO PDF date) SHIPPED + Codex-clean (July 16, 2026)

Four issues surfaced during the July 16 live-verify, out of the accept cluster's scope, now fixed. Migration **032** required (cadence CHECK widen) — applied + introspected before the dependent code. **1021 tests (94 files)**, tsc/eslint/`next build` clean. Commits `1e2d97a` (#1-3) + `9430bd8` (#4) + the Codex-resolution commit. **Codex-reviewed** (all four fixes): no High; 3 Medium + 2 Low — resolved 3 Medium + 1 Low, 1 Low accepted (see below).

- **#4 IO PDF flight + post date off-by-one (was flagged, now fixed).** The signed IO is the document of record and must match the pitch/deal/email. `lib/pdf/io-generator.ts` got the targeted date-only split: flight + line-item post dates use `formatDateOnly` (UTC); `created_at`/`signed_at` keep the local-zone `fmtDate`. Codex review then surfaced the same bug class in the **legacy** IO path — fixed too: `lib/pdf/io-pdf.ts` (post_date → `formatDateOnly`), and `derivePostDates` + the legacy `generate` route both switched to **UTC date arithmetic** (`setUTCDate`, not `setDate`, which could drift a day). Cadence-days map **centralized** into `lib/io/cadence-days.ts` (was duplicated in io-generator + the legacy route, which omitted `multiple_weekly` → silent weekly fallback). Tests: PDF buffer-text assertions + a TZ-independent source-scan pinning the split + exact `derivePostDates` UTC date strings (incl. `multiple_weekly` 3-day spacing).
- **Codex Low accepted (not changed):** migration 032 drops "any CHECK referencing `episode_cadence`" via introspection — Codex noted this could over-drop a hypothetical future cross-field constraint mentioning that column. Kept as-is: the migration is already applied in prod (editing the file would diverge it from what ran), no such constraint exists, and introspection-drop is the *safer* choice here vs. guessing the unnamed original constraint's name (the naming trap). Revisit only if a multi-column `episode_cadence` constraint is ever added.

- **#1 pitch-page flight-date off-by-one (code-only).** The Layer-3 fix left the public pitch page (`app/outreach/[token]/pitch-client.tsx`) with its own timezone-naive `fmtDate`, so it rendered date-only flight values a day early (Jul 29 vs Jul 30). Extracted a single source of truth — **`lib/format/date-only.ts` → `formatDateOnly`** (UTC, matching the Layer-3 options) — and routed every date-only render site through it: pitch page, `Wave12DealClient` (flight only; its `*_signed_at`/`cancelled_at` timestamp formatter left alone), legacy deal view, `IOPreview` post date, and the **outreach EMAIL** (`lib/email/templates/outreach.ts` had the identical off-by-one on the same `proposed_flight_*` fields — same customer-facing flow, so a day-early email → day-correct pitch mismatch is now gone). Test `lib/format/date-only.test.ts` pins the exact UTC output + a source-scan guard that the pitch page never reintroduces a local formatter. (The downloadable IO **PDF** had the same off-by-one — now fixed under #4 below.)
- **#2 onboarding→pitch return didn't complete (code-only, two causes).** (a) The pitch return URL was passed as `/onboarding/show?return=<url>`, but the `/onboarding/show` index `redirect()` strips the query string (and the param collided with the edit-flow `?return=summary` sentinel), so it never reached the summary step. (b) Even landing back on the pitch, `isOnboarded` is server-rendered and the App Router served the cached RSC on soft-nav → Accept stayed hidden until a manual refresh. Fix: carry the pitch path in a short-lived HttpOnly cookie (**`lib/auth/onboarding-return.ts`**, `sanitizeReturnPath` open-redirect guard) set at the magic-link landing (`/api/auth/magic`); `/api/show-profile/complete` reads + clears it and returns `redirect_to`; `summary-client` does a **hard** `window.location.assign` so the pitch server component re-runs with `isOnboarded=true` and Accept is immediately actionable. Tests: `sanitizeReturnPath` unit + `complete/route.test.ts` (cookie present/absent/tampered + clear). The old `?return=` query param is gone; `?return=summary` (edit-flow) is now unambiguous.
- **#3 cadence gap — needed migration 032.** Added **`multiple_weekly`** ("A few times a week", 2–4 episodes/week) between `daily` and `weekly`. `episode_cadence` is CHECK-constrained on `show_profiles` (009) + `shows` (001); **migration 032** widens both (drops any check referencing the column by introspection, re-adds a named widened one — the inline checks were unnamed). Applied + introspected July 16 (exactly two rows, both include `multiple_weekly`, no lingering constraints) BEFORE shipping the code: `ShowEpisodeCadence` union, cadence-form option, API `ALLOWED_CADENCES`, summary `CADENCE_LABELS`, and `io-generator` `CADENCE_DAYS` (→3).

## Most recent — accept-path seeding tool (drive the real accept loop live) SHIPPED (July 16, 2026)

Extends the founder seeding tools so the **accept-flow cluster's fixes can be executed live** — the existing `seed-deal` fabricates a finished planning deal *directly*, bypassing the accept path, so the cluster's code had never run under real conditions. Schema-free — **NO migration** (confirmed). **Live-verify ran clean July 16** (both variants + teardown — see the accept-flow SHIPPED section below).

- **`POST /api/admin/seed-outreach`** (same `isInternalAdmin` gate + service-role pattern as `seed-deal`) seeds a `[SEED]` campaign + a **`pending`** outreach carrying a **real HMAC token** (`signOutreachToken` → `/outreach/<token>` verifies exactly like a production send), brand hardwired to `brand1`. `variant` is the only client input:
  - **`catalog`** → seeds a `[SEED]` non-discoverable show; `outreach.show_id` points at it; `sent_to_email` = the onboarded `show1`, so accept sets `show_profile_id` at accept time and the deal is show-visible immediately.
  - **`non_catalog`** → `show_id` null; `show_name` `[SEED]`-prefixed + a fresh `chris+seedotr-<nonce>@taylslate.com` alias (routes to the real inbox, un-onboarded each run), so accept **materializes** a non-discoverable `shows` row (`otr-<id8>` slug, null `show_profile_id`), then onboarding **backfills** the deal.
  - Returns `{ variant, outreachId, acceptUrl, sentToEmail, seededEntityIds }`. Fires an `outreach.seeded` marker event (new `DomainEventType`). No email side effects (never calls the send path).
- **Teardown extended** (`DELETE /api/admin/seed-deal`) to cascade accept-path artifacts: (1) scans **both** `deal.seeded` + `outreach.seeded` markers; (2) a **materialized show** from a non-catalog accept is discovered belt-and-suspenders — `[SEED]` name prefix **OR** its private `otr-<outreachId8>-` slug (scoped to seeded-outreach linkage) — and unioned into the shows delete, so it can never survive teardown. Existing financial-records RESTRICT guard + surviving-deal backstop intact.
- **Verification:** +22 route tests (gating; both variants; accept-URL token verifies via the real secret; teardown cascades outreach→deal→materialized show; markers-only safety; catalog + non-catalog paths). Suite **1003 passing** (91 files), tsc + eslint clean, `next build` green, new route registered. **Live-verify RAN CLEAN July 16** — both variants driven end-to-end in prod, teardown cascade removed the materialized `shows` row (Shows count returned to baseline). One operational gotcha surfaced + resolved: the teardown `DELETE` 403s if the caller's live session is the accept-side account (the `chris+seedotr` alias / impersonated show) rather than an `isInternalAdmin` session — the gate is correct, the fix is to run teardown from the admin session (not a code change).

## Most recent — accept-flow launch-blocker cluster SHIPPED + Codex-clean (3 passes) + LIVE-VERIFIED (July 16, 2026)

The July 7 accept-flow cluster is **fixed, merged to `main`, Codex-clean across three review passes, and LIVE-VERIFIED end-to-end in prod July 16**. A real outreach→accept→onboard→deal-visible→backfill loop ran clean for both variants: §1 catalog (deal created at accept; brand + show both see the deal; flight dates correct on deal view + IO), §2 non-catalog (materialize + backfill confirmed via real onboarding). Teardown cascade clean including the materialized `shows` row. **Launch-done.**

**Resolved product decision:** accepting a NON-catalog outreach **materializes a `shows` row flagged `is_discoverable=false`** (migration 031) — excluded from all shared discovery/catalog reads. Promotion into discovery is a deliberate post-launch flag flip (NOT built). Seeds carry the same flag.

- **Migration 031** — `shows.is_discoverable BOOLEAN NOT NULL DEFAULT TRUE`, idempotent, backfills `[SEED]` shows → FALSE. **Applied + introspected in prod** (column boolean/NOT NULL/default true; all 52 existing shows TRUE) BEFORE any dependent code. No grant block (grandfathered table).
- **#1 (accept NOT-NULL, `e3c09e7`):** both accept paths (`_shared.ts` applyAndNotify + `accept-counter`) set `brand_id`=`brand_profiles.user_id` and `show_id` — catalog `outreach.show_id`, else `resolveOrMaterializeShowIdForOutreach` materializes a non-discoverable row under a **private `otr-<id8>-` slug namespace** (can't hijack or be reused by a catalog show). Deal is created **at accept time even before the show onboards** (`show_profile_id` nullable, `string | null`); `completeShowProfile` → `backfillShowProfileOnAcceptedDeals` links it on onboarding (role=show + single-account-per-email ambiguity guard + `deal.show_profile_backfilled`/`deal.backfill_ambiguous` audit events). Accept is **atomic** — deal created before the outreach flips to `accepted`; accept-counter reconciles a stuck `countered` on retry (`.eq(response_status, countered)` no-op-safe).
- **#2 (show-side visibility, `e3c09e7`):** `getDealsFiltered` honors Wave-12 ownership (`brand_profile_id`/`show_profile_id`) + legacy columns (explicit predicate as defense-in-depth over RLS); deals kanban + dashboard status maps/active-counts extended to the full Wave-12 lifecycle (no throw / no silent-hide on Wave-12-only statuses).
- **#3 (flight-date, `e3c09e7`):** date-only values render in UTC across Agreed Terms, IO document, legacy view; IO line-item generation advances via `setUTCDate`.
- **Security byproduct (Codex, pre-existing — `7642808`):** `deals/[id]` GET/PATCH/DELETE were admin-client reads/mutations with NO ownership check — any authed user could read/mutate any deal by UUID. Now gated by `callerOwnsDeal` (legacy + Wave-12 ownership; 404 to non-owners so UUIDs aren't probeable; new `route.test.ts`). Public `shows/[id]` GET 404s non-discoverable rows.
- **Codex loop:** `e3c09e7` (build) → review found the authz bypass + accept non-atomicity + backfill-email + null-`show_profile_id` + slug-collision → `7642808` (fixes) → re-review PARTIAL on accept-counter reconcile + null guards → `bdca1a9` → final pass RESOLVED, one residual null lookup → `e971656`. **Final verdict: LAUNCH-READY, no new findings.**
- **Verification:** **989 tests** (89 files, +5 authz-gate), tsc + eslint clean (pre-existing warnings only), **`next build` green**. **LIVE-VERIFIED July 16** — real accept loop exercised in prod for both variants (deal-at-accept, brand + show visibility, flight dates on deal view + IO, materialize + backfill via real onboarding, clean teardown). Pushed + Vercel-green. The last launch gate is cleared.

## Most recent — brand auth hardening Layer 3 (Turnstile bot protection) COMPLETE — live-verified with CAPTCHA ON (July 9, 2026)

Third layer of the brand email/password hardening: **Cloudflare Turnstile as the provider inside Supabase's built-in Auth CAPTCHA** — widget on the client, `captchaToken` threaded into the Supabase auth calls, Turnstile SECRET entered in the Supabase dashboard (NOT our env). No custom verification route. Schema-free — NO migration. Commit `6dfdab4` (Codex clean, no findings).

- **`components/auth/turnstile-widget.tsx`** — client `TurnstileWidget` (forwardRef, imperative `reset()`): explicit-render, `theme:"light"`, `appearance:"interaction-only"` (managed, minimal friction, does NOT gate submit). Loads the Turnstile script via `next/script`; double-render guard, StrictMode-safe cleanup (`remove` on unmount), seeds `scriptReady` true if the script is already present (client-side nav). **Renders `null` when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is unset** → no widget, no token, no hard dependency for local dev.
- **`lib/auth/turnstile.ts`** — pure, React-free helpers: `turnstileEnabled()`, `withCaptchaToken(options, token)` (adds `captchaToken` ONLY when a token is present — returns options byte-identical otherwise, the graceful-degradation core), `isCaptchaError()` + `CAPTCHA_RETRY_MESSAGE` (friendly retry copy, never the raw Supabase captcha error).
- **`/signup`, `/login`, `/forgot-password`** — render the widget; thread `captchaToken` into `signUp` / `signInWithPassword` / `resetPasswordForEmail` via `withCaptchaToken`. On any failed submit: reset the widget + clear the token (single-use) and, on a captcha rejection, show `CAPTCHA_RETRY_MESSAGE`. `/reset-password`'s session-based `updateUser`, the show magic-link path, `test-login`, and `return-to-admin` are **untouched** (admin flows pinned captcha-free by source-scan tests).
- **SEQUENCING (now resolved):** the widget code shipped first with the Supabase Attack-Protection CAPTCHA toggle OFF (Supabase ignores `captchaToken` while disabled), so the code was live and safe before enforcement. The toggle was flipped ON July 9 only after the deployed code was confirmed working, so no brand signup/login/reset window ever broke.
- **Env:** `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (public site key) → `.env.local` placeholder (blank locally) + Vercel for prod. Turnstile SECRET → Supabase dashboard only, never in our env/code.
- **Manual dashboard state (July 9, 2026 — invisible in the repo, recorded here):**
  - **Supabase Attack Protection → CAPTCHA: ENABLED** July 9; provider **Turnstile**; Turnstile **secret entered** in the dashboard (not in our env/code).
  - **Cloudflare Turnstile widget "Taylslate Auth" ACTIVE** for hostnames `taylslate.com` + `www.taylslate.com` + `localhost`.
  - **`NEXT_PUBLIC_TURNSTILE_SITE_KEY` set in Vercel Production** (public site key).
  - **Rollback (unchanged):** toggle CAPTCHA OFF in Supabase Attack Protection — the client code degrades gracefully (no widget/token dependency once Supabase stops requiring it).
- **Verification:** 20 tests (turnstile helpers; captchaToken-threaded + graceful-degradation-omitted + reset-on-captcha-rejection for all three forms; new `/login` test; admin no-captcha source-scan pins). Suite **983 passing** (89 files), tsc + eslint clean, **Codex clean** (no High/Medium/Low; all 6 invariants pass). **Deployed green** (`dpl_vuSdpFZQ…`, aliased www.taylslate.com). **LIVE-VERIFIED July 9 with the CAPTCHA toggle ON:** login, the full signup loop (`chris+authtest3` — confirmation email delivered, link landed authenticated), and forgot-password all passed under enforcement, with **no captcha errors on any flow**. Brand auth hardening (Layers 1-3) is COMPLETE and this launch blocker is CLEARED.

## Most recent — brand auth hardening Layer 2 (password reset) shipped + verified live (July 8, 2026)

Second layer of the brand email/password hardening. Build-vs-unify decision (July 8): **keep passwords for launch, build reset** (unification stays post-launch). Schema-free — NO migration. Reuses the token_hash pattern + the existing `/callback` `recovery` branch. Commits `0c25adf` (build) → `9bb482a` (Codex Medium) → `e39dba0` (Codex Lows).

- **`/forgot-password`** — email → `resetPasswordForEmail(redirectTo /callback?next=/reset-password)`; neutral enumeration-safe confirmation ("if that address has an account…") shown on success regardless of existence; error state on failure.
- **`/reset-password`** — **server-component recovery gate** (Codex-hardened): `/callback` sets a short-lived HttpOnly marker cookie `tslate_pw_recovery` (10-min TTL, path-scoped to `/reset-password`, `lib/auth/recovery-cookie.ts`) ONLY after `verifyOtp({type:"recovery"})` succeeds; the page renders the set-password form ONLY when that marker is present, else the invalid-link state. This closes the gap where any authenticated user — notably a passwordless magic-link show — could reach the form. Form (`reset-password-form.tsx`, client): new password + confirm via pure `validateNewPassword` (min 8, match) → `updateUser` → clears the marker via a server action → `/dashboard`.
- **Role picker** — `ONBOARDING_ROLES` (`app/onboarding/roles.tsx`) no longer offers **Show / Creator**; shows onboard via magic-link+OTP, not password self-signup (closes the model-integrity gap traced July 8). Dead show-routing branch + unused `totalSteps` removed.
- **`/login`** "Forgot password?" link; **`proxy.ts`** allowlists `/forgot-password` + `/reset-password`; **`/callback`** unchanged beyond setting the recovery marker (already accepted `type=recovery`).
- **Supabase dashboard config change (manual, July 8 — invisible in the repo, recorded here):** the **Reset Password** email template was switched to the token_hash pattern: `{{ .SiteURL }}/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password` (was `{{ .ConfirmationURL }}`). Same browser-independent rationale as the Confirm-signup template. Durable form in CLAUDE.md → Auth & admin.
- **Verification:** 27 tests across the auth surface (forgot neutral+redirect+error; reset validator; recovery gate shows form only with marker; form success/mismatch/short/error + marker-clear; `/callback` sets cookie on recovery + not on signup; proxy allowlist; roles excludes show). Suite **963 passing** (87 files), tsc + eslint clean, **Codex clean** (one Medium — recovery-session scoping — fixed; two Lows — cookie path + clear-on-success — fixed; re-review confirmed). **Verified live July 8:** reset email delivered via the token_hash flow, link landed on `/reset-password` with the form, new password set → `/dashboard`, logged in with the new password; enumeration + recovery-gate checks confirmed.

## Most recent — brand auth hardening Layer 1 (signup path correctness) shipped + verified live (July 8, 2026)

First layer of the **brand email/password auth hardening** launch-blocker (real strangers hit this path at launch; it was NOT part of the June 28 magic-link fixes). Schema-free — NO migration. Commits `28cce8a` (build) + `5fe246f` (Codex fixes).

- **`emailRedirectTo` on signup** → `${NEXT_PUBLIC_SITE_URL ?? window.location.origin}/callback?next=/onboarding` (client `resolveSiteOrigin()` mirroring the server helper in `api/auth/magic`). Confirmation link now returns to the one real callback route.
- **Honest signup UI** — branches on the `signUp` response via a pure, tested `classifySignupOutcome()` (`app/(auth)/signup/signup-outcome.ts`): `session` present → `/onboarding` (confirm-off / already-confirmed edge, no check-email screen); new user → check-email screen; **existing-email decoy** (Supabase returns a user with `identities:[]`) → the *same* neutral screen; no user/session/error → error. The decoy and genuine-new-signup screens are byte-identical (a component test pins this) so account existence never leaks — this deliberately replaced the old personalized "we sent a link to X" copy, which would have defeated Supabase's enumeration obfuscation.
- **Password `minLength` 6 → 8** on signup only (matches the dashboard min). Login left at 6 so existing 6-char passwords still authenticate.
- **`safeNextPath` hardened** (Codex Medium) — now rejects any `next` that isn't a clean single-leading-slash path (`//`, `/\`, or missing leading slash → fallback) *before* URL parsing; the `new URL` origin re-check stays as defense in depth. Affects both `/callback` branches (token_hash + PKCE); no legit `next` regresses.
- **Supabase dashboard config change (manual, July 8 — invisible in the repo, recorded here):** the **Confirm signup** email template was switched to the **token_hash pattern** — `{{ .SiteURL }}/callback?token_hash={{ .TokenHash }}&type=signup&next=/onboarding` (was `{{ .ConfirmationURL }}`). This makes email confirmation server-verifiable and browser-independent, killing the PKCE cross-device fragility (a link opened on a different device/browser than signup now works). `/callback` already accepts `type=signup` in `OTP_TYPES`. Durable form recorded in CLAUDE.md → Auth & admin.
- **Verification:** 22 new tests across 4 files (classifier branches; `/callback` token_hash-`signup` + PKCE-code branches + `safeNextPath` open-redirect rejection; `SignupPage` no-leak/redirect/error render tests; `proxy.ts` allowlist pins `/signup`/`/login`/`/callback`). Suite **944 passing** (82 files), tsc + eslint clean, **Codex clean** (no High; one Medium + one Low, both resolved). **Verified live July 8:** confirm-signup email delivered via the token_hash flow, link landed on `/onboarding` with a session; 8-char minimum enforced (7 rejected); existing-email re-signup rendered the neutral decoy screen byte-identical to fresh signup (enumeration defense confirmed in incognito); logged-in signup short-circuited to `/onboarding`.
- **Next (Layer 2):** password-reset path. Pre-flight (July 8, read-only) found **no reset path exists at all** — no "Forgot password?" link, no request/update-password pages, no `resetPasswordForEmail`/`updateUser` calls (only `/callback` already lists `recovery` in `OTP_TYPES`). This is greenfield, not a broken rebuild — and it directly raises the standing build-vs-unify strategy question (building password reset deepens the password model the auth-unification backlog wants to retire). Awaiting founder direction before planning.

## Most recent — impersonation Layer 3 (return-to-admin) shipped + verified live (July 7, 2026)

**Return-to-admin shipped** — `POST /api/admin/return-to-admin` + a "Return to admin" button on the orange impersonation banner. Swaps a test-account session back to the founder's admin session WITHOUT signing out. Schema-free — NO migration.
- **Opaque capability token, hash-at-rest:** on impersonation start (`test-login`), a 256-bit random token is minted; only its **sha256 hash** is stored in the `admin.impersonate` `domain_events` payload (`lib/admin/return-token.ts`), and the raw token is set in an httpOnly/Secure/SameSite=Lax `tslate_return_token` cookie. The audit log at rest never holds a usable bearer token.
- **Zero-trust on the plaintext cookie:** the return path resolves the admin identity from the impersonate event's `actor_id` (via `getUserById`), then re-checks `isInternalAdmin` against the CURRENT allowlist (a demoted admin's token → 403). The unsigned `tslate_impersonation_origin` cookie is never read for identity — banner label only.
- **Atomic single-use (Codex High, resolved):** enforced by inserting the `admin.impersonation_ended` sentinel into `domain_events` with a **deterministic primary key** derived (domain-separated sha256 → uuid shape) from the impersonate event id. A concurrent/repeat redeem collides on the PK (`23505`) → 403; the insert is confirmed BEFORE any session is minted, so a failed write → 500 (fail-closed), never a reusable token. Append-only preserved (insert, not payload mutation). The first non-atomic fail-soft version was caught by the Codex loop.
- **8h TTL** enforced server-side on the event `created_at`. Session swap reuses the proven `generateLink` → `/callback?token_hash` flow (no `/auth/callback`, no implicit-flow fragment). `/api/*` already in the `proxy.ts` allowlist — no proxy change.
- **Verification:** 11 colocated route tests (mint+hash+cookie; valid return; consume-before-mint ordering; forged/absent/expired/reuse-23505/fail-closed-500/demoted → 403/500; plaintext-origin-cookie-ignored). Suite **917 passing** (78 files), tsc + eslint clean, **Codex clean** (one High — check-then-write single-use race — fixed with the deterministic-PK insert, fail-closed; re-review confirmed resolved, no new High/Medium). **Verified live July 7** (impersonate → return → confirm admin session → token re-use rejected, all confirmed). With Layer 3, the **impersonation tool is COMPLETE (Layers 1-3)** and the seed→impersonate→verify→return→teardown loop is fully self-serve.

## Most recent — seeding tool Layer 2 (teardown) shipped (July 7, 2026)

Test-deal seeding tool **Layer 2 shipped** — `DELETE /api/admin/seed-deal` (same `isInternalAdmin` gate + service-role ops as POST) removes ALL seeded test data so seeds never linger (avoids the day-3/day-14 planning-timeout cron acting on stale seeds; keeps prod clean).
- **Belt-and-suspenders discovery:** union of `deal.seeded` event-payload ids AND an independent `[SEED] ` name-prefix scan of shows + campaigns; outreach discovery **widened** to any outreach linked to a seeded campaign/show (marker-scoped), so an eventless partial seed's deal still cascades away.
- **Deletion order (per Layer 1 cascade findings):** outreaches (cascades deals + IOs via `outreaches`→`deals` ON DELETE CASCADE 013 + `insertion_orders`→`deals` CASCADE 001) → **verify deals gone** (`deals.show_id` is NOT NULL / RESTRICT; a survivor → 500 + `survivingDeals`, report not swallow) → shows → campaigns.
- **RESTRICT-descendant guard (Codex, 3 rounds):** the cascade removes the whole `deal → insertion_orders → io_line_items` subtree; four non-cascade FKs point into it and would FK-fail the delete — `payments.deal_id`, `invoices.io_id`, `payments.io_line_item_id`, `invoice_line_items.io_line_item_id`. A declarative check enumerates all four, and any hit aborts 500 with a `blockers` report (table + actual blocking rows + their parent ids) before any destructive delete (never deletes financial/invoice records). payouts/setup-intents hang below payments, so the payment blocker covers them.
- **Fail-loud discovery (Codex):** any discovery/pre-count query error → 500 before any delete (never mistaken for empty state). Reported deal count sourced from DB, not stale event ids.
- **Safety:** every delete scoped by `.in("id", <discovered ids>)`; a row lacking the `[SEED]` prefix or a `deal.seeded` reference is never touched. Zero seeded entities → `200 { deleted: {} }`. Fires `admin.seed_teardown` domain event (new `DomainEventType`) with the union of everything deleted (incl. `io_line_items`).
- **Verification:** 12 colocated DELETE tests (gating, full cascade + order, markers-only safety, empty-state, partial-seed with/without deal, surviving-deal backstop, payment/invoice/line-item RESTRICT guards, discovery-error). Suite **906 passing** (76 files), tsc + eslint clean, Codex reviewed across 3 rounds (2+1+1 Medium + Lows — all resolved).

**Test-deal seeding tool Layer 1 shipped** (admin endpoint creating a `planning`-status deal between test accounts brand1 → show1, commit `d488430`) — no code beyond the seeding path. With it, the three deferred 2D browser verifies are **DONE**: all three deal-view surfaces (promo-code save, UTM tracking link, show-notes blurb) verified **live under impersonation, both roles**, against seeded deal `e0bf050b`.

**Layer 2 (teardown) verified live July 7** (commit `a1c09bf`): full teardown of seed `e0bf050b` confirmed — 1 outreach, 1 deal cascaded, 1 show, 1 campaign deleted; the deal URL now 404s; an empty-state re-run returns `{ deleted: {} }`. The **seed→verify→teardown loop is now complete and repeatable**. The Codex loop added a **financial-records guard**: teardown refuses (500 + `blockers` report) if any `payments`/`invoices` reference the seeded subtree — relevant for future money-loop seeds.

The July 7 verification also surfaced a launch-blocker cluster (accept-flow NOT-NULL, show-side deal visibility, flight-date off-by-one) now logged in PRODUCT_BACKLOG.md → PRE-LAUNCH.

## Most recent — Wave 14 Phase 2D COMPLETE (shipped July 6, 2026)

All five 2D items live: founder annotations + brand_history (L1-2), promo code (deals.promo_code, migration 030, Layer A), UTM tracking link (generate-on-read, Layer B), show-notes blurb (template, Layer C). 884 tests, tsc/eslint clean, Codex clean. Deploys: 3eacc8e (A) / c020e547 (B) / 75491f7 (C).

VERIFICATION DEBT — **RESOLVED July 7, 2026.** All three 2D deal-view surfaces (promo field, tracking link, show-notes blurb) verified live in-browser under impersonation, both roles, against seeded deal `e0bf050b` — unblocked by the test-deal seeding tool Layer 1 (`d488430`).

Also shipped June 28, 2026: founder impersonation tool (Layers 1-2) + four production auth bugs fixed on the show magic-link path. Show magic-link onboarding now works end-to-end for the first time.

## Wave 14 Phase 2D Layer C: copy-paste show-notes blurb (shipped July 6, 2026)

**Copy-paste show-notes blurb — GENERATED ON READ, no migration, no column, no persistence, no domain event.** Item 5 (final) of 2D — **2D is now complete**. Stitches Layer A (saved `deals.promo_code`) + Layer B (`buildTrackingLink`) into one ready-to-paste sponsor line the show drops into its episode description. **Deterministic template, not an LLM call.**
- **Pure helper** `lib/io/show-notes.ts` — `buildShowNotesBlurb({ brandName, promoCode, trackingLink })` → blurb string or `null`. Reuses Layer A+B *outputs* (never recomputes `buildTrackingLink`/`normalizePromoCode`). Trims inputs, treats blank as absent. Degradation: link+code → `Check out {brand} at {link} — use code {CODE}.`; link-only / code-only drop the missing clause; **neither → `null`** (card omitted). Never emits `code null` / `undefined` / double spaces / dangling punctuation. Blank brand → neutral `our sponsor` lead.
- **Uses the SAVED promo code** (`deal.promo_code`), not the brand's unsaved draft input — consistent with the read-only promo display; re-derives on `router.refresh()` after a promo save.
- **Deal view** `components/deals/Wave12DealClient.tsx` — read-only "Show notes" sidebar card (blurb block + Copy button, "Copied ✓" inline confirm) after the Tracking-link card. Renders for **both roles** (the show pastes it). Omitted cleanly when blurb is null. Blurb computed server-side in `app/(dashboard)/deals/[id]/page.tsx`, passed as `showNotesBlurb` prop (alongside a now-extracted `brandName` const).
- **No domain event** — rendering a derived string is not a user decision (same rationale as Layer B).
- **Verification:** 8 colocated unit tests (degradation matrix + blank/whitespace handling + neutral-lead fallback + a "never emits null/undefined/double-space" invariant across the matrix), full suite **884 passing**, tsc clean, eslint clean on changed files, fresh Codex review (no High/Medium; one Low — over-specific caption — fixed). **Browser verify pending friends-test** — no deal/campaign data exists yet; wiring left correct and testable for a later seeded session.
- **Not built (out of scope, per brief):** LLM generation, click-through tracking, blurb persistence, promo code on the IO PDF, show-onboarding `preferred_promo_code`.

## Wave 14 Phase 2D Layer B: per-deal UTM tracking link (shipped July 6, 2026)

**Auto-generated UTM tracking link per deal — GENERATED ON READ, no migration, no column, no persistence.** Item 4 of 2D. Derived deterministically from `brand_profiles.brand_website` (migration 007) + the show name + `deals.id`, recomputed every render, surfaced read-only on the deal view for both brand and show viewers.
- **Pure helper** `lib/io/tracking-link.ts` — `buildTrackingLink({ brandWebsite, dealId, showName })` → UTM URL or `null`. Taxonomy: `utm_source="podcast"` + `utm_medium="podcast"` (stable channel so podcast traffic buckets together in the brand's analytics) + `utm_campaign="<show-slug>-<dealId>"` (per-show + per-deal granularity, deal id for uniqueness). Uses `URL`/`URLSearchParams`: blank/missing → null; no scheme → prepend `https://`; existing query params preserved and merged (`.set()`), not clobbered; non-http(s) scheme rejected → null (Codex finding); encoding via the URL API.
- **Deal view** `components/deals/Wave12DealClient.tsx` — read-only "Tracking link" sidebar card (mono URL block + Copy button via `navigator.clipboard`, "Copied ✓" inline confirm matching the promo "Saved ✓" pattern). Card omitted cleanly when the link is null. Link computed server-side in `app/(dashboard)/deals/[id]/page.tsx` and passed as a `trackingLink` prop.
- **No domain event** — rendering a derived link is not a user decision (unlike the promo code, which the brand sets/saves). Confirmed with Codex; no event by design.
- **Deferred (one-line comment in helper):** persisting the exact link or a per-deal landing-URL override is a backlog item, not built now.
- **Verification:** 12 colocated unit tests (edge cases: missing/blank → null, scheme prepend, existing-params merge, encoding, non-http rejection, unparseable → null), full suite 876 passing, tsc clean, eslint clean on changed files, fresh Codex review (one Medium finding — non-http scheme — applied). **Browser verify pending friends-test** — no deal/campaign data exists yet; wiring left correct and testable for a later seeded session.
- **Not built (out of scope):** show-notes blurb (Layer C), link persistence, per-deal landing-URL override, promo code on IO PDF.

## Founder impersonation tool + four show-auth fixes (shipped June 28, 2026)

**Founder "log in as test user" tool — Layers 1 + 2 shipped, live on prod, verified end-to-end both ways.** Schema-free — NO migration added. Admin-gated by `isInternalAdmin` (`INTERNAL_ADMIN_EMAILS`); impersonable set fixed by `TEST_ACCOUNTS`.
- Sidebar click-through as `chris@`: lands as the test user, orange "Impersonating &lt;label&gt;" banner shows.
- Real magic-link email to `chris+show1@taylslate.com`: clicked from the inbox → authenticated show session with correct role/RLS.

**Four production auth bugs fixed** — all on the show magic-link path, none previously testable (this tool is what exposed them; Wave 13 gotcha #5):
1. **Callback path** — the only callback route is `app/(auth)/callback/route.ts`, served at `/callback` (the `(auth)` group is stripped from the URL; there is NO `/auth/callback`). `test-login` and the show magic route both pointed at `/auth/callback` (404). → `/callback`. (`8740670`)
2. **Implicit vs PKCE flow** — `admin.generateLink()` returns an implicit-flow link (session in the `#access_token=…` fragment), unreadable by a server route; no `?code=` for `exchangeCodeForSession`. → read `properties.hashed_token`, build `/callback?token_hash=…&type=magiclink&next=…`, verify with `verifyOtp({ type, token_hash })`. The callback route now has a `token_hash` branch beside the `code` branch. (`8740670`)
3. **Proxy allowlist** — the auth gate `proxy.ts` (Next 16's renamed middleware) omitted `/callback`, so unauthenticated magic-link users bounced to `/login` before `verifyOtp` ran. → added `/callback`. (`8c32570`)
4. **Start link target** — `app/api/auth/magic/start/route.ts` emailed `/auth/magic` (static "One sec…" page that ignores the token) instead of `/api/auth/magic` (the consuming route). → fixed. (`0187863`)
Plus a Codex finding: open redirect on `next` validated to a same-origin path on both callback branches. (`c355c5e`)

**The show magic-link flow now works end-to-end for the first time** (Wave 13 gotcha #5 resolved). Layer 1 endpoint was `ccbc6e5` (prior session); this session added `8740670`, `8c32570`, `c355c5e`, `0187863`.

## Current wave
**Wave 14 Phase 2D COMPLETE (July 6, 2026).** No active build wave. Test-deal
seeding tool Layer 1 (`d488430`) + Layer 2 teardown (`a1c09bf`) both shipped and
verified live July 7 — seed→verify→teardown loop complete. Impersonation Layer 3
(return-to-admin) shipped AND verified live July 7 (Codex clean) — the
impersonation tool is now COMPLETE (Layers 1-3). 2C
Layer 5 (overrides + recompute) remains optional polish, not GTM-blocking —
carried in PRODUCT_BACKLOG.md with its request-scope footgun note.

## Tests
1021 passing (94 files). tsc clean. eslint: all changed files clean (pre-existing
unused-var warnings only). `next build` green.

## Migration state
001–032 applied and introspected. **032** (`cadence_multiple_weekly` — widens the
`episode_cadence` CHECK on `show_profiles` + `shows` to allow `multiple_weekly`)
applied + introspected July 16, 2026: exactly two check constraints, both include
`multiple_weekly`, no lingering constraints. No grant block (grandfathered tables).
**031** (`shows.is_discoverable BOOLEAN NOT NULL
DEFAULT TRUE`, accept-flow cluster — non-catalog materialized shows + seeds flagged
FALSE, excluded from discovery reads) applied + introspected July 16, 2026: column
confirmed boolean / NOT NULL / default true, all 52 existing shows TRUE. No grant
block (grandfathered table). Through 028 confirmed previously — 028
(per-show cost + tier curation columns on `conviction_scores`) verified (8
columns + cost_basis check + `(campaign_pattern_id, tier)` index). 029 (Phase 2C
Layer 5 portfolio-override inputs: `campaigns.test_spot_count` / `test_placement`,
`conviction_scores.cpm_override_cents` / `placement_override` — applied ahead of
the Layer 5 UI, which is still unshipped; see Next) and 030 (Wave 14 Phase 2D
Layer A: `deals.promo_code`) were confirmed by an introspection query July 6,
2026 — all five columns present. The files in `supabase/migrations/` document
what is live; never re-run.
**Of the July 6 2D layers, only Layer A (030, `deals.promo_code`) added schema.
Layers B (UTM tracking link) and C (show-notes blurb) are schema-free — generated
on read, no migration/column added. The June 28, 2026 impersonation tool + auth
fixes are likewise schema-free.**

## What works end to end
`/campaigns/[id]` renders the dual output: test portfolio (selectable, budget
meter), scale tier (watchlist, "deferred" framing), bench (collapsed). CTA
writes selected test-tier IDs to the Wave 7 plan path and navigates. Verified
live in-browser against real campaigns. Rejected-ring leakage closed (3.5) —
filter to confirmed rings before rollup in both persist and read paths.

Founder impersonation: `chris@` (an `INTERNAL_ADMIN_EMAILS` member) sees
"Log in as …" buttons in the sidebar → one click swaps into the test
account's session and shows the "Impersonating …" banner. The show
magic-link flow (outreach → `/api/auth/magic/start` email → `/api/auth/magic`
→ `/callback` `verifyOtp`) now completes end-to-end, verified from a real
inbox.

## 2C deferred (logged in PRODUCT_BACKLOG.md)
- flat_fee meter-vs-plan mismatch — moot at launch (podcast-only discovery);
  Wave 7/2D.
- scale-watchlist not tier-validated; plan-handoff non-atomic double-write —
  both degrade safely.
- Q5 invariant: stale-tier safety relies on "only composite ≥ MEDIUM_FLOOR rows
  persist." If below-floor rows ever persist, the confirmed-ring stale-tier
  case reopens.

## Next
Brand auth hardening **COMPLETE (Layers 1-3), launch blocker CLEARED** — L1+L2
shipped + verified live July 8, L3 (Turnstile) live-verified July 9 with the
CAPTCHA toggle ON (Codex clean throughout). Build-vs-unify decision: keep
passwords for launch, unify post-launch. Role-picker Show/Creator gap closed in L2.

**Accept-flow cluster SHIPPED + Codex-clean (three passes) + LIVE-VERIFIED July 16 —
launch gate CLEARED** (see "Most recent" above + PRODUCT_BACKLOG.md → SHIPPED). All
three bugs (#1 NOT-NULL, #2 show-side visibility, #3 flight-date) + the pre-existing
`deals/[id]` authz byproduct are fixed, merged to `main`, and confirmed against a
real accept loop in prod; the parked product decision is resolved (non-catalog accept
→ non-discoverable `shows` row, migration 031). Live verify covered both variants
(deal-at-accept, brand + show visibility, flight dates on deal view + IO, materialize
+ backfill via real onboarding) and a clean teardown cascade. Pushed + Vercel-green.

Optional polish carried in the backlog: **sidebar buttons for seed/teardown**
(the loop is endpoint-only today). 2C Layer 5 (overrides + recompute) remains
optional polish, not GTM-blocking.
