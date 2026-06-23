# Wave 14 Phase 2B — Three-Dimensional Conviction Scoring + Reasoning Surface

**Spec status:** Ready to build.
**Build time estimate:** 4-5 days, Claude Code session(s).
**Build model:** Claude Opus 4.8 (extra-high mode) in Claude Code. *(Fable 5 was the 2A build model; suspended worldwide June 12 under the US export-control directive, no restoration date. Build on Opus 4.8.)*
**Runtime model:** Claude Opus 4.8 (`process.env.LLM_MODEL || 'claude-opus-4-8'`). Reasoning generation only — scoring itself is LLM-free.

---

## Read these before you start

In order:

1. `CLAUDE.md` — full file. Pay attention to: Wave 14 section, the adversarial-review pattern, Supabase conventions + the data-API grant rule, domain events, and the **brand-safety-is-metadata-only** decision (this spec touches it — see "Scoring guards" §11, which flags the conflict rather than silently overriding it).
2. `TAYLSLATE_CONTEXT.md` Section 5 — the discovery thesis. If this spec and Section 5 disagree, Section 5 wins; flag and stop.
3. `WAVE_14_STRATEGY.md` — sections 2 (three-dimensional conviction), 3 (Sauna Box texture — the founder-pick lessons are the test cases for non-gating purchase power), 7 (sequencing), 8 (80% ship then tune), 9 (more results not fewer), 10 (2B open questions — resolved in this spec).
4. `SCORING_CALIBRATION.md` — Test Campaign 1. The issues observed there (sleep/ASMR over-ranking, brand safety, narrow genre) are the failure modes 2B's scoring must not reproduce.
5. `lib/scoring/weights.ts` — `getEffectiveWeights()` with AOV-aware tilt and the dormant `topicalRelevance` / `purchasePower` dimensions. 2B activates them. Read end-to-end.
6. `lib/data/reasoning-log.ts` — `recordConvictionScore()` (fail-soft contract). This spec wires it.
7. `lib/discovery/discover-shows.ts` — the orchestrator. 2A did not modify it; 2B replaces its scoring layer and adds simulcast merge.
8. `lib/podscan/discover.ts` — Podscan Discover wrapper (vector similarity), used for topical relevance and adjacency.

---

## What this builds

The scoring-and-surface layer. 2A produced confirmed ring hypotheses; today discovery still runs flat fit-score and `/campaigns/[id]` is empty. 2B replaces the flat score with three-dimensional conviction scoring against the confirmed rings, generates per-show reasoning prose, wires `recordConvictionScore()`, and populates the discovery view.

**Data interface from 2A (the input 2B consumes):**
- Confirmed `ring_hypotheses` rows for the campaign — each with `ring_kind` ('primary' | 'lateral' | 'added_by_brand'), `ring_label`, `confidence`, `reasoning`, `analog_campaigns[]`, `brand_decision` (score only rows where `brand_decision IN ('confirmed','added_by_brand')`; skip `rejected`/`refined`/`pending`).
- The `campaign_patterns` row — `product_attributes`, `customer_summary`, `aov_bucket`, `goals`, `budget`, `exclusions` (parsed), `effective_scoring_weights`.

2B consumes the *structure* of this output, not its quality — so it is fully parallel to interpret-brief prompt tuning (Track Q). Tuning will not change this interface.

**The three locked architecture decisions (do not re-open during build):**
1. **Scores are computed, not LLM-generated.** The three sub-scores come from structured signals. The LLM is called only for reasoning *prose*, batched per ring. Rationale: computed scores are deterministic, testable in CI, and calibratable against real conversion — LLM-opinion scores are none of those.
2. **Reasoning prose is batched per ring** (one LLM call per ring, not per show), fail-soft to a templated sentence.
3. **Purchase power is a category proxy**, scored as one of three **non-gating** weighted dimensions — never a hard filter. A show with low purchase power but strong audience + topical fit still surfaces (the *That Was Us* lesson: affluent women 25-40 inside a TV-rewatch show — wrong on purchase-power-by-category-prestige reasoning, right on audience).
4. **Medium-awareness: minimal schema fold-in only.** Ship the `surfaces` / `medium_priors` schema and simulcast dedup in the orchestrator so the discovery layer doesn't get re-migrated later; keep medium-aware scoring *math* light for launch. Long-form YouTube is a launch medium; full medium-differentiated scoring is deferred.

**Scope boundary:** 2B produces the full conviction-scored show universe, surfaced and filterable. It does **not** split into test portfolio vs scale tier (2C), does not capture founder annotations or promo codes (2D). Stop at "scored universe renders at `/campaigns/[id]` with three dimensions + reasoning, filterable, more-results-not-fewer." If a temptation to start 2C/2D arises, stop and surface it.

---

## Pre-flight: schema verification (Day 1, before any code)

Introspection first — "applied" means confirmed in the live schema, never assumed from migration files. Verify against the live DB:

1. **`conviction_scores` table** (migration 019). Confirm columns: per-(show, ring) scoring with `audience_fit`, `topical_relevance`, `purchase_power`, `composite`, `conviction_band`, plus FKs to campaign/show/ring and a reasoning-text column (or determine where reasoning persists). View the `ConvictionScoreRow` type in `lib/data/types.ts` and reconcile.
2. **`shows.audience_purchase_power`** (migration 019). Confirm it exists and its type/enum. This is where Layer 1's proxy writes.
3. **`getEffectiveWeights()`** — confirm the signature accepts `aovBucket` and returns weights including `topicalRelevance` and `purchasePower`, and that the AOV tilt raises purchase-power weight when `aovBucket='high'`.
4. **`ConvictionBand` / `ConvictionTier` enums** — confirm allowed values before the scorer writes them.

**One new migration for 2B (medium fold-in), write it Day 1, idempotent, copy-paste for Supabase SQL Editor:**
- `shows.surfaces` JSONB — captures simulcast (one show present on podcast + YouTube), nullable, default `null`.
- `shows.medium_priors` JSONB — medium-specific priors (CPM range, engagement weight, frequency norms), nullable, default `null`. Populated light for launch; structure reserved so full medium-aware scoring lands later with no re-migration.
- After Chris runs it, **verify by introspection before any code depends on it.**

If `conviction_scores` shipped a different shape than this spec assumes, stop and surface — do not silently re-spec.

---

## Build sequence — 5 layers, each its own commit

Same discipline as 2A: each layer testable in isolation, tests green before the next, Codex adversarial review after each, single-file-scoped commits, plan mode before each layer.

### Layer 1 — Purchase-power category proxy + backfill (~half day)

**File:** `lib/scoring/purchase-power.ts`

**Function:** `categoryToPurchasePower(category: string): PurchasePowerTier`
- Deterministic lookup from show category → tier (`high` | `medium` | `low`). First-pass mapping in §6 below — Chris red-pens it.
- Unknown / missing category → `medium` (neutral default, never throws).
- Blunt by design; it's one of three weighted dimensions, not a gate. Imperfection is survivable and gets logged to `SCORING_CALIBRATION.md` for later refinement.

**Backfill:** populate `shows.audience_purchase_power` for all existing shows by running the proxy over their category. Idempotent — re-runnable, only writes where null or where a recompute flag is set. Output as a copy-paste script or SQL for Chris. New-show ingest applies the proxy going forward.

**Why populate the column rather than compute at scoring time:** keeps it queryable/filterable, and reserves a clean override path — a future manual rating or smarter heuristic writes the same column without touching scoring code.

**Tests (~6):**
- High-tier category → `high`
- Medium / low categories → correct tiers
- Unknown category → `medium`, no throw
- Empty / null category → `medium`
- Backfill idempotency (second run is a no-op on already-populated rows)
- Backfill respects an existing non-proxy value (doesn't clobber a manual override)

### Layer 2 — Three-dimensional conviction scorer (~1.5 days)

**File:** `lib/scoring/conviction.ts`

**Function:** `scoreShowConviction(show, ring, campaignPattern): ConvictionScore`
- **Audience fit** — show demographics vs the ring's target audience profile. Use existing Podscan demographic signals; graceful degrade when demographics are sparse (lower confidence, not zero).
- **Topical relevance** — show category / Podscan vector similarity vs the ring topic. Use `lib/podscan/discover.ts` adjacency where it sharpens the signal.
- **Purchase power** — read `shows.audience_purchase_power` (Layer 1), mapped to a sub-score.
- **Composite** — weighted sum via `getEffectiveWeights({ aovBucket })`. Purchase-power weight is small/zero for low-AOV briefs and raised for high-AOV — this is the existing AOV tilt, now active.
- **Conviction band** — per §7 logic.
- Pure function, deterministic, no LLM, no I/O beyond the inputs passed in.

**Non-gating guarantee:** the composite is a weighted sum, never a filter. A show scoring low on purchase power but high on audience + topical still produces a real composite and can land in a ring. Encode this as an explicit test, not just a comment.

**Tests (~10):**
- Convergence: all three dimensions strong → `high` band
- Two strong, one weak → `medium`
- One strong → `low`
- **Non-gating: purchase-power-low, audience+topical-high, high-AOV brief → still scores into a ring** (the That Was Us case)
- Low-AOV brief: purchase-power weight ≈ 0, composite driven by audience + topical
- High-AOV brief: AOV tilt active, purchase power materially weighted
- Sparse demographics → degraded audience score + lowered band, no throw
- Composite math matches `getEffectiveWeights` output for a known fixture
- Band thresholds at the boundaries (just-above / just-below each cut)
- Speculative ring (low 2A confidence) caps band at `speculative` regardless of composite

### Layer 3 — Orchestrator integration + simulcast merge (~1 day)

**File:** `lib/discovery/discover-shows.ts` (modify)

- For each confirmed/added ring, score every candidate show with Layer 2; attach scores.
- **More results, not fewer:** include every show matching *any* ring at `medium` band or above. Paginate + filter downstream; do not prune to a top-N.
- **Show-type exclusion (§11):** filter out Sleep / Meditation / ASMR shows *before* scoring — a hard genre filter, applied regardless of audience overlap.
- **Simulcast merge:** dedup shows present on both podcast + YouTube into one record carrying `surfaces`; don't double-list. Light — merge identity, surface both mediums, don't yet differentiate scoring math.
- Wire `recordConvictionScore()` per (show, ring) score — fail-soft, never blocks the response (Phase 1 contract).
- Remove / bypass the legacy flat fit-score path. Confirm no caller still depends on the old score shape; if one does, surface it.

**Tests (~8):**
- Orchestrator returns a conviction-scored universe across multiple confirmed rings
- `medium`+ inclusion rule honored (a medium show is present, a below-floor show is excluded)
- Sleep / ASMR / meditation show → excluded from results entirely (genre filter, applied before scoring)
- Simulcast dedup: one show on both mediums → single record with both surfaces
- `recordConvictionScore()` called once per (show, ring)
- Persistence failure (mocked) → scoring response still returns, error logged
- Rejected / refined / pending rings are not scored
- Added-by-brand ring is scored
- No regression: a campaign with one ring scores correctly

### Layer 4 — Batched reasoning generation (~1 day)

**File:** `app/api/campaigns/[id]/reasoning/route.ts` (or a service called from the orchestrator — match existing patterns)
**Prompt:** `lib/prompts/conviction-reasoning.md`

- **One LLM call per ring**, not per show. Input: the ring (label, the brand's confirmed framing), and the ring's top-N scored shows with their three sub-scores + the score drivers. Output: JSON keyed by show id → reasoning string.
- **Fail-soft:** if the call fails / refuses / returns malformed JSON, fall back to a **templated** reasoning sentence built from the score components ("High audience fit, strong topical match, moderate purchase power for this AOV"). Scores always render; prose is best-effort.
- Persist reasoning to the conviction score row (or the location confirmed in pre-flight).
- Route through `lib/llm/client.ts`; refusal fallback identical to 2A.

**Tests (~8, all LLM mocked):**
- Batched call: N shows in a ring → N reasoning strings, attached to the correct shows
- One call per ring (not per show) — assert call count
- LLM failure → templated fallback for every show in the ring, scores intact
- Malformed JSON → templated fallback, no throw
- Refusal → Opus 4.8 fallback attempted, then template
- Reasoning names the actual score drivers (fixture assertion on a mocked sharp response)
- Empty ring → no call, no error
- Persistence fail-soft

### Layer 5 — Discovery view at `/campaigns/[id]` (~1 day)

**Route:** `/campaigns/[id]`

- Per-show card: composite + conviction band badge, **all three sub-scores visible** (three bars or three numbers — the brand must be able to see the dimensions diverge; a single composite hides exactly the insight that justifies a pick), reasoning prose, grouped by ring (primary first, then laterals).
- **Filter, don't prune:** filter by ring, by conviction band; pagination over a long list. This is the "more results not fewer" surface.
- Empty / speculative states: if all rings are speculative, soften copy (consistent with 2A's speculative variation).
- **Brand-safety notice (§11):** flagged shows render a visible, legible notice — informational only, no score impact; the brand decides.
- **Explicit boundary:** this view shows the full scored universe. The test-portfolio / scale-tier split is 2C — do not build it here. A single "this is everything we found; refine and pick" framing is correct for 2B.

**Tests (~8):**
- Renders scored shows grouped by ring
- All three sub-scores render per show
- Band badges render correctly
- Filter by ring narrows the list
- Filter by band narrows the list
- Reasoning prose renders (and the templated fallback renders cleanly when prose is the fallback)
- Empty universe → empty state, no crash
- Speculative-all state → softened copy
- Brand-safety-flagged show → notice renders, no score penalty applied

---

## 6. Purchase-power category → tier mapping (first-pass — red-pen this)

Blunt by design. Purchase power asks "can this audience afford the AOV," and category is a crude proxy for audience affluence. It is one of three weighted dimensions, so being wrong on a show lowers one sub-score, never vetoes the show. Chris owns this mapping — adjust freely.

**High** (audience skews affluent / high disposable income):
Business · Investing · Personal Finance · Entrepreneurship · Technology · Real Estate · Marketing · Management · Careers · Golf · Wine · Luxury / premium lifestyle · biohacking / optimization-leaning Health & Fitness

**Medium** (broad / mixed income):
General Health & Wellness · Education · Science · Society & Culture · Sports · News · Arts · Food · Parenting · Relationships · History · Comedy · True Crime · Documentary · Self-Improvement (general)

**Low** (skews price-sensitive or non-purchasing context):
Kids & Family · Religion (mass) · Music (mass) · Fiction / Drama · broad Entertainment · Sleep / Meditation / ASMR *(excluded from results entirely — see §11)*

Unknown / unmapped category → **medium**.

Tier count: **three, locked** (`high` / `medium` / `low`). No finer split for launch; refine the mapping post-launch via calibration if the blunt edges hurt real campaigns.

---

## 7. Conviction band logic

Band is derived from the composite **and** the dimension pattern (convergence matters, not just the weighted total).

First-pass defaults (numbers are placeholders — calibrate against real output, log to `SCORING_CALIBRATION.md`):
- **`high`** — composite ≥ ~0.75 **and** at least two dimensions above their individual strong-thresholds (convergence guard, so a single dominant dimension can't fake high conviction)
- **`medium`** — composite ≥ ~0.50
- **`low`** — composite below medium floor but matched the ring at all
- **`speculative`** — the source ring was `speculative` confidence in 2A, **or** the show's data is too sparse to score two of three dimensions

Band thresholds default to absolute floors with the convergence guard; relative-within-campaign banding is a tuning option if absolute floors prove miscalibrated on real campaigns. Don't over-engineer this in the build — ship the floors, tune the cuts.

---

## 8. Prompts

### `lib/prompts/conviction-reasoning.md`
- **Role:** veteran buyer explaining, in one or two sentences per show, *why this show fits this ring* — naming the score drivers, not narrating numbers.
- **Input:** ring label + brand's confirmed framing; per show: the three sub-scores and their drivers (e.g. "audience over-indexes on premium recovery purchases", "host personally uses the category").
- **Output:** strict JSON, `{ [show_id]: reasoning_string }`, no preamble.
- **Quality bar:** specific, names the driver, no horoscope reasoning, buyer voice. Mirrors the interpret-brief quality bar. Benefits from a seeded pattern library (analogs) but does not require it — fail-soft template covers the empty case.
- **Tuning note (comment at top of file):** like interpret-brief, the tuning direction is to *remove* scaffolding, not add rules.

---

## 9. Model selection

Identical to 2A: `process.env.LLM_MODEL || 'claude-opus-4-8'`, centralized in `lib/llm/client.ts`, refusal fallback to explicit Opus 4.8. Reasoning is the only LLM surface in 2B; scoring is deterministic and never calls a model. Cost is bounded to ~one call per ring (3-6 per campaign), not per show.

---

## 10. Domain events

Per CLAUDE.md, fire on each transition (existing `logEvent()`, fail-soft):
- `conviction.scored` — a campaign's universe finished scoring
- `conviction.reasoning_generated` — batched reasoning succeeded for a ring
- `conviction.reasoning_failed` — reasoning fell back to template for a ring

---

## 11. Scoring guards + filters (decided)

The dividing principle, confirmed: **fit / inventory decisions belong to the platform; brand-values decisions belong to the brand.** Taylslate filters what doesn't fit the host-read model it operates in; it surfaces — but never decides — what a given brand might find off-brand.

- **Sleep / Meditation / ASMR → excluded from results entirely.** Not a down-weight — a hard show-type filter applied in the orchestrator (Layer 3) *before* scoring, regardless of audience overlap. These don't fit the host-read DTC model right now (DAI-sold, listeners tuning out, no conversion playbook). The brand does not see them to override — that's intended; this is a platform fit call, not a brand call.
- **DAI / aggregator format → light down-weight where detectable.** Programmatic / perfunctory reads convert worse than host-reads. A light, non-gating composite modifier where the format or aggregator network is identifiable (publisher / network signal); best-effort, since format isn't always cleanly detectable in the data. *Strategic note: how DAI inventory is sold is a known live concern for Taylslate — host-read is the entire model. 2B handles it as a light down-weight; the larger detection-and-education problem is its own thread, not a 2B build item.*
- **Brand safety → surface a notice, no scoring impact.** A brand call, not a platform call. The discovery view (Layer 5) renders a visible, legible brand-safety notice on flagged shows so the brand can decide for itself; scoring does **not** down-weight or exclude on it. This **preserves** the existing CLAUDE.md metadata-only stance — no amendment, no conflict. The only change from today is promoting the flag from buried metadata to a prominent notice.

The sleep/ASMR exclusion is a hard filter; the DAI modifier is non-gating (same principle as purchase power). The DAI modifier can defer to a fast-follow if Layer 3 runs long, but keep the sleep/ASMR exclusion in — empty-calorie results (Get Sleepy at 85) are a credibility hit at launch and the filter is cheap.

---

## What does NOT ship in 2B

Surface for a sub-phase boundary if tempted:
- Test portfolio vs scale tier split (2C)
- Founder annotations UI (2D)
- Promo code / UTM capture (2D)
- Full medium-differentiated scoring math (light fold-in only; deferred)
- Embedding-based retrieval (post-launch)
- Direct show search (separate pre-launch backlog item, not 2B)
- Brand-safety down-weight or exclusion (surfaced as a notice only, brand's call — §11)
- "Expand my horizons" slider, "find shows like this" primitive (post-launch)

---

## Pattern library seeding (Track P — async, non-blocking)

Conviction **scores** are computed and need no library. Reasoning **prose** is sharper with analogs seeded (Plunge, Therabody, AG1, Higher Dose, SaunaBox, 1-2 B2B). Seeding improves Layer 4 output but blocks no layer — run it in parallel.

---

## Testing summary

Target ~40-50 new tests across the five layers. All LLM calls mocked in CI with deterministic fixtures (reasoning happy-path + fail-soft). Scoring layers (1-3) are fully deterministic and need no mocking. Manual real-LLM validation of reasoning prose happens before merge — Chris reads a few real campaigns' output.

---

## Build order recap

1. **Day 1 AM:** Schema verification + medium fold-in migration (Chris runs, introspect) + Layer 1 (purchase-power proxy + backfill) + tests
2. **Day 1 PM – Day 2:** Layer 2 (conviction scorer) + tests — the heart of 2B
3. **Day 3 AM:** Layer 3 (orchestrator + simulcast merge) + tests; decide the §11 guards
4. **Day 3 PM:** Layer 4 (batched reasoning) + tests
5. **Day 4:** Layer 5 (discovery view) + tests
6. **Day 4-5:** Integration pass, Codex adversarial review per layer, fixes

After 2B ships, reasoning-prompt tuning folds into Track Q. 2B is "shipped" when the scored universe renders at `/campaigns/[id]`, the schema/UI are stable, and tests are green — prompt sharpening is ongoing, not a 2B acceptance gate.

---

## Working style notes

- Plan mode before each layer; stop for approval.
- Migration copy-paste-ready for Supabase SQL Editor; introspect before code depends on it.
- Adversarial review after each layer: Claude Code self-review → Codex → flag to Chris for plain-English interpretation against intended design.
- Single-commit per layer, scoped to exactly the changed files; nothing else staged.
- Don't move past a layer's tests being green.
- If a spec decision proves wrong during build, stop and surface — don't silently re-spec.
- Priority order when in doubt: `TAYLSLATE_CONTEXT.md` Section 5 > this spec > general engineering judgment.
