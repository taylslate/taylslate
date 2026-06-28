# Taylslate — STATUS

_Volatile snapshot. Updated June 28, 2026 — founder impersonation tool + four show-auth fixes (latest); Wave 14 Phase 2C Layer 4 + 3.5 before that._

## Most recent — Founder impersonation tool + four show-auth fixes (shipped June 28, 2026)

**Founder "log in as test user" tool — Layers 1 + 2 shipped, live on prod, verified end-to-end both ways.** Schema-free — NO migration added. Admin-gated by `isInternalAdmin` (`INTERNAL_ADMIN_EMAILS`); impersonable set fixed by `TEST_ACCOUNTS`.
- Sidebar click-through as `chris@`: lands as the test user, orange "Impersonating &lt;label&gt;" banner shows.
- Real magic-link email to `chris+show1@taylslate.com`: clicked from the inbox → authenticated show session with correct role/RLS.

**Four production auth bugs fixed** — all on the show magic-link path, none previously testable (this tool is what exposed them; Wave 13 gotcha #5):
1. **Callback path** — the only callback route is `app/(auth)/callback/route.ts`, served at `/callback` (the `(auth)` group is stripped from the URL; there is NO `/auth/callback`). `test-login` and the show magic route both pointed at `/auth/callback` (404). → `/callback`. (`8740670`)
2. **Implicit vs PKCE flow** — `admin.generateLink()` returns an implicit-flow link (session in the `#access_token=…` fragment), unreadable by a server route; no `?code=` for `exchangeCodeForSession`. → read `properties.hashed_token`, build `/callback?token_hash=…&type=magiclink&next=…`, verify with `verifyOtp({ type, token_hash })`. The callback route now has a `token_hash` branch beside the `code` branch. (`8740670`)
3. **Proxy allowlist** — the auth gate `proxy.ts` (Next 16's renamed middleware) omitted `/callback`, so unauthenticated magic-link users bounced to `/login` before `verifyOtp` ran. → added `/callback`. (`8c32570`)
4. **Start link target** — `app/api/auth/magic/start/route.ts` emailed `/auth/magic` (static "One sec…" page that ignores the token) instead of `/api/auth/magic` (the consuming route). → fixed. (`0187863`)
Plus a Codex finding: open redirect on `next` validated to a same-origin path on both callback branches. (`c355c5e`)

**The show magic-link flow now works end-to-end for the first time** (Wave 13 gotcha #5 resolved). Layer 1 endpoint was `ccbc6e5` (prior session); this session added `8740670`, `8c32570`, `c355c5e`, `0187863`.

## Current wave
**Wave 14 Phase 2C — Test portfolio + scale tier dual output.** Layers 1, 1b,
2, 3, 3.5, 4 shipped and live. Layer 5 (overrides + recompute) remaining —
optional polish, not GTM-blocking.

## Tests
853 passing (72 files). tsc clean. eslint: all changed files clean; one
pre-existing error in `app/(dashboard)/campaigns/generated/page.tsx`
(setState-in-effect) is unrelated to this work.

## Migration state
001–028 applied and introspected. 028 (per-show cost + tier curation columns on
`conviction_scores`) applied via SQL Editor, confirmed by introspection (8
columns + cost_basis check + `(campaign_pattern_id, tier)` index). The 028 file
in `supabase/migrations/` documents what is live; never re-run.
**The June 28, 2026 impersonation tool + auth fixes are schema-free — no
migration added; migration state is unchanged.**

## What works end to end
`/campaigns/[id]` renders the dual output: test portfolio (selectable, budget
meter), scale tier (watchlist, "deferred" framing), bench (collapsed). CTA
writes selected test-tier IDs to the Wave 7 plan path and navigates. Verified
live in-browser against real campaigns. Rejected-ring leakage closed (3.5) —
filter to confirmed rings before rollup in both persist and read paths.

Founder impersonation: `chris@` (an `INTERNAL_ADMIN_EMAILS` member) sees
"Log in as …" buttons in the sidebar → one click swaps into the test
account's session and shows the "Impersonating …" banner. The show
magic-link flow (outreach → `/api/auth/magic/start` email → `/api/auth/magic`
→ `/callback` `verifyOtp`) now completes end-to-end, verified from a real
inbox.

## 2C deferred (logged in PRODUCT_BACKLOG.md)
- flat_fee meter-vs-plan mismatch — moot at launch (podcast-only discovery);
  Wave 7/2D.
- scale-watchlist not tier-validated; plan-handoff non-atomic double-write —
  both degrade safely.
- Q5 invariant: stale-tier safety relies on "only composite ≥ MEDIUM_FLOOR rows
  persist." If below-floor rows ever persist, the confirmed-ring stale-tier
  case reopens.

## Next
Layer 5 (overrides + recompute: spot-count, placement, per-show CPM) — carries
the Layer 3 request-scope footgun (`tierCampaignPortfolio`'s default
`loadShowsByIds` needs a request scope or admin deps on override re-run).
