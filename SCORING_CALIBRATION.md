# Scoring Calibration Log

Running log of conviction-scoring (Wave 14 Phase 2B) quality observations against
real campaigns, and the deferred fixes they point to. Conviction scores are
**blunt by design** at launch (see `CLAUDE.md` and `docs/WAVE_14_PHASE_2B_SPEC.md`
§6–7); this file records where the blunt edges show on real data and which
*deferred* item sharpens each — so we tune the cuts against evidence, not vibes.

> **History note (June 23, 2026):** No prior `SCORING_CALIBRATION.md` was found in
> this repo or its git history when this file was created, despite earlier
> flat-scorer ("Test Campaign 1") observations being referenced in the 2B spec.
> Those April notes likely live outside the repo (Claude.ai workspace). If
> recovered, prepend them above this section — this file was started fresh, not
> by clobbering an existing one.

---

## Launch-known, deferred (do NOT fix in 2B)

First real conviction run — campaign `52d0a559-…` (protein snacks / functional
food, mid AOV), June 23, 2026. The machinery (discovery → genre-exclude →
simulcast → PP fill → score → band → persist) is correct; these three are the
known blunt edges, each tied to an already-deferred item. **Recorded, not fixed.**

1. **Topical relevance over-fires at 85 on a single shared category token.**
   - Observed: a food/comedy show ("The Sporkful") scored topical 85 against a
     "daily-stack supplement buyers" ring purely on a `food` token overlap, and
     nearly all health/fitness shows clustered at 85. The lexical matcher's
     "direct match → 85" is too generous, and because it keys off the ring
     **label's** surface tokens, ring distribution skews (the primary ring drew 1
     show while a lateral whose label contains "fitness" drew 31).
   - Deferred fix: **Podscan vector adjacency** (semantic similarity) to replace/
     augment the lexical matcher. Explicitly out of scope for 2B —
     `lib/scoring/conviction.ts` stays lexical-only (see its header note).

2. **Audience fit is a flat 50 for every discovered show, capping everything at `medium`.**
   - Observed: no show reached `high` band. Discovered shows carry empty
     demographics, so audience fit honest-degrades to neutral 50; the `high`
     convergence guard needs two dimensions ≥70, which 50 can never satisfy. The
     result is a flat band of `medium` 67–68 across the universe.
   - Deferred fix: **demographics enrichment** for discovered shows (Podscan /
     third-party). Out of scope for 2B; audience fit stays degraded at launch by
     decision.

3. **Purchase-power proxy mislabels personal-development shows as high (80).**
   - Observed: motivational / personal-dev shows ("Daily Motivational Positivity",
     "The Dream Bigger Podcast") scored PP 80 because their category set includes
     `business` → high tier, though their audiences aren't necessarily affluent.
   - Deferred fix: **category-proxy calibration** (refine the §6 mapping — e.g.
     down-weight `business` when it co-occurs with personal-dev / motivation
     signals). Calibration only; PP stays a blunt, non-gating dimension for 2B.

---

## Phase 2C — test/scale tier defaults (June 24, 2026)

First-pass tier-classifier constants (`lib/discovery/tier-portfolio.ts`). Shipped
as defaults; **calibrate the cuts against real campaigns, don't over-engineer
relative-within-campaign banding** (spec §"Tier + threshold logic").

- `THREE_SPOT_THRESHOLD = 0.25` — a show's 3-spot cost must be ≤ 25% of the
  campaign budget to be **affordable** (→ test); over → scale. The 3-spot test
  floor (99% of podcast tests). Override per campaign if the brand opts out.
- `MIN_TEST_SHOWS = 3` — below this many test shows → `test_underfilled`, so
  Layer 4 surfaces tight-budget UX (single-spot / raise-budget) instead of an
  empty primary section.
- `MEDIUM_FLOOR` — **reuses** `BAND_MEDIUM_COMPOSITE` (= 50) from
  `lib/scoring/conviction.ts`, not a forked constant. Composite < 50 → bench.
- **Tier gate is affordability + composite, NOT the conviction band.** Pre-flight
  Flag 7: audience-fit is pinned to a neutral 50 at launch (deferred item #2
  above), so the `high` band is structurally unreachable — a band gate would
  render scale empty. Revisit and tighten to band-aware once demographics
  enrichment decompresses the bands.
- **Cost confidence gates whether cost decides the split.** `rate_card` /
  `derived` are gate-worthy (affordability runs); `flat_fee` (non-onboarded
  YouTube) is conviction-only — its price is an untrusted guess, so it never
  sorts a channel into scale on cost. Flips to gate-worthy automatically when the
  channel onboards (`flat_fee` → `rate_card`), no code change.
- **Rounding (Codex gate):** `dollarsToCents` rounds half-UP with a
  magnitude-scaled epsilon so IEEE-754 half-cents (e.g. `(200093/1000)×35` =
  $7003.255) don't silently round a cent low at the affordability boundary.

---

## The medium conviction floor was REMOVED (September 7, 2026)

Evidence: campaign `a55b7e2b` (SaunaBox®, $10K, 4 confirmed rings) returned **1
show from 63 candidates** — 62 died at the medium band floor (composite ≥ 50).
Two reasons the cut was unjustified *on today's data*, both open calibration items
above: (2) audience fit is pinned at a flat neutral 50 catalog-wide (demographics
empty), so composites cluster in a narrow band and the floor cuts arbitrarily
inside the cluster; and the affordability inputs are Podscan CPM estimates found
unreliable, so a cost-based exclusion filters on noise.

Change (honors the locked discovery philosophy — *return more results, not fewer;
the brand narrows down; curation happens in sort order, not cutoff*):

- **Persist every scored candidate**, no lower bound. Removed the
  `isMediumOrAbove(score.band)` gate in `scoreCandidatesAgainstRings`
  (`lib/discovery/conviction-discovery.ts`). Composite is now purely the SORT key.
- **`classifyTier` no longer benches on composite.** Removed Gate 2
  (`composite < MEDIUM_FLOOR → dropped`) and the `MEDIUM_FLOOR` constant
  (`lib/discovery/tier-portfolio.ts`). Tier is now: `needsQuote → bench`, else
  affordability decides test vs scale. **Bench = un-pricable only.**
- **25% affordability ceiling is a WARNING, not an exclusion.** Scale cards are
  directly cart-selectable with a budget-impact note; the footer budget meter is
  the aggregate guardrail.
- **`BAND_MEDIUM_COMPOSITE` (=50) stays in `conviction.ts`** — bands still LABEL
  shows (high/medium/low/speculative) for display and the band filter; they just
  don't gate.

Projected volume for `a55b7e2b` under no floor: 63 candidates × 4 rings = **252
`conviction_scores` rows** upper bound (pre `(show,ring)`/simulcast dedup) →
~63 distinct shows after rollup. Negligible; no floor added to preempt it.

Q5 stale-tier invariant (below) is deliberately relaxed and made moot by clearing
conviction scores on ring re-confirm (`interpret/confirm` route) — see STATUS.md.
