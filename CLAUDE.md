# CLAUDE.md — Taylslate Project Context

*Last updated: March 3, 2026*

**For deep strategic context, competitive research, and domain knowledge, see `TAYLSLATE_CONTEXT.md` in this project folder.**

---

## What is Taylslate

Taylslate is the **infrastructure layer for creator sponsorship advertising** — podcasts, YouTube, and eventually wherever host-endorsed advertising lives. It replaces the manual, weeks-long process of campaign planning, deal negotiation, insertion order management, delivery tracking, invoicing, and payment with one AI-powered platform.

**The one-liner:** "Plan your campaign. Send your IOs. Get paid. All in one place."

**The thesis:** Creator sponsorship is a $6B+ market growing 20%+ annually, but the buying process is stuck in 2015. Digital media has programmatic infrastructure. Creator sponsorship has email threads, Word docs, and 90-day payment terms. Taylslate closes that gap.

## Core Thesis

The most valuable data in podcast advertising — real CPM rates, verified download performance, advertiser retention, conversion signals — does not exist in any API. Taylslate captures this data by facilitating the actual transaction. Every deal makes the AI smarter. The moat is the data. Everything else is a mechanism to capture it.

**Monaco.com analogy:** Monaco replaced 5-8 fragmented sales tools with one AI-native system of record where intelligence compounds with usage. Taylslate does the same for creator sponsorship transactions.

## User Types

- **Brands / Advertisers:** Mid-market brands ($10K-$50K budgets) entering or expanding in podcast/YouTube ads. Want fast campaign planning, transparent pricing, audience fit confidence.
- **Agencies & Buyers:** Small to mid-size media buying agencies managing multiple brand clients. Need IO generation at scale, delivery tracking, invoicing.
- **Sales Agents / Talent Managers:** Represent multiple podcasts and YouTube channels. Manage ad inventory, negotiate with brands, handle invoicing and payment. **First target user for MVP validation.**
- **Shows / Creators:** Podcast hosts and YouTube creators selling ad inventory. Want brand deals, fair pricing, fast payment. Shows under 10K downloads are systematically ignored by agencies.

## Revenue Model

**Two revenue streams only. Clean and transparent.**

### 1. SaaS Subscriptions
| Plan | Price | Target |
|------|-------|--------|
| Starter | $49/mo | Individual buyers, 5 campaigns/mo |
| Growth | $149/mo | Growing brands, IO gen, invoicing |
| Business | $349/mo | Agencies & teams, payment facilitation, priority |

### 2. Early Payment Fee (2.5%)
- Shows/creators opt in to receive payment in 7 days instead of waiting Net 30 EOM (realistically 60-90 days from agencies)
- 2.5% of invoice amount deducted from payout
- Example: $875 IO → show receives $853.12 in 7 days instead of $875 in 3 months
- Market rate — Tipalti NetNow charges similar, invoice factoring is 1-3%

### Payment Flow (Stripe Connect)
- **Brand pays in:** ACH preferred (0.8% capped at $5). Card available but brand pays the processing fee on top of IO amount. Fees are pass-through, clearly itemized on invoice.
- **Taylslate pays out:** ACH only. $0.25 per payout — we absorb this.
- **Stripe fees are NOT our revenue or cost.** They are passed through to whoever triggers them (brand on inbound). Listed transparently on the site, same model as Supercast.
- **We do not mark up Stripe fees.** We don't make money on payment processing. We make money on SaaS + early payment fees.
- **Stripe Connect is the long-term choice.** No Tipalti. We build the early payment logic ourselves.

### What This Looks Like on Paper
**Creator payout statement:**
- IO amount: $875.00
- Early payment fee (2.5%): -$21.88
- Net payout: $853.12

**Brand payment receipt:**
- IO amount: $875.00
- Processing fee (if card): +$25.69
- Total charged: $900.69

## Build Strategy

### Phase 1: Sales Agent MVP (Current Priority)
Target: Sales agent managing multiple shows. Make his life easier TODAY.

**Build:**
- New deal creation flow (brand + show + terms → clean IO generated)
- Invoice generation from completed IOs
- Deal pipeline view (all active deals, status tracking)
- Show roster management

**Goal:** Get the sales agent using it daily. His feedback shapes everything.

### Phase 2: Monaco-Style Launch
Target: Mid-market brands. The demo that makes people share.

**Build:**
- Brand brief intake (URL + budget + audience)
- AI campaign planning engine (Claude API with domain expertise system prompt)
- Show database (100-150 shows seeded from founder knowledge, enriched with Rephonic/Podscan)
- IO auto-generation from approved campaign plan
- Outreach automation (AI-drafted emails to shows)

**Goal:** "Your entire campaign is live before your coffee gets cold."

### Phase 3: Full Transaction Platform
Both sides connected, flywheel spinning.

**Build:**
- Stripe Connect integration for marketplace payments
- Early payment opt-in for creators
- Delivery verification (Podscribe integration preferred, fallback RSS/transcript scanning)
- Auto-invoicing triggered by verified delivery
- Campaign dashboard (real-time status across all deals)

### Phase 4: Scale
- MCP server / Claude Code skills for agent-native workflows
- Cross-channel expansion (Meta, TikTok, Google ad planning)
- Predictive performance scoring from proprietary transaction data
- Expanded show database through transaction data and API enrichment

## Architecture Philosophy

**Agent-native design.** The web app is the on-ramp. The API is the real product.

1. **Database and API** — structured data layer that persists across agent sessions
2. **Domain logic engine** — IO formatting rules, CPM calculations, make-good thresholds, invoice generation
3. **Aggregated intelligence layer** — grows with every transaction
4. **Packaged skills / MCP server** — so AI agents can interact with Taylslate's data and logic
5. **Lightweight web UI** — for onboarding, review, and approval

**Build order:** Web app captures data → clean API underneath from day one → skills and MCP server for power users → as agents mature, the web app becomes one of several interfaces.

**Integration philosophy:** Don't build bespoke integrations to every platform. Build a clean API that agents can bridge. Exception: Podscribe integration is worth building directly (verification data connected to IO terms is core value prop).

**Payment infrastructure:** Stripe Connect. Build the early payment logic ourselves. If we go Stripe Connect, we're staying there.

## Tech Stack

- **Framework:** Next.js (App Router) with TypeScript
- **Styling:** Tailwind CSS 4 with custom CSS variables (see `app/globals.css` for design tokens)
- **Database:** Supabase (Postgres + Auth) — not yet connected, using local seed data
- **Deployment:** Vercel
- **AI:** Claude API (campaign planning, outreach drafting, data extraction)
- **Payments:** Stripe Connect for marketplace payments (brand → Taylslate → show)
- **Verification (planned):** Podscribe API integration or RSS/transcript scanning
- **E-signature (planned):** DocuSign, BoldSign, or equivalent
- **Show data enrichment (planned):** Rephonic API (primary) or Podscan API

## Project Structure

```
app/
  page.tsx                          # Landing page (dark navy theme)
  globals.css                       # Design tokens (--brand-blue, --brand-surface, etc.)
  (dashboard)/
    layout.tsx                      # Authenticated layout with sidebar
    campaigns/                      # Brand-side campaign planning (built)
      page.tsx                      # Campaign list
      new/page.tsx                  # Campaign brief form
      [id]/page.tsx                 # Campaign results (recommendations, outreach, ad copy)
    settings/page.tsx               # Account & subscription settings
components/
  layout/Sidebar.tsx                # Main navigation sidebar
lib/
  data/
    types.ts                        # ALL TypeScript types for the platform
    seed.ts                         # Realistic mock data (18 shows, deals, IOs, invoices)
    index.ts                        # Barrel export
  supabase/                         # Supabase client config (client, server, admin)
```

## Data Schema

Complete type system in `lib/data/types.ts`. Key entities:

- **Show** — podcast or YouTube channel with audience data, rate cards, demographics, sponsor history
- **Deal** — relationship between brand and show, tracks full negotiation lifecycle (proposed → signed → live → completed)
- **InsertionOrder** — the contract, with per-episode line items (post date, downloads, placement, CPM, gross rate, net due, make-good tracking). Modeled on real VeritoneOne IO template.
- **Invoice** — monthly billing document referencing IO line items
- **Campaign** — brand-side campaign brief + AI-generated show recommendations
- **Profile** — user with role (brand, agency, agent, show) and subscription tier
- **AgentShowRelationship** — which agent represents which shows, with commission rates

## Seed Data

`lib/data/seed.ts` contains:
- 18 shows (14 podcasts + 4 YouTube channels), including 7 smaller shows (<20K downloads) that the agent represents
- 4 user profiles (brand, agent, agency, second brand)
- 4 deals at different lifecycle stages
- 2 complete insertion orders with line items
- 2 invoices (one paid, one sent)
- Helper functions: `getShowById()`, `getShowsByAgent()`, `getDealsByAgent()`, `getIOByDeal()`, `getAgentStats()`, etc.

## Podcast Advertising Domain Knowledge

- **CPM pricing:** Ad Spot Price = (Downloads ÷ 1,000) × CPM Rate. Range: $15–$50.
- **Placements:** Pre-roll, mid-roll (standard), post-roll. Mid-roll commands highest rates.
- **Price types:** CPM-based (pay per actual download) or Flat Rate (fixed price with make-good if underdelivery >10%).
- **IO structure:** Per-episode line items with: format, post date, guaranteed downloads, show name, placement, scripted Y/N, personal experience Y/N, reader type, evergreen/dated, pixel Y/N, gross rate, gross CPM, price type, net due.
- **IO standard terms:** Competitor exclusivity (90 days), ROFR (30 days), make-good clause (>10% underdelivery), 45-day download tracking, FTC compliance, cancellation (14 days notice), morality/take-down clauses, Net 30 EOM payment.
- **Agency markup:** Agencies mark up CPM to brands (e.g., show's $25 CPM → agency charges $29.41 ~15%). Show never sees full rate.
- **Payment flow pain:** Shows must manually invoice agencies monthly. Net 30 EOM terms, but agencies routinely pay Net 60–75+. Show running a January ad may not see payment until April.
- **YouTube:** Flat-fee pricing (not CPM). $2K–$20K based on cultural significance. Content is evergreen.
- **Ad copy philosophy:** 3-5 bullet point talking points, not full scripts. Host authenticity is the value. No pre-approval review — verification is post-publication (Podscribe).
- **Ad types:** Host-read baked-in (permanent in episode) and dynamic insertion (DI, stitched at playback via hosting platform). Same IO structure for both. Taylslate doesn't handle ad delivery — that's the hosting platform's job (Megaphone, Libsyn, Art19). We own everything before (planning, IO, e-sig) and after (verification, invoicing, payment).
- **VeritoneOne IO template** is in project files — use as the format standard.

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

Dashboard uses light theme. Landing page uses dark theme.

## Conventions

- Use `var(--brand-*)` CSS variables for all colors, not hardcoded values
- Pages import seed data from `@/lib/data` until Supabase is connected
- Keep components in `components/` organized by feature
- File naming: lowercase with hyphens for files, PascalCase for components
- All monetary values in USD, stored as numbers (not strings)
- Dates stored as ISO strings, displayed with `toLocaleDateString()`
- Build clean API endpoints from day one — the web UI is one of several future interfaces
- Schemas and forms must match real-world industry documents and processes

## Competitive Context (Quick Reference)

- **LiveRead.io** — IO/invoice management, real integrations (Megaphone, Bill.com, BoldSign), but no AI, no discovery, no campaign planning. Operations only. Manages deals that already exist. We create them.
- **Gumball.fm** — Host-read ad marketplace (Headgum). 150+ shows, $10M Series A. Limited to own network inventory. 10K download minimum.
- **Podscribe** — Verification and attribution (IAB-certified). Industry standard. No IO/deal/payment data. Integrate, don't compete. Bridge between "what happened" (Podscribe) and "what was agreed to / what was paid" (Taylslate).
- **Traditional agencies (VeritoneOne, Ad Results Media)** — 15-20% markup, manual processes, ignore small shows. Taylslate is 10x faster, no markup.

See `TAYLSLATE_CONTEXT.md` for full competitive analysis.

## Financial Model

See `taylslate_financial_model_v3.xlsx` in project files. Key assumptions:
- SaaS tiers: $49 / $149 / $349
- Early payment fee: 2.5% on opt-in fast payouts
- Stripe fees: pass-through to brand (not our cost/revenue)
- Base scenario M24: $3.1M ARR, $260K/mo revenue, 97% margins
- Monaco Pop scenario M24: $78.7M ARR, $6.6M/mo revenue, $756M cumulative GMV
- Month 24 valuations range from $19M (base conservative) to $1.97B (Monaco aggressive)

## Founder Working Style

- Prefers focused, step-by-step explanations over comprehensive overviews
- Works iteratively — build, test, refine
- Values authentic industry modeling — schemas must match real-world documents
- Uses Claude Code for building (disable worktree, work on main)
- Uses Claude desktop app for strategy and planning conversations
- Comfortable with GitHub, terminal, Vercel deployment
- Think as a co-founder, not just an assistant
- Motivated by bold launches, not incremental releases
- Works at Supercast.com — familiar with Stripe Connect, creator payment models, platform fee structures
