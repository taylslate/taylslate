# Taylslate — Product & Founder Context

*Last updated: April 23, 2026. This document is the primary context reference for Claude when working on Taylslate.*

---

## 1. Founder

**Chris Taylor** — Founder of Taylslate. Previously ran a podcast media buying agency. Lost deals because the time between a brand expressing interest and delivering a campaign plan was too long — weeks or months of research, outreach, and vetting caused brands to shift budgets or lose enthusiasm. Charged 5% agency markup vs. the industry standard 15-20% but never closed a deal because the process was too slow. This firsthand pain is the foundation of the product.

Chris works iteratively: strategy first, confirm, draft prompt, ship, update docs. Prefers focused step-by-step explanations. Uses Claude Code for development (prefers the Claude desktop app over VS Code), GitHub for version control, and Vercel for deployment. Comfortable with terminal workflows. Prefers to work directly on main branches. Values authentic industry modeling — schemas and forms must match real-world documents and processes.

**Technical stack:** Next.js with TypeScript, Supabase backend, Tailwind 4, Vercel deployment, Stripe Connect (planned), third-party e-signature (planned).

---

## 2. The Vision

Taylslate is the infrastructure layer for the creator sponsorship economy — podcasts, YouTube, and eventually wherever host-endorsed advertising lives.

**The one-liner:** "Facebook Ads for podcast reads."

**The thesis:** Sponsorship advertising works, the market is growing ($4B+ podcast, $2B+ YouTube), but the buying process is stuck in 2015. Digital media buying has programmatic infrastructure. Creator sponsorship has email threads, Word docs, and 90-day payment terms. Taylslate closes that gap.

**What Taylslate does for each user type:**

- **Brands & agencies:** Source deals across the entire podcast and YouTube landscape. Get an AI-generated campaign plan in seconds. Send outreach. Track deal pipeline. Pay creators on time. See what converts.
- **Creators & their teams (including sales agents/networks):** Respond to inbound brand outreach. Manage ad deals. Track delivery. Auto-generate invoices. Get paid fast. Succeed regardless of show size.
- **Small shows & channels:** Get access to ad dollars. Even small shows with dedicated audiences are worth advertising on — Taylslate removes the cost barrier of transacting with them.

---

## 3. The Moat

The moat is the data. Everything else is a mechanism to capture it.

**Three things force data through Taylslate:**

1. **Automated verification** — Taylslate watches the public internet (RSS feeds, episode audio) and confirms ads ran, what was said, and whether downloads hit the guarantee. Integrate with Podscribe rather than rebuild.

2. **Payment facilitation** — When money moves through Taylslate, we capture the one piece of data nobody shares voluntarily: what was actually paid, when, and by whom.

3. **Preference-based recommendation** — Every outreach response, every iteration, every show starred or rejected is training signal. VeritoneOne recommends based on relationships (Rolodex). Taylslate recommends based on learned preferences (Spotify/Netflix pattern). This is what makes the recommendation engine a differentiator, not a feature.

**Deal history as product surface.** Every signed IO, every certificate of completion, every delivery receipt, every invoice, every payment — stored permanently in Supabase storage, searchable in each brand's and show's dashboard. DocuSign fragments this (signature happens in DocuSign, tracking in one system, payment in another). Taylslate unifies it. Nobody else in podcast advertising treats the record as a product.

**What the data becomes over time:** Aggregated, anonymized intelligence — CPM benchmarks by category and show size, advertiser retention signals, delivery reliability scores, payment timing patterns. After thousands of transactions, Taylslate knows more about the real economics of creator sponsorship than any agency, brand, or network.

**Data usage model:** All proprietary data is used in aggregate only. No individual deal terms are exposed. ToS must clearly state users grant Taylslate a license to use aggregated, anonymized data.

---

## 4. Competitive Landscape

### LiveRead.io
Order management platform for podcast advertising. Real integrations (Megaphone, Bill.com, QuickBooks, BoldSign for e-signatures, HubSpot, Art19, YouTube). Real users. **Weakness:** No AI, no discovery, no campaign planning. Operations tool only.

### Gumball.fm (Headgum)
Marketplace for host-read ads. Amazon-style cart. 400+ advertisers, 150+ shows. $10M Series A. **Weakness:** Limited to own network inventory. 10K download minimum excludes smaller shows.

### SpotsNow
"Hotel Tonight for podcast ads." Last-minute host-read inventory marketplace for remnant/unsold inventory. 10% cut. Competes on timing, not discovery or long-term recommendation.

### CreatorExchange
25% cut. Competitor.

### Podscribe
Attribution and verification platform. IAB-certified. Mature, trusted. **Integrate, don't compete.** Connect Podscribe's "what happened" to Taylslate's "what was agreed to" and "what was paid."

### Rephonic ($99-$299/month) / Podscan
Podcast data platforms. Podscan has real-time API + MCP server. Use as data providers, not competitors.

### Traditional Agencies (VeritoneOne, Ad Results Media)
Full-service buying. 15-20% markup. Uses DocuSign for e-signature (confirmed from IO PDF in project files). Net 30 EOM officially, routinely Net 60-75+. Ignore shows under 10K downloads. **Taylslate positioning:** 10x faster, 8% no markup, serves all show sizes.

---

## 5. Domain Knowledge — Podcast Advertising

### Ad Types
- **Host-read baked-in:** Host reads a live ad, permanently part of episode. Premium format.
- **Dynamic insertion (DI):** Pre-recorded ads stitched at playback. Same IO structure used for both.

### Pricing
- **CPM:** Ad spot price = (downloads ÷ 1,000) × CPM rate. Range: $15-$50.
- **Flat rate:** Fixed price with make-good if underdelivery >10%.
- **YouTube:** Flat-fee, $2K-$20K based on cultural significance, evergreen.
- **Real buyer campaigns start at $20K/month minimum** (data point from April 2026).

### Negotiation Pattern
CPM negotiation is typically one-direction — brand asks for less than listed, not more. Shows rarely ask for more than their rate card. Design: brand proposes terms upfront in outreach; show accepts, counters (usually with "I'll go down to X"), or declines. One round of negotiation by default.

### Deal Flow (Taylslate model — outreach-first)
1. Brand runs discovery, selects shows, builds media plan
2. Brand sends outreach email per show with proposed terms
3. Show (or their agent/network rep — most marketable shows are repped) clicks link, lands on pitch page
4. Show responds: accept, counter, or decline
5. On accept, brand builds IO with confirmed terms
6. IO signed via third-party e-signature (BoldSign/Dropbox Sign/DocuSign)
7. Ad runs
8. Podscribe verifies delivery
9. Brand charged per verified episode (pay-as-delivers model)
10. Show payout follows each charge

### IO Standard Fields
Advertiser, Publisher, Agency/Bill To, Format, Post Date, Downloads/Views guarantee, Show Name, Placement, Scripted Y/N, Personal Experience Y/N, Reader type, Type (Evergreen/Dated), Pixel required Y/N, Gross Rate, Gross CPM, Price Type, Net Due.

### IO Standard Terms
Competitor exclusivity (90 days), ROFR (30 days), make-good clause (>10% underdelivery), 45-day download tracking, FTC compliance, cancellation (14 days notice), morality/take-down clauses, Net 30 EOM payment.

### Ad Copy Philosophy
3-5 bullet point talking points, not full scripts. Host authenticity is the value. No pre-approval review loop.

### Industry Reference
- VeritoneOne IO template in project files. DocuSign for signature. Format standard.
- Agency markup example: Show CPM $25, agency charges brand $29.41 (~15% markup).

---

## 6. Architecture Philosophy

### Agent-Native Design
The future is not a monolithic web app. AI agents will increasingly be the interface. Taylslate is:
1. Database and API
2. Domain logic engine
3. Aggregated intelligence layer
4. Packaged skills / MCP server
5. Lightweight web UI (capture + dashboard, not primary workflow long-term)

### Integration Philosophy
Build a clean API that agents can bridge. Exception integrations: Podscribe (verification data is core value prop), third-party e-signature (regulatory compliance as a regulatory product is not worth rebuilding).

### E-signature Strategy
**Third-party signs. Taylslate owns the record.**

- **Signing event** → BoldSign, Dropbox Sign, or DocuSign. They handle ESIGN/UETA compliance, audit trails, certificates of completion.
- **Record** → Taylslate stores the signed PDF + certificate in Supabase, tied to the deal, forever.
- DocuSign confirmed used by Veritone (from IO PDF Envelope ID in project files).
- Dropbox Sign preferred given Chris's existing Dropbox account.
- Do NOT build e-signature in-house — compliance is a forever-liability product, not a one-time build.

### Payment Strategy (Wave 13)
**Pay-as-delivers, not escrow.**

- Card-on-file via Stripe SetupIntent at IO signature. No charge at that moment.
- Each verified episode delivery triggers a charge against the brand's card for that episode's amount.
- Show payout follows the charge via Stripe Connect.
- No pre-funding, no escrow holding.

**Why this shape:** Brands won't fund upfront for multi-month campaigns. Industry norm is charge-at-delivery.

**Anti-leakage levers (since we can't hold money):**
- Speed — show gets paid in days through Taylslate vs. chasing brand Net 60-75
- Payment reliability — card on file, automatic charge on delivery, show doesn't chase
- Future deal flow — shows routing around Taylslate don't stay in discovery pool
- Brand-side operational friction — brand committed to platform flow, rerouting is more work

**Margin lever — ACH routing.** Stripe is the real variable cost, not Claude API. Card charges at 2.9% + $0.30 vs. ACH at 0.8% capped at $5. For $20K+ campaigns, ACH saves huge margin. Build ACH prominently into IO signature UX.

---

## 7. Launch Plan

### The Wedge
**"Facebook Ads for podcast reads."** Brand runs discovery, reaches out to shows, closes deals, gets them executed, pays fast — all in one platform.

### Revenue Model (locked April 22, 2026)
- **8% all-in** platform fee for self-serve brands (absorbs Stripe fees)
- **10% managed tier** — Chris-as-operator running campaigns for brands wanting hands-on service
- No SaaS subscription
- No early-payout fee for shows
- No metered feature gates
- Pay only when you transact

**First 100 brands may get a better rate** as a product-market-fit incentive — decide per-deal.

### Build Status (April 23, 2026)

**Complete:**
- Waves 4-10: Foundation (Supabase, auth, roster), Podscan integration, scoring engine, discovery list, media plan builder, brand + show onboarding
- **Wave 11:** Outreach-to-onboarded-show loop (April 23, 2026)
  - Outreach entity, Claude-drafted pitch composer, public pitch page at `/outreach/[token]`
  - Dual-state logic (onboarded vs not)
  - Magic link account creation
  - Wave 9 +1 step for ad_copy_email + billing_email
  - Accept / Counter / Decline flow with brand notifications
  - 121 Vitest tests passing (+38 over prior baseline)

**Remaining:**
- **Wave 12:** IO generation + third-party e-signature integration. Signed PDF + certificate stored forever per deal.
- **Wave 13:** Stripe charging on pay-as-delivers model. SetupIntent at IO signature, charge per verified delivery, Connect payout to show.
- Podscribe integration for automated verification
- Stripe SDK module-load error (pre-existing baseline issue, must fix before Wave 13)
- Scoring engine tuning
- MCP server

### GTM Posture
Chris runs the first 100+ brand campaigns operator-style (10% managed tier effectively). Self-serve 8% brands are a later phase. Domain expertise is the trust bridge while the product builds a track record. Every signed IO becomes a case study.

---

## 8. Working Style Preferences

- Strategy → confirm → draft prompt → ship → update docs
- Focused, step-by-step explanations over comprehensive overviews
- Schemas must match real-world industry documents
- Build iteratively — one wave at a time
- Claude Code for building (main branch, no worktree)
- Claude desktop app for strategy conversations
- CLAUDE.md and TAYLSLATE_CONTEXT.md kept current after major direction changes
- Bold launches, not incremental releases
- Think as a co-founder, not just an assistant

---

## 9. Key Principles Reaffirmed

- **Pay only when you transact** — the whole elegance of the 8% model
- **Market education is product** — discovery and outreach must be low-friction for brands new to podcast ads
- **Preference-based recommendation is the moat** — not Rolodex, not data licensing alone
- **Friction goes at payment, not at agreement** — shows accept outreach, sign IOs, onboard; they're pushed to sign up at the moment of real value exchange
- **Predictability builds trust** — no stochastic shuffling of recommendations
- **Optimize Stripe, not tokens** — Claude API costs are negligible; payment rail economics are where margin lives
- **Third-party signs, Taylslate owns the record** — e-signature is infrastructure, not a build
- **Deal history as product surface** — nobody else in the space does this
