# Taylslate Product Backlog

*Last updated: July 7, 2026*

This document captures everything that's been identified as worth building. Three parts:

1. **Shipped** — items that were on the backlog and are now live in production.

2. **Pre-launch backlog** — things that must finish before GTM. Operational unblock, polish, foundational architecture, and Wave 14 Phase 2 (discovery agent UX). These are the "must do before we can credibly take real money" items.

3. **Post-launch queue** — things that respond to real customer signal once the product is live. Customer-driven and future/aspirational.

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

## Internal admin tooling — "log in as test user" (Layers 1+2 shipped June 28, 2026)

Founder impersonation tool. **Layer 1 endpoint** (`POST /api/admin/test-login`, commit `ccbc6e5`) + **Layer 2 sidebar UI** ("Log in as …" buttons mapping over `TEST_ACCOUNTS` + "Impersonating &lt;label&gt;" banner, commit `8740670`). Admin-gated by `isInternalAdmin`; impersonable set fixed by `TEST_ACCOUNTS`. Live on prod, verified end-to-end both ways (sidebar click-through, and a real magic-link email to chris+show1 clicked from the inbox). Schema-free — no migration.

**Byproduct:** building it surfaced and fixed **four production auth bugs** on the show magic-link path (none previously testable — Wave 13 gotcha #5): callback path `/auth/callback`→`/callback` + implicit-flow→`verifyOtp(token_hash)` (`8740670`), `/callback` added to the `proxy.ts` allowlist (`8c32570`), magic email pointed at the consuming `/api/auth/magic` route (`0187863`); plus a Codex `next` open-redirect fix (`c355c5e`). This is the first time the show magic-link flow works end-to-end. Durable invariants recorded in CLAUDE.md → "Auth & Admin Access".

**Remaining — Layer 3 (return-to-admin):** tracked under PRE-LAUNCH → Operational Unblock below.

---

## Categorization

- **Operational unblock** — small fixes blocking GTM credibility or daily founder workflow. Pre-launch.
- **Polish** — visible bugs and UX rough edges customers will hit. Pre-launch.
- **Foundational architecture** — small refactors that unlock multiple future features. Pre-launch where high-leverage.
- **Wave 14 Phase 2 — Discovery Agent UX** — pre-launch must-do. Wires Phase 1 dormant infrastructure into the brand-facing experience.
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

### Internal admin tooling — log in as test user → Layer 3 (return-to-admin)
- **Layers 1 + 2 SHIPPED June 28, 2026** (endpoint + sidebar UI; see SHIPPED section). Replaces the Gmail +tag aliases + incognito workflow for switching account types on demand.
- **Layer 3 remaining:** a "Return to admin" control so the founder can swap back from a test session to their own without re-logging-in.
- **LOCKED SECURITY REQUIREMENT (Layer 3):** the `tslate_impersonation_origin` cookie set by Layer 1 is currently **unsigned plaintext** (`{adminId, adminEmail}`). Layer 3 must **NOT** trust `adminId`/`adminEmail` from the cookie as-is. Use an **opaque server-side token** — store a random token in the cookie and resolve the admin identity server-side from the `admin.impersonate` audit record — **not** an HMAC over the plaintext.
- **Effort:** ~0.5 day
- **Why:** Completes the impersonation loop and closes the cookie-trust gap before the tool is used routinely (e.g., onboarding brand/agent friends).

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
- **Partial unblock (June 28, 2026):** the "log in as test user" tool (SHIPPED) now lets you switch between two controlled accounts on demand, and the show magic-link path works end-to-end — so brand↔show flows are testable. Still open: discovery returns real Podscan shows whose email you don't control, so injecting a test show into discovery results (option a) or an admin deal-create bypass (option b) remains the gap.
- **Effort:** 1-2 days
- **Why:** Real-user testing is preferred but not always available. Internal testing currently requires manual SQL or workarounds.

### Test-deal seeding tool  [Layer 1 SHIPPED July 7, 2026 — Layer 2 next]
Create a `planning`-status deal between test accounts (brand1 → show1) on demand, without grinding the full campaign→discovery→outreach→accept chain. Unblocks: (a) all three deferred 2D browser verifies, (b) the money-loop test, (c) any end-to-end confidence before the friends-test. Enabled by the impersonation tool (shipped June 28, 2026).
- **Layer 1 SHIPPED July 7, 2026 (commit `d488430`)** — admin endpoint that inserts the `planning`-status deal. Used to complete all three 2D browser verifies (seeded deal `e0bf050b`).
- **Layer 2 remaining — teardown.** Remove the seeded deal + supporting rows so prod doesn't accumulate test data. **One seeded deal (`e0bf050b`) currently persists in prod** until this ships.
- **Note:** This is option (b) of "Test mode for full transaction loop" above (admin deal-create bypass).

### Auth hardening — brand email/password path  [LAUNCH-BLOCKER]
The brand login path is email/password and fully live; it was NOT part of the June 28 magic-link fixes and real strangers hit it at launch. Before non-friends touch the product: signup-UI honesty fix, `emailRedirectTo` on magic links, bot-signup protection (Turnstile or Supabase Attack Protection). Currently unprotected against automated signup.

### Auth unification (deferred, post-launch acceptable)
Brands email/password, shows magic-link+OTP. Target: magic-link+OTP for all. Not launch-blocking; the hardening item above is. (Supersedes the "Auth unification" polish item below.)

### Accept-flow deal creation — launch-blocker cluster  [LAUNCH-BLOCKER]
Both surfaced July 7, 2026 during 2D browser verification (seeded deal `e0bf050b`). The seed tool sidesteps them by writing ownership columns directly; the real accept path does not. Must fix before the friends test.

**#1 — Accept-flow NOT-NULL bug.** The first real outreach-accept will fail. `createWave12Deal` never sets `deals.brand_id` / `deals.show_id` (both NOT NULL, no default — confirmed in prod via OpenAPI introspection); the `deals` table was empty so the path has never run. Call sites: `outreach/[token]/_shared.ts:167` and `accept-counter/route.ts:105`. Derivations: `brand_id` = `brand_profiles.user_id` via `outreach.brand_profile_id` (trivial). `show_id` is the hard one — `show_profiles` deliberately doesn't link to catalog `shows` (migration 009), and show onboarding never creates a `shows` row. Fix priority: (a) use `outreaches.show_id` if non-null; (b) else materialize a `shows` row from the outreach and backfill. **BLOCKED ON PRODUCT DECISION:** does accepting a non-catalog outreach put the creator's show into shared discovery inventory? `CreateWave12DealInput` already accepts `brand_id`/`show_id` (the seed tool is the working reference).

**#2 — Show-side deal visibility (clusters with #1).** `getDealsFiltered` filters legacy columns (`agent_id`/`brand_id`/`agency_id`) only — a show account NEVER sees Wave-12 deals in its pipeline list ("No deals yet" despite an active deal; confirmed live July 7). A real creator reads this as the deal not existing; the detail page works via direct URL only. Fix = list query honors Wave-12 ownership (`show_profile_id`/`brand_profile_id`). **Caution (pre-flight):** the list status map only handles `planning`|`io_sent`|`live`|`completed` — Wave-12-only statuses would throw; handle when fixing.

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
- **Note:** This is the *display* fix. The Wave 14 Phase 2 brief interpretation agent will reshape *intake* — but this polish item should ship first to unblock GTM if Phase 2 timing slips.

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

### Flight-date off-by-one across surfaces  [pre-launch]
- The Agreed Terms panel shows Jul 20–Aug 17 where the IO document shows Jul 21–Aug 18 (same deal, both roles). Classic date-only string parsed as UTC then rendered in local TZ on one surface but not the other. The contract surface and the summary panel must agree.
- **Confirmed live July 7, 2026** (seeded deal `e0bf050b`).
- **Effort:** Small — align date-only rendering across both surfaces.

### Auth unification
- **Moved to Operational Unblock** (see "Auth hardening — brand email/password path" [LAUNCH-BLOCKER] and "Auth unification (deferred, post-launch acceptable)"). The launch bar is the hardening item; full magic-link+OTP unification is post-launch acceptable.

---

## Wave 14 Phase 2 — Discovery Agent UX (pre-launch)

Wires Phase 1 dormant infrastructure into the brand-facing UI. Current flat fit-score discovery isn't strong enough to launch on — Sauna Box walkthrough confirmed. Phase 2 is the discovery experience that makes Taylslate's wedge actually competitive at launch. Build before broader GTM.

**Competitive pressure added June 1, 2026:** SpotsNow has launched an AI podcast campaign planner on top of its remnant/open inventory marketplace. Generic "enter URL and budget, get shows" is no longer differentiated. Phase 2 must make Taylslate feel like a media-buying strategist and transaction OS, not a show-search tool.

**Sub-phases (each is its own Claude Code session):**

### 2A — Brief intake redesign + interpretation loop (~3 days)
- Reshape current 9-step form into free-text-led intake (product / customer / campaign sections)
- AI proposes 1 primary read + 2-4 lateral candidate ring hypotheses with confidence
- Brand confirms or refines interpretation (not show list — interpretation of customer)
- Refinement loop visible in chat or sidebar; final ring shape collapses from confirmed reads
- Lateral examples that should fall out: "you mentioned mobile use → outdoor/parenting audiences worth exploring?"
- Acceptance criterion: before any show list appears, the brand sees a clear interpretation of "why this customer would buy" and can correct it. This is the anti-SpotsNow wedge.
- Wires `recordCampaignPattern()` and `recordRingHypothesis()` from Phase 1's reasoning-log

### 2B — Three-dimensional conviction scoring + reasoning surface (~4 days)
- Replace flat fit score with three sub-scores (audience fit, topical relevance, purchase power) plus composite
- Conviction band (high / medium / low / speculative) surfaced in UI
- Reasoning text per show: "Conviction: high. Host personally uses cold plunge. Audience over-indexes 2.4x on biohacker purchases. Strong analog to Plunge campaign."
- AOV-aware weight tilt active when product attributes indicate high AOV
- Acceptance criterion: never show a naked match percentage as the primary artifact. Any score must be paired with the conversion hypothesis and the dimension(s) driving it.
- Wires `recordConvictionScore()` from Phase 1's reasoning-log

**2B follow-ups (deferred from the Layer 5 build, June 2026):**
- **Clear conviction scores on (re-)confirm.** A brand who discovers, then goes back and *refines* a ring and re-confirms, lands on the discovery view with stale `conviction_scores` still present, so `getConvictionUniverse` reports `hasScores=true` and the view does not auto-fire — the refined ring renders empty until the brand clicks "Re-run discovery." Fix: call `clearConvictionScores(pattern.id)` in the 2A confirm route (`app/api/campaigns/[id]/interpret/confirm`) so a re-confirm always re-fires fresh discovery. Small (~3 lines), correctness-only, non-corrupting today (stale rows are dropped, not shown). Codex-flagged during Layer 5 review.
- **Media-plan handoff adapter (belongs in 2C).** The Layer 5 discovery view shows a *disabled* "Media plan — next" affordance because the legacy plan page reads `scored_shows` / `selected_show_ids`, which the v2 conviction path doesn't write. 2C must add an adapter that converts the picked conviction shows into the plan page's input (or replace the plan entry) and re-enable the CTA.

### 2C — Test portfolio + scale tier dual output (~3 days) — SHIPPED
- ~~Two distinct lists from one analysis (test / scale / bench)~~ — done
- ~~3-spot floor as default budget filter; scale tier "deferred" framing; per-show 3-spot cost~~ — done
- ~~Brand picks from test list; scale saved as watchlist; CTA → Wave 7 plan handoff~~ — done
- ~~Rejected-ring filter (3.5): confirmed-ring filter before rollup, both persist + read paths~~ — done
- Layers 1/1b/2/3/3.5/4 shipped; migration 028 applied. Layer 5 (overrides) remaining — optional.

#### 2C — closed (4 fixes shipped; flat_fee re-homed to YouTube onboarding; 2 standing invariants)
- ~~**scale-watchlist tier validation** — save/dismiss endpoint doesn't validate the show is actually in the scale tier; zero-row writes undetected.~~ — **shipped June 26 2026 (commit `78185f6`).** Gates all five actions on `getTieredUniverse().scale` membership (fails closed); `updateScaleShowCuration` detects 0-row writes via `.select()` → 500.
- ~~**plan-handoff non-atomic double-write** — writes `scored_shows` + `selected_show_ids` separately.~~ — **shipped June 26 2026 (commit `bd2847a`).** Collapsed into one atomic `campaigns` UPDATE (`updateCampaignPlanHandoff`).
- **Q5 stale-tier invariant note** — confirmed-ring stale-tier safety holds only because every persisted row has composite ≥ MEDIUM_FLOOR (the sole ring-dependent input to `classifyTier`). If a future change ever persists below-floor rows, reopen Codex Q5 (add the defensive confirmed-only recompute). **Trigger to watch, not a task.**
- **Layer 5 request-scope footgun** — `tierCampaignPortfolio`'s default `loadShowsByIds` uses the cookie server client (request-scope only). Layer 5 override re-runs must run in a request scope or inject admin deps, or the show load returns empty. **Build note for Layer 5.**

### 2D — Founder annotations + show brand history + promo code capture (~2 days) — SHIPPED (COMPLETE July 6, 2026)
- ~~Founder annotation UI: capture "why this show is right" reasoning that metadata can't infer (Wires `recordFounderAnnotation()`)~~ — **shipped June 26, 2026 (Layer 1, commit `137d6ae`, `components/discovery/FounderAnnotations.tsx` + admin annotation routes).**
- ~~Show onboarding addition: "brand history" field (3-5 top advertisers + annual deals flag) → `show_profiles.brand_history`~~ — **shipped June 26, 2026 (Layer 2, onboarding brand-history step, commits `34b5f0a`/`d3c0d5b`).**
- ~~Promo code field at IO generation time~~ — **shipped July 6, 2026 (Layer A, `deals.promo_code`).**
- ~~Auto-generated UTM-tagged tracking link per deal~~ — **shipped July 6, 2026 (Layer B, `buildTrackingLink`, generated on read).**
- ~~Show notes blurb generation helper (copy-paste output for the show)~~ — **shipped July 6, 2026 (Layer C, `buildShowNotesBlurb`, deterministic template, generated on read).**
- Acceptance criterion: capture the learning loop explicitly. Every creator selection, founder override, promo code, and UTM link should become future recommendation signal.

**2D follow-ups (deferred during the Layer 2 build, June 2026):**
- **Render `promo_code` on the signed IO PDF.** A real transaction-terms gap, not cosmetic — the promo code is part of what the brand and show agree to, so it belongs on the signed document, not just on the deal record. Deferred from 2D Layer 3 v1 (which captures the code at IO generation time). IO PDF generator: `lib/pdf/io-generator.ts`.
- **Promo code cleared-state display ambiguity (Layer A, July 6 2026 — accepted tradeoff).** With a single nullable `deals.promo_code` column, "explicitly cleared" and "never touched" are indistinguishable on reload: a brand who clears a code sees the derived show-name default re-seed the input on the next mount (the DB correctly stays `null` — no phantom code is ever persisted, and `Sign IO` never writes the column, so this is display-only, not a persistence bug). Codex-flagged MEDIUM during Layer A review; accepted because the ~99% convention is that the code matches the show name anyway. Fix if it ever bites: add a `promo_code_confirmed_at` marker column and only derive the default when no decision (set or clear) was ever saved. Files: `components/deals/Wave12DealClient.tsx` (prefill init) + `app/api/deals/[id]/promo-code/route.ts`.

**Effort:** ~2 weeks total split across 4 Claude Code sessions
**Pre-req:** Pattern library seeded with ~20-50 analog campaigns from Chris's media-buying memory (can happen async during Phase 2 build)

---

## Foundational Architecture

### English language filter
- Non-English shows currently surface in results without filtering
- Add language filter to discovery query
- **Effort:** Few hours

### Domain events expansion
- Already have `domain_events` table (Wave 12)
- Audit current coverage — every state transition should fire an event
- Document event schema versioning conventions
- **Effort:** 1 day audit + ongoing as new endpoints ship

### Multi-medium creator inventory abstraction
- `shows.platform` already has `'podcast' | 'youtube'` enum ✓
- Add `surfaces` JSONB to capture simulcast (one show, podcast + YouTube)
- Add `medium_priors` JSONB for medium-specific scoring (CPM range, engagement weight, frequency norms)
- Update discovery orchestrator (`lib/discovery/discover-shows.ts`) to merge simulcast records
- Update conviction reasoning to be medium-aware
  - flat_fee meter-vs-plan mismatch — budget meter excludes flat_fee but media plan prices it; blocker on shipping YouTube discovery, moot until then.
- **Effort:** 2-3 days
- **Why:** Long-form YouTube is launch-day medium, not future expansion. Simulcasts are common (most podcasts upload to YouTube). Modeling now avoids re-migration later.

### Creator-attached sellable surfaces
- Expand show onboarding so creators can list optional surfaces they are willing to sell alongside the host read:
  - Podcast read
  - Long-form YouTube integration
  - Newsletter mention
  - Instagram/TikTok/Reels/Shorts clip
  - X/LinkedIn host post
  - Patreon/Discord/community mention
  - Live event or bonus episode package
- Capture audience size, format, minimum buy, creative constraints, lead time, and whether the creator/host or brand owns posting
- Discovery should treat these as creator-attached sponsorship surfaces, not generic paid media inventory
- **Effort:** 1-2 weeks for data model + onboarding + display; deeper pricing later
- **Why:** Differentiates Taylslate from podcast-only planners and creates the path from "podcast ads" to creator-led marketing OS without prematurely becoming a generic Meta/Google ad buyer

### Show dashboard role-awareness
- A single-show account currently sees agency/network-shaped UI (a "Shows" list implying a portfolio of many shows). A single show should see a show-specific dashboard (its own profile, deals, brand history), not a roster view.
- The "Shows" list belongs to agency/network/rep accounts that manage many shows — this is the beginning of the agent/rep portfolio model.
- **Dependency:** intersects "Agent / rep account UX" (Wave 14/15). Resolve the account-type model (single show vs network/agency/rep) before building the role-aware dashboard, or risk rework.
- **Dependency:** ~~can't be cleanly tested until the "log in as test user" admin tool exists~~ — RESOLVED June 28, 2026 (impersonation tool shipped; switch between account types on demand).

---

# POST-LAUNCH QUEUE

Things that respond to real customer signal once the product is live.

## Post-Launch Hardening

- Cleanup cron for `interpretation_locks` rows older than ~10 minutes — handles orphaned locks from crashed Node processes (the interpret endpoint releases on failure paths, but a hard crash mid-run leaves the sentinel until the brief is resubmitted).

## Customer-Driven

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
- **Prerequisite:** ~~Scoring weight tunability refactor~~ (shipped Wave 14 Phase 1)
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

### Scale mode UX (Wave 15+)
- Distinct from test mode (Phase 2). For brands who've completed a test and converted to ongoing operations.
- Monthly cadence, annual commitments, recurring spend allocation, weekly portfolio rebalancing
- Treats podcast spending like Meta/Google paid social — ad operations, not single-campaign discovery
- Aligns with Operator pricing tier conversion moment
- **Effort:** 3-4 weeks
- **Trigger:** First customer post-test wants to commit to ongoing monthly spend

### Show-notes value bundle (pinned for month 3-6 revisit)
- Auto-generated UTM links per deal (foundation in Phase 2D)
- Copy-paste blurb for shows ("As mentioned in this episode, get $X off at saunabox.com/code")
- Click-through tracking where brands enable analytics sharing
- "Shows that consistently include the link in notes" as conviction signal (read engagement proxy)
- **Tracking redirect + short link (concrete spec, added July 7, 2026):** replace the raw UTM URL in the tracking-link card and blurb with a Taylslate-owned short link (`taylslate.com/r/<code>`) that 301s to the full UTM URL and logs a click event. This IS the click-through-tracking piece above: first-party click data per deal, a conversion signal nothing else captures. **Never use a third-party shortener** — the click data is the point. Small: code storage + one route + `buildTrackingLink`/blurb update.
- **Effort:** 1-2 weeks
- **Trigger:** First 10-20 customers; product feature pinned for month 3-6 revisit

### Sponsorship-to-paid amplification brief
- After a host read runs, generate a paid-media amplification packet:
  - Winning audience ring and why it worked
  - Suggested Meta/YouTube/TikTok audiences
  - Recommended clip/read asset
  - Copy variants using the host-read angle
  - UTM links and promo code
  - Suggested budget and flight
  - Success metric and expected read on results
- V1 is export/share only: brand or their paid-media agent executes
- V2 can pass the packet to external agents via API/MCP
- V3 can optionally execute creator-post boosting where the creator owns the social handle
- **Effort:** 1 week for V1 after promo/UTM foundation; API handoff later
- **Trigger:** First campaign with a clear winning show/read and brand interest in scaling the learning outside podcast

### Operator pricing revisit (pinned for month 3-6)
- Possibly underpriced at $499 if scale customers run $50-200K/mo
- Possible Operator/Operator Pro split or raise to $999-1499
- Grandfather early converts at $499
- **Trigger:** Decide with first 10-20 customer signal

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

### Digital marketing OS command layer
- Long-term north star: Taylslate becomes the operating layer that coordinates creator sponsorships, creator-attached amplification, paid social, search, YouTube, retargeting, and reporting
- Do not build generic paid ad buying first; paid-media agents will commoditize Meta/Google/TikTok execution
- Taylslate's role is to provide proprietary sponsorship-derived audience truth, conversion hypotheses, creator creative, and budget recommendations
- Initial product shape:
  - Marketing budget planner that recommends sponsorship vs paid amplification vs search/social/retargeting allocation
  - Export/API handoff to paid-media agents
  - Performance result ingestion back into Taylslate's learning loop
  - Cross-channel audience playbook per brand
- **Effort:** multi-quarter product line
- **Trigger:** Sponsorship transaction volume is high enough to make cross-channel recommendations better than generic paid-media agent advice

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

### DAI and RSS hosting platform integrations
- Megaphone, Libsyn, Art19, Spotify/Anchor, Acast integration for dynamic insertion campaigns
- Currently launch is baked-in host-read only
- **Effort:** Multiple months per integration
- **Trigger:** Year 2 when hosting platform partnerships are real

### Lift studies for $200K+ campaigns
- Spotify, Magellan, Podscribe Incrementality integration
- Household-level visit lift on exposed-vs-unexposed audiences
- **Trigger:** When $200K+ campaigns are routine

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

1. **Pre-launch backlog must finish before GTM.** Pull items from pre-launch into numbered waves. Wave 14 Phase 2 is the next major wave covering discovery agent UX. Other pre-launch items can be wave-bundled or run as polish in parallel.

2. **When a real customer asks for something post-launch:** find it in the post-launch queue. If it's there, move it up the priority queue. If it's not there, add it with the customer name attached.

3. **When tempted to build something speculatively post-launch:** check if it's in "Customer-Driven" or "Future." If so, ask whether a real customer has asked. If not, don't build.

4. **Update regularly:** as items ship, move them out. As new ideas emerge, add them. As customers reveal what they actually want, reprioritize ruthlessly.

Waves remain the execution unit. Backlog is the queue. Customer signal sets priority within the post-launch queue. Pre-launch has a hard deadline (GTM) that overrides signal.
