# CLAUDE.md — Taylslate Project Context

*Session-invariant reference only. Current build state, test count, and migration state live in STATUS.md — do not record them here. Last restructured July 6, 2026 (the wave-by-wave narrative and dated reference moved to docs/WAVE_HISTORY.md).*

## Context Map

- **STATUS.md** — current state: what shipped, current wave, next, test count, migration state. The volatile snapshot. Read it first.
- **PRODUCT_BACKLOG.md** — the queue: pre-launch backlog, post-launch / customer-driven, killed ideas.
- **docs/WAVE_HISTORY.md** — wave-by-wave build narrative (Waves 1-14), Wave 12/13/14 integration references, and the as-of-a-date sections moved out of this file (pricing model, attribution philosophy, data schema detail, project structure, discovery reasoning, competitive, build queue).
- **TAYLSLATE_CONTEXT.md** — deep strategy, discovery-agent thesis, competitive research, domain depth.
- **docs/WAVE_14_PHASE_2*_SPEC.md**, **docs/podscan-api.md**, **docs/FUTURE_FEATURE_ROADMAP.md** — per-wave specs + API reference.

## What is Taylslate

Taylslate is **Layer 3 infrastructure for podcast and long-form YouTube sponsorship advertising** — the transaction data layer and payment rail for brands, shows, and eventually AI agents. It replaces the manual, weeks-long process of campaign planning, deal negotiation, IO management, delivery tracking, invoicing, and payment with one AI-powered workflow.

- **Positioning:** "Facebook Ads for podcast reads." Brand enters URL + budget + demographics; Taylslate returns a scored discovery list of 50-100 shows; brand selects, platform builds the media plan. Every transaction captured makes the AI smarter — that's the moat.
- **Target user:** Brands *new* to podcast/YouTube creator advertising (not heavy spenders who have agencies, not agencies themselves). Market education is core GTM.
- **Mediums:** Podcast (RSS-driven audio) + long-form YouTube (channel). YouTube Shorts excluded. Simulcast = one channel, two surfaces.
- **Fee model (locked April 28, 2026):** PAYG 10% transaction (brand entry, no SaaS) → Operator $499/mo + 6% (breakeven ~$12.5K/mo spend, sales-led upgrade) → Agency $5,000/mo + 4% (white-label). Future API/MCP per-call+per-deal. Transparent vs. VeritoneOne-style 15-20% hidden markups. Full plan detail in docs/WAVE_HISTORY.md.

**Core thesis:** The most valuable data in podcast advertising — real CPMs, verified performance, advertiser retention, conversion signals, *what converts on what show with what host* — exists in no API. Taylslate captures it by facilitating the actual transaction. Three forcing functions: (1) automated verification (Podscribe/RSS, planned), (2) payment facilitation (Wave 13), (3) discovery reasoning library (Wave 14). Monaco.com analogy: one AI-native system of record where intelligence compounds with usage.

**User types:** Brands/Advertisers (mid-market $30-50K/mo budgets, primary target) · Shows/Creators (podcast + long-form YouTube; serves sub-10K-download shows agencies ignore) · Sales Agents/Rep companies (Wave 15+; `agent_show_relationships` exists, UX doesn't) · Agencies (deferred; tier exists).

## Architecture & Product Principles

**Agent-native design — the web app is the on-ramp, the API is the real product.** Layers: (1) database + API (persists across agent sessions), (2) domain logic engine (IO rules, CPM math, make-good thresholds, invoicing), (3) aggregated intelligence layer (pattern library, conviction reasoning, outcomes — grows with every transaction), (4) packaged skills / MCP server, (5) lightweight web UI. Build order: web app captures data → clean API day one → skills/MCP → web app becomes one of several interfaces.

**Integration philosophy:** don't build bespoke integrations to every platform — build a clean API agents bridge. Direct-build exceptions (regulatory / core-value): Podscribe, DocuSign, Stripe Connect.

**Agentic product test — every form field: "Is this asking for a decision, or for mechanical work?"** Decisions stay manual (budget, goals, exclusions, final sign-off). Mechanical work is AI-derived with human confirm/edit (brand name, category, demographics, CPM defaults, pitch drafting). Forms ask; conversations suggest and refine. Reserve human input for what the AI cannot infer — privileged customer knowledge, business decisions, confirmation of AI interpretation. The discovery interpretation checkpoint is canonical: AI proposes 1 primary read + 2-4 lateral rings → brand confirms/refines → AI runs autonomously through ring location, scoring, sampling, portfolio.

## Gotchas & Invariants

Load-bearing standing rules swept from every wave. Reintroducing any of these silently breaks something.

**Auth & admin (hard-won June 28, 2026):**
- **The only auth callback route is `/callback`** (`app/(auth)/callback/route.ts`; the `(auth)` route group is stripped from the URL). There is **NO `/auth/callback`** — a redirect there 404s. Every `redirectTo` / magic link targets `/callback`.
- **`proxy.ts` (repo root) is the auth gate** (Next 16 renamed `middleware`→`proxy`). It bounces unauthenticated requests to `/login?next=…` unless the path is in its `isPublicRoute` allowlist. **Any new signed-out-reachable route MUST be added there** or its handler never runs.
- **`admin.generateLink()` returns implicit-flow links** (session in the `#access_token=…` fragment — unreadable by a server route; no `?code=`). Read `properties.hashed_token`, build `/callback?token_hash=…&type=magiclink&next=…`, verify with `verifyOtp({ type, token_hash })`. `/callback` handles both a `token_hash` branch (admin-minted) and a legacy `code` branch (browser PKCE).
- **Validate any `next` to a same-origin path before redirecting** (`${origin}${next}` with `next=@evil/x` is an open redirect).
- **Admin gate is `isInternalAdmin(email)` (`lib/auth/admin.ts`)** reading `INTERNAL_ADMIN_EMAILS` — must be set in Vercel prod AND `.env.local`. Powers founder annotations, mark-delivered, impersonation. Impersonation (`POST /api/admin/test-login`) layers gates (401/403/400); `TEST_ACCOUNTS` (`lib/admin/test-accounts.ts`) is the only impersonable set — keyed, never a raw email/id from the client.
- **The `tslate_impersonation_origin` cookie is unsigned** — do NOT trust its `adminId`/`adminEmail`; resolve admin identity server-side via an opaque token, not the plaintext.
- **Supabase config (manual):** `https://www.taylslate.com/callback` must be in the auth Redirect URLs allowlist; `NEXT_PUBLIC_SITE_URL` = the `www` host in prod (apex 307s to `www`).

**Financial (Wave 13):**
- **Show payout never releases until the inbound brand payment is `succeeded`** (not `processing`). Zero float risk. Hard rule.
- **Per-customer dynamic fee: `profiles.platform_fee_percentage` is the source of truth** — Stripe `application_fee_amount` is computed per-charge from it; never hardcode. Snapshot `platform_fee_percentage_at_charge` on every payment so a later plan change can't rewrite history.
- **Stripe webhook idempotency:** every handler checks prior processing via the `payments.stripe_payment_intent_id` unique index before mutating.

**Data & audit:**
- **Domain events never throw.** `logEvent()` / `logEventLog()` swallow errors — audit-log failures must never block the main flow. Fire a domain event on every state transition (`entity.action`: `deal.created`, `outreach.accepted`, `envelope.signed`).
- **Reasoning persistence is non-negotiable for any AI surface** — every AI decision writes a structured record via `lib/data/reasoning-log.ts` or `lib/data/event-log.ts`. Lost training data is expensive.

**Postgres / RPC:**
- **New RPCs default to `SECURITY INVOKER`** (matching migration 024), not `DEFINER`, unless a specific reason requires otherwise.
- **Prefer sentinel-row idempotency over Postgres advisory locks** — a row's atomic visibility is the completion sentinel (e.g. `persist_interpretation`'s `campaign_patterns` row; `interpretation_locks` with TTL expiry for crash-orphans).
- **Catch specific PL/pgSQL exceptions (e.g. `foreign_key_violation`) — never `WHEN OTHERS`**, which masks real errors.
- **Every new `public` table needs the Data API grant block** (see Supabase Conventions) or Data-API queries fail `42501`.
- **"Applied" means confirmed by introspection**, never a file existing (see Supabase Conventions).

**Platform / build:**
- **`LLM_MAX_RETRIES` stays 0** — do not wrap Claude API calls in retry loops; the setting is deliberate.
- **Turbopack + Stripe/DocuSign SDKs use the lazy-require pattern `(0,eval)("require")`** (they ship UMD modules).
- **Brand safety is metadata — shown but never used to exclude shows** from discovery.

## Supabase Conventions (REQUIRED)

Chris pastes migrations into the Supabase SQL Editor (not the CLI). Partial failures break naive re-runs, so **every migration must be idempotent and safely re-runnable:**
- Tables `CREATE TABLE IF NOT EXISTS` · Columns `ADD COLUMN IF NOT EXISTS` · Indexes `CREATE INDEX IF NOT EXISTS` · Triggers `DROP TRIGGER IF EXISTS …; CREATE TRIGGER …` · RLS/policies `DROP POLICY IF EXISTS …; CREATE POLICY …` · Functions `CREATE OR REPLACE FUNCTION` · Check constraints `DROP CONSTRAINT IF EXISTS …; ADD CONSTRAINT`.

**"Applied" means confirmed by introspection — never on the strength of a file existing or code shipping.** The Wave 13 financial layer (015/016/018) was recorded applied but never ran; the gap stayed invisible because the fail-soft / settlement-gated paths never executed (reconciled in migration 023). After pasting any migration, run an introspection check for the specific objects it should have created, then update migration status in STATUS.md.

**Data API grants — REQUIRED on every new `public` table** (Supabase change effective Oct 30, 2026: new `public` tables are NOT auto-exposed; missing grants → `42501`):
```sql
grant select, insert, update, delete on public.<table> to service_role;   -- mandatory, checked before RLS
grant select, insert, update, delete on public.<table> to authenticated;  -- every table the logged-in app touches
-- grant select on public.<table> to anon;   -- deliberate, public-only (e.g. shows); NEVER on deals/payments/pattern-library
```
Grants go before the RLS/policy block. Migrations 001–019 are grandfathered; columns added later to a grandfathered table inherit its grants (no new grant block needed).

## Tech Stack

- **Framework:** Next.js (App Router), TypeScript, Turbopack
- **Styling:** Tailwind CSS 4 + custom CSS variables (`app/globals.css`)
- **Database / Auth:** Supabase (Postgres + Auth)
- **Deployment:** Vercel, `taylslate.com` (served from `www`)
- **AI:** Claude API (campaign planning, outreach/pitch drafting, brief analysis, discovery reasoning)
- **Payments:** Stripe Connect (Express, SetupIntent card-on-file, pay-as-delivers per episode)
- **E-signature:** DocuSign (sandbox configured; production gated on Starter plan)
- **Email:** Resend (taylslate.com verified)
- **Show data:** Podscan (Category Leaders, Podcast Search, Discover) · **YouTube:** YouTube Data API v3 · **Verification (future):** Podscribe preferred, RSS/transcript fallback

## Data Schema

Complete type system in `lib/data/types.ts`. Core entities: Show, BrandProfile, ShowProfile, Campaign, Outreach, Deal, InsertionOrder, Invoice, Payment, Payout, DomainEvent, EventLog, and the Wave 14 pattern library (CampaignPattern, RingHypothesis, ConvictionScore, AnalogMatch, FounderAnnotation). Full annotated entity list + the project file-structure map in docs/WAVE_HISTORY.md.

## Podcast & YouTube Advertising Domain Knowledge

- **CPM:** Ad Spot Price = (Downloads ÷ 1,000) × CPM. Range $15-$50. Placements: pre-roll, mid-roll (highest), post-roll.
- **Price types:** CPM-based (pay per download) or Flat Rate (fixed, make-good if underdelivery >10%).
- **YouTube:** long-form integrated reads, flat-fee typical ($2K-$15K by cultural significance), evergreen. Shorts excluded. Simulcast = one channel two surfaces, same pricing.
- **IO line items:** format, post date, guaranteed downloads, show, placement, scripted Y/N, personal-experience Y/N, reader type, evergreen/dated, pixel Y/N, gross rate, gross CPM, price type, net due. **Standard terms:** competitor exclusivity 90d, ROFR 30d, make-good >10% underdelivery, 45-day download tracking, FTC compliance, 14-day cancellation, morality/take-down, Net 30 EOM.
- **Agency markup:** traditional agencies mark up CPM ~15% ($25→$29.41); the show never sees the full rate. Taylslate's per-tier fee is transparent.
- **Payment pain:** shows invoice monthly, Net 30 EOM but routinely Net 60-75+; a January ad may not pay until April. Pay-as-delivers fixes this.
- **3-spot test floor:** 99% of podcast test campaigns are 3-spot tests. Discovery filters shows where 3 spots × per-spot price exceeds ~25% of test budget.
- **Ad copy:** 3-5 bullet talking points preferred over full scripts — host authenticity is the value. No pre-approval loop; verification is post-publication.
- **VeritoneOne IO template** (in project files) is the format standard.

## Design System

Colors use CSS custom properties from `globals.css` — never hardcode:
- `--brand-navy` / `-light` — dark backgrounds (landing)
- `--brand-blue` / `-light` — primary action
- `--brand-teal` / `-light` — secondary accent
- `--brand-orange` — tertiary accent (sponsor badges)
- `--brand-surface` / `-elevated` — light backgrounds (dashboard)
- `--brand-border` · `--brand-text` / `-secondary` / `-muted` · `--brand-success` / `-warning` / `-error`

Dashboard = light theme. Landing + public pitch pages = dark / brand-forward.

## Conventions

- Use `var(--brand-*)` for colors, not hardcoded values.
- File naming: lowercase-with-hyphens for files, PascalCase for components.
- Monetary values in USD as numbers (not strings). Dates as ISO strings, displayed via `toLocaleDateString()`.
- Build clean, MCP-ready-shaped API endpoints from day one. Schemas / forms must match real-world industry documents.
- Commit messages: imperative mood, summary under 70 chars. **Auto-commit after significant changes, no exceptions.**
- Migrations: idempotent pattern above, always; every new `public` table needs the Data API grant block.
- Domain events on every state transition; reasoning persistence on every AI decision (see Invariants).
- Cleanup Claude Code worktrees after each wave: `git worktree remove --force .claude/worktrees/<name>` then `git worktree prune`.

## Founder Working Style & Workflow

- **Two-window workflow:** builds in **Claude Code** (desktop app) on `main`, no worktrees; uses **Claude.ai chat** for strategy, planning, and maintaining the strategy docs.
- **Codex review loop:** after a build, run a Codex review pass and resolve findings before shipping — clear High/Medium (and usually Low), and note the outcome ("Codex clean") in STATUS.md. Codex rescue is available for deeper diagnosis or a second-pass implementation.
- Prefers focused, step-by-step explanations over comprehensive overviews. Values authentic industry modeling — schemas match real documents. Works iteratively: build, test, refine.
- Comfortable with GitHub, terminal, Vercel. Motivated by bold launches over incremental releases. Wants a co-founder who is direct about risks — honest about what isn't working beats hedging.

## Build status

Current build state, test count, and migration state live in STATUS.md. Do not record them here.
