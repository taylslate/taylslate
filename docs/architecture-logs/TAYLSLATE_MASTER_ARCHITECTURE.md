# Taylslate — Master Architecture Document

**Compiled:** August 19, 2026
**Compiled from:** `CLAUDE.md`, `STATUS.md` (Aug 7, 2026), `PRODUCT_BACKLOG.md` (Jul 23, 2026), `TAYLSLATE_CONTEXT.md`, `WAVE_HISTORY.md`, `WAVE_14_STRATEGY.md`, `WAVE_14_PHASE_2A/2B/2C_SPEC.md`, `PRICING_DECISIONS.md`, `TAYLSLATE_VALIDATION_WORKING_DOC.md`, `TAYLSLATE_AGENTIC_ROADMAP.md`, `020_data_api_grants.sql`, `Taylslate_Product_Specification_v1.docx`, plus planning-session history through Aug 8, 2026.

> **Provenance warning — read before trusting this document.**
> This is a *consolidation of documentation*, not an introspection of the running system. The standing project rule is that "verified" has repeatedly not matched reality here. Two sections in particular are reconstructions and are marked as such:
> - **§2 Schema** — assembled from migration notes, spec files, and the `020` grant ledger. It is **not** a `pg_dump` and **not** a read of `lib/data/types.ts`. Column lists are partial. Treat it as a map, not a source of truth.
> - **§3 Architecture** — the file-structure map is as of the July 6, 2026 restructure and has drifted.
>
> Anything load-bearing should be confirmed by introspection (Supabase SQL Editor) or by reading the repo before you act on it.

---

## Table of contents

1. [Mission, positioning, and target audience](#1-mission-positioning-and-target-audience)
2. [Data model and database schema](#2-data-model-and-database-schema)
3. [Frontend and backend architecture](#3-frontend-and-backend-architecture)
4. [Go-to-market and data acquisition strategy](#4-go-to-market-and-data-acquisition-strategy)
5. [Open bugs, verification gaps, and pending features](#5-open-bugs-verification-gaps-and-pending-features)
6. [Appendix A — Invariants and conventions](#appendix-a--invariants-and-conventions)
7. [Appendix B — Domain knowledge reference](#appendix-b--domain-knowledge-reference)
8. [Appendix C — Documentation system](#appendix-c--documentation-system)

---

## 1. Mission, positioning, and target audience

### 1.1 What Taylslate is

**Layer 3 infrastructure for podcast and long-form YouTube sponsorship advertising** — the transaction data layer and payment rail that brands, shows, and eventually AI agents operate on. It replaces the manual, weeks-long process of campaign planning, deal negotiation, IO management, delivery tracking, invoicing, and payment with one AI-assisted workflow.

**One-liner:** "Facebook Ads for podcast reads."

**Mission:** Get brands spending more money in podcasting and YouTube on the shows that convert, *and* help shows that don't get enough ad dollars find more deals. Two-sided efficient allocation. Discovery quality is not competitive differentiation — it **is** the mission. Bad discovery means the mission fails on both sides.

**Thesis:** Sponsorship advertising works and the market is growing ($4B+ podcast, $2B+ YouTube, 20%+ annually), but the buying process is stuck in 2015. Digital media has programmatic infrastructure; creator sponsorship has email threads, Word docs, and 90-day payment terms. Taylslate closes that gap.

### 1.2 The moat

The moat is the data. Everything else is a mechanism to capture it.

The most valuable data in podcast advertising — real CPMs paid, verified delivery, advertiser retention, conversion signals, *what converts on what show with what host* — exists in no API. Taylslate captures it by facilitating the actual transaction.

Three forcing functions push data through the rail:

1. **Automated verification** — watching the public internet (RSS, episode audio, YouTube) to confirm ads ran. *Planned; Podscribe preferred.*
2. **Payment facilitation** — Stripe Connect pay-as-delivers. *Wave 13, built.*
3. **Discovery reasoning library** — structured capture of every AI decision and every human confirmation. *Wave 14, built.*

Standing correction from the July 2026 validation session: **at pre-revenue there is no moat, and neither has any competitor.** A moat is built by transacting, not held before the first customer. The compounding asset only exists once deals settle. *The moat is the fuel, not the engine* — the scorer is not special; the transaction data feeding it is.

### 1.3 Positioning history

| Period | Framing | Why it changed |
|---|---|---|
| March 2026 | "AI generates a complete campaign plan" | Too autonomous; removed the brand's judgment |
| April 2026 | AI returns a scored discovery list of 50–100 shows; brand selects by checkbox; platform builds the media plan with domain logic | Matches how veteran agents actually work — long list, then narrow |
| June 2026 → | Conviction-based interpretive reasoning (rings, three-dimensional conviction, test/scale split) | SaunaBox walkthrough proved flat fit-score discovery was too weak; SpotsNow commoditized generic "URL + budget → shows" |
| July 2026 → | **Neutral rail, not marketplace rail** | Sharpest current wedge (see §4.1) |

Market education happens through the discovery-list experience itself, not through separate documentation or onboarding specialists.

### 1.4 Target audience

**Primary — brands new to podcast/YouTube creator advertising.** Not heavy spenders (they have agencies). Not agencies themselves (late adopters with workflow inertia). Profile: $30–50K monthly campaign budgets, founder-led or growth-lead-owned, often already running social through an agency but new to creator specifically.

The refined ICP from the validation work, "the animal":

- Picks specific shows on purpose and runs host-reads — **chosen, not remnant**
- Small enough that a founder or growth lead still owns the media call — **reachable, no agency wall**
- Runs podcast often enough that doing it by hand hurts — **real pain**
- One tier down from famous

Three-question pass/fail: *Repeat shows? Reachable decision-maker? In enough pain to switch?*

**Secondary user types:**

| User type | What they get | Status |
|---|---|---|
| **Shows & creators** | Pitch with proposed terms → accept/counter/decline → auto-generated IO → DocuSign → paid via Stripe as episodes deliver. Keep **100% of host-read revenue** (Taylslate's fee sits on the brand side) vs. RedCircle's 70%. | Built |
| **Shows under 10K downloads** | Systematically ignored by agencies; Taylslate removes the cost barrier of transacting with the long tail. | Built |
| **Sales agents / rep companies** | Portfolio of shows; high-leverage GTM (one agent onboards → 10–30 shows arrive). | Data model exists (`agent_show_relationships`); **UX not built** — Wave 15+ |
| **Agencies** | White-label tier. | Deferred; pricing tier exists |

**Mediums at launch:** podcast (RSS-driven audio) and long-form YouTube (channel-based). YouTube Shorts deliberately excluded — different read mechanics, unproven conversion playbook. Simulcast = one channel, two surfaces.

### 1.5 Pricing (locked April 28, 2026)

| Tier | Price | Entry point | Notes |
|---|---|---|---|
| **PAYG** | 10% transaction, no SaaS | Brand self-select, day 1 | Matches "test before pay" psychology |
| **Operator** | $499/mo + 6% | Sales-led upgrade | Breakeven ≈ $12.5K/mo spend; GMV trigger alerting built |
| **Agency** | $5,000/mo + 4% | Sales-led | White-label |
| **API / MCP** | Per-call + per-deal | Month 9–12+ | Not decided; Wave 13 logs every call to enable pricing later |

Fee sits on the **brand** side at transparent tiered rates — against VeritoneONE-style 15–20% hidden markups.

Principles: *don't gate the wedge, gate the scale features.* AI planning, discovery, IO generation, verification, invoicing, and payment are available to everyone. Customer self-selects entry; the platform never forces graduation by volume.

**Flagged for month 3–6 revisit:** Operator may be underpriced if scale customers run $50–200K/mo — possible raise to $999–$1,499 with an Operator Pro split, grandfathering the first customers.

### 1.6 Three revenue streams

Three *modes of using the platform*, not three products:

1. **Transaction (PAYG)** — human running campaigns through the UI occasionally. Day-1 entry.
2. **SaaS (Operator / Agency)** — human running campaigns consistently. Month 3+ recurring engine.
3. **API / MCP** — agents running campaigns programmatically. Month 9–12+.

---

## 2. Data model and database schema

> **Reconstruction — see the provenance warning at the top.** Table names and the columns named below are documented in the project files; the full column set for each table lives in `lib/data/types.ts` and the migration files, which are the actual source of truth.

### 2.1 Core entities

| Entity | Table | Purpose |
|---|---|---|
| **Show** | `shows` | Podcast or long-form YouTube channel. `platform: 'podcast' \| 'youtube'`. Audience data, rate cards, demographics, sponsor history. Ephemeral during discovery; persisted when a deal is created. |
| **BrandProfile** | `brand_profiles` | Persisted brand identity (name, URL, demographics, categories, goals, exclusions). Reused across campaigns. |
| **ShowProfile** | `show_profiles` | Persisted show identity (rate card, ad formats, `ad_copy_email`, `billing_email`, `brand_history` JSONB). Created via Wave 9 onboarding. |
| **Campaign** | `campaigns` | Campaign brief. `budget_total` (DECIMAL, dollars). Discovery results tie to a campaign. |
| **Outreach** | `outreaches` | Brand's pitch to a show with proposed terms. Signed JWT token in URL. `response_status`: pending → accepted / countered / declined. |
| **Deal** | `deals` | Created on outreach acceptance. Lifecycle: planning → io_sent → brand_signed → show_signed → delivering → completed. |
| **InsertionOrder** | `insertion_orders` + `io_line_items` | Per-episode line items. Modeled on the VeritoneOne IO template. |
| **Invoice** | `invoices` + `invoice_line_items` | Monthly billing document referencing IO line items. |
| **Payment** | `payments` | Stripe PaymentIntent records tied to verified episode deliveries. Stores `application_fee_amount_cents`, `platform_fee_percentage_at_charge`. |
| **Payout** | (Wave 13) | Show payout via Stripe Connect transfer. Tracks early-payout fee. |
| **AgentShowRelationship** | `agent_show_relationships` | Links sales agents to represented shows. Model exists; UX doesn't. |
| **ShowClaim** | `show_claims` | Agent/show claiming representation of a catalog show. |
| **ShowSponsor** | `show_sponsors` | Sponsor records per show. |
| **Outcome** | `outcomes` | Campaign outcome capture. |
| **Profile** | `profiles` | Auth-linked user record with `role` (brand / show / agent / agency). |
| **DomainEvent** | `domain_events` | Append-only audit log. Fat payloads, `schema_version` field, **service_role only**. Powers state-transition tracking. |
| **EventLog** | `event_log` | Fine-grained operation log (Wave 13). Every campaign generation, discovery run, IO generation, outreach send, API call. Foundation for API metering. |
| **ApiCacheLog** | `api_cache_log` | Append-only; service_role only. |

### 2.2 Pattern library (Wave 14 Phase 1, migration 019)

The reasoning-capture layer. This is the schema the investment story rests on.

| Table | Grain | Notes |
|---|---|---|
| `campaign_patterns` | One per campaign | Product attributes, customer description/summary, AOV bucket. Links to `campaigns.id`. **The row's atomic visibility is the interpretation-completion sentinel.** |
| `ring_hypotheses` | One per proposed ring | Primary + 2–4 lateral rings, confidence label, `brand_decision` (confirmed / rejected), `slot_position` (migration 025). |
| `conviction_scores` | **Per (pattern, show, ring)** | Three sub-scores + composite, band, reasoning text, `tier`, cost columns. **No `campaign_id` column** — links via `campaign_pattern_id`. Show-level rollup (highest band across a show's rings) is mandatory. |
| `analog_matches` | Per matched prior campaign | `analog_pattern_id` FK added in migration 022. |
| `founder_annotations` | Per show | Veteran knowledge captured as structured labeled data. |

Plus two columns on existing tables: `show_profiles.brand_history` (JSONB) and `shows.audience_purchase_power`.

**Key schema gotcha:** the migration-019 header comment says `conviction_scores` is "per (campaign, show)". That is **stale** — the real grain is per-ring, and every tier query and index keys on `campaign_pattern_id`, never `campaign_id`.

### 2.3 Migration ledger

Migrations **001–032 applied and introspected**. Numbers documented in project knowledge:

| # | Contents |
|---|---|
| 001 | Initial schema — shows, brand/show profiles, deals, insertion_orders, io_line_items, invoices, invoice_line_items, payments, agent_show_relationships. RLS policies, indexes on `deals(agent_id/brand_id/status)`, `insertion_orders(deal_id)`, `invoices(io_id)`. `updated_at` triggers. |
| 013–014 | Wave 12 DocuSign — `outreaches`→`deals` ON DELETE CASCADE, envelope/signature fields |
| 015–018 | Wave 13 financial layer — payments, payouts, plan/fee fields, `event_log` |
| **019** | Pattern library (five tables) + `show_profiles.brand_history` + `shows.audience_purchase_power` |
| **020** | **Data API grants** — re-asserts `service_role` / `authenticated` / narrow `anon` on all tables (see §2.4) |
| 022 | `analog_matches.analog_pattern_id` FK + `interpretation_locks` sentinel |
| 023 | Reconciliation of 015/016/018 — *the migrations recorded as applied that had never actually run* |
| 024 | `persist_interpretation` RPC — pattern + rings + analogs in one transaction |
| 025 | `persist_*` RPCs + `ring_hypotheses.slot_position` |
| 026 | `shows.surfaces` + `shows.medium_priors` (JSONB) — simulcast + medium-specific priors |
| 027 | `discovery_locks` |
| 028 | `conviction_scores` cost + curation: `per_spot_cents`, `three_spot_cents`, `cpm_used_cents`, `cost_basis` (check: derived/flat_fee/rate_card), `cost_is_estimate`, `needs_quote`, `brand_saved`, `brand_dismissed`; index on `(campaign_pattern_id, tier)` |
| 029 | `campaigns.test_spot_count`, `campaigns.test_placement`, `conviction_scores.cpm_override_cents`, `conviction_scores.placement_override` — *applied ahead of the Layer 5 UI, which is still unshipped* |
| 030 | `deals.promo_code` |
| 031 | `shows.is_discoverable` (BOOLEAN NOT NULL DEFAULT TRUE) — non-catalog materialized shows and seeds flagged FALSE, excluded from discovery reads |
| 032 | Widened `episode_cadence` CHECK on both tables to admit `multiple_weekly` |

*Gap: 002–012 and 021 are not individually documented in project knowledge. Read `supabase/migrations/` for the real list.*

### 2.4 Access control model

Three layers, checked in order: **grants → RLS → application predicate.**

**Grants (migration 020):**
- `service_role` — full CRUD on every table. Server code depends on this; grants are checked *before* RLS, so a missing grant breaks server queries even when RLS would allow them.
- `authenticated` — full CRUD on every table the logged-in app touches. RLS filters which rows.
- `anon` — **SELECT only, two tables:** `shows` and `show_profiles` (backs the public pitch page). Nothing else, ever. Never on deals, payments, or pattern-library tables.
- Append-only audit logs (`domain_events`, `api_cache_log`) are deliberately **service_role only**.

**Why this matters going forward:** Supabase is changing Data API behavior — new `public` tables are no longer auto-exposed to PostgREST/supabase-js, enforced on all existing projects **October 30, 2026**. Migrations 001–019 are grandfathered; columns added later to a grandfathered table inherit its grants. **Every new `CREATE TABLE` in `public` must carry its own grant block**, placed before the RLS/policy block, or it fails with `42501`.

**Application-level ownership** is defense-in-depth over RLS, not a substitute. `callerOwnsDeal` gates `deals/[id]` GET/PATCH/DELETE and returns 404 (not 403) to non-owners so UUIDs aren't probeable. Public `shows/[id]` GET 404s non-discoverable rows.

### 2.5 Money units — known inconsistency

Money representation is **not consistent across the codebase**, and this is flagged as review-gate territory:

- Legacy money is **dollars**: rate-card CPMs as plain numbers (`22`), `campaigns.budget_total` as DECIMAL dollars.
- Migration 028's cost columns are **cents** (`*_cents`).

Any code crossing that boundary must convert explicitly. Do **not** add a `test_budget_cents` column — read `budget_total` and convert in code.

---

## 3. Frontend and backend architecture

### 3.1 Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js (App Router), TypeScript, Turbopack** | Next 16 — `middleware` renamed to `proxy` |
| Styling | **Tailwind CSS 4** + custom CSS variables in `app/globals.css` | |
| Database / Auth | **Supabase** (Postgres + Auth) | SQL Editor only — no CLI |
| Deployment | **Vercel**, auto-deploy from GitHub `main` | `taylslate.com`, served from `www` |
| AI | **Claude API** | Campaign planning, outreach/pitch drafting, brief analysis, discovery reasoning. Model via `LLM_MODEL` env var, centralized in `lib/llm/client.ts` |
| Payments | **Stripe Connect** (Express) | SetupIntent card-on-file, pay-as-delivers per episode |
| E-signature | **DocuSign** | Production on `na4`, Developer Starter $75/mo month-to-month |
| Email | **Resend** | `taylslate.com` verified |
| Podcast data | **Podscan** | Category Leaders, Podcast Search, Discover (vector similarity) |
| YouTube data | **YouTube Data API v3** | |
| Verification | **Podscribe** (planned) | RSS/transcript fallback |

### 3.2 Architectural principle — agent-native design

**The web app is the on-ramp; the API is the real product.** Five layers:

1. Database + API — persists across agent sessions
2. Domain logic engine — IO rules, CPM math, make-good thresholds, invoicing
3. Aggregated intelligence layer — pattern library, conviction reasoning, outcomes; grows with every transaction
4. Packaged skills / MCP server
5. Lightweight web UI

Build order: web app captures data → clean API from day one → skills/MCP → web app becomes one of several interfaces.

**Consequences that bind current work:**
- All business logic lives in **server-side API routes**, never buried in React components.
- Every state transition **emits a domain event**.
- Every endpoint is documented **as if an external agent will call it** — because one will.
- Third-party engines (ASR, hosting platforms, attribution) must be **pluggable**: swaps are config changes, not refactors.

**Integration philosophy:** don't build bespoke integrations to every platform — build a clean API that agents bridge. Direct-build exceptions, for regulatory or core-value reasons: Podscribe, DocuSign, Stripe Connect.

### 3.3 Agentic product test

Every form field must pass: **"Is this asking for a decision, or for mechanical work?"**

- **Decisions stay manual** — budget, campaign goals, competitor exclusions, final sign-off.
- **Mechanical work gets AI-derived with human confirm/edit** — brand name, category, demographics, CPM defaults, episode-count standards, pitch drafting.

The canonical instance is the discovery interpretation checkpoint: AI proposes 1 primary read + 2–4 lateral rings → brand confirms or refines → AI then runs autonomously through ring location, conviction scoring, sampling, and portfolio construction.

### 3.4 Route and directory map

*As of the July 6, 2026 restructure — has drifted; verify against the repo.*

```
proxy.ts                              # Auth gate (Next 16's renamed middleware).
                                      # isPublicRoute allowlist — ANY new signed-out-reachable
                                      # route MUST be added here or its handler never runs.
app/
  page.tsx                            # Landing (dark navy)
  globals.css                         # Design tokens
  (auth)/login, signup, callback      # NOTE: the ONLY callback route is /callback
  (dashboard)/
    layout.tsx                        # Authenticated layout + sidebar
    dashboard/page.tsx                # Role-aware home (brand / show / agent)
    campaigns/                        # new, [id], plan, outreach
    deals/[id]/                       # Wave 12+13 deal view
    invoices/
    shows/page.tsx                    # Agent show roster
    settings/                         # Settings + billing
  outreach/[token]/page.tsx           # PUBLIC pitch page (signed JWT)
  auth/magic/page.tsx                 # Magic-link landing for shows
  onboarding/
    brand/                            # 9-step brand flow
    show/                             # 10-step show flow
  api/                                # All server endpoints
components/
  layout/Sidebar.tsx
  deals/Wave12DealClient.tsx
  payments/                           # Connect onboarding, card form
  outreach/                           # Composer modal, show list
  io/                                 # IO generator, preview
lib/
  data/types.ts                       # All TypeScript types — schema source of truth
  data/queries.ts                      # Supabase query functions
  data/reasoning-log.ts               # Pattern-library write helpers (fail-soft)
  data/event-log.ts                   # Domain events (fail-soft)
  discovery/discover-shows.ts          # Multi-platform discovery orchestrator
  enrichment/podscan.ts                # LIVE Podscan client
  podscan/                             # Wave 5 scorer only — DEAD CODE
  scoring/weights.ts                   # getEffectiveWeights() + AOV tilt
  scoring/index.ts                     # Wave 5 scorer — DEAD CODE
  prompts/derive-product.md
  prompts/interpret-brief.md
  pdf/io-generator.ts                  # Current IO PDF
  pdf/io-pdf.ts                        # Legacy IO PDF
  docusign/anchors.ts                  # Single source of truth for signature anchors
  io/cadence-days.ts                   # Centralized cadence→days spacing
  format/date-only.ts                  # formatDateOnly (UTC) — single source of truth
  auth/onboarding-return.ts            # Pitch-return cookie + open-redirect guard
  email/templates/outreach.ts
```

### 3.5 The transaction pipeline

```
Brand brief (URL + budget + demographics)
   ↓ LLM: derive-product.md          → structured product data, AOV bucket
   ↓ LLM: interpret-brief.md         → 1 primary ring + 2-4 lateral rings, confidence
   ↓ Brand confirms / refines rings  ← THE INTERPRETATION CHECKPOINT
   ↓ persist_interpretation (RPC, one transaction)
   ↓ runConvictionDiscovery          → Podscan candidates, three-dimensional scoring
   ↓ Deterministic tiering (2C)      → test portfolio / scale tier / bench
   ↓ Brand selects test-tier shows   → adapter writes to Wave 7 plan path
   ↓ Media plan builder              → per-show CPM, episodes, placement, flight, line total
   ↓ Outreach composer               → LLM-drafted pitch, signed-JWT public pitch page
   ↓ Show accepts / counters / declines
   ↓ Deal materialized AT ACCEPT     (even before the show onboards)
   ↓ IO auto-generated (VeritoneOne format) → PDF
   ↓ DocuSign: brand signs, then show signs
   ↓ Stripe SetupIntent — card on file at signature
   ↓ Per-episode delivery verified   → charge brand → payout show
   ↓ Outcome data → pattern library  → next campaign is smarter
```

**Determinism boundary, deliberate:** 2A (interpretation) and 2B (reasoning prose) call an LLM. **2C calls no LLM at all** — cost derivation and tier classification are pure deterministic functions, and reasoning is read from persisted scores rather than regenerated. Keeps the split calibratable and the data moat clean.

### 3.6 Discovery engine

**Scoring evolution:**

- *Wave 5 (dead):* flat weights — audience fit 40%, ad engagement 30%, sponsor retention 20%, reach 10%.
- *Wave 14 (live):* three-dimensional conviction — **audience fit + topical relevance + purchase power** → composite → band (high / medium / low / speculative). AOV-aware tilt: when `aovBucket='high'`, purchase-power weight rises to 0.20 and reach drops to 0.05.

**Rings** are product-determined, not budget-determined. SaunaBox's conviction ring is "premium home wellness customers" whether the budget is $5K or $500K. Budget controls sampling depth, not ring location.

**Domain corrections that override framework instinct** (from the SaunaBox walkthrough, April 30, 2026):
- Audience demographics matter **more** than topical relevance for high-AOV products.
- Purchase power is its own filter above ~$1K AOV; irrelevant below ~$50.
- **Convergence beats single signals.** Three-of-three = strong. Two = testable. One = speculative.
- Read quality is real signal: host personally reads > DAI aggregator format > programmatic insertion.
- **3-spot budget viability gates everything** — 99% of podcast tests are 3-spot tests.

**"More results, not fewer"** — deliberate and against recommender instinct. Loosen thresholds, paginate and filter rather than trim. Surface the *why* for each result. Brands new to podcast want options, not a curated three; veteran agents work from a long list too.

**Brand safety is metadata — shown, never used to exclude.**

### 3.7 Auth architecture

Two paths, deliberately unequal at launch:

- **Brands:** email/password. Hardened in three layers (July 8–9, 2026) — correct `emailRedirectTo`, enumeration-safe copy, 8-char minimum, `/forgot-password` + `/reset-password` with a server-component recovery gate, and Cloudflare Turnstile bot protection inside Supabase Attack Protection.
- **Shows:** magic-link + OTP, entered via the outreach pitch path only. The role picker no longer offers Show/Creator to a password signup.

**Unification to magic-link+OTP for all is deferred, post-launch acceptable.** Decision: keep passwords for launch.

**Load-bearing auth invariants** (each cost a production bug to learn):
1. The only callback route is `/callback` — the `(auth)` group is stripped from the URL. There is **no** `/auth/callback`; redirecting there 404s.
2. `admin.generateLink()` returns an **implicit-flow** link (token in the URL fragment, unreadable server-side). Read `properties.hashed_token`, build `/callback?token_hash=…&type=…&next=…`, verify with `verifyOtp({ type, token_hash })`.
3. `/callback` must be in the `proxy.ts` allowlist or unauthenticated magic-link users bounce to `/login` before `verifyOtp` runs.
4. Magic emails must point at `/api/auth/magic` (the consuming route), not `/auth/magic` (a static page that ignores the token).
5. `next` params are validated to a same-origin path on both callback branches — open-redirect guard.
6. Supabase email templates must keep the `{{ .SiteURL }}/callback?token_hash=...&type=...&next=...` pattern. It is an auth invariant, not styling.

**Founder impersonation** (all 3 layers shipped): `INTERNAL_ADMIN_EMAILS` gates sidebar "Log in as …" buttons over a fixed `TEST_ACCOUNTS` set. Return-to-admin uses a 256-bit opaque capability token, **sha256 hash only at rest** in the `admin.impersonate` audit event, raw token in an httpOnly cookie, admin identity resolved server-side from the audit record's `actor_id` re-checked against the live allowlist. Atomic single-use via a deterministic-PK sentinel that collides on `23505` → 403. 8h TTL.

### 3.8 Reliability patterns

| Pattern | Rule |
|---|---|
| **Fail-soft audit** | `logEvent()`, `logEventLog()`, and all `reasoning-log.ts` helpers swallow errors and log. Audit failures **never** block main flow. |
| **Sentinel-row idempotency** | Preferred over advisory locks — PostgREST connection pooling breaks session affinity. Interpretation and discovery locks work this way; crash-orphans expire by TTL. |
| **Settlement-gated payouts** | Show payout never fires until inbound payment is `succeeded`, not `processing`. Hard rule. |
| **`SECURITY INVOKER`** | Default for all RPCs. |
| **Narrow exception scoping** | `WHEN foreign_key_violation` only — **never** `WHEN OTHERS` (hides bugs). |
| **`LLM_MAX_RETRIES = 0`** | Non-zero retries can push worst-case duration past `LOCK_TTL_MS`. |
| **Durable over session state** | Domain events table append-only, strictly by convention. |
| **Compute-on-read fallback** | Tier/cost persistence failure degrades to computing on read; never crashes the view. |
| **Runtime tripwires** | `verifyEnvelopeTabsPlaced` fires post-response to catch silently-dropped DocuSign anchors. |

### 3.9 Review and deployment discipline

- Layered builds — each layer its own commit, tests green before the next layer starts.
- **Codex adversarial review between layers** as standing practice; tight manual gates on migrations and money math.
- Single-file-scoped commits, auto-push to `main`, Vercel deploys from `main`.
- **"Committed ≠ deployed"** — every layer ends with push → Vercel green → live-URL verify.
- **"Applied = introspected"** — a migration is applied only when SQL Editor introspection confirms the object exists.
- Fresh chat per sub-phase before speccing the next one; prevents drift and stale assumptions.
- All LLM calls mocked in CI with deterministic fixtures; manual real-LLM validation before merge.
- Pre-commit tripwire: `grep -P '[^\x00-\x7F]'` across generated migration and TypeScript files to confirm no non-ASCII in code output.

**Current build state:** 1,029+ tests across 94 files; migrations 001–032 applied and introspected; production at `taylslate.com`.

---

## 4. Go-to-market and data acquisition strategy

### 4.1 The wedge

Two framings, both live:

**1. Neutral rail vs. marketplace rail.** SpotsNow is a marketplace — supply onboards, inventory lists, agents book what's listed. *A marketplace is bounded by its own supply.* The deal that isn't in their catalog — a direct relationship, a show that never onboarded, off-marketplace inventory — is structurally invisible to them and native to Taylslate. **Stripe (rail for anyone's transaction) vs. Amazon Pay (payments for one marketplace).** They coexist because they're different products.

The wedge sentence: **"the deal a brand already chose, executed transparently."**

**2. Transparent vs. opaque agency.** Independent of any competitor: the VeritoneONE 15–20% hidden-markup wound is still open. A remnant marketplace taking its own cut doesn't heal it — arguably it adds a middleman.

**The unknown that only brands can answer:** how many brands run chosen, direct deals versus just buying remnant. That's what validation is for.

### 4.2 Competitive map (as of July 2026)

| Competitor | Class | Read |
|---|---|---|
| **SpotsNow** | The real competitor | "AI operating system for podcast advertising" — AI search, planning, projected ROAS, direct booking, negotiation, ROI attribution, both-sided, **MCP-native and live in Claude/ChatGPT**. Remnant/last-minute marketplace, additive to agencies, appears to preserve existing IOs and payment terms. ~61K indexed shows. Ex-Thumbtack founder (Cam Pritchard). Real traction, big logos. |
| **VeritoneONE / Ad Results** | Incumbent agencies | 15–20% markup, manual, ignore small shows. The model Taylslate displaces. Their planners' 20 years of pattern recognition is what the pattern library substitutes. |
| **RedCircle** | Supply-owning hosting network | 30% take on host-read. Distinct class, not a direct rival. |
| **CastFox** | Data vendor | Research/discovery only; hands you off to pitch the host. Cheap RapidAPI catalog. Not a rival. |
| **LiveRead.io** | Operations | IO/invoice management, real integrations. No AI, no discovery, no planning. |
| **Gumball.fm (Headgum)** | Network marketplace | Own inventory only, 10K download minimum. |
| **Podscribe** | Verification/attribution | IAB-certified. **Integrate, don't compete.** |
| **Podscan / Rephonic** | Data providers | Podscan is the current primary; Rephonic the backup. |

**The open question that decides differentiation:** does SpotsNow own the *settlement* rail — IO, e-sign, pay-as-delivered, payout, verified delivery — or stop at booking + attribution? Evidence leans "stops short." **Confirmable in an hour by running their booking flow to the pay step.**

**MCP is no longer an edge** — they shipped it. The edge is *what the MCP exposes*: a settlement rail vs. a search index. Standing decision: **ship the rail first, then expose it via MCP.** Do not pull MCP forward to match SpotsNow.

Their discovery/intelligence layer is non-defensible and being commoditized. Settlement + verified delivery + ESIGN is a regulated financial product, not a feature — that's the window, and it's narrowing, which argues for **speed**.

### 4.3 The signal ladder

Weak = free to say. Strong = they give up something scarce. Each rung ≈ 10× the one above.

1. **Compliments / hypotheticals** — "I'd use that." Worthless.
2. **Pain shown, not told** — pulls up the real spreadsheet, names a deal that burned them.
3. **Scarce resource spent** — books a second meeting, loops in a colleague, sends an intro.
4. **Commitment** — "run my next campaign through it," with budget and date.
5. **Money moves** — they transact. Then again.

The bridge from "has pain" to "buys" is not a better pitch — it's a **small, de-risked ask**: one campaign, one show, hand-held, pay-as-delivered so they're never exposed. If they still won't, the pain wasn't sharp enough. *That's an answer too.*

### 4.4 The sales motion

**Selling is not the enemy of validation — selling is how you validate.** One conversation, three beats:

1. **Open on their world** (~5 min) — how do you run podcast now, what's the annoying part? Not coyness; it aims the demo at *their* pain.
2. **Show it** — demo pointed straight at what they just complained about.
3. **Ask for something real** — "want to run your next buy through it? I'll hand-hold it, pay-as-delivered, you're not exposed." **That ask is the strong signal.**

**Honest cold outreach:** it *is* cold — own it. Disclose upfront that you're building a tool. Once that's on the table, "I want to learn how you buy" is transparent rather than bait-and-switch. Don't cosplay friendship.

**Channel note:** cold LinkedIn is slow and gated. Speed comes from **warm nodes** — industry contacts from the SaunaBox seat, the sales-agent friend, anyone who can intro. *Three warm conversations this week beat thirty cold asks that trickle in next month.*

**Standing rule: Chris writes first-touch outreach personally.** AI-authored relationship-building is a meaningful downside. AI-authored conviction reasoning prose, interpreted briefs, and internal documents are on-brand; cold outreach to shows and brands is not.

### 4.5 Target list

**Wedge tier — the first calls:** ARMRA, Grüns, Momentous, CookUnity, Good Ranchers, Tecovas, Supersure, Vaer. Several sit in the same wellness-DTC world as SaunaBox — same shows, sometimes shared inventory — which makes outreach peer-to-peer rather than stranger-cold.

**Whales — skip for now** (agency-gated, unreachable pre-revenue): SimpliSafe, PolicyGenius, Mint Mobile, Rocket Money, ZocDoc, Helix, Boll & Branch, Quince, Tommy John, Birch Gold, PureTalk, Fast Growing Trees.

**Not the buyer:** Vanta, Mercury, Blitzy, TastyTrade (B2B/fintech); political-DR advertisers.

**Named GTM relationships:**
- **SaunaBox** — existing media-buying relationship, design partner. Chris is the contact for Nolan.
- **Sales agent with show roster** — requires compensation; near-term outreach target once the rail is live. High leverage: one agent onboards → 10–30 shows arrive.

### 4.6 Data acquisition — the "scraping" strategy

Two entirely separate programs that are easy to conflate. Keep them separate.

#### (a) GTM prospect sourcing — manual, free, deliberately un-automated

**The free sourcing engine, no $2,500 tool:** pick a show you already listen to → read the last three episodes' show notes → the sponsors and promo codes are printed right there. Repeat across 3–4 shows → your ten.

This is the documented method and it is deliberately manual. Rationale: *you don't need many. You need ten good ones, then three you actually call. A list of 200 is procrastination; the hard part is hitting send.*

**Explicitly not used for sourcing:** Podscan's sponsor-detection endpoint. The wedge-tier list above was built from show notes and promo codes, not from Podscan sponsor detection.

**The one automated GTM signal:** **Podscan Sponsor Alerts** configured on the wedge-tier brand list — fires when a target brand appears in a new episode, giving a live buying-signal trigger for timely outreach.

#### (b) Platform supply data — licensed APIs, never crawled

| Source | Status | Terms posture |
|---|---|---|
| **Podscan** | **Primary, live.** 4.4M podcasts, 51M episodes, real-time firehose. Used via Category Leaders (pool building, 500 shows/category), Podcast Search (filters), Discover (vector similarity). Founder publicly encourages building on the API. | ToS page returned 403 during evaluation — **direct conversation with founder still owed to verify terms.** |
| **YouTube Data API v3** | Live, for YouTube channel enrichment. | Standard |
| **Rephonic** | Evaluated, backup. Most permissive commercial terms of any provider; agency use explicitly permitted; light competitive clause. | Clean |
| **ChannelCrawler** | YouTube expansion candidate. **Negotiate a custom MSA before building any data dependency** — a B2B license is likely required for commercial use. | Blocked pending contract |
| **Podchaser Pro** | **Rejected.** ToS prohibits commercial use on free tier; written permission needed for Pro; "competing product" termination clause. | Hostile |
| **PodEngine** | **Rejected.** Strong sponsor extraction, but aggressive competitive restrictions naming competitors and **$50K liquidated damages**. | Hostile |
| **Listen Notes** | **Rejected for primary.** Commercially friendly, but missing demographics, reach estimates, and sponsor history — the fields that matter for media buying. | Insufficient |
| **Podscribe** | Verification/attribution partner at launch, not discovery. IAB-certified. | Integrate |
| **Microsoft VibeVoice-ASR** | Long-term self-hosted option, post-launch. | Future |

**Partner contract requirements — every strategic vendor, no exceptions:** mutual non-compete (partner cannot build campaign planning, IO/transaction tools, discovery, or marketplace features), no customer poaching either direction, no data use to compete, no selling of customer data, change-of-control termination rights if acquired by a hostile party. **Lawyer review on every contract; 6-month pilots before multi-year terms.** This defends against the Salesforce/Slack and HubSpot/CRM precedents — and matters more as the agentic roadmap makes Taylslate visible to partners as a rail.

#### (c) What no API has — the proprietary layer

These fields are the entire data advantage and can only be captured by facilitating the transaction:

- **Actual CPM rates paid** — scattered across rate cards, email threads, individual negotiations
- **Verified download numbers** — only the hosting platform has real numbers; all APIs estimate
- **Conversion performance** — locked inside agencies and brands; nobody sells it
- **Ad inventory availability** — only the show or its agent knows what's open
- **Ad format preferences** — unstructured everywhere
- **Advertiser retention / repeat-buy signals** — the strongest conversion proxy. A brand running 12 months on a show is converting.
- **Payment reliability** and **make-good history** — behavioral, transaction-only

### 4.7 Attribution — what's honestly measurable

Taylslate is a **signal aggregator, not a measurement platform.** The temptation is to overpromise; brands have heard the overpromise from every podcast platform and are skeptical for good reason.

**Day 1:** promo codes captured at IO time; auto-generated UTM-tagged tracking links per deal; brand-reported attribution where shared. Apply the **2x leak rule** when displaying — double measured conversions to account for lost codes, search-by-name, and attribution-window expiry.

**Long-term:** Podscribe pixel integration; **renewal as conversion proxy** (a brand re-running on a show means it converted); lift studies once $200K+ campaigns are routine.

**The honest framing for brands:** best conviction-based discovery, every conversion signal captured, hard attribution acknowledged as a known industry challenge — here's exactly what we measure and how we use it. This is credible *because* it's not the unrealistic version.

### 4.8 Launch sequence

1. **Finish the minimum sellable rail** — verify the money loop end-to-end once; complete production cutovers; a half-day credibility pass on the ~5 screens and transactional emails a prospect touches. **Not** the discovery UX. **Not** a rebrand.
2. **Demo it and sell it** — the three-beat call, to real in-market brands.
3. **Land one real transaction** — the strong signal, the answer to every investor objection at once.
4. **Then raise from strength — or skip it.**

**On backing:** backing is downstream of demand; demand is proven by one transaction. Bootstrap to a first customer, then raise from strength or don't need to. A studio is the most dilutive way to solve "I'm solo." Guardrail: **keep the SaunaBox income — make backing optional, not oxygen.**

**Pre-launch order (locked Aug 8, 2026):** Pile A (money-rail verification) → Pile B (frontend/polish). Polish only the screens real outreach confirms matter.

---

## 5. Open bugs, verification gaps, and pending features

### 5.1 Pile A — money-rail verification (THE LAUNCH GATE)

Nothing ships to a paying customer until these are proven with **live proof against the real API**, not a green suite.

| # | Item | State |
|---|---|---|
| A1 | **DocuSign Connect webhook on the production account** — end-to-end, never fired against prod | **UNVERIFIED** |
| A2 | **Embedded brand signing via the real `send-to-docusign` route** (`getBrandSigningUrl`) — the sandbox harness used two email signers, not the embedded recipient-view the product actually serves | **UNVERIFIED** |
| A3 | **completion → deal transition → Stripe SetupIntent chain** — the seam where DocuSign and Stripe join. Treat A1–A3 as **one continuous chain run**, not three separate proofs; prior "end-to-end" claims failed at exactly this seam. | **UNVERIFIED** |
| A4 | **Stripe live money loop** — card capture at signature. **Never run against live Stripe.** | **UNVERIFIED** |
| A5 | **Email deliverability rehearsal** — outreach has never been sent to a real external inbox; **DMARC unconfirmed** | **UNVERIFIED** |
| A6 | **`buildFromAndReply()` from-name bug** (below) — moved *into* Pile A because a rehearsal with a broken `From:` line produces invalid signal | **OPEN** |

**A6 detail — outreach email "from name" bug.** `buildFromAndReply()` in `lib/email/templates/outreach.ts` receives `brandName` = *the full brief paragraph* instead of the brand name, so outreach emails show paragraph-length "from" lines. Fix: add a dedicated `brand_name` field on the brand profile and route the outreach pipeline through it. Effort 2–3h. GTM-blocking.

**Related known gap:** **no external alert is wired on `domain_events`.** The `io.tabs_unverified` tripwire is only as good as a query someone runs — add a saved query or alert before relying on it in production.

**Standing correction to the record:** the July "live-verified end-to-end" entries were inaccurate. The DocuSign API dashboard showed **zero API calls across all of July** — envelope creation had never executed against the real API. The signature loop first genuinely ran **Aug 4 (sandbox)** and **Aug 7 (production)**.

### 5.2 Production cutovers

DocuSign go-live is **executed**: Developer Starter $75/mo month-to-month, production keypair on `na4`, JWT consent granted, all five `DOCUSIGN_*` Vercel vars cut to **Production scope only** (Preview deliberately excluded so branch/PR builds can't make live DocuSign calls). Auth proven with a real envelope against `na4.docusign.net`.

Two silent bugs were found and fixed during go-live:
- **Anchor-tab mismatch** — the IO generator rendered signature blocks as "ADVERTISER"/"PUBLISHER" while `createEnvelope` anchored tabs to strings absent from the document. **DocuSign silently drops unmatched anchors and returns 201 with no error.** Fixed with a shared `lib/docusign/anchors.ts` single source of truth plus the `verifyEnvelopeTabsPlaced` runtime tripwire.
- **Hardcoded `www.docusign.net` REST base** — would have failed for the `na4`-provisioned production account. Replaced with `getUserInfo` `base_uri` discovery rather than an `na4` hardcode.

Remaining cutovers to confirm:

- [ ] DocuSign Connect webhook URL → `taylslate.com/api/webhooks/docusign` (+ HMAC secret)
- [ ] Stripe webhook endpoint → `taylslate.com/api/webhooks/stripe` (+ `STRIPE_WEBHOOK_SECRET`, Wave 13 event list)
- [ ] Supabase project Site URL + auth Redirect URLs → `taylslate.com`
- [ ] Vercel `NEXT_PUBLIC_SITE_URL=https://taylslate.com`

*Proofs run against the wrong host are invalid and have to be redone — close these before any live rail proof.*

### 5.3 Pile B — frontend and polish (sequenced after A)

| Item | Detail | Effort |
|---|---|---|
| **Brand onboarding fixes** | Hybrid AI-prefill from URL (currently full manual); remove duplicate age question; remove artificial 1–5 category and 1–3 goal caps; add "Back to Summary" CTA | 2–3 days |
| **Campaign brief formatting** | Replace the single jumbled paragraph with structured fields (Brand, Product, Audience, Segments, Categories, Goals, Exclusions); render structured in outreach templates and pitch pages. *This is the **display** fix — Phase 2 reshaped intake, not display.* | 1–2 days |
| **Transactional email branding** | Confirm-signup email is functionally correct but bare — plain link, no branding, no warmth. First impression for real strangers. Keep the `token_hash` link pattern intact; it's an auth invariant. | ½–1 day |
| **Outreach UX copy** | "Reach out" → "Compose outreach"; tighten pitch system prompt for direct tone; replace "Claude is writing your pitch…" with "Taylslate is drafting…" | ½ day |
| **Pitch page deal value** | Proposed Terms should show total deal value: CPM × episodes × audience/1000 | 2–3h |
| **Media plan editable CPM** | CPM is editable downstream but not visibly editable on the plan screen — add edit affordance | ½ day |
| **Onboarding summary button label** | Reads "take me to my dashboard" but a show onboarding from a pitch now returns to the **pitch**. Pass a `hasReturn` flag from the server component and switch copy. | 1–2h |
| **Post-accept dead end** | After accepting, the pitch panel says "you can close this tab" — but a just-onboarded show has a dashboard. Add "Go to my dashboard" for authenticated shows; keep close-tab copy for the public/forwarded case. | 1–2h |
| **Sidebar seed/teardown buttons** | The seed loop is endpoint-only today | small |
| **2C Layer 5 (overrides + recompute)** | Migration 029 columns applied ahead of the UI; the UI is unshipped. **Optional, not GTM-blocking.** | — |

### 5.4 Known defects and accepted tradeoffs

| Item | Severity | Status |
|---|---|---|
| **Promo-code cleared-state ambiguity** | Medium (Codex-flagged, accepted) | With a single nullable `deals.promo_code`, "explicitly cleared" and "never touched" are indistinguishable on reload — a brand who clears a code sees the derived show-name default re-seed on next mount. **Display-only; the DB correctly stays `null`.** Accepted because ~99% of codes match the show name. Fix if it bites: add a `promo_code_confirmed_at` marker column. |
| **`promo_code` missing from the signed IO PDF** | Real gap, not cosmetic | The promo code is part of what brand and show agree to, so it belongs on the signed document. Deferred from 2D Layer 3. File: `lib/pdf/io-generator.ts`. |
| **`shows.demographics` is always `{}` in prod** | **Biggest discovery-quality gap** | The live conviction path never fetches demographics. The only code that does (`lib/podscan/demographics.ts`) feeds the dead Wave 5 scorer. **We already pay Podscan for this data — it's wiring, not integration.** ~1 day. The real cost question is fetch strategy: per-candidate on discovery vs. on select vs. cache-and-backfill (API cost / rate-limit budget). |
| **Two parallel Podscan clients** | Debt, not demo-blocking | `lib/enrichment/podscan.ts` (LIVE) vs. `lib/podscan/` (Wave 5 scorer only, dead). Two clients invite wiring a new fetch into the wrong one. Consolidate: 1–2 days. |
| **Wave 5 scorer is dead code** | Debt | `lib/scoring/index.ts` + `scoring/dimensions/audience-fit.ts` — orphaned, nothing imports them; live discovery is `runConvictionDiscovery`. **Delete-vs-keep is coupled to the demographics decision** — that audience-fit logic is the natural home for a revived scorer. Don't delete then rebuild. |
| **`shows.past_sponsors` is dead schema** | Debt | Never written by prod code (test seed only), never read. Drop it, or document why it stays. |
| **`shows.rss_url` is store-only** | Note | Written from Podscan; the feed is never fetched or parsed anywhere. |
| **`shows.current_sponsors`** | Note | Written only by the admin enrich route, empty from automated discovery; surfaced in the outreach prompt and campaign UI, **never scored**. |
| **Stale conviction scores on re-confirm** | Correctness, small | A brand who refines a ring and re-confirms lands on discovery with stale `conviction_scores`, so `hasScores=true` and the view doesn't auto-fire — the refined ring renders empty until "Re-run discovery" is clicked. Fix: call `clearConvictionScores(pattern.id)` in the confirm route. ~3 lines. Non-corrupting today. |
| **Non-English shows surface unfiltered** | Small | Add a language filter to the discovery query. Few hours. |
| **`flat_fee` meter-vs-plan mismatch** | Moot at launch | Budget meter excludes flat_fee; media plan prices it. Blocks YouTube discovery only. |
| **Scale-watchlist tier validation / non-atomic plan double-write** | Degrade safely | Logged 2C deferrals. |
| **Migration 032 CHECK-drop breadth** | Low (accepted) | Drops "any CHECK referencing `episode_cadence`" via introspection; could over-drop a hypothetical future cross-field constraint. Kept as-is — already applied in prod, and safer than guessing the unnamed original constraint's name. |
| **Q5 stale-tier invariant** | Standing | Safety relies on "only composite ≥ MEDIUM_FLOOR rows persist." If below-floor rows ever persist, the confirmed-ring stale-tier case reopens. |
| **Test-show injection into discovery** | Open workaround | Discovery returns real Podscan shows whose email you don't control. The impersonation + seed-deal tools cover option (b); injecting a fabricated test show into discovery results (option a) remains unbuilt. |

### 5.5 Pending features by trigger

**Wave 15+ (post-launch, sequenced):**
- **Agent/rep accounts** — multi-show portfolio UX. High-leverage GTM; data model exists, UX doesn't.
- **Scale mode UX** — ongoing monthly ops, portfolio rebalancing, annual commitments, weekly cadence. Distinct from the current diagnostic/test mode. Aligns with the Operator conversion moment. 3–4 weeks.
- **Direct show search** — brands arriving with a specific target list have no way to search by name. Hits Podscan search, coexists with AI discovery. 2–3 days.
- **Saved show lists / favorites** — "my known performers" for repeat campaigns.
- **Podscribe verification integration** — replaces the internal admin "mark delivered" stub.
- **MCP server** — **ship the rail first, then expose it.** Do not pull forward to match SpotsNow.
- **DocuSign embedded signing upgrade** — moves from hosted to embedded so shows never leave `taylslate.com`. Requires the Intermediate API tier (~$300/mo). Deferred to post-funding.

**Customer-triggered (build only when a real customer asks):**
- "Expand my horizons" slider — tight fit ↔ broad exploration; drops audience weight, raises engagement, pulls adjacent Podscan vector categories. Prerequisite already shipped.
- "Find shows like this one" as a first-class button on every show card (Podscan Discover already wrapped in `lib/podscan/discover.ts`).
- Sponsor competition tracking — detect newly-mentioned brands before metadata sources update.
- Auth unification to magic-link + OTP for all roles.

**Month 3–6 pinned revisits:**
- **Show-notes value bundle** — auto UTM links (foundation shipped), copy-paste blurbs, click-through tracking, "shows that consistently include the link" as a conviction signal. Concrete spec: a Taylslate-owned short link (`taylslate.com/r/<code>`) that 301s to the full UTM URL and logs a click event — first-party click data per deal, a signal nothing else captures.
- **Operator pricing** — possible raise with an Operator Pro split, grandfathering early converts.

**Year 2+:** DAI / RSS hosting platform integrations (Megaphone, Libsyn, Art19, Acast); lift studies for $200K+ campaigns; cross-channel expansion (Meta, TikTok, Google); data licensing API.

### 5.6 Killed — do not rebuild

- Listing fees / featured placement for shows — compromises discovery integrity, contradicts the mission
- Pay-to-play discovery — same reason
- Curtis (external agent wrapper) — wrong layer; a Layer 2 play, not Layer 3
- Premium analytics dashboard as a separate paid product — folded into Operator
- Onboarding / setup fees — friction at the moment that matters most
- Per-campaign / per-discovery / per-outreach metering — billing complexity, wrong mental model
- Pure 8% transaction pricing — replaced by the three-tier model
- $1,500/mo Operator — wrong reference class; founders compare to Facebook Ads, not HubSpot
- YouTube Shorts as a launch medium — different read mechanics, no proven conversion playbook
- Bespoke integrations to every platform (the LiveRead approach) — replaced by clean API + agent bridge

### 5.7 Brand identity — in progress

Two identity directions were explored via Claude Design (Document B and Conviction C). The current double-T monogram was **misread as an H** and has been set aside. A fresh **wordmark-first** direction is in progress.

---

## Appendix A — Invariants and conventions

### Migrations
Pasted into the Supabase SQL Editor — **no CLI**. Partial failures break naive re-runs, so **every migration must be idempotent and safely re-runnable**:

| Object | Pattern |
|---|---|
| Tables | `CREATE TABLE IF NOT EXISTS` |
| Columns | `ADD COLUMN IF NOT EXISTS` |
| Indexes | `CREATE INDEX IF NOT EXISTS` |
| Triggers | `DROP TRIGGER IF EXISTS …; CREATE TRIGGER …` |
| RLS / policies | `DROP POLICY IF EXISTS …; CREATE POLICY …` |
| Functions | `CREATE OR REPLACE FUNCTION` |
| Check constraints | `DROP CONSTRAINT IF EXISTS …; ADD CONSTRAINT` |

**"Applied" means confirmed by introspection** — never on the strength of a file existing or code shipping. Precedent: the Wave 13 financial layer (015/016/018) was recorded applied but never ran; the gap stayed invisible because the fail-soft and settlement-gated paths never executed. Reconciled in migration 023.

### Data API grants
Required on every new `public` table, placed **before** the RLS/policy block:

```sql
grant select, insert, update, delete on public.<table> to service_role;   -- mandatory, checked before RLS
grant select, insert, update, delete on public.<table> to authenticated;  -- every table the logged-in app touches
-- grant select on public.<table> to anon;   -- deliberate, public-only; NEVER on deals/payments/pattern-library
```

Migrations 001–019 are grandfathered; columns added later to a grandfathered table inherit its grants.

### Routing
- The **only** auth callback route is `/callback`. There is no `/auth/callback`.
- `proxy.ts` at the repo root is the auth gate (Next 16 renamed `middleware` → `proxy`). **Any new signed-out-reachable route must be added to its `isPublicRoute` allowlist** or its handler never runs.

### Dates
`lib/format/date-only.ts` → `formatDateOnly` (UTC) is the **single source of truth** for date-only values across the pitch page, deal views, IO preview, both PDF generators, and the outreach email. Timestamps (`created_at`, `signed_at`, `cancelled_at`) keep the local formatter. Post-date derivation uses UTC arithmetic (`setUTCDate`, never `setDate`). Cadence→days spacing is centralized in `lib/io/cadence-days.ts`.

### Testing
`POST /api/admin/seed-deal` and `POST /api/admin/seed-outreach` create test data; `DELETE` tears it down with a **financial-records guard** that aborts (500 + `blockers` report) if any `payments`/`invoices` reference the seeded subtree — it never deletes money or invoice rows. Every delete is scoped by discovered IDs; a row lacking the `[SEED]` prefix or a `deal.seeded` reference is never touched.

The full **seed → impersonate → verify → return → teardown** loop is self-serve. Gmail `+tag` aliases (`chris+show1@taylslate.com`) plus incognito windows handle multi-account sessions.

### Pattern library seeding
Start **essentially empty**; seed only real campaigns. Guessed data creates fake-confident citations. The library grows organically from actual Taylslate campaigns. *(An earlier spec proposed seeding 20–50 analog campaigns from memory; the current standing decision overrides it.)*

---

## Appendix B — Domain knowledge reference

**Pricing math:** Ad Spot Price = (Downloads ÷ 1,000) × CPM. Range $15–$50. Placements: pre-roll, mid-roll (highest), post-roll.

**Price types:** CPM-based (pay per download) or flat rate (fixed, make-good if underdelivery >10%).

**YouTube:** long-form integrated reads, flat fee typical ($2K–$15K by cultural significance), evergreen. Shorts excluded. Simulcast = one channel, two surfaces, same pricing.

**IO line items:** format, post date, guaranteed downloads, show, placement, scripted Y/N, personal-experience Y/N, reader type, evergreen/dated, pixel Y/N, gross rate, gross CPM, price type, net due.

**Standard terms:** competitor exclusivity 90d · ROFR 30d · make-good >10% underdelivery · 45-day download tracking · FTC compliance · 14-day cancellation · morality/take-down · Net 30 EOM.

**Agency markup:** traditional agencies mark up CPM ~15% ($25 → $29.41); the show never sees the full rate.

**Payment pain:** shows invoice monthly at Net 30 EOM but routinely get paid Net 60–75+. A January ad may not pay until April. Pay-as-delivers fixes this.

**3-spot test floor:** 99% of podcast test campaigns are 3-spot tests. Discovery filters shows where 3 spots × per-spot price exceeds ~25% of test budget.

**Ad copy:** 3–5 bullet talking points beat full scripts — host authenticity is the value. No pre-approval loop; verification is post-publication.

**Format standard:** the VeritoneOne IO template in project files.

**Test vs. scale modes:**

| | Test mode (current) | Scale mode (Wave 15+) |
|---|---|---|
| Question | "Does podcast advertising work for us?" | "This works — how do we run it ongoing?" |
| Shape | Single campaign, $20–30K, ~6 shows × 3 spots | Recurring monthly, often annual commitments |
| UX | Diagnostic — which ring, which audience, which read style | Ad operations — monthly cadence, portfolio rebalancing, quarterly planning |
| Pricing fit | PAYG | Operator (sales-led upgrade triggers here) |

---

## Appendix C — Documentation system

| File | Role |
|---|---|
| `CLAUDE.md` | Session-invariant reference: invariants, conventions, context map. ~143 lines. **No volatile build state.** |
| `STATUS.md` | The single volatile file — current wave, test count, migration state, current frontier. Read first. |
| `PRODUCT_BACKLOG.md` | The queue: shipped / pre-launch / post-launch / killed. |
| `TAYLSLATE_CONTEXT.md` | Deep strategy, discovery thesis, competitive research, domain depth. |
| `WAVE_HISTORY.md` | Wave-by-wave build narrative (Waves 1–14) and dated reference moved out of `CLAUDE.md`. |
| `docs/WAVE_14_PHASE_2*_SPEC.md` | Per-sub-phase build specs. |
| `TAYLSLATE_VALIDATION_WORKING_DOC.md` | Wedge, moat, signal ladder, ICP, sales motion, founder's log. |
| `PRICING_DECISIONS.md` | Tier rationale and rejected models. |
| `TAYLSLATE_AGENTIC_ROADMAP.md` | Long-horizon agent/MCP north star. |

**Doc updates are full file replacements**, not patches.

**Working model:** Claude.ai chat for strategy, planning, decisions, and prompt-drafting → Claude Code desktop app for all implementation → Codex (`/codex:rescue`) as adversarial reviewer between layers. Chris pastes prompts into Claude Code and reports results back.

---

*End of document.*
