# Wave 14 Phase 2A — Brief Intake Redesign + Interpretation Loop

**Spec status:** Ready to build.
**Build time estimate:** 3 days, Claude Code session(s).
**Build model:** Claude Fable 5 in Claude Code (free on Max plan through June 22 — use it).
**Runtime model:** Claude Opus 4.8 (configurable via env var; see "Model selection").

---

## Read these before you start

In order:

1. `CLAUDE.md` — full file, but pay attention to:
   - Wave 14 section (foundation already shipped April 30)
   - Working style and adversarial-review pattern
   - Supabase Conventions and the data-API grant rule
   - Domain events expectations
2. `TAYLSLATE_CONTEXT.md` Section 5 — the discovery thesis. This spec is the operational form of that section. If the spec and Section 5 disagree, Section 5 wins; flag the conflict and stop.
3. `WAVE_14_STRATEGY.md` — sections 5 (Pattern Library Seeding), 7 (Sub-Phase Sequencing), 8 (Iteration Expectations / 80% ship), 10 (Phase 2A specific design questions), 11 (when to push back on scope).
4. `PRODUCT_BACKLOG.md` — Wave 14 Phase 2 entry and Phase 2A specifically.
5. `lib/data/reasoning-log.ts` — the helpers shipped in Phase 1. This spec wires them up. Read the file end-to-end before writing any code that calls them.
6. `lib/scoring/weights.ts` — `getEffectiveWeights()` with AOV-aware tilt. Phase 1 ships dormant; this spec activates it via the campaign pattern record.

Also briefly view `lib/discovery/discover-shows.ts` so the data shape this spec produces (confirmed ring hypotheses) flows correctly into the existing discovery orchestrator. Discovery itself is **not** modified in 2A. 2B replaces the scoring layer; 2A only changes what feeds into it and what's persisted alongside it.

---

## What this builds

The intake-to-discovery path. Today brand goes through Wave 8 onboarding (9-step form), then Wave 10 campaign creation with a paragraph brief, then discovery runs against flat fit-score. Phase 2A keeps Wave 8 brand onboarding as-is (account-level setup; polish handled separately in the backlog) and reshapes the **campaign brief intake** into a free-text-led form plus an AI interpretation step the brand confirms before discovery commits.

The principle from the agentic design rule: brand contributes 30 seconds of customer truth, AI contributes the read of what that truth means, brand confirms or refines the *interpretation* (not the show list). By the time discovery runs in 2B, the rings are shaped by a confirmed hypothesis, not a category checkbox.

**Scope:** Stop at "interpretation confirmed → discovery endpoint called with confirmed ring hypotheses." Do not modify discovery scoring, do not surface conviction scores, do not split portfolios into test/scale tiers, do not capture promo codes. Those are 2B, 2C, 2D respectively. If a temptation arises to start any of those during 2A — stop and surface it for a sub-phase boundary conversation.

---

## Pre-flight: schema verification (Day 1, before any code)

Phase 1's migration 019 shipped the `ring_hypotheses` table. This spec needs the brand-decision column to carry four states (`pending` / `confirmed` / `rejected` / `refined` / `added_by_brand` — five total including pending and added). The shape was potentially shipped as a boolean (`brand_confirmed`) or as an enum (`brand_decision`).

**Day 1 first task before anything else:**

1. View migration 019 (search project SQL files for 019 prefix).
2. View `lib/data/reasoning-log.ts` and locate the `RingHypothesisRow` TypeScript type.
3. Determine which shape shipped:
   - If **enum** (`brand_decision` column with five allowed values): proceed with no schema work, persist using the existing enum.
   - If **boolean** (`brand_confirmed`): write a small additive migration 021 (idempotent) that adds a `brand_decision` enum column without removing `brand_confirmed`. Backfill `brand_decision` based on `brand_confirmed` for any existing rows (`true` → `confirmed`, `false` → `pending`, NULL → `pending`). Update `RingHypothesisRow` type to include the new column. Leave `brand_confirmed` deprecated but unwritten by new code; document that in a `// DEPRECATED:` comment.

This verification is the one schema fork in 2A. Resolve it before any endpoint code.

---

## Build sequence — 5 layers, each its own commit

Same shape as Phase 1's layered approach: each layer is testable in isolation, each layer's tests pass before moving to the next. Codex review pass after each layer.

### Layer 1 — Pattern library retrieval helper (~half day)

A small function the interpretation endpoint will call. Build this first because it's used by Layer 2.

**File:** `lib/discovery/pattern-library-retrieval.ts`

**Function:** `retrieveAnalogCampaigns(brief: BriefInput): Promise<CampaignPatternRow[]>`

**Logic for 2A (keyword filter, not embeddings):**
- Filter `campaign_patterns` by `aov_bucket` match
- Filter by category overlap (look up if `product_attributes.category` overlaps with any prior campaign's category — substring or array intersection depending on how Phase 1 stored it)
- Return top 10 by recency
- Empty result is a valid result — return `[]`, do not throw

Embedding-based retrieval is the post-launch upgrade. The function signature should be stable so Layer 2's call site doesn't change when the retrieval mechanism evolves.

**Tests (~6):**
- Empty library returns `[]`
- Library with 3 matching campaigns returns all 3
- AOV bucket mismatch excludes records
- Category overlap matches by substring
- Top 10 limit enforced when library has 15 matching campaigns
- Returns sorted by recency

---

### Layer 2 — URL derivation endpoint (~half day)

**File:** `app/api/campaigns/[id]/derive-product/route.ts`

**Contract:**
- `POST` with `{ url: string }`
- Fetches the URL server-side (use existing fetch tooling pattern from Wave 8 onboarding's brand URL handling if it exists)
- Calls the LLM with a prompt asking for structured derivation (see "Prompts" section)
- Returns:
```typescript
{
  brand_name: string,
  category: string,
  product_description: string,
  aov_bucket: 'low' | 'medium' | 'high',
  aov_reasoning: string,  // why this bucket
  key_attributes: string[]  // 3-5 attributes (e.g., "mobile use case", "premium price point")
}
```
- On URL fetch failure (404, timeout, paywall): return `{ error: 'url_unreachable', fallback_required: true }` with 200 status. The web layer surfaces a "paste a paragraph instead" affordance.

**Persistence:** none yet. The brand-confirmed version of this data is what gets saved when the brief is submitted. This endpoint just produces derivation for the read-back card.

**LLM model:** `process.env.LLM_MODEL || 'claude-opus-4-8'`. See "Model selection" section.

**Refusal handling:** if Anthropic API returns `stop_reason: 'refusal'`, retry with explicit `claude-opus-4-8` model parameter once. If both fail, return `{ error: 'derivation_failed' }`. Brief intake should still work — brand can paste a paragraph as fallback.

**Tests (~8):**
- Happy path: clean e-commerce homepage → all fields populated
- SaaS landing page → `aov_bucket` derived from positioning cues, flagged in `aov_reasoning`
- 404 → returns `url_unreachable` error
- Timeout (mock) → returns `url_unreachable` error
- LLM returns malformed JSON → graceful error, no exception
- LLM refusal → fallback attempted, then graceful error
- Mock LLM response with all fields → correctly parsed
- Mock LLM response with missing field → fills with empty string, logs warning

---

### Layer 3 — Brief intake form (~1 day)

**Route:** `/campaigns/new`

**Three sections in order:**

**Section 1 — Product**
- Single field: product URL (required)
- On URL submit (debounced or on blur): calls Layer 2's `derive-product` endpoint
- Renders read-back card showing brand_name, category, product_description, aov_bucket (with aov_reasoning as a tooltip or expandable detail), key_attributes
- Each field is editable inline; brand can correct any AI derivation
- Fallback: "Can't fetch this URL" → switches to a paste-paragraph textarea; AI derivation runs against the pasted paragraph instead

**Section 2 — Customer**
- Single free-text textarea: "Tell us about your customer in your own words."
- Placeholder copy: "Who buys this? What do they care about? What's worked before?"
- No structured demographics, age range, or category fields. The agent reads the truth from this text.
- Prefilled state for returning brands: see Section 5 (returning-brand check-in) below

**Section 3 — Campaign**
- **Goals**: multi-select, capped at 3, from `{ test_channel, scale_winner, direct_response, brand_awareness, lead_gen }`. Use checkbox/chip UI, not dropdown. Optional free-text context field below ("anything we should know about these goals?").
- **Budget**: dollar input, numeric, min $5,000
- **Flight window**: date range picker OR preset selector (`ASAP`, `next_30_days`, `next_60_days`, `Q3_2026`, etc.) — implement both, brand picks
- **Exclusions**: free-text field. "Competitors we shouldn't appear next to, topics we want to avoid." AI parses to structured list at interpretation time.

**Submit button:** "See how I'm reading this →"

**On submit:**
- Server-side: create or update the `campaigns` row with all fields
- Then call the interpretation endpoint (Layer 4)
- Redirect to `/campaigns/[id]/interpretation`

**State management:** This is a multi-step form with async actions (URL derivation runs before final submit). Use whatever pattern matches the existing Wave 8 onboarding flow — don't invent a new state manager.

**Tests (~6):**
- Form renders all three sections
- URL submit triggers derive-product call (mocked)
- Read-back card renders derived fields
- Brand edits to read-back card persist on submit
- Goals multi-select enforces 3-item cap
- Submit creates campaign record with all fields

---

### Layer 4 — Brief interpretation endpoint (~1 day)

The heart of 2A. This is where reasoning happens.

**File:** `app/api/campaigns/[id]/interpret/route.ts`

**Contract:**
- `POST` with no body (reads campaign by ID from URL param)
- Loads the campaign record, including brand-confirmed product derivations and the rest of the brief
- Calls `retrieveAnalogCampaigns()` (Layer 1)
- Constructs the interpretation prompt (see "Prompts" section) with: brief inputs, derivations, analog campaigns as context, returning-brand context (see Section 5)
- Calls LLM
- Parses JSON response
- Persists via `recordCampaignPattern()` (once), `recordRingHypothesis()` (per ring proposed), `recordAnalogMatch()` (per analog cited)
- Returns the parsed interpretation for the page to render

**Output schema (JSON the LLM must produce):**

```typescript
{
  campaign_pattern: {
    customer_summary: string,  // AI's read of who the customer actually is
    interpretation_confidence: 'high' | 'medium' | 'low' | 'speculative'
  },
  primary_ring: {
    ring_label: string,        // short label, e.g. "biohacking-adjacent wellness"
    confidence: 'high' | 'medium' | 'low' | 'speculative',
    reasoning: string,         // 2-3 sentences max, names analogs and dimensions
    analog_campaigns: string[] // brand names of analogs cited (e.g., ["Plunge", "Therabody"])
  },
  lateral_rings: [
    {
      ring_label: string,
      confidence: 'high' | 'medium' | 'low' | 'speculative',
      reasoning: string,
      analog_campaigns: string[]
    }
    // 2-4 default, soft cap at 6
  ]
}
```

**Persistence detail:**
- `recordCampaignPattern()` writes the canonical campaign record. Stores: product_attributes (from brand-confirmed derivation), customer_description (raw brief), customer_summary (AI-derived), aov_bucket, goals, budget, flight_window, exclusions (raw + parsed), effective_scoring_weights (from `getEffectiveWeights({ aovBucket })`), interpretation_confidence.
- `recordRingHypothesis()` writes once per proposed ring. `brand_decision` field starts as `'pending'`. Stores: ring_kind ('primary' | 'lateral'), ring_label, confidence, reasoning, analog_campaigns array.
- `recordAnalogMatch()` writes once per analog campaign cited. Foreign key to the historical `campaign_patterns` row. If the cited brand name doesn't match any campaign in the library, **don't fabricate the match** — log a warning, skip the record. The interpretation_confidence label is already capturing the speculative state.

**Refusal handling:** same as Layer 2 — retry on refusal with explicit Opus 4.8 fallback. If both fail, return error to the page, brand sees "We hit an issue interpreting your brief. Refresh to try again." Persistence is fail-soft per Phase 1's contract — pattern library writes never block the response.

**Tests (~10):**
- Happy path with seeded library: campaign_patterns row created, ring_hypotheses populated, analog_matches populated
- Empty library: campaign_patterns + ring_hypotheses created, zero analog_matches records (correct behavior)
- LLM returns 5 rings: all persist, no truncation
- LLM returns 7 rings (over soft cap): all persist with a warning logged, no truncation (let the data show what the model wanted to do)
- LLM cites analog brand not in library: warning logged, analog_matches row skipped
- `recordCampaignPattern()` fails (mocked): interpretation still returns to brand, error logged
- LLM returns malformed JSON: error returned, no partial persistence
- LLM refusal: fallback attempted
- High AOV brief: effective_scoring_weights reflects AOV tilt
- All confidence values from LLM persist correctly to enum columns

---

### Layer 5 — Interpretation page + confirmation flow (~1 day)

**Route:** `/campaigns/[id]/interpretation`

**Page structure (three zones, single page, no modals):**

**Zone A — Primary read** (top)
- Card with one-sentence interpretation, confidence badge, 2-3 sentence reasoning
- Inline analog citations highlighted as readable inline references (not links — they're brand names, not navigable)
- "That's not quite right — refine" affordance
- On click: text input appears in place, brand types correction, submit triggers refinement (see refinement flow below)

**Zone B — Lateral rings** (middle)
- Each ring rendered as a card: label, confidence badge, one-sentence reasoning
- Three controls per ring: `Include` / `Skip` / `Refine`
- **Defaults**: high + medium confidence → pre-selected `Include`; low + speculative → pre-selected `Skip`
- `Refine` opens an inline text input (same pattern as primary refinement); submitting triggers refinement for that ring specifically
- "Add a ring I missed" affordance at the bottom of the rings list — opens a text input, brand types a new ring framing, AI generates structured ring (label + confidence + reasoning) and adds it to the list with `brand_decision = 'added_by_brand'`

**Zone C — Confirm and run** (bottom)
- Single CTA: "Confirm interpretation and discover shows"
- Summary copy: "Discovering shows across [N confirmed rings] within your $[X] [test_channel/scale_winner] budget."
- On click: writes brand decisions to `ring_hypotheses` (confirmed/rejected per ring), redirects to discovery view

**Refinement flow (primary OR lateral):**
- Brand submits refinement text
- Backend creates a new ring hypothesis row reflecting the AI's updated proposal
- Sets the old ring's `brand_decision` to `'refined'`
- New row's `brand_decision` is `'pending'`
- Page re-renders with new ring in place of old (visually replacing, but both persist in DB)
- Refinement counter increments; after 3 refinements on the same ring, page shows "Want to start over?" link returning brand to `/campaigns/new` with brief prefilled

**Speculative-state UI variation:**
- If `interpretation_confidence === 'speculative'` AND all rings are speculative/low:
  - Primary card uses softer language: "I'm reasoning from first principles here — no strong analogs in the library yet."
  - CTA summary softens: "Low confidence on this brief. Worth treating as a small test before scaling."
- Pure CSS/copy variation, no separate page

**Tests (~10):**
- Page renders with mocked interpretation response
- High-confidence rings pre-selected Include
- Speculative rings pre-selected Skip
- Click "Refine" on primary: text input appears, submit triggers refinement endpoint
- Refinement counter increments after submission
- After 3 refinements, "start over" CTA visible
- "Add a ring I missed" creates new ring hypothesis with brand_decision='added_by_brand'
- Confirm CTA writes brand_decision values correctly to all rings
- Confirm CTA redirects to discovery view
- Speculative-all-rings state: softer copy renders

---

## Returning brand check-in (Layer 3 sub-flow)

Per the agentic design principle, returning brands should not see a form prefilled with their previous answers. They should see an agent-style check-in.

**Detection:** on `/campaigns/new`, check if the brand has any prior `campaign_patterns` rows. If yes, the brand is returning.

**Returning-brand intake variant:**

Instead of three empty sections, show:

> "Welcome back. Last time I read your customer as **[previous campaign's customer_summary]**. Anything changed about the customer, product, or what's working since then?"

Two response controls:

- **"Nothing has changed"** button → routes brand directly to Section 3 (Campaign decisions: goals, budget, flight, exclusions). Section 1 and 2 inputs use the prior campaign's values silently in the interpretation prompt.
- **Free-text "Yes, here's what's changed"** input → brand types the delta. On submit, this delta is appended to the brief as additional context. Interpretation prompt receives prior context + delta.

**Escape hatch:** "Actually, treat this as a new brief" link drops to full first-time intake.

**Persistence note:** the previous campaign's data isn't copied to the new campaign. The new `campaign_patterns` row records what the brand confirmed *for this campaign*, including any deltas. If brand says "nothing changed," the new row will look very similar to the previous one — that's correct, each campaign is its own pattern.

**Tests (~4):**
- First-time brand sees full form
- Brand with prior campaign sees check-in
- "Nothing changed" routes to campaign decisions only
- Free-text delta passed to interpretation prompt
- "Treat as new brief" escape hatch drops to full intake

---

## Prompts

Two prompt files. Both live at `lib/prompts/`. Both are markdown for readability and easy diff review.

### `lib/prompts/derive-product.md`

Used by Layer 2's URL derivation endpoint. Smaller, focused prompt.

**Structure:**
1. Brief role framing ("you are extracting structured data from a product page")
2. Task: "Given the page content below, produce JSON matching this schema..."
3. Schema specification (TypeScript-like format the model can follow)
4. AOV bucket guidance:
   - `low`: < $50 average order
   - `medium`: $50-$500
   - `high`: > $500
   - When unclear (e.g., "contact us for pricing" SaaS), infer from positioning and label `aov_reasoning` accordingly
5. Output format strict: JSON only, no preamble or explanation

### `lib/prompts/interpret-brief.md`

Used by Layer 4's interpretation endpoint. This is the file that gets iterated 80→95 post-ship.

**Structure:**

1. **Role framing:** "You are a veteran podcast and YouTube sponsorship media buyer with 20 years of experience placing direct-response and brand campaigns across creator media."

2. **Mission:** "Given a brand's campaign brief, produce 1 primary ring + 2-4 lateral rings (up to 6 if the product genuinely supports more, but never pad). Each ring is a customer-frame the brand can run a campaign against."

3. **Quality bar:**
   - Confidence honesty: "speculative" is a valid label. Hedging everything to "medium" is the wrong move. Be calibrated.
   - Lateral leaps: surface customer truths the brand didn't articulate. The Section 5 example — "you mentioned mobile, that opens overlanders" — is the moment of value.
   - Specificity: name analogs by brand. Cite dimensions ("audience over-indexes on premium recovery purchases"). No horoscope reasoning.
   - Voice: direct, industry-fluent, no over-qualification. Talk like a buyer who's bought a thousand deals.
   - No padding: if the product genuinely has only 2 lateral rings, return 2. Filler rings dilute the brand's signal.

4. **Few-shot examples** (3 worked examples — see "Pattern library seeding" below for context; these are inline in the prompt file):
   - Example 1: SaunaBox-shape brand (D2C premium wellness, $399-$2,799, mobile, recovery positioning)
   - Example 2: B2B SaaS (annual contract, $5-50k ACV, specific role-based ICP)
   - Example 3: Low-AOV consumer (DTC subscription, $20-50/month, mass-market wellness)
   
   Each example shows input → desired JSON output. Examples reference fake analog campaigns; the actual prompt at runtime gets real analogs injected dynamically.

5. **Pattern library context (dynamically injected):**
   ```
   Relevant prior campaigns from your library:
   [List of 0-10 analog campaigns with attributes and outcomes if library is seeded]
   ```
   If library is empty: "Pattern library is empty — reason from first principles. Label all confidence speculative or low."

6. **Returning-brand context (dynamically injected, if applicable):**
   ```
   This brand has run prior campaigns. Previous customer summary: [text]
   Delta since last campaign: [brand's free-text response, or "no changes"]
   Previous ring outcomes: [if available — for 2A this section will often be empty]
   ```

7. **Output format spec:** JSON schema from Layer 4, strict, no preamble or explanation.

**A note for future tuning:** Fable-class models tend to perform best with less prescriptive prompts. Initial prompt ships with this scaffolding for clarity. During post-ship tuning, the right direction is to *remove* scaffolding and let the model reason more freely, not to add more rules. Document this in a comment at the top of the prompt file.

---

## Model selection

**Configuration:**
- New env var: `LLM_MODEL`, defaulting to `claude-opus-4-8`
- All LLM calls use `model: process.env.LLM_MODEL || 'claude-opus-4-8'`
- Centralize the SDK client creation in `lib/llm/client.ts` if it doesn't already exist; both prompts route through it

**Rationale for default:**
- Opus 4.8 is in the existing stack, well-understood
- ~$0.05 per interpretation at typical brief size (3-5k input + 1-2k output)
- Fable 5 is ~$0.10 per interpretation (2x price). Justified only if real-brief testing shows materially sharper output, which is an empirical question to answer post-ship.

**Refusal handling pattern (apply to both Layer 2 and Layer 4):**
```typescript
async function callLLMWithFallback(prompt: ...) {
  const primary = await sdk.messages.create({ model: process.env.LLM_MODEL || 'claude-opus-4-8', ... });
  if (primary.stop_reason === 'refusal') {
    log.warn('llm_refusal', { model, stop_details: primary.stop_details });
    return await sdk.messages.create({ model: 'claude-opus-4-8', ... });
  }
  return primary;
}
```

Brief interpretation should never hit the refusal classifier (no cyber, bio, distillation content), but the fallback is cheap insurance.

---

## Domain events

Per CLAUDE.md, every meaningful state transition fires a domain event. Add the following:

- `brief.url_derived` — when Layer 2 succeeds
- `brief.url_derivation_failed` — when Layer 2 fails
- `brief.submitted` — when brief intake form successfully creates campaign row
- `brief.interpretation_completed` — when Layer 4 succeeds
- `brief.interpretation_failed` — when Layer 4 fails
- `brief.refinement_submitted` — when brand refines primary or a lateral
- `brief.interpretation_confirmed` — when brand hits the confirm CTA

Use existing `logEvent()` pattern. Fail-soft contract.

---

## What does NOT ship in 2A

Explicit non-goals — surface for sub-phase boundary if temptation arises:

- Conviction scoring per show (2B)
- Three-dimensional sub-scores (audience fit, topical relevance, purchase power) on discovery output (2B)
- Test portfolio vs scale tier split (2C)
- Founder annotations UI (2D)
- Promo code / UTM capture at IO time (2D)
- Embedding-based pattern library retrieval (post-launch)
- iMessage / Slack messaging surface (Wave 15+)
- Named agent persona "Tay" (GTM/branding work, separate)
- Brand onboarding (Wave 8) modifications — separate polish backlog item
- Auth unification (deferred per existing CLAUDE.md decision)

If Codex review surfaces "you should also..." pointing at any of the above — answer is no, that's a different sub-phase.

---

## Pattern library seeding (pre-req, async during build)

Spec note for Chris: 20-50 analog campaigns from your media-buying memory should be seeded into `campaign_patterns` before prompt iteration produces best results. This is async during the 3-day build — doesn't block any Layer.

Each seeded campaign needs: product_attributes (brand name, category, AOV bucket), customer_description, customer_summary, target rings (as ring_hypotheses rows with `brand_decision='confirmed'`), outcomes (if known — converted shows, repeat rates).

Examples to seed first (high-leverage given they're cited in Section 5 and likely few-shot territory):
- Plunge campaigns (Huberman, Modern Wisdom, Found My Fitness)
- Therabody / Hyperice campaigns
- Athletic Greens / AG1 (Rogan, Tim Ferriss, Huberman)
- Higher Dose
- 1-2 B2B SaaS examples for non-wellness coverage

Seeding can happen via SQL inserts or via a small admin UI — Chris's preference. For 2A scope, SQL inserts via Supabase SQL Editor is sufficient.

---

## Testing summary

Total target: 40-50 new tests across the 5 layers.

**Distribution:**
- Layer 1 (retrieval helper): ~6 tests
- Layer 2 (URL derivation): ~8 tests
- Layer 3 (intake form): ~6 tests
- Layer 4 (interpretation endpoint): ~10 tests
- Layer 5 (interpretation page): ~10 tests
- Returning-brand check-in: ~4 tests
- Edge cases (fail-soft, empty library, malformed LLM responses): ~5 tests

**All LLM calls in CI are mocked.** No real Anthropic API calls in the test suite. Mock responses use deterministic fixtures (saved JSON files of representative LLM responses across happy path and edge cases).

Manual real-LLM validation happens before merge — Chris runs a few real briefs through the deployed dev environment and reads the output.

---

## Build order recap

1. **Day 1 morning:** Schema verification + Layer 1 (pattern library retrieval helper) + first tests
2. **Day 1 afternoon:** Layer 2 (URL derivation endpoint) + tests
3. **Day 2 morning:** Layer 3 (intake form) + returning-brand check-in + tests
4. **Day 2 afternoon:** Layer 4 (interpretation endpoint) + tests
5. **Day 3 morning:** Layer 5 (interpretation page) + tests
6. **Day 3 afternoon:** Integration test pass, Codex adversarial review, fixes

After 2A ships, prompt tuning begins against real briefs. That's its own work stream, not a 2A acceptance criterion. 2A is "shipped" when all layers are in production and the schema/UI are stable.

---

## Working style notes for this session

- Plan mode before each layer
- Worktrees disabled (per CLAUDE.md, solo founder, adds confusion)
- Adversarial review pattern after each layer: Claude Code self-review → Codex review → Codex adversarial → flag to Chris for plain-English interpretation against intended design
- Migrations always copy-paste-ready for Supabase SQL Editor (Chris is not a CLI user for migrations) — if any migration is needed, output the full SQL block for Chris to paste
- Don't move past a layer's tests being green
- If a design decision in this spec proves wrong during build, stop and surface — don't silently re-spec

When in doubt, the priority order: TAYLSLATE_CONTEXT.md Section 5 > this spec > general engineering judgment.
