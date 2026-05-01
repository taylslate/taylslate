# Wave 14 Strategy Memo

*Last updated: April 30, 2026*

This document captures the strategic reasoning behind Wave 14 Phase 2 (Discovery Agent UX). Phase 1 (foundation) shipped April 30. Phase 2 is broken into four sub-phases (2A, 2B, 2C, 2D) that wire Phase 1's dormant infrastructure into the brand-facing UI.

This memo is the missing context that CLAUDE.md, TAYLSLATE_CONTEXT.md, and PRODUCT_BACKLOG.md don't capture — specifically the design decisions and the reasoning that emerged from walking the Sauna Box campaign through the framework. Future chats working on Wave 14 should read this alongside the three core docs.

**Read order for any Wave 14 work:**
1. TAYLSLATE_CONTEXT.md Section 5 (Discovery thesis)
2. CLAUDE.md Wave 14 section (sub-phase scope)
3. PRODUCT_BACKLOG.md Wave 14 Phase 2 entries
4. This memo (strategic texture + design decisions)
5. The sub-phase kickoff prompt (per-chat job)

---

## 1. Why Phase 2 is Pre-Launch (not post-launch customer-driven)

Originally Phase 2 was scoped as post-launch customer-driven: ship the foundation now, build the UX layer when a real customer's campaign exposes the gap. This was wrong.

**The Sauna Box walkthrough (April 30, 2026) confirmed it.** Walking a real campaign — multi-SKU wellness brand with $399-$2,799 AOV, $20-30K test budget, founder-curated 60+ show network roster — through the current flat fit-score discovery produced output that was technically correct but not better than what a network already gives. Specifically:

- The current scoring (audience 40% / engagement 30% / retention 20% / reach 10%) couldn't decompose the brief into multiple customer segments. SaunaBox is a multi-segment brand (lifestyle, optimization, athlete) and a flat fit score collapses them.
- No surfacing of "here's why this show fits" beyond a number. Brand has nothing to argue with except the score.
- No way to express that some shows are great-but-too-expensive-for-this-test-budget (the scale tier).
- No mechanism to capture founder annotations ("Blurry Creatures audience is more faith-based than the show description suggests") that pattern-library-future-Taylslate would need.

**Conclusion:** Current discovery isn't strong enough to launch on. The wedge is "Facebook Ads for podcast reads," and Facebook's discovery is conviction-based interpretive reasoning, not category filtering. Taylslate has to ship that experience to be credibly competitive at launch — not as a v2 upgrade after customer feedback.

So Phase 2 moves to pre-launch must-do. Build it before broader GTM.

---

## 2. The Discovery Thesis (refined through Sauna Box)

Already captured in TAYLSLATE_CONTEXT.md Section 5, but the *reasoning* behind it lives here.

### Conviction-based interpretive reasoning, not category filtering

Veteran agents at VeritoneOne, Ad Results, etc. have 50-100 shows in their head per category that they *know* convert. That's pattern recognition built from running 100s of campaigns over 20 years. Taylslate doesn't have that yet. So the goal of Wave 14 is to substitute it with: structured pattern library + LLM interpretive reasoning over it. Approximate the agent intuition by combining structured data with foundation-model reasoning.

### Three rings per product, not per budget

Originally I framed rings as conviction-tier outputs from the scoring engine: high-conviction shows in conviction ring, medium in probable, low in exploration. Wrong. The right model:

- **Conviction ring** is determined by *the product itself*. SaunaBox's conviction ring is "premium home wellness customers" regardless of whether you have $5K or $500K to spend.
- **Probable ring** is the same — product-determined, not budget-determined.
- **Exploration ring** is the same — product-determined.

Budget controls how much of each ring you can sample, not where the rings are. A $5K SaunaBox campaign and a $500K SaunaBox campaign target the same rings; they sample them at different depths.

### Three-dimensional conviction (the big refinement)

The Sauna Box walkthrough produced this. Original framework was too topical-relevance-heavy — I was reasoning "does the audience care about wellness" when the actual question is "does the audience exist in the right demographic and purchase-power zone, AND is the host fit there, AND is the read quality real."

Three dimensions, all needed for high conviction on a $2,799 product:

1. **Audience fit** — do the listeners exist in the right demographic profile? (Solara → 30-45, mostly female, affluent)
2. **Topical relevance** — does the show's content lean toward the product category? (wellness, recovery, optimization)
3. **Purchase power** — can the audience actually afford the AOV? (matters for $1K+ products, doesn't matter for $50 products)

Convergence is the gold standard. A great pick has all three. A medium pick has two. A weak pick has one. Currently the framework scores audience and engagement but doesn't score topical relevance or purchase power as separate dimensions. Phase 1 added the schema. Phase 2 wires it into actual scoring.

### Why three rings + three dimensions matter together

A founder picking shows for SaunaBox doesn't think "audience fit 87, topical relevance 45, purchase power 92, composite 74." They think "this show sells affluent women premium wellness products." Three rings × three conviction dimensions is the structured form of that intuition. The brand confirms or refines the *interpretation* (which rings, which dimensions matter most), and the system runs the math.

This is why brief interpretation has to come before scoring. Score-then-interpret is database thinking. Interpret-then-score is agent thinking.

---

## 3. What the Sauna Box Walkthrough Taught Us (Texture)

These are the specific learnings from walking real shows through the framework. They should inform every sub-phase's design decisions.

### Founder picks reveal framework gaps

Chris's six picks for SaunaBox were: Nothing Major, Art of Being Well, Real Eisman Playbook, That Was Us, Cleared Hot, Blurry Creatures.

Three of those (Real Eisman Playbook, That Was Us, Blurry Creatures) the framework would have ranked low because:

- **Real Eisman Playbook** = finance audience, low topical relevance for wellness. Framework would have cut. Chris kept it because the affluent male audience is exactly who can afford a $2,799 sauna. **Lesson:** purchase power is its own conviction filter for high-AOV products.
- **That Was Us** = TV-rewatch audience. Framework would have cut as wrong-ring. Chris kept it because 79% female, 25-40, affluent — exact demographic profile of SaunaBox's lifestyle ring. **Lesson:** audience demographics matter more than topical relevance.
- **Blurry Creatures** = cryptids/paranormal audience. Framework would have cut as wrong-ring entirely. Chris kept it because he knows the hosts personally and knows the audience is more faith-based / wellness-curious than the show description suggests. **Lesson:** founder annotations are pattern library training data — capturing reasoning the framework can't infer from metadata.

These are the kinds of insights that would never come from a database query. They come from veteran-agent intuition. The framework needs to *learn from* them, not override them.

### 3-spot test floor is a hard product constraint

99% of podcast tests are 3-spot tests. Per-spot price × 3 must fit within the test budget. This is what filters out Modern Wisdom, Diary of a CEO, Skinny Confidential, Daily Stoic for Sauna Box at $30K — those shows require $20K-$36K for 3 spots, blowing the test budget on a single show.

This isn't a heuristic. It's a default product behavior. Discovery should auto-filter to "shows where 3 spots × per-spot price is ≤ ~25% of test budget" unless the brand specifically opts out (they want a single-spot test or they're scaling a known winner).

### Scale tier is a real product feature

Modern Wisdom and DOAC fit out of Sauna Box's $30K test budget. But they're high-conviction — the brand has even named them as priorities. The framework needs to surface them as **scale tier** (not "filtered out") so the brand:

- Sees what their conviction-ring map *actually* looks like
- Knows what scale-up budget level is needed
- Can mentally commit to those shows as the destination for once test data signals which ring to commit to

Scale tier transforms discovery from "here's a random list" into "here's your full ring map; you can sample this much now, and here's what comes next." It also sets up the Operator-tier conversion conversation post-test ("Your wellness-optimization ring converted; ready to commit to Modern Wisdom?").

### Read quality is a real signal

Hosts who personally read ads with personality (Stumpf on Cleared Hot, Eisman on Real Eisman Playbook) versus aggregator/DAI formats (Optimal Living Daily, Tennis Channel Podcast Network). Chris instinctively avoids aggregator formats — they convert worse because the read is perfunctory. This isn't currently scored. Should be a factor.

### Audience character vs metadata character

Show metadata says "cryptids and paranormal." Founder knows audience is "faith-based and wellness-curious." That gap is the founder annotation use case. The framework needs a structured way to capture this kind of veteran-agent insight as queryable data so future campaigns benefit.

### Topical relevance still matters (despite my overcorrection)

After the founder-pick reveal, I overcorrected to "audience demographics dominate, topical relevance barely matters." Chris pushed back: convergence beats single-dimension. We're Here to Help (network sent it) is comedy hosts who *love* sauna + good audience for wellness — both axes light up, that's why it converts. The framework should reason about both, not pick one.

### Discovery should return more results, not fewer

Chris's network sent 60+ shows. Fewer would have been worse, not better. Brand does the narrowing. Aligns with Facebook Ads model and with veteran-agent behavior (long list, not curated three).

This is a UX implication: pagination and filtering, not aggressive pruning. Show every reasonable conviction-ring match; let the brand cut.

---

## 4. Test vs Scale (The Two UX Modes)

Test mode and scale mode are distinct product experiences, not the same UI with different volumes.

### Test mode (current + Phase 2)

- **Question being answered:** "Does podcast advertising work for us?"
- **Shape:** Single campaign, $20-30K, ~6 shows × 3 spots each
- **UX:** Diagnostic — which ring converts, which audience, which read style
- **Pricing tier:** PAYG (10% transaction fee) aligns

### Scale mode (Wave 15+)

- **Question being answered:** "This works, how do we run it ongoing?"
- **Shape:** Recurring monthly spend, often annual commitments
- **UX:** Treats podcast spending like Meta/Google paid social — ad operations, not single-campaign discovery. Monthly cadence, portfolio rebalancing, weekly ops, quarterly planning.
- **Pricing tier:** Operator ($499/mo + 6%) aligns; sales-led upgrade conversation triggers here

**The implication for Phase 2:** Phase 2 builds test mode. Don't try to handle ongoing operations. Scale mode is a Wave 15+ separate UX project, not "Phase 2 with bigger budget."

But scale mode framing should appear in discovery's scale tier output. The brand sees that some shows are out-of-test-budget but mapped for the future. That educates expectations and sets up the conversion conversation.

---

## 5. Conversion Attribution Reality (What We Can Actually Measure)

The temptation is to overpromise on attribution. Don't. Brands have heard this overpromise from every podcast platform and they're skeptical for good reason.

**What we can capture day 1:**
- **Promo codes at IO time.** Brand provides "SAUNABOX25" or similar; stored on deal. Brand reports back attributed orders monthly. Phase 2D ships this.
- **Auto-generated UTM-tagged tracking links per deal.** Brand uses link in show notes; standard analytics captures click-through.
- **Brand-reported attribution where they share it.** Voluntary self-report at checkout. Brand sets up "how did you hear about us" with Taylslate-tracked option.

**Apply the 2x leak rule when displaying.** Agent rule of thumb: take measured conversions, double them to account for leaks (lost codes, search-by-name conversions, attribution-window expirations).

**Long-term:**
- Podscribe pixel integration for direct attribution (post-Phase-2 customer-driven trigger).
- Renewal as conversion proxy — brand re-runs on a show = it converted.
- Lift studies for $200K+ campaigns (way later).

**Honest framing for brands:**
> "We give you the best conviction-based discovery and capture every conversion signal we can. Hard attribution is a known industry challenge — here's what we measure and how we use it."

This is the framing that's *credible* to brands new to podcast advertising because they've heard the unrealistic version from every other platform.

---

## 6. Pattern Library Seeding (The Async Pre-req)

Phase 2's prompt-driven brief interpretation and conviction reasoning produce *adequate* output on day one. To produce *good* output, the pattern library needs to be seeded with ~20-50 analog campaigns from Chris's media-buying memory.

**What seeding looks like:**

For ~20-50 brand/show pairs, record:
- Brand attributes (category, AOV, target audience, primary product framing)
- Shows that ran successfully (with reasoning)
- Shows that ran unsuccessfully (with reasoning)
- Founder annotations on shows ("Blurry Creatures audience is more faith-based than seems")

Stored in:
- `analog_matches` (brand → list of analog campaigns it patterns to)
- `founder_annotations` (per-show veteran knowledge)
- `campaign_patterns` (reference campaigns from memory)

**Effort:** 30-min chunks per session. Can happen async during Phase 2 build. Doesn't block 2A.

**Why it matters:** When Phase 2A's brief interpretation runs, it benefits enormously from being able to pull "this brand patterns to Plunge, Therabody, Higher Dose campaigns I ran 5 years ago — those converted on these shows." Without seeding, the AI has no historical reference and reasons in a vacuum.

---

## 7. Sub-Phase Sequencing (Why 2A → 2B → 2C → 2D)

Each sub-phase depends on the previous. Order matters.

**2A first (Brief intake + interpretation loop)**
- Reshapes intake from 9-step form to free-text-led + interpretation loop
- Produces structured ring hypotheses (`recordRingHypothesis`)
- Ring hypotheses are the *input* to 2B's conviction scoring (you score against confirmed rings, not raw fit)
- Without 2A, conviction scoring has nothing to ground on

**2B second (Three-dimensional conviction surface)**
- Replaces flat fit score with 3-dim conviction + reasoning
- Per-show conviction tied to confirmed rings from 2A
- Produces conviction-scored show universe
- 2C's portfolio output (test/scale) needs conviction scores to sort and sample correctly

**2C third (Test portfolio + scale tier output)**
- Splits the conviction-scored universe into test (3-spot floor) and scale tiers
- Produces the actual shopping experience the brand interacts with
- Doesn't make sense without 2B's conviction scoring producing the underlying ranks

**2D last (Founder annotations + show brand history + promo code capture)**
- Founder annotation UI lets Chris (and future admins) capture insights that improve future runs of 2A and 2B
- Show onboarding brand history feeds 2A's analog matching
- Promo code capture is the conversion attribution layer
- These can ship after the core test campaign experience works end-to-end

**Don't reorder.** Each subsequent sub-phase has dependencies on the previous in both data shape and UX shape.

---

## 8. Iteration Expectations (LLM Quality)

Phase 2 ships in two parts for each sub-phase:

1. **Working version** (~80% quality) — the schema, UI, plumbing, and prompts are in place. The system runs end-to-end. The brand can complete a campaign through the new flow.

2. **Tuned version** (~95% quality) — the prompts are iterated against 5-10 real briefs. The reasoning text reads like a veteran agent, not an LLM summary. The lateral rings consistently feel sharp instead of generic. Schema and UI don't change during tuning; only prompt files.

**Both parts are normal.** Don't try to ship 95% on day one — the schema/UI gets locked too early on prompts that don't work, and you waste rework. Ship 80%, run real briefs through it, tune the prompts until the output is sharp.

**Iteration is not the same as "Phase 2 is incomplete."** Phase 2 is "shipped" when the working version is in production and the schema/UI are stable. Prompt tuning is an ongoing post-ship activity, not a blocking dependency.

---

## 9. The "More Results Not Fewer" Rule

Discovery should err on the side of returning more shows, not fewer. This is a deliberate design choice that goes against typical recommender system instinct.

**Why:**
- Brands new to podcast advertising want to see options, not curated three.
- Veteran agents work the same way — long list, then narrow with judgment.
- Aggressive pruning hides shows the brand might pick on intuition that the framework can't model.
- Aligns with Facebook Ads UX — broad surface, brand narrows.

**Practical implications for Phase 2:**
- Loosen score thresholds, paginate and filter rather than trim.
- Use Podscan Discover endpoint aggressively (vector similarity → adjacent shows).
- Show every show that matches *any* ring with at least medium conviction.
- Surface the "why" (reasoning text) so brand can quickly assess.
- Filter UI lets brand narrow by ring, conviction band, budget viability, etc.

**Discovery quality isn't competitive differentiation — it's the mission.** The mission is to get brands spending in podcasting on shows that convert AND help shows that don't get enough ad dollars find more deals. Bad discovery breaks both sides of the mission.

---

## 10. Open Design Questions per Sub-Phase

These are the questions a fresh chat will need to walk through with Chris when scoping each sub-phase. They're not pre-answered here on purpose — fresh context per sub-phase produces better answers than guessing now.

### 2A open questions
- What's the exact form structure? (free text vs structured fields per section)
- What's the brief interpretation prompt's system instruction?
- How does the interpretation loop UI feel? Chat sidebar vs inline review panel vs modal?
- What happens when the brand disagrees with all reads? (refinement loop, ask clarifying questions, brand rewrites)
- Where does AI confidence threshold gate? (e.g., low confidence → ask user instead of asserting)

### 2B open questions
- How are sub-scores visually presented per show? (sparkline, three bars, three numbers, single composite with dropdown)
- How is reasoning text generated? (separate LLM call per show, or batched, or pre-computed at scoring time)
- What's the conviction band threshold logic? (high = composite ≥ 80, etc., or relative within campaign)
- Does the brand see all three dimensions, or just composite + reasoning?

### 2C open questions
- How are test portfolio + scale tier visually distinguished? (two tabs, two sections on one page, two pages)
- What's the per-show 3-spot total cost display? (always visible, on hover, expanded view)
- Does the brand "save" scale tier shows somewhere, or is it just informational?
- When the brand picks shows, do they pick from test only or can they grab from scale?

### 2D open questions
- Is the founder annotation UI internal-only or admin-facing within Taylslate?
- Where in show onboarding does brand history fit? (new step, inline with rate card, optional vs required)
- How is the promo code captured at IO time? (separate field on IO form, optional)
- Show notes blurb generation — what's the template, where does it live in the deal flow?

---

## 11. What Phase 2 Doesn't Try to Solve

These come up but are deliberately out of scope. Future chats should resist scope creep into them.

- **Sponsor competition tracking** — knowing which competing brands are currently running on each show. Real value, but requires either Podscribe integration or ASR. Out of scope; future customer-driven.
- **Lift studies** — accurate conversion attribution. Requires $200K+ campaigns. Future.
- **Self-hosted ASR / content-aware discovery** — finding shows where hosts have talked about a category recently. Massive future feature. Not Phase 2.
- **Audience overlap penalty** — detecting when two recommended shows serve the same audience and would cannibalize. Real, but Wave 15+ scale-mode feature.
- **Sponsor saturation modeling** — has this show run too many sponsors lately, listener fatigue. Not Phase 2.
- **Scale mode UX** — ongoing monthly operations, annual commitments, portfolio rebalancing. Wave 15+.
- **DAI integration** — RSS hosting platform integrations for dynamic insertion campaigns. Year 2.
- **YouTube Shorts** — different read mechanics, no proven conversion playbook. Killed.

If a chat working on Phase 2 starts proposing any of these as in-scope, push back and reference this section.

---

## 12. The Two Pinned Items for Month 3-6 Revisit

Capturing here so future chats remember:

**Show-notes value bundle:** Auto-generated UTM links per deal (Phase 2D ships the foundation), copy-paste blurbs for shows, click-through tracking, "shows that consistently include the link in notes" as a conviction signal. Pin for revisit at month 3-6 with first 10-20 customers.

**Operator pricing revisit:** Possibly underpriced at $499/mo if scale customers run $50-200K/mo. Reference class might shift from "channel tool" to "ad operations platform." Possible Operator + Operator Pro split, or raise to $999-1499 with grandfathering for early converts. Pin for revisit at month 3-6.

Both are intentionally not built now — pre-launch energy goes to Phase 2 + operational unblock + polish.

---

## 13. How Phase 2 Connects to the Larger Investment Story

The investor pitch is "we accumulate a structured pattern library that no one else can replicate without running the same campaigns." Phase 1 shipped the pattern library schema. Phase 2 wires it into the user-facing flow so every campaign run on the platform captures structured reasoning data.

**By the time Taylslate has 100 campaigns:**
- Pattern library has 100+ campaign patterns, ring hypotheses, conviction scores, analog matches
- Every campaign benefits from analog matching against prior campaigns
- Conviction calibration improves (predicted vs actual conversion data)
- Founder annotations accumulate into a real domain knowledge base

**By the time Taylslate has 1,000 campaigns:**
- Pattern library is a real data asset
- Conviction reasoning is sharper than veteran-agent intuition because it's structured + reproducible + memory-perfect
- Analog matching produces "shows like X" results no competitor can match
- The data licensing future revenue stream becomes credible

Phase 2 is the wire that connects Phase 1's data schema to actual transactions. Without Phase 2, Phase 1 sits dormant and the data flywheel doesn't spin. With Phase 2, every customer transaction makes the system smarter.

---

## 14. What "Done" Looks Like for All of Phase 2

Phase 2 is done when:

- Brand can complete a campaign through the new flow end-to-end (brief → interpretation → conviction-scored show universe → test portfolio + scale tier → outreach)
- Every AI decision in the flow writes to the pattern library (campaign patterns, ring hypotheses, conviction scores, analog matches)
- Founder annotations can be added to any show
- Show onboarding captures brand history
- Promo codes captured at IO time, UTM links auto-generated
- Show notes blurbs generated for shows to include
- Prompts are tuned against 5-10 real briefs to ~95% quality
- 100% test coverage on the new code paths

That's the bar for GTM. Below that bar, broader launch is premature.

---

*This memo gets updated as Phase 2 progresses. Each sub-phase's completion may surface new strategic insights worth capturing.*
