# Wave 14 Phase 2C — Test Portfolio + Scale Tier Dual Output

*Sub-phase of Wave 14 Phase 2 (Discovery Agent UX). 2A (brief intake + interpretation loop) and 2B (three-dimensional conviction scoring + reasoning surface) are shipped and live. The conviction-scored universe renders at `/campaigns/[id]`. 2C splits that universe into a test portfolio and a scale tier, wires the test selection into the media plan, and persists the split as pattern-library data.*

---

## Read these before you start

1. `TAYLSLATE_CONTEXT.md` Section 5 — "Test portfolio + scale tier dual output" subsection (the dual-output thesis) and "Confidence gates portfolio shape."
2. `WAVE_14_STRATEGY.md` §3 (3-spot floor is a hard constraint; scale tier is a real feature), §4 (test vs scale UX modes), §7 (why 2C comes after 2B), §10 (2C open questions — answered below).
3. `CLAUDE.md` — Wave 14 section, "Discovery Reasoning" reference, "Test vs Scale," Supabase Conventions (idempotent migration pattern + Data API grants + "applied means introspected").
4. `WAVE_14_PHASE_2B_SPEC.md` — for the scored-universe data shape this phase consumes (conviction bands, `conviction_scores` columns, the `/campaigns/[id]` view, §11 guards).
5. Recent commits through `8539dfc` — to see what 2B *actually* shipped at `/campaigns/[id]`, including the disabled "Media plan — next" CTA this phase wires into.

---

## What this builds

2C takes the scored universe 2B renders and produces the brand's actual shopping decision: **what do I buy now, and what do I save for later.** From one analysis, two lists:

- **Test portfolio** — shows affordable at the 3-spot test cadence (99% of podcast tests), conviction ≥ medium. Selectable. Feeds the media plan.
- **Scale tier** — high-conviction shows whose 3-spot cost exceeds the test budget. Surfaced with "deferred — fits future budget" framing, per-show 3-spot cost and budget delta. A saved watchlist, not directly selectable. The anchor for the post-test conversion conversation.
- **Bench (dropped)** — everything else (low/speculative conviction, or affordable-but-not-selected). Collapsed by default, expandable.

**2C COMPUTES the split. It does not read a tier.** The `conviction_scores.tier` column from migration 019 is dormant (null) — 2B never populated it. 2C derives `test`/`scale`/`dropped` from conviction band + a derived 3-spot cost + the campaign budget + cadence, then persists the result.

**Scope boundary.** Stop at: "tiers computed and persisted to `conviction_scores`; test/scale/bench render at `/campaigns/[id]`; brand selects test shows; the 'Media plan — next' CTA enables on ≥1 test selection and passes only selected test-tier show IDs into the existing media plan builder; scale watchlist persists on the campaign." Do **not** build media plan internals (Wave 7 exists), scale-mode UX (Wave 15+), real rate-card ingestion or Podscribe (post-launch), founder annotations or promo codes (2D). If a temptation to start any of those arises, stop and surface it for a sub-phase boundary conversation.

---

## Pre-flight: data + schema verification (Day 1 — COMPLETE, findings below)

The Day-1 introspection ran (read-only, nothing mutated) and corrected four assumptions this spec originally made. **These findings are now binding; the layers below were rewritten to match them.** If anything here conflicts with a later section, the later section was already updated — but re-verify against live before trusting any of it (`buildDiscoveryBrief` and the Wave 13 financial layer are the standing reminders that "applied means introspected").

**Verified findings:**

1. **Budget lives on `campaigns.budget_total`, NOT `campaign_patterns.budget`.** `campaign_patterns` has no budget column (the 2B spec referenced one that was never created). `campaigns.budget_total` is `DECIMAL(10,2)` — **dollars, not cents**, total campaign budget. It already flows into the discovery view as the `budgetTotal` prop. The 25% gate reads `budget_total` and converts dollars→cents in code. **Do not add a `test_budget_cents` sibling column** — unnecessary.
2. **Per-show cost is NOT absent — an estimated CPM/flat-fee already exists upstream.** Every Podscan candidate carries `audience_size` (avg downloads/ep or YT views; `0` when Podscan reach is missing) **and** a `rate_card` derived by `lib/discovery/format-discovered-show.ts`: `getDefaultPodcastRateCard(audienceSize)` (banded CPMs $18/22/28/35) and `getDefaultYouTubeFlatRate(subscriberCount)` ($2K–15K), plus `price_type` (`'cpm'`|`'flat_rate'`). **Layer 1 reuses these two functions — it does NOT author a second CPM table.** A forked table would silently diverge from the rest of the app. The `audience_size = 0` case is the real `needs_quote` path.
3. **`conviction_scores` grain is per-(pattern, show, ring), and there is NO `campaign_id` column.** The row carries `ring_hypothesis_id`; the orchestrator writes one row per (show, ring). The 019 header comment saying "per (campaign, show)" is stale. **Show-level rollup (highest band across the show's rings) is mandatory, not optional.** The table links to a campaign only via `campaign_pattern_id → campaign_patterns.campaign_id` — every tier query and the migration index key on **`campaign_pattern_id`**, never `campaign_id`.
4. **`conviction_scores.tier`** exists (`TEXT CHECK test/scale/dropped`), is null across all rows, and 2B never writes it (orchestrator comment: `// tier → 2C`). Dormant exactly as assumed.
5. **The "Media plan — next" CTA** is a static disabled `<button>` in `conviction-discovery-view.tsx` (footer, ~lines 490–498) — no handler, no onClick, no enabled-state source, and **there is no selection state / checkboxes in the view today.** Layer 4 is greenfield on the handler side: it introduces test-portfolio selection and derives CTA-enabled (≥1 selected). The button is disabled because the legacy Wave 7 plan page reads `campaigns.scored_shows` / `selected_show_ids`, which the v2 path never writes — **Layer 4 must write selected test-tier show IDs into that path (an adapter) before enabling the CTA.**
6. **Migrations:** 026's `surfaces` + `medium_priors` JSONB on `shows` confirmed present. 024/025 `persist_*` RPCs and `ring_hypotheses.slot_position` confirmed. **027 is already taken by `discovery_locks`** — so **2C's migration is 028.** The 2C cost columns confirmed absent (028 not yet run).
7. **Money units are inconsistent across the codebase and this is Codex-gate territory.** Existing money is dollars (rate-card CPMs as plain numbers like `22`; `budget_total` decimal dollars). 028's cost columns are `*_cents`. Layer 1 must convert dollars→cents consistently across CPM, per-spot, three-spot, and the budget threshold. Flag for the Layer 2 Codex gate.

---

## Build sequence — 5 layers, each its own commit

Same discipline as 2A/2B: each layer testable in isolation, tests green before the next, Codex adversarial review after each, single-file-scoped commits, plan mode before each layer. **2C calls no LLM** — cost derivation and tier classification are deterministic; reasoning prose is read from the persisted 2B `conviction_scores`. This keeps the split calibratable and the data moat clean (same principle as 2B: "scoring is deterministic, never calls a model").

### Layer 1 — Per-show 3-spot cost derivation (~half day)

A deterministic helper: `deriveSpotCost(show, campaign, placement?)` → `{ perSpotCents, threeSpotCents, cpmUsedCents | null, costBasis, isEstimate, needsQuote }`.

**Reuse the existing band tables — do not author new ones.** The candidate `show` already carries `audience_size`, `rate_card` (with `preroll_cpm` / `midroll_cpm` / `postroll_cpm` / `flat_rate`), and `price_type`, populated by `lib/discovery/format-discovered-show.ts` via `getDefaultPodcastRateCard` ($18/22/28/35 mid-roll by audience band, with pre/post tiers) and `getDefaultYouTubeFlatRate` (**$2K–15K** — the code tops out at $15K; the "$2K–20K" in older docs is wrong, fixed below). Layer 1 reads those values; it must not introduce a second, divergent table.

- **Placement is a real ad unit, not a fallback.** `placement` param (`'preroll' | 'midroll' | 'postroll'`, **default `'midroll'`**) selects which CPM to price against. Pre-roll and post-roll are distinct purchasable units at distinct prices — do **not** collapse them into a `midroll ?? preroll ?? postroll` chain. The only fallback is *within* the chosen placement if that specific CPM is null. Brand-selectable placement override lands in Layer 5 (it moves the affordability line — a show unaffordable at a $35 mid-roll can be affordable at an $18 post-roll).
- **Podcast (`price_type==='cpm'`):** `perSpot = (audience_size / 1000) × cpm` for the selected placement. `costBasis='derived'`, `isEstimate=true`.
- **YouTube / simulcast YouTube surface (`price_type==='flat_rate'`; detect medium via `surfaces`/`medium_priors`, migration 026):** use `rate_card.flat_rate` (placement n/a). `costBasis='flat_fee'`, `isEstimate=true`. **This number is low-confidence by construction** — YouTube integration pricing varies wildly with no reliable rate card (a 500K-sub channel might quote $3K or $25K), so the flat-fee band is a placeholder, not a defensible estimate. It surfaces as a labeled "quote to confirm" range, never a precise figure, and (per Layer 2) does **not** hard-gate the test/scale split. **The graduation path is onboarding:** when a YouTube channel onboards (post-launch, same flow as podcasts) it carries a real rate card and flips to `cost_basis='rate_card'`, at which point it hard-gates like everything else — no code change, the basis just changes.
- **Real onboarded rate card present (`min_buy` set, or a `show_profiles` rate card — rare):** prefer it over the default. `costBasis='rate_card'`, `isEstimate=false`. (No `min_buy` floor applied here — that's Layer 2 affordability; folding it in would break the `perSpot × 3 = threeSpot` invariant.)
- **No derivable cost → `needsQuote`.** Podcast `audience_size ≤ 0`, or a missing/≤0 CPM/flat_rate → `null` cost, `needsQuote=true`. **Never throw, never zero, never drop.** Note the **podcast/YouTube asymmetry**: a podcast with 0 downloads → `needs_quote` (Podscan often lacks the data; the show may be live), but a YouTube channel with 0 views is **excluded upstream** (see the zero-view filter below) and won't reach Layer 1 — so Layer 1 never prices a dead channel.

**Units:** all outputs in integer cents. Existing money is in **dollars** (`rate_card` CPMs are plain numbers like `22`; `budget_total` is decimal dollars) — convert dollars→cents at the boundary, explicit at every step. Part of the Layer 2 Codex gate (Flag 7, pre-flight).

Layer 1 does **not** write to the DB — persistence happens in Layer 2/3 after migration 028.

**Tests (~8):** podcast math at mid-roll; pre-roll vs post-roll price against the right CPM (placement is a real unit); YouTube flat-fee path (reads `flat_rate`, `cpmUsedCents` null); rate-card path overrides estimate; podcast `audience_size 0` → `needsQuote` (no crash/drop); banded CPM changes with audience tier (built via `podscanPodcastToShow` to prove reuse, not duplication); cents/dollars correctness incl. `threeSpot = 3 × perSpot` exactly; estimate/needsQuote flags correct per basis.

### Layer 1b — Zero-view YouTube hard filter (small separate commit)

A discovery-quality filter, same family as the existing Sleep/ASMR genre exclusion in the orchestrator's pre-scoring stage — **not** a scoring change. YouTube view counts are public and reliable, so a 0-view channel is dead inventory; because YouTube is flat-fee priced, leaving it in would put a real-looking $2K price on a channel nobody watches (the priced-empty-calorie credibility hit the 2B spec flagged for Get Sleepy). Add `medium==='youtube' && audience_size ≤ 0 → exclude` to the orchestrator hard-filter list, before scoring, so these never get conviction-scored or surfaced.

- **Literal zero for now.** A higher floor (e.g. `< 1000` views) is a post-launch calibration lever if half-dead channels still leak through; start at `≤ 0` as specified.
- **Scope note:** this touches the 2B orchestrator (which 2C's boundary said not to modify). It's in-scope as a discovery *filter*, not a scoring change, and it's one line in an existing filter stage — but it's a deliberate, flagged exception, its own commit, not folded into the Layer 1 helper.
- **Tests (~2):** zero-view YouTube show is excluded from the scored universe; a YouTube show *with* views is retained and priced.

### Layer 2 — Tier classifier + persistence (~1 day)

A pure function: `classifyTier({ compositeScore, threeSpotCents, costBasis, needsQuote, testBudgetCents, threshold, cadence })` → `'test' | 'scale' | 'dropped'`, plus a campaign-level pass (keyed on `campaign_pattern_id`) that writes the result.

**The split is gated on affordability + composite, NOT the conviction band.** Pre-flight Flag 7: 2B pins audience-fit to a neutral 50 for every discovered show (empty demographics — the standing top calibration item), so the `high` band requires a composite the scorer can't reach; 2B's own view header notes "bands cap at medium by construction." If scale were defined as `band==='high'`, the entire scale tier would render blank for essentially every campaign at launch. So the gate that pushes a show to scale is **budget, not band** — which is also the real-world reason Modern Wisdom / DOAC are scale shows (they cost $20–36K for three spots, per Strategy §3). Conviction still *orders within* each tier; band is displayed, not used as the tier gate.

**Cost confidence gates whether cost is allowed to decide the split.** `cost_basis` is the confidence signal: `rate_card` (onboarded, real) and `derived` (podcast downloads × CPM, defensible) are **gate-worthy** — the affordability test runs. `flat_fee` (non-onboarded YouTube) is **not gate-worthy** — the number is a wild guess, so it must not falsely sort a channel into "fits your test budget." A `flat_fee` show is classified by **conviction only** (test if `composite ≥ MEDIUM_FLOOR`, else dropped), its cost shown as a "quote to confirm" range, and it's never placed in `scale` purely because an untrustworthy estimate exceeded budget. When the channel onboards → `rate_card` → it gate-gates like everything else, no rewrite.

- **test** = `compositeScore ≥ MEDIUM_FLOOR` AND not `needsQuote` AND **(** `costBasis ∈ {rate_card, derived}` AND affordable (`threeSpotCents ≤ threshold × testBudget`) **OR** `costBasis === flat_fee` (cost not gating) **)**.
- **scale** = `compositeScore ≥ MEDIUM_FLOOR` AND `costBasis ∈ {rate_card, derived}` AND over-threshold (`threeSpotCents > threshold × testBudget`) — "good enough to want, too expensive for this test." Watchlist, brand-curated. (A `flat_fee` show never enters scale on cost alone — its cost isn't trusted.)
- **dropped (bench)** = everything else (`compositeScore < MEDIUM_FLOOR`, or `needsQuote`).
- **Empty-test guard:** if fewer than `MIN_TEST_SHOWS` (default 3) test shows result, flag the campaign `test_underfilled` so Layer 4 surfaces "your budget is tight for a 3-spot test; here's single-spot, or raise budget" instead of an empty primary section.
- **Show-level rollup is mandatory.** `conviction_scores` is per-(pattern, show, ring) — collapse to one classification per show using the show's **highest composite across its rings** (and surface that ring's band/reasoning). Do this before classifying.
- **Recompute contract:** tier is a recomputed cache. Compute server-side whenever budget/cadence/CPM inputs are known; rewrite on any override (Layer 5). Persisting it keeps `conviction_scores` the system-of-record for the split — "what we classified vs. what the brand picked" is labeled training data. **When demographics enrichment ships (bands decompress) or YouTube onboarding ships (`flat_fee`→`rate_card`), this classifier needs no rewrite** — composite and `cost_basis` are already the gates.

**Codex gate (required):** the threshold math, the `cost_basis` gating, AND the dollars→cents conversion (Flag 7) are money-adjacent — `/codex:rescue` this layer before moving on.

**Tests (~12):** affordable+derived+composite≥floor → test; affordable+derived+composite<floor → dropped; over-threshold+derived+composite≥floor → scale; over-threshold+derived+composite<floor → dropped; `rate_card` behaves like `derived` for gating; **`flat_fee`+composite≥floor → test regardless of cost** (cost not gating); **`flat_fee`+over-threshold never → scale on cost**; `needsQuote` → dropped (never test/scale); threshold boundary (exactly 25% → test); empty-test guard fires below MIN_TEST_SHOWS; per-ring rollup picks the show's highest-composite row; dollars→cents conversion correct at the threshold; persistence writes `tier` to all rows for the campaign_pattern.

### Layer 3 — Orchestrator integration + watchlist curation (~1 day)

- Add a campaign-level pass that, after 2B scoring exists, runs Layer 1 over every scored show, runs Layer 2, and persists `tier` + cost fields to `conviction_scores`.
- Expose the tiered, cost-annotated universe to the `/campaigns/[id]` data loader: test / scale / bench partitions, each show carrying band, three sub-scores, persisted reasoning (from 2B — read, don't regenerate), 3-spot cost, per-spot cost, budget delta (for scale), `isEstimate`, `cost_basis`.
- **Watchlist curation:** a per-row `brand_saved` / `brand_dismissed` flag on `conviction_scores` (migration 028) lets the brand curate which scale shows they actually care about. No separate table. Default scale tier = all `tier='scale'` rows; the brand can dismiss/save within it.
- Fail-soft: cost/tier persistence never blocks the view (same contract as the reasoning-log writes). If persistence fails, compute-on-read and log it.

**Tests (~8):** orchestrator pass tiers a full universe and persists; loader returns three partitions; scale shows carry budget delta; reasoning is read from persisted scores (no LLM call in the path); `brand_saved`/`brand_dismissed` round-trips; persistence failure → compute-on-read fallback, no crash; simulcast show resolves a single cost via medium; `needs_quote` show appears in bench with the marker.

### Layer 4 — Dual-output discovery view + media-plan CTA wiring (~1 day)

Extend `/campaigns/[id]` (do not fork it):

- **Test portfolio section first** — primary styling, selectable (checkbox per show), per-show card shows: composite + band badge, three sub-scores, 2B reasoning, **per-spot price, 3-spot total, estimated indicator** where `isEstimate`. **`flat_fee` (non-onboarded YouTube) shows display a "quote to confirm" range, not a precise price** — and are excluded from the budget meter's hard sum (their cost is untrusted; show it, don't let it falsely fill the budget). A **running budget meter** sums selected `derived`/`rate_card` shows against `testBudget` and warns when selection exceeds it. The 25% gate is per-show eligibility; the meter governs final selection (more-results-not-fewer — show all eligible, brand narrows).
- **Scale tier section directly below** — visible, secondary styling, "deferred — fits future budget" framing. Per show: band, reasoning, 3-spot cost, **budget delta** ("~$X over test budget"). **Not selectable into the test cart by default.** A per-show **"Move to test"** action promotes it with an explicit budget-impact warning and an option to switch that show to single-spot cadence (the documented "scaling a known winner / single-spot test" override). Save/dismiss controls write the watchlist flags.
- **Bench** — collapsed "Other matches" disclosure at the bottom; expand to reveal dropped/low/`needs_quote` shows. `needs_quote` shows render with a "cost unknown — quote at outreach" note, never hidden.
- **Tier is the primary grouping; ring becomes a filter/sub-label.** Carry over 2B's filter-don't-prune + pagination + brand-safety notice behaviors.
- **Wire the "Media plan — next" CTA:** enabled iff ≥1 test show selected. On click, pass **only the selected test-tier show IDs** into the existing media plan builder (Wave 7). Confirm the CTA's actual handler/location from the Day-1 pre-flight before wiring.
- **Underfilled-test state:** if Layer 2 flagged `test_underfilled`, render the tight-budget copy with single-spot / raise-budget options instead of an empty section.

**Tests (~10):** three sections render with correct partition; test shows selectable, scale not; budget meter sums + warns over budget; "Move to test" promotes with warning and optional single-spot; estimated indicator renders on derived costs; budget delta renders on scale; CTA disabled at 0 selection, enabled at ≥1; CTA passes only selected test IDs; `needs_quote` visible in bench with note; underfilled-test copy renders when flagged.

### Layer 5 — Overrides + recompute (~half day)

- **Campaign-level spot-count override** (default 3): single-spot test, or N-spot. Changing it recomputes Layer 1 cost and re-runs Layer 2 across the universe (tiers reshuffle).
- **Placement override** (`preroll` / `midroll` / `postroll`, default `midroll`): campaign-level default plus per-show. Re-prices against the chosen placement's CPM and re-runs classification — a show unaffordable at mid-roll may land in test at post-roll. The selected placement travels with the show into the media-plan handoff (placement is already a Wave 7 line-item field).
- **Per-show CPM/cost edit** (inline): editing the estimated CPM recomputes that show's cost and re-runs its classification. Also closes the "CPM editable downstream but not visibly editable" polish item at the discovery layer.
- Each override fires a recompute + rewrite of `tier`/cost on `conviction_scores`, and a domain event.

**Tests (~7):** spot-count change recomputes + reshuffles + rewrites persistence; placement change re-prices against the right CPM and can move a show across tiers; per-show CPM edit recomputes that show's tier only; override on a scale show can move it to test; recompute is idempotent (same inputs → same tiers); override fires the domain event; reset-to-default restores derived costs at mid-roll.

---

## Migration 028 (copy-paste, Supabase SQL Editor)

**028, not 027** — `027` is already taken by `discovery_locks`. Adds the cost + curation columns to `conviction_scores`. **No new grant block needed** — `conviction_scores` already has `service_role` + `authenticated` grants from migration 020, and Postgres table-level grants cover columns added later. (`conviction_scores` is sensitive — no `anon`, per CLAUDE.md.) Idempotent per the required pattern. **Chris runs this, then introspects to confirm the columns landed before any code assumes them.**

```sql
-- ============================================================
-- Migration 028 — Phase 2C: per-show derived cost + tier curation
-- on conviction_scores. Idempotent. No new grants required
-- (table grants from migration 020 cover added columns).
-- 027 is discovery_locks; this is 028.
-- ============================================================

alter table public.conviction_scores
  add column if not exists per_spot_cents    bigint,
  add column if not exists three_spot_cents  bigint,
  add column if not exists cpm_used_cents    integer,
  add column if not exists cost_basis        text,
  add column if not exists cost_is_estimate  boolean,
  add column if not exists needs_quote       boolean default false,
  add column if not exists brand_saved       boolean default false,
  add column if not exists brand_dismissed   boolean default false;

-- cost_basis is a small controlled vocabulary, not a hard enum
-- (keep it text + check so the set can evolve without an enum migration).
alter table public.conviction_scores
  drop constraint if exists conviction_scores_cost_basis_chk;
alter table public.conviction_scores
  add  constraint conviction_scores_cost_basis_chk
  check (cost_basis is null or cost_basis in ('derived','flat_fee','rate_card'));

-- tier already exists (migration 019, ConvictionTier enum: test/scale/dropped),
-- dormant until 2C populates it. No change here — documented for the reader.

-- NOTE: conviction_scores has NO campaign_id column — it links to a campaign
-- via campaign_pattern_id. The tier-lookup index keys on campaign_pattern_id.
create index if not exists conviction_scores_pattern_tier_idx
  on public.conviction_scores (campaign_pattern_id, tier);
```

Budget needs no migration — it already exists as `campaigns.budget_total` (DECIMAL dollars). Read it and convert to cents in code. **Do not add a `test_budget_cents` column anywhere.**

**Codex gate:** migration 028 is a migration-path change → tight manual gate. Run `/codex:rescue` on the migration *and* on the Layer 2 classifier (budget threshold math + dollars→cents conversion are money-adjacent). Both are the gated surfaces in 2C.

---

## Tier + threshold logic (defaults — calibrate, log to `SCORING_CALIBRATION.md`)

- `THREE_SPOT_THRESHOLD = 0.25` (3-spot cost ≤ 25% of test budget → affordable). Override per campaign if the brand opts out of the 3-spot floor.
- `DEFAULT_SPOT_COUNT = 3`.
- `MIN_TEST_SHOWS = 3` (below this → `test_underfilled`).
- `MEDIUM_FLOOR` — the composite cutoff for test/scale eligibility (start from 2B's medium band floor; calibrate). Shows below it → bench.
- **Tier gate is affordability + composite, not the conviction band** (pre-flight Flag 7 — the `high` band is structurally unreachable until demographics enrichment ships). Scale = composite ≥ `MEDIUM_FLOOR` AND over-threshold. Revisit and tighten to band-aware once enrichment decompresses the bands.
- Cost comes from the existing `format-discovered-show.ts` bands (podcast $18/22/28/35 mid-roll, with pre/post tiers; YouTube **$2K–15K placeholder, low-confidence — does not hard-gate the split, see Layer 2**) — not a new table. Pricing is per the selected `placement` (default mid-roll; pre/post are real units, brand-selectable in Layer 5). Persist `cpm_used_cents` + `cost_basis` so the estimate-vs-quote delta is recoverable when real quotes return.
- **Zero-view YouTube is excluded upstream** (orchestrator hard filter, Layer 1b), so it never reaches the split. Podcast zero-downloads → `needs_quote` → bench (asymmetry is intentional; see Layer 1).

These are first-pass numbers. Ship the floors, calibrate the cuts against real campaigns — don't over-engineer relative-within-campaign banding in the build.

---

## Domain events (existing `logEvent()`, fail-soft)

- `portfolio.tiered` — a campaign's universe finished the test/scale/dropped split.
- `portfolio.override_applied` — budget / spot-count / **placement** / per-show CPM override triggered a recompute.
- `scale_show.saved` / `scale_show.dismissed` — watchlist curation.
- `scale_show.promoted_to_test` — a scale show was moved into the test cart.

---

## What does NOT ship in 2C

- Media plan builder internals — Wave 7 exists; 2C only feeds it selected test IDs (with their chosen placement).
- Scale-mode UX (ongoing monthly ops, rebalancing, annual commitments) — Wave 15+.
- Real rate-card ingestion / Podscribe verification / real-CPM sourcing — post-launch; 2C's costs are deliberately derived estimates.
- Founder annotations, show brand history, promo codes, UTM links, show-notes blurbs — 2D.
- Sponsor competition, audience-overlap cannibalization, lift studies — out of Phase 2 entirely (Strategy §11).
- Any LLM call — 2C is deterministic end to end.

If Codex review surfaces "you should also..." pointing at any of the above — that's a different sub-phase. (The one deliberate exception is the Layer 1b zero-view YouTube filter, which touches the 2B orchestrator — flagged and accepted as a discovery-quality fix, not a scoring change.)

---

## Testing summary (~47 across layers)

- Layer 1 (cost derivation, incl. placement): ~8
- Layer 1b (zero-view YouTube filter): ~2
- Layer 2 (tier classifier + persistence, incl. cost-basis gating): ~12
- Layer 3 (orchestrator + watchlist): ~8
- Layer 4 (dual-output view + CTA): ~10
- Layer 5 (overrides + recompute, incl. placement): ~7

Target 100% coverage on the new code paths per the Phase 2 "done" bar. The classifier and cost helper are pure functions — exhaustively table-test the boundaries.

---

## Build order recap

1. **Pre-flight: COMPLETE** (findings above — four assumptions corrected: budget on `campaigns.budget_total`, cost bands reused from `format-discovered-show.ts`, per-ring grain + rollup, migration renumbered 028, scale gated on composite not band).
2. **Day 1 AM:** Layer 1 (cost derivation — reuse the existing bands, placement param, $15K ceiling) + tests. No DB writes. Then Layer 1b (zero-view YouTube filter) as its own small commit.
3. **Day 1 PM:** Migration 028 (Chris runs in SQL Editor, then introspects). Layer 2 (tier classifier + persistence) + tests — Codex gate on threshold math + dollars→cents.
4. **Day 2 AM:** Layer 3 (orchestrator + watchlist) + tests.
5. **Day 2 PM:** Layer 4 (dual-output view + CTA wiring) + tests.
6. **Day 3 AM:** Layer 5 (overrides + recompute, incl. placement) + tests.
7. **Day 3 PM:** Integration pass, Codex adversarial review per layer, fixes. Confirm the test selection → "Media plan — next" → Wave 7 builder path works end to end with real Podscan candidates.

---

## Working style notes

- Plan mode before each layer. Fresh consideration of the layer's tests before its code.
- Adversarial review after each layer: Claude Code self-review → Codex → flag to Chris in plain English against intended design. Tight Codex gates on migration 028 and the Layer 2 threshold math.
- Migrations are copy-paste-ready for the Supabase SQL Editor (Chris is not a CLI user for migrations). After pasting, introspect to confirm objects landed — "applied means introspected."
- Single-file-scoped commits, descriptive messages, auto-push to main (Vercel deploys from main).
- Costs are estimates and the UI must say so. The test/scale line is provisional until real quotes return post-outreach — that delta is moat data, not a bug.
