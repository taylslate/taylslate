# Taylslate — Product & Founder Context

*Last updated: April 28, 2026. Pricing model locked. This document is the primary strategic context reference for Claude when working on Taylslate. For build state, schema, and technical conventions, see `CLAUDE.md`.*

---

## 1. Founder

**Chris Taylor** — Founder of Taylslate. Previously ran a podcast media buying agency. Lost deals because the time between a brand expressing interest and delivering a campaign plan was too long — weeks or months of research, outreach, and vetting caused brands to shift budgets or lose enthusiasm. Charged 5% agency markup vs. the industry standard 15-20% but never closed a deal because the process was too slow. This firsthand pain is the foundation of the product.

Chris works iteratively, prefers focused step-by-step explanations, and builds functional prototypes before committing. Uses Claude Code (desktop app) for development, Claude.ai chat for strategy conversations, GitHub for version control, Vercel for deployment. Comfortable with terminal workflows. Prefers to work directly on main branches. Values authentic industry modeling — schemas and forms must match real-world documents and processes.

Taylslate is currently Chris's sole professional focus.

**Technical stack:** Next.js with TypeScript, Supabase backend, Tailwind 4, Vercel deployment, Claude API (Sonnet/Opus) for all AI, DocuSign for e-signatures, Resend for email, Stripe for payments (Wave 13+), Podscan for podcast data enrichment.

---

## 2. The Vision & Positioning (Updated April 2026)

Taylslate is **Layer 3 infrastructure** for podcast and YouTube sponsorship advertising — the transaction data layer and payment rail that brands, shows, and AI agents operate on.

**The one-liner:** "Facebook Ads for podcast reads."

**The positioning shift (March → April 2026):** Originally framed as "AI generates a complete campaign plan." Refined to: AI returns a scored discovery list of 50-100 shows, brand selects via checkbox, platform builds the media plan using domain logic. Market education happens through the discovery list experience itself — not through separate documentation or onboarding specialists. Discovery-list + human-select is more trustworthy, educationally valuable, and commercially sound than AI generating a complete plan autonomously.

**The thesis:** Sponsorship advertising works, the market is growing ($4B+ podcast, $2B+ YouTube, 20%+ annually), but the buying process is stuck in 2015. Digital media has programmatic infrastructure. Creator sponsorship has email threads, Word docs, and 90-day payment terms. Taylslate closes that gap.

**Target user (refined April 2026):** Brands **new to podcast advertising**. Not brands already spending heavily — they have agencies. Not agencies themselves — they're late adopters with workflow inertia. Market education is core GTM function, and shows with unrealistic CPM expectations are a documented barrier that the product addresses through discovery flow + show onboarding education.

**What Taylslate does for each user type:**

- **Brands new to podcast advertising ($30K-$50K monthly campaign budgets):** Founder-led and operated, often with an agency handling social spend but new to podcast specifically. Enter URL, budget, demographics. Get a scored discovery list in seconds. Select shows. Platform builds the media plan. Send outreach. Sign IOs via DocuSign. Card on file charges per verified delivery. See what converts. Testing podcast as a channel — Pay-as-you-go pricing matches their psychology. Convert to Operator once channel is proven.
- **Shows & creators (onboarded via outreach acceptance):** Receive pitch from brand with proposed terms. Accept, counter, or decline. Get IO auto-generated. Sign via DocuSign. Get paid via Stripe as episodes deliver. Auto-invoicing. Fair pricing.
- **Shows under 10K downloads:** Systematically ignored by agencies. Taylslate removes the cost barrier of transacting with smaller shows. This matters for long-tail inventory.
- **Sales agents / rep companies (Wave 14/15):** Represent portfolios of shows. High-leverage GTM — one agent onboards, 10-30 shows arrive. Data model exists (`agent_show_relationships`), UX not built yet.

---

## 3. The Moat

The moat is the data. Everything else is a mechanism to capture it.

**Two things force data through Taylslate:**

1. **Automated verification** — Taylslate watches the public internet (RSS feeds, episode audio) and confirms ads ran, what was said, whether downloads hit the guarantee. Passive data capture. Podscribe does transcript-based verification and download checking already, so Taylslate will integrate rather than rebuild (planned post-Wave-13). Taylslate's contribution: connecting Podscribe's "what happened" to Taylslate's "what was agreed to" and "what was paid."

2. **Payment facilitation** — When money moves through Taylslate (Wave 13 and beyond), we capture the one piece of data nobody shares voluntarily: what was actually paid, when, by whom. This is the transaction intelligence that powers everything.

**What the data becomes over time:** Aggregated, anonymized intelligence — CPM benchmarks by category and show size, advertiser retention signals, delivery reliability scores, payment timing patterns. After thousands of transactions, Taylslate knows more about the real economics of creator sponsorship than any agency, brand, or network. Every subsequent recommendation gets smarter.

**Data usage model:** All proprietary data used in aggregate only. No individual deal terms exposed. No show-specific CPMs shared. Brands see category-level benchmarks. Shows see how they compare to their tier. Nobody sees anyone else's specific deal. ToS must clearly state users grant Taylslate a license to use aggregated, anonymized data.

**The Monaco analogy:** Monaco.com is the system of record for startup revenue — replaced 5-8 fragmented sales tools with one AI-native platform where every interaction is captured and intelligence compounds over time. Taylslate is the system of record for creator sponsorship transactions.

---

## 4. Key Strategic Decisions (Locked as of April 24, 2026)

### Pricing & Fees (Locked April 28, 2026)

Three-tier model pressure-tested in pricing strategy session. Customer chooses entry point; conversion to higher tiers is sales-led, not gated. Reference class is commerce infrastructure (Shopify, Toast), not full marketing suites (HubSpot, Salesforce) — Taylslate is a channel tool, "Facebook Ads for podcast reads," not a marketing platform.

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

**Real buyer minimum:** $30K-$50K/month campaigns (revised from $20K based on customer reality).

### Pricing Philosophy (the why behind the model)

**Transaction fee is the entry. SaaS is the upgrade for ongoing operations.** Customers earn their way to SaaS rather than being gated into it. Founder-buyers testing podcast advertising for the first time start on PAYG with no recurring fee. Once they prove the channel and run consistent monthly spend, they convert to Operator for better economics.

**Optimize for churn over per-customer revenue.** PAYG generates more per-customer revenue than Operator at high volumes (10% on $100K/month = $10K vs Operator's $5,999), but Operator customers retain dramatically longer because the platform gets cheaper as they scale rather than more expensive. Higher LTV through stickier relationships beats higher per-month revenue from volatile transaction-only customers.

**Don't gate the wedge. Gate the scale features.** AI planning, discovery, IO generation, verification, invoicing, and payment are the wedge — must be available to everyone. Things that only matter at scale (concurrent campaign caps, portfolio dashboard, API access, multi-client architecture, white-label) gate naturally to the tier where they're actually needed.

**Customer chooses, platform doesn't force.** No mandatory graduation by volume thresholds. Some customers will stay on PAYG even when Operator is cheaper because they value zero monthly fee. Respect that choice.

### Why Other Models Were Rejected

- **Pure 8% transaction (previous model):** Doesn't generate recurring revenue, structurally caps exit multiple, fights retention at scale (high-volume customers leave for in-house when 8% × $1M/year = $80K, cheaper to insource a media buyer at $90-120K).
- **Pure SaaS:** Sticker shock at the entry point. Founders testing podcast advertising for the first time won't sign up for a $1,500/month subscription before knowing the channel works. The "test before paying" psychology is real and primary.
- **Feature-gated tiers (gate features behind SaaS):** Taylslate's value is in the wedge features. Gating those undermines the entire pitch. There aren't enough non-wedge features to justify a SaaS tier purely on capability.
- **Per-campaign / per-discovery / per-outreach metering:** Too much billing complexity for too little revenue. Doesn't fit the customer's mental model.
- **Listing fees / featured placement for shows:** Compromises discovery integrity. The mission is helping shows that don't get enough ad dollars find more deals — pay-to-play discovery contradicts that. Killed permanently.
- **$1,500/mo Operator price (initial proposal):** Too high for the founder-buyer reference class. They compare Taylslate to Facebook Ads / Google Ads (channel tools), not to HubSpot (marketing suite). $499 anchors correctly.

### Conversion Mechanic (Most Important Operational Detail)

PAYG → Operator conversion rate is the single highest-leverage activity in the company. Every percentage point moves year-3+ revenue dramatically. The CS function and trigger system are non-negotiable, not nice-to-have.

**Internal trigger system:**
- When a customer's trailing 90-day GMV averages above $12,500/month, fire an internal alert
- Alert goes to Chris initially, then to a CS person once that role exists
- Includes the math: "Customer X spending $Y/month. PAYG cost: $Z. Operator would save them $W/year."
- Triggers a sales-led upgrade conversation, not an automated email

**Customer-facing signal (built later):**
- Subtle dashboard indicator showing estimated savings if they switched
- No popups, no pressure — just shows the math so customers can self-discover

**Switching mechanics:**
- Friction-free, prorated through Stripe Subscription primitives
- Keep all data, deal history, customer relationship intact
- Allow downgrades back to PAYG if customer requests (don't trap them)

### Three Revenue Streams (Three Modes of Using Taylslate)

The streams aren't just three revenue lines — they're three distinct *modes of using the platform*:

1. **Transaction (PAYG, 10%)** — "Human running campaigns through the UI occasionally." Day 1 entry point.
2. **SaaS (Operator $499+6%, Agency $5,000+4%)** — "Human running campaigns through the UI consistently." Month 3+ recurring revenue engine.
3. **API/MCP (per-call + per-deal pricing)** — "Agents running campaigns programmatically." Month 9-12+ for agent-mediated commerce.

This coherence matters. Adding unrelated streams (concierge, data products, financing) would fragment the story. Three streams, three modes, one product.

**API/MCP pricing shape (future):**
- Per-call pricing for read operations (discovery runs, show lookups, scoring queries) — roughly $0.10-$0.50/call
- Per-deal pricing for write operations (campaigns created, IOs generated) — roughly $5-$25/IO
- 1-2% additional surcharge on transactions executed via API (on top of customer's underlying plan rate)
- Probably NOT a flat monthly subscription for API access — fights the "agents pay per use" model

Don't decide API pricing now. Architect Wave 13 to log every API call with customer ID, timestamp, and operation type. That data enables intelligent pricing in 12 months.

### Revenue Projections (Base Case, No Agencies)

Agencies are pure upside, not in the base model — there aren't 175 podcast advertising agencies that exist to capture by year 6. Treat agency adoption as gravy.

- **Year 1:** ~$900K total revenue
- **Year 2:** ~$4.5M
- **Year 3:** ~$15.8M (~$11M recurring, 70% recurring share)
- **Year 4:** ~$36M
- **Year 5:** ~$74M
- **Year 6:** ~$90M revenue (77% recurring) → $720M-$900M exit at 8-10x blended multiple

**Path to $1B exit:** Operator retention at high volumes ($100K-$200K/month customers) is the primary lever. If those customers stay on the platform rather than going in-house, year 6 revenue jumps to $100-105M and $1B exit becomes comfortable. Agency adoption (a few major agencies — Veritone, Ad Results, Oxford Road, Marketsmith, Right Side Up) and faster API/agent ecosystem maturity are upside levers on top.

### Three Things That Determine Whether This Works

1. **Operator conversion rate.** Target 40-50% of brands who run more than one campaign convert within 6 months. The CS function and trigger system are how this gets achieved.

2. **Operator retention at high volumes.** Customers spending $100K-$200K/month must stay on Operator rather than leaving for in-house. The product needs to be undeniably better than spreadsheets and a hired media buyer at that scale. Year 3-5 product roadmap should obsess over "what does the $200K/month Operator customer need next?"

3. **API revenue maturity by year 3-4.** Depends on whether AI agents become a real commerce channel. If yes, meaningful third revenue line. If no, model still works but caps lower.

### Wave 13 Architectural Requirements

These must happen in Wave 13 because retrofitting later is painful:

1. **Customer plan field** — `pay_as_you_go`, `operator`, `agency` enum on customer record
2. **Per-customer dynamic transaction fee** — `platform_fee_percentage` stored on customer record. Stripe Connect `application_fee_amount` calculated per-charge from this field. Never hardcode 10% anywhere.
3. **Stripe Subscription billing** — Set up subscription products and prices for Operator ($499) and Agency ($5,000) even if zero customers are subscribed at launch.
4. **Seat counting** — `seat_count` on customer record. Per-seat billing via Stripe Subscription quantity.
5. **Plan switching with proration** — Use Stripe Subscription's built-in proration, not custom logic.
6. **Event logging at fine granularity** — Every campaign generation, discovery run, IO generation, outreach sent, and API call needs logged with customer ID, timestamp, and operation type. Foundation for future API revenue stream.
7. **GMV trigger alerting** — Trailing 90-day GMV per customer. Alert system fires at Operator breakeven ($12,500/month). Conversion mechanic must work from day Wave 13 ships.

### Investor Pitch Shape

> "Brand-side transaction fee gets customers in the door at zero adoption friction. Most active customers convert to a $499/month + 6% Operator plan within 6 months once they prove the channel. By year 3, recurring revenue is ~70% of total. By year 6 we project $90M revenue, 77% recurring, with agencies and API revenue as upside levers. The model is structurally optimized for retention — customers stay because the platform gets cheaper as they scale, not more expensive."

This pitch is more credible than including aggressive agency assumptions. Investors discount aggressive assumptions; honest assumptions with clear upside levers are more persuasive.

### Payment model (Wave 13)
- **Pay-as-delivers, NOT escrow**
- Card-on-file via Stripe SetupIntent at IO signature (not charged yet)
- Charged per episode as it runs in billing cycle (verified delivery triggers charge)
- Show payout follows each verified delivery charge
- No pre-funding, no held escrow
- Show can opt into early payout (within 7 days) for 2.5% fee
- **Core financial rule:** Payout NEVER released until inbound brand payment has settled. Zero float risk.
- Anti-leakage mechanisms are speed, reliability, future deal flow, brand operational friction — not escrow

### E-signature (Wave 12 shipped)
- **DocuSign** as vendor. Confirmed used by Veritone — industry trust signal. Starter plan ($50/mo, 40 envelopes) at production launch, sandbox free during development.
- **Hosted signing at launch.** Show redirects to DocuSign's domain. Matches industry convention.
- **Embedded signing is the near-term upgrade** (post-funding). Requires Intermediate tier (~$300/mo). Premium brand feel.
- **No custom DocuSign branding at launch.** Level 1 branding deferred to post-funding (Business Pro tier).
- **Brand signs first, show countersigns** (matches agency origination pattern).
- Do NOT build e-signature in-house. ESIGN/UETA compliance is a regulatory product, not something to recreate.

### Outreach flow (Wave 11 shipped)
- Brand composes outreach with proposed terms (CPM, episode count, placement, flight dates)
- Claude drafts pitch body (Wave 12 future polish: tighten system prompt to reduce fluff)
- Public pitch page at `/outreach/[token]` with signed JWT tokens — forwardable to agents naturally
- Dual-state logic: not onboarded shows see magic-link setup flow; onboarded shows go straight to accept/counter/decline
- Brand-forward styling throughout — emails from brand name, landing page header "[Brand] wants to work with [Show]", Taylslate in small footer
- Multi-contact schema deferred indefinitely — shows just have `ad_copy_email` and `billing_email` columns

### Auth (unification planned)
- Current: brands use email/password, shows use magic link + Supabase OTP
- Target: unified magic link + 6-digit OTP for all users
- Deferred to Wave 12.5 or folded into Wave 13 — not blocking validation

### Product principle — agentic design
Every form field must pass: **"Is this a decision or mechanical work?"**
- Decisions stay manual (budget, goals, exclusions)
- Mechanical work gets AI-derived with human confirm/edit (brand name, category, demographics, CPM defaults)
- Forms ask; conversations suggest
- Applies to brand onboarding, show onboarding, outreach drafting, IO terms, Stripe setup

---

## 5. Build History & Current State

See `CLAUDE.md` for full wave-by-wave detail. High level:

- **Waves 1-3 (Feb-Mar 2026):** Supabase foundation, deal transaction loop, show roster + agent onboarding. Migration from in-memory seed data.
- **Waves 4-7 (Mar 2026):** Show discovery via Podscan, scoring engine (audience 40 / engagement 30 / retention 20 / reach 10), discovery list UI, media plan builder.
- **Waves 8-10 (Mar-Apr 2026):** Conversational onboarding (brand + show), brand-profile-aware campaigns.
- **Wave 11 (April 23, 2026):** Outreach-to-onboarded-show loop. 121 tests. Public pitch page, magic link account creation, accept/counter/decline, brand proposes terms upfront.
- **Wave 12 (April 23, 2026):** IO PDF generation + DocuSign JWT integration + hosted signing + HMAC webhook verification + signed PDF storage + day-3/day-14 timeout cron. 157 tests (+36). Migrations 013-014 applied.

**Real user validation pending.** Chris's sales agent friend will onboard multiple shows + test show-side flows. Brand friends will test brand-side. Pre-req: verify `taylslate.com` in Resend so magic links actually deliver.

**Next: Wave 13 — Stripe pay-as-delivers.** Pre-existing Stripe SDK build error must be fixed with same lazy-require pattern used for DocuSign in Wave 12.

---

## 6. Competitive Landscape

### LiveRead.io
- **What they are:** Order management platform for podcast advertising. Manages IOs, invoicing, delivery tracking, ad copy distribution.
- **Strengths:** Real integrations (Megaphone, Bill.com, QuickBooks, BoldSign for e-signatures, HubSpot, Art19, YouTube). Real users including Always Sunny Podcast, Whitney Cummings, Bad Friends, Flagrant Media Group. 2.5+ years of iteration.
- **Ownership change:** Nov 2024, Ilyas Frenkel (founder of Single Source Media, a podcast/YouTube ad agency) acquired controlling stake. Original founder Alex Aldea departed. CTO Mike Perrigue became CEO. Joined Sounds Profitable as partner organization.
- **Key weakness:** No AI intelligence layer. No campaign planning. No show discovery. Operations tool only. Zero marketing to date, fully word-of-mouth. Enterprise-oriented UX.
- **What Taylslate does that LiveRead doesn't:** AI campaign planning, show discovery, budget optimization, recommendation engine, speed, serves brands who've never bought podcast ads before.

### Gumball.fm (Headgum)
- **What they are:** Marketplace for host-read ads. Amazon-style cart experience.
- **Strengths:** 400+ advertisers, 150+ shows. $10M Series A (2022). Full workflow. Expanding to YouTube. Launched "adaptive ads" (AI scripts matched to episode context) late 2024. Revenue share 70%+ to creator.
- **Key weakness:** Limited to own network inventory. Marketplace requires both sides to adopt. 10K download minimum excludes smaller shows.
- **Key insight from Gumball:** They use 3-5 bullet point copy, not scripts. Don't let advertisers pre-review ad reads — adds friction, diminishes authenticity. Airchecks are post-publication verification only.

### Podscribe
- **What they are:** Attribution and verification platform. Industry standard for podcast ad measurement.
- **What they do:** Automated transcription, 18+ checks validating ad placement/duration/talking points, download counting, pixel-based attribution, incrementality testing. IAB-certified.
- **Key fact:** They already do automated verification and download checking. Mature, trusted tech.
- **What they DON'T have:** No IO data, deal terms, invoice data, payment data, deal pipeline, campaign planning, show discovery.
- **Taylslate relationship:** Integrate (planned post-Wave-13). Connect "what happened" to "what was agreed to" and "what was paid." The manual reconciliation between Podscribe reports and IOs in spreadsheets is the gap Taylslate fills.

### Magellan AI
- **What they are:** Podcast advertising intelligence and measurement. Analytics-focused.
- **Taylslate differentiation:** Analytics only, no transaction facilitation.

### Podscan (Primary Data Provider, not competitor)
- **What they are:** 4.4M podcasts, 51M episodes, real-time API, MCP server. Founder (Arvid Kahl) encourages building on their API.
- **Taylslate use:** Category Leaders, Podcast Search, Discover endpoints. Pool building (500 shows/category), filtered search, vector similarity. Professional plan.
- **Key future primitive:** "Find shows like this one" using Discover endpoint (vector similarity) — first-class UI element, preference signal capture to `brand_profiles` for learning. Competitive differentiator vs. VeritoneOne's Rolodex model.

### Rephonic (Alternative Data Provider)
- **What they are:** 3M+ podcasts with demographics, reach estimates, sponsor history, contacts.
- **Why backup vs primary:** Most permissive commercial ToS. Worth keeping as alternative.

### Traditional Agencies (VeritoneOne, Ad Results Media)
- **What they do:** Full-service buying. 15-20% markup. Manual IO generation (internal Word templates). Ignore shows under 10K downloads.
- **Payment terms:** Net 30 EOM officially, routinely Net 60-75+. Ad Results Media has Net 75 terms.
- **Taylslate positioning:** 10x faster, 8% transparent fee, serves all show sizes.

---

## 7. Domain Knowledge — Podcast Advertising

### Ad Types
- **Host-read baked-in:** Host reads live ad, permanently part of episode. Historically evergreen. Sometimes pulled after download threshold. Premium format.
- **Dynamic insertion (DI):** Pre-recorded ads stitched at playback via hosting platform (Megaphone, Libsyn). Can be host-read or not. Restricted to download/impression thresholds.
- **Same IO structure used for both types.** Either brand or show can send the IO.

### Pricing
- **CPM (cost per mille):** Ad Spot Price = (downloads ÷ 1,000) × CPM rate. Range: $15-$50.
- **Flat rate:** Fixed price with make-good if downloads underdeliver >10%.
- **YouTube:** Typically flat-fee, not CPM. Higher rates because content is evergreen.
- **Price type on IO:** Either CPM-based (pay per actual download) or flat rate.

### Deal Flow
1. Brand reaches out to show directly or through buying agency
2. Show/plans delivered — can be disjointed via direct contact or agency collates options
3. Deal confirms
4. IO is sent with ad copy (IO is the record of purchase)
5. Ad is read by host / inserted via DI
6. Podscribe verifies ad ran and checks downloads
7. Show invoices for ad read
8. Money sent direct or through agency on net terms

**Taylslate's flow compresses all of this into a single platform with card-on-file pay-as-delivers.**

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

### Payment Pain (problem Taylslate solves)
- Net 30 EOM standard but routinely violated
- Agencies regularly pay Net 60, Net 75, or longer
- Shows manually invoice every month separately for multi-month contracts
- A show running an ad in January may not see payment until April
- Small podcast operations struggle with cash flow

### Industry Reference
- VeritoneOne IO template in project files — format standard
- Agency markup example from real IO: Show CPM $25, agency charges brand $29.41 (~15% markup)

---

## 8. Architecture Philosophy

### Agent-Native Design
The future is not a monolithic web app with dozens of integrations. AI agents (Cowork, Claude Code, OpenClaw, Perplexity computer use) will increasingly be the interface through which normal people interact with their tools. Taylslate should be designed for this world.

**What Taylslate needs to be:**
1. **The database and API** — structured data layer that persists across agent sessions
2. **The domain logic engine** — IO formatting rules, CPM calculations, make-good thresholds, invoice generation
3. **The aggregated intelligence layer** — grows with every transaction, proprietary to Taylslate
4. **Packaged skills / MCP server** — so agents can interact with Taylslate's data and logic
5. **A lightweight web UI** — for onboarding, review, and approval

**Build order:** Web app captures data → clean API from day one → skills and MCP server for power users → as agents mature, the web app becomes one of several interfaces.

**Key principle:** Build for today's user, architect for tomorrow's.

### Integration Philosophy
Don't build bespoke integrations to every platform (the LiveRead approach). Build a clean API that agents can use to bridge between Taylslate and whatever tools the user has. More flexible, less maintenance, positioned for where the market is going.

**Exceptions worth building directly:**
- **Podscribe** — verification data connected to IO terms is core value prop
- **DocuSign** — e-signature compliance is a regulatory product

### Domain Events (Wave 12 foundation)
Append-only audit log at `domain_events` table. Every state transition fires an event (entity.action form: `outreach.created`, `outreach.accepted`, `deal.created`, `envelope.signed`, etc.). Fat payloads with `schema_version` field. Service-role write only. Future MCP server / webhook subscriptions will consume this.

---

## 9. Launch Plan

### Current State (April 2026)
- Full flow built through signed IO (Waves 1-12)
- Pending: Wave 13 (Stripe), domain verification in Resend, first real user validation
- 157 tests passing

### The Wedge
**"Build and execute your ad campaigns in seconds."** Monaco-style full-thesis launch.

Brand enters URL, budget, audience → AI returns scored discovery list → brand picks → platform builds media plan → brand sends outreach → show accepts → IO auto-generated → DocuSign signing → (Wave 13) card charged per delivery → (future) Podscribe verifies, invoice auto-generates.

### Validation Strategy
- **Not** synthetic end-to-end testing — 157 unit tests cover the plumbing
- Real users > fake users. Chris's sales agent friend onboards multiple shows. Brand friends test brand side.
- First 50-100 customers are the relationship-building phase before broader GTM
- Chris serves as human relationship layer for early customers

### GTM Stack
- **Monaco.com** for outbound
- **Okara CMO** for inbound
- **Claude Code** for engineering
- Chris on the front lines with early users

### What Comes Later
- Wave 14/15: Agent/rep accounts (multi-show portfolio management)
- Podscribe integration for automated verification
- Full MCP server / Claude Code skills
- Advanced scoring: tunable weights, "expand my horizons" slider, "find shows like this one" primitive
- Cross-channel expansion (Meta, TikTok, Google ad planning)
- Data licensing as future revenue stream as transaction volume grows

---

## 10. Working Style Preferences

- Prefers focused, step-by-step explanations over comprehensive overviews
- Values authentic industry modeling — schemas must match real-world documents
- Works iteratively — build, test, refine
- Uses Claude Code desktop app for actual building (disable worktree, work on main)
- Uses Claude.ai chat for strategy and planning conversations
- Uses CLAUDE.md + TAYLSLATE_CONTEXT.md for project context
- Comfortable with GitHub workflows, terminal commands, deployment
- Wants Claude to think as a co-founder, not just an assistant
- Motivated by big launches (Monaco-style), not incremental SaaS releases
- Direct about risks — honest about what isn't working beats hedging
