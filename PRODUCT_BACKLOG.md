# Taylslate Product Backlog

*Last updated: April 28, 2026*

This document captures everything that's been identified as worth building but hasn't been built yet. It replaces the wave-based roadmap. Each item has a category, a short rationale, and a rough effort estimate. Priority is set by customer signal — items move up when real customers ask for them, not on a predetermined schedule.

---

## Categorization

- **Operational unblock** — small fixes blocking GTM credibility or daily founder workflow
- **Polish** — visible bugs and UX rough edges customers will hit
- **Foundational architecture** — small refactors that unlock multiple future features
- **Customer-driven** — features that should only be built once a real customer asks
- **Future / aspirational** — directional items, build only when transaction volume justifies

---

## Operational Unblock (do these first, no waiting on customers)

### Domain & email cutover
- Verify `taylslate.com` in Resend
- Add `taylslate.com` as custom domain in Vercel, point DNS
- Swap `from:` addresses in `lib/email/send.ts` and `lib/email/templates/outreach.ts` from `onboarding@resend.dev` to `outreach@taylslate.com`
- Update DocuSign webhook URL when production domain is cut over
- **Effort:** 4-6 hours
- **Why:** Every customer touchpoint currently looks unprofessional. Blocking GTM.

### Outreach email "from name" bug
- `buildFromAndReply()` in `lib/email/templates/outreach.ts` is receiving `brandName=full brief paragraph` instead of brand name
- Add dedicated `brand_name` field on brand profile, update outreach pipeline to use it
- **Effort:** 2-3 hours
- **Why:** Brand outreach emails currently show paragraph-length "from" lines. Looks broken.

### Internal admin tooling — "log in as test user"
- Admin panel with "log me in as test show 1" / "test brand 1" buttons
- Replaces current Gmail +tag aliases + incognito windows workflow
- **Effort:** 1 day
- **Why:** Multi-account testing friction compounds as you and team test more flows. Saves hours/week.

### Direct show search
- Brands who come in with a specific target list (knowing the shows they want) have no way to search for them by name
- Currently discovery is AI-generative only — brand enters brief, AI recommends
- Add a search bar to the discovery experience that hits Podscan's search endpoint, returns matching shows, lets brand select and add to media plan
- Coexists with AI discovery, doesn't replace it
- **Effort:** 2-3 days
- **Why:** Real brands sometimes know what they want. Forcing them through AI discovery when they want to search for "Acquired" specifically is unnecessary friction. Both flows feed into the same media plan UI — search results just need to be selectable the same way discovery results are.

### Test mode for full transaction loop
- Currently no clean way to test full brand-side discovery → outreach → deal → IO → payment flow with two accounts you control
- Discovery returns real Podscan shows whose email you don't control — can't simulate show acceptance
- Add either: (a) ability to fabricate a "test show" entity and inject it into discovery results, OR (b) admin tool to manually create deal between two existing user accounts bypassing discovery
- **Effort:** 1-2 days
- **Why:** Real-user testing is preferred but not always available. Internal testing currently requires manual SQL or workarounds.

---

## Polish (visible to first customers, do alongside GTM)

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

### Dashboard role-awareness
- Currently `/dashboard` is brand-only and shows "Create your first campaign" CTA regardless of role
- Make dashboard role-aware: brand sees campaign CTA, show sees deal pipeline, agent sees portfolio
- **Effort:** 1-2 days

### Auth unification
- Currently brands use email/password, shows use magic link + Supabase OTP
- Move all users to unified magic link + 6-digit OTP
- Safer, cleaner UX, no password management
- **Effort:** 2-3 days

---

## Foundational Architecture (small, leveraged, do early to unblock future work)

### Scoring weight tunability refactor
- Refactor `lib/scoring/weights.ts` to accept per-request overrides
- Default weights stay (audience 40 / engagement 30 / retention 20 / reach 10)
- Per-request overrides enable A/B testing, "expand my horizons" slider, customer-specific tuning, future ML weights
- **Effort:** 2-3 days
- **Unblocks:** Every future discovery feature

### "Find shows like this one" primitive
- First-class UI button on every show card in discovery results
- Calls Podscan Discover endpoint (vector similarity) — already wrapped in `lib/podscan/discover.ts`
- Captures preference signal to `BrandProfile` (which shows the brand finds appealing)
- **Effort:** 2-3 days
- **Why:** Magic moment for customers, preference signal for data flywheel, competitive differentiator vs Rolodex model

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

## Customer-Driven (build only when signal demands)

These are real product capabilities, but building them before customers ask is speculative. Listed here so they don't get forgotten, not as a promise to build them.

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

### Brand brief refinement as conversation
- Replace static brief form with interactive probing conversation
- "You said wellness — supplements, mental health, or fitness? Each has different dynamics."
- **Effort:** 2-3 weeks
- **Trigger:** When discovery quality is limited by brief vagueness

### Content-aware discovery (ASR-derived)
- Layer ASR-derived content intelligence on top of metadata-based discovery
- Find shows where hosts have organically mentioned a brand category recently
- Detect tonality from transcripts to match brand voice
- Track sponsor frequency and recency
- **Effort:** 1-2 months (depends heavily on ASR provider integration)
- **Trigger:** When discovery quality limit is metadata, not algorithm
- **Note:** Architectural prerequisite — ASR provider abstraction must be pluggable

### Sponsor competition tracking
- Detect newly-mentioned brands across episodes before metadata sources update
- Flag in real-time during discovery so brands can avoid running adjacent to direct competitors
- **Effort:** 2-3 weeks (after ASR foundation)
- **Trigger:** When brands ask "who else has run on this show recently"

### "Expand my horizons" slider
- Discovery slider: Tight fit ← → Broad exploration
- Drops audience weight, raises engagement, pulls from adjacent Podscan vector categories
- **Effort:** 1 week
- **Prerequisite:** Scoring weight tunability refactor
- **Trigger:** When customers consistently ask for "more options"

### Saved show lists / favorites
- Brands who run repeat campaigns want to save show lists they've worked with before ("my known performers")
- Build alongside or after Direct show search
- **Effort:** 3-5 days
- **Trigger:** When a customer asks for it, OR when a single brand is on their 3rd+ campaign with overlap in show selection

---

## Future / Aspirational (build when transaction volume justifies)

### MCP server for agent-mediated commerce
- Public MCP server so Claude Code, Cowork, OpenClaw, etc. can run campaigns programmatically
- Per-call + per-deal pricing structure already designed (see `PRICING_DECISIONS.md`)
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

---

## How to use this document

1. **When a real customer asks for something:** find it in this list. If it's there, move it up the priority queue. If it's not there, add it with the customer name attached.
2. **When tempted to build something speculatively:** check if it's in "Customer-Driven" or "Future." If so, ask whether a real customer has asked. If not, don't build.
3. **When planning a build cycle:** mix items from "Operational Unblock" and "Polish" liberally; reach into "Foundational Architecture" sparingly; pull from "Customer-Driven" only when triggered.
4. **Update regularly:** as items ship, move them out. As new ideas emerge, add them. As customers reveal what they actually want, reprioritize ruthlessly.

The wave model served its purpose for Waves 1-13. From here forward, the priority is customers, and the backlog responds to customers — not the other way around.
