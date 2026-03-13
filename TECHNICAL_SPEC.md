# Taylslate — Technical Specification

> **Stack:** Next.js 16 (App Router) · TypeScript · Supabase (Postgres + Auth) · Tailwind 4 · Vercel · Claude API  
> **Last updated:** March 2026 · v1.1

> **⚠️ Schema Source of Truth:** `lib/data/types.ts` is the canonical data model for all entities. This spec's SQL schema is derived from those types. If there is ever a conflict, `types.ts` wins.

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Database Schema](#2-database-schema)
3. [API Endpoints](#3-api-endpoints)
4. [MCP Server](#4-mcp-server)
5. [AI Integration](#5-ai-integration)
6. [Data Ingestion Pipeline](#6-data-ingestion-pipeline)
7. [Authentication & Authorization](#7-authentication--authorization)
8. [Environment Variables](#8-environment-variables)
9. [Implementation Order](#9-implementation-order)

---

## 1. Project Structure

This reflects the actual codebase as of March 2026.

```
taylslate/
├── app/
│   ├── layout.tsx                    # Root layout
│   ├── page.tsx                      # Landing page (dark navy theme)
│   ├── globals.css                   # Design tokens (--brand-blue, --brand-surface, etc.)
│   ├── onboarding/
│   │   ├── layout.tsx
│   │   └── page.tsx                  # Agent onboarding: role selection, CSV import
│   ├── (auth)/                       # TODO: auth pages
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   └── callback/route.ts         # Supabase OAuth callback
│   ├── (dashboard)/
│   │   ├── layout.tsx                # Authenticated layout with sidebar
│   │   ├── dashboard/page.tsx        # Home dashboard with stats
│   │   ├── campaigns/
│   │   │   ├── page.tsx              # Campaign list
│   │   │   ├── new/page.tsx          # Campaign brief form
│   │   │   ├── generated/page.tsx    # Generated campaign results
│   │   │   └── [id]/page.tsx         # Campaign detail
│   │   ├── deals/
│   │   │   ├── page.tsx              # Deal pipeline (kanban)
│   │   │   ├── new/page.tsx          # Create deal form
│   │   │   ├── import/page.tsx       # IO import (PDF parsing via Claude)
│   │   │   └── [id]/page.tsx         # Deal detail + IO editor
│   │   ├── invoices/
│   │   │   └── page.tsx              # Invoice list + generation
│   │   ├── shows/
│   │   │   └── page.tsx              # Show roster management
│   │   └── settings/
│   │       └── page.tsx              # Account & subscription settings
│   └── api/
│       ├── campaigns/
│       │   ├── generate/route.ts     # POST: AI campaign planning (Claude API)
│       │   ├── outreach/route.ts     # POST: outreach email generation
│       │   └── deals/route.ts        # POST: create deals from campaign
│       ├── deals/
│       │   ├── route.ts              # GET: list deals
│       │   ├── import/route.ts       # POST: IO import (PDF → parsed deal)
│       │   └── [id]/
│       │       ├── route.ts          # GET: deal detail
│       │       └── io/
│       │           ├── pdf/route.ts  # GET/POST: IO PDF generation
│       │           └── send/route.ts # POST: send IO via Resend
│       └── invoices/
│           ├── generate/route.ts     # POST: generate invoice from IO
│           ├── [id]/route.ts         # GET/PATCH: invoice detail + status
│           ├── pdf/route.ts          # POST: invoice PDF generation
│           └── send/route.ts         # POST: send invoice via Resend
├── components/
│   ├── io/                           # IO-related components (editor, preview, etc.)
│   └── layout/
│       └── Sidebar.tsx               # Main navigation sidebar
├── lib/
│   ├── data/
│   │   ├── types.ts                  # ⭐ CANONICAL data model — all TypeScript types
│   │   ├── seed.ts                   # Seed data (18 shows, deals, IOs, invoices)
│   │   ├── deal-store.ts             # In-memory deal store (to be replaced by Supabase)
│   │   └── index.ts                  # Barrel export
│   ├── pdf/
│   │   └── io-pdf.ts                 # IO PDF generation (jsPDF)
│   ├── prompts/
│   │   └── campaign-planning.ts      # Claude API system prompts + prompt builders
│   ├── supabase/
│   │   ├── client.ts                 # Browser client (@supabase/ssr)
│   │   ├── server.ts                 # Server client (cookies)
│   │   └── admin.ts                  # Service role client (cron jobs)
│   ├── utils/                        # Shared utilities
│   └── validation/
│       └── io-validation.ts          # IO field validation
├── CLAUDE.md                         # Project context for Claude Code
├── TAYLSLATE_CONTEXT.md              # Strategic context, competitive research
├── TECHNICAL_SPEC.md                 # This file
├── Combined Channel Roster.csv       # Real agent roster data
├── package.json
├── tsconfig.json
└── next.config.ts
```

---

## 2. Database Schema

All tables are derived from the types defined in `lib/data/types.ts`. The agent-side transaction entities (deals, insertion_orders, invoices) are the core of the MVP.

### Core Tables

```sql
-- ============================================================
-- USERS & AUTH
-- ============================================================

-- Supabase Auth handles the auth.users table.
-- This is our application profile table.

CREATE TABLE public.profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  full_name       TEXT,
  company_name    TEXT,
  company_url     TEXT,
  role            TEXT NOT NULL CHECK (role IN ('brand', 'agency', 'agent', 'show')),
  tier            TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'starter', 'growth', 'business')),
  stripe_customer_id   TEXT,
  stripe_subscription_id TEXT,
  campaigns_this_month INT NOT NULL DEFAULT 0,
  campaigns_reset_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SHOWS
-- ============================================================

CREATE TABLE public.shows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE,
  platform        TEXT NOT NULL CHECK (platform IN ('podcast', 'youtube')),
  description     TEXT,
  image_url       TEXT,

  -- Taxonomy
  categories      TEXT[] DEFAULT '{}',
  tags            TEXT[] DEFAULT '{}',

  -- Network & contacts
  network         TEXT,
  contact_name    TEXT,
  contact_email   TEXT,
  contact_method  TEXT CHECK (contact_method IN ('email', 'form', 'network_rep', 'agent')),

  -- Audience
  audience_size   INT,                        -- avg downloads/ep (podcast) or avg views (youtube)
  demographics    JSONB DEFAULT '{}',         -- ShowDemographics from types.ts
  audience_interests TEXT[] DEFAULT '{}',

  -- Pricing
  rate_card       JSONB DEFAULT '{}',         -- ShowRateCard: {preroll_cpm, midroll_cpm, postroll_cpm, flat_rate}
  price_type      TEXT CHECK (price_type IN ('cpm', 'flat_rate')),
  min_buy         DECIMAL(10,2),

  -- Ad format info
  ad_formats      TEXT[] DEFAULT '{}',        -- {'host_read', 'scripted', 'personal_experience', 'dynamic_insertion', 'integration'}
  episode_cadence TEXT CHECK (episode_cadence IN ('daily', 'weekly', 'biweekly', 'monthly')),
  avg_episode_length_min INT,

  -- Sponsors
  current_sponsors TEXT[] DEFAULT '{}',
  past_sponsors    TEXT[] DEFAULT '{}',

  -- External IDs
  apple_id        TEXT,
  spotify_id      TEXT,
  youtube_channel_id TEXT,
  rss_url         TEXT,

  -- Verification
  is_claimed      BOOLEAN NOT NULL DEFAULT FALSE,
  is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  data_sources    TEXT[] DEFAULT '{}',

  -- Availability
  available_slots INT,
  next_available_date DATE,

  -- Enrichment tracking
  last_api_refresh    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_shows_platform ON public.shows(platform);
CREATE INDEX idx_shows_categories ON public.shows USING GIN(categories);
CREATE INDEX idx_shows_tags ON public.shows USING GIN(tags);
CREATE INDEX idx_shows_audience_size ON public.shows(audience_size DESC);
CREATE INDEX idx_shows_network ON public.shows(network);

-- ============================================================
-- AGENT-SHOW RELATIONSHIPS
-- ============================================================

CREATE TABLE public.agent_show_relationships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  show_id         UUID NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  commission_rate DECIMAL(5,4),               -- e.g. 0.15 for 15%
  is_exclusive    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(agent_id, show_id)
);

CREATE INDEX idx_agent_shows_agent ON public.agent_show_relationships(agent_id);
CREATE INDEX idx_agent_shows_show ON public.agent_show_relationships(show_id);

-- ============================================================
-- SHOW SPONSORS (competitive intel)
-- ============================================================

CREATE TABLE public.show_sponsors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id         UUID NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  brand_name      TEXT NOT NULL,
  brand_domain    TEXT,
  first_seen      DATE,
  last_seen       DATE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  source          TEXT NOT NULL DEFAULT 'manual',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_show_sponsors_show ON public.show_sponsors(show_id);
CREATE INDEX idx_show_sponsors_brand ON public.show_sponsors(brand_name);

-- ============================================================
-- CAMPAIGNS (Brand-side campaign planning)
-- ============================================================

CREATE TABLE public.campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  brief           JSONB DEFAULT '{}',         -- CampaignBrief from types.ts
  budget_total    DECIMAL(10,2) NOT NULL,
  platforms       TEXT[] DEFAULT '{"podcast"}',
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'planned', 'active', 'completed', 'archived')),
  recommendations JSONB DEFAULT '[]',         -- ShowRecommendation[]
  youtube_recommendations JSONB DEFAULT '[]', -- YouTubeRecommendation[]
  expansion_opportunities JSONB DEFAULT '[]', -- ExpansionShow[]
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaigns_user ON public.campaigns(user_id);
CREATE INDEX idx_campaigns_status ON public.campaigns(status);

-- ============================================================
-- DEALS (the transaction — links brand/agency to show)
-- ============================================================

CREATE TABLE public.deals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID REFERENCES public.campaigns(id),  -- optional: agent-side deals may not have a campaign
  show_id         UUID NOT NULL REFERENCES public.shows(id),
  brand_id        UUID NOT NULL REFERENCES public.profiles(id),
  agent_id        UUID REFERENCES public.profiles(id),
  agency_id       UUID REFERENCES public.profiles(id),

  -- Status lifecycle: proposed → negotiating → approved → io_sent → signed → live → completed | cancelled
  status          TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'negotiating', 'approved', 'io_sent', 'signed', 'live', 'completed', 'cancelled')),

  -- Deal terms
  num_episodes    INT NOT NULL,
  placement       TEXT NOT NULL CHECK (placement IN ('pre-roll', 'mid-roll', 'post-roll')),
  ad_format       TEXT NOT NULL CHECK (ad_format IN ('host_read', 'scripted', 'personal_experience', 'dynamic_insertion', 'integration')),
  price_type      TEXT NOT NULL CHECK (price_type IN ('cpm', 'flat_rate')),
  cpm_rate        DECIMAL(10,2) NOT NULL,     -- negotiated CPM
  gross_cpm       DECIMAL(10,2),              -- CPM charged to brand (if agency involved)
  guaranteed_downloads INT NOT NULL,          -- per episode

  -- Calculated amounts
  net_per_episode DECIMAL(10,2) NOT NULL,     -- what the show receives per episode
  gross_per_episode DECIMAL(10,2),            -- what the brand/agency pays per episode
  total_net       DECIMAL(10,2) NOT NULL,     -- total show payment
  total_gross     DECIMAL(10,2),              -- total brand payment

  -- Content terms
  is_scripted     BOOLEAN NOT NULL DEFAULT FALSE,
  is_personal_experience BOOLEAN NOT NULL DEFAULT FALSE,
  reader_type     TEXT NOT NULL DEFAULT 'host_read' CHECK (reader_type IN ('host_read', 'producer_read', 'guest_read')),
  content_type    TEXT NOT NULL DEFAULT 'evergreen' CHECK (content_type IN ('evergreen', 'dated')),
  pixel_required  BOOLEAN NOT NULL DEFAULT FALSE,

  -- Exclusivity
  competitor_exclusion TEXT[] DEFAULT '{}',
  exclusivity_days INT NOT NULL DEFAULT 90,
  rofr_days       INT NOT NULL DEFAULT 30,

  -- Dates
  flight_start    DATE NOT NULL,
  flight_end      DATE NOT NULL,

  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deals_show ON public.deals(show_id);
CREATE INDEX idx_deals_brand ON public.deals(brand_id);
CREATE INDEX idx_deals_agent ON public.deals(agent_id);
CREATE INDEX idx_deals_status ON public.deals(status);
CREATE INDEX idx_deals_campaign ON public.deals(campaign_id);

-- ============================================================
-- INSERTION ORDERS (the contract generated from a deal)
-- ============================================================

CREATE TABLE public.insertion_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  io_number       TEXT NOT NULL UNIQUE,       -- e.g. "IO-2026-0001"
  deal_id         UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,

  -- Parties
  advertiser_name TEXT NOT NULL,
  advertiser_contact_name TEXT,
  advertiser_contact_email TEXT,

  publisher_name  TEXT NOT NULL,
  publisher_contact_name TEXT NOT NULL,
  publisher_contact_email TEXT NOT NULL,
  publisher_address TEXT,

  agency_name     TEXT,
  agency_contact_name TEXT,
  agency_contact_email TEXT,
  agency_billing_contact TEXT,
  agency_address  TEXT,
  send_invoices_to TEXT,

  -- Totals
  total_downloads INT NOT NULL,
  total_gross     DECIMAL(10,2) NOT NULL,
  total_net       DECIMAL(10,2) NOT NULL,

  -- Standard terms (from VeritoneOne template)
  payment_terms   TEXT NOT NULL DEFAULT 'Net 30 EOM',
  competitor_exclusion TEXT[] DEFAULT '{}',
  exclusivity_days INT NOT NULL DEFAULT 90,
  rofr_days       INT NOT NULL DEFAULT 30,
  cancellation_notice_days INT NOT NULL DEFAULT 14,
  download_tracking_days INT NOT NULL DEFAULT 45,
  make_good_threshold DECIMAL(3,2) NOT NULL DEFAULT 0.10,  -- 10%

  -- Status & signature
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'signed', 'active', 'completed', 'cancelled')),
  sent_at         TIMESTAMPTZ,
  signed_at       TIMESTAMPTZ,
  signed_by_publisher TEXT,
  signed_by_agency TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_io_deal ON public.insertion_orders(deal_id);
CREATE INDEX idx_io_status ON public.insertion_orders(status);

-- ============================================================
-- IO LINE ITEMS (per-episode entries on an IO)
-- ============================================================

CREATE TABLE public.io_line_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  io_id           UUID NOT NULL REFERENCES public.insertion_orders(id) ON DELETE CASCADE,

  format          TEXT NOT NULL CHECK (format IN ('podcast', 'youtube')),
  post_date       DATE NOT NULL,
  guaranteed_downloads INT NOT NULL,
  show_name       TEXT NOT NULL,
  placement       TEXT NOT NULL CHECK (placement IN ('pre-roll', 'mid-roll', 'post-roll')),
  is_scripted     BOOLEAN NOT NULL DEFAULT FALSE,
  is_personal_experience BOOLEAN NOT NULL DEFAULT FALSE,
  reader_type     TEXT NOT NULL DEFAULT 'host_read',
  content_type    TEXT NOT NULL DEFAULT 'evergreen',
  pixel_required  BOOLEAN NOT NULL DEFAULT FALSE,
  gross_rate      DECIMAL(10,2) NOT NULL,
  gross_cpm       DECIMAL(10,2) NOT NULL,
  price_type      TEXT NOT NULL CHECK (price_type IN ('cpm', 'flat_rate')),
  net_due         DECIMAL(10,2) NOT NULL,

  -- Post-delivery tracking
  actual_post_date DATE,
  actual_downloads INT,
  episode_url     TEXT,
  ad_timestamp    TEXT,
  verified        BOOLEAN NOT NULL DEFAULT FALSE,
  make_good_triggered BOOLEAN NOT NULL DEFAULT FALSE,
  make_good_reason TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_io_line_items_io ON public.io_line_items(io_id);

-- ============================================================
-- INVOICES
-- ============================================================

CREATE TABLE public.invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number  TEXT NOT NULL UNIQUE,       -- e.g. "INV-2026-0001"
  io_id           UUID NOT NULL REFERENCES public.insertion_orders(id),
  io_number       TEXT NOT NULL,

  -- Parties
  bill_to_name    TEXT NOT NULL,
  bill_to_email   TEXT NOT NULL,
  bill_to_address TEXT,

  from_name       TEXT NOT NULL,
  from_email      TEXT NOT NULL,
  from_address    TEXT,

  -- Reference
  advertiser_name TEXT NOT NULL,
  campaign_period TEXT NOT NULL,              -- e.g. "August 2021"

  -- Totals
  subtotal        DECIMAL(10,2) NOT NULL,
  adjustments     DECIMAL(10,2) NOT NULL DEFAULT 0,  -- make-good deductions
  total_due       DECIMAL(10,2) NOT NULL,

  -- Payment
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'disputed', 'cancelled')),
  due_date        DATE NOT NULL,
  sent_at         TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  payment_method  TEXT,

  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoices_io ON public.invoices(io_id);
CREATE INDEX idx_invoices_status ON public.invoices(status);

-- ============================================================
-- INVOICE LINE ITEMS
-- ============================================================

CREATE TABLE public.invoice_line_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  io_line_item_id UUID NOT NULL REFERENCES public.io_line_items(id),

  show_name       TEXT NOT NULL,
  post_date       DATE NOT NULL,
  description     TEXT NOT NULL,
  guaranteed_downloads INT NOT NULL,
  actual_downloads INT,
  rate            DECIMAL(10,2) NOT NULL,
  make_good       BOOLEAN NOT NULL DEFAULT FALSE,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoice_line_items_invoice ON public.invoice_line_items(invoice_id);

-- ============================================================
-- PAYMENTS
-- ============================================================

CREATE TABLE public.payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES public.invoices(id),
  amount          DECIMAL(10,2) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded')),
  method          TEXT NOT NULL CHECK (method IN ('stripe', 'wire', 'check', 'ach', 'manual')),
  stripe_payment_id TEXT,
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_invoice ON public.payments(invoice_id);
CREATE INDEX idx_payments_status ON public.payments(status);

-- ============================================================
-- API CACHE (tracking data freshness for ingestion pipeline)
-- ============================================================

CREATE TABLE public.api_cache_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT,
  last_fetched    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_refresh    TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed', 'pending')),
  error_message   TEXT,
  points_used     INT
);

CREATE INDEX idx_cache_log_refresh ON public.api_cache_log(next_refresh);
CREATE INDEX idx_cache_log_source ON public.api_cache_log(source, entity_type);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insertion_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- Profiles: users read/update their own
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Campaigns: users manage their own
CREATE POLICY "Users read own campaigns" ON public.campaigns FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own campaigns" ON public.campaigns FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own campaigns" ON public.campaigns FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own campaigns" ON public.campaigns FOR DELETE USING (auth.uid() = user_id);

-- Deals: accessible by agent, brand, or agency on the deal
CREATE POLICY "Deal participants read deals" ON public.deals FOR SELECT USING (
  auth.uid() = agent_id OR auth.uid() = brand_id OR auth.uid() = agency_id
);
CREATE POLICY "Deal participants insert deals" ON public.deals FOR INSERT WITH CHECK (
  auth.uid() = agent_id OR auth.uid() = brand_id OR auth.uid() = agency_id
);
CREATE POLICY "Deal participants update deals" ON public.deals FOR UPDATE USING (
  auth.uid() = agent_id OR auth.uid() = brand_id OR auth.uid() = agency_id
);

-- IOs: accessible via deal relationship
CREATE POLICY "IO access via deal" ON public.insertion_orders FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.deals WHERE deals.id = insertion_orders.deal_id
    AND (deals.agent_id = auth.uid() OR deals.brand_id = auth.uid() OR deals.agency_id = auth.uid()))
);
CREATE POLICY "IO insert via deal" ON public.insertion_orders FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.deals WHERE deals.id = insertion_orders.deal_id
    AND (deals.agent_id = auth.uid() OR deals.brand_id = auth.uid() OR deals.agency_id = auth.uid()))
);
CREATE POLICY "IO update via deal" ON public.insertion_orders FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.deals WHERE deals.id = insertion_orders.deal_id
    AND (deals.agent_id = auth.uid() OR deals.brand_id = auth.uid() OR deals.agency_id = auth.uid()))
);

-- Invoices: accessible via IO → deal relationship
CREATE POLICY "Invoice access via deal" ON public.invoices FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.insertion_orders io
    JOIN public.deals d ON d.id = io.deal_id
    WHERE io.id = invoices.io_id
    AND (d.agent_id = auth.uid() OR d.brand_id = auth.uid() OR d.agency_id = auth.uid()))
);
CREATE POLICY "Invoice insert via deal" ON public.invoices FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.insertion_orders io
    JOIN public.deals d ON d.id = io.deal_id
    WHERE io.id = invoices.io_id
    AND (d.agent_id = auth.uid() OR d.brand_id = auth.uid() OR d.agency_id = auth.uid()))
);
CREATE POLICY "Invoice update via deal" ON public.invoices FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.insertion_orders io
    JOIN public.deals d ON d.id = io.deal_id
    WHERE io.id = invoices.io_id
    AND (d.agent_id = auth.uid() OR d.brand_id = auth.uid() OR d.agency_id = auth.uid()))
);

-- Shows: publicly readable, only service role can write
ALTER TABLE public.shows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Shows are publicly readable" ON public.shows FOR SELECT USING (true);

ALTER TABLE public.show_sponsors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Sponsors are publicly readable" ON public.show_sponsors FOR SELECT USING (true);

-- Agent-show relationships: agents manage their own
ALTER TABLE public.agent_show_relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Agents read own relationships" ON public.agent_show_relationships FOR SELECT USING (auth.uid() = agent_id);
CREATE POLICY "Agents insert own relationships" ON public.agent_show_relationships FOR INSERT WITH CHECK (auth.uid() = agent_id);
CREATE POLICY "Agents delete own relationships" ON public.agent_show_relationships FOR DELETE USING (auth.uid() = agent_id);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_timestamp BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_shows_timestamp BEFORE UPDATE ON public.shows FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_campaigns_timestamp BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_deals_timestamp BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_io_timestamp BEFORE UPDATE ON public.insertion_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_invoices_timestamp BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Monthly campaign counter reset
CREATE OR REPLACE FUNCTION reset_monthly_campaigns()
RETURNS void AS $$
BEGIN
  UPDATE public.profiles
  SET campaigns_this_month = 0, campaigns_reset_at = NOW()
  WHERE campaigns_reset_at < DATE_TRUNC('month', NOW());
END;
$$ LANGUAGE plpgsql;

-- Aggregate negotiated CPM for a show (anonymized, min 3 data points)
CREATE OR REPLACE FUNCTION get_avg_negotiated_cpm(target_show_id UUID)
RETURNS DECIMAL AS $$
  SELECT AVG(cpm_rate)
  FROM public.deals
  WHERE show_id = target_show_id
    AND cpm_rate IS NOT NULL
    AND status IN ('signed', 'live', 'completed')
  HAVING COUNT(*) >= 3;
$$ LANGUAGE sql SECURITY DEFINER;
```

---

## 3. API Endpoints

### Deals (Agent-Side — MVP)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `POST` | `/api/deals` | Create deal | Yes |
| `GET` | `/api/deals` | List deals for authenticated user | Yes |
| `GET` | `/api/deals/[id]` | Deal detail with show + IO data | Yes |
| `PATCH` | `/api/deals/[id]` | Update deal status/terms | Yes |
| `DELETE` | `/api/deals/[id]` | Cancel deal (soft delete) | Yes |
| `POST` | `/api/deals/import` | Import IO PDF → parsed deal | Yes |
| `POST` | `/api/deals/[id]/io/generate` | Generate IO from deal | Yes |
| `PATCH` | `/api/deals/[id]/io` | Update IO fields | Yes |
| `GET` | `/api/deals/[id]/io/pdf` | Download IO as PDF | Yes |
| `POST` | `/api/deals/[id]/io/send` | Send IO via email (Resend) | Yes |

### Invoices

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `POST` | `/api/invoices/generate` | Generate invoice from IO line items | Yes |
| `GET` | `/api/invoices` | List invoices for authenticated user | Yes |
| `GET` | `/api/invoices/[id]` | Invoice detail | Yes |
| `PATCH` | `/api/invoices/[id]` | Update invoice status | Yes |
| `POST` | `/api/invoices/pdf` | Generate invoice PDF | Yes |
| `POST` | `/api/invoices/send` | Send invoice via email (Resend) | Yes |

### Shows

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/api/shows` | List/search shows | Yes |
| `POST` | `/api/shows` | Create show | Yes |
| `PATCH` | `/api/shows/[id]` | Update show | Yes |
| `POST` | `/api/shows/import` | CSV roster import | Yes |
| `POST` | `/api/shows/[id]/enrich` | Trigger data enrichment | Yes |

### Campaigns (Brand-Side)

| Method | Path | Description | Auth | Tier |
|--------|------|-------------|------|------|
| `POST` | `/api/campaigns/generate` | AI campaign planning | Yes | All |
| `POST` | `/api/campaigns/outreach` | Generate outreach emails | Yes | Starter+ |
| `POST` | `/api/campaigns/deals` | Create deals from campaign plan | Yes | Growth+ |

### Request/Response Patterns

```typescript
// POST /api/deals — Create deal
// Request:
{
  show_id: string;
  brand_id: string;
  agent_id?: string;
  agency_id?: string;
  campaign_id?: string;
  num_episodes: number;
  placement: "pre-roll" | "mid-roll" | "post-roll";
  ad_format: "host_read" | "scripted" | "personal_experience" | "dynamic_insertion" | "integration";
  price_type: "cpm" | "flat_rate";
  cpm_rate: number;
  gross_cpm?: number;
  guaranteed_downloads: number;
  is_scripted: boolean;
  is_personal_experience: boolean;
  reader_type: "host_read" | "producer_read" | "guest_read";
  content_type: "evergreen" | "dated";
  pixel_required: boolean;
  competitor_exclusion: string[];
  exclusivity_days: number;      // default 90
  rofr_days: number;             // default 30
  flight_start: string;          // ISO date
  flight_end: string;
  notes?: string;
}
// Response: { deal: Deal }
// Auto-calculates: net_per_episode, gross_per_episode, total_net, total_gross

// POST /api/deals/[id]/io/generate — Generate IO from deal
// Response: { insertion_order: InsertionOrder }
// Auto-generates: io_number, line_items (one per episode), standard terms

// POST /api/invoices/generate — Generate invoice from IO
// Request:
{
  io_id: string;
  line_item_ids?: string[];    // optional: specific line items to invoice (defaults to all delivered)
}
// Response: { invoice: Invoice }
// Auto-calculates: make-good flags, CPM vs flat rate amounts, due date from payment terms

// POST /api/campaigns/generate — AI campaign planning
// Request:
{
  name: string;
  brand_url?: string;
  budget_total: number;
  platforms: ("podcast" | "youtube")[];
  target_age_range?: string;
  target_gender?: string;
  target_interests: string[];
  keywords: string[];
  campaign_goals?: string;
}
// Response: { campaign: Campaign }
// Includes: recommendations, youtube_recommendations, expansion_opportunities
```

---

## 4. MCP Server

Separate package in `/mcp/` directory. Runs as a standalone process, connects to same Supabase instance.

### Tools Exposed

```typescript
// mcp/tools/discover_shows.ts
{
  name: "discover_shows",
  description: "Find podcast and YouTube shows matching a brand's target audience and budget",
  inputSchema: {
    type: "object",
    properties: {
      brand_url: { type: "string", description: "Brand website URL" },
      target_demographics: { type: "object", description: "Age, gender, interests, location" },
      keywords: { type: "array", items: { type: "string" } },
      budget: { type: "number", description: "Total campaign budget in USD" },
      platforms: { type: "array", items: { type: "string", enum: ["podcast", "youtube"] } }
    },
    required: ["budget"]
  }
}

// mcp/tools/allocate_budget.ts
{
  name: "allocate_budget",
  description: "Optimize budget allocation across selected shows",
  inputSchema: {
    type: "object",
    properties: {
      show_ids: { type: "array", items: { type: "string" } },
      budget: { type: "number" },
      strategy: { type: "string", enum: ["balanced", "concentrated", "testing"] }
    },
    required: ["show_ids", "budget"]
  }
}

// mcp/tools/generate_outreach.ts
{
  name: "generate_outreach",
  description: "Generate personalized outreach emails for podcast/YouTube sponsorship pitches",
  inputSchema: {
    type: "object",
    properties: {
      show_ids: { type: "array", items: { type: "string" } },
      brand_name: { type: "string" },
      brand_description: { type: "string" },
      budget_per_show: { type: "number" }
    },
    required: ["show_ids", "brand_name"]
  }
}

// mcp/tools/check_overlap.ts
{
  name: "check_overlap",
  description: "Check for likely audience overlap between selected shows",
  inputSchema: {
    type: "object",
    properties: {
      show_ids: { type: "array", items: { type: "string" } }
    },
    required: ["show_ids"]
  }
}

// mcp/tools/generate_adcopy.ts
{
  name: "generate_adcopy",
  description: "Generate 60-second host-read ad scripts tailored to each show's tone",
  inputSchema: {
    type: "object",
    properties: {
      show_ids: { type: "array", items: { type: "string" } },
      brand_name: { type: "string" },
      product_description: { type: "string" },
      key_selling_points: { type: "array", items: { type: "string" } }
    },
    required: ["show_ids", "brand_name", "product_description"]
  }
}
```

### MCP Authentication

MCP requests require a Taylslate API key passed in the MCP connection config. Keys are scoped to user accounts and respect tier limits. The MCP server validates the key against Supabase before executing any tool.

---

## 5. AI Integration

### Claude API Usage

All AI calls use `claude-sonnet-4-5-20250929` for cost efficiency. Reserve `claude-opus-4-6` for complex refinement tasks if needed.

```typescript
// lib/ai/claude.ts
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function callClaude(params: {
  system: string;
  prompt: string;
  maxTokens?: number;
}) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: params.maxTokens || 4096,
    system: params.system,
    messages: [{ role: "user", content: params.prompt }],
  });
  return response.content[0].type === "text" ? response.content[0].text : "";
}
```

### Where AI Is Used vs. Where It Isn't

| Task | AI? | Why |
|------|-----|-----|
| Show scoring & ranking | **Yes** — Claude scores audience fit given brand context | Requires nuance, context matching |
| Budget allocation | **No** — deterministic algorithm | Math with domain rules, faster and more reliable |
| Overlap detection | **No** — rule-based scoring | Network/category/demo comparison, no reasoning needed |
| Outreach email generation | **Yes** — Claude writes personalized emails | Creative writing task |
| Ad copy generation | **Yes** — Claude writes scripts | Creative writing task |
| IO PDF import/parsing | **Yes** — Claude extracts structured data from IO PDFs | Unstructured data extraction |
| Campaign refinement | **Yes** — Claude interprets natural language adjustments | Conversational reasoning |
| Competitive sponsor lookup | **No** — database query | Structured data retrieval |

### Cost Estimation Per Campaign

| AI Call | Est. Tokens | Est. Cost |
|---------|-------------|-----------|
| Discovery scoring (batch 20 shows) | ~3K in / ~2K out | ~$0.03 |
| Outreach emails (10 shows) | ~2K in / ~3K out per show | ~$0.15 |
| Ad copy scripts (10 shows) | ~1.5K in / ~1K out per show | ~$0.08 |
| **Total per campaign** | | **~$0.26** |

At $49/mo for 5 campaigns = $1.30 AI cost. Healthy margin.

---

## 6. Data Ingestion Pipeline

### Enrichment Providers

**Rephonic ($99-$299/month) — Primary:**
- 3M+ podcasts with demographics, reach estimates, sponsor history, contacts
- Most permissive commercial terms

**Podscan — Alternative:**
- 4.4M podcasts, 51M episodes, real-time API, MCP server integration
- Founder encourages building on their API

### Enrichment Logic

Agent-provided data (CPMs, rate cards, audience size from CSV import) **always takes precedence** over API estimates. API data fills in gaps — demographics, interests, sponsors, external IDs — but never overwrites agent-provided values.

### Refresh Schedule (Vercel Cron)

```json
// vercel.json
{
  "crons": [
    { "path": "/api/cron/refresh-shows", "schedule": "0 3 * * 1" },
    { "path": "/api/cron/refresh-metadata", "schedule": "0 3 1 * *" },
    { "path": "/api/cron/refresh-sponsors", "schedule": "0 3 * * 4" }
  ]
}
```

---

## 7. Authentication & Authorization

### Supabase Auth

Using Supabase Auth directly — integrates natively with RLS.

```typescript
// lib/supabase/server.ts (already exists in codebase)
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );
}
```

### Tier Enforcement

```typescript
// lib/utils/tier.ts
export const TIER_LIMITS = {
  free:     { campaigns_per_month: 1,  outreach: false, adcopy: false, mcp: false },
  starter:  { campaigns_per_month: 5,  outreach: true,  adcopy: false, mcp: false },
  growth:   { campaigns_per_month: 25, outreach: true,  adcopy: true,  mcp: true  },
  business: { campaigns_per_month: -1, outreach: true,  adcopy: true,  mcp: true  },
} as const;
```

---

## 8. Environment Variables

```bash
# .env.local.example

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Claude
ANTHROPIC_API_KEY=sk-ant-...

# Email
RESEND_API_KEY=re_...

# Enrichment (when ready)
REPHONIC_API_KEY=...
PODSCAN_API_KEY=...

# Stripe (Phase 3+)
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_...

# Cron auth
CRON_SECRET=...
```

---

## 9. Implementation Order

Build in this sequence. Each phase is deployable and testable before moving to the next.

### Wave 1: Supabase Foundation

- [ ] Create Supabase project
- [ ] Run migration SQL from section 2 above
- [ ] Generate Supabase types (`supabase gen types typescript`)
- [ ] Set up Supabase Auth (email/password)
- [ ] Build auth pages (login, signup, callback)
- [ ] Build middleware to protect dashboard routes
- [ ] Wire onboarding to create profile record with role selection
- [ ] Replace all seed data imports in API routes with Supabase queries
- [ ] Deploy to Vercel, confirm auth flow works end-to-end

**Milestone:** User can sign up, log in, see dashboard. API routes return data from Supabase.

### Wave 2: Deal Transaction Loop

- [ ] Build deal CRUD (POST, GET, PATCH, DELETE)
- [ ] Build IO generation from deal (auto line items, standard terms)
- [ ] Verify IO PDF generation works with Supabase data
- [ ] Verify IO email send works with Supabase data
- [ ] Migrate invoice generation to Supabase
- [ ] Build invoice status tracking (draft → sent → paid)
- [ ] Build make-good detection (>10% underdelivery auto-flag)
- [ ] Verify IO import (PDF parsing via Claude) saves to Supabase

**Milestone:** Agent can create deal → generate IO → send IO → track delivery → generate invoice → send invoice. Full transaction loop works.

### Wave 3: Show Roster & Agent Onboarding

- [ ] Build show CRUD endpoints
- [ ] Build CSV import endpoint (parse roster → create shows + agent relationships)
- [ ] Build enrichment client stubs (Rephonic, Podscan — ready to plug in)
- [ ] Build single-show and batch enrichment endpoints
- [ ] Update onboarding flow: role selection → CSV upload → dashboard
- [ ] Update shows page to pull from Supabase
- [ ] Update dashboard stats to use real data

**Milestone:** Agent signs up → imports CSV roster → sees shows → creates deals. Sales agent MVP complete.

### Future Waves

- [ ] Stripe Connect integration (payment facilitation, 2.5% early payment fee)
- [ ] MCP server for agent-native distribution
- [ ] Data enrichment API integration (Rephonic/Podscan)
- [ ] Brand-side campaign planning with real show data
- [ ] Vercel cron jobs for automated data refresh
- [ ] Tier enforcement + billing

---

## Notes

- **Schema source of truth:** `lib/data/types.ts`. This spec's SQL is derived from those types.
- **Supabase over Clerk:** Reduces dependencies. Supabase Auth + RLS gives auth and data security in one system.
- **Sonnet over Opus for AI calls:** Cost efficiency. Reserve Opus for complex refinement if Sonnet underperforms.
- **Agent-side MVP first:** Deals/IOs/Invoices before brand-side campaign management. Clearer pain point, faster validation.
- **MCP at launch, REST API later:** MCP is lighter to build and reaches agent-native users immediately.
