# Taylslate Product Backlog

*Last updated: April 30, 2026*

This document captures everything that's been identified as worth building. Two parts:

1. **Pre-launch backlog** — things that must finish before GTM. Operational unblock, polish, and foundational architecture. These are the "must do before we can credibly take real money" items.

2. **Post-launch queue** — things that respond to real customer signal once the product is live. Customer-driven and future/aspirational.

Wave model continues as the execution unit. Items get pulled from the backlog into numbered waves. Within the backlog, customer signal sets priority — but pre-launch items have a hard deadline (GTM) and can't wait for signal.

---

# SHIPPED

Items that were on the backlog and are now live in production.

## Wave 14 Phase 1 — Discovery Agent Foundation (shipped April 30, 2026)

- **Pattern library schema** (migration 019) — `campaign_patterns`, `ring_hypotheses`, `conviction_scores`, `analog_matches`, `founder_annotations` tables, plus `show_profiles.brand_history` and `shows.audience_purchase_power` columns. Idempotent.
- **Reasoning persistence wrapper** (`lib/data/reasoning-log.ts`) — 5 record helpers + 1 reader. Fail-soft contract: never throws, never blocks main flow. Mirrors `event-log.ts` pattern.
- **Scoring weight tunability** — `lib/scoring/weights.ts` exports `getEffectiveWeights()` with per-request overrides. New optional `topicalRelevance` and `purchasePower` dimensions. AOV-aware tilt: when `aovBucket='high'`, purchase-power weight raises and reach drops. Backwards-compatible: when new dims are 0, returns existing 4-dim shape unchanged.
- **TypeScript types** — `CampaignPatternRow`, `RingHypothesisRow`, `ConvictionScoreRow`, `AnalogMatchRow`, `FounderAnnotationRow`, `ShowBrandHistoryEntry`, plus `AovBucket`, `RingHypothesisKind`, `ConvictionBand`, `ConvictionTier` enums.

All Phase 1 helpers ship dormant. Phase 2 wires them into the discovery UI at each AI decision point.

---

## Categorization

- **Operational unblock** — small fixes blocking GTM credibility or daily founder workflow. Pre-launch.
- **Polish** — visible bugs and UX rough edges customers will hit. Pre-launch.
- **Foundational architecture** — small refactors that unlock multiple future features. Pre-launch where high-leverage.
- **Wave 14 foundation** — discovery agent groundwork. Pre-launch (data flywheel needs to start spinning before customers arrive).
- **Customer-driven** — features that should only be built once a real customer asks. Post-launch.
- **Future / aspirational** — directional items, build only when transaction volume justifies. Post-launch.

---

# PRE-LAUNCH BACKLOG

Things that must finish before GTM. The launch bar.

## Operational Unblock

### Domain & email cutover
- ~~Verify `taylslate.com` in Resend~~ — done April 29
- ~~Add `taylslate.com` as custom domain in Vercel, point DNS~~ — done April 29
- ~~Swap `from:` addresses to taylslate.com domains~~ — done April 29
- Update DocuSign Connect webhook URL → `taylslate.com/api/webhooks/docusign`
- Update Stripe webhook endpoint URL → `taylslate.com/api/webhooks/stripe`
- Update Supabase project Site URL + auth Redirect URLs from `taylslate.vercel.app` to `taylslate.com`
- Set Vercel env var `NEXT_PUBLIC_SITE_URL=https://taylslate.com`
- **Effort:** 1-2 hours
- **Why:** External service URL cutovers still pending. Required for production correctness.

### Outreach email "from name" bug
- `buildFromAndReply()` in `lib/email/templates/outreach.ts` is receiving `brandName=full brief paragraph` instead of brand name
- Add dedicated `brand_name` field on brand profile, update outreach pipeline to use it
- **Effort:** 2-3 hours
- **Why:** Brand outreach emails currently show paragraph-length "from" lines. Looks broken. GTM-blocking.

### Internal admin tooling — "log in as test user"
- Admin panel with "log me in as test show 1" / "test brand 1" buttons
- Replaces current Gmail +tag aliases + incognito windows workflow
- **Effort:** 1 day
- **Why:** Multi-account testing friction compounds as we test more flows. Saves hours/week. Worth doing before bringing brand friends and sales agent friend onto the platform.

### Direct show search
- Brands who come in with a specific target list (knowing the shows they want) have no way to search for them by name
- Currently discovery is AI-generative only — brand enters brief, AI recommends
- Add a search bar to the discovery experience that hits Podscan's search endpoint, returns matching shows, lets brand select and add to media plan
- Coexists with AI discovery, doesn't replace it
- **Effort:** 2-3 days
- **Why:** Real brands sometimes know what they want. Forcing them through AI discovery when they want to search for "Acquired" specifically is unnecessary friction. Both flows feed into the same media plan UI.

### Test mode for full transaction loop
- Currently no clean way to test full brand-side discovery → outreach → deal → IO → payment flow with two accounts you control
- Discovery returns real Podscan shows whose email you don't control — can't simulate show acceptance
- Add either: (a) ability to fabricate a "test show" entity and inject it into discovery results, OR (b) admin tool to manually create deal between two existing user accounts bypassing discovery
- **Effort:** 1-2 days
- **Why:** Real-user testing is preferred but not always available. Internal testing currently requires manual SQL or workarounds.

---

## Polish

### Brand onboarding fixes
- Hybrid AI-prefill from URL (currently full manual entry)
- Remove duplicate age question (currently asked twice)
- Remove artificial 1-5 category cap and 1-3 goals cap
- Add "Back to Summary" CTA when editing from summary view
- **Effort:** 2-3 days

### Campaign brief formatting
- Replace single jumbled paragraph with structured fields: Brand, Product, Audience, Target segments, Categories, Goals, Exclusions
- Render structured brief in outreach templates and pitch pages
- **Effort:** 1-2 days
- **Note:** This is the *display* fix. The Wave 14 brief interpretation agent will reshape *intake* later — but this polish item should ship first to unblock GTM.

### Media plan editable CPM indicator
- CPM is currently editable downstream but not visibly editable on media plan screen
- Add edit indicator + inline edit
- **Effort:** Half day

### Outreach UX polish
- Rename "Reach out" → "Compose outreach"
- Tighten pitch system prompt for direct tone (less Claude fluff)
- Replace "Claude is writing your pitch..." with "Taylslate is drafting..." or agent persona ("Tay")
- **Effort:** Half day

### Pitch page deal value display
- Proposed Terms section should show total deal value calculation: CPM × episodes × audience/1000
- **Effort:** 2-3 hours

### Auth unification
- Currently brands use email/password, shows use magic link + Supabase OTP
- Move all users to unified magic link + 6-digit OTP
- Safer, cleaner UX, no password management
- **Effort:** 2-3 days

---

## Wave 14 Phase 2 — Discovery Agent UX (pre-launch)

- Wires Phase 1 dormant infrastructure into brand-facing UI
- Brief interpretation loop with 1 primary + 2-4 lateral ring hypotheses
- Three-dimensional conviction scoring (audience fit / topical relevance / purchase power) surfaced per show with reasoning text
- Test portfolio + scale tier dual output with 3-spot floor as default budget filter
- Founder annotation UI for capturing show-level reasoning
- Lateral ring confirmation flow (brand confirms/refines AI interpretation, not show list)
- Show onboarding addition: "brand history" field for self-reported top advertisers + annual deals
- **Effort:** 2-3 weeks (foundation work makes this a 1-2 week build)
- **Trigger:** Pre-launch must-do. Current flat fit-score discovery isn't strong enough to launch on — Sauna Box walkthrough confirmed. Phase 2 is the discovery experience that makes Taylslate's wedge actually competitive at launch. Build before broader GTM.

---

## Foundational Architecture

### Scoring weight tunability refactor
- Refactor `lib/scoring/weights.ts` to accept per-request overrides
- Default weights stay (audience 40 / engagement 30 / retention 20 / reach 10)
- Per-request overrides enable A/B testing, ring-aware scoring (Wave 14), "expand my horizons" slider, customer-specific tuning, future ML weights
- **Effort:** 2-3 days
- **Unblocks:** Every future discovery feature, including Wave 14 conviction scoring
- **Pre-launch:** yes — Wave 14 foundation depends on this

### English language filter
- Non-English shows currently surface in results without filtering
- Add language filter to discovery query
- **Effort:** Few hours

### Domain events expansion
- Already have `domain_events` table (Wave 12)
- Audit current coverage — every state transition should fire an event
- Document event schema versioning conventions
- **Effort:** 1 day audit + ongoing as new endpoints ship

---

---

# POST-LAUNCH QUEUE

Things that respond to real customer signal once the product is live.

## Customer-Driven

These are real product capabilities, but building them before customers ask is speculative. Listed here so they don't get forgotten, not as a promise to build them.

### Wave 14 Agent UX — Brief interpretation loop
- Replace current form-based brief intake with interactive interpretation agent
- AI proposes 1 primary read + 2-4 lateral candidate ring hypotheses with confidence
- Brand confirms or refines interpretation (not show list — interpretation of customer)
- Refinement loop visible in chat or sidebar; final ring shape collapses from confirmed reads
- Lateral examples that should fall out for free with this architecture: "you mentioned mobile use → outdoor/parenting audiences worth exploring?"
- **Effort:** 2-3 weeks (foundation work makes this a 1-2 week build)
- **Trigger:** First real campaign where current discovery returns thin/wrong results, OR when foundation pattern library has enough seeds to power useful ring hypothesis generation

### Wave 14 Agent UX — Conviction scoring UI
- Replace fit score with conviction score + reasoning surface
- Show-level: "Conviction: high. Host personally uses cold plunge. Audience over-indexes 2.4x on biohacker purchases. Shows like this converted in 4 of 5 recovery campaigns."
- Portfolio-level: "High conviction portfolio: 12 shows, weighted toward 6 anchors. Confidence is high because we have strong analogs."
- Confidence bands: High / Medium / Low / Speculative
- **Effort:** 1-2 weeks
- **Trigger:** Same as brief interpretation — or sooner if we want to A/B test conviction-score-with-reasoning vs current fit-score numerical display

### Agent / rep account UX
- Multi-show portfolio management for sales agents (Veritone, Ad Results, indie reps)
- Data model exists (`agent_show_relationships`), UX doesn't
- High-leverage GTM (one agent → 10-30 shows)
- **Effort:** 2-3 weeks
- **Trigger:** First sales agent customer asks for it

### Make-good negotiation agent
- Auto-detects when downloads underdeliver >10% against IO guarantee
- Proposes make-good terms, drafts amendment, routes for DocuSign signature
- Updates deal record on completion
- **Effort:** 2 weeks
- **Trigger:** First make-good situation in a real campaign

### Invoice reconciliation agent
- Watches Stripe events, matches inbound payments to invoices
- Flags disputes, handles overdue chasing
- **Effort:** 2-3 weeks
- **Trigger:** When invoice volume makes manual reconciliation painful

### Show onboarding via email/SMS
- Alternative entry path for shows who prefer not to use the web onboarding
- Conversational agent guides them through rate card, demographics, ad copy email, billing email via SMS or email thread
- **Effort:** 2-3 weeks
- **Trigger:** When show-side conversion via web flow plateaus

### Content-aware discovery (ASR-derived)
- Layer ASR-derived content intelligence on top of metadata-based discovery
- Find shows where hosts have organically mentioned a brand category recently
- Detect tonality from transcripts to match brand voice
- Track sponsor frequency and recency
- **Effort:** 1-2 months (depends heavily on ASR provider integration)
- **Trigger:** When discovery quality limit is metadata, not algorithm
- **Note:** Architectural prerequisite — ASR provider abstraction must be pluggable. Self-hosted (Microsoft VibeVoice-ASR) is a long-term option. Launch with Podscribe for credibility/IAB cert.

### Sponsor competition tracking
- Detect newly-mentioned brands across episodes before metadata sources update
- Flag in real-time during discovery so brands can avoid running adjacent to direct competitors
- **Effort:** 2-3 weeks (after ASR foundation)
- **Trigger:** When brands ask "who else has run on this show recently"

### "Expand my horizons" slider
- Discovery slider: Tight fit ← → Broad exploration
- Drops audience weight, raises engagement, pulls from adjacent Podscan vector categories
- **Effort:** 1 week
- **Prerequisite:** Scoring weight tunability refactor (foundational architecture, pre-launch)
- **Trigger:** When customers consistently ask for "more options"

### "Find shows like this one" primitive
- First-class UI button on every show card in discovery results
- Calls Podscan Discover endpoint (vector similarity) — already wrapped in `lib/podscan/discover.ts`
- Captures preference signal to `BrandProfile` (which shows the brand finds appealing)
- **Effort:** 2-3 days
- **Trigger:** When customers express preference signals through behavior (e.g., consistently selecting same kind of show across campaigns)
- **Why:** Magic moment for customers, preference signal for data flywheel, competitive differentiator vs Rolodex model

### Saved show lists / favorites
- Brands who run repeat campaigns want to save show lists they've worked with before ("my known performers")
- Build alongside or after Direct show search
- **Effort:** 3-5 days
- **Trigger:** When a customer asks for it, OR when a single brand is on their 3rd+ campaign with overlap in show selection

### Dashboard role-awareness UX polish
- ~~Currently `/dashboard` is brand-only~~ — partial fix shipped April 29 (sidebar + dashboard widget now role-aware)
- Further role-specific deepening as customer signal demands (agent dashboard with portfolio, show dashboard with deal pipeline, etc.)
- **Effort:** 1-2 weeks per role
- **Trigger:** Per-role customer feedback

---

## Future / Aspirational

Build when transaction volume justifies.

### MCP server for agent-mediated commerce
- Public MCP server so Claude Code, Cowork, OpenClaw, etc. can run campaigns programmatically
- Per-call + per-deal pricing structure already designed (see `PRICING_DECISIONS.md`)
- Each step of internal discovery agent reasoning loop already designed as MCP-ready primitive (Wave 14 architecture decision)
- **Effort:** 1-2 months
- **Trigger:** Month 9-12+ once API surface is mature

### Webhooks for everything
- Every deal state change, delivery verification, payment event, make-good trigger → webhook-able
- Built on `domain_events` foundation
- **Effort:** 2-3 weeks
- **Trigger:** When first integration partner asks for events

### Public skills library
- Packaged skills so agents can interact with Taylslate's data and logic
- **Effort:** 2-3 weeks (after MCP server)
- **Trigger:** Once 5+ external developers ask

### Data licensing API / benchmark reports
- Aggregated CPM benchmarks, advertiser retention data, market trends
- Sold to non-customers (research firms, financial analysts, agencies, ad-tech tools)
- **Effort:** 1-2 months
- **Trigger:** Year 3-4 when transaction volume supports credible aggregation

### Podscribe integration for automated verification
- Replace internal admin "mark delivered" stub with Podscribe webhook integration
- Connect Podscribe's "what happened" to Taylslate's "what was agreed to" and "what was paid"
- **Effort:** 2-3 weeks
- **Trigger:** When manual verification becomes a bottleneck (probably ~10-20 active campaigns)

### DocuSign embedded signing
- Currently hosted signing (show redirects to DocuSign domain)
- Embedded keeps shows on `taylslate.com` for premium brand feel
- Requires Intermediate API tier (~$300/mo)
- **Effort:** 1 week
- **Trigger:** Post-funding, premium brand experience priority

### DocuSign Level 1 branding
- Custom Taylslate-branded signing pages
- Requires Business Pro tier
- **Effort:** 2-3 days configuration
- **Trigger:** Post-funding, premium brand experience priority

### Self-hosted verification (long-term ASR)
- Microsoft VibeVoice-ASR (60-min single-pass, hotwords, speaker diarization, MIT license)
- Self-hosted is post-launch project; launch with Podscribe for credibility/IAB cert
- **Effort:** Multi-month research + integration
- **Trigger:** When Podscribe pricing or limits become a constraint

### International expansion
- UK, Canada, Australia podcast advertising
- Requires localized payment infrastructure, market education in new geographies
- **Effort:** 2-3 months minimum
- **Trigger:** Year 4-5 when US market expansion plateaus

### Cross-channel ad planning
- Meta, TikTok, Google ad planning integrated with podcast strategy
- Cross-channel budget allocation
- **Effort:** Multiple months
- **Trigger:** Year 4+, when podcast platform is dominant and customers want adjacent channels

---

## Killed (rejected, do not build)

- **Listing fees / featured placement for shows** — compromises discovery integrity, contradicts mission
- **Pay-to-play discovery** — same reason
- **Curtis (external agent wrapper)** — wrong Layer (was a Layer 2 play, not Layer 3)
- **Premium analytics dashboard as separate paid product** — folded into Operator tier instead
- **Onboarding fees / setup fees** — friction at the moment that matters most
- **Per-campaign / per-discovery / per-outreach metering** — billing complexity, doesn't fit customer mental model
- **Pure 8% transaction (previous pricing)** — replaced with three-tier model (see `PRICING_DECISIONS.md`)
- **$1,500/mo Operator tier (initial proposal)** — wrong reference class, anchored at $499 instead
- **YouTube Shorts as launch medium** — different read mechanics, no proven conversion playbook, wait-and-see
- **Bespoke integrations to every platform (LiveRead approach)** — replaced with clean API + agent-bridge philosophy

---

## How to use this document

1. **Pre-launch backlog must finish before GTM.** Pull items from pre-launch into numbered waves. Wave 14 is the next wave — covers Wave 14 Foundation items + likely picks up scoring tunability + multi-medium abstraction. Other pre-launch items can be wave-bundled or run as polish in parallel.

2. **When a real customer asks for something post-launch:** find it in the post-launch queue. If it's there, move it up the priority queue. If it's not there, add it with the customer name attached.

3. **When tempted to build something speculatively post-launch:** check if it's in "Customer-Driven" or "Future." If so, ask whether a real customer has asked. If not, don't build.

4. **Update regularly:** as items ship, move them out. As new ideas emerge, add them. As customers reveal what they actually want, reprioritize ruthlessly.

Waves remain the execution unit. Backlog is the queue. Customer signal sets priority within the post-launch queue. Pre-launch has a hard deadline (GTM) that overrides signal.
