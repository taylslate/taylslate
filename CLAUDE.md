# CLAUDE.md — Taylslate Project Context

## What is Taylslate

Taylslate is a **transaction platform for host-read podcast and YouTube sponsorship advertising**. It replaces the manual process of campaign planning, deal negotiation, insertion order (IO) management, delivery tracking, invoicing, and payment with an AI-powered workflow.

The platform serves four user types: **Brands** (buy ads), **Agencies** (manage campaigns for brands), **Sales Agents** (represent multiple shows), and **Shows/Creators** (sell ad inventory).

## Core Thesis

The most valuable data in podcast advertising — real CPM rates, verified download performance, advertiser retention, conversion signals — does not exist in any API. Taylslate captures this data by facilitating the actual transaction. Every deal that runs through the platform makes the AI smarter.

## Current Build Phase

**Phase 1 MVP** — Target user is a sales agent managing multiple podcast shows. Building:
1. IO generator (form → professional IO document matching industry standard)
2. Invoice generator (completed IOs + confirmed delivery → monthly invoices)
3. Show management for agents
4. Basic campaign calculator

The brand-side campaign planning UI already exists (campaign creation form, results page with show recommendations, outreach drafts, ad copy). Next is connecting it to the agent/transaction side.

## Tech Stack

- **Framework:** Next.js (App Router) with TypeScript
- **Styling:** Tailwind CSS with custom CSS variables (see `app/globals.css` for design tokens)
- **Database:** Supabase (Postgres + Auth) — not yet connected, using local seed data
- **Deployment:** Vercel
- **AI:** Claude API (planned for campaign planning, outreach drafting, data extraction)

## Project Structure

```
app/
  page.tsx                          # Landing page (dark navy theme)
  globals.css                       # Design tokens (--brand-blue, --brand-surface, etc.)
  (dashboard)/
    layout.tsx                      # Authenticated layout with sidebar
    campaigns/                      # Brand-side campaign planning (built)
      page.tsx                      # Campaign list
      new/page.tsx                  # Campaign brief form
      [id]/page.tsx                 # Campaign results (recommendations, outreach, ad copy)
    settings/page.tsx               # Account & subscription settings
components/
  layout/Sidebar.tsx                # Main navigation sidebar
lib/
  data/
    types.ts                        # ALL TypeScript types for the platform
    seed.ts                         # Realistic mock data (18 shows, deals, IOs, invoices)
    index.ts                        # Barrel export
  supabase/                         # Supabase client config (client, server, admin)
```

## Data Schema

The complete type system is in `lib/data/types.ts`. Key entities:

- **Show** — podcast or YouTube channel with audience data, rate cards, demographics, sponsor history
- **Deal** — relationship between brand and show, tracks full negotiation lifecycle (proposed → signed → live → completed)
- **InsertionOrder** — the contract, with per-episode line items (post date, downloads, placement, CPM, gross rate, net due, make-good tracking). Modeled on real VeritoneOne IO template.
- **Invoice** — monthly billing document referencing IO line items
- **Campaign** — brand-side campaign brief + AI-generated show recommendations
- **Profile** — user with role (brand, agency, agent, show) and subscription tier
- **AgentShowRelationship** — which agent represents which shows, with commission rates

## Seed Data

`lib/data/seed.ts` contains:
- 18 shows (14 podcasts + 4 YouTube channels), including 7 smaller shows (<20K downloads) that the agent represents
- 4 user profiles (brand, agent, agency, second brand)
- 4 deals at different lifecycle stages
- 2 complete insertion orders with line items
- 2 invoices (one paid, one sent)
- Helper functions: `getShowById()`, `getShowsByAgent()`, `getDealsByAgent()`, `getIOByDeal()`, `getAgentStats()`, etc.

## Podcast Advertising Domain Knowledge

- **CPM pricing:** Ad Spot Price = (Downloads ÷ 1,000) × CPM Rate. Range: $15–$50.
- **Placements:** Pre-roll, mid-roll (standard), post-roll. Mid-roll commands highest rates.
- **Price types:** CPM-based (pay per actual download) or Flat Rate (fixed price with make-good if underdelivery >10%).
- **IO structure:** Per-episode line items with: format, post date, guaranteed downloads, show name, placement, scripted Y/N, personal experience Y/N, reader type, evergreen/dated, pixel Y/N, gross rate, gross CPM, price type, net due.
- **Agency markup:** Agencies mark up CPM to brands (e.g., show's $25 CPM → agency charges $29.41). Show never sees full rate.
- **Payment flow pain:** Shows must manually invoice agencies monthly. Net 30 EOM terms, but agencies routinely pay Net 60–75+. Show running a January ad may not see payment until April.
- **YouTube:** Flat-fee pricing (not CPM). $2K–$20K based on cultural significance. Content is evergreen (accumulates views indefinitely).

## Design System

All colors use CSS custom properties from `globals.css`:
- `--brand-navy` / `--brand-navy-light` — dark backgrounds (landing page)
- `--brand-blue` / `--brand-blue-light` — primary action color
- `--brand-teal` / `--brand-teal-light` — secondary accent
- `--brand-orange` — tertiary accent (sponsor badges)
- `--brand-surface` / `--brand-surface-elevated` — light backgrounds (dashboard)
- `--brand-border` — borders
- `--brand-text` / `--brand-text-secondary` / `--brand-text-muted` — text hierarchy
- `--brand-success` / `--brand-warning` / `--brand-error` — status colors

Dashboard uses light theme (`--brand-surface` background). Landing page uses dark theme (`--brand-navy` background).

## Conventions

- Use `var(--brand-*)` CSS variables for all colors, not hardcoded values
- Pages import seed data from `@/lib/data` until Supabase is connected
- Keep components in `components/` organized by feature (e.g., `components/deals/`, `components/io/`)
- File naming: lowercase with hyphens for files, PascalCase for components
- All monetary values in USD, stored as numbers (not strings)
- Dates stored as ISO strings, displayed with `toLocaleDateString()`

## What to Build Next

1. **Agent dashboard pages:** Deals list, IO generator form, Invoice generator, Show management
2. **Sidebar navigation:** Add Deals, Invoices, Shows nav items alongside existing Campaigns
3. **IO document generation:** Form that outputs professional IO matching VeritoneOne format
4. **Wire existing campaign results to seed data** — replace hardcoded mock data with imports from `@/lib/data`
