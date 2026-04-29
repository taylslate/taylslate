# CLAUDE.md — Taylslate Project Context

*Last updated: April 28, 2026 — Pricing model locked, Wave 13 next*

**For deep strategic context, competitive research, and domain knowledge, see `TAYLSLATE_CONTEXT.md` in this project folder.**

---

## What is Taylslate

Taylslate is **Layer 3 infrastructure for podcast and YouTube sponsorship advertising** — the transaction data layer and payment rail that brands, shows, and eventually AI agents operate on. It replaces the manual, weeks-long process of campaign planning, deal negotiation, IO management, delivery tracking, invoicing, and payment with one AI-powered workflow.

**The positioning:** "Facebook Ads for podcast reads." Brands new to podcast advertising enter a URL, budget, and demographics; Taylslate returns a scored discovery list of 50-100 shows. Brand selects; platform builds the media plan. Every transaction captured makes the scoring smarter — that's the moat.

**Target user:** Brands new to podcast advertising. Not brands already spending heavily (they have agencies). Not agencies themselves (they have workflow inertia and are late adopters). Market education is core GTM — the product itself teaches brands what to expect on CPMs, episode counts, and timing.

**Fee model (locked April 28, 2026):** Three-tier structure. Brand entry is **Pay-as-you-go at 10% transaction** (no SaaS, channel-tool entry, matches founder-buyer "test before pay" psychology). Brand committed customers convert to **Operator: $499/mo + 6% transaction** (breakeven at ~$12.5K/mo spend, sales-led upgrade conversation, optimizes for retention at scale). **Agency: $5,000/mo + 4% transaction** for white-label/multi-client (Veritone-class buyers). Plus future API/MCP per-call+per-deal pricing (architect now, monetize Month 9-12+). Transparency as competitive differentiator vs. VeritoneOne-style 15-20% hidden markups.

## Core Thesis

The most valuable data in podcast advertising — real CPM rates, verified download performance, advertiser retention, conversion signals — does not exist in any API or database. Taylslate captures it by facilitating the actual transaction. Every deal that runs through the platform makes the AI smarter. After thousands of transactions, Taylslate has unmatched pricing intelligence.

**Two things force data through the platform:**
1. **Automated verification** (planned Podscribe integration + RSS/transcript scanning) confirms ads ran and downloads hit guarantees
2. **Payment facilitation** captures the one piece of data nobody shares voluntarily: what was actually paid, when, by whom

**Monaco.com analogy:** Monaco replaced 5-8 fragmented sales tools with one AI-native system of record where intelligence compounds with usage. Taylslate does the same for creator sponsorship transactions.

## User Types

- **Brands / Advertisers:** Mid-market brands ($30K-$50K monthly campaign budgets) new to podcast ads. Founder-led and operated, often with an agency handling social spend but new to podcast specifically. Want fast campaign planning, transparent pricing, audience fit confidence. Testing podcast as a channel — Pay-as-you-go pricing matches their psychology. Convert to Operator once channel is proven. Primary target.
- **Shows / Creators:** Podcast hosts and YouTube creators. Onboard via outreach acceptance flow. Want brand deals, fair pricing, fast payment. Shows under 10K downloads are systematically ignored by agencies — Taylslate serves them.
- **Sales Agents / Rep Companies (Wave 14/15):** Represent portfolios of shows. Unlock high-leverage GTM — one agent onboarding brings 10-30 shows. Data model foundation exists (`agent_show_relationships`) but agent-facing UX not built.
- **Agencies:** Deferred — late adopters, workflow inertia, not the primary GTM channel.

## Build Status (through April 24, 2026)

Waves 1-3 laid the foundation (Supabase migration from seed data, deal transaction loop, show roster/import). Since then:

**Wave 4-5: Show discovery & scoring engine** — Podscan Category Leaders (pool building, 500 shows/category) + Podcast Search filters + Discover endpoint (vector similarity). Scoring weights: audience fit 40%, ad engagement 30%, sponsor retention 20%, reach 10%. Brand safety shown as metadata but never excludes shows.

**Wave 6: Discovery list UI** — Brand sees scored list of 50-100 shows; checkboxes to pick the ones that fit. AI no longer generates complete media plans autonomously — the brand picks, platform builds. Market education happens through the discovery experience itself.

**Wave 6.5: English filter + campaign brief** — Single text-area brief combined with structured brand profile fields. (Known issue: brief currently renders as jumbled paragraph, flagged for post-Wave-13 polish.)

**Wave 7: Media plan builder** — Picks flow into media plan with per-show CPM, episodes, placement, flight dates, spot price, line total. (Known issue: CPM not visibly editable on plan screen despite being editable downstream; flagged for polish.)

**Wave 8: Brand conversational onboarding** — 9-step flow capturing brand name, URL, customer description, age range, demographics, categories, goals, exclusions. Creates `brand_profiles` row. (Known issues: age asked twice, 1-5 category cap and 1-3 goals cap are artificially restrictive, no AI-prefill from URL yet. Future wave.)

**Wave 9: Show conversational onboarding** — Similar flow for shows; captures rate card, ad formats, demographics, ad copy email, billing email. Education layer explains realistic CPM expectations to shows.

**Wave 10: Brand-profile-aware campaign creation** — Campaign creation reuses brand profile; brand only provides campaign-specific overrides (budget, specific goals).

**Wave 11 (shipped April 23): Outreach-to-onboarded-show loop** — Brand composes outreach with proposed terms (CPM, episode count, placement, flight dates); Claude drafts pitch body. Public pitch page at `/outreach/[token]` with signed JWT tokens — forwardable to agents. Dual-state logic: not onboarded shows see magic-link setup flow (routes through Wave 9 onboarding +1 step for ad_copy_email/billing_email); onboarded shows go straight to accept/counter/decline. Brand-forward styling throughout. 121 tests.

**Wave 12 (shipped April 23): Accepted outreach → signed IO via DocuSign** — Full details below.

**Total: 157 tests passing. Migrations through 014 applied to Supabase.**

## Wave 12 — DocuSign Integration (Deep Detail)

Wave 12 materializes the deal on outreach acceptance, generates a VeritoneOne-format IO PDF, routes it through DocuSign for brand-first-then-show signing, verifies webhooks with HMAC, and stores signed PDF + certificate in Supabase storage.

### Key strategic decisions

- **Vendor: DocuSign.** Not BoldSign, Dropbox Sign, or Adobe Sign. Confirmed used by Veritone (DocuSign Envelope ID visible on Veritone IO PDF in project files). Industry trust signal. Starter plan ($50/mo, 40 envelopes) at launch, sandbox free during development.
- **Hosted signing, not embedded** at launch. Show redirects to DocuSign's domain to sign. Embedded signing is a near-term upgrade (requires Intermediate API tier, ~$300/mo, 100 envelopes) post-funding for premium brand feel.
- **No custom DocuSign branding at launch.** Level 1 branding deferred to post-funding (requires Business Pro tier).
- **Brand signs first, show countersigns (Model A).** Matches agency origination pattern.
- **Timeout: day-3 brand reminder, day-14 auto-cancel.** If brand hasn't signed by day 14, envelope is voided, show is notified, deal is cancelled.
- **IO auto-generated on show acceptance** + brand review screen (sign or cancel, no editing). Terms are locked at outreach acceptance.
- **Counter handling:** Brand accepts counter → IO generates with countered CPM. Dismiss = brand can send new outreach. One round, no infinite ping-pong.
- **Separate `deals` table** (not outreach-as-source-of-truth). One deal per accepted outreach. Owns IO lifecycle.
- **`DOCUSIGN_ENV=sandbox|production` toggle** in env vars.
- **Domain events** — append-only audit log at `domain_events` table. Fat payloads with `schema_version`. Service-role write only. Future MCP server / webhook subscriptions will consume.

### Files & structure

```
supabase/migrations/
  013_deals_wave12.sql              # Extends deals table with outreach_id, brand/show profile FKs, 
                                    # agreed_* terms, docusign_envelope_id, signed_at timestamps,
                                    # signed_io_pdf_url, signature_certificate_url, cancellation 
                                    # fields. Expands status enum. Storage policy for signed-ios.
  014_domain_events.sql             # Append-only audit log, service-role only.

lib/
  data/
    events.ts                       # logEvent() helper. Never throws, never blocks main txn.
  pdf/
    io-generator.ts                 # Deal-driven VeritoneOne-format PDF. Taylslate as Bill-To, 
                                    # derived post dates from cadence, DocuSign signature anchors.
  docusign/
    client.ts                       # JWT auth. 1h token cache. SDK loaded via runtime require 
                                    # behind (0,eval) so Turbopack doesn't bundle UMD modules.
    envelope.ts                     # Two-signer create + hosted signing URL + void + download.
    webhook.ts                      # HMAC verify + payload classify.

app/api/
  outreach/[token]/accept-counter/  # Brand-only: materializes deal at countered CPM
  deals/[id]/
    preview/                        # Inline PDF preview
    send-to-docusign/               # Creates envelope, returns hosted signing URL
    cancel/                         # Voids envelope, notifies show
  webhooks/docusign/                # HMAC-verified. Fires brand_signed/show_signed/completed/
                                    # declined events. Uploads signed PDF + cert on completion.
  cron/deal-timeouts/               # Day-3 reminder + day-14 cancellation. Idempotent.

app/(dashboard)/deals/[id]/
  page.tsx                          # Server-side dispatcher (Wave 12 vs legacy)
  legacy-client.tsx                 # Pre-Wave-12 deal view (preserved)

components/deals/
  Wave12DealClient.tsx              # PDF preview iframe + agreed-terms sidebar + sign/cancel

vercel.json                         # Cron schedule: 0 14 * * * daily for /api/cron/deal-timeouts
```

### Deal status lifecycle (Wave 12 states)

```
planning → io_sent → brand_signed → show_signed → delivering → completed
                                                              → cancelled (at any point)
```

Legacy values (`proposed`, `negotiating`, `approved`, `signed`) preserved in status check constraint for backwards compatibility with pre-Wave-12 agent-imported deals.

### DocuSign configuration (done in sandbox, must repeat in production)

- Private integration with User Application auth (secure secret storage: Yes), JWT Grant auth method
- One-time JWT consent grant required (URL pattern: `https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id={KEY}&redirect_uri={CONSENT_URL}`)
- Connect (webhook) configured under Organizations → Integrations → Connect — Custom Sender webhooks type with HMAC signature enabled
- Subscribed events: Envelope Signed/Completed, Envelope Declined, Envelope Voided, Recipient Signed/Completed
- Connect Key generated in Connect Keys tab — used as `DOCUSIGN_WEBHOOK_SECRET`

### Required env vars

```
DOCUSIGN_ENV=sandbox              # or 'production'
DOCUSIGN_INTEGRATION_KEY=...      # From Apps and Keys
DOCUSIGN_USER_ID=...              # From Apps and Keys
DOCUSIGN_ACCOUNT_ID=...           # From Apps and Keys
DOCUSIGN_RSA_PRIVATE_KEY=...      # Generated in Service Integration section
DOCUSIGN_WEBHOOK_SECRET=...       # Generated in Connect Keys tab

RESEND_API_KEY=re_...             # For email delivery (outreach, reminders, notifications)
```

### Known gotchas & patterns worth preserving

1. **Turbopack + DocuSign SDK.** `docusign-esign` ships UMD modules that Turbopack tries to bundle and fails. Fix: runtime `require` behind `(0,eval)`. Same pattern needed for Stripe SDK when we get to Wave 13.
2. **Storage bucket `signed-ios`.** Created manually in Supabase dashboard (private, 50MB limit). Service role policy set via migration 013. Webhook handler uploads signed PDF + certificate; API routes serve via short-lived signed URLs.
3. **Signing order enforced by DocuSign** via recipient routing order (brand = 1, show = 2). Show cannot sign until brand finishes.
4. **Domain events never throw.** `logEvent()` swallows errors and logs. We never want an audit-log failure to block the main flow.

### Outstanding manual follow-ups (pre-production)

- ~~Verify `taylslate.com` domain in Resend~~ — done April 29, 2026. Send-domain cutover applied: `notifications@` (transactional default in `lib/email/send.ts`), `outreach@` (outreach to shows in `lib/email/templates/outreach.ts`), `auth@` (magic links in `app/api/auth/magic/start/route.ts`), `hello@` (general/support, available via per-call `from` override).
- External service URL cutovers still pending (manual, outside the repo):
  - DocuSign Connect webhook URL → swap from `taylslate.vercel.app/api/webhooks/docusign` to `taylslate.com/api/webhooks/docusign`.
  - Stripe webhook endpoint URL → register `taylslate.com/api/webhooks/stripe` with the Wave 13 event list.
  - Supabase project Site URL + auth Redirect URLs → update from `taylslate.vercel.app` to `taylslate.com`.
  - Vercel env var `NEXT_PUBLIC_SITE_URL` → set to `https://taylslate.com` for production (the cron-route fallback now defaults to `taylslate.com` if unset, but env var should be authoritative).

## Architecture Philosophy

**Agent-native design.** The web app is the on-ramp. The API is the real product.

1. **Database and API** — structured data layer persisting across agent sessions
2. **Domain logic engine** — IO formatting rules, CPM calculations, make-good thresholds, invoice generation
3. **Aggregated intelligence layer** — grows with every transaction
4. **Packaged skills / MCP server** — so AI agents can interact with Taylslate's data and logic
5. **Lightweight web UI** — for onboarding, review, and approval

**Build order:** Web app captures data → clean API from day one → skills and MCP server for power users → as agents mature, the web app becomes one of several interfaces.

**Integration philosophy:** Don't build bespoke integrations to every platform. Build a clean API that agents can bridge. Exceptions worth building directly: Podscribe (verification data connected to IO terms is core value prop), DocuSign (e-signature compliance is a regulatory product, not something to recreate).

## Product Principle — Agentic Design

Every form field must pass the test: **"Is this asking for a decision, or for mechanical work?"**

- **Decisions stay manual.** Budget, campaign goals, competitor exclusions, final sign-off.
- **Mechanical work gets AI-derived with human confirm/edit.** Brand name, category, demographics, CPM defaults, episode count standards, pitch drafting.

A product that asks the user to type what it can derive is badly designed. Forms ask; conversations suggest and refine. Applies everywhere: brand/show onboarding, outreach drafting, IO terms, Stripe setup.

## Tech Stack

- **Framework:** Next.js (App Router) with TypeScript, Turbopack
- **Styling:** Tailwind CSS 4 with custom CSS variables (see `app/globals.css`)
- **Database:** Supabase (Postgres + Auth), migrations through 014 applied
- **Deployment:** Vercel (Hobby tier), custom domain cutover pending
- **AI:** Claude API (campaign planning, outreach drafting, pitch body, brief analysis)
- **Payments (Wave 13):** Stripe Connect for pay-as-delivers marketplace flow
- **Verification (future):** Podscribe API integration preferred, RSS/transcript scanning fallback
- **E-signature:** DocuSign (sandbox configured, production gated on Starter plan purchase)
- **Email:** Resend (testing domain now, taylslate.com verification pending)
- **Show data enrichment:** Podscan (Professional plan) — Category Leaders, Podcast Search, Discover endpoints

## Data Schema

Complete type system in `lib/data/types.ts`. Key entities:

- **Show** — Podcast or YouTube channel. Audience data, rate cards, demographics, sponsor history. Ephemeral during discovery; persisted to `shows` table when a deal is created.
- **BrandProfile** — Persisted brand identity (name, URL, demographics, categories, goals, exclusions). Reused across campaigns.
- **ShowProfile** — Persisted show identity (rate card, ad formats, ad_copy_email, billing_email). Created via Wave 9 onboarding.
- **Campaign** — Campaign brief (budget, overrides on brand profile). Discovery results tied to a campaign.
- **Outreach** — Brand's pitch to a show with proposed terms (CPM, episode count, placement, flight dates). Signed JWT token in URL. Response status: pending → accepted / countered / declined.
- **Deal** — Created on outreach acceptance (Wave 12). Full lifecycle: planning → io_sent → brand_signed → show_signed → delivering → completed. Cancellable at any stage.
- **InsertionOrder** — Per-episode line items (generated from deal). Per-episode post date, guaranteed downloads, placement, CPM, gross rate, net due, make-good tracking. Modeled on VeritoneOne template.
- **Invoice** — Monthly billing document referencing IO line items.
- **Payment** — Wave 13. Stripe PaymentIntent records tied to verified episode deliveries.
- **DomainEvent** — Append-only audit log. Fat payloads, schema_version field, service-role only.

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
  (auth)/
    login/page.tsx                  # Brand login (email/password — future unification to magic link)
    signup/page.tsx                 # Brand signup
    callback/route.ts               # Supabase OAuth callback
  (dashboard)/
    layout.tsx                      # Authenticated layout, sidebar
    dashboard/page.tsx              # Home (brand-only currently; role-awareness post-Wave-13)
    campaigns/                      # Brand campaign flow
      page.tsx
      new/page.tsx
      [id]/
        page.tsx                    # Discovery list
        plan/page.tsx               # Media plan builder
        outreach/page.tsx           # Outreach list
    deals/[id]/                     # Wave 12 deal view
      page.tsx                      # Server dispatcher
      legacy-client.tsx             # Pre-Wave-12 preserved
    invoices/                       # Invoice UI
    shows/page.tsx                  # Agent show roster
    settings/page.tsx
  outreach/[token]/page.tsx         # Public pitch page (signed JWT)
  auth/magic/page.tsx               # Magic link landing for shows
  onboarding/
    brand/                          # 9-step brand flow
    show/                           # 10-step show flow
  api/                              # All server endpoints
components/
  layout/Sidebar.tsx
  deals/Wave12DealClient.tsx
  ... (feature-organized)
lib/
  data/
    types.ts                        # All TypeScript types
    queries.ts                      # Supabase query functions
    events.ts                       # Domain event logging
  docusign/                         # DocuSign integration
  pdf/                              # PDF generation
  email/                            # Resend + templates
  podscan/                          # Podscan API client + discover endpoint
  scoring/
    weights.ts                      # Scoring weights (hardcoded — future refactor for tunability)
  supabase/                         # Client configs (client/server/admin)
  validation/                       # IO validation, input schemas
supabase/migrations/                # SQL migrations (001-014 applied)
docs/
  podscan-api.md                    # Podscan API reference (persistent across sessions)
```

## Podcast Advertising Domain Knowledge

- **CPM pricing:** Ad Spot Price = (Downloads ÷ 1,000) × CPM Rate. Range: $15-$50.
- **Placements:** Pre-roll, mid-roll (standard, highest rate), post-roll.
- **Price types:** CPM-based (pay per actual download) or Flat Rate (fixed price with make-good if underdelivery >10%).
- **IO structure:** Per-episode line items with format, post date, guaranteed downloads, show name, placement, scripted Y/N, personal experience Y/N, reader type, evergreen/dated, pixel Y/N, gross rate, gross CPM, price type, net due.
- **IO standard terms:** Competitor exclusivity (90 days), ROFR (30 days), make-good clause (>10% underdelivery), 45-day download tracking, FTC compliance, cancellation (14 days notice), morality/take-down, Net 30 EOM payment.
- **Agency markup:** Traditional agencies mark up CPM (e.g., show's $25 CPM → agency charges brand $29.41, ~15%). Show never sees full rate. Taylslate's 8% is transparent.
- **Payment flow pain:** Shows manually invoice agencies monthly. Net 30 EOM officially, routinely Net 60-75+. A January ad may not pay until April. Taylslate's pay-as-delivers model fixes this.
- **YouTube:** Flat-fee pricing (not CPM). $2K-$20K based on cultural significance. Content is evergreen.
- **Ad copy philosophy:** 3-5 bullet point talking points preferred over full scripts. Host authenticity is the value. No pre-approval review loop — verification is post-publication (Podscribe).
- **VeritoneOne IO template** in project files is the format standard.

## Payment Model (Wave 13 — Next)

**Pay-as-delivers, NOT escrow.** Locked decision.

- Card-on-file via Stripe SetupIntent at IO signature (not charged yet)
- Charged per episode as it runs in the billing cycle (verified delivery triggers charge)
- Show payout follows each verified delivery charge
- No pre-funding, no held escrow
- Show can opt into early payout (within 7 days of delivery) for 2.5% fee
- Payout NEVER released until inbound brand payment has settled — core financial rule, no float risk

**Anti-leakage mechanisms:** Speed (days vs. Net 60-75), payment reliability, future deal flow, brand operational friction. Not held escrow.

**Real buyer minimum:** $30K-$50K/month campaigns (revised from earlier $20K assumption based on customer reality).

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

PAYG → Operator conversion rate is the single most important metric. Build into Wave 13:

- Internal trigger: trailing 90-day GMV >$12,500/month fires alert with savings math
- Sales-led upgrade conversation (not automated email) — relationship moment
- Customer-facing dashboard signal: subtle savings indicator (no popups)
- Stripe Subscription proration handles switching mechanics; downgrades back to PAYG allowed

### Three revenue streams (three modes of using the platform)

1. **Transaction (PAYG, 10%)** — Day 1 entry point, "human running campaigns through UI occasionally"
2. **SaaS (Operator $499+6%, Agency $5,000+4%)** — Month 3+ recurring engine, "human running campaigns consistently"
3. **API/MCP (per-call + per-deal pricing)** — Month 9-12+, "agents running campaigns programmatically"

### Wave 13 architectural requirements (must build now, hard to retrofit)

1. **Customer plan field** — `pay_as_you_go`, `operator`, `agency` enum on customer record
2. **Per-customer dynamic transaction fee** — `platform_fee_percentage` on customer record. Stripe Connect `application_fee_amount` calculated per-charge. Never hardcode.
3. **Stripe Subscription billing** — Set up subscription products and prices for Operator ($499) and Agency ($5,000) even with zero subscribers at launch. Adding later is a real migration.
4. **Seat counting** — `seat_count` on customer record. Per-seat billing via Stripe Subscription quantity. Architect for it even if launch is single-seat.
5. **Plan switching with proration** — Use Stripe Subscription's built-in proration, not custom logic.
6. **Event logging at fine granularity** — Every campaign generation, discovery run, IO generation, outreach sent, API call. Customer ID + timestamp + operation type. Foundation for future API metering. Backfilling later is impossible.
7. **GMV trigger alerting** — Trailing 90-day GMV per customer. Alert system fires at Operator breakeven ($12,500/month). Conversion mechanic must work day Wave 13 ships.

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
- Build clean API endpoints from day one
- Schemas and forms must match real-world industry documents
- Commit messages: imperative mood, under 70 chars for summary line
- Auto-commit after significant changes with no exceptions (enforced in CLAUDE.md language)
- Migrations: follow idempotent pattern above, always
- Domain events on every state transition (entity.action form: `deal.created`, `outreach.accepted`, `envelope.signed`)

## Competitive Context (Quick Reference)

- **LiveRead.io** — IO/invoice management, real integrations (Megaphone, Bill.com, QuickBooks, BoldSign, HubSpot, Art19). No AI, no discovery, no campaign planning. Operations only.
- **Gumball.fm (Headgum)** — Host-read ad marketplace. 150+ shows, $10M Series A. Limited to own network inventory. 10K download minimum.
- **Podscribe** — Verification + attribution (IAB-certified). Industry standard. No IO/deal/payment data. Integrate (planned), don't compete.
- **Podscan** — Primary data provider. 4.4M podcasts, real-time API, MCP server, founder-encouraged. Current enrichment source.
- **Rephonic** — Alternative data provider. 3M+ podcasts, most permissive ToS. Backup option.
- **Traditional agencies (VeritoneOne, Ad Results Media)** — 15-20% markup, manual processes, ignore small shows. Taylslate is 10x faster, no markup.

See `TAYLSLATE_CONTEXT.md` for full competitive analysis.

## Founder Working Style

- Prefers focused, step-by-step explanations over comprehensive overviews
- Values authentic industry modeling — schemas must match real-world documents
- Works iteratively — build, test, refine
- Uses Claude Code (desktop app) for building — disable worktree, work on main
- Uses Claude.ai chat for strategy, planning, and this doc
- Comfortable with GitHub, terminal, Vercel deployment
- Think as a co-founder, not just an assistant
- Motivated by bold launches, not incremental releases
- Direct about risks — honest about what isn't working beats hedging

## Build Queue (Near Term)

**Wave 13 — Stripe pay-as-delivers + pricing tier architecture (next)**
Pre-req: Fix pre-existing Stripe SDK build error with same lazy-require pattern used for DocuSign.
Covers: Stripe Connect setup, SetupIntent at IO signature, episode charge on delivery, show payout flow, idempotency, webhook handling, Connect onboarding UI. **Plus pricing tier scaffolding:** customer plan field, dynamic per-customer transaction fee %, Stripe Subscription billing for Operator/Agency tiers (even with zero subscribers at launch), seat counting, plan-switching proration, fine-grained event logging, GMV trigger alerting at $12.5K/mo Operator breakeven.

**Wave 12.5 (or folded into Wave 13) — Auth unification**
Move brands from email/password to magic link + 6-digit OTP. Unify with show auth. Safer, easier UX, no password management.

**Post-Wave-13 polish wave — UX improvements**
(1) Brand onboarding: hybrid AI-prefill from URL, remove age double-ask, remove category/goals caps, "Back to Summary" CTA when editing.
(2) Campaign brief: structured fields instead of jumbled paragraph.
(3) Media plan: editable CPM indicator.
(4) Outreach: "Compose outreach" not "Reach out", tightened pitch system prompt, rebrand "Claude is writing..." to product-voice persona.
(5) Outreach email bug: from-name getting full brief paragraph instead of brand name.
(6) Pitch page: add total deal value (CPM × episodes × audience/1000).

**Wave 14/15 — Agent/rep accounts**
Multi-show portfolio management UX. High-leverage GTM channel. Data model foundation exists (`agent_show_relationships`), needs UX.

**Future — Scoring engine tunability + "expand my horizons" slider**
Refactor `lib/scoring/weights.ts` to accept per-request overrides. Enables the slider UX: Tight fit ← → Broad exploration. Drops audience weight, raises engagement, pulls from adjacent Podscan vector categories.

**Future — "Find shows like this one" primitive**
First-class UI on each show card. Uses Podscan Discover endpoint. UI button + preference signal capture to `brand_profiles` for learning. Competitive differentiator vs. VeritoneOne's Rolodex model.

**Future — Internal dev tooling**
Seed/bypass admin mode: "log me in as test show 1" button for faster local testing. Replaces Gmail +tag aliases + incognito windows.
