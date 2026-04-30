# CLAUDE.md — Taylslate Project Context

*Last updated: April 30, 2026 — Wave 13 shipped. Wave 14 (Discovery Agent Foundation) is next.*

**For deep strategic context, the discovery agent thesis, competitive research, and domain knowledge, see `TAYLSLATE_CONTEXT.md`.**

---

## What is Taylslate

Taylslate is **Layer 3 infrastructure for podcast and long-form YouTube sponsorship advertising** — the transaction data layer and payment rail that brands, shows, and eventually AI agents operate on. It replaces the manual, weeks-long process of campaign planning, deal negotiation, IO management, delivery tracking, invoicing, and payment with one AI-powered workflow.

**The positioning:** "Facebook Ads for podcast reads." Brands new to creator advertising enter a URL, budget, and demographics; Taylslate returns a scored discovery list of 50-100 shows. Brand selects; platform builds the media plan. Every transaction captured makes the AI smarter — that's the moat.

**Target user:** Brands new to podcast and YouTube creator advertising. Not brands already spending heavily (they have agencies). Not agencies themselves (they have workflow inertia and are late adopters). Market education is core GTM — the product itself teaches brands what to expect on CPMs, episode counts, and timing.

**Mediums supported:** Podcast (audio, RSS-driven) and long-form YouTube (channel-based). YouTube Shorts deliberately excluded — different read mechanics, unproven conversion playbook. Podcast + YouTube simulcasts of the same show are modeled as one channel with two surfaces.

**Fee model (locked April 28, 2026):** Three-tier structure. Brand entry is **Pay-as-you-go at 10% transaction** (no SaaS, channel-tool entry, matches founder-buyer "test before pay" psychology). Brand committed customers convert to **Operator: $499/mo + 6% transaction** (breakeven at ~$12.5K/mo spend, sales-led upgrade conversation, optimizes for retention at scale). **Agency: $5,000/mo + 4% transaction** for white-label/multi-client (Veritone-class buyers). Plus future API/MCP per-call+per-deal pricing (architecture in place via Wave 13 event logging, monetize Month 9-12+). Transparency as competitive differentiator vs. VeritoneOne-style 15-20% hidden markups.

## Core Thesis

The most valuable data in podcast advertising — real CPM rates, verified download performance, advertiser retention, conversion signals, and **what kind of product converts on what kind of show with what kind of host** — does not exist in any API or database. Taylslate captures it by facilitating the actual transaction. Every deal that runs through the platform makes the AI smarter. After thousands of transactions, Taylslate has unmatched pricing intelligence and a proprietary pattern library no competitor can replicate without running the same volume.

**Three things force data through the platform:**
1. **Automated verification** (planned Podscribe integration + RSS/transcript scanning) confirms ads ran and downloads hit guarantees
2. **Payment facilitation** (shipped Wave 13) captures what was actually paid, when, by whom
3. **Discovery reasoning library** (Wave 14) captures what was tried, what was thought, what worked

**Monaco.com analogy:** Monaco replaced 5-8 fragmented sales tools with one AI-native system of record where intelligence compounds with usage. Taylslate does the same for creator sponsorship transactions.

## User Types

- **Brands / Advertisers:** Mid-market brands ($30K-$50K monthly campaign budgets) new to creator ads. Founder-led and operated, often with an agency handling social spend but new to podcast/YouTube specifically. Want fast campaign planning, transparent pricing, audience fit confidence. Testing podcast/YouTube as a channel — Pay-as-you-go pricing matches their psychology. Convert to Operator once channel is proven. Primary target.
- **Shows / Creators:** Podcast hosts and long-form YouTube creators. Onboard via outreach acceptance flow. Want brand deals, fair pricing, fast payment. Shows under 10K downloads are systematically ignored by agencies — Taylslate serves them.
- **Sales Agents / Rep Companies (Wave 15+):** Represent portfolios of shows. Unlock high-leverage GTM — one agent onboarding brings 10-30 shows. Data model foundation exists (`agent_show_relationships`) but agent-facing UX not built.
- **Agencies:** Deferred — late adopters, workflow inertia, not the primary GTM channel. Tier exists ($5K/mo + 4%) for when they come.

## Build Status (through April 30, 2026)

Waves 1-3 laid the foundation (Supabase migration from seed data, deal transaction loop, show roster/import). Since then:

**Wave 4-5: Show discovery & scoring engine** — Podscan Category Leaders (pool building, 500 shows/category) + Podcast Search filters + Discover endpoint (vector similarity) + YouTube Data API for YouTube channels. Multi-platform discovery in `lib/discovery/discover-shows.ts`. Scoring weights: audience fit 40%, ad engagement 30%, sponsor retention 20%, reach 10%. Brand safety shown as metadata but never excludes shows.

**Wave 6: Discovery list UI** — Brand sees scored list of 50-100 shows; checkboxes to pick the ones that fit. AI no longer generates complete media plans autonomously — the brand picks, platform builds. Market education happens through the discovery experience itself.

**Wave 6.5: English filter + campaign brief** — Single text-area brief combined with structured brand profile fields. (Known issue: brief currently renders as jumbled paragraph, flagged for pre-launch polish.)

**Wave 7: Media plan builder** — Picks flow into media plan with per-show CPM, episodes, placement, flight dates, spot price, line total. (Known issue: CPM not visibly editable on plan screen despite being editable downstream; flagged for polish.)

**Wave 8: Brand conversational onboarding** — 9-step flow capturing brand name, URL, customer description, age range, demographics, categories, goals, exclusions. Creates `brand_profiles` row. (Known issues: age asked twice, 1-5 category cap and 1-3 goals cap are artificially restrictive, no AI-prefill from URL yet.)

**Wave 9: Show conversational onboarding** — Similar flow for shows; captures rate card, ad formats, demographics, ad copy email, billing email. Education layer explains realistic CPM expectations to shows.

**Wave 10: Brand-profile-aware campaign creation** — Campaign creation reuses brand profile; brand only provides campaign-specific overrides (budget, specific goals).

**Wave 11 (April 23): Outreach-to-onboarded-show loop** — Brand composes outreach with proposed terms; Claude drafts pitch body. Public pitch page at `/outreach/[token]` with signed JWT tokens. Dual-state logic: not onboarded shows see magic-link setup flow; onboarded shows go straight to accept/counter/decline.

**Wave 12 (April 23): Accepted outreach → signed IO via DocuSign** — IO PDF generation + DocuSign JWT integration + hosted signing + HMAC webhook verification + signed PDF storage + day-3/day-14 timeout cron. Migrations 013-014.

**Wave 13 (April 28, shipped): Stripe Connect pay-as-delivers + pricing tier architecture** — Card-on-file via Stripe SetupIntent at IO signature, charge per verified episode delivery, show payout follows each charge, idempotent webhook handling, Connect onboarding UI. Pricing tier scaffolding: customer plan field, dynamic per-customer transaction fee, Stripe Subscription for Operator/Agency tiers, seat counting, plan-switching proration, fine-grained event logging in `event_log` table, GMV trigger alerting at $12.5K/mo Operator breakeven. Migrations 015-018.

**Wave 14 Phase 1 (April 30, shipped): Discovery agent foundation.** Migration 019 applied (pattern library tables: `campaign_patterns`, `ring_hypotheses`, `conviction_scores`, `analog_matches`, `founder_annotations`; `show_profiles.brand_history`; `shows.audience_purchase_power`). `lib/data/reasoning-log.ts` with 5 record helpers + reader, fail-soft contract matching `event-log.ts`. Scoring weight tunability refactor — `lib/scoring/weights.ts` now exports `getEffectiveWeights()` with per-request overrides plus AOV-aware tilt; new optional `topicalRelevance` and `purchasePower` dimensions default to 0 for backwards compatibility. All Phase 1 helpers ship dormant — Phase 2 wires them into the discovery agent at each AI decision point.

**Total: 318 tests passing. Migrations 001-019 applied.**

**Next: Wave 14 Phase 2 — Discovery Agent UX (deferred, customer-driven trigger).** Wires Phase 1 dormant infrastructure into the brand-facing UI. See backlog and "Wave 14 Scope" section below.

## Wave 12 — DocuSign Integration (Reference)

Wave 12 materializes the deal on outreach acceptance, generates a VeritoneOne-format IO PDF, routes it through DocuSign for brand-first-then-show signing, verifies webhooks with HMAC, and stores signed PDF + certificate in Supabase storage.

### Key strategic decisions

- **Vendor: DocuSign.** Confirmed used by Veritone (DocuSign Envelope ID visible on Veritone IO PDF). Industry trust signal. Starter plan ($50/mo, 40 envelopes) at launch, sandbox free during development.
- **Hosted signing, not embedded** at launch. Show redirects to DocuSign's domain to sign. Embedded signing is a near-term upgrade (requires Intermediate API tier, ~$300/mo, 100 envelopes) post-funding.
- **No custom DocuSign branding at launch.** Level 1 branding deferred to post-funding (requires Business Pro tier).
- **Brand signs first, show countersigns (Model A).** Matches agency origination pattern.
- **Timeout: day-3 brand reminder, day-14 auto-cancel.**
- **IO auto-generated on show acceptance** + brand review screen (sign or cancel, no editing). Terms locked at outreach acceptance.
- **Counter handling:** Brand accepts counter → IO generates with countered CPM. Dismiss = brand can send new outreach. One round, no infinite ping-pong.
- **Separate `deals` table.** One deal per accepted outreach. Owns IO lifecycle.
- **`DOCUSIGN_ENV=sandbox|production` toggle** in env vars.
- **Domain events** — append-only audit log at `domain_events` table.

### Files & structure

```
supabase/migrations/
  013_deals_wave12.sql              # deals table extensions, signed PDF storage
  014_domain_events.sql             # append-only audit log

lib/
  data/events.ts                    # logEvent() helper. Never throws, never blocks.
  pdf/io-generator.ts               # Deal-driven VeritoneOne-format PDF
  docusign/
    client.ts                       # JWT auth. 1h token cache. Runtime require behind (0,eval)
    envelope.ts                     # Two-signer create + hosted signing URL + void + download
    webhook.ts                      # HMAC verify + payload classify

app/api/
  outreach/[token]/accept-counter/  # Brand-only: materializes deal at countered CPM
  deals/[id]/preview/               # Inline PDF preview
  deals/[id]/send-to-docusign/      # Creates envelope, returns signing URL
  deals/[id]/cancel/                # Voids envelope, notifies show
  webhooks/docusign/                # HMAC-verified
  cron/deal-timeouts/               # Day-3 reminder + day-14 cancellation
```

### Deal status lifecycle (Wave 12 states)

```
planning → io_sent → brand_signed → show_signed → delivering → completed
                                                              → cancelled (at any point)
```

Legacy values (`proposed`, `negotiating`, `approved`, `signed`) preserved in status check constraint for backwards compatibility.

### Required env vars

```
DOCUSIGN_ENV=sandbox              # or 'production'
DOCUSIGN_INTEGRATION_KEY=...
DOCUSIGN_USER_ID=...
DOCUSIGN_ACCOUNT_ID=...
DOCUSIGN_RSA_PRIVATE_KEY=...
DOCUSIGN_WEBHOOK_SECRET=...
RESEND_API_KEY=re_...
```

## Wave 13 — Stripe Connect + Pricing Tiers (Reference)

Wave 13 closes the transaction loop: brand pays per verified episode delivery via card-on-file, show gets paid 3-5 days after settlement, and the platform takes a per-customer dynamic fee. Pricing tier architecture is in place even with zero subscribers at launch.

### Key strategic decisions

- **Pay-as-delivers, not escrow.** Card-on-file via SetupIntent at IO signature; charge per episode as it runs.
- **Show payout never released until inbound brand payment has settled.** Core financial rule. Zero float risk.
- **Per-customer dynamic fee.** `profiles.platform_fee_percentage` is the source of truth. Stripe Connect `application_fee_amount` calculated per-charge from this field. Never hardcode.
- **`platform_fee_percentage_at_charge` snapshotted on every payment** so a later plan change cannot rewrite history.
- **Stripe Subscription billing** for Operator ($499) and Agency ($5,000) tiers. Architected even with zero subscribers at launch — adding later is a real migration.
- **Event log at fine granularity.** Every campaign generation, discovery run, IO generation, outreach sent, API call writes to `event_log` with customer ID, timestamp, operation type. Foundation for future API metering.
- **GMV trigger alerting.** Cron in `app/api/cron/conversion-alerts/` watches trailing 90-day GMV. Fires alert at Operator breakeven ($12.5K/mo).

### Files & structure

```
supabase/migrations/
  015_pricing_tiers.sql             # plan, platform_fee_percentage, seat_count on profiles
  016_stripe_payments.sql           # payments table, application_fee_amount tracking
  017_event_log.sql                 # fine-grained operation log
  018_deal_setup_intent.sql         # setup_intent_id on deals + payouts table

lib/
  stripe/
    customer.ts                     # Customer creation + lookup
    setup-intent.ts                 # Card-on-file at IO signature
    payment-intent.ts               # Per-episode charge with platform fee
    webhook.ts                      # Stripe webhook handlers (payment_intent.*, subscription.*)
    server.ts                       # Stripe SDK init (lazy require pattern)
  payouts/
    transfer.ts                     # Show payout via Stripe Connect transfer + early payout fee
    constants.ts                    # Settlement window, early payout fee %
  billing/
    plans.ts                        # Plan definitions (PAYG, Operator, Agency)
    constants.ts                    # Fee percentages by plan
    subscription.ts                 # Plan switching with proration
  data/event-log.ts                 # logEventLog() helper
  alerts/conversion.ts              # GMV trigger logic
  analytics/gmv.ts                  # Trailing 90-day GMV calculation

app/api/
  stripe/
    config/                         # Stripe public key for client
    customer/create/                # Stripe customer init
    payment-method/setup-intent/    # SetupIntent creation
    payment-method/list/            # List saved cards
    payment-method/[id]/            # Detach card
    connect/create-account/         # Express Connect for shows
    connect/onboarding-link/        # Connect onboarding redirect
    connect/status/                 # Account status check
  webhooks/stripe/                  # Stripe webhook handler
  deals/[id]/charge-episode/        # Trigger per-episode charge
  payouts/early/                    # Show opts into early payout (2.5% fee)
  billing/upgrade/                  # PAYG → Operator/Agency
  billing/downgrade/                # Operator/Agency → PAYG
  billing/seats/                    # Add/remove seats
  cron/conversion-alerts/           # Daily GMV scan + alert fire
```

### Required env vars (Wave 13 additions)

```
STRIPE_SECRET_KEY=sk_...
STRIPE_PUBLISHABLE_KEY=pk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_OPERATOR_PRICE_ID=price_...     # Operator monthly $499
STRIPE_AGENCY_PRICE_ID=price_...       # Agency monthly $5,000
STRIPE_OPERATOR_SEAT_PRICE_ID=price_... # $299/seat add-on
STRIPE_AGENCY_SEAT_PRICE_ID=price_...   # $500/seat add-on
```

### Known gotchas & patterns worth preserving

1. **Turbopack + Stripe SDK.** Same lazy-require pattern as DocuSign (`(0,eval)("require")`). Required because Stripe ships UMD modules.
2. **Idempotency on Stripe webhooks.** Every webhook handler checks for prior processing via `payments.stripe_payment_intent_id` unique index before mutating state.
3. **Payouts wait for settlement.** Show payout never fires until inbound payment is `succeeded`, not `processing`. Hard rule.
4. **Domain events never throw.** `logEvent()` and `logEventLog()` swallow errors and log. Audit-log failures must never block main flow.
5. **Test mode caveat:** No clean way today to simulate full brand-side discovery → outreach → deal → IO → payment flow with two accounts you control. Discovery returns real Podscan shows whose email you don't control. Workaround in PRODUCT_BACKLOG.md (Operational Unblock).

### Outstanding manual follow-ups (pre-production)

- ~~Verify `taylslate.com` domain in Resend~~ — done April 29. Send-domain cutover applied.
- External service URL cutovers still pending (manual, outside the repo):
  - DocuSign Connect webhook URL → swap from `taylslate.vercel.app/api/webhooks/docusign` to `taylslate.com/api/webhooks/docusign`
  - Stripe webhook endpoint URL → register `taylslate.com/api/webhooks/stripe` with the Wave 13 event list
  - Supabase project Site URL + auth Redirect URLs → update from `taylslate.vercel.app` to `taylslate.com`
  - Vercel env var `NEXT_PUBLIC_SITE_URL` → set to `https://taylslate.com` for production

## Wave 14 — Discovery Agent (Phase 1 shipped, Phase 2 deferred)

Discovery is the act of locating, for a given product, the universe of shows where it will convert profitably — and producing a sampling plan against that universe given budget. Not a database query. Not a category filter with extra steps. An interpretive reasoning task. See `TAYLSLATE_CONTEXT.md` Section 5 for full thesis.

Wave 14 scope is split into **foundation work** (build now, low-risk, high-leverage, accumulates training data even before agent UX exists) and **agent UX work** (build when first real campaign exposes the gap). Foundation work is part of the pre-launch backlog. Agent UX is post-launch customer-driven.

### Wave 14 Foundation (pre-launch)

**Status: shipped April 30, 2026.** Migration 019 applied. Pattern library tables, reasoning persistence wrapper, scoring weight tunability all live in dormant state. Phase 2 wires them into UI.

Build now to make the data flywheel start spinning.

1. **Pattern library schema** — `campaign_patterns`, `analog_matches`, `ring_hypotheses`, `conviction_scores` tables. Designed for future ML, populated manually now from Chris's media-buying intuition (~100-200 brand/show pairs from memory). See migration spec when scoped.

2. **Reasoning persistence in event_log** — Every AI decision (interpretation, ring hypothesis, conviction score, analog match, sampling decision) writes structured reasoning. Schema must match what you'd want as training data later. New event types: `discovery.brief_interpreted`, `discovery.ring_hypothesized`, `discovery.conviction_scored`, `discovery.analog_matched`. Existing `event_log` table is the home; no new table needed.

3. **Scoring weight tunability refactor** — `lib/scoring/weights.ts` accepts per-request overrides. Default weights stay (40/30/20/10). Per-request overrides enable A/B testing, ring-aware scoring, future tuning. Effort: 2-3 days. Already on backlog as foundational architecture.

4. **Multi-medium creator inventory abstraction** — `shows.platform` already has `'podcast' | 'youtube'` enum. Add `surfaces` JSONB to capture simulcast (one show, podcast + YouTube). Add `medium_priors` JSONB for medium-specific scoring (CPM range, engagement weight, frequency norms).

### Wave 14 Agent UX (post-launch, customer-driven)

Build when discovery quality limits a real customer's outcomes. Until then, the foundation accumulates data and the existing scored discovery list serves the wedge.

1. **Brief interpretation agent** — Interactive intake that proposes 1 primary + 2-4 lateral ring hypotheses with confidence, runs structured refinement turns. Replaces (or augments) the current form-only brief flow.

2. **Conviction scoring UI** — Replace fit score with conviction score + reasoning surface. Show-level and portfolio-level. "Conviction: high. Host personally uses cold plunge..." pattern.

3. **Lateral ring surfacing** — UI exposes the 2-4 candidate rings the AI generated, lets brand confirm/reject. Refinement loop visible in the chat or sidebar.

4. **Confidence-gated portfolio shape** — High conviction → tighter portfolio. Low conviction → wider portfolio + recommended test-and-learn framing.

5. **Discovery agent as MCP-ready primitives** — Each step (interpret, refine, locate, sample, propose) is a discrete addressable function. UI consumes the same primitives an external agent would. Costs ~10-15% extra build time, saves 10x rebuild later.

## Architecture Philosophy

**Agent-native design.** The web app is the on-ramp. The API is the real product.

1. **Database and API** — structured data layer persisting across agent sessions
2. **Domain logic engine** — IO formatting rules, CPM calculations, make-good thresholds, invoice generation
3. **Aggregated intelligence layer** — pattern library, conviction reasoning, outcome data — grows with every transaction
4. **Packaged skills / MCP server** — so AI agents can interact with Taylslate's data and logic
5. **Lightweight web UI** — for onboarding, review, and approval

**Build order:** Web app captures data → clean API from day one → skills and MCP server for power users → as agents mature, the web app becomes one of several interfaces.

**Integration philosophy:** Don't build bespoke integrations to every platform. Build a clean API that agents can bridge. Exceptions worth building directly: Podscribe (verification data connected to IO terms is core value prop), DocuSign (e-signature compliance is a regulatory product), Stripe Connect (payment compliance is a regulatory product).

**Reasoning persistence is non-negotiable for any AI surface.** Every AI decision writes a structured record. Lost training data is expensive. See Wave 14 Foundation #2.

## Product Principle — Agentic Design

Every form field must pass the test: **"Is this asking for a decision, or for mechanical work?"**

- **Decisions stay manual.** Budget, campaign goals, competitor exclusions, final sign-off.
- **Mechanical work gets AI-derived with human confirm/edit.** Brand name, category, demographics, CPM defaults, episode count standards, pitch drafting.

A product that asks the user to type what it can derive is badly designed. Forms ask; conversations suggest and refine. Applies everywhere: brand/show onboarding, outreach drafting, IO terms, Stripe setup, discovery brief.

## Tech Stack

- **Framework:** Next.js (App Router) with TypeScript, Turbopack
- **Styling:** Tailwind CSS 4 with custom CSS variables (see `app/globals.css`)
- **Database:** Supabase (Postgres + Auth), migrations through 018 applied
- **Deployment:** Vercel, custom domain `taylslate.com` cut over April 29
- **AI:** Claude API (campaign planning, outreach drafting, pitch body, brief analysis, discovery reasoning)
- **Payments:** Stripe Connect (Express accounts, SetupIntent for card-on-file, pay-as-delivers per episode)
- **E-signature:** DocuSign (sandbox configured, production gated on Starter plan purchase)
- **Email:** Resend (taylslate.com verified, send-domain cutover applied)
- **Show data enrichment:** Podscan (Professional plan) — Category Leaders, Podcast Search, Discover endpoints
- **YouTube enrichment:** YouTube Data API v3 — channel + video stats
- **Verification (future):** Podscribe API integration preferred, RSS/transcript scanning fallback

## Data Schema

Complete type system in `lib/data/types.ts`. Key entities:

- **Show** — Podcast or long-form YouTube channel. `platform: 'podcast' | 'youtube'`. Audience data, rate cards, demographics, sponsor history. Ephemeral during discovery; persisted to `shows` table when a deal is created. Simulcast (same show on both surfaces) modeled with linked records (Wave 14 work to formalize).
- **BrandProfile** — Persisted brand identity (name, URL, demographics, categories, goals, exclusions). Reused across campaigns.
- **ShowProfile** — Persisted show identity (rate card, ad formats, ad_copy_email, billing_email). Created via Wave 9 onboarding.
- **Campaign** — Campaign brief (budget, overrides on brand profile). Discovery results tied to a campaign.
- **Outreach** — Brand's pitch to a show with proposed terms. Signed JWT token in URL. Response status: pending → accepted / countered / declined.
- **Deal** — Created on outreach acceptance (Wave 12). Lifecycle: planning → io_sent → brand_signed → show_signed → delivering → completed.
- **InsertionOrder** — Per-episode line items. Modeled on VeritoneOne template.
- **Invoice** — Monthly billing document referencing IO line items.
- **Payment** — Wave 13. Stripe PaymentIntent records tied to verified episode deliveries. Stores `application_fee_amount_cents`, `platform_fee_percentage_at_charge`.
- **Payout** — Wave 13. Show payout via Stripe Connect transfer. Tracks early payout fee.
- **DomainEvent** — Append-only audit log. Fat payloads, schema_version field, service-role only. Powers state-transition tracking.
- **EventLog** — Fine-grained operation log (Wave 13). Every campaign generation, discovery run, IO generation, outreach sent, API call. Foundation for API metering and reasoning persistence.

## Supabase Conventions (REQUIRED)

**Idempotent migration pattern — ALL migrations must follow this:**

- Tables: `CREATE TABLE IF NOT EXISTS`
- Columns: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- Indexes: `CREATE INDEX IF NOT EXISTS`
- Triggers: `DROP TRIGGER IF EXISTS <name> ON <table>; CREATE TRIGGER ...`
- RLS policies: `DROP POLICY IF EXISTS "<name>" ON <table>; CREATE POLICY ...`
- Functions: `CREATE OR REPLACE FUNCTION`
- Check constraints: `ALTER TABLE ... DROP CONSTRAINT IF EXISTS; ... ADD CONSTRAINT`

**Rationale:** Chris pastes migrations into Supabase SQL Editor (not CLI). Partial failures break naive re-runs. Every migration must be safely re-runnable.

## Project Structure

```
app/
  page.tsx                          # Landing page (dark navy)
  globals.css                       # Design tokens
  (auth)/login,signup,callback      # Auth (email/password — future unification to magic link)
  (dashboard)/
    layout.tsx                      # Authenticated layout, sidebar
    dashboard/page.tsx              # Role-aware home (brand vs show vs agent)
    campaigns/                      # Brand campaign flow (new, [id], plan, outreach)
    deals/[id]/                     # Wave 12+13 deal view
    invoices/                       # Invoice UI
    shows/page.tsx                  # Agent show roster
    settings/                       # Settings + billing
  outreach/[token]/page.tsx         # Public pitch page (signed JWT)
  auth/magic/page.tsx               # Magic link landing for shows
  onboarding/
    brand/                          # 9-step brand flow
    show/                           # 10-step show flow
  api/                              # All server endpoints
components/
  layout/Sidebar.tsx                # Role-aware sidebar
  deals/Wave12DealClient.tsx
  payments/                         # Connect onboarding, card form
  outreach/                         # Composer modal, show list
  io/                               # IO generator, preview
lib/
  data/
    types.ts                        # All TypeScript types
    queries.ts                      # Supabase query functions
    events.ts                       # Domain event logging
    event-log.ts                    # Fine-grained operation logging
  docusign/                         # DocuSign integration
  stripe/                           # Stripe Connect + payments
  payouts/                          # Show payout transfers
  billing/                          # Plan management + subscription
  pdf/                              # PDF generation
  email/                            # Resend + templates
  podscan/                          # Podscan API client + Discover
  enrichment/                       # Podscan + YouTube enrichment
  discovery/                        # Multi-platform discovery orchestrator
  scoring/
    weights.ts                      # Scoring weights (refactor to per-request override pending)
    dimensions/                     # Per-dimension scoring functions
  alerts/                           # Conversion (GMV) alerts
  analytics/                        # GMV calculation
  supabase/                         # Client configs (client/server/admin)
  validation/                       # IO validation, input schemas
  nav/                              # Role-aware nav items
supabase/migrations/                # SQL migrations 001-018 applied
docs/
  podscan-api.md                    # Podscan API reference
```

## Podcast & YouTube Advertising Domain Knowledge

- **CPM pricing:** Ad Spot Price = (Downloads ÷ 1,000) × CPM Rate. Range: $15-$50.
- **Placements:** Pre-roll, mid-roll (standard, highest rate), post-roll.
- **Price types:** CPM-based (pay per actual download) or Flat Rate (fixed price with make-good if underdelivery >10%).
- **YouTube:** Long-form integrated reads. Flat-fee pricing typical (not CPM). $2K-$20K based on cultural significance. Content is evergreen.
- **YouTube Shorts:** Excluded from Taylslate at launch. Different read mechanics, no proven conversion playbook.
- **Simulcast:** Many podcasters publish a YouTube video version. Treated as one channel with two surfaces. Same audience overlap, same pricing.
- **IO structure:** Per-episode line items with format, post date, guaranteed downloads, show name, placement, scripted Y/N, personal experience Y/N, reader type, evergreen/dated, pixel Y/N, gross rate, gross CPM, price type, net due.
- **IO standard terms:** Competitor exclusivity (90 days), ROFR (30 days), make-good clause (>10% underdelivery), 45-day download tracking, FTC compliance, cancellation (14 days notice), morality/take-down, Net 30 EOM payment.
- **Agency markup:** Traditional agencies mark up CPM (e.g., show's $25 CPM → agency charges brand $29.41, ~15%). Show never sees full rate. Taylslate's per-tier transaction fee is transparent.
- **Payment flow pain:** Shows manually invoice agencies monthly. Net 30 EOM officially, routinely Net 60-75+. A January ad may not pay until April. Taylslate's pay-as-delivers model fixes this.
- **Ad copy philosophy:** 3-5 bullet point talking points preferred over full scripts. Host authenticity is the value. No pre-approval review loop — verification is post-publication (Podscribe).
- **VeritoneOne IO template** in project files is the format standard.

## Discovery Reasoning (Wave 14 reference)

Discovery is conviction-based interpretive reasoning, not category-and-audience filtering. Three ring concept:

- **Conviction ring** — shows where the product almost certainly converts. Strong host fit, audience fit, proven analog patterns.
- **Probable ring** — shows where the product likely converts at the right CPM.
- **Exploration ring** — shows where there's a defensible hypothesis but no proof.

Rings are determined by the *product*, not the budget. Budget is a sampling lens applied after rings are located.

The agent loop: AI proposes 1 primary read + 2-4 lateral candidate rings with confidence → brand confirms/refines interpretation (not show list) → rings collapse to confirmed shape → portfolio sampled with budget constraints applied.

Conviction score replaces fit score. Reasoning surfaces alongside the number. Three levels: brief interpretation conviction, ring conviction, show conviction.

Pattern library is the moat. Every campaign writes a structured record (product attributes, ring hypotheses, conviction scores, analog matches, outcomes) to the database. Foundation models reason over the library; the library is proprietary.

See `TAYLSLATE_CONTEXT.md` Section 5 for full thesis.

## Pricing & Revenue Model (Locked April 28, 2026)

Three-tier model. Customer chooses entry; conversion to higher tiers is sales-led, not gated. See `TAYLSLATE_CONTEXT.md` Section 4 for full reasoning, philosophy, and revenue projections.

### The plans

**Pay-as-you-go (Brand entry):**
- 10% transaction fee, no subscription
- 1 seat, up to 2 concurrent active campaigns
- Per-campaign reporting, standard support, no API access
- All core features (AI planning, discovery, IO generation, verification, invoicing, payment)

**Operator (Brand committed):**
- $499/month + 6% transaction
- Breakeven vs PAYG at ~$12,500/month spend
- 1 seat included, additional seats at $299/month
- Unlimited concurrent campaigns, portfolio dashboard, cross-campaign analytics, CSV exports
- Priority support, API access
- All Pay-as-you-go features

**Agency (white-label):**
- $5,000/month + 4% transaction
- 5 seats included, additional seats at $500/month
- White-label IOs and dashboards, multi-client architecture, permissions, client billing separation
- Custom reporting, dedicated success manager
- All Operator features

### Pricing philosophy (one-line summaries)

- **Transaction fee is the entry. SaaS is the upgrade for ongoing operations.** Customers earn their way to SaaS rather than being gated into it.
- **Reference class is commerce infrastructure (Shopify, Toast), not marketing suites (HubSpot, Salesforce).** Channel tool, not full marketing platform.
- **Optimize for churn over per-customer revenue.** Operator customers retain dramatically longer; LTV beats per-month revenue.
- **Don't gate the wedge. Gate the scale features.** AI planning, discovery, IO, verification, invoicing, payment available to all tiers.
- **Customer chooses, platform doesn't force.** No mandatory graduation by volume thresholds.

### Conversion mechanic (highest-leverage activity)

PAYG → Operator conversion rate is the single most important metric. Wave 13 shipped:

- Internal trigger: trailing 90-day GMV >$12,500/month fires alert with savings math (`app/api/cron/conversion-alerts/`)
- Sales-led upgrade conversation (not automated email) — relationship moment
- Customer-facing dashboard signal: subtle savings indicator (no popups, future polish)
- Stripe Subscription proration handles switching mechanics; downgrades back to PAYG allowed

### Three revenue streams (three modes of using the platform)

1. **Transaction (PAYG, 10%)** — Day 1 entry point, "human running campaigns through UI occasionally"
2. **SaaS (Operator $499+6%, Agency $5,000+4%)** — Month 3+ recurring engine, "human running campaigns consistently"
3. **API/MCP (per-call + per-deal pricing)** — Month 9-12+, "agents running campaigns programmatically"

## Design System

All colors use CSS custom properties from `globals.css`:
- `--brand-navy` / `--brand-navy-light` — dark backgrounds (landing page)
- `--brand-blue` / `--brand-blue-light` — primary action color
- `--brand-teal` / `--brand-teal-light` — secondary accent
- `--brand-orange` — tertiary accent (sponsor badges)
- `--brand-surface` / `--brand-surface-elevated` — light backgrounds (dashboard)
- `--brand-border` — borders
- `--brand-text` / `--brand-text-secondary` / `--brand-text-muted` — text hierarchy
- `--brand-success` / `--brand-warning` / `--brand-error` — status colors

Dashboard uses light theme. Landing and public pitch pages use dark/brand-forward theme.

## Conventions

- Use `var(--brand-*)` CSS variables for colors, not hardcoded values
- File naming: lowercase with hyphens for files, PascalCase for components
- All monetary values in USD, stored as numbers (not strings)
- Dates stored as ISO strings, displayed with `toLocaleDateString()`
- Build clean API endpoints from day one — every endpoint should be MCP-ready in shape
- Schemas and forms must match real-world industry documents
- Commit messages: imperative mood, under 70 chars for summary line
- Auto-commit after significant changes with no exceptions
- Migrations: follow idempotent pattern above, always
- Domain events on every state transition (entity.action form: `deal.created`, `outreach.accepted`, `envelope.signed`)
- Reasoning persistence: every AI decision writes a structured record to `event_log`
- Cleanup Claude Code worktrees after every wave: `git worktree remove --force .claude/worktrees/<name>` then `git worktree prune`

## Competitive Context (Quick Reference)

- **LiveRead.io** — IO/invoice management, real integrations. No AI, no discovery, no campaign planning. Operations only.
- **Gumball.fm (Headgum)** — Host-read ad marketplace. Limited to own network inventory. 10K download minimum.
- **Podscribe** — Verification + attribution (IAB-certified). Industry standard. Integrate, don't compete.
- **Podscan** — Primary data provider. 4.4M podcasts, real-time API, MCP server. Current enrichment source.
- **Rephonic** — Alternative data provider. Backup option.
- **Traditional agencies (VeritoneOne, Ad Results Media)** — 15-20% markup, manual processes, ignore small shows. Their planners' 20+ years of pattern recognition is what Wave 14 substitutes via pattern library + LLM reasoning.

See `TAYLSLATE_CONTEXT.md` for full competitive analysis.

## Founder Working Style

- Prefers focused, step-by-step explanations over comprehensive overviews
- Values authentic industry modeling — schemas must match real-world documents
- Works iteratively — build, test, refine
- Uses Claude Code (desktop app) for building — work on main, no worktrees
- Uses Claude.ai chat for strategy, planning, and this doc
- Comfortable with GitHub, terminal, Vercel deployment
- Think as a co-founder, not just an assistant
- Motivated by bold launches, not incremental releases
- Direct about risks — honest about what isn't working beats hedging

## Build Queue (Wave-Sequenced)

Pre-launch backlog and post-launch customer-driven items live in `PRODUCT_BACKLOG.md`. Waves remain the execution unit.

**Wave 14 — Discovery Agent Foundation (next)**
Foundation work (pattern library schema, reasoning persistence, scoring tunability, multi-medium abstraction) is part of pre-launch backlog. Agent UX work (interpretation loop, conviction UI, lateral ring surfacing) is post-launch customer-driven.

**Wave 15+ — Agent/rep accounts**
Multi-show portfolio management UX. High-leverage GTM. Data model exists, UX doesn't.

**Future — Podscribe verification integration**
Replace internal admin "mark delivered" stub with Podscribe webhook integration.

**Future — MCP server**
Public MCP server for agent-mediated commerce. Per-call + per-deal pricing.

**Future — Internal dev tooling**
"Log me in as test show 1" admin button to replace Gmail +tag aliases.
