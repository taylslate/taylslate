# Taylslate — Product & Founder Context

*Last updated: April 22, 2026. This document is the primary context reference for Claude when working on Taylslate.*

---

## 1. Founder

**Chris Taylor** — Founder of Taylslate LLC. Previously ran a podcast media buying agency. Lost deals because the time between a brand expressing interest and delivering a campaign plan was too long — weeks or months of research, outreach, and vetting caused brands to shift budgets or lose enthusiasm. Charged 5% agency markup vs. the industry standard 15-20% but never closed a deal because the process was too slow. This firsthand pain is the foundation of the product.

Chris serves as the human relationship layer for early customers. GTM stack includes Monaco.com (outbound), Okara CMO (inbound), and Claude Code (engineering). Taylslate is currently his sole professional focus.

**Technical stack:** Next.js with TypeScript, Supabase backend, Tailwind 4, Vercel deployment.

---

## 2. The Vision

**The tagline:** "Facebook ads for podcast reads."

This reframes what Taylslate is. Not a marketplace where two sides meet and negotiate. A self-serve platform where a brand shows up, defines their audience, and the system does the work. Nobody thinks of Facebook ads as a marketplace — you input targeting, set budget, and the platform delivers. Taylslate does the same for podcast sponsorship.

**Layer 3 positioning:** Taylslate is the transaction data layer and payment rail — not the agent (Layer 1) or the orchestrator (Layer 2). Vertical domain expertise beats horizontal agent capability. The data moat compounds with transaction volume.

**What Taylslate does for each user type:**
- **Brands new to the space (primary target):** Discover shows matched to their brand, see transparent pricing, learn the market through the discovery list itself, build a media plan without agency fees.
- **Creators & their teams:** Get discovered by brands, receive auto-generated IOs and invoices, get paid faster than through agencies.
- **Small shows & channels:** Access ad dollars that agencies ignore. Even 5K-download shows surface with data backing their value.

---

## 3. Target User — Refined April 2026

After conversations with a former Podcorn employee and industry operators:

**Primary — brands new to podcast advertising.** They have budget and motivation. They don't know CPMs, flight structures, or how to evaluate shows. They enter with zero context and need the product itself to educate them.

**The Podcorn lesson:** Shows with 200 downloads expected $2K per ad ($10,000 CPM — 200-400x reality). Brands had zero idea what they were doing. Market education is NOT a separate function — it IS the product. The discovery list educates brands. The show onboarding educates creators. Both happen through the normal product flow, not through documentation or specialists.

**Not the target:** Brands already spending (have agencies), agencies themselves (workflow inertia), shows expecting unrealistic rates without willingness to learn.

---

## 4. Product Flow — Discovery List, Not Auto-Plan

The original spec had AI generating a complete media plan. The new flow separates discovery from planning, giving brands agency over show selection while the platform handles the domain logic.

**Brand-side flow:**
1. Brand signs up → 10-step conversational onboarding captures durable brand profile
2. New campaign → "Anything different?" screen with profile overrides → single text-area brief
3. AI returns scored discovery list (35-100 shows) → brand browses, filters, sorts, selects via checkbox
4. Platform builds media plan from selections (placement, episodes, spacing, pricing)
5. Generate IOs → deals created → IO PDFs generated and sent
6. Brand card charged on verified delivery → show paid (manual initially)

**Show-side flow:**
1. Show signs up → 11-step conversational onboarding with CPM education
2. RSS/Apple Podcasts link auto-populates data from Podscan
3. Step 6 (pricing) teaches realistic market rates: "Shows with [X] downloads typically earn $Y-$Z CPM"
4. Profile ready for brand discovery

**Why this flow:**
- First-time buyers need to SEE the landscape before trusting a recommendation
- The discovery list IS the market education — brands learn CPM ranges, audience sizes, show variety
- Checkbox selection respects brand agency while platform handles the math
- Returning brands get "use as-is" shortcut — campaign creation becomes 60 seconds

---

## 5. The Moat

The moat is the data. Everything else is a mechanism to capture it.

**Two things force data through Taylslate:**
1. **Automated verification** — confirms ads ran, what was said, whether downloads hit the guarantee. Integrate with Podscribe rather than rebuild.
2. **Payment facilitation** — captures what was actually paid, when, and by whom. This is the transaction intelligence that powers everything.

**What the data becomes:** Aggregated, anonymized intelligence — CPM benchmarks by category and show size, advertiser retention signals, delivery reliability scores. After thousands of transactions, Taylslate knows more about real creator sponsorship economics than any agency.

**Data usage model:** Aggregate only. No individual deal terms exposed. Brands see category-level benchmarks. Shows see how they compare to their tier.

---

## 6. Recommendation Engine

### Data Sources

**Category Leaders** (`POST /category-leaders/search`) — Pool building. Up to 500 shows per category on Professional plan. Primary source for show variety.

**Podcast Search** (`GET /podcasts/search`) — Filtered queries with `language=en`, audience size range, category, and sponsor filters.

**Discover** (`GET /podcasts/{id}/discover`) — Vector similarity across content, demographics, and commercial dimensions. Fans out from strong matches to find adjacent shows.

### Scoring Weights

| Dimension | Weight | Source | Signal |
|-----------|--------|--------|--------|
| Audience fit | 40% | `/podcasts/{id}/demographics` | Age, gender, purchasing power, industry match |
| Ad engagement | 30% | `/episodes/{id}/engagement` | Mid-roll engagement rate, completion, placement details |
| Sponsor retention | 20% | `/podcasts/{id}/analysis` | Repeat advertisers = conversion proxy |
| Reach / PRS | 10% | Podcast object + rankings | Audience size and chart position |

**Brand safety:** GARM risk levels displayed but NEVER used to exclude shows.

**Podscan Listener Engagement add-on:** Enabled ($100/month). Provides real ad engagement data (completion rates, skip patterns, per-placement metrics).

### Known Issues
- Discovery sometimes returns 35-49 shows instead of 50-100 target
- Over-indexes on topically adjacent but format-mismatched shows (sleep shows for wellness brands)
- English filter on Category Leaders is approximate (no language field returned, relies on US chart proxy)
- Sponsor counts sometimes capped at 50 (possible pagination issue in analysis endpoint)

---

## 7. Business Model (IN FLUX — April 2026)

### Decided
- **8% all-in platform fee** on transactions (Taylslate absorbs Stripe fees)
- **10% for agency/white-label tier**
- Fee transparency as competitive differentiator
- Never release payout before inbound payment settles
- Show payouts manual initially, automated when volume justifies
- Early payout option (7 days for 2.5% fee) planned

### In Flux
- **Hybrid model under consideration:** SaaS subscription for planning + transaction fee for deals
- Each discovery run costs ~$0.09-0.40 in API calls — should additional runs be metered?
- Possible tiered structure: Free (1 campaign) / Starter $49/mo / Pro $149/mo / Agency $349/mo + 10%
- Data licensing as future revenue stream

### Cost Analysis (Confirmed)
- Claude API per closed deal: ~$0.59 (Haiku scoring, Sonnet generation)
- Claude API never crosses 1% of revenue at any scale
- Stripe fees (2.9% + $0.30) are 5-6x more expensive than Claude
- Fixed costs: Podscan $300/mo, Supabase ~$25/mo, Vercel ~$20/mo, Resend ~$20/mo
- At 100 transactions/month ($15K avg): $12K revenue, $59 Claude, $318 Stripe = 97% contribution margin

---

## 8. Competitive Landscape

### CreatorExchange (thecreatorx.io)
- **What:** Ossa Collective rebrand. Two-sided marketplace, ~1,800 shows after 6 years.
- **Model:** Performance-based with "shared upside" campaigns. IP-based attribution. Takes **25% cut**.
- **Weakness:** No AI discovery, no self-serve planning. Just signup forms on both sides. Limited to recruited inventory.
- **Taylslate advantage:** Self-serve AI planning, entire Podscan universe, 8% transparent fee vs 25%.

### SpotsNow (spotsnow.io)
- **What:** "Hotel Tonight for podcast ads." Last-minute/remnant inventory marketplace. Founded by Cam Pritchard.
- **Model:** Agencies with urgent budget browse available inventory and book quickly. Takes **10% cut**.
- **Weakness:** Only solves last-minute spend. Assumes you already know podcast advertising. Agency-friendly, not agency-disruptive.
- **Watch for:** Scope creep into general planning (Hotel Tonight → Airbnb trajectory).
- **Taylslate advantage:** Planning from scratch for new buyers, not just last-minute bookings.

### LiveRead.io
- **What:** Order management for podcast advertising. Real integrations (Megaphone, Bill.com, QuickBooks, BoldSign, HubSpot).
- **Users:** Always Sunny Podcast, Whitney Cummings, Bad Friends, Flagrant Media Group.
- **Ownership:** Ilyas Frenkel (Single Source Media) acquired controlling stake Nov 2024.
- **Weakness:** No AI, no discovery, no campaign planning. Operations tool only. Zero marketing.
- **Taylslate advantage:** AI discovery, show recommendations, speed, serves brands who've never bought.

### Gumball.fm (Headgum)
- **What:** Host-read ad marketplace. Amazon-style cart. 400+ advertisers, 150+ shows. $10M Series A.
- **Weakness:** Limited to own network. 10K download minimum.
- **Key insight:** 3-5 bullet point copy, not scripts. No pre-approval review. Airchecks are post-pub only.

### Podscribe
- **What:** Attribution and verification. IAB-certified. Industry standard.
- **Relationship:** Integrate, don't compete. Connect Podscribe's "what happened" to Taylslate's "what was agreed to."

### Traditional Agencies (VeritoneOne, Ad Results Media)
- **Model:** 15-20% markup, manual IO generation, ignore shows under 10K downloads, Net 30 EOM routinely violated (Net 60-75+ common).
- **Taylslate positioning:** 10x faster, transparent 8% fee, serves all show sizes.

**Key competitive insight:** Nobody is doing what Taylslate does today. CreatorExchange and SpotsNow are adjacent and could expand. Taylslate's advantage is building the self-serve AI layer first while they build inventory. The "Facebook ads for podcast reads" framing immediately differentiates from the marketplace mental model.

---

## 9. Domain Knowledge — Podcast Advertising

### Pricing
- **CPM:** Ad spot price = (downloads ÷ 1,000) × CPM rate. Range: $15-$50.
- **Placement adjustments:** Pre-roll ~10% premium, mid-roll baseline, post-roll ~25% discount.
- **Flat rate:** Fixed price with make-good if downloads underdeliver by >10%.
- **YouTube:** Flat-fee (not CPM). $2K-$20K. Content is evergreen.

### Deal Flow
1. Brand discovers shows (Taylslate replaces the agency research phase)
2. Brand builds media plan and approves
3. IO generated and sent to shows
4. Show accepts → ad is read/inserted
5. Delivery verified (Podscribe integration planned)
6. Brand charged on verified delivery
7. Show paid (manual initially, automated later)

### IO Standard Terms
- Competitor exclusivity (90 days)
- Right of first refusal (ROFR, 30 days)
- Make-good clause (>10% underdelivery)
- 45-day download tracking window
- FTC compliance, cancellation (14 days notice)
- Net 30 EOM payment terms
- VeritoneOne IO template is the format standard

### Ad Copy Philosophy
- 3-5 bullet point talking points, not full scripts
- Host authenticity is the entire value
- No pre-approval review — verification is post-publication
- "Faked in" (recorded separately, edited in) is still considered baked-in

### Payment Pain (the opportunity)
- Agencies routinely pay Net 60-75+ despite Net 30 EOM terms
- Shows must manually invoice every month
- January ad → payment may not arrive until April
- Taylslate rule: never release payout until inbound brand payment settles

---

## 10. Architecture Philosophy

### Agent-Native Design
1. **Database and API** — structured data layer persisting across sessions
2. **Domain logic engine** — scoring, IO formatting, CPM calculations, make-good thresholds
3. **Aggregated intelligence layer** — grows with every transaction
4. **Packaged skills / MCP server** — for AI agent access (planned)
5. **Lightweight web UI** — onboarding, discovery, plan builder, deal dashboard

**Build order:** Web app first → clean API underneath → skills and MCP server later.

### Key Architecture Rules
- Discovered shows are ephemeral (JSONB on campaign). Only persist to shows table when a deal is created.
- Shows table = agent inventory, not a Podscan mirror.
- Brand profiles and show profiles are separate from campaign data (durable vs situational).
- CLAUDE.md requires "REQUIRED/ALWAYS/no exceptions" language for conventions Claude Code must follow.

---

## 11. GTM

### Outreach Model (Layered)
- **Early stage (now):** Chris handles show outreach for brands manually. Free — part of platform value.
- **Service tier (later):** Brands pay 2-3% extra for managed outreach (10-11% all-in, still cheaper than agencies).
- **Self-serve (default goal):** Brand gets contact info and AI-drafted outreach copy. Handles it themselves at 8%.

### Show Acquisition
- Shows onboard organically when IOs arrive from brands using the platform
- No cold recruitment campaigns needed (unlike marketplace competitors)
- Onboarding flow educates shows on realistic market rates
- Every completed transaction is a warm lead for the show to join the platform

### GTM Stack
- **Development:** Claude Code (agent teams for builds, single sessions for fixes)
- **Strategy:** Claude chat interface
- **Outbound:** Monaco.com
- **Inbound:** Okara CMO
- **Human layer:** Chris for first 50-100 customers

---

## 12. Working Style Preferences

- Focused, step-by-step over comprehensive overviews
- Authentic industry modeling — schemas match real-world documents
- Iterative — build, test, refine
- Claude Code desktop app for building (Opus 4.7 + deeper thinking for complex waves)
- Claude chat for strategy and planning
- Agent teams for larger builds; single sessions for tightly coupled changes
- Think as a co-founder, not just an assistant
- Motivated by bold launches, not incremental releases
- Development method: methodical wave-by-wave with verification before moving on
- Context files (CLAUDE.md, TAYLSLATE_CONTEXT.md) kept current after major direction changes
