# Taylslate — Product & Founder Context

*Last updated: March 3, 2026. This document is the primary context reference for Claude when working on Taylslate.*

---

## 1. Founder

**Chris Taylor** — Founder of Taylslate. Previously ran a podcast media buying agency. Lost deals because the time between a brand expressing interest and delivering a campaign plan was too long — weeks or months of research, outreach, and vetting caused brands to shift budgets or lose enthusiasm. Charged 5% agency markup vs. the industry standard 15-20% but never closed a deal because the process was too slow. This firsthand pain is the foundation of the product.

Currently works at **Supercast.com** — familiar with Stripe Connect marketplace payments, creator payment models, and platform fee structures (Supercast charges a platform fee, creators pay Stripe fees, listed transparently on site).

Chris works iteratively, prefers focused step-by-step explanations, and builds functional prototypes before committing. Uses Claude Code for development (prefers the Claude desktop app over VS Code), GitHub for version control, and Vercel for deployment. Comfortable with terminal workflows. Prefers to work directly on main branches. Values authentic industry modeling — schemas and forms must match real-world documents and processes.

**Technical stack:** Next.js with TypeScript, Supabase backend, Tailwind 4, Vercel deployment.

---

## 2. The Vision

Taylslate is the infrastructure layer for the creator sponsorship economy — podcasts, YouTube, and eventually wherever host-endorsed advertising lives.

**The one-liner:** "Plan your campaign. Send your IOs. Get paid. All in one place."

**The thesis:** Sponsorship advertising works, the market is growing ($4B+ podcast, $2B+ YouTube), but the buying process is stuck in 2015. Digital media buying has programmatic infrastructure. Creator sponsorship has email threads, Word docs, and 90-day payment terms. Taylslate closes that gap.

**What Taylslate does for each user type:**

- **Brands & agencies:** Source deals across the entire podcast and YouTube landscape. Get an AI-generated campaign plan in seconds. Send IOs. Track delivery. Pay creators on time. See what converts.
- **Creators & their teams:** Manage inbound ad deals (DI or host-read). Track delivery. Auto-generate invoices. Get paid fast. Succeed regardless of show size.
- **Small shows & channels:** Get access to ad dollars. Even small shows with dedicated audiences are worth advertising on — Taylslate removes the cost barrier of transacting with them.

---

## 3. Revenue Model

**Two revenue streams. Clean and transparent.**

### SaaS Subscriptions
| Plan | Price | Target |
|------|-------|--------|
| Starter | $49/mo | Individual buyers, 5 campaigns/mo |
| Growth | $149/mo | Growing brands, IO gen, invoicing |
| Business | $349/mo | Agencies & teams, payment facilitation, priority |

### Early Payment Fee (2.5%)
Shows/creators opt in to receive payment in 7 days instead of waiting Net 30 EOM (realistically 60-90 days). 2.5% of invoice amount deducted from payout. Market rate — Tipalti NetNow charges ~2.5% ($1,950 on a $2,000 invoice), invoice factoring industry charges 1-3%.

**Example flow:**
- IO line item: $875 (Oddvice, Mid-roll, Flat Rate)
- Show opts for early payment
- Early payment fee (2.5%): -$21.88
- Show receives: $853.12 in 7 days
- Without early payment: $875 in 60-90 days

### Payment Architecture (Stripe Connect)
- **Brand pays in:** ACH preferred (Stripe charges 0.8% capped at $5). Card available but brand pays processing fee on top of IO amount. All fees clearly itemized on brand's receipt.
- **Taylslate pays out:** ACH only. $0.25 per payout — we absorb this.
- **Stripe fees = pass-through.** Not our revenue, not our cost. Charged to whoever triggers them. Listed transparently on the site, same model Chris uses at Supercast.
- **We do not mark up Stripe fees.** Revenue comes from SaaS + early payment fees only.
- **Stripe Connect is the long-term choice.** No Tipalti. We build the early payment logic ourselves.

### Financial Projections (from v3 model)
| Metric | Base (M24) | Strong (M24) | Monaco Pop (M24) |
|--------|-----------|-------------|-----------------|
| Paid Customers | 1,353 | 6,113 | 34,113 |
| Total MRR | $260K | $1.18M | $6.56M |
| ARR | $3.1M | $14.1M | $78.7M |
| Cumulative GMV | $42.9M | $159.3M | $756M |
| Margin | 97.3% | 97.4% | 97.4% |
| Valuation (mid) | $31M | $198M | $1.42B |

---

## 4. The Moat

The moat is the data. Everything else is a mechanism to capture it.

**Two things force data through Taylslate:**

1. **Automated verification** — Taylslate watches the public internet (RSS feeds, episode audio) and confirms ads ran, what was said, and whether downloads hit the guarantee. This is passive data capture that happens without any user action. (Note: Podscribe already does transcript-based verification and download checking. Taylslate should integrate with Podscribe rather than rebuild this.)

2. **Payment facilitation** — When money moves through Taylslate, we capture the one piece of data nobody shares voluntarily: what was actually paid, when, and by whom. The early payment fee incentivizes this — shows want fast payment, so money flows through the platform.

**What the data becomes over time:** Aggregated, anonymized intelligence — CPM benchmarks by category and show size, advertiser retention signals, delivery reliability scores, payment timing patterns. After thousands of transactions, Taylslate knows more about the real economics of creator sponsorship than any agency, brand, or network.

**Data usage model:** All proprietary data is used in aggregate only. No individual deal terms are exposed. No show-specific CPMs are shared. Brands see category-level benchmarks. Shows see how they compare to their tier. Nobody sees anyone else's specific deal. ToS must clearly state users grant Taylslate a license to use aggregated, anonymized data.

**The Monaco analogy:** Monaco.com is the system of record for startup revenue — it replaced 5-8 fragmented sales tools with one AI-native platform where every interaction is captured and intelligence compounds over time. Taylslate is the system of record for creator sponsorship transactions.

---

## 5. Competitive Landscape

### LiveRead.io
- **What they are:** Order management platform for podcast advertising. Manages IOs, invoicing, delivery tracking, ad copy distribution.
- **Strengths:** Real integrations (Megaphone, Bill.com, QuickBooks, BoldSign for e-signatures, HubSpot, Art19, YouTube). Real users including Always Sunny Podcast, Whitney Cummings, Bad Friends, Flagrant Media Group. 2.5+ years of iteration.
- **Ownership change:** In Nov 2024, Ilyas Frenkel (founder of Single Source Media, a podcast/YouTube ad agency) acquired controlling stake. Original founder Alex Aldea departed. CTO Mike Perrigue became CEO. Joined Sounds Profitable as partner organization.
- **Key weakness:** No AI intelligence layer. No campaign planning. No show discovery. Operations tool only — manages deals that already exist. Zero marketing to date, fully word-of-mouth. Has not achieved broad industry adoption despite quality product. Enterprise-oriented UX.
- **What Taylslate does that LiveRead doesn't:** AI campaign planning, show discovery, budget optimization, recommendation engine, speed (plan to IO in seconds not weeks), serves brands who've never bought podcast ads before.
- **One-liner defense:** "LiveRead helps you manage deals you already have. We help you get the deals in the first place — then manage them too."

### Gumball.fm (Headgum)
- **What they are:** Marketplace for host-read ads. Amazon-style cart experience — advertisers browse shows, add inventory, check out with credit card.
- **Strengths:** 400+ advertisers, 150+ shows. $10M Series A (2022). Full workflow from purchase through copy delivery, airchecks, and payment. Expanding to YouTube. Launched "adaptive ads" (AI-generated scripts matched to episode context) in late 2024. Revenue share model (creator keeps 70%+).
- **Key weakness:** Limited to their own network inventory. Marketplace model requires both sides to adopt their platform. 10K download minimum excludes smaller shows.
- **Key insight from Gumball:** They use 3-5 bullet point copy, not scripts. They intentionally don't let advertisers pre-review ad reads because it adds friction and diminishes authenticity. Airchecks are post-publication verification only.

### Podscribe
- **What they are:** Attribution and verification platform. Industry standard for podcast ad measurement.
- **What they do:** Automated transcription of episodes, 18+ checks validating ad placement/duration/talking points, download counting, pixel-based attribution tracking conversions, incrementality testing. IAB-certified. Import campaign calendars from Google Sheets.
- **Key fact:** They already do automated verification (scanning episodes for ad reads) and download checking. This is mature, trusted technology.
- **What they DON'T have:** No IO data, no deal terms, no invoice data, no payment data, no deal pipeline, no campaign planning, no show discovery.
- **Taylslate relationship:** Integrate with Podscribe for verification and download data. Connect Podscribe's "what happened" to Taylslate's "what was agreed to" and "what was paid." The manual reconciliation between Podscribe reports and IOs in spreadsheets is the gap Taylslate fills.

### Brand-Side Landscape (No Direct Competitor)
- **Self-serve ad platforms (Spotify Ad Manager, Acast, Podbean, SiriusXM):** Dynamic insertion only, not host-read sponsorships. Pre-recorded spots stitched at playback. Different product entirely.
- **Full-service agencies (ADOPTER Media, Ad Results Media, VeritoneOne):** 15-20% markup, weeks-long process, ignore small shows. ADOPTER has 100K+ ads placed, 25K+ shows, 1K+ campaigns.
- **Marketplaces (Gumball, Audioboom Showcase):** Limited to own network inventory.
- **Gap:** No platform where brand inputs brief and gets AI-optimized campaign plan across entire open podcast landscape with IOs ready to send.

### Other Players
- **Magellan AI** — Podcast advertising intelligence and measurement. Analytics-focused, no transaction facilitation.
- **PodEngine** — Sponsor extraction from transcripts (563K sponsors). Has MCP server. Extremely aggressive competitive restrictions with named competitors and $50K liquidated damages. Avoid.
- **Rephonic ($99-$299/month)** — Podcast data platform. 3M+ podcasts with demographics, reach estimates, sponsor history, contacts. Most permissive commercial terms. Primary recommended data provider.
- **Podscan** — 4.4M podcasts, 51M episodes, real-time API, MCP server integration. Founder (Arvid Kahl) encourages building on their API. Strong alternative data provider.

### Traditional Agencies
- **What they do:** Full-service buying. 15-20% markup. Manual IO generation using internal Word templates. Ignore shows under 10K downloads.
- **Payment terms:** Net 30 EOM officially, routinely Net 60-75+. Ad Results Media has Net 75 terms.
- **Taylslate positioning:** 10x faster, no percentage markup, serves all show sizes. Early payment in 7 days vs 60-90+ through agencies.

---

## 6. Domain Knowledge — Podcast Advertising

### Ad Types
- **Host-read baked-in:** Host reads a live ad that is permanently part of the episode. Historically evergreen. Sometimes pulled after download threshold. Premium format.
- **Dynamic insertion (DI):** Pre-recorded ads stitched into episodes at playback via hosting platform (Megaphone, Libsyn, etc.). Can be host-read or not. Restricted to download/impression thresholds.
- **Same IO structure is used for both types.** Either side (brand or show) can send the IO.
- **Taylslate doesn't handle ad delivery.** That's the hosting platform's job. We own everything before (planning, matching, outreach, IO, e-signature) and after (verification, invoicing, payment).

### Pricing
- **CPM (cost per mille):** Ad spot price = (downloads ÷ 1,000) × CPM rate. Range: $15-$50.
- **Flat rate:** Fixed price with make-good if downloads underdeliver by >10%.
- **YouTube:** Typically flat-fee, not CPM. Higher rates because content is evergreen.
- **Price type on IO:** Either CPM-based (pay per actual download) or flat rate.

### Deal Flow
1. Brand reaches out to show directly or through buying agency
2. Show/plans delivered — can be disjointed through direct contact or agency collates options
3. Deal confirms
4. IO is sent with ad copy (can be together or separate — IO is the record of purchase)
5. Ad is read by host / inserted via DI
6. Podscribe verifies ad ran and checks downloads
7. Show invoices for ad read
8. Money is sent direct or through agency on net terms

### IO Standard Fields
Advertiser, Publisher, Agency/Bill To, Format (Podcast/YouTube), Post Date, Downloads/Views guarantee, Show Name, Placement (Pre/Mid/Post), Scripted (Y/N), Personal Experience (Y/N), Reader type (Host-Read), Type (Evergreen/Dated), Pixel required (Y/N), Gross Rate, Gross CPM, Price Type, Net Due.

### IO Standard Terms
- Competitor exclusivity (90 days typical)
- Right of first refusal (ROFR, 30 days)
- Make-good clause (>10% underdelivery triggers free additional placement)
- 45-day download tracking window
- FTC compliance requirements
- Cancellation terms (14 days notice)
- Morality/take-down clauses
- Net 30 EOM payment terms (routinely violated)

### Ad Copy Philosophy
- Bullet points / talking points preferred over full scripts
- 3-5 copy points is standard (per Gumball)
- Host authenticity is the entire value of host-read ads — over-scripting defeats the purpose
- No pre-approval review loop — adds friction, degrades product quality
- Verification happens post-publication automatically (Podscribe)

### Payment Pain
- Net 30 EOM terms are standard but routinely violated
- Agencies regularly pay Net 60, Net 75, or longer
- Shows must manually invoice every month separately for multi-month contracts
- A show running an ad in January may not see payment until April
- Small podcast operations struggle with cash flow
- **This is why the early payment fee works:** 2.5% to get paid in 7 days vs waiting 60-90 days is a no-brainer for most creators

### Industry Reference
- VeritoneOne IO template is in the project files — use as the format standard
- Agency markup example from real IO: Show CPM $25, agency charges brand $29.41 (~15% markup)

---

## 7. Architecture Philosophy

### Agent-Native Design
The future is not a monolithic web app with dozens of integrations. AI agents (Cowork, Claude Code, OpenClaw, Perplexity computer use) will increasingly be the interface through which normal people interact with their tools. Taylslate should be designed for this world.

**What Taylslate needs to be:**
1. **The database and API** — structured data layer that persists across agent sessions. Shows, brands, IOs, invoices, delivery data, payment status.
2. **The domain logic engine** — IO formatting rules, CPM calculations, make-good thresholds, invoice generation. Podcast advertising expertise encoded as functions.
3. **The aggregated intelligence layer** — grows with every transaction, proprietary to Taylslate.
4. **Packaged skills / MCP server** — so agents can interact with Taylslate's data and logic.
5. **A lightweight web UI** — for onboarding, review, and approval. The data capture mechanism and the read-heavy dashboard. Not the primary workflow long-term.

**Build order:** Web app captures data → clean API underneath from day one → skills and MCP server for power users → as agents mature, the web app becomes one of several interfaces.

**Key principle:** Build for today's user, architect for tomorrow's. The web app gets data in. The API and skills are how data becomes powerful over time.

### Integration Philosophy
Don't build bespoke integrations to every platform (the LiveRead approach). Build a clean API that agents can use to bridge between Taylslate and whatever other tools the user has. This is more flexible, less maintenance, and positioned for where the market is going.

Exception: Podscribe integration is worth building directly because verification data connected to IO terms is a core value prop.

### Payment Infrastructure
Stripe Connect for marketplace payments. We build the early payment logic ourselves — the opt-in flow, the fee calculation, the accelerated payout scheduling. No Tipalti or other third-party payment orchestration. Stripe Connect is the long-term commitment.

---

## 8. Launch Plan

### Build Priority: Sales Agent First, Then Monaco Launch

**Phase 1: Sales Agent MVP.** The sales agent managing multiple shows is the first user. Build deal creation, IO generation, invoice generation, and pipeline tracking. Get him using it. His feedback shapes the product.

**Phase 2: Monaco-Style Launch.** The brand-side experience that makes people share. Brand inputs URL + budget + audience → AI generates campaign plan → IOs ready to send. This is the demo that goes viral.

**Positioning to the sales agent:** "We're going to bring you deals you wouldn't have gotten otherwise." Not a LiveRead replacement — a complement that creates new business.

### What Needs to Be Built

1. **Show database** — seed with Chris's knowledge of 100-150 shows (CPMs, categories, audience profiles, download ranges). Enrich with Rephonic or Podscan API. Doesn't need every show — needs enough to produce credible plans.

2. **AI campaign planning engine** — Claude API with system prompt encoding Chris's domain expertise. How to match brands to shows, allocate budget across flights, CPM ranges by category/size, standard testing patterns.

3. **IO generation** — industry-standard format matching VeritoneOne template. Already partially built.

4. **Automated verification** — integrate with Podscribe or build lightweight RSS/transcript scanning to confirm ad delivery.

5. **Payment facilitation** — Stripe Connect for marketplace payments. Brand pays Taylslate, Taylslate pays show. Early payment opt-in with 2.5% fee.

6. **Invoice auto-generation** — triggered by verified delivery, calculated from IO terms.

7. **Clean interface** — brand brief input, campaign plan output, IO management, deal pipeline, payment tracking.

### What Comes Later
- Full MCP server / Claude Code skills
- Cross-channel expansion (Meta, TikTok, Google ad planning)
- Advanced AI with predictive performance scoring
- Expanded show database through transaction data and API enrichment

---

## 9. Working Style Preferences

- Prefers focused, step-by-step explanations over comprehensive overviews
- Values authentic industry modeling — schemas must match real-world documents
- Works iteratively — build, test, refine
- Prefers Claude desktop app for development conversations
- Uses Claude Code for actual building (disable worktree, work on main)
- Uses CLAUDE.md files for project context in Claude Code
- Comfortable with GitHub workflows, terminal commands, deployment
- Wants Claude to think as a co-founder, not just an assistant
- Watches X.com for product launches and market trends
- Motivated by big launches (Monaco-style) not incremental SaaS releases
- Works at Supercast.com — understands Stripe Connect, platform fees, creator economics
