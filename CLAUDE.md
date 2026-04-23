# CLAUDE.md — Taylslate Project Context

*Last updated: April 23, 2026*

**For deep strategic context, competitive research, and domain knowledge, see `TAYLSLATE_CONTEXT.md` in this project folder.**

---

## What is Taylslate

Taylslate is the **infrastructure layer for creator sponsorship advertising** — podcasts, YouTube, and eventually wherever host-endorsed advertising lives. It replaces the manual, weeks-long process of campaign planning, deal negotiation, insertion order management, delivery tracking, invoicing, and payment with one AI-powered platform.

**The one-liner:** "Facebook Ads for podcast reads." Plan your campaign. Reach out to shows. Send your IOs. Ads run. We verify. You get paid. All in one place.

**The thesis:** Creator sponsorship is a $6B+ market growing 20%+ annually, but the buying process is stuck in 2015. Digital media has programmatic infrastructure. Creator sponsorship has email threads, Word docs, and 90-day payment terms. Taylslate closes that gap.

## Core Thesis

The most valuable data in podcast advertising — real CPM rates, verified download performance, advertiser retention, conversion signals — does not exist in any API. Taylslate captures this data by facilitating the actual transaction. Every deal makes the AI smarter. The moat is the data. Everything else is a mechanism to capture it.

**Preference-based recommendation is the differentiator.** VeritoneOne pitches "we know shows because we have relationships" (Rolodex). Taylslate pitches "we know shows because we've learned what you like" (preference). Spotify/Netflix pattern applied to ad inventory.

## User Types

- **Brands / Advertisers:** Mid-market brands entering or expanding in podcast/YouTube ads. Real buyers start at $20K/month. Want fast campaign planning, transparent pricing, audience fit confidence.
- **Sales Agents / Networks:** Represent multiple podcasts and YouTube channels. Handle outreach response on behalf of shows. Most marketable shows are repped, so outreach is forwarded to agents who respond in the show's place.
- **Shows / Creators:** Podcast hosts and YouTube creators selling ad inventory. Want brand deals, fair pricing, fast payment. Shows under 10K downloads are systematically ignored by agencies — Taylslate serves them.
- **Agencies & Buyers:** Late adopters with workflow inertia. Not a launch priority.

## The Full Loop

**User flow (outreach-first model — confirmed April 2026):**

1. Brand runs discovery → selects shows → builds media plan
2. Brand drafts outreach email per show (Claude-drafted, brand edits), proposes terms (CPM, episodes, placement, flight dates)
3. Email goes to show's Podscan contact with unique signed link
4. Show (or their agent) clicks link → lands on brand-forward pitch page at `/outreach/[token]`
5. **If not onboarded:** magic link → Wave 9 onboarding → return to pitch page
6. **If onboarded:** straight to deal confirmation
7. Show responds: Accept / Counter / Decline (one round of negotiation)
8. Brand notified → builds IO (Wave 12)
9. IO signed via third-party e-signature (Wave 12)
10. Ads run → verified → brand charged → show paid (Wave 13, pay-as-delivers)

## Build Status (April 23, 2026)

**All core waves complete:**
- Wave 4: Podscan integration layer (`lib/podscan/`, 11 files)
- Wave 5: Scoring engine (`lib/scoring/`, 4-dimension weighted scoring)
- Wave 6: Discovery list UI (scored list, filters, sort, checkbox selection)
- Wave 6.5: English filter + single text-area brief with Claude parsing + graceful API error fallback
- Wave 7: Media plan builder (line items, placement adjustments, pricing)
- Wave 8: Brand conversational onboarding (10 steps) + brand profile entity
- Wave 8.5: Onboarding fixes
- Wave 9: Show conversational onboarding (12 steps — added contacts step in Wave 11) with CPM education layer
- Wave 10: Brand-profile-aware campaign creation with overrides
- **Wave 11: Outreach-to-onboarded-show loop (April 23, 2026)**
  - Outreach entity + schema (migrations 011, 012)
  - Brand-facing composer with Claude-drafted pitch + editable terms
  - Public pitch page at `/outreach/[token]` with dual-state logic (onboarded vs not)
  - Magic link account creation flow
  - Wave 9 +1 step for ad_copy_email + billing_email
  - Accept / Counter / Decline actions with brand notifications
  - HS256 token signing for outreach + magic links
  - Rate limiting (5/min per token), terminal-state handling
  - Public routes allowed in `proxy.ts`

**Tests:** 121 passing (Vitest), up from 83

**Remaining:**
- **Wave 12:** IO generation + third-party e-signature (BoldSign or Dropbox Sign preferred). Signed PDF + certificate stored permanently in Supabase.
- **Wave 13:** Stripe charging on pay-as-delivers model — SetupIntent at IO signature, charged per verified delivery, show payout follows each charge. ACH routing UX as margin lever.
- Podscribe integration for automated verification
- Scoring engine tuning (show pool variety, fewer sleep shows for wellness brands)
- Security audit (RLS policies, API key exposure, webhook verification, rate limiting)
- Stripe SDK module-load error fix (pre-existing, blocks clean build — address before Wave 13)
- MCP server for agent access

## Architecture Philosophy

**Agent-native design.** The web app is the on-ramp. The API is the real product.

1. **Database and API** — structured data layer that persists across agent sessions
2. **Domain logic engine** — IO formatting rules, CPM calculations, make-good thresholds, invoice generation
3. **Aggregated intelligence layer** — grows with every transaction
4. **Packaged skills / MCP server** — so AI agents can interact with Taylslate's data and logic
5. **Lightweight web UI** — for onboarding, review, and approval

**Integration philosophy:** Don't build bespoke integrations to every platform. Build a clean API that agents can bridge. Exception: Podscribe for verification, third-party e-signature (BoldSign/Dropbox Sign/DocuSign) — these are core infrastructure worth direct integration.

**The signing event is third-party. The record is Taylslate's.** Signed PDFs and certificates of completion are stored permanently on every deal in Supabase storage. This is the deal history product surface that nothing else in podcast advertising offers.

## Tech Stack

- **Framework:** Next.js (App Router) with TypeScript
- **Styling:** Tailwind CSS 4 with custom CSS variables (see `app/globals.css` for design tokens)
- **Database:** Supabase (Postgres + Auth)
- **Deployment:** Vercel
- **AI:** Claude API (campaign planning, outreach drafting, data extraction)
- **Email:** Resend
- **Auth:** Supabase Auth + magic link for show onboarding
- **Payments (planned Wave 13):** Stripe Connect for marketplace payments, pay-as-delivers model
- **E-signature (planned Wave 12):** BoldSign or Dropbox Sign preferred (Dropbox account already exists)
- **Verification (planned):** Podscribe API integration

## Revenue Model (locked April 22, 2026)

- **8% all-in platform fee** for self-serve brands (absorbs Stripe fees)
- **10% managed tier** — Chris-as-operator running campaigns for brands that want hands-on service
- No SaaS subscription, no early-payout fee, no metered discoveries
- Claude API costs are a rounding error (~0.05% of revenue per deal)
- Stripe is the real margin lever — ACH routing vs. card is the biggest untapped optimization
- Future revenue: paid show verification (Phase 3), data licensing (at scale)

## Outreach Flow Architecture (Wave 11)

**Public routes (no auth required):**
- `/outreach/[token]` — pitch page, dual-state
- `/auth/magic` — magic link landing (sent / error states)
- `/auth/magic/verify` — consume magic token, create account, redirect

**Outreach entity fields (see `lib/data/types.ts`):**
- `proposed_cpm`, `proposed_episode_count`, `proposed_placement`, `proposed_flight_start`, `proposed_flight_end`
- `pitch_body` — editable email copy
- `response_status` — pending | accepted | countered | declined | no_response
- `counter_cpm`, `counter_message`, `decline_reason`
- Token signed with `OUTREACH_TOKEN_SECRET`, no expiry until status transitions to terminal state

**Dual-state logic:**
- Match outreach's `sent_to_email` against existing `profiles.email` where a `show_profile.onboarded_at` exists
- If match: token issues short-lived session, pitch page shows Accept / Counter / Decline
- If no match: pitch page shows "Interested — set up your account" → magic link → Wave 9 → return URL stored in magic token payload

**Brand-forward styling:** from-name on emails is brand name, not "Taylslate". Header on pitch page: "[Brand] wants to work with [Show]". Taylslate branding is a small footer mentioning "payments powered by Taylslate". Professional tone throughout — match VeritoneOne IO email style, not startup marketing copy.

## Project Structure

```
app/
  page.tsx                          # Landing page
  globals.css                       # Design tokens
  outreach/[token]/                 # Public pitch page (Wave 11)
  auth/magic/                       # Magic link flow (Wave 11)
  (dashboard)/
    layout.tsx                      # Authenticated layout
    campaigns/
      [id]/
        page.tsx                    # Discovery list
        plan/page.tsx               # Media plan builder
        outreach/page.tsx           # Outreach management (Wave 11)
    settings/page.tsx
  onboarding/
    show/                           # 12-step show onboarding (Wave 9 + Wave 11 contacts step)
    brand/                          # Brand onboarding
  api/
    outreach/                       # Create + action endpoints (Wave 11)
    auth/magic/                     # Magic link routes (Wave 11)
components/
  layout/Sidebar.tsx
  outreach/                         # Composer modal, show list (Wave 11)
lib/
  data/
    types.ts                        # All TypeScript types
    queries.ts                      # Supabase query functions
    seed.ts                         # Dev seed data
  podscan/                          # Podscan API client layer
  scoring/                          # Scoring engine
  prompts/
    brief-parser.ts                 # Claude-powered brief → structured input
    outreach-draft.ts               # Claude-powered outreach drafting (Wave 11)
  io/
    tokens.ts                       # HS256 JWT sign/verify for outreach + magic (Wave 11)
  email/
    templates/                      # Resend email templates (outreach, magic, notifications)
  utils/
    pricing.ts                      # Spot price, placement adjustments, blended CPM
  supabase/                         # Supabase client config
proxy.ts                            # Public route allowlist (Wave 11 update)
```

## Domain Knowledge — Podcast Advertising

### Pricing
- **CPM pricing:** Ad Spot Price = (Downloads ÷ 1,000) × CPM Rate. Range: $15–$50.
- **Placements:** Pre-roll, mid-roll (standard, highest rate), post-roll.
- **Price types:** CPM-based or Flat Rate (with make-good if underdelivery >10%).
- **YouTube:** Flat-fee pricing, $2K–$20K based on cultural significance. Content is evergreen.

### IO Structure
Per-episode line items: format, post date, guaranteed downloads, show name, placement, scripted Y/N, personal experience Y/N, reader type, evergreen/dated, pixel Y/N, gross rate, gross CPM, price type, net due.

### Standard IO Terms
- Competitor exclusivity (90 days typical)
- ROFR (30 days)
- Make-good clause (>10% underdelivery triggers free additional placement)
- 45-day download tracking window
- Net 30 EOM payment (routinely violated in industry — agencies pay Net 60–75+)

### Agency Markup Context
Agencies mark up CPM to brands (e.g., show's $25 CPM → agency charges $29.41 ~15%). Taylslate's 8% all-in is the anti-VeritoneOne transparency pitch.

### Ad Copy Philosophy
3-5 bullet point talking points, not full scripts. Host authenticity is the value. No pre-approval review — verification is post-publication (Podscribe).

### VeritoneOne IO Template
Reference document in project files. Uses DocuSign for e-signature (DocuSign Envelope ID visible on every page). Use as format standard for Taylslate IO generation in Wave 12.

## Conventions

### Code & data
- Use `var(--brand-*)` CSS variables for all colors, not hardcoded values
- Build clean API endpoints from day one — the web UI is one of several future interfaces
- Schemas and forms must match real-world industry documents and processes
- All monetary values in USD, stored as numbers
- Dates stored as ISO strings
- Public routes must be added to `proxy.ts` allowlist

### Git — REQUIRED, no exceptions
- Auto-commit after each logical chunk with clear messages
- ALWAYS `git add`, `git commit`, `git push` — no exceptions

### Supabase migrations — REQUIRED, no exceptions
All migration files must be idempotent — safe to re-run without error if they've already been applied in whole or in part. This is non-negotiable because Chris pastes migrations directly into the Supabase SQL Editor, not via CLI, and partial failures leave state that breaks naive re-runs.

Idempotency rules:
- **Tables:** `CREATE TABLE IF NOT EXISTS`
- **Columns:** `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- **Indexes:** `CREATE INDEX IF NOT EXISTS`
- **Triggers:** `DROP TRIGGER IF EXISTS <name> ON <table>; CREATE TRIGGER ...` (Postgres has no `CREATE TRIGGER IF NOT EXISTS`)
- **RLS policies:** `DROP POLICY IF EXISTS "<name>" ON <table>; CREATE POLICY ...` (Postgres has no `CREATE POLICY IF NOT EXISTS`)
- **Functions:** `CREATE OR REPLACE FUNCTION`
- **Enum types:** wrap in `DO $$ BEGIN ... IF NOT EXISTS ... END $$;` blocks
- **Constraints:** query `information_schema.table_constraints` before adding, or use `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`

When a migration cannot be idempotent (rare — e.g. data backfills), wrap the non-idempotent portion in a guard that checks whether the work has already been done.

## Competitive Context (Quick Reference)

- **LiveRead.io** — IO/invoice management, real integrations, but no AI, no discovery, no campaign planning.
- **Gumball.fm** — Host-read ad marketplace (Headgum). 150+ shows. Limited to own network inventory.
- **SpotsNow** — "Hotel Tonight for podcast ads." Last-minute inventory marketplace. 10% cut. Competes on timing/remnant, not discovery.
- **CreatorExchange** — 25% cut. Competitor.
- **Podscribe** — Verification and attribution (IAB-certified). Integrate, don't compete.
- **Traditional agencies (VeritoneOne, Ad Results Media)** — 15-20% markup, manual processes, ignore small shows.

## Founder Working Style

- Prefers focused, step-by-step explanations over comprehensive overviews
- Works iteratively — strategy → confirm → prompt → ship → update docs
- Values authentic industry modeling — schemas must match real-world documents
- Uses Claude Code for building (disable worktree, work on main)
- Uses Claude desktop app for strategy and planning conversations
- Think as a co-founder, not just an assistant
- Motivated by bold launches, not incremental releases
