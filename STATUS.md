# Taylslate — STATUS

_Volatile snapshot. Updated July 7, 2026 — impersonation Layer 3 (return-to-admin) shipped (Codex clean); seeding tool Layer 2 (teardown) shipped AND verified live; Layer 1 + Wave 14 Phase 2D browser verification COMPLETE. Seed→verify→teardown loop is complete and repeatable. 917 tests passing (78 files)._

## Most recent — impersonation Layer 3 (return-to-admin) shipped (July 7, 2026)

**Return-to-admin shipped** — `POST /api/admin/return-to-admin` + a "Return to admin" button on the orange impersonation banner. Swaps a test-account session back to the founder's admin session WITHOUT signing out. Schema-free — NO migration.
- **Opaque capability token, hash-at-rest:** on impersonation start (`test-login`), a 256-bit random token is minted; only its **sha256 hash** is stored in the `admin.impersonate` `domain_events` payload (`lib/admin/return-token.ts`), and the raw token is set in an httpOnly/Secure/SameSite=Lax `tslate_return_token` cookie. The audit log at rest never holds a usable bearer token.
- **Zero-trust on the plaintext cookie:** the return path resolves the admin identity from the impersonate event's `actor_id` (via `getUserById`), then re-checks `isInternalAdmin` against the CURRENT allowlist (a demoted admin's token → 403). The unsigned `tslate_impersonation_origin` cookie is never read for identity — banner label only.
- **Atomic single-use (Codex High, resolved):** enforced by inserting the `admin.impersonation_ended` sentinel into `domain_events` with a **deterministic primary key** derived (domain-separated sha256 → uuid shape) from the impersonate event id. A concurrent/repeat redeem collides on the PK (`23505`) → 403; the insert is confirmed BEFORE any session is minted, so a failed write → 500 (fail-closed), never a reusable token. Append-only preserved (insert, not payload mutation). The first non-atomic fail-soft version was caught by the Codex loop.
- **8h TTL** enforced server-side on the event `created_at`. Session swap reuses the proven `generateLink` → `/callback?token_hash` flow (no `/auth/callback`, no implicit-flow fragment). `/api/*` already in the `proxy.ts` allowlist — no proxy change.
- **Verification:** 11 colocated route tests (mint+hash+cookie; valid return; consume-before-mint ordering; forged/absent/expired/reuse-23505/fail-closed-500/demoted → 403/500; plaintext-origin-cookie-ignored). Suite **917 passing** (78 files), tsc + eslint clean, **Codex clean** (one High — non-atomic single-use — fixed, re-review confirmed resolved, no new High/Medium). Live verify (impersonate → return → confirm admin session → token re-use rejected) is Chris's step.

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
(return-to-admin) shipped July 7 (Codex clean; live verify is Chris's step). 2C
Layer 5 (overrides + recompute) remains optional polish, not GTM-blocking —
carried in PRODUCT_BACKLOG.md with its request-scope footgun note.

## Tests
917 passing (78 files). tsc clean. eslint: all changed files clean; one
pre-existing error in `app/(dashboard)/campaigns/generated/page.tsx`
(setState-in-effect) is unrelated to this work.

## Migration state
001–030 applied and introspected. Through 028 confirmed previously — 028
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
Impersonation **Layer 3 (return-to-admin) SHIPPED July 7** (Codex clean; live
verify pending — Chris's step). Optional follow-up: **sidebar buttons for
seed/teardown** (the loop is currently endpoint-only). Then the **launch-blocker
cluster** now logged in PRODUCT_BACKLOG.md → PRE-LAUNCH: accept-flow NOT-NULL
bug (#1), show-side deal visibility (#2), flight-date off-by-one (#3). Auth
hardening on the brand email/password path [LAUNCH-BLOCKER] still precedes any
non-friends traffic.
