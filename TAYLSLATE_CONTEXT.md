# Taylslate — Product & Founder Context

*Last updated: April 13, 2026. This document is the primary context reference for Claude when working on Taylslate.*

---

## 1. Founder

**Chris Taylor** — Founder of Taylslate. Previously ran a podcast media buying agency. Lost deals because the time between a brand expressing interest and delivering a campaign plan was too long — weeks or months of research, outreach, and vetting caused brands to shift budgets or lose enthusiasm. Charged 5% agency markup vs. the industry standard 15-20% but never closed a deal because the process was too slow. This firsthand pain is the foundation of the product.

Chris works iteratively, prefers focused step-by-step explanations, and builds functional prototypes before committing. Uses Claude Code for development (prefers the Claude desktop app over VS Code), GitHub for version control, and Vercel for deployment. Comfortable with terminal workflows. Prefers to work directly on main branches. Values authentic industry modeling — schemas and forms must match real-world documents and processes.

**Technical stack:** Next.js with TypeScript, Supabase backend, Tailwind 4, Vercel deployment.

---

## 2. The Vision

Taylslate is the infrastructure layer for the creator sponsorship economy — podcasts, YouTube, and eventually wherever host-endorsed advertising lives.

**The one-liner:** "Discover your shows. Build your plan. Send your IOs. Ads run. We verify. You get paid."

**The thesis:** Sponsorship advertising works, the market is growing ($4B+ podcast, $2B+ YouTube), but the buying process is stuck in 2015. Digital media buying has programmatic infrastructure. Creator sponsorship has email threads, Word docs, and 90-day payment terms. Taylslate closes that gap.

**What Taylslate does for each user type:**

- **Brands new to the space (primary target):** Discover shows matched to their brand, see transparent pricing, learn the market through the discovery list itself, build a media plan without agency fees.
- **Creators & their teams:** Manage inbound ad deals (DI or host-read). Track delivery. Auto-generate invoices. Get paid fast. Succeed regardless of show size.
- **Small shows & channels:** Get access to ad dollars. Even small shows with dedicated audiences are worth advertising on — Taylslate removes the cost barrier of transacting with them.

---

## 3. Target User Shift (April 2026)

The original spec targeted mid-market brands ($10K–$50K campaign budgets) in broad strokes. After conversations with industry operators (including a former Podcorn employee), we refined this:

**Primary target — brands new to podcast advertising.**
- They have budget and know podcast ads work.
- They don't know CPMs, audience sizes, flight structures, or how to evaluate a show.
- They enter with unrealistic expectations (a show with 200 downloads expecting $2K per ad — that's a $10,000 CPM).
- They need market education as part of the product, not separately.

**Secondary — sales agents and talent managers.** Still a valid user type for MVP validation. They represent multiple shows, manage inventory, and need IO/invoice automation.

**Late adopters — agencies.** They have workflow inertia. Existing IO templates, existing spreadsheets, existing relationships. They won't import everything into Taylslate on day one. They'll come around eventually, but they are not the early GTM target.

**Not the target — brands already spending in the space.** They have agency relationships and established processes. Hardest to convert, least valuable early.

---

## 4. Product Flow Shift — Discovery List, Not Auto-Plan

The original spec had AI generating a complete media plan. We're changing this to a two-step flow:

**Old flow:**
1. Brand inputs brief
2. AI generates complete media plan with recommended shows and budget allocation
3. Brand approves

**New flow:**
1. Brand inputs brief (URL, budget, target audience, goals)
2. **AI returns a scored discovery list of 50-100 shows**
3. Brand browses, filters, sorts, and **selects shows via checkbox**
4. Platform builds the media plan from selected shows (flight structure, placement, pricing, totals)
5. Brand approves plan → IOs generated

**Why this change matters:**

A first-time brand buyer doesn't trust an AI to make the final decision. They need to see the landscape before committing. The discovery list serves three functions simultaneously:

- **Market education:** Browsing the list teaches the brand about CPM ranges, audience sizes, and the value of smaller shows. They develop intuition without anyone explaining it to them.
- **Trust building:** Seeing 50-100 options with transparent data makes Taylslate look thorough and honest, not black-box.
- **Control:** The brand picks the shows. Taylslate structures the plan. Both parties contribute where they're strongest — the brand knows their brand, the platform knows the market.

**Variety is built in.** A scored list of 50-100 shows is inherently varied — big shows and niche gems surface together. The scoring data tells the story. A 5K-download show with 95% audience fit appears next to a 450K-download show with 80% fit, and the brand sees both with evidence for why each matters.

---

## 5. The Moat

The moat is the data. Everything else is a mechanism to capture it.

**Two things force data through Taylslate:**

1. **Automated verification** — Taylslate watches the public internet (RSS feeds, episode audio) and confirms ads ran, what was said, and whether downloads hit the guarantee. This is passive data capture. (Podscribe already does transcript-based verification and download checking. Taylslate should integrate with Podscribe rather than rebuild this.)

2. **Payment facilitation** — When money moves through Taylslate, we capture the one piece of data nobody shares voluntarily: what was actually paid, when, and by whom. This is the transaction intelligence that powers everything.

**What the data becomes over time:** Aggregated, anonymized intelligence — CPM benchmarks by category and show size, advertiser retention signals, delivery reliability scores, payment timing patterns. After thousands of transactions, Taylslate knows more about the real economics of creator sponsorship than any agency, brand, or network. That makes every subsequent recommendation smarter.

**Data usage model:** All proprietary data is used in aggregate only. No individual deal terms are exposed. Brands see category-level benchmarks. Shows see how they compare to their tier. Nobody sees anyone else's specific deal. ToS must clearly state users grant Taylslate a license to use aggregated, anonymized data.

**The Monaco analogy:** Monaco.com is the system of record for startup revenue — it replaced 5-8 fragmented sales tools with one AI-native platform where every interaction is captured and intelligence compounds over time. Taylslate is the system of record for creator sponsorship transactions.

---

## 6. Recommendation Engine

The scoring engine combines three Podscan data sources and scores every candidate show across four dimensions.

### Data Sources

**Category Leaders** (`POST /category-leaders/search`)
- Top shows per IAB/chart/self-reported category, ranked by Podscan Reach Score.
- Professional plan returns up to 500 shows per category.
- This is the primary pool-building source — solves the "same shows every time" problem that keyword search creates.

**Podcast Search** (`GET /podcasts/search`)
- Filtered search with audience size range, category, language, and sponsor filters.
- Used for targeted queries within a known category or size tier.

**Discover** (`GET /podcasts/{id}/discover`)
- Vector similarity across three dimensions: content, demographics, commercial.
- Used to fan out from strong matches and find adjacent shows the brand wouldn't have found otherwise.
- This is what creates recommendation variety — the long tail surfaces naturally.

### Scoring Weights (Default)

- **Audience fit: 40%** — demographics match to brand target (age distribution, gender skew, purchasing power, professional industry). Uses `/podcasts/{id}/demographics`.
- **Ad engagement: 30%** — mid-roll engagement rate, completion rate, placement details. Uses `/episodes/{id}/engagement`. Requires listener engagement add-on.
- **Sponsor retention: 20%** — repeat advertisers (high episode count = show converts). Uses `/podcasts/{id}/analysis`. This is the strongest conversion proxy until Taylslate has its own transaction data.
- **Reach / PRS: 10%** — audience size and chart position. Uses `/podcasts/rankings` and audience size on the podcast object.

### Brand Safety — Display, Don't Exclude

Brand safety is displayed as context on every show (GARM risk levels across 12 categories from `/podcasts/{id}/brand-safety`) but **never used to exclude shows from results**. A true crime podcast might flag medium risk but convert well for a security brand. A comedy podcast might flag low risk on profanity but be a great fit for an alcohol brand. The brand decides — Taylslate shows them the data.

### Listener Engagement Add-on

Paid Podscan add-on ($100/month). To be enabled when Wave 5 (scoring engine) is wired up. Until then, the engagement endpoint returns 403 gracefully and the scoring engine handles the missing dimension.

### Key Product Rule

Never optimize away the small, high-fit show. A 5K-download show with 95% audience fit should surface next to a 450K-download show with 80% fit. That variance is the Taylslate thesis in action — serving shows agencies ignore with data to back them up.

---

## 7. Competitive Landscape

### LiveRead.io
- **What they are:** Order management platform for podcast advertising. Manages IOs, invoicing, delivery tracking, ad copy distribution.
- **Strengths:** Real integrations (Megaphone, Bill.com, QuickBooks, BoldSign, HubSpot, Art19, YouTube). Real users including Always Sunny Podcast, Whitney Cummings, Bad Friends, Flagrant Media Group. 2.5+ years of iteration.
- **Ownership change:** In Nov 2024, Ilyas Frenkel (founder of Single Source Media, a podcast/YouTube ad agency) acquired controlling stake. Original founder Alex Aldea departed. CTO Mike Perrigue became CEO. Joined Sounds Profitable as partner organization.
- **Key weakness:** No AI intelligence layer. No campaign planning. No show discovery. Operations tool only — manages deals that already exist. Zero marketing to date. Enterprise-oriented UX.
- **What Taylslate does that LiveRead doesn't:** AI-driven discovery, show recommendations, scored lists, budget optimization, speed (brief to IO in minutes), serves brands who've never bought podcast ads before.

### Gumball.fm (Headgum)
- **What they are:** Marketplace for host-read ads. Amazon-style cart experience.
- **Strengths:** 400+ advertisers, 150+ shows. $10M Series A (2022). Full workflow from purchase through copy delivery, airchecks, and payment. Expanding to YouTube. Launched "adaptive ads" (AI-generated scripts matched to episode context) in late 2024. Revenue share model (creator keeps 70%+).
- **Key weakness:** Limited to their own network inventory. Marketplace model requires both sides to adopt their platform. 10K download minimum excludes smaller shows.
- **Key insight from Gumball:** They use 3-5 bullet point copy, not scripts. They intentionally don't let advertisers pre-review ad reads because it adds friction and diminishes authenticity. Airchecks are post-publication verification only.

### Podcorn (via former employee conversation)
- **Relevance:** Market education is the single biggest barrier to new-entrant adoption. Shows with 200 downloads expecting $2K per ad. Brands with no idea how the space works. Attempts to serve everyone without education built into the product failed.
- **Implication for Taylslate:** The discovery list itself is the education mechanism. Brands who can't handle seeing real CPMs and audience sizes aren't ready to transact anyway.

### Podscribe
- **What they are:** Attribution and verification platform. Industry standard for podcast ad measurement.
- **What they do:** Automated transcription of episodes, 18+ checks validating ad placement/duration/talking points, download counting, pixel-based attribution tracking conversions, incrementality testing. IAB-certified.
- **Taylslate relationship:** Integrate with Podscribe for verification and download data. Connect Podscribe's "what happened" to Taylslate's "what was agreed to" and "what was paid." The manual reconciliation between Podscribe reports and IOs in spreadsheets is the gap Taylslate fills.

### Podscan
- **What they are:** 4.4M podcasts, 51M episodes, real-time API, MCP server. Founder (Arvid Kahl) encourages building on their API.
- **Taylslate relationship:** Primary data provider. Scoring engine is built on Podscan endpoints (Category Leaders, Discover, Demographics, Analysis, Engagement, Brand Safety). Professional plan ($200/mo) covers current needs. Listener Engagement add-on ($100/mo) to be enabled at Wave 5.

### Rephonic
- **What they are:** Podcast data platform. 3M+ podcasts with demographics, reach estimates, sponsor history, contacts.
- **Taylslate relationship:** Alternative to Podscan. Currently using Podscan as primary. Rephonic remains viable as secondary/fallback if needed.

### Magellan AI
- **What they are:** Podcast advertising intelligence and measurement. Analytics-focused.
- **Taylslate differentiation:** Analytics only, no transaction facilitation.

### Traditional Agencies (VeritoneOne, Ad Results Media, etc.)
- **What they do:** Full-service buying. 15-20% markup. Manual IO generation using internal Word templates. Ignore shows under 10K downloads.
- **Payment terms:** Net 30 EOM officially, routinely Net 60-75+. Ad Results Media has Net 75 terms.
- **Taylslate positioning:** 10x faster, transparent 8% fee (no percentage markup, Taylslate absorbs Stripe fees), serves all show sizes.

---

## 8. Domain Knowledge — Podcast Advertising

### Ad Types
- **Host-read baked-in:** Host reads a live ad that is permanently part of the episode. Historically evergreen. Sometimes pulled after download threshold. Premium format.
- **Dynamic insertion (DI):** Pre-recorded ads stitched into episodes at playback via hosting platform (Megaphone, Libsyn, etc.). Can be host-read or not. Restricted to download/impression thresholds.
- **Same IO structure is used for both types.** Either side (brand or show) can send the IO.

### Pricing
- **CPM (cost per mille):** Ad spot price = (downloads ÷ 1,000) × CPM rate. Range: $15-$50.
- **Placement adjustments:** Pre-roll typically 10% premium, mid-roll is baseline, post-roll typically 25% discount.
- **Flat rate:** Fixed price with make-good if downloads underdeliver by >10%.
- **YouTube:** Typically flat-fee, not CPM. Higher rates because content is evergreen.

### Deal Flow
1. Brand reaches out to show directly, through buying agency, or through Taylslate
2. Show/plans delivered (Taylslate's discovery list replaces the disjointed agency process)
3. Deal confirms — brand selects shows and approves media plan
4. IO is sent with ad copy (can be together or separate — IO is the record of purchase)
5. Ad is read by host / inserted via DI
6. Podscribe verifies ad ran and checks downloads
7. Show invoices for ad read (Taylslate auto-generates)
8. Money is sent direct or through platform on net terms (Taylslate facilitates via Stripe Connect)

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
- Net 30 EOM payment terms (routinely violated by agencies)

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

**Taylslate payment rule:** Never release show payouts until inbound brand payment settles. Eliminates float risk.

### Industry Reference
- VeritoneOne IO template is in the project files — use as the format standard
- Agency markup example from real IO: Show CPM $25, agency charges brand $29.41 (~15% markup)

---

## 9. Architecture Philosophy

### Agent-Native Design
The future is not a monolithic web app with dozens of integrations. AI agents (Cowork, Claude Code, OpenClaw, Perplexity computer use) will increasingly be the interface through which normal people interact with their tools. Taylslate should be designed for this world.

**What Taylslate needs to be:**
1. **The database and API** — structured data layer that persists across agent sessions. Shows, brands, campaigns, IOs, invoices, delivery data, payment status.
2. **The domain logic engine** — scoring formulas, IO formatting rules, CPM calculations, placement adjustments, make-good thresholds, invoice generation. Podcast advertising expertise encoded as functions.
3. **The aggregated intelligence layer** — grows with every transaction, proprietary to Taylslate.
4. **Packaged skills / MCP server** — so agents can interact with Taylslate's data and logic.
5. **A lightweight web UI** — discovery list, plan builder, deal dashboard, settings. The data capture mechanism and the read-heavy dashboard. Not the primary workflow long-term.

**Build order:** Web app captures data → clean API underneath from day one → skills and MCP server for power users → as agents mature, the web app becomes one of several interfaces.

**Key principle:** Build for today's user, architect for tomorrow's. The web app gets data in. The API and skills are how data becomes powerful over time.

### Integration Philosophy
Don't build bespoke integrations to every platform (the LiveRead approach). Build a clean API that agents can use to bridge between Taylslate and whatever other tools the user has. This is more flexible, less maintenance, and positioned for where the market is going.

Exception: Podscribe integration is worth building directly because verification data connected to IO terms is a core value prop.

### Data Architecture Rule
**Discovered shows are ephemeral.** A scored list of 50-100 shows lives in the campaign recommendation JSONB, not the shows table. Only when a deal is created does a show record get persisted (or created if it doesn't exist). The shows table is agent inventory, not a Podscan mirror.

---

## 10. Launch Plan

### The Wedge
**"Discover your shows. Build your plan. Run your campaign."**

Full-speed play. Not a minor workflow improvement — a category-defining launch. The Monaco approach: come out with the complete thesis.

Brand comes in → inputs brief → gets scored discovery list of 50-100 shows → selects shows → plan builder structures flights and pricing → IOs generated → ads run → verified → invoiced → paid.

### What's Built
- Supabase foundation (schema, RLS, auth)
- Deal lifecycle (create, update, delete, list, PATCH status)
- IO generation (PDF, email via Resend, VeritoneOne format)
- Invoice generation with make-good detection
- Show roster (CRUD, CSV import, enrichment stubs)
- Onboarding flow with role selection
- Stripe Connect integration (Express accounts, SetupIntent for card-on-file)

### What's Next
1. **Podscan integration layer (Wave 4)** — Category Leaders, Discover, Demographics, Analysis, Brand Safety, Podcast Search, Rankings, Engagement (stub until add-on enabled).
2. **Scoring engine (Wave 5)** — Four-dimension scoring. Enable listener engagement add-on.
3. **Discovery list UI (Wave 6)** — Replace campaign results page with scored list, filters, checkboxes, running plan summary.
4. **Media plan builder (Wave 7)** — Selected shows become line items. Placement, episodes, spacing, pricing. Feeds into IO generation.

### What Comes Later
- Podscribe integration for automated verification
- Full MCP server / Claude Code skills
- Cross-channel expansion (Meta, TikTok, Google ad planning)
- Advanced AI with predictive performance scoring from transaction data
- YouTube-specific features (flat-fee structure, view tracking, evergreen performance)
- Agency tier at 10% fee (white-label IOs, multi-client dashboards) — post-launch, serves late adopters

---

## 11. GTM Stack

- **Development:** Claude Code (agent teams for larger builds, single sessions for tightly coupled changes)
- **Strategy:** Claude desktop app
- **Outbound:** Monaco.com
- **Inbound marketing:** Okara CMO
- **Human relationship layer:** Chris for first 50-100 customers
- **Email:** Resend (transactional)
- **Payments:** Stripe Connect

**Known prospect:** SaunaBox identified as real prospective client.

---

## 12. Working Style Preferences

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
- Git convention: auto-commit with descriptive messages and push to main after each completed feature
