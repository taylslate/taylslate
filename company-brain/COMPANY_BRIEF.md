# Company brief

Internal synthesis, September 9, 2026. “Documented” describes what existing records say; it is not new founder approval or independent verification. See [conflicts and gaps](GAPS_AND_CONFLICTS.md) before using this for decisions or public claims.

## Company and strategy

**Documented mission:** Help brands put more sponsorship spend into shows that convert and help underserved shows win deals. Taylslate aims to reduce the manual research, negotiation, contracting, and payment work around podcast and long-form YouTube sponsorships. Founder Chris Taylor brings media-buying experience; the slow agency workflow is the documented origin of the product. Sources: [context §1–3](../TAYLSLATE_CONTEXT.md), [master architecture §1](../docs/architecture-logs/TAYLSLATE_MASTER_ARCHITECTURE.md).

**Latest documented wedge:** Execute the deal a brand chose, regardless of where the show was sourced, with transparent economics. Discovery supports that workflow. The longer-term thesis is a transaction and reasoning dataset that improves recommendations as real deals run. There is no evidence in this audit of an already-established data moat. Source: master architecture §1.2–1.3, §4.1.

**Latest documented launch sequence:** Prove the minimum transaction workflow, polish the prospect-facing surfaces that matter, demo and sell, secure a real transaction, then decide whether to raise. The records say signing/card capture and email verification are complete; charge/settlement remains a separate unproven step. This is the recorded sequence, not a newly prioritized build plan. Sources: master architecture §4.8, [STATUS](../STATUS.md).

## Product

**Intended brand journey:** describe the product and campaign → confirm AI interpretation and audience hypotheses → review scored shows and test/scale options → choose shows → build a media plan → send outreach → agree terms → sign IO → save payment method → delivery, charge, and payout.

**Intended show journey:** receive pitch → accept/counter/decline → onboard as needed → sign → deliver → receive payment. Sources: master architecture §3.5 and [wave history](../docs/WAVE_HISTORY.md).

| Capability | Evidence status at compilation |
|---|---|
| Interpretation, conviction reasoning, portfolio UI, founder annotations, brand history, promo-code capture, UTM links, show-notes blurb | Phase 2 work reported complete in STATUS; specific limitations remain |
| Signing → card-on-file | Sep 3 live proof recorded; does not prove charges/payouts |
| Outreach email authentication and sender name | Sep 3 live verification recorded in STATUS |
| No conviction cutoff; broader selectable results | Implemented in Sep 8 commit; deployment not checked here |
| Demographics hydration before scoring | Implemented in Sep 9 commit; deployment and migration 035 application not checked here |
| Automatic verification via Podscribe | Planned; existing docs describe an internal delivery-marking path |
| Full scale-mode operations, agent/rep UX, public MCP, creator-attached extra surfaces | Future work; do not advertise as available |
| Long-form YouTube | Part of product scope and enrichment architecture; STATUS calls current discovery podcast-only. End-to-end YouTube availability needs verification |

Sources: [STATUS](../STATUS.md), [proof](../PILE_A_PROOF.md), [source map code evidence](SOURCE_MAP.md), [backlog](../PRODUCT_BACKLOG.md). Pricing-plan descriptions do not independently prove feature availability.

## Customer and GTM

**Broad ICP on record:** founder- or growth-led brands, historically described as new to creator advertising with $30K–$50K monthly campaign budgets. **Later validation ICP:** reachable decision-maker, deliberately chosen host-read shows, repeat buying, enough manual operational pain to switch. The supplied [July 22 validation session](evidence/2026-07-22-validation-session.md) establishes that existing direct buyers were the initial validation focus. This clarifies the historical sales priority without permanently replacing the broader market definition. Sources: that session and master architecture §1.4.

**Working job-to-be-done, synthesized from those sources:** “Help me execute a sponsorship buy without weeks of coordination, while retaining control over the shows, terms, and budget.” This is an AI synthesis, not a customer quote.

**Documented sales motion:** understand the buyer's present workflow, demonstrate against that pain, then ask for a real next campaign with a budget/date. Warm introductions precede broad cold activity. Chris writes first-touch outreach personally. The signal ladder moves from stated interest to demonstrated pain, scarce time or introductions, campaign commitment, and repeat transactions. Source: master architecture §4.3–4.6.

**Historical prospect candidates:** ARMRA, Grüns, Momentous, CookUnity, Good Ranchers, Tecovas, Supersure, Vaer. These are a documented target list, not verified active opportunities. SaunaBox is described as a design-partner/media-buying relationship, not proof of Taylslate subscription revenue. Current contact status and permissions were not checked.

**Evidence gap:** No dedicated customer interview archive, live CRM pipeline, win/loss log, or completed GTM experiment ledger was located. Product calibration examples are not equivalent to willingness-to-pay evidence.

## Brand, marketing, and market

Recorded messaging evolved from campaign generation to discovery, then sponsorship execution and a neutral transaction rail. The latest synthesis retains several older one-liners. Treat “the deal a brand already chose, executed transparently” as the latest documented wedge, not a finalized brand slogan. Wordmark work is described as in progress. No approved voice guide or claims register was found. Sources: master architecture §1.3, §4.1, §5.7; context §2.

Competitor research exists for SpotsNow, agencies, LiveRead, Gumball, RedCircle, and others. It is dated internal research, not refreshed market intelligence. In particular, competitor settlement capabilities remain an explicit open question. Before using comparisons, market sizes, vendor prices, or performance claims externally, verify the specific claim and its source. No web research was performed for this organizational audit.

## Operations and tools

The documented product stack includes Next.js, Supabase, Vercel, Claude API, Podscan, YouTube Data API, DocuSign, Stripe, and Resend. Engineering has a comparatively mature process: conventions, tests, independent review, migration introspection, and live-proof records. Source: [CLAUDE.md](../CLAUDE.md), master architecture §3.

Earlier strategy names Monaco and Okara for GTM; later strategy emphasizes manual founder sourcing and mentions Podscan Sponsor Alerts. An actual account inventory, current subscriptions, integrations, and monitor status were not checked. Do not interpret a named tool as installed, paid, or actively operating.

No consolidated support SOP, incident/customer communication process, recurring operations calendar, or vendor renewal register was located. Existing code and transaction runbooks can seed those records later.

## Pricing, metrics, finance, and legal

**Documented commercial prices:** PAYG 10% transaction fee; Operator $499/month + 6%; Agency $5,000/month + 4%. The fee is on the brand side. Entry without a subscription supports testing; the Operator upgrade is intended to improve economics and retention at sustained spend. These are pricing decisions, not verified current billing for every account. Source: [pricing decisions](../PRICING_DECISIONS.md), decision log D-20–D-21.

The historical forecast and Operator conversion target are assumptions, not actual results. This audit did not establish MRR, GMV, paying customers, burn, runway, CAC, churn, or retention. Unknown is not zero. A formal KPI dictionary and reporting system were not located. Event logging and GMV helpers provide implementation foundations; they do not establish a complete company analytics function.

The documents contain IO terms, payment controls, vendor-selection rationale, and an intended aggregated-data usage policy. No executed vendor-contract archive, company legal-entity record, approved policy set, or current financial statements were located in this inventory. Desired contract protections are not proof of signed protections. Sources: context §3, decision log D-18–D-26 and D-32–D-33.

**Attribution boundary:** Promo codes, UTM links, reported outcomes, and repeat buys are signals. The documented “2x leak rule” is a heuristic; preserve any adjusted estimate separately from measured conversions. Do not report it as observed revenue or validated causal lift. Source: decision log D-25.
