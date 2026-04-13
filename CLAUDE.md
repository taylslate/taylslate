# CLAUDE.md — Taylslate Project Context

*Last updated: April 13, 2026*

**For deep strategic context, competitive research, and domain knowledge, see `TAYLSLATE_CONTEXT.md` in this project folder.**

---

## What is Taylslate

Taylslate is the **infrastructure layer for creator sponsorship advertising** — podcasts, YouTube, and eventually wherever host-endorsed advertising lives. It replaces the manual, weeks-long process of campaign planning, deal negotiation, insertion order management, delivery tracking, invoicing, and payment with one AI-powered platform.

**The one-liner:** "Discover your shows. Build your plan. Send your IOs. Ads run. We verify. You get paid."

**The thesis:** Creator sponsorship is a $6B+ market growing 20%+ annually, but the buying process is stuck in 2015. Digital media has programmatic infrastructure. Creator sponsorship has email threads, Word docs, and 90-day payment terms. Taylslate closes that gap.

## Core Thesis

The most valuable data in podcast advertising — real CPM rates, verified download performance, advertiser retention, conversion signals — does not exist in any API. Taylslate captures this data by facilitating the actual transaction. Every deal makes the AI smarter. The moat is the data. Everything else is a mechanism to capture it.

**Monaco.com analogy:** Monaco replaced 5-8 fragmented sales tools with one AI-native system of record where intelligence compounds with usage. Taylslate does the same for creator sponsorship transactions.

## Target User (April 2026 Shift)

**Primary:** Brands new to podcast advertising. These brands have budget, they know podcast ads work, but they don't know how to buy them. They need market education alongside the transaction infrastructure.

**Secondary:** Sales agents and talent managers representing multiple shows (original MVP target, still a valid user type).

**Late adopters (not early targets):** Agencies. They have workflow inertia — existing IO templates, existing spreadsheets, existing relationships. They won't import everything into Taylslate on day one. We serve them eventually, but we don't optimize GTM around them.

**Not the target:** Brands already spending in the space. They have agency relationships and established processes. They're the hardest to convert and the least valuable early.

## Product Flow — Discovery List, Not Auto-Plan

This is the key product shift from the original spec. The original flow had AI generating a complete media plan. The new flow separates discovery from planning.

**Step 1 — Brief:** Brand inputs URL, budget, target audience, campaign goals.

**Step 2 — Discovery list:** AI returns a scored list of 50-100 shows ranked by fit. Each show displays: audience size, estimated CPM, demographic profile, sponsor retention signal, ad engagement rate (when available), brand safety context, and a composite fit score. Brand browses, filters by category, sorts by fit / audience / CPM / engagement.

**Step 3 — Selection:** Brand selects shows via checkbox. Running totals display as they select (total impressions, estimated spend, show count).

**Step 4 — Plan builder:** Selected shows become line items. Brand configures default placement (pre/mid/post-roll), episodes per show, and spacing (weekly/biweekly/monthly). Platform calculates spot prices, blended CPM, and total spend using domain logic.

**Step 5 — IO generation:** One click generates industry-standard IOs for every show in the plan, pre-filled with all standard terms. Ready for e-signature.

**Step 6 — Verification and payment:** Ads run, delivery verified (Podscribe or RSS/transcript scanning), invoices auto-generated, payment facilitated through Stripe Connect.

**Why this flow:** First-time brand buyers don't trust an AI to make the final decision. They need to see the landscape to develop intuition, which is also the market education our GTM requires. The discovery list itself teaches them about the space — CPM ranges, audience sizes, the value of smaller shows.

## Recommendation Engine

The scoring engine combines three Podscan data sources and scores every candidate show across four dimensions.

**Data sources:**
- **Category Leaders** (`POST /category-leaders/search`) — Top shows per IAB/chart/self-reported category, ranked by Podscan Reach Score. Professional plan returns up to 500 shows per category.
- **Podcast Search** (`GET /podcasts/search`) — Filtered search with audience size, category, and sponsor filters.
- **Discover** (`GET /podcasts/{id}/discover`) — Vector similarity across content, demographics, and commercial dimensions. Used to fan out from strong matches and find adjacent shows the brand wouldn't have found otherwise.

**Scoring weights (default):**
- Audience fit: 40% — demographics match, age/gender skew, purchasing power, professional industry
- Ad engagement: 30% — mid-roll engagement rate, completion rate, placement details (requires listener engagement add-on)
- Sponsor retention: 20% — repeat advertisers and episode counts from `/podcasts/{id}/analysis` (proxy for conversion)
- Reach / PRS: 10% — audience size and chart position

**Brand safety:** Displayed as context on every show (GARM risk levels from `/podcasts/{id}/brand-safety`) but never used to exclude shows from results. A true crime podcast might flag medium risk but convert well for a security brand — the brand decides.

**Listener engagement add-on:** Paid Podscan add-on ($100/month). To be enabled when Wave 5 (scoring engine) is wired up. Until then, the engagement endpoint returns 403 and that dimension is weighted to zero with remaining dimensions redistributed.

**Key product rule:** Never optimize away the small, high-fit show. A 5K-download show with 95% audience fit should surface next to a 450K-download show with 80% fit. That variance is the Taylslate thesis in action — serving shows agencies ignore with data to back them up.

## Architecture Philosophy

**Agent-native design.** The web app is the on-ramp. The API is the real product.

1. **Database and API** — structured data layer that persists across agent sessions
2. **Domain logic engine** — IO formatting rules, CPM calculations, make-good thresholds, invoice generation, plan building
3. **Aggregated intelligence layer** — grows with every transaction
4. **Packaged skills / MCP server** — so AI agents can interact with Taylslate's data and logic
5. **Lightweight web UI** — for onboarding, review, and approval

**Build order:** Web app captures data → clean API underneath from day one → skills and MCP server for power users → as agents mature, the web app becomes one of several interfaces.

**Integration philosophy:** Don't build bespoke integrations to every platform. Build a clean API that agents can bridge. Exception: Podscribe integration is worth building directly (verification data connected to IO terms is core value prop).

## Tech Stack

- **Framework:** Next.js (App Router) with TypeScript
- **Styling:** Tailwind CSS 4 with custom CSS variables (see `app/globals.css` for design tokens)
- **Database:** Supabase (Postgres + Auth) — connected, active
- **Deployment:** Vercel
- **AI:** Claude API (scoring brand briefs, drafting outreach, extracting data from uploaded IOs)
- **Payments:** Stripe Connect for marketplace payments (Express accounts, card-on-file via SetupIntent)
- **Show data:** Podscan API (Professional plan) — primary data source for recommendations and enrichment
- **Verification (planned):** Podscribe API integration or RSS/transcript scanning
- **E-signature (planned):** DocuSign, BoldSign, or equivalent
- **Email:** Resend for transactional email

## Project Structure

```
app/
  page.tsx                          # Landing page (dark navy theme)
  globals.css                       # Design tokens (--brand-blue, --brand-surface, etc.)
  (dashboard)/
    layout.tsx                      # Authenticated layout with sidebar
    campaigns/                      # Brand-side campaign flow
      page.tsx                      # Campaign list
      new/page.tsx                  # Campaign brief form
      [id]/
        page.tsx                    # Discovery list (scored shows, checkboxes, plan summary)
        plan/page.tsx               # Plan builder (selected shows → line items → totals)
    settings/page.tsx               # Account & subscription settings
components/
  layout/Sidebar.tsx                # Main navigation sidebar
  discovery/                        # Discovery list components
  plan/                             # Plan builder components
lib/
  data/
    types.ts                        # ALL TypeScript types for the platform
    seed.ts                         # Realistic mock data (18 shows, deals, IOs, invoices)
    queries.ts                      # Supabase query functions
    index.ts                        # Barrel export
  podscan/                          # Podscan API client layer (Wave 4)
    client.ts                       # Base client with auth + rate limiting
    category-leaders.ts             # POST /category-leaders/search
    discover.ts                     # GET /podcasts/{id}/discover
    demographics.ts                 # GET /podcasts/{id}/demographics
    analysis.ts                     # GET /podcasts/{id}/analysis
    engagement.ts                   # GET /episodes/{id}/engagement (add-on required)
    brand-safety.ts                 # GET /podcasts/{id}/brand-safety
    search.ts                       # GET /podcasts/search
    types.ts                        # Podscan response types
  scoring/                          # Scoring engine (Wave 5)
    index.ts                        # Main scoring orchestrator
    dimensions/
      audience-fit.ts               # Demographics match scoring
      ad-engagement.ts              # Engagement data scoring
      sponsor-retention.ts          # Sponsor repeat-buy scoring
      reach.ts                      # PRS / audience size scoring
    weights.ts                      # Default weights + redistribution logic
  supabase/                         # Supabase client config
```

## Data Schema

Complete type system in `lib/data/types.ts`. Key entities:

- **Show** — podcast or YouTube channel with audience data, rate cards, demographics, sponsor history, engagement data
- **Campaign** — brand-side campaign brief + AI-generated scored show list (stored as ephemeral recommendation JSONB, not persisted to shows table)
- **CampaignSelection** — which shows the brand checked from the discovery list
- **MediaPlan** — line items built from selected shows, with placement, episodes, spacing, pricing
- **Deal** — relationship between brand and show, created when media plan is approved and IO is generated
- **InsertionOrder** — the contract, with per-episode line items. Modeled on real VeritoneOne IO template.
- **Invoice** — monthly billing document referencing IO line items
- **Profile** — user with role (brand, agency, agent, show) and subscription tier
- **AgentShowRelationship** — which agent represents which shows

**Architecture rule — discovered shows are ephemeral.** A scored list of 50-100 shows lives in the campaign recommendation JSONB, not the shows table. Only when a deal is created does a show record get persisted (or created if it doesn't exist). The shows table is agent inventory, not a Podscan mirror.

## Build Sequence

**Completed:**
- Supabase schema and RLS policies
- Auth (email/password + OAuth callback, middleware)
- Deal lifecycle (create, update, delete, list)
- IO generation (PDF, email send via Resend, VeritoneOne format)
- Invoice generation with make-good detection
- Show roster (CRUD, CSV import, enrichment stubs)
- Onboarding flow with role selection

**In progress:**
- Piece 5 (current)

**Next waves (post-current direction shift):**

**Wave 4 — Podscan integration layer:** Build `lib/podscan/` with typed clients for Category Leaders, Discover, Demographics, Analysis, Brand Safety, Podcast Search, Rankings, and Engagement. Rate limit handling (5K/day, 120/min on Professional). Engagement endpoint built but throws graceful "not enabled" error until add-on is turned on at Wave 5.

**Wave 5 — Scoring engine:** Build `lib/scoring/` with the four-dimension scoring. Takes a brand brief and returns a ranked list of 50-100 candidate shows with fit scores. Enable listener engagement add-on at this point.

**Wave 6 — Discovery list UI:** Replace current campaign results page with the scored list view. Filters, sort, checkboxes, running plan summary. Persist selections to a campaign record in Supabase.

**Wave 7 — Media plan builder:** New screen after discovery. Selected shows become line items. Placement config, episode config, spacing, pricing. Feeds into existing IO generation flow.

**Later:**
- Podscribe integration for verification
- MCP server for agent access
- YouTube expansion
- Cross-channel (Meta, TikTok, Google) budget allocation

## Podcast Advertising Domain Knowledge

- **CPM pricing:** Ad Spot Price = (Downloads ÷ 1,000) × CPM Rate. Range: $15–$50.
- **Placements:** Pre-roll (10% premium), mid-roll (standard), post-roll (25% discount).
- **Price types:** CPM-based (pay per actual download) or Flat Rate (fixed price with make-good if underdelivery >10%).
- **IO structure:** Per-episode line items with: format, post date, guaranteed downloads, show name, placement, scripted Y/N, personal experience Y/N, reader type, evergreen/dated, pixel Y/N, gross rate, gross CPM, price type, net due.
- **IO standard terms:** Competitor exclusivity (90 days), ROFR (30 days), make-good clause (>10% underdelivery), 45-day download tracking, FTC compliance, cancellation (14 days notice), morality/take-down clauses, Net 30 EOM payment.
- **Agency markup:** Agencies mark up CPM to brands (e.g., show's $25 CPM → agency charges $29.41 ~15%). Show never sees full rate. Taylslate's all-in 8% fee (Taylslate absorbs Stripe fees) is the transparent alternative.
- **Payment flow pain:** Shows must manually invoice agencies monthly. Net 30 EOM terms, but agencies routinely pay Net 60–75+. Show running a January ad may not see payment until April.
- **YouTube:** Flat-fee pricing (not CPM). $2K–$20K based on cultural significance. Content is evergreen.
- **Ad copy philosophy:** 3-5 bullet point talking points, not full scripts. Host authenticity is the value. No pre-approval review — verification is post-publication (Podscribe).
- **VeritoneOne IO template** is in project files — use as the format standard.
- **Never release show payouts until inbound brand payment settles.** Eliminates float risk.

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
- Pages import from Supabase via `lib/data/queries.ts` — seed data is only for development fallbacks now
- Keep components in `components/` organized by feature
- File naming: lowercase with hyphens for files, PascalCase for components
- All monetary values in USD, stored as numbers (not strings)
- Dates stored as ISO strings, displayed with `toLocaleDateString()`
- Build clean API endpoints from day one — the web UI is one of several future interfaces
- Schemas and forms must match real-world industry documents and processes
- Auto-commit with descriptive messages and push to main after each completed feature

## Competitive Context (Quick Reference)

- **LiveRead.io** — IO/invoice management, real integrations, but no AI, no discovery, no campaign planning. Operations only.
- **Gumball.fm** — Host-read ad marketplace (Headgum). 150+ shows, $10M Series A. Limited to own network inventory.
- **Podscribe** — Verification and attribution (IAB-certified). Industry standard. No IO/deal/payment data. Integrate, don't compete.
- **Traditional agencies (VeritoneOne, Ad Results Media)** — 15-20% markup, manual processes, ignore small shows. Taylslate is 10x faster, transparent 8% fee.

See `TAYLSLATE_CONTEXT.md` for full competitive analysis.

## Founder Working Style

- Prefers focused, step-by-step explanations over comprehensive overviews
- Works iteratively — build, test, refine
- Values authentic industry modeling — schemas must match real-world documents
- Uses Claude Code for building (disable worktree, work on main)
- Uses Claude desktop app for strategy and planning conversations
- Agent teams (parallel sessions with separated file scopes) for larger builds, single sessions for tightly coupled changes
- Comfortable with GitHub, terminal, Vercel deployment
- Think as a co-founder, not just an assistant
- Motivated by bold launches, not incremental releases
