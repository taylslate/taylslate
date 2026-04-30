# Taylslate — Product & Founder Context

*Last updated: April 30, 2026. Wave 13 shipped. Discovery agent thesis added. This document is the primary strategic context reference for Claude when working on Taylslate. For build state, schema, and technical conventions, see `CLAUDE.md`.*

---

## 1. Founder

**Chris Taylor** — Founder of Taylslate. Previously ran a podcast media buying agency. Lost deals because the time between a brand expressing interest and delivering a campaign plan was too long — weeks or months of research, outreach, and vetting caused brands to shift budgets or lose enthusiasm. Charged 5% agency markup vs. the industry standard 15-20% but never closed a deal because the process was too slow. This firsthand pain is the foundation of the product.

Chris works iteratively, prefers focused step-by-step explanations, and builds functional prototypes before committing. Uses Claude Code (desktop app) for development, Claude.ai chat for strategy conversations, GitHub for version control, Vercel for deployment. Comfortable with terminal workflows. Prefers to work directly on main branches. Values authentic industry modeling — schemas and forms must match real-world documents and processes.

Taylslate is currently Chris's sole professional focus.

**Technical stack:** Next.js with TypeScript, Supabase backend, Tailwind 4, Vercel deployment, Claude API (Sonnet/Opus) for all AI, DocuSign for e-signatures, Resend for email, Stripe Connect for payments, Podscan for podcast data enrichment, YouTube Data API for YouTube channel enrichment.

---

## 2. The Vision & Positioning

Taylslate is **Layer 3 infrastructure** for podcast and long-form YouTube sponsorship advertising — the transaction data layer and payment rail that brands, shows, and AI agents operate on.

**The one-liner:** "Facebook Ads for podcast reads."

**The mission:** Get brands spending more money in podcasting and YouTube on the shows that convert AND help shows that don't get enough ad dollars find more deals. Two-sided efficient allocation. Discovery quality isn't competitive differentiation — it *is* the mission. Bad discovery means the mission fails on both sides.

**The positioning shift (March → April 2026):** Originally framed as "AI generates a complete campaign plan." Refined to: AI returns a scored discovery list of 50-100 shows, brand selects via checkbox, platform builds the media plan using domain logic. Market education happens through the discovery list experience itself — not through separate documentation or onboarding specialists.

**The thesis:** Sponsorship advertising works, the market is growing ($4B+ podcast, $2B+ YouTube, 20%+ annually), but the buying process is stuck in 2015. Digital media has programmatic infrastructure. Creator sponsorship has email threads, Word docs, and 90-day payment terms. Taylslate closes that gap.

**Target user:** Brands **new to podcast and YouTube creator advertising**. Not brands already spending heavily — they have agencies. Not agencies themselves — they're late adopters with workflow inertia. Market education is core GTM function, and shows with unrealistic CPM expectations are a documented barrier that the product addresses through discovery flow + show onboarding education.

**What Taylslate does for each user type:**

- **Brands new to creator advertising ($30K-$50K monthly campaign budgets):** Founder-led and operated, often with an agency handling social spend but new to creator/podcast specifically. Enter URL, budget, demographics. Get a scored discovery list in seconds. Select shows. Platform builds the media plan. Send outreach. Sign IOs via DocuSign. Card on file charges per verified delivery. See what converts. Pay-as-you-go pricing matches their "test before pay" psychology. Convert to Operator once channel is proven.
- **Shows & creators (onboarded via outreach acceptance):** Receive pitch from brand with proposed terms. Accept, counter, or decline. Get IO auto-generated. Sign via DocuSign. Get paid via Stripe as episodes deliver. Auto-invoicing. Fair pricing. Includes podcast hosts, long-form YouTube creators, and creators who simulcast both (same show, two surfaces).
- **Shows under 10K downloads:** Systematically ignored by agencies. Taylslate removes the cost barrier of transacting with smaller shows. This matters for long-tail inventory.
- **Sales agents / rep companies (Wave 14/15):** Represent portfolios of shows. High-leverage GTM — one agent onboards, 10-30 shows arrive. Data model exists (`agent_show_relationships`), UX not built yet.

**Mediums supported at launch:** Podcast (audio, RSS-driven) and long-form YouTube (channel-based). YouTube Shorts deliberately excluded — different read mechanics, unproven conversion playbook. Podcast + YouTube simulcasts of the same show are modeled as one channel with two surfaces.

---

## 3. The Moat

The moat is the data. Everything else is a mechanism to capture it.

**Three things force data through Taylslate:**

1. **Automated verification** — Taylslate watches the public internet (RSS feeds, episode audio, YouTube videos) and confirms ads ran, what was said, whether downloads/views hit the guarantee. Passive data capture. Podscribe does transcript-based verification and download checking already, so Taylslate will integrate rather than rebuild (planned post-Wave-13). Taylslate's contribution: connecting Podscribe's "what happened" to Taylslate's "what was agreed to" and "what was paid."

2. **Payment facilitation** — When money moves through Taylslate (Wave 13 shipped), we capture the one piece of data nobody shares voluntarily: what was actually paid, when, by whom. This is the transaction intelligence that powers everything.

3. **Discovery reasoning library** — Every campaign run through Taylslate produces a structured record of what was tried and what worked: brand profile, ring hypotheses, conviction scores, analog matches, outcomes. After hundreds of campaigns, Taylslate has a proprietary pattern library of "what kind of product converts on what kind of show with what kind of host" that no competitor can replicate without running the same volume of campaigns. See Section 5 for the architecture.

**What the data becomes over time:** Aggregated, anonymized intelligence — CPM benchmarks by category and show size, advertiser retention signals, delivery reliability scores, payment timing patterns, conviction calibration (predicted vs. actual conversion). After thousands of transactions, Taylslate knows more about the real economics of creator sponsorship than any agency, brand, or network. Every subsequent recommendation gets smarter.

**Data usage model:** All proprietary data used in aggregate only. No individual deal terms exposed. No show-specific CPMs shared. Brands see category-level benchmarks. Shows see how they compare to their tier. Nobody sees anyone else's specific deal. ToS must clearly state users grant Taylslate a license to use aggregated, anonymized data.

**The Monaco analogy:** Monaco.com is the system of record for startup revenue — replaced 5-8 fragmented sales tools with one AI-native platform where every interaction is captured and intelligence compounds over time. Taylslate is the system of record for creator sponsorship transactions.

---

## 4. Pricing & Fees (Locked April 28, 2026)

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

Don't decide API pricing now. Wave 13 shipped fine-grained event logging with customer ID, timestamp, and operation type. That data enables intelligent pricing in 12 months.

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

### Investor Pitch Shape

> "Brand-side transaction fee gets customers in the door at zero adoption friction. Most active customers convert to a $499/month + 6% Operator plan within 6 months once they prove the channel. By year 3, recurring revenue is ~70% of total. By year 6 we project $90M revenue, 77% recurring, with agencies and API revenue as upside levers. The model is structurally optimized for retention — customers stay because the platform gets cheaper as they scale, not more expensive."

This pitch is more credible than including aggressive agency assumptions. Investors discount aggressive assumptions; honest assumptions with clear upside levers are more persuasive.

---

## 5. Discovery as Conviction-Based Interpretive Reasoning

This section captures the discovery agent thesis and is the foundation for the next major build cycle (Wave 14: Discovery Agent Foundation).

### What discovery actually is

Discovery is the act of locating, for a given product, the universe of shows where it will convert profitably — and producing a sampling plan against that universe given budget. Not a database query. Not a category filter with extra steps. An interpretive reasoning task.

Every product has three concentric rings:

- **Conviction ring:** shows where the product almost certainly converts. Strong host fit, audience fit, and proven analog patterns.
- **Probable ring:** shows where the product likely converts at the right CPM. Some signal weakness, but defensible hypothesis.
- **Exploration ring:** shows where there's a hypothesis worth testing but no proof.

The shape of these rings is determined by the *product*, not the budget. Budget controls how much of the rings you can afford to sample. A great agent locates the rings first, then applies budget as a sampling lens. A weak system filters by category and audience and calls it done.

### The seven layers of agent reasoning

Veteran media buyers (VeritoneOne planners, AdResults, indie reps with 20+ years experience) implicitly run seven reasoning layers when they read a brief:

1. **Brief decomposition** — what the brand *said* vs what they *mean*. "Wellness" → biohacking-adjacent vs mainstream wellness vs recovery-for-performance are three different show universes.
2. **Conversion pattern recall** — which shows converted for *similar* products in the past. Veteran agents have 50-100 shows they know convert for any given category, accumulated through years of running campaigns.
3. **Host-fit reasoning** — would this host actually use this product and talk about it convincingly? Read quality matters more than audience size.
4. **Sponsor competition / saturation check** — has this show run a competing sponsor recently? Listener fatigue craters conversion.
5. **Inventory reality check** — which shows are actually available, what's the real CPM (vs rate card), do they take direct deals.
6. **Portfolio construction** — anchor / core / discovery mix shaped by budget. Frequency vs breadth.
7. **The "weird bet"** — 1-2 shows that look wrong on paper but the agent knows convert. Pure pattern recognition.

Taylslate's current scoring (audience 40 / engagement 30 / retention 20 / reach 10) handles part of layer 3. It does not yet do 1, 2, 4, 6, or 7. That's the roadmap.

Layers 1, 2, 4, and 6 are achievable with LLM reasoning + a structured pattern library before Taylslate has transaction volume. Layer 3 plateaus without ASR. Layer 5 is a partnerships/data problem. Layer 7 plateaus without volume — but is mostly upside, not blocking.

### The agent loop

The right human in the discovery loop is **the brand**, but not asked to refine *show lists* — asked to confirm/refine the AI's *interpretation of their brief*. A brand new to podcast advertising can't compare hosts and audiences, but they know their customer cold.

Concretely:

> AI: "I'm reading this primarily as biohacking-adjacent wellness with high conviction — your product strongly patterns to Plunge, Therabody, and Hyperice, all of which converted well in this audience. The 2/10 uncertainty is around mobile use cases, which could expand into outdoor/parenting audiences — want to explore those?"

> Brand: "Yeah, biohacking-adjacent is right, but we also do well with athletes — recovery for performance, not just optimization."

> AI: "Got it, expanding to include performance-recovery audiences. That brings sports/training shows into scope."

The AI proposes 1 primary read + 2-4 lateral candidate rings with stated confidence. The brand confirms or refines. The rings collapse to confirmed shape. This is the moment that feels like "working with a great agent" — the AI saying something true about the brand's customer that the brand hadn't articulated.

### Conviction score, not fit score

"Fit score" is what databases produce: static matching, hidden reasoning, a number to argue with. Every competitor produces fit scores.

"Conviction score" is what an agent produces: a judgment with reasoning behind it, exposing the model's epistemic state. With conviction, brands argue with the *reasoning* ("you're underweighting host fit because their last three sponsors converted") not the number — a more productive conversation, more agent-feeling.

Three levels of conviction surface in the UI:
- **Brief interpretation conviction** — how confident the AI is that it's reading the brand correctly
- **Ring conviction** — high/medium/low/speculative per ring, with reasoning
- **Show conviction** — per-show, with reasoning ("Conviction: high. Host personally uses cold plunge. Audience over-indexes 2.4x on biohacker purchases. Shows like this converted in 4 of 5 recovery campaigns.")

Reasoning surfaces are mandatory, not optional. The number alone is what databases provide. The reasoning is what makes Taylslate distinguishable.

### Confidence gates portfolio shape

The system must be intellectually honest about what it doesn't know. Conviction confidence gates portfolio shape:

- **High conviction** (strong analogs, clear ring) → tighter portfolio, more concentration on conviction ring
- **Medium conviction** → balanced portfolio across rings
- **Low conviction** (novel product, no clear analogs) → wider portfolio, more exploration ring, smaller bets, and the system *says so* — recommends test-and-learn over confident commitment

This is what no current tool does and is a core trust signal.

### The pattern library (the moat)

The discovery agent reasons over a structured pattern library — the data asset that compounds with every campaign:

- **Campaign records:** product attributes, customer description, ring hypotheses, conviction scores, sampling decisions, outcomes
- **Analog matches:** which historical campaigns the AI matched a new brief against and why
- **Ring patterns:** "product type → ring shape → analog campaigns → confidence priors"
- **Outcome links:** verified delivery, conversion signals where available, brand satisfaction, repeat business

The library starts seeded by Chris's media-buying intuition (~100-200 brand/show pairs labeled from memory). It grows automatically with every campaign run on the platform. By the time Taylslate has 500 campaigns, the library is a real data asset.

The model isn't a custom foundation model. It's a *domain reasoning system* — Claude or GPT consuming the proprietary pattern library to produce decisions. The library is the moat. The reasoning layer commodifies. This is what's investible: not "we trained a model" but "we accumulated a structured pattern library that no one else can replicate without running the same campaigns."

### Build later, frameworked now

Three pieces need data to be useful but should be **frameworked now** so they're plug-in-ready:

- **Embedding-based retrieval over the pattern library** — works fine on hand-seeded patterns; better with volume. Build the embedding pipeline with the schema.
- **Confidence calibration from empirical conversion vs predicted conviction** — needs outcome data. Schema must capture both prediction and outcome from day one.
- **Outcome-similarity-based "shows like X"** — needs outcome data per show. Build the schema field; populate as transactions arrive.

Reasoning persistence is the discipline that makes all three possible: every AI decision (interpretation, ring hypothesis, conviction score, analog match) writes structured reasoning to `event_log` with the same schema you'd want for training data later. Storage is cheap. Lost training data is expensive.

### Lateral reasoning: why interpretive beats keyword

A keyword/category system sees "sauna, recovery, wellness" and pulls wellness-tagged shows. That's it.

An interpretive LLM sees "sauna, mobile, $X price, home use" and reasons laterally:
- Mobile + family-friendly → busy parents who want recovery without leaving the house. Parenting podcasts with health-conscious hosts.
- Outdoors + portable → camping, van life, overlanding audiences.
- Stress relief framing → mental health, meditation audiences.
- Status purchase → entrepreneurship, hustle culture.
- Recovery for performance → CrossFit, endurance, climbing communities.

Five different rings, each defensible, each leading to a different show universe. Foundation models do this naturally with the right prompting. This is where Taylslate embarrasses keyword-based competitors — and where the brand goes "oh, mobile is actually our biggest selling point, we hadn't thought about overlanders," and Taylslate just unlocked a customer segment the brand didn't consciously know about. That's the moment of agent-level value.

### Discovery philosophy

- **Return more results, not fewer.** Aligns with Facebook Ads model — broad options, brand narrows down. Aligns with veteran agent behavior — long list, not curated three.
- **Loosen score thresholds, paginate and filter rather than trim.**
- **Surface "why" each result was returned.** Reasoning, not just numbers.
- **Don't gate discovery on whether a creator has self-onboarded.** Self-onboarded inventory gets a conviction boost ("immediately bookable") and unlocks streamlined deal flow. Non-onboarded shows still appear with a lighter outreach path.
- **"Find shows like this one"** is a primary interaction, not a sidebar feature.
- **Brand safety** is metadata, never an automatic exclusion. Brands decide.

### What this is not

- Not a marketplace. Marketplaces have two-sided liquidity problems and lower margins. Taylslate is an *inventory-aware transaction layer* — recommendations are the primary object, inventory availability is a confidence signal.
- Not a black box. Reasoning surfaces everywhere conviction surfaces.
- Not autonomous. The brand always confirms ring hypotheses before discovery commits. The AI proposes, the human chooses.

### Multi-medium creator inventory

Long-form YouTube and podcast are both first-class mediums at launch. YouTube Shorts deliberately excluded — different read mechanics, no proven conversion playbook.

Channel modeling:
- **Podcast-only show:** one channel, podcast surface
- **YouTube-only channel:** one channel, YouTube surface
- **Simulcast (same show on both):** one channel with two surfaces — same audience overlap, same pricing, same conviction ring

The discovery agent operates on this abstraction. Conviction reasoning carries across mediums. Format-appropriate matching (read length, integrated read placement, attention dynamics) varies by surface but the ring logic is the same.

---

## 6. Build State

See `CLAUDE.md` for full wave-by-wave detail. High level:

- **Waves 1-3 (Feb-Mar 2026):** Supabase foundation, deal transaction loop, show roster + agent onboarding.
- **Waves 4-7 (Mar 2026):** Show discovery via Podscan + YouTube Data API, scoring engine, discovery list UI, media plan builder.
- **Waves 8-10 (Mar-Apr 2026):** Conversational onboarding (brand + show), brand-profile-aware campaigns.
- **Wave 11 (April 23, 2026):** Outreach-to-onboarded-show loop. Public pitch page, magic link account creation, accept/counter/decline.
- **Wave 12 (April 23, 2026):** IO PDF + DocuSign integration + signed PDF storage + day-3/day-14 timeout cron.
- **Wave 13 (April 28, 2026, shipped):** Stripe Connect pay-as-delivers + pricing tier architecture. Card-on-file via SetupIntent at IO signature, charge per verified episode delivery, show payout follows each charge, Stripe Subscription for Operator/Agency tiers, dynamic per-customer transaction fee, fine-grained event logging, GMV trigger alerting at $12.5K/mo Operator breakeven.

**Current state:** Full transaction loop working on production. Pricing tier architecture in place. Real user validation pending — domain cutover applied, need to onboard sales agent friend (show side) and brand friends (brand side).

**Next: Wave 14 — Discovery Agent Foundation.** Pattern library schema, conviction scoring, brief interpretation loop, reasoning persistence. See PRODUCT_BACKLOG.md.

---

## 7. Competitive Landscape

### LiveRead.io
- **What they are:** Order management platform for podcast advertising. Manages IOs, invoicing, delivery tracking, ad copy distribution.
- **Strengths:** Real integrations (Megaphone, Bill.com, QuickBooks, BoldSign for e-signatures, HubSpot, Art19, YouTube). Real users including Always Sunny Podcast, Whitney Cummings, Bad Friends, Flagrant Media Group. 2.5+ years of iteration.
- **Ownership change:** Nov 2024, Ilyas Frenkel (founder of Single Source Media, a podcast/YouTube ad agency) acquired controlling stake. Original founder Alex Aldea departed. CTO Mike Perrigue became CEO. Joined Sounds Profitable as partner organization.
- **Key weakness:** No AI intelligence layer. No campaign planning. No show discovery. Operations tool only. Zero marketing to date, fully word-of-mouth. Enterprise-oriented UX.
- **What Taylslate does that LiveRead doesn't:** AI campaign planning, show discovery, budget optimization, recommendation engine, speed, serves brands who've never bought podcast ads before, conviction-based discovery reasoning.

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
- **Taylslate differentiation:** Analytics only, no transaction facilitation, no discovery reasoning.

### Podscan (Primary Data Provider, not competitor)
- **What they are:** 4.4M podcasts, 51M episodes, real-time API, MCP server. Founder (Arvid Kahl) encourages building on their API.
- **Taylslate use:** Category Leaders, Podcast Search, Discover endpoints. Pool building (500 shows/category), filtered search, vector similarity. Professional plan.
- **Key future primitive:** "Find shows like this one" using Discover endpoint (vector similarity) — first-class UI element, preference signal capture for learning. Competitive differentiator vs. VeritoneOne's Rolodex model.

### Rephonic (Alternative Data Provider)
- **What they are:** 3M+ podcasts with demographics, reach estimates, sponsor history, contacts.
- **Why backup vs primary:** Most permissive commercial ToS. Worth keeping as alternative.

### Traditional Agencies (VeritoneOne, Ad Results Media)
- **What they do:** Full-service buying. 15-20% markup. Manual IO generation (internal Word templates). Ignore shows under 10K downloads.
- **Strength Taylslate is chasing:** Their planners have 20+ years of pattern recognition — the conviction ring for thousands of products is in their heads. Taylslate substitutes a structured pattern library + LLM reasoning that compounds with platform volume.
- **Payment terms:** Net 30 EOM officially, routinely Net 60-75+. Ad Results Media has Net 75 terms.
- **Taylslate positioning:** 10x faster, transparent fee, serves all show sizes, conviction-based discovery reasoning.

---

## 8. Domain Knowledge — Podcast & YouTube Advertising

### Ad Types
- **Host-read baked-in:** Host reads live ad, permanently part of episode. Historically evergreen. Sometimes pulled after download threshold. Premium format.
- **Dynamic insertion (DI):** Pre-recorded ads stitched at playback via hosting platform (Megaphone, Libsyn). Can be host-read or not. Restricted to download/impression thresholds.
- **YouTube integrated read:** Host-read segment in long-form video, mid-roll typical, with optional on-screen overlay. Evergreen.
- **Same IO structure used for all types.** Either brand or show can send the IO.

### Pricing
- **CPM (cost per mille):** Ad Spot Price = (downloads ÷ 1,000) × CPM rate. Range: $15-$50.
- **Flat rate:** Fixed price with make-good if downloads underdeliver >10%.
- **YouTube:** Typically flat-fee, not CPM. Higher rates because content is evergreen. $2K-$20K based on cultural significance.
- **Price type on IO:** Either CPM-based (pay per actual download) or flat rate.

### Budget shapes (rough working model)

| Budget | Typical CPM | Practical portfolio shape |
|---|---|---|
| $5K | $20-25 | Test-only, 1 mid-size show OR 3-4 small shows × 2 reads each. Learning purchase, not a campaign. |
| $20K | $25 | Real campaign minimum, 8-12 shows, mix of test + scale |
| $50K | $25 | Full portfolio, 15-25 shows, anchor/middle/long-tail |
| $100K | $28 | Multi-month, 25-40 shows, includes premium anchors |
| $250K | $30 | Quarterly campaign, 40-60 shows, 2-3 premium anchors |
| $500K+ | $32 | Network buys + flagship hosts |

CPM creeps up with budget tier because premium shows price higher. Premium anchors have minimums (Rogan ~$200K, Huberman $80K+, SmartLess $100K+). Below ~$150K total budget, those shows shouldn't even appear in discovery for credibility reasons.

Frequency vs breadth: a great agent at $50K picks 12 shows × 2-3 reads each, not 25 shows × 1 read. Frequency drives conversion. Brands almost always want more shows; the system should default to agent intuition with override available.

### Deal Flow
1. Brand reaches out to show directly or through buying agency
2. Show plans delivered — disjointed via direct contact or agency collates options
3. Deal confirms
4. IO is sent with ad copy (IO is the record of purchase)
5. Ad is read by host / inserted via DI / integrated into YouTube video
6. Podscribe verifies ad ran and checks downloads/views
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

## 9. Architecture Philosophy

### Agent-Native Design
The future is not a monolithic web app with dozens of integrations. AI agents (Cowork, Claude Code, OpenClaw, Perplexity computer use) will increasingly be the interface through which normal people interact with their tools. Taylslate should be designed for this world.

**What Taylslate needs to be:**
1. **The database and API** — structured data layer that persists across agent sessions
2. **The domain logic engine** — IO formatting rules, CPM calculations, make-good thresholds, invoice generation
3. **The aggregated intelligence layer** — pattern library, conviction reasoning, outcome data — grows with every transaction, proprietary to Taylslate
4. **Packaged skills / MCP server** — so agents can interact with Taylslate's data and logic
5. **A lightweight web UI** — for onboarding, review, and approval

**Build order:** Web app captures data → clean API from day one → skills and MCP server for power users → as agents mature, the web app becomes one of several interfaces.

**Key principle:** Build for today's user, architect for tomorrow's. Specifically: every step of the internal discovery agent's reasoning loop should be designed as a discrete, addressable, idempotent operation with structured I/O — so when external agents (brand-side Salesforce/Cowork agents, partner integrations) consume Taylslate via MCP, the same primitives drive both surfaces. Costs ~10-15% extra build time now, saves 10x rebuild later.

### Integration Philosophy
Don't build bespoke integrations to every platform (the LiveRead approach). Build a clean API that agents can use to bridge between Taylslate and whatever tools the user has. More flexible, less maintenance, positioned for where the market is going.

**Exceptions worth building directly:**
- **Podscribe** — verification data connected to IO terms is core value prop
- **DocuSign** — e-signature compliance is a regulatory product
- **Stripe Connect** — payment compliance is a regulatory product

### Domain Events (Wave 12 foundation)
Append-only audit log at `domain_events` table. Every state transition fires an event (entity.action form: `outreach.created`, `outreach.accepted`, `deal.created`, `envelope.signed`, etc.). Fat payloads with `schema_version` field. Service-role write only. Future MCP server / webhook subscriptions will consume this.

### Reasoning Persistence (Wave 14 discipline)
Every AI decision (brief interpretation, ring hypothesis, conviction score, analog match, sampling decision) writes a structured record to `event_log` with the same schema you'd want for training data later. This is what makes the pattern library compound: campaigns aren't just transactions, they're labeled examples of "what the AI thought, what the human confirmed, what actually happened." Reasoning persistence is non-negotiable for any AI surface — including ones that don't seem important now.

---

## 10. Launch Plan

### Current State (April 2026)
- Full flow built through paid IO + delivery + payouts (Waves 1-13 shipped)
- Pricing tier architecture in place; PAYG → Operator conversion mechanic working
- 157+ tests passing
- Pending: real user validation (sales agent friend, brand friends)

### The Wedge
**"Build and execute your ad campaigns in seconds."** Monaco-style full-thesis launch.

Brand enters URL, budget, audience → AI returns scored discovery list → brand picks → platform builds media plan → brand sends outreach → show accepts → IO auto-generated → DocuSign signing → card charged per delivery → (future) Podscribe verifies, invoice auto-generates.

### Validation Strategy
- **Not** synthetic end-to-end testing — unit tests cover the plumbing
- Real users > fake users. Chris's sales agent friend onboards multiple shows. Brand friends test brand side.
- First 50-100 customers are the relationship-building phase before broader GTM
- Chris serves as human relationship layer for early customers

### GTM Stack
- **Monaco.com** for outbound
- **Okara CMO** for inbound
- **Claude Code** for engineering
- Chris on the front lines with early users

### Pre-launch backlog (must finish before GTM)
See `PRODUCT_BACKLOG.md`. Categorized as Operational Unblock, Polish, and Foundational Architecture.

### What Comes Later (post-launch, customer-driven)
- Wave 14: Discovery Agent Foundation (next major wave)
- Wave 15+: Agent/rep accounts, multi-show portfolio management
- Podscribe integration for automated verification
- Full MCP server / Claude Code skills
- Cross-channel expansion (Meta, TikTok, Google ad planning)
- Data licensing as future revenue stream as transaction volume grows

---

## 11. Working Style Preferences

- Prefers focused, step-by-step explanations over comprehensive overviews
- Values authentic industry modeling — schemas must match real-world documents
- Works iteratively — build, test, refine
- Uses Claude Code desktop app for actual building (work on main, no worktrees)
- Uses Claude.ai chat for strategy and planning conversations
- Uses CLAUDE.md + TAYLSLATE_CONTEXT.md for project context
- Comfortable with GitHub workflows, terminal commands, deployment
- Wants Claude to think as a co-founder, not just an assistant
- Motivated by big launches (Monaco-style), not incremental SaaS releases
- Direct about risks — honest about what isn't working beats hedging
