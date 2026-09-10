# Source map

Audit date: September 9, 2026. Scope: documentation in this repository, a filename inventory including hidden files outside dependencies and Git internals, recent Git history, and targeted discovery code inspection. No external accounts, chat histories, production databases, or legal/financial systems were queried. “Not found” means not found in this repository inventory, not that it does not exist elsewhere.

## Sources by role

User-supplied follow-up: [CB-E-001 — July 22 validation session](evidence/2026-07-22-validation-session.md) now supplies the business substance of the previously missing validation reference. Preserved as a dated business-only synthesis with original-attachment provenance; original filename remains unverified.

| Source | Best use | Date and reliability notes |
|---|---|---|
| [STATUS.md](../STATUS.md) | Recorded build state, migration verification, live-proof frontier | Header Sep 3, later Sep 7 entries. Contradictory test totals and older sections remain. Latest code is newer. |
| [PRODUCT_BACKLOG.md](../PRODUCT_BACKLOG.md) | Work queue, accepted deferrals, killed ideas | Header July 23; entries/history through September. Not every old item has been reconciled. |
| [Master architecture](../docs/architecture-logs/TAYLSLATE_MASTER_ARCHITECTURE.md) | Broadest company synthesis; especially §1 positioning/ICP and §4 GTM | Updated through Sep 3; incorporates July validation and August launch priorities. Some technical assertions are now stale. |
| [Architectural decision log](../docs/architecture-logs/TAYLSLATE_DECISION_LOG.md) | D-01–D-45: choices, rejected alternatives, rationale | Compiled Aug 19, covers March–August. Retrospective authorship-oriented synthesis; supporting original records are not all local. |
| [TAYLSLATE_CONTEXT.md](../TAYLSLATE_CONTEXT.md) | Founder background, mission, discovery thesis, pricing rationale, historical strategy | Header June 1. April build/launch sections are historical. July strategy in master architecture is later. |
| [PRICING_DECISIONS.md](../PRICING_DECISIONS.md) | Commercial tier decisions, rejected pricing models, upgrade logic | April 28. Feature descriptions and forecasts are not proof of shipped entitlements or actual revenue. |
| [SCORING_CALIBRATION.md](../SCORING_CALIBRATION.md) | Observations, measured scoring experiments, rejected changes | Entries through Sep 9. Read dated entries in order; June defaults were later changed. |
| [PILE_A_PROOF.md](../PILE_A_PROOF.md) | Specific signing/card capture proof and original automated checks | Sep 3 A1–A4 live evidence. Header still says A5/A6 open; later STATUS records their separate closure. Contains operational identifiers; restrict sharing. |
| [PILE_A_INVENTORY.md](../PILE_A_INVENTORY.md) | Historical verification plan and implementation inventory | August scope; later proof supersedes open-state claims. |
| [CLAUDE.md](../CLAUDE.md) | Engineering context map, conventions, operational lessons | Restructured July 6, modified Aug 25. Some volatile vendor status leaked into this otherwise stable reference. |
| [AGENTS.md](../AGENTS.md) | Applicable repository instructions and older product context | Header April 30. Product state, model/provider names, and workflow descriptions have drifted. Current user instructions take precedence. |
| [WAVE_14_STRATEGY.md](../WAVE_14_STRATEGY.md) | Why discovery became interpretive; founder campaign walkthrough | June 1 historical design rationale. Later reversals must be retained. |
| [Phase 2A](../docs/WAVE_14_PHASE_2A_SPEC.md), [2B](../docs/WAVE_14_PHASE_2B_SPEC.md), [2C](../docs/WAVE_14_PHASE_2C_SPEC.md) | Detailed intended implementation and original tradeoffs | Historical specifications; use commits and current code to establish implementation. |
| [WAVE_HISTORY.md](../docs/WAVE_HISTORY.md) | Build chronology and dated integration references | Historical archive through July; not the current frontier. |
| [Future feature roadmap](../docs/FUTURE_FEATURE_ROADMAP.md) | Creator surfaces and longer-term expansion thesis | June 11; ideas and sequencing, not commitments to customers. |
| [TECHNICAL_SPEC.md](../TECHNICAL_SPEC.md), [README.md](../README.md) | Early specification and development entry point | Early spec and framework README; not company-state authorities. |
| [Podscan API reference](../docs/podscan-api.md) | Stored API reference | April snapshot; verify against vendor documentation when changing integrations. |
| [Combined Channel Roster.csv](../Combined%20Channel%20Roster.csv) | Potential founder/supply research evidence | Located, contents not analyzed in this pass. Do not assume consent, currency, or actual campaign outcomes. |
| [Application prompts](../lib/prompts/) | How product AI is instructed | Product implementation artifacts, not instructions for operating this company or proof of successful reasoning. |

The main synthesis was drawn from company context, pricing, master architecture, decision log, status, backlog, and calibration sections. Historical specs, wave history, vendor reference, and roster were inventoried rather than exhaustively audited. No codebase review is claimed.

## Recent implementation evidence

| Commit | Observed change | What it does not establish |
|---|---|---|
| `07e30cc` · Sep 8 | Removes conviction floor; affordability warns instead of excludes; captures selection signals | Deployment or fresh live portfolio verification |
| `8143155` · Sep 9 | Adds pre-scoring demographics hydration and brand target-audience wiring; includes migration 035 | Whether migration 035 was applied or production hydration succeeded |
| `82173a7` · Sep 9 | Records measured rejection of ring-reasoning token exclusion | A scoring algorithm change; this experiment was rejected |

Code spot-check: [conviction-discovery.ts](../lib/discovery/conviction-discovery.ts) invokes [hydrate-demographics.ts](../lib/discovery/hydrate-demographics.ts) before scoring. It tries stored demographics first, then the API, and degrades when data is unavailable. This supersedes “no demographics fetch exists” as an implementation statement.

Pre-existing uncommitted changes were observed in `lib/enrichment/podscan-match.ts`, its test, and `scripts/backfill-show-demographics.ts`. They belong to ongoing work and were not modified or treated as deployed functionality in this audit.

## Referenced sources missing locally

- `TAYLSLATE_VALIDATION_WORKING_DOC.md` — original filename still unverified; substantive content supplied by Chris and indexed as [CB-E-001](evidence/2026-07-22-validation-session.md). Recovery is no longer an open dependency.
- `TAYLSLATE_AGENTIC_ROADMAP.md` — recovered in Downloads during the follow-up below; not yet imported or fully reviewed.
- Claude Design “Document B” and “Conviction C,” plus current wordmark direction — referenced in master architecture §5.7; source assets not found in the document inventory.
- Original April scoring observations — calibration log explicitly says they may live in the Claude.ai workspace.
- Original validation conversations, interview transcripts, and the full assumption model behind pricing projections — not located as dedicated records.

Recover originals into a suitable shared location, record provenance, then update this map. Do not recreate missing conversations as if they were original evidence.

## Local recovery follow-up — September 9, 2026

Chris does not recognize the validation filename or know its location. A filename search of Documents, Downloads, and Desktop, plus repository history for validation-named files, found no matching validation document. Its name is present in the master architecture's “Compiled from” list and Appendix C, but its existence as a separately saved original remains unverified. It may refer to unsaved conversation material or be an inaccurate reference; neither explanation is established. This is not a blocker or a task Chris must solve.

Additional sources found outside the repository (filenames/headings inspected, not fully reviewed or imported):

| Local source | Potential use | Treatment |
|---|---|---|
| [Agentic roadmap](/Users/christaylor/Downloads/TAYLSLATE_AGENTIC_ROADMAP.md) | Product agents and agent-ready infrastructure | Dated April 27; historical roadmap, not a current company-agent architecture |
| [Brand brief](/Users/christaylor/Downloads/TAYLSLATE_BRAND_BRIEF.md) | Personality, voice, typography, identity directions | File modified June 26; design brief, approval/current status not established |
| [Founder execution notes](/Users/christaylor/Downloads/TAYLSLATE_FOUNDER_EXECUTION_NOTES.md) | Early customer acquisition and founder operating advice | Dated April 23; advice is not evidence that its recommendations were adopted |
| [Pricing preparation](/Users/christaylor/Downloads/taylslate_pricing_strategy_prep.md) | Alternatives before the April 28 pricing decision | Historical inputs; later pricing decision controls |
| [Market summary](/Users/christaylor/Downloads/taylslate-market-summary.md) | Earlier market and competitor research | April snapshot; claims unverified |
| [Early strategy](/Users/christaylor/Downloads/TAYLSLATE_FINAL_STRATEGY_v2.md) | Earlier plans and assumptions | January file; “FINAL” in its name does not establish current authority |

Other company-named files include product specifications, logo assets, and legal/tax PDFs. Their contents were not opened in this follow-up. Sensitive originals remain outside the general Company Brain. These absolute links are local pointers and will not work on another computer unless those sources are deliberately shared.
