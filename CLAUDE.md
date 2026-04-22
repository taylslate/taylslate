# CLAUDE.md — Taylslate Project Context

*Last updated: April 22, 2026*

**For deep strategic context, competitive research, and domain knowledge, see `TAYLSLATE_CONTEXT.md` in this project folder.**
**For Podscan API reference, see `docs/podscan-api.md`.**

---

## What is Taylslate

Taylslate is the **transaction data layer and payment rail for podcast (and YouTube) sponsorship advertising** — Layer 3 infrastructure that brands, shows, and eventually AI agents operate on. It replaces the manual, weeks-long process of campaign planning, deal negotiation, insertion order management, delivery tracking, invoicing, and payment with one AI-powered platform.

**The tagline:** "Facebook ads for podcast reads."

**The thesis:** Creator sponsorship is a $6B+ market growing 20%+ annually, but the buying process is stuck in 2015. Digital media has programmatic infrastructure. Creator sponsorship has email threads, Word docs, and 90-day payment terms. Taylslate closes that gap. The data moat compounds with transaction volume — every deal that runs through the platform makes the AI smarter.

## Core Positioning — Layer 3 Infrastructure

Taylslate is NOT a marketplace (Layer 2 orchestrator) and NOT an AI agent (Layer 1). It is the transaction data layer and payment rail that sits underneath both. The data moat compounds with transaction volume, not with being the smartest agent or having the most shows signed up.

**Key distinction from competitors:** CreatorExchange and SpotsNow are marketplaces that require shows to sign up before brands can transact. Taylslate's discovery layer touches the entire Podscan universe of 4.4M shows. A brand can discover, plan, and generate IOs without a single show having "signed up." The show's first interaction is receiving a professional IO — money arriving, not a recruitment pitch.

## Target User

**Primary:** Brands new to podcast advertising. They have budget, they know podcast ads work, but they don't know how to buy them. They need market education alongside the transaction infrastructure. NOT brands already spending heavily (they have agency relationships) and NOT agencies (late adopters with workflow inertia).

**Secondary:** Sales agents and talent managers representing multiple shows.

**Show-side:** Shows and creators onboard organically when deals arrive. The onboarding flow educates them on realistic CPM expectations and market pricing.

## Product Flow

**Brand side (complete):**
1. Signup → conversational onboarding (10 steps, captures durable brand profile)
2. New campaign → "Anything different?" override screen → single text-area brief pre-filled from profile
3. AI returns scored discovery list of 50-100 shows → brand browses, filters, selects via checkbox
4. Platform builds media plan from selections (placement, episodes, pricing, totals)
5. Generate IOs → deals created → IO PDFs generated
6. Payment: brand card charged on verified delivery (Stripe Connect)

**Show side (complete):**
1. Signup → conversational onboarding (11 steps, with CPM education at step 6)
2. RSS/Apple Podcasts link auto-populates show data from Podscan
3. Profile ready for brand discovery

**Campaign creation for returning brands (complete):**
- Pre-filled from brand profile
- "Use as-is" shortcut or stackable overrides (audience, categories, goals)
- Overrides apply per-campaign only, don't change the saved profile

## Recommendation Engine

**Data sources:**
- **Category Leaders** (`POST /category-leaders/search`) — pool building, up to 500 shows/category
- **Podcast Search** (`GET /podcasts/search`) — filtered queries with audience size, category, sponsors
- **Discover** (`GET /podcasts/{id}/discover`) — vector similarity across content, demographics, commercial dimensions

**Scoring weights (default):**
- Audience fit: 40% — demographics match from `/podcasts/{id}/demographics`
- Ad engagement: 30% — mid-roll engagement rate from `/episodes/{id}/engagement` (listener engagement add-on enabled)
- Sponsor retention: 20% — repeat advertisers from `/podcasts/{id}/analysis`
- Reach / PRS: 10% — audience size and chart position

**Brand safety:** Displayed as metadata on every show but NEVER used to exclude shows from results.

**English filter:** Active on all candidate-pulling functions.

**Known issue:** Discovery list sometimes returns fewer than 50 shows and over-indexes on topically adjacent but format-mismatched shows. Scoring engine tuning needed.

## Business Model (IN FLUX — April 2026)

**What's decided:**
- 8% all-in platform fee on transactions (Taylslate absorbs Stripe fees)
- 10% fee for agency/white-label tier
- Fee transparency as competitive differentiator vs agencies at 15-20%+ with hidden markups
- Never release show payouts until inbound brand payment settles
- Show payouts manual initially, automated later
- Early payout option (within 7 days for 2.5% fee) planned but not built

**What's in flux:**
- Whether to add SaaS subscription tiers alongside the transaction fee (hybrid model)
- Discovery runs as metered cost — each costs ~$0.09-0.40 in API calls. One discovery per campaign may be included; additional runs may be metered or subscription-gated
- Possible tiered structure: Free (1 campaign) / Starter $49/mo (5 campaigns) / Pro $149/mo (20 campaigns) / Agency $349/mo + 10% fee (unlimited)
- Future revenue: data licensing as transaction volume grows

**API cost analysis (confirmed):**
- Claude API per closed deal: ~$0.59 (Haiku scoring, Sonnet generation)
- Claude API never crosses 1% of revenue at any scale
- Stripe (2.9% + $0.30) is 5-6x more expensive than Claude API
- Fixed costs (Podscan $300/mo, Supabase, Vercel, Resend) matter more than variable API costs early on

## Tech Stack

- **Framework:** Next.js (App Router) with TypeScript
- **Styling:** Tailwind CSS 4 with custom CSS variables
- **Database:** Supabase (Postgres + Auth + RLS)
- **Deployment:** Vercel (auto-deploy from main)
- **AI:** Claude API — Haiku 4.5 for scoring, Sonnet 4.6 for brief parsing and generation
- **Payments:** Stripe Connect (Express accounts, card-on-file via SetupIntent)
- **Show data:** Podscan API (Professional $200/mo + Listener Engagement add-on $100/mo)
- **Email:** Resend for transactional email
- **Podscan API docs:** `docs/podscan-api.md` (committed to repo)

## Build Status (April 22, 2026)

**All core waves complete:**
- Wave 4: Podscan integration layer (`lib/podscan/`, 11 files)
- Wave 5: Scoring engine (`lib/scoring/`, 4-dimension weighted scoring)
- Wave 6: Discovery list UI (scored list, filters, sort, checkbox selection)
- Wave 6.5: English filter + single text-area brief + Claude parsing + graceful error fallback
- Wave 7: Media plan builder (line items, placement adjustments, pricing, IO generation)
- Wave 8: Brand conversational onboarding (10 steps) + brand profile entity
- Wave 8.5: Onboarding fixes (welcome+URL combined, multi-select goals, generic placeholders)
- Wave 9: Show conversational onboarding (11 steps) with CPM education layer
- Wave 10: Brand-profile-aware campaign creation with overrides
- Bug fixes: HTML stripping, decimal CPM, scroll clipping, edit-returns-to-summary, sign out

**Remaining:**
- Stripe charging on verified delivery (brand-side only; show payouts manual for now)
- UI/copy polish pass (Claude Design available)
- Scoring engine tuning (show pool variety)
- Security audit (RLS, API keys, webhooks, rate limiting)
- Podscribe integration for verification
- MCP server for agent access

**Tests:** 83 passing (Vitest).

## Conventions

- Use `var(--brand-*)` CSS variables for all colors
- Pages import from Supabase via `lib/data/queries.ts`
- Components in `components/` organized by feature
- File naming: lowercase with hyphens for files, PascalCase for components
- All monetary values in USD, stored as numbers
- Dates stored as ISO strings
- Build clean API endpoints from day one
- Schemas and forms must match real-world industry documents
- **Git workflow (REQUIRED):** After completing any wave, feature, or substantial change, ALWAYS run `git add . && git commit -m "<descriptive message>" && git push` without being asked. No exceptions.
- **Testing (REQUIRED):** Write at least one test per feature. Use Vitest. Tests in `__tests__/`.
- **Interactive verification (REQUIRED):** Log in with test account and verify UI end-to-end. Compile clean does not mean feature works.
- **CLAUDE.md requires explicit enforcement language** or Claude Code won't follow conventions reliably.
- **docs/podscan-api.md as persistent reference:** Large API docs committed to repo to survive across sessions.

## Test Accounts

Two test accounts in Supabase for Claude Code verification:
- **Brand account:** Credentials provided at session start. Completed brand onboarding.
- **Show account:** Credentials provided at session start. Completed show onboarding.
Never use the founder's personal account for testing.

## Competitive Context

- **LiveRead.io** — IO/invoice management, no AI, no discovery. Operations only.
- **Gumball.fm** — Host-read ad marketplace. 150+ shows, $10M Series A. Own network only.
- **CreatorExchange (thecreatorx.io)** — Ossa Collective rebrand. Marketplace, 1,800 shows. Takes 25%.
- **SpotsNow (spotsnow.io)** — Last-minute/remnant inventory marketplace. Takes 10%. Agency-friendly.
- **Podscribe** — Verification and attribution. Integrate, don't compete.
- **Traditional agencies** — 15-20% markup, manual, ignore small shows.

**Taylslate wins on:** Self-serve AI planning (not marketplace), transparent 8% fee, entire Podscan universe accessible, market education built in.

## Founder Working Style

- Focused, step-by-step over comprehensive overviews
- Iterative — build, test, refine
- Authentic industry modeling — schemas match real-world documents
- Claude Code desktop app for building (Opus 4.7 + deeper thinking for complex waves)
- This chat interface for strategy and planning
- Agent teams for larger builds; single sessions for tightly coupled changes
- Think as a co-founder, not just an assistant
- Motivated by bold launches, not incremental releases
