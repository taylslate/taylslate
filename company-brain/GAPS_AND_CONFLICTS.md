# Gaps and conflicts

Recorded September 9, 2026. This is an audit queue, not a new product roadmap. Source documents were preserved. A proposed resolution below does not approve a business change.

## Concrete conflicts

| ID | Conflict | Treatment and next evidence needed |
|---|---|---|
| C01 | AGENTS/context say Phase 2 is next; STATUS records Phase 2D complete July 6 | Use STATUS for recorded delivery state. Keep early descriptions as historical design context. |
| C02 | STATUS lists both 1,029 and 1,070 tests; newer commits add tests | Neither is a freshly verified current total. Update after the next actual suite run; no test run was needed for this documentation audit. |
| C03 | Backlog/architecture/decision D-36 say demographics are unwired; Sep 9 commit `8143155` implements hydration | Code establishes implementation. Production deployment, data coverage, and migration 035 introspection remain unverified here. Existing uncommitted matching/backfill work may affect this. |
| C04 | STATUS calls conviction-floor removal uncommitted; Sep 8 commit `07e30cc` records it | Committed implementation supersedes that label. Do not infer deployment. Old medium-floor and stale-tier assumptions are historical. |
| C05 | PILE_A_PROOF header says A5/A6 open; later STATUS/master records both verified Sep 3 | The separate later records establish documented closure. Preserve distinction between A1–A4 proof and A5/A6 evidence. |
| C06 | Older context claims full paid flow; newest proof stops at card-on-file | Live charge and settlement are explicitly unproven in the latest records. Do not call the full money movement verified. |
| C07 | CLAUDE describes DocuSign production as gated; STATUS records production live and brand embedded signing proven | Use the later specific proof. Separate brand embedded signing from any future show-side signing upgrade. |
| C08 | Initial plan seeds 20–50 analogs from memory; D-34 explicitly reverses it | Decision D-34 controls: real campaigns only. Recollections may be labeled qualitative evidence, never manufactured outcome records. |
| C09 | Original ICP is brands new to podcast; later ICP requires repeat chosen-show buys and existing pain | Historically clarified by user-supplied CB-E-001: July initial validation targeted existing direct buyers with repeat pain. Keep that dated sales focus distinct from the broader market definition; no new campaign is authorized. |
| C10 | Older positioning centers discovery; July strategy centers execution of deals sourced anywhere | Preserve the documented evolution. Latest wedge is execution; final public message and the initial offer remain to be confirmed. |
| C11 | Long-form YouTube called first-class; STATUS calls discovery podcast-only and notes pricing mismatch | Verify actual supported journey before making a launch-availability claim. Scope intent is not shipped capability. |
| C12 | Backlog calls broad pre-launch work mandatory; later launch sequence limits work to the minimum sellable workflow and relevant polish | Record the later sequencing, but do not automatically reclassify every backlog item. Confirm the short launch checklist before executing it. |
| C13 | Pricing lists API, white-label, analytics, verification benefits also described as future | Separate commercial plan design from delivered entitlements before writing a pricing page or sales proposal. |
| C14 | Old documents describe Codex as primary builder and Codex API; current user says Claude Code primary, Codex review | Current user instruction controls the founder workflow. CLAUDE and newer architecture identify Claude API for product AI. |

Sources: [source map](SOURCE_MAP.md). File modification timestamps alone were not used to settle substantive conflicts.

## Coverage across the company

| Area | What exists | Missing or not established locally |
|---|---|---|
| Company | Mission, founder story, strategic evolution | Current measurable business goals and planning horizon |
| Product | Rich specs, backlog, status, proof, calibration | Concise verified capability/entitlement matrix; reconciled launch checklist |
| Customer | ICP reasoning, design-partner references, founder examples | Original interviews, buying objections, win/loss evidence, current pipeline |
| GTM | Wedge, named historical targets, sales motion, signal ladder | Actual outreach/conversation outcomes and experiment results |
| Brand/marketing | Positioning history, design direction, UI tokens | Approved voice, final identity, claims register, reusable asset index |
| Competition | Dated competitor/vendor analyses | Current substantiation and unresolved competitor settlement question |
| Operations/support | Engineering workflow and transaction proof procedures | Business tool inventory, renewal dates, support SOP, recurring task owners |
| Metrics | Pricing conversion thesis, event/GMV implementation foundations | KPI definitions, actual values, source systems, reporting cadence |
| Finance/legal | Pricing rationale, forecast, intended IO/vendor/data policies | Actual costs/revenue, financial model inputs, approved policies, executed agreements and entity details in a permissioned system |
| Decisions | 45 indexed architecture decisions and pricing rationale | Ongoing cross-functional decision capture with effective dates and revisit triggers |

## Highest-value next inputs

1. **Validation source gap substantially closed.** Chris supplied the July 22 session summary, now preserved as [CB-E-001](evidence/2026-07-22-validation-session.md). It matches the referenced subject matter; the original filename remains unverified and does not need recovery.
2. **Capture subsequent outcomes.** The July record identifies existing direct buyers and a founder-assisted first campaign as the validation focus and offer. It does not tell us which calls, commitments, or transactions happened afterward. Record real outcomes when available rather than asking Chris to repeat the historical strategy.
3. **Locate actual business records.** Current customer/conversation status, revenue/cost records, and any brand/legal assets may already exist outside this repository. Record their location before creating replacements.
4. **Reconcile technical status during the next engineering wrap-up.** Record deployment, migration 035 introspection, and live verification for September work; refresh stale summaries from evidence.

The initial audit used repository sources; subsequent updates include local source discovery and user-supplied CB-E-001. No new business policy was approved by this compilation.
