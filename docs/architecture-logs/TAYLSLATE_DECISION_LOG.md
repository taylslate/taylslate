# Taylslate — Architectural Decision Log

**Author of record:** Chris Taylor, sole founder
**Compiled:** August 19, 2026
**Period covered:** March 2026 – August 2026 (Waves 1–14)

---

## Purpose and how to read this

This log records the load-bearing decisions in the Taylslate codebase: what was chosen, what was rejected, and **why** — where the "why" is a domain judgment rather than a technical convention.

The distinction that matters: a large language model can produce a Next.js route, a Postgres migration, or a React component. It cannot know that 99% of podcast tests are 3-spot tests, that sleep content is sold via dynamic insertion to listeners who are literally tuning out, or that a TV-rewatch podcast is the right buy for a $2,799 sauna because the audience is 79% female, 25–40, and affluent. Those judgments came from ten years of buying podcast media, and they are what shaped this system.

Several entries below are cases where the framework — or a model, or an automated reviewer — proposed one thing and was **overruled** on domain grounds. Those are marked **[OVERRULE]** and are the strongest evidence in the document.

### Honesty convention

Entries are tagged by how the decision originated. Overclaiming here would be worse than useless in diligence, so the weaker categories are labeled as such:

| Tag | Meaning |
|---|---|
| **[DOMAIN]** | Originated from media-buying experience. No general-purpose tool would produce this. |
| **[OVERRULE]** | The framework, a model, or an automated reviewer proposed X; the founder ruled Y on domain grounds, with reasoning recorded. |
| **[JUDGMENT]** | A tradeoff surfaced during build; the founder chose the side and owns the consequence. |
| **[CONVENTION]** | Standard engineering practice adopted deliberately. Included for completeness; **not** claimed as distinctive authorship. |

Supporting evidence: git history (single committer, continuous, dated), the wave-by-wave document trail (`WAVE_HISTORY.md`, `STATUS.md`, per-phase specs), and `SCORING_CALIBRATION.md`, which is a running record of the founder red-penning the system's own output.

---

## Part I — Discovery and scoring

*The commercial core. Every decision here is a media-buying judgment expressed as code.*

---

### D-01 · Conviction-based interpretive reasoning, not category filtering
**Tag:** [DOMAIN]

**Decided:** Discovery interprets a product into *customer frames* ("rings") and reasons laterally about who buys and why. It does not filter a database by category tags.

**Rejected:** Keyword/category matching — the standard approach, and what most competitors ship.

**Domain reason:** A category system sees "sauna, recovery, wellness" and returns wellness-tagged shows. That's the whole output. A veteran buyer sees "sauna, mobile, $2,799, home use" and reasons in five directions: mobile + family-friendly → busy parents; outdoors + portable → van life and overlanding; stress-relief framing → mental health and meditation; status purchase → entrepreneurship; recovery for performance → CrossFit and endurance. Five defensible rings, five different show universes.

The commercial value is the moment the brand says *"mobile is actually our biggest selling point — we hadn't thought about overlanders."* The system just surfaced a customer segment the brand didn't consciously know it had. A category filter cannot produce that moment.

**Consequence:** Brief interpretation must precede scoring. Score-then-interpret is database thinking; interpret-then-score is agent thinking.

**Lives in:** `lib/prompts/interpret-brief.md`, `ring_hypotheses` table, the interpretation checkpoint at `/campaigns/[id]`

---

### D-02 · Rings are determined by the product, not the budget
**Tag:** [OVERRULE]

**Decided:** Each product has a fixed set of rings (conviction / probable / exploration). Budget controls **sampling depth**, not ring location.

**Rejected:** The original framework treated rings as conviction-tier *outputs of the scoring engine* — high-scoring shows land in the conviction ring, medium in probable, low in exploration.

**Domain reason:** That was backwards. SaunaBox's conviction ring is "premium home wellness customers" whether the budget is $5,000 or $500,000. A $5K campaign and a $500K campaign target the same rings; they sample them at different depths. Making rings a function of score meant the rings moved every time the budget did, which is not how a media plan works.

**This is a documented founder correction of the framework's own design.**

**Lives in:** `ring_hypotheses` (product-scoped, campaign-linked), 2C tiering (budget affects tier, never ring)

---

### D-03 · Three-dimensional conviction — audience fit, topical relevance, purchase power
**Tag:** [OVERRULE] [DOMAIN]

**Decided:** Conviction is scored on three separate dimensions with a composite, not a single fit score. Convergence across dimensions is the quality bar.

**Rejected:** The original framework was topical-relevance-heavy — scoring "does this audience care about wellness" — plus audience and engagement. Purchase power and topical relevance were not separate dimensions at all.

**Domain reason:** The wrong question was being asked. For a $2,799 product the real questions are: *does the audience exist in the right demographic and purchase-power zone, is the host fit there, and is the read quality real.* Topical relevance is one input among three, not the spine.

The grading rule, straight from how buyers actually assess: **three-of-three is a strong pick. Two is testable. One is speculative.** Convergence beats any single dominant signal.

**Lives in:** `conviction_scores` (`audience_fit`, `topical_relevance`, `purchase_power`, `composite`), `lib/scoring/weights.ts`

---

### D-04 · Audience demographics outrank topical relevance for high-AOV products
**Tag:** [OVERRULE] [DOMAIN]

**Decided:** Demographic fit and purchase power are weighted above topical relevance when average order value is high.

**Rejected:** The framework's instinct — cut shows whose content doesn't match the product category.

**Domain reason:** Two founder picks the framework would have discarded:
- **Real Eisman Playbook** — a finance podcast. Near-zero topical relevance to wellness. Kept, because the affluent male audience is precisely who can write a $2,799 check.
- **That Was Us** — a TV-rewatch show. The framework would have cut it as wrong-ring. Kept, because the audience is 79% female, 25–40, affluent — the exact demographic profile of SaunaBox's lifestyle ring, regardless of what the hosts talk about.

A TV-rewatch show converts on premium wellness even though the host never mentions wellness. That is not something a system can infer from show metadata.

**Lives in:** AOV-aware weight tilt — when `aovBucket='high'`, purchase-power weight rises to 0.20 and reach drops to 0.05

---

### D-05 · Purchase power is non-gating — a weighted dimension, never a hard filter
**Tag:** [OVERRULE]

**Decided:** Purchase power is one of three weighted dimensions. A show scoring low on it still surfaces if audience and topical fit are strong.

**Rejected:** Purchase power as a hard filter or veto — the intuitive design, since it's a yes/no affordability question.

**Domain reason:** This is the *That Was Us* lesson generalized. Purchase power is scored from category as a crude proxy for audience affluence, and a TV-rewatch category reads "low" on prestige while the actual listeners are affluent women 25–40. **The proxy was wrong on that show and the audience signal was right.** If purchase power could veto, the system would have silently deleted a show that converts.

Being wrong on one dimension should lower a sub-score. It must never delete a show.

**Recorded as a locked architecture decision — explicitly not to be reopened during build.**

**Lives in:** `lib/scoring/` — purchase power contributes to composite, never filters

---

### D-06 · Sleep, meditation, and ASMR shows are excluded from results entirely
**Tag:** [DOMAIN]

**Decided:** A hard show-type exclusion applied in the orchestrator **before** scoring, regardless of audience overlap. The brand never sees these shows and cannot override.

**Rejected:** (a) Down-weighting instead of excluding. (b) Leaving them in and letting the brand decide.

**Domain reason:** Sleep content doesn't convert for direct-response, for three compounding reasons: it's typically sold as dynamic insertion rather than host-read; the listener is *actively trying to stop paying attention*; and there's no established conversion playbook. This surfaced concretely in calibration — "Get Sleepy: Sleep meditation and stories" scored **85** against a DTC protein gummy brief on pure audience overlap.

The audience overlap is real. The conversion is not. No amount of demographic match fixes a listener who is asleep.

**Why exclusion and not a down-weight:** this is a *fit-with-the-host-read-model* call, which belongs to the platform. It is not a taste question, so there's nothing for the brand to override.

**Lives in:** orchestrator filter stage, pre-scoring

---

### D-07 · Brand safety is surfaced, never scored — the platform/brand dividing line
**Tag:** [JUDGMENT] [DOMAIN]

**Decided:** Brand-safety flags render as a visible notice on the show card with **zero** scoring impact. The brand decides.

**Rejected:** Down-weighting or excluding flagged shows — which calibration made a live case for.

**Domain reason:** The dividing principle, stated explicitly: **fit and inventory decisions belong to the platform; brand-values decisions belong to the brand.** Taylslate filters what doesn't fit the host-read model it operates in (see D-06). It surfaces — but never decides — what a given brand finds off-brand. Advertisers have genuinely different tolerances, and a platform that silently applies its own taste is making a call it wasn't asked to make.

**The cost is documented, not hidden.** Calibration Test Campaign 1 recorded "Erotic Stories" scoring **86** against a women's protein gummy brief despite a high-risk badge, with the note that *"that design choice has cost showing here."* The resolution in 2B kept the stance and answered it with a legible notice rather than a silent penalty — the brand sees the flag and rules.

**This entry is included specifically because it documents a decision with a known cost.** The calibration file records the failure case in the founder's own words before the resolution was designed.

**Lives in:** brand-safety notice in the discovery view; no scoring path touches the flag

---

### D-08 · Return more results, not fewer
**Tag:** [DOMAIN]

**Decided:** Discovery errs toward breadth. Loosen thresholds, paginate and filter rather than trim, surface every show matching any ring at medium conviction or above, and always show the *why*.

**Rejected:** Aggressive pruning to a curated shortlist — the standard recommender-system instinct.

**Domain reason:** Three converging reasons, all from practice. Veteran agents work from a long list and narrow with judgment; they don't start from three. Brands new to podcast want to see the option space, not be handed a verdict. And **pruning hides the shows a brand picks on intuition the framework can't model** — exactly the D-04 cases.

The empirical trigger: the network sent 60+ shows for the SaunaBox brief. Fewer would have been worse, not better. The brand does the narrowing.

**Lives in:** threshold configuration, pagination and filter UI, aggressive use of Podscan's vector-similarity endpoint for adjacency

---

### D-09 · Scores are computed; the model writes only prose
**Tag:** [JUDGMENT]

**Decided:** All three sub-scores come from structured signals via deterministic functions. The LLM is called only to generate reasoning *prose*, batched one call per ring.

**Rejected:** Letting the model produce the scores — simpler to build and superficially more "AI-native."

**Reason:** Computed scores are deterministic, testable in CI, and **calibratable against real conversion outcomes.** LLM-opinion scores are none of those. Since the entire long-term thesis is that transaction outcomes tune the scorer, a scoring function that can't be held still between runs destroys the thing being built.

Downstream consequence: **2C calls no model at all** — cost derivation and tier classification are pure functions, and reasoning is read from persisted scores rather than regenerated. This keeps the split calibratable and the outcome data clean.

**Recorded as a locked architecture decision.**

**Lives in:** `lib/scoring/`, `lib/prompts/conviction-reasoning.md`, all of 2C

---

### D-10 · Never show a naked match percentage
**Tag:** [DOMAIN]

**Decided:** Any score is paired with the conversion hypothesis and the dimensions driving it. All three sub-scores are visible, not just the composite.

**Rejected:** A single composite fit score as the primary artifact — the industry-standard presentation.

**Domain reason:** A founder picking shows doesn't think *"audience fit 87, topical relevance 45, purchase power 92, composite 74."* They think *"this show sells affluent women premium wellness products."* A single composite hides exactly the divergence that justifies the pick — the show in D-04 is a **45 on topical relevance and a 90 on audience**, and that spread *is* the reasoning. Collapsing it to 74 destroys the information the brand needs.

**Lives in:** discovery view — three bars per show plus reasoning prose

---

### D-11 · Founder picks are labeled training data, not overrides to suppress
**Tag:** [DOMAIN]

**Decided:** When a human picks a show the framework ranked low, the system records the pick **and the reasoning** as structured pattern-library data.

**Rejected:** Treating divergence as noise, or auto-tuning weights toward whatever the human picked.

**Domain reason:** Some knowledge is not inferable from any metadata. *Blurry Creatures* is a cryptids and paranormal show — the framework would have cut it as wrong-ring entirely. It was kept because the founder knows the hosts personally and knows the audience skews more faith-based and wellness-curious than the show description suggests. That fact exists in no API and never will.

The system needs to **learn from** these picks, not override them and not silently absorb them. Structured capture with reasoning is the difference between a training signal and a weight nudge.

**Lives in:** `founder_annotations` table, `recordFounderAnnotation()`

---

### D-12 · The 3-spot test floor is default product behavior, not a heuristic
**Tag:** [DOMAIN]

**Decided:** Budget viability is computed as per-spot price × 3, and shows where that exceeds ~25% of the test budget are moved out of the test portfolio.

**Rejected:** Generic budget-fit scoring, or letting the brand discover the problem at media-plan time.

**Domain reason:** 99% of podcast test campaigns are 3-spot tests. This is not a tunable parameter — it is how the market runs tests, and any system that doesn't encode it will build media plans that can't be bought.

The concrete effect on a real brief: at a $30K test budget it filters out Modern Wisdom, Diary of a CEO, Skinny Confidential, and Daily Stoic for SaunaBox — those require **$20K–$36K for three spots**, blowing the entire test budget on one show.

**Lives in:** `deriveSpotCost()`, the 2C tier classifier threshold

---

### D-13 · Test/scale split is gated on affordability, not conviction band
**Tag:** [JUDGMENT] [DOMAIN]

**Decided:** The gate pushing a show into the scale tier is **budget**, not band. Conviction orders shows *within* each tier; the band is displayed, not used as the gate.

**Rejected:** Defining scale tier as `band === 'high'` — the intuitive reading of "high-conviction shows you can't afford yet."

**Two independent reasons, both decisive:**

1. **It matches reality.** Modern Wisdom and Diary of a CEO are scale shows because they cost $20–36K for three spots, not because they score differently. Price is what makes them scale.
2. **The band-gate would have shipped a permanently blank tier.** Audience fit is currently pinned to a neutral 50 for every show (demographics are unfetched — see D-25), so the `high` band is unreachable by construction. Had scale been defined as `band==='high'`, the entire scale tier would have rendered empty for essentially every campaign at launch — and it would have looked like a data problem, not a design error.

The second reason was caught during pre-flight schema verification, before any code was written.

**Lives in:** `classifyTier()` — composite + cost gate the split; band is display-only

---

### D-14 · Untrusted cost estimates are not allowed to sort shows
**Tag:** [DOMAIN]

**Decided:** `cost_basis` gates whether cost is permitted to decide the test/scale split. `rate_card` (onboarded, real) and `derived` (downloads × CPM, defensible) are gate-worthy. `flat_fee` (non-onboarded YouTube) is **not** — those shows are classified on conviction alone, shown with a "quote to confirm" range, and excluded from the budget meter's hard sum.

**Rejected:** Treating all cost estimates equally and letting the affordability test run on every show.

**Domain reason:** A flat-fee estimate for a YouTube channel that hasn't onboarded is a guess. Letting a guess sort a channel into "fits your test budget" — or worse, out of it — is a lie dressed as a filter. It would also silently fill a budget meter with a number nobody can honor.

The design carries forward cleanly: when a channel onboards and its basis becomes `rate_card`, it gates like everything else. **No rewrite needed.**

**Lives in:** `classifyTier()` cost-basis gating; `cost_basis` CHECK constraint (migration 028)

---

### D-15 · Read quality and delivery format are real conversion signals
**Tag:** [DOMAIN]

**Decided:** Host personally reads > DAI aggregator format > programmatic insertion. Detectable dynamic-insertion or aggregator format takes a light, non-gating down-weight.

**Rejected:** Treating an impression as an impression.

**Domain reason:** Host-read is the entire model. A host who personally uses the product and reads with personality converts at a different rate than a programmatically inserted spot into the same audience — same downloads, different outcome. Down-weighted rather than excluded because format is not always cleanly detectable in available data, and a false positive shouldn't delete a good show.

**Lives in:** light composite modifier in the scoring layer

---

### D-16 · Returning brands get a check-in, not a prefilled form
**Tag:** [JUDGMENT]

**Decided:** A brand with prior campaigns sees *"Last time I read your customer as X. Anything changed?"* with a "nothing has changed" button, a free-text delta, and an escape hatch to a full new brief.

**Rejected:** Prefilling the previous brief into the form — the obvious implementation.

**Reason:** Direct application of the agentic design test (D-27). Re-asking a brand to re-type what it already told you is mechanical work masquerading as a decision. The only genuinely new information is *the delta*, so that's the only thing worth asking for.

Persistence subtlety that matters: the prior campaign's data is **not copied forward**. Each campaign writes its own pattern row recording what the brand confirmed *for that campaign*. If nothing changed, the new row looks similar — that's correct. Each campaign is its own labeled example, and copying rows forward would corrupt the training data with duplicates.

**Lives in:** `/campaigns/new` returning-brand variant; one `campaign_patterns` row per campaign

---

### D-17 · Rejected rings are filtered before rollup, not after
**Tag:** [JUDGMENT]

**Decided:** Confirmed-ring filtering happens **before** the show-level composite rollup, in both the persist pass and the read path.

**Rejected:** A view-side filter after rollup — the simpler fix, and the one first proposed.

**Reason:** The rollup selects the top-composite ring per show. Filtering after rollup could drop a show whose *top-composite* ring was rejected but which still has a perfectly valid confirmed ring underneath. The brand rejects one customer frame and silently loses a show that qualifies under another.

This surfaced through adversarial review as a money-path issue — a show the brand rejected could reappear as buyable — and was fixed at the correct layer rather than patched at the surface.

**Lives in:** `tierCampaignPortfolio` and `getTieredUniverse` — both filter to confirmed rings pre-rollup

---

## Part II — Transaction, insertion orders, and settlement

*Where the money moves. These decisions came from watching the existing process fail.*

---

### D-18 · Pay-as-delivers, not Net 30 EOM
**Tag:** [DOMAIN]

**Decided:** Card captured on file at IO signature; the brand is charged per verified episode delivery; the show is paid as each episode delivers.

**Rejected:** Replicating the industry standard — monthly invoicing on Net 30 EOM terms.

**Domain reason:** The stated terms are Net 30 EOM. The *actual* behavior is Net 60–75 and worse. **A January ad may not pay until April.** For a show with no finance department, that's a 90-day working-capital loan extended to an advertiser, involuntarily. It's the single most-cited pain on the supply side and it's why small shows won't take unfamiliar advertisers.

Charging per delivery removes the float entirely.

**Lives in:** Stripe Connect Express, SetupIntent at signature, per-delivery charge and payout

---

### D-19 · Payout releases only on `succeeded`, never on `processing`
**Tag:** [DOMAIN] [JUDGMENT]

**Decided:** A show payout never fires until the inbound brand payment has actually settled. Hard rule, no exceptions.

**Rejected:** Releasing on `processing` — faster payouts, better supply-side experience, and the thing a show would ask for.

**Reason:** `processing` is not money. Paying out against it means the platform is carrying float on every deal and eating the loss on any payment that later fails. For a solo-founder company with no balance sheet, a single reversed ACH on a $20K deal is existential. **Zero float risk** is the rule.

Recorded in `CLAUDE.md` as a hard invariant precisely so it can't be softened later for a supply-side win.

**Lives in:** Wave 13 payout gating; documented as a standing invariant

---

### D-20 · The transaction fee sits on the brand side; shows keep 100%
**Tag:** [DOMAIN]

**Decided:** Taylslate's fee is charged to the brand at a transparent tiered rate. The show receives the full negotiated amount.

**Rejected:** A take rate on the show side — the marketplace default. RedCircle takes 30% of host-read revenue; traditional agencies mark up CPM ~15% ($25 becomes $29.41) so the show never sees the real rate.

**Domain reason:** Two effects, both wanted. It makes the fee *legible* — the brand sees exactly what it pays, which is the entire wedge against 15–20% hidden agency markups. And it's a usable supply-acquisition pitch: **"you keep 100% of your host-read revenue"** against RedCircle's 70% is a sentence a show understands immediately, with no explanation required.

**Lives in:** `profiles.platform_fee_percentage` as source of truth; Stripe `application_fee_amount` computed per charge

---

### D-21 · Fee percentage is snapshotted at charge time
**Tag:** [JUDGMENT]

**Decided:** Every payment stores `platform_fee_percentage_at_charge`. The live per-customer rate is never used to recompute a historical charge.

**Rejected:** Reading the current rate from the profile whenever a payment is displayed or reconciled.

**Reason:** A customer upgrading from PAYG (10%) to Operator (6%) would otherwise rewrite the economics of every past transaction on read. Financial history has to be immutable — reconciliation, disputes, and any future audit all depend on the record saying what was actually charged, not what would be charged today.

**Lives in:** `payments.platform_fee_percentage_at_charge`

---

### D-22 · The deal materializes at accept, before the show has an account
**Tag:** [JUDGMENT] [DOMAIN]

**Decided:** Accepting an outreach creates the deal immediately, even if the show has never onboarded. `show_profile_id` is nullable and gets backfilled when onboarding completes.

**Rejected:** Requiring the show to complete onboarding before a deal exists — the clean data-model answer.

**Domain reason:** The show has just said yes. That is the highest-intent moment in the entire funnel, and putting a registration wall between "yes" and a real deal is how you lose it. The commitment should be captured the instant it's given; the account can catch up.

Two structural requirements follow: accept must be **atomic** (the deal is created before the outreach flips to accepted, so a crash can't lose the yes), and a non-catalog accept materializes a `shows` row under a private slug namespace so it can't collide with or hijack a catalog show.

**Lives in:** both accept paths, `resolveOrMaterializeShowIdForOutreach`, `backfillShowProfileOnAcceptedDeals`

---

### D-23 · Accepted non-catalog shows are non-discoverable by default
**Tag:** [JUDGMENT]

**Decided:** A show materialized through the accept path is flagged `is_discoverable=false` and excluded from all shared discovery reads. Promotion into the catalog is a deliberate, unbuilt, post-launch action.

**Rejected:** Auto-promoting accepted shows into the discovery catalog — which sounds like free supply growth.

**Reason:** A show that accepted one brand's pitch has not consented to appear in every other brand's discovery results. Auto-promotion would silently convert a private transaction into a public listing. It also pollutes the catalog with unvetted records that were created as a side effect of a deal, not as curated inventory.

**Lives in:** `shows.is_discoverable` (migration 031)

---

### D-24 · Promo code belongs on the signed IO
**Tag:** [DOMAIN]

**Decided:** Logged as a **real transaction-terms gap**, not cosmetic polish. *(Open — see the master architecture doc.)*

**Reason it's classified that way:** the promo code is part of what the brand and the show actually agree to. The show has to read it on air; the brand's attribution depends on it. **The signed IO is the document of record**, so a term that lives only on the deal record and not on the signed document is a genuine hole in the agreement — which is why it sits in the correctness queue rather than the polish queue.

**Lives in:** `deals.promo_code` (migration 030); IO PDF rendering still open

---

### D-25 · Attribution is honest about what it can't measure
**Tag:** [DOMAIN]

**Decided:** Taylslate positions as a **signal aggregator, not a measurement platform.** Day one: promo codes at IO time, per-deal UTM links, brand-reported attribution. Long term: Podscribe pixel, renewal-as-conversion-proxy, lift studies at $200K+ budgets.

**Rejected:** Claiming attribution the platform can't deliver — the standard pitch in this category.

**Domain reason:** Brands have heard the overpromise from every podcast platform and are skeptical for good reason. The credible position is: *here is exactly what we measure, here is what's hard, here is how we use it.* Against an audience that's been burned, honesty converts better than confidence.

Two domain specifics encoded from practice: the **2x leak rule** (double measured conversions to account for lost codes, search-by-name conversions, and attribution-window expiry — the working rule of thumb among buyers) and **renewal as the strongest available conversion proxy** — a brand that runs 12 months on a show is converting, whatever the dashboard says.

**Lives in:** `lib/io/tracking-link.ts`, `lib/io/show-notes.ts`, `deals.promo_code`

---

### D-26 · IO terms and format mirror the industry standard document
**Tag:** [DOMAIN]

**Decided:** The IO is modeled line-for-line on the VeritoneOne template, with the standard terms encoded as defaults: 90-day competitor exclusivity, 30-day ROFR, make-good on >10% underdelivery, 45-day download tracking, FTC compliance, 14-day cancellation, morality/take-down, Net 30 EOM.

**Rejected:** A cleaner, simpler, first-principles contract.

**Domain reason:** The IO is the document a show's manager or lawyer reads. If it doesn't look like the ones they already sign, it reads as amateur and it slows or kills the deal. Schemas and forms have to match real-world documents — the format is a **trust signal**, not a data structure. E-signature vendor choice followed the same logic: DocuSign was confirmed as Veritone's vendor (their envelope ID is visible on the IO PDFs), so it carries industry trust.

Ad-copy handling is the deliberate exception: **3–5 bullet talking points rather than a full script**, with no pre-approval loop and post-publication verification. Host authenticity is the product being bought; a script destroys the thing the brand is paying for.

**Lives in:** `lib/pdf/io-generator.ts`, IO defaults, DocuSign integration

---

## Part III — Product and interaction

---

### D-27 · Every form field must pass the decision-vs-mechanical-work test
**Tag:** [DOMAIN]

**Decided:** For each field: *is this asking for a decision, or for mechanical work?* Decisions stay manual — budget, campaign goals, competitor exclusions, final sign-off, contract terms. Mechanical work is AI-derived with human confirm/edit — brand name, category, demographics, CPM defaults, episode-count standards, pitch drafting.

**Rejected:** Conventional form design, which asks for everything it can store.

**Reason:** *A product that asks the user to type what it can derive is badly designed.* Human input should be reserved for what the system genuinely can't infer: privileged customer knowledge, business decisions, and confirmation of the system's interpretation.

The canonical implementation is the interpretation checkpoint — the model proposes rings, the brand confirms or refines, then the system runs autonomously through ring location, scoring, sampling, and portfolio construction. **One high-value human decision instead of nine low-value form fields.**

**Lives in:** brief intake, onboarding flows, outreach composer, IO defaults

---

### D-28 · Discovery is never gated on whether a creator has self-onboarded
**Tag:** [DOMAIN]

**Decided:** Non-onboarded shows appear in discovery results with a lighter outreach path. Self-onboarded inventory gets a conviction boost for being immediately bookable, but absence never removes a show.

**Rejected:** Marketplace behavior — only listing inventory that has onboarded.

**Domain reason:** This *is* the neutral-rail wedge, expressed in code. A marketplace is bounded by its own supply; the deal that isn't in the catalog is structurally invisible to it. Taylslate exists to execute **the deal a brand already chose, sourced anywhere.** Gating discovery on onboarding would quietly convert the product into the thing it's differentiated against.

**Lives in:** discovery orchestrator; onboarding status as a scoring input, never a filter

---

### D-29 · Listing fees, featured placement, and pay-to-play discovery — killed permanently
**Tag:** [DOMAIN]

**Decided:** Shows can never pay for placement or ranking in discovery. Marked killed, not deferred.

**Rejected:** An obvious and immediate revenue line, and a standard marketplace monetization.

**Domain reason:** The mission is to get brands spending on shows that convert **and** help under-monetized shows find deals. Paid placement contradicts both halves simultaneously — it corrupts the conviction signal the brand is paying for, and it advantages shows with budget over shows with fit, which are usually the opposite population. The entire long-term data asset depends on the ranking meaning something.

**Lives in:** killed list; no placement or ranking field is purchasable anywhere in the schema

---

### D-30 · YouTube Shorts excluded from launch; long-form YouTube is first-class
**Tag:** [DOMAIN]

**Decided:** Podcast and long-form YouTube are both launch mediums. Shorts is excluded. Simulcast is modeled as one channel with two surfaces.

**Rejected:** Treating all YouTube inventory as one medium; or deferring YouTube entirely to a later phase.

**Domain reason:** Shorts has different read mechanics and no proven conversion playbook for sponsorship — it isn't a volume question, it's a different product. Long-form YouTube, by contrast, runs integrated reads that behave like podcast reads commercially (flat fee typical, $2K–$15K by cultural significance, evergreen).

Simulcast had to be modeled at launch because **most podcasts also upload to YouTube** — treating them as two records would double-count reach and double-charge the brand. The schema (`surfaces`, `medium_priors`) shipped early specifically to avoid a re-migration later, while medium-differentiated scoring math stayed light for launch.

**Lives in:** `shows.platform`, `shows.surfaces`, `shows.medium_priors` (migration 026), simulcast dedup in the orchestrator

---

### D-31 · Test mode and scale mode are different products, not the same UI with bigger numbers
**Tag:** [DOMAIN]

**Decided:** Test mode ships first and completely. Scale mode is a separate, later UX project.

**Rejected:** Treating scale as "test mode with a larger budget."

**Domain reason:** They answer different questions. Test mode answers *"does podcast advertising work for us?"* — single campaign, $20–30K, ~6 shows × 3 spots, diagnostic in shape: which ring converts, which audience, which read style. Scale mode answers *"this works, how do we run it ongoing?"* — recurring monthly spend, annual commitments, portfolio rebalancing, weekly ops. That's Meta/Google ad operations, not campaign discovery.

Building one UI to serve both would serve neither. The bridge is deliberate: **scale-tier shows are surfaced during the test** with "deferred — fits future budget" framing, which educates budget expectations and sets up the Operator upgrade conversation before it happens.

**Lives in:** 2C dual output; scale mode deferred to Wave 15+

---

## Part IV — Data, vendors, and partnerships

---

### D-32 · Vendor selection ruled by contract terms, not data quality
**Tag:** [JUDGMENT]

**Decided:** Podscan primary, Rephonic backup. **Podchaser Pro rejected despite having the best data coverage of any provider evaluated.**

**Rejected and why:**

| Provider | Why rejected |
|---|---|
| **Podchaser Pro** (~$5K/yr) | Best coverage evaluated. ToS prohibits commercial use on the free tier, requires written permission for Pro, and carries a **"competing product" termination clause** — a vendor able to switch off the platform at will, once a data dependency exists. |
| **PodEngine** ($100/mo) | Strong sponsor extraction (563K sponsors). Aggressive competitive restrictions **naming competitors**, with **$50K liquidated damages**. |
| **Listen Notes** ($180/mo) | Commercially friendly terms — but no demographics, no reach estimates, no sponsor history. Missing exactly the fields media buying runs on. |

**Reason:** A data dependency you can be terminated out of isn't an asset, it's a liability with a delay fuse. Choosing the second-best dataset on defensible terms over the best dataset on hostile terms is the correct trade when the dataset sits under the core product.

The same rule blocks **ChannelCrawler** today: negotiate a custom MSA *before* building any dependency, because a B2B license is likely required for commercial use.

**Open item, tracked honestly:** Podscan's ToS page returned 403 during evaluation. A direct conversation with the founder to verify terms is still owed.

---

### D-33 · Every strategic partner contract carries the same five protections
**Tag:** [JUDGMENT]

**Decided:** Mandatory in every vendor agreement — mutual non-compete (the partner cannot build campaign planning, IO/transaction tooling, discovery, or marketplace features), no customer poaching either direction, no using vendor-relationship insight to build competing features, no selling customer data, and change-of-control termination rights if the partner is acquired by a hostile party. Lawyer review on every contract; 6-month pilots before multi-year terms.

**Rejected:** Standard vendor agreements as offered.

**Reason:** The Salesforce/Slack and HubSpot/CRM precedents — a vendor observes what its customer is building and ships it. This gets sharper as the agentic roadmap advances, because exposing Taylslate as a rail makes it *visible* to partners in exactly the way that precedent describes. Contractual prevention has to precede the visibility, not follow it.

---

### D-34 · The pattern library starts empty and seeds only from real campaigns
**Tag:** [OVERRULE]

**Decided:** Ship with an essentially empty library. Seed only real campaigns. Let it grow from actual transactions.

**Rejected:** The earlier plan — and the plan written into the 2A build spec — to seed 20–50 analog campaigns from media-buying memory before launch.

**Reason for the reversal:** **Guessed data creates fake-confident citations.** A seeded-from-memory analog produces reasoning like *"this brand patterns to a Plunge campaign that converted on these shows"* — which reads as evidence, is presented as evidence, and is actually a recollection. Worse, it contaminates the training corpus at exactly the layer where its integrity matters most, and it becomes impossible to separate later from real outcome data.

An empty library is handled honestly by design: when there are no analogs, the prompt instructs the model to reason from first principles and **label all confidence as speculative or low.** A thin honest signal beats a thick fabricated one.

**This reversal overrides a written build spec** and is the clearest instance in the project of choosing data integrity over apparent product quality at launch.

**Lives in:** `campaign_patterns`; empty-library branch in `lib/prompts/interpret-brief.md`

---

### D-35 · Reasoning persistence is non-negotiable on every AI surface
**Tag:** [JUDGMENT]

**Decided:** Every AI decision — brief interpretation, ring hypothesis, conviction score, analog match, sampling decision — writes a structured record. Including surfaces that don't currently seem important.

**Rejected:** Logging only what's needed for the feature at hand.

**Reason:** *Storage is cheap. Lost training data is expensive.* The entire investment thesis is a structured pattern library that compounds with volume — and every campaign that runs without capture is a permanently lost labeled example. The schema is deliberately shaped for what you'd want as training data later, not for what the current UI needs to render.

The contract is fail-soft: these writes **never throw and never block the main flow.** Audit capture must not be able to break a transaction.

**Lives in:** `lib/data/reasoning-log.ts`, `lib/data/event-log.ts`, `domain_events`

---

### D-36 · Podscan demographics stayed unwired — and the reason is a cost question, not an oversight
**Tag:** [JUDGMENT]

**Decided:** `shows.demographics` is empty in production and audience fit is scored on a neutral 50. Logged as the **top discovery-quality item**, deliberately not fixed reflexively.

**Reason it isn't just done:** the wiring is roughly a day — the client, the types, and the paid data access all already exist. The real question is the fetch strategy. Demographics is a **per-podcast endpoint call**, so fetching for every discovery candidate carries a real API-cost and rate-limit budget. Fetch-on-discovery, fetch-on-select, and cache-and-backfill produce meaningfully different cost curves at volume, and the choice is coupled to a second decision — whether to revive or delete the orphaned Wave 5 scorer, since that's the natural home for a rebuilt audience-fit dimension.

Recorded as: *decide keep-vs-rewrite together; don't delete then rebuild.*

**Included here because it documents restraint** — a known-degraded path left in place because the fix has an unresolved cost tradeoff, with the reasoning written down rather than the fix rushed.

---

## Part V — Engineering conventions

*Included for completeness. **Not claimed as distinctive domain authorship** — these are sound practices adopted deliberately, several after a production failure taught the lesson. They evidence engineering discipline, not media-buying expertise.*

---

### D-37 · "Applied" means introspected
**Tag:** [CONVENTION]

A migration counts as applied only when a SQL-Editor introspection query confirms the object exists. Not when the file exists, not when dependent code ships.

**Learned the hard way:** the Wave 13 financial layer (migrations 015/016/018) was recorded as applied but **never ran.** The gap stayed invisible for weeks because the fail-soft and settlement-gated code paths that would have hit it never executed. Reconciled in migration 023.

---

### D-38 · "Committed ≠ deployed" and live proof beats a green test suite
**Tag:** [CONVENTION]

Every layer ends with push → Vercel green → live-URL verification.

**Learned the hard way:** the accept-to-signature loop was recorded in July as live-verified end-to-end. The DocuSign API dashboard showed **zero API calls on the integration key across all of July** — envelope creation had never once executed against the real API. The signature loop first genuinely ran August 4 (sandbox) and August 7 (production). The status record was corrected rather than quietly amended.

---

### D-39 · Sentinel-row idempotency over Postgres advisory locks
**Tag:** [CONVENTION]

A row's atomic visibility is the completion sentinel. **Reason:** PostgREST connection pooling breaks session affinity, so advisory locks can't be relied on to be held by the same session that took them. Crash-orphaned locks expire by TTL.

---

### D-40 · Never `WHEN OTHERS`
**Tag:** [CONVENTION]

PL/pgSQL exception handlers catch specific conditions — `WHEN foreign_key_violation`, not `WHEN OTHERS`. A blanket catch converts a real error into silent wrong behavior, which is strictly worse than a loud failure.

---

### D-41 · `LLM_MAX_RETRIES` stays at zero
**Tag:** [CONVENTION]

Claude API calls are not wrapped in retry loops. **Reason:** a retried call can push worst-case duration past `LOCK_TTL_MS`, at which point the lock expires mid-operation and two workers proceed concurrently. The retry is the thing that causes the corruption it appears to protect against.

---

### D-42 · Idempotent migrations, pasted by hand, never re-run
**Tag:** [CONVENTION]

Every migration uses `IF NOT EXISTS` / `DROP … IF EXISTS; CREATE …` / `CREATE OR REPLACE` throughout, because migrations are pasted into the Supabase SQL Editor and a partial failure would otherwise break a naive re-run.

---

### D-43 · Data API grants on every new public table
**Tag:** [CONVENTION]

`service_role` and `authenticated` grants are mandatory on every new `public` table, placed before the RLS block. `anon` is granted SELECT on exactly two public-facing tables and never on deals, payments, or pattern-library data. Anticipates the Supabase Data API change enforced October 30, 2026.

---

### D-44 · Adversarial review between every layer
**Tag:** [CONVENTION]

Each build layer goes through self-review, then independent adversarial review by a second model, with findings triaged in plain English against intended design. Findings are either resolved or **accepted in writing with a stated reason** — never silently dropped.

Two accepted-with-reason examples, both documented: the promo-code cleared-state display ambiguity (accepted; ~99% of codes match the show name anyway; fix path recorded) and migration 032's introspection-based CHECK drop (accepted; already applied in production, and safer than guessing an unnamed constraint's name).

---

### D-45 · Non-ASCII tripwire on generated code
**Tag:** [CONVENTION]

`grep -P '[^\x00-\x7F]'` runs across generated migration and TypeScript files before commit, confirming no non-ASCII characters reach the codebase.

---

## Summary — the shape of the authorship claim

| Category | Count | What it evidences |
|---|---|---|
| **[DOMAIN]** | 19 | Decisions originating in media-buying experience. Not derivable from general-purpose tooling. |
| **[OVERRULE]** | 6 | Documented instances of the founder correcting the framework, a model, or a written spec on domain grounds. |
| **[JUDGMENT]** | 13 | Tradeoffs surfaced during build, decided and owned by the founder. |
| **[CONVENTION]** | 9 | Sound engineering practice, deliberately adopted. Not claimed as distinctive. |

*(Entries carrying two tags are counted under each.)*

**The claim this log supports** is not "I typed the code." It is that the system's commercial logic — what discovery returns and why, what a show costs, when a payout releases, which vendor terms are acceptable, what gets refused revenue — was specified by someone who has bought podcast media and knew what the market would and wouldn't accept.

The six **[OVERRULE]** entries are the load-bearing ones, because each records a case where the obvious or automated answer was rejected for a domain reason, with the reasoning written down at the time:

- **D-02** — rings are product-determined, correcting the framework's score-derived design
- **D-03** — three-dimensional conviction, correcting a topical-relevance-heavy model
- **D-04** — demographics over topical relevance, evidenced by three specific show picks the framework would have cut
- **D-05** — purchase power non-gating, because the proxy was wrong on a show that converts
- **D-11** *(D-04's counterpart)* — founder picks captured as training data rather than absorbed as weight nudges
- **D-34** — empty pattern library over a seeded one, overriding a written build spec, choosing data integrity over apparent launch quality

Two further entries are included specifically because they document **cost and restraint rather than success**: D-07, which records a design stance whose failure case was written down in the founder's own words before it was resolved, and D-36, which records a known-degraded path deliberately left in place because the fix carries an unresolved cost tradeoff.

---

*End of log.*
