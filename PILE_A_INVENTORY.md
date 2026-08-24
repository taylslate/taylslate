# PILE_A_INVENTORY.md

Preflight inventory for Pile A (A1–A4). Written before any feature code, per the execution plan's hard constraint. Exact paths; "missing" means missing, not guessed.

_Generated 2026-08-24._

---

## 0. Repo identity — this IS the real Wave 1–13 rail (NOT the Cofounder starter)

| Fact | Value |
| --- | --- |
| Git remote | `https://github.com/taylslate/taylslate.git` |
| Default branch | `main` |
| Current branch | `main` |
| Package name | `taylslate` |
| Migrations | `supabase/migrations/000_…` → `032_cadence_multiple_weekly.sql` (33 files) |
| DocuSign dep | `docusign-esign` (present) |
| Stripe deps | `stripe`, `@stripe/react-stripe-js`, `@stripe/stripe-js` (present) |

Search hits for all required terms: **DocuSign** (`lib/docusign/*`), **envelope** (`lib/docusign/envelope.ts`), **IO PDF** (`lib/pdf/io-generator.ts`), **SetupIntent** (`lib/stripe/setup-intent.ts`), **Connect account** (`app/api/stripe/connect/*`), **campaign** (`app/api/campaigns/*`), **insertion order** (`lib/pdf/io-generator.ts`, `app/api/deals/[id]/io/*`), **`platform_fee_percentage`** (`profiles`, `lib/stripe/payment-intent.ts`, migration 015/023).

**Verdict: this is the real rail.** Not BLOCKED. Proceeding.

> Note on state: **A1–A4 are already substantially implemented and partially live-verified** (DocuSign production cutover done + auth/createEnvelope proven vs `na4`, per STATUS.md). This inventory maps what exists against the Pile A letter and flags the remaining gaps. There is also **uncommitted in-flight Pile A work in the tree** (see §5).

---

## 1. DocuSign map

| Concern | Path | Status |
| --- | --- | --- |
| Envelope create (IO PDF → envelope) | `lib/docusign/envelope.ts` → `createEnvelope()` | present |
| IO PDF generation | `lib/pdf/io-generator.ts` → `generateIoPdfFromDeal()`; anchors from `lib/docusign/anchors.ts` | present |
| Embedded recipient view | `lib/docusign/envelope.ts` → `getBrandSigningUrl()` (`clientUserId:"brand"`, `authenticationMethod:"none"`) | present (embedded, not email) |
| Real signing route (server) | `app/api/deals/[id]/send-to-docusign/route.ts` (brand-only, ownership-checked, returns `signing_url`) | present |
| Signing UI trigger | `components/deals/Wave12DealClient.tsx` → `sendToDocuSign()` → `window.location.href = signing_url` | present |
| Return / ping URL handler | `app/api/deals/[id]/docusign-return/route.ts` — **UX-only**, bounces to `/deals/[id]?signing=…`; does NOT mutate state | present, correctly demoted |
| **Connect webhook route** | `app/api/webhooks/docusign/route.ts` (POST) | present |
| Webhook verify/parse/classify | `lib/docusign/webhook.ts` → `verifyDocuSignSignature` (HMAC-SHA256/base64, timing-safe), `parseDocuSignEvent`, `classifyEvent` | present |
| JWT client + region discovery | `lib/docusign/client.ts` (JWT grant, `base_uri` via `getUserInfo`, token cache) | present |
| Envelope/IO storage | `deals` table columns: `docusign_envelope_id`, `brand_signed_at`, `show_signed_at`, `signed_io_pdf_url`, `signature_certificate_url` (migration 013 + 018). Signed PDF + cert → Supabase storage bucket `signed-ios`. | present |
| Status enum | `Wave12DealStatus` in `lib/data/types.ts:597` — `planning \| brand_signed \| show_signed \| live \| delivering \| completed \| cancelled` | present |
| HMAC verification | `lib/docusign/webhook.ts:33` — reads `X-DocuSign-Signature-1` only (not -2/-3); RSA not required by existing code | present (single-header) |
| Env vars | `DOCUSIGN_ENV`, `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, `DOCUSIGN_RSA_PRIVATE_KEY`, `DOCUSIGN_WEBHOOK_SECRET` — all set in `.env.local` | present |
| **Raw Connect event table** | **MISSING** — no `docusign_connect_events` (or equivalent) table. Idempotency is enforced by deal-state guards (`brand_signed_at`/`show_signed_at` non-null) + `domain_events` rows, NOT by a unique event key on raw payloads. Unknown-envelope events are ack'd (200) but **not persisted**. |

DocuSign webhook flow (`route.ts`): verify HMAC → `parseDocuSignEvent` → `getWave12DealByEnvelopeId` → `classifyEvent` → transition deal (`brand_signed` / `show_signed`+`completed` / `declined`+`voided`) via `updateWave12Deal`, fire `domain_events`, and on completion download signed PDF+cert to storage. On `brand_signed` it calls `provisionBrandSetupIntent` (the A4 trigger). Idempotent per branch via state guards.

---

## 2. Stripe money-rail map

| Concern | Path | Status |
| --- | --- | --- |
| Server SDK client | `lib/stripe/server.ts` (lazy `(0,eval)("require")`, platform account) | present |
| Brand customer create (canonical) | `lib/stripe/customer.ts` → `getOrCreateStripeCustomer()` (one customer per profile, writes `profiles.stripe_customer_id`) | present |
| SetupIntent create (deal rail) | `lib/stripe/setup-intent.ts` → `createSetupIntentForBrand()` (`usage:off_session`, metadata `{profile_id, deal_id}`) | present |
| SetupIntent create (legacy settings) | `app/api/stripe/payment-method/setup-intent/route.ts` — **no deal metadata, no `usage`** — settings card-on-file, NOT the deal loop | present (out of A3 loop) |
| Card-capture UI (A3) | `components/deals/Wave12DealClient.tsx` → `DealCardSetupForm` (Elements + `confirmCardSetup` against `deal.setup_intent_client_secret`) | present (uncommitted, §5) |
| PaymentMethod persistence | Stripe webhook `setup_intent.succeeded` → `deals.payment_method_id` (`lib/stripe/webhook.ts:125`) | present |
| Per-delivery charge (read-only) | `lib/stripe/payment-intent.ts` → `chargeForEpisode()` (`off_session`, `confirm`, `application_fee_amount` from `platform_fee_percentage`) | present (uncommitted edit prefers `deals.payment_method_id`, §5) |
| **Rail webhook route** | `app/api/webhooks/stripe/route.ts` → `lib/stripe/webhook.ts` `verifyAndHandleStripeEvent` (verifies `STRIPE_WEBHOOK_SECRET`) | present |
| Handled events | `setup_intent.succeeded`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.succeeded`, `charge.dispute.created`, `customer.subscription.updated\|deleted` | present |
| Connect (payouts) | `app/api/stripe/connect/*` (create-account, onboarding-link, status); payout transfer `lib/payouts/transfer.ts` | present |
| Settlement gate | `lib/payouts/transfer.ts:140,278` — refuses transfer unless `payments.settled_at` set (only on `charge.succeeded`) | present, load-bearing |
| Tables | `deals` (setup_intent_id/client_secret/payment_method_id — mig 018), `payments` (mig 016), `payouts` (mig 018), `profiles.stripe_customer_id`/`platform_fee_percentage` | present |
| Env vars | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — **names present in `.env.local` but VALUES EMPTY locally** | see §4 |
| **`setup_intent.setup_failed` handler** | **MISSING** — not in `HANDLED_STRIPE_EVENTS`, no failure persisted |
| **`payment_method.attached` handler** | **MISSING** — not handled |

The rail webhook is one endpoint that dispatches subscription **and** deal/payment events, but the handlers are cleanly separated (subscription → `profiles`; setup_intent/charge → `deals`/`payments`). No `customer.subscription.*` logic touches deal state. This satisfies the plan's "don't overload the SaaS handler unless separable" clause.

---

## 3. Deal state machine

`Wave12DealStatus` (`lib/data/types.ts:597`) and the event that moves each edge:

| From → To | Trigger | Source of truth |
| --- | --- | --- |
| _(accept)_ → `planning` | outreach accept | server (accept route) |
| `planning` → `planning` (+ `docusign_envelope_id`) | `POST /send-to-docusign` (envelope created) | server; stays `planning` until real signature |
| `planning` → `brand_signed` (+ `brand_signed_at`) | **Connect `recipient-completed` (recipient 1)** | `app/api/webhooks/docusign/route.ts` (webhook, NOT browser) |
| `brand_signed` → `show_signed` (+ `show_signed_at`, PDFs) | **Connect `envelope-completed` / recipient 2** | webhook |
| any → `cancelled` | Connect `declined`/`voided`, or `POST /cancel`, or 14-day timeout cron | webhook / server |

**Card-on-file state is column-based, not a status value.** After `brand_signed`: `setup_intent_id`+`setup_intent_client_secret` set by the webhook (SetupIntent created), then `payment_method_id` set by `setup_intent.succeeded`. The plan's named end-states `awaiting_card` / `card_on_file` / `ready_to_charge` are **represented by these columns + `domain_events`, not by new enum values.** (Decision point — see §6.)

Forbidden transitions — all correctly enforced:
- Browser return URL → completed: **prevented** (`docusign-return` is UX-only).
- Client SetupIntent confirm → ready-to-charge without webhook: **prevented** (`payment_method_id` only written by `setup_intent.succeeded` webhook; UI shows optimistic "Stripe will confirm shortly").
- Pay show before brand charge `succeeded`: **prevented** (payout gated on `payments.settled_at`, set only on `charge.succeeded`).

---

## 4. Environment truth (no secret values printed)

| System | Local (`.env.local`) | Production (per STATUS.md) |
| --- | --- | --- |
| **DocuSign** | `DOCUSIGN_ENV=sandbox`; all 5 `DOCUSIGN_*` + webhook secret set | Production cutover DONE; account `18e5e14c…` on `na4.docusign.net`; Vercel vars swapped to **Production scope only** (not preview). Auth + `createEnvelope` live-verified vs `na4` (envelope `6bd19309`, voided). |
| **DocuSign Connect webhook URL** | n/a | **UNVERIFIED / likely unconfigured** — STATUS lists "Connect webhook end-to-end (needs production Connect config + secret)" as still unproven. |
| **Stripe** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` **all EMPTY** — Stripe is **unusable locally** (no test or live keys) | Mode unknown from here; STATUS calls the Stripe money loop an "unproven seam." Webhook endpoint config unknown. |
| **Public URL** | localhost — cannot receive Connect/Stripe webhooks | `https://www.taylslate.com` (Vercel) |

**Consequence for live proof:** I cannot perform any live proof from this environment. Stripe has no keys locally (not even test), DocuSign is sandbox locally / prod-only in Vercel, and Connect + Stripe webhook endpoints are DocuSign/Stripe-admin configuration only Chris can do. Automated tests (which mock Stripe/DocuSign) run fine. A **sandbox** DocuSign envelope can be minted via the committed scripts (§5) if one-time consent is granted.

---

## 5. Uncommitted in-flight Pile A work (already in the tree)

`git status` at start:
- **M `components/deals/Wave12DealClient.tsx`** — adds the A3 `DealCardSetupForm` (Elements + `confirmCardSetup`) + `needsPaymentMethod`/`hasPaymentMethod` gates on `brand_signed` deals.
- **M `lib/data/types.ts`** — adds `setup_intent_id` / `setup_intent_client_secret` / `payment_method_id` to `Wave12Deal`.
- **M `lib/stripe/payment-intent.ts`** — `chargeForEpisode` now prefers `deals.payment_method_id`, falls back to customer default (legacy). **M `lib/stripe/payment-intent.test.ts`** — updated tests.
- **?? `components/deals/Wave12DealClient.test.tsx`** — new A3 UI test.
- **?? `scripts/verify-docusign-envelope.ts`** — one real sandbox envelope end-to-end (JWT auth + createEnvelope + embedded URL); prints consent URL on first run.
- **?? `scripts/verify-docusign-tabs.ts`** — proves SignHere anchor tabs land on real IO PDFs (incl. across page break).

This is the live-proof scaffolding + A3 surface, mid-flight. Build on it; do not clobber.

---

## 6. Gap analysis vs the Pile A letter

| # | Item | Gap | Resolution (2026-08-24, "Minimal additive" scope) |
| --- | --- | --- | --- |
| G1 | A1 raw-event persistence + dedup table | No `docusign_connect_events` table; idempotency is state-guard + `domain_events`, raw payload not stored, unknown envelopes not persisted | **ACCEPTED DEVIATION.** Existing state-guard idempotency (`brand_signed_at`/`show_signed_at`/`status` guards) is well-tested (`route.test.ts` "idempotent — replayed brand_signed is a no-op"); transitions are audited in `domain_events`. A parallel raw-event table would need a migration Chris pastes; deferred to the "Full spec" option. |
| G2 | A4 `setup_intent.setup_failed` handler | Missing; failures not persisted on the deal | **DONE** — `lib/stripe/webhook.ts` `handleSetupIntentFailed`, persists `deal.setup_intent_failed` domain event keyed to `deal_id` (schema-free). Tests added. |
| G3 | A4 `payment_method.attached` handler | Missing (spec "handle at minimum") | **DONE** — `handlePaymentMethodAttached` records a customer-level `payment_method.attached` audit event; no-op on unknown customer. Tests added. |
| G4 | A4 SetupIntent reuse/retry | `provisionBrandSetupIntent` runs once; if the first Stripe call fails there was **no retry and no UI recovery** | **DONE** — new `POST /api/deals/[id]/setup-intent` (brand-only, signed-IO gate) reuses an open SetupIntent, backfills `payment_method_id` if it already succeeded, else creates a fresh one; `Wave12DealClient` recovers a missing secret on demand. Route + UI tests added. |
| G5 | A4 named deal states | `awaiting_card`/`card_on_file` are column-based, not enum values | **ACCEPTED DEVIATION.** Card-on-file lifecycle is tracked by `setup_intent_id`/`setup_intent_client_secret`/`payment_method_id` + `domain_events`; renaming the state machine is invasive vs the current tested column approach. Deferred to "Full spec". |
| G6 | Live proof (A1–A4) | None live-verified; Connect webhook, embedded signing via real route, completion→SetupIntent all UNPROVEN per STATUS; local env can't test | **HUMAN-ONLY** — see `PILE_A_PROOF.md` for the exact steps (keys, Connect admin URL + secret, Stripe webhook endpoint, live/test card). Blocked on Chris. |

Existing automated coverage is already strong: `app/api/webhooks/docusign/route.test.ts` (bad sig, no-match, brand_signed, full-sign upload+`io.completed`, declined→void, SetupIntent provision, idempotent replay), `lib/docusign/webhook.test.ts`, `lib/stripe/webhook.test.ts` (setup_intent.succeeded persist, payout-gate invariant, fail-soft, etc.).

---

## 7. Recommendation

The rail already implements A1–A4; the remaining engineering is **closing G1–G4 with small additive changes + tests**, leaving G5 as a design decision and G6 (live proof) as a documented human-run protocol. G2/G3 are unambiguous and safe to do now. G1 and G4 need a migration Chris pastes (I cannot introspect-confirm application) and a decision on whether the state-guard idempotency already in place is sufficient. Live proof (G6) is blocked on Chris's keys/Connect config regardless of code.
