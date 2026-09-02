# PILE_A_PROOF.md

Evidence pack for Pile A (A1–A4). Scope executed: **Minimal additive** (Chris, 2026-08-24) — close G2/G3/G4 with small schema-free changes + tests; G1/G5 accepted deviations; G6 (live proof) handed off.

**Mode of this run: AUTOMATED + BUILD only.** No live proof was performed, and none was possible from this environment:
- **Stripe:** `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` are **EMPTY in local `.env.local`** — no test *or* live keys. Stripe cannot run locally at all.
- **DocuSign:** `DOCUSIGN_ENV=sandbox` locally; production is Vercel-prod-scoped only.
- **Webhooks:** localhost cannot receive DocuSign Connect or Stripe webhooks. Connect + Stripe webhook endpoints are DocuSign/Stripe-admin configuration only Chris can do.

Per the plan's LIVE PROOF PROTOCOL: "If live Stripe is not connected: stop after test-mode proof and list the exact env/webhook/Connect admin steps. Do not fake a live proof." There aren't even local test keys, so this stops at **automated proof** and lists the human steps below.

---

## Update — 2026-09-02 · Track 1 closed (strictly additive, no core logic touched)

Follow-up pass after the 2026-08-24 run. All changes were **additive** (new tests, one migration, one timestamp field, docs) — no `route.ts` or component business logic was edited. Verification: **100 files, 1070 tests pass**, `tsc --noEmit` clean, eslint 0 errors (the 1 pre-existing `_eventType` warning at `webhook.ts:460` is unrelated and untouched). Mode is still AUTOMATED + BUILD only — **G6 live proof remains open and human-gated** (below, unchanged).

- **A2 — auto-revalidation hook SHIPPED (commit `516e918`).** The deal page (`components/deals/Wave12DealClient.tsx`) now reads `?signing` via `useSearchParams`; on `signing_complete` with `brand_signed_at` still null it polls `router.refresh()` every 2s (capped 15s) until the **webhook** writes the signature, then strips the param with `window.history.replaceState`. This makes the "UI flips to signed only after A1 fires" criterion automatic (no manual refresh) and keeps the return URL non-authoritative. Redundant `signingHint` server prop removed. Tests: `Wave12DealClient.test.tsx` — polls until signed, respects the 15s cap, cleans the URL, ignores non-completion events.
- **A3 — `card_on_file_at` marker ADDED (closes the spec's card_on_file_at requirement).** Migration **`033_deal_card_on_file_at.sql`** adds `deals.card_on_file_at TIMESTAMPTZ` (idempotent; grandfathered grants). `lib/stripe/webhook.ts` `handleSetupIntentSucceeded` now stamps `card_on_file_at = new Date().toISOString()` alongside `payment_method_id` — server-authoritative on `setup_intent.succeeded`. **⚠️ Migration 033 is written but NOT yet applied/introspected in Supabase** — paste it and confirm the column exists before relying on it (the "applied = introspected" invariant). Card last4/brand/exp are still NOT persisted (still inferred as `payment_method_id IS NOT NULL` for presence); only the timestamp was added.
- **New additive tests (+13):**
  - `app/api/deals/[id]/send-to-docusign/route.test.ts` — 401 unauth, 403 non-owner brand, 409 non-planning, and **create-vs-resume** (fresh envelope persisted + `getBrandSigningUrl` for the new id; existing `docusign_envelope_id` reused with **no** `createEnvelope`/`updateWave12Deal`). Closes the biggest A2 route-test gap.
  - `app/api/deals/[id]/docusign-return/route.test.ts` — asserts UX-only redirect (`307` → `/deals/[id]?signing=…`, default `unknown`) and **zero DB writes** (regression guard on the webhook-authoritative model).
  - `lib/stripe/setup-intent.test.ts` — asserts `usage:"off_session"`, `payment_method_types:["card"]` (+ override), deal metadata, and **no subscription/invoice created at capture** (alpha fee = 0).

The accepted deviations are unchanged: **G1** (state-guard idempotency, no raw-event table) and **G5** (card-on-file is column-based — now `payment_method_id` + `card_on_file_at` — not a named deal status).

---

## Automated evidence

Commands (repo root):

```
npx tsc --noEmit          # clean (0 errors)
npx eslint <changed>      # 0 errors (1 pre-existing warning in mapStripeSubStatus, untouched)
npx vitest run            # 100 files, 1070 tests passed (Track 1 close, 2026-09-02; was 97/1048)
npx next build            # exit 0 (Turbopack, incl. new nodejs-runtime route)
```

### A1 — DocuSign Connect webhook (already present; unchanged this run)
`app/api/webhooks/docusign/route.test.ts` + `lib/docusign/webhook.test.ts`:
- valid HMAC accepted / invalid HMAC rejected (401, no state change)
- `brand_signed` transition + `io.brand_signed` event
- full-signature: downloads PDF+cert, `io.show_signed`+`io.completed`
- declined/voided → cancelled
- **idempotent: replayed `brand_signed` is a no-op** (state-guard idempotency — the G1 deviation basis)
- unknown envelope → 200 ack, no crash
- provisions a Stripe SetupIntent on `brand_signed` (the A4 trigger)

### A2 — Embedded signing via the real route (already present; unchanged this run)
- Real authenticated route `app/(dashboard)/deals/[id]/page.tsx` (auth + ownership `ownsAsBrand`/`ownsAsShow` or `notFound`).
- `app/api/deals/[id]/send-to-docusign/route.ts` → `getBrandSigningUrl` embedded recipient view (`clientUserId:"brand"`, `authenticationMethod:"none"`); brand-ownership enforced.
- `app/api/deals/[id]/docusign-return/route.ts` is UX-only — a return-URL test confirms it does NOT set completion.
- UI flips to signed only via the webhook-updated server render (`components/deals/Wave12DealClient.test.tsx`).

### A3 — Live Stripe card-capture (in-flight work, retained + extended)
- `DealCardSetupForm` (Elements + `confirmCardSetup` against the deal's SetupIntent) — NOT Checkout/subscription.
- `lib/stripe/payment-intent.ts` charges `deals.payment_method_id` (deal-specific card), tests updated.
- `components/deals/Wave12DealClient.test.tsx`: asks-for-card on `brand_signed`, saved-state on `payment_method_id`, hidden from show viewer, **+ new: recovers a missing SetupIntent on demand and mounts the card form.**

### A4 — Completion → SetupIntent loop (extended this run)
`lib/stripe/webhook.test.ts` (now covers, new in **bold**):
- `setup_intent.succeeded` → persists `deals.payment_method_id` + `deal.payment_method_attached`
- **`setup_intent.setup_failed` → persists `deal.setup_intent_failed` on the deal; never flips it out of `brand_signed`; no-op without `deal_id`**
- **`payment_method.attached` → customer-level `payment_method.attached` audit event; no-op on unknown customer**
- payout-gate invariant: `payment_intent.succeeded` does NOT settle / does NOT pay out
- `charge.succeeded` sets `settled_at`, fires payout (fail-soft)
- `HANDLED_STRIPE_EVENTS` now includes the two new event types

`app/api/deals/[id]/setup-intent/route.test.ts` (new — the G4 recovery route):
- 401 unauth · 404 no deal · 403 not brand owner
- **409 — unsigned IO cannot create a SetupIntent**
- already-saved when `payment_method_id` set
- **reuses an open SetupIntent instead of minting a new one (re-syncs drifted client secret)**
- **backfills `payment_method_id` when the existing SetupIntent already succeeded**
- creates a fresh SetupIntent with `{ deal_id }` metadata + persists + `deal.setup_intent_created`
- falls through to create when retrieving a stale SetupIntent throws

**No live ids** (`cus_`/`si_`/`pm_`/envelope) exist because nothing live ran. Fill these in during the live protocol below.

---

## G6 — LIVE PROOF PROTOCOL (human-only; blocked on Chris)

Do these in order; record ids/timestamps in a new "Live run" section here.

### Prereqs (env + admin config)
1. **Stripe keys** (Vercel Production env, and `.env.local` if testing locally):
   - `STRIPE_SECRET_KEY` (`sk_live_…` for live proof, `sk_test_…` for test-mode proof)
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (matching `pk_live_…`/`pk_test_…` — **same mode as the secret key**)
   - `STRIPE_WEBHOOK_SECRET` (`whsec_…` from the endpoint you create in step 3)
2. **DocuSign** is production-cut in Vercel already (`DOCUSIGN_ENV=production`, `na4`). For a sandbox rehearsal instead, set `DOCUSIGN_ENV=sandbox` + sandbox creds.
3. **Stripe webhook endpoint** (Dashboard → Developers → Webhooks): add `https://www.taylslate.com/api/webhooks/stripe`; subscribe at least `setup_intent.succeeded`, `setup_intent.setup_failed`, `payment_method.attached`, `payment_intent.succeeded`, `charge.succeeded`, `charge.dispute.created`. Copy the signing secret → `STRIPE_WEBHOOK_SECRET`.
4. **DocuSign Connect** (Admin → Connect): create a Custom configuration → URL `https://www.taylslate.com/api/webhooks/docusign`, JSON (SIM) format, include envelope + recipient events (`envelope-completed`, `recipient-completed`), enable HMAC and set the key → `DOCUSIGN_WEBHOOK_SECRET` (must match Vercel).

### Run (one internal fixture brand + one fixture show + one generated IO)
5. Seed a deal to `planning` (`POST /api/admin/seed-deal` or the accept flow).
6. Open the real route `/deals/<id>`, click **Sign IO** → sign as the brand in the embedded DocuSign view; land back on `/deals/<id>` in the pending state.
7. Confirm **DocuSign Connect delivery** (DocuSign admin → Connect → logs). A delivery failure = A1 not done.
8. Confirm the IO row is `brand_signed` **from the webhook** (not the return URL) — check `deals.brand_signed_at` + a `domain_events` `io.brand_signed` row.
9. Confirm `deals.setup_intent_id` + `setup_intent_client_secret` appear **without any admin script** (webhook-provisioned). If missing, the deal page's "Add card on file" now recovers it via `POST /api/deals/[id]/setup-intent`.
10. Save a card: test-mode use `pm_card_visa`; live use a real card ($0 setup — no charge).
11. Confirm the **Stripe webhook** `setup_intent.succeeded` set `deals.payment_method_id` (+ `deal.payment_method_attached` event). This is the "card_on_file / ready-to-charge" state.
12. Confirm **no platform-fee charge and no subscription** was created (alpha fee = 0; SetupIntent charges nothing).
13. (Optional, DO NOT run a live charge in this pile) Verify a charge *could* be created: `chargeForEpisode` uses `deals.payment_method_id` with `off_session:true, confirm:true`.
14. Record the timeline here: `io → envelope → connect event → deals.brand_signed_at → si → pm → payment_method_id`, with mode (test/live) and timestamps.

### Deviations to keep in mind during live proof
- **G1:** idempotency is state-guard + `domain_events` (no `docusign_connect_events` table). If you want raw-payload audit + a unique-event-key dedup table, that's the "Full spec" follow-up (needs a migration).
- **G5:** card-on-file is column-based (`payment_method_id`), not a named `card_on_file` status.
- **Known gap (STATUS):** no external alert is wired on `domain_events`, so `io.tabs_unverified` / `deal.setup_intent_failed` are only as good as a query someone runs.
