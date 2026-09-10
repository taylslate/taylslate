# Decision index

Compiled September 9, 2026. This index points into the existing history instead of rewriting it. Historical choices below are attributed to their source records. Review triggers are compilation suggestions unless the source itself specifies one.

Primary history: [Architectural Decision Log, D-01–D-45](../docs/architecture-logs/TAYLSLATE_DECISION_LOG.md). Pricing has its own [decision record](../PRICING_DECISIONS.md). The architectural log was compiled August 19 and is not a complete current company decision ledger.

| Choice | Rationale preserved | Source | Status / revisit |
|---|---|---|---|
| Execute chosen deals sourced anywhere | A marketplace's catalog cannot contain every direct relationship | Master architecture §1.3, §4.1 | Latest documented wedge; validate pain and switching behavior with actual buyers |
| PAYG → Operator → Agency | Low-friction testing followed by better economics for sustained use | Pricing decisions: Philosophy, Rejected Models, Conversion Mechanic | Documented pricing; Operator revisit at month 3–6/first customer evidence |
| Budget changes sampling, not audience hypotheses | Product/customer fit exists independently of campaign spend | D-02 | Documented principle |
| Three conviction dimensions, AOV-sensitive weighting | Topic alone misses commercially relevant audiences | D-03–D-04 | Documented; calibrate against measured evidence |
| Purchase power is non-gating; brand safety is surfaced | Weak proxies should not make the buyer's judgment for them | D-05, D-07 | Documented principles |
| Three-spot testing; test/scale distinction | Repetition supports testing; ongoing operation is a different customer job | D-12–D-14, D-31 | Keep rationale; September floor/selection changes supersede older gating details |
| Remove the conviction floor | A real run returned one show from 63 candidates; weak inputs made exclusions arbitrary | Calibration Sep 7; commit `07e30cc` Sep 8 | Implemented; live deployment not verified in this audit |
| Reject removing ring-reasoning tokens | Recompute harmed genuine matches without fixing the motivating irrelevant match | Calibration Sep 9; commit `82173a7` | Rejected experiment; preserve measured results instead of repeating the patch |
| Pay per delivery; fee on brand side; snapshot fee | Improve payment workflow, protect show economics, preserve charge history | D-18–D-21 | Documented design; full charge/settlement proof remains separate |
| Materialize deal at acceptance, even before onboarding | Agreement exists before the show creates an account | D-22–D-23 | Documented; avoids losing accepted non-catalog deals |
| Honest attribution | Observable signals do not capture all conversions | D-24–D-25 | Documented; distinguish measured data, heuristic estimates, and causal claims |
| Human decisions; AI handles mechanical work | Keep judgment while reducing repetitive input | D-27; current Company Brain conversation | Current founder principle; task permissions still govern execution |
| No paid discovery placement | Selling rank would undermine allocation and trust | D-29 | Explicitly killed; not a future monetization idea |
| Real campaign evidence only in pattern library | Memory-seeded analogs can become fake-confident citations | D-34 | Explicit reversal of earlier seeding plan |
| Persist reasoning at every AI surface | Missing transaction/reasoning data cannot be recovered later | D-35 | Documented product requirement |
| Vendor choice considers contractual dependency | Data quality is insufficient if vendor terms can undermine the business | D-32–D-33 | Historical evaluation; executed terms and current permissions not established here |
| Ship transaction workflow before public MCP | The valuable exposed capability is execution, not another search interface | Master architecture §4.2, §4.8 | Documented sequencing; not reversed by the new Company Brain initiative |
| Founder writes first-touch outreach | Relationships are a founder responsibility in the documented sales motion | Master architecture §4.4 | Standing preference; AI-role discussion has not explicitly superseded it |

## Recovered validation rationale

[CB-E-001 — July 22 session](evidence/2026-07-22-validation-session.md), supplied by Chris on September 9, provides a direct source for the chosen-deal wedge, the initial existing-direct-buyer focus, the signal ladder, founder-assisted first-campaign offer, and transaction-before-funding sequence. It is a historical session summary, not customer outcome evidence or new approval to execute its recommendations. Its July live-signature claim is superseded by later proof corrections.

## Recording the next decision

Use the template in [MAINTENANCE.md](MAINTENANCE.md). Assign `CB-D-001` onward for new cross-functional decisions, preserving existing `D-xx` IDs. A proposed decision is not founder-approved merely because an AI writes it here. Link both the prior and superseding records when a choice changes.
