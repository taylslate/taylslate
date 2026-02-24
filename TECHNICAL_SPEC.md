# Taylslate — Technical Specification

> **Stack:** Next.js 14 (App Router) · TypeScript · Supabase (Postgres + Auth) · Vercel · Claude API  
> **Last updated:** February 2026 · v1.0

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

```
taylslate/
├── app/
│   ├── layout.tsx                    # Root layout with Supabase provider
│   ├── page.tsx                      # Landing / marketing page
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   └── callback/route.ts         # Supabase OAuth callback
│   ├── (dashboard)/
│   │   ├── layout.tsx                # Authenticated layout with sidebar
│   │   ├── campaigns/
│   │   │   ├── page.tsx              # Campaign list
│   │   │   ├── new/page.tsx          # Campaign brief form (7 fields)
│   │   │   └── [id]/
│   │   │       ├── page.tsx          # Campaign results / media plan
│   │   │       ├── workspace/page.tsx # Campaign management (bookings, deal terms)
│   │   │       └── export/route.ts   # CSV export endpoint
│   │   ├── shows/
│   │   │   └── [id]/page.tsx         # Show detail page
│   │   └── settings/page.tsx         # Account, billing, API keys
│   └── api/
│       ├── campaigns/
│       │   ├── route.ts              # POST: create campaign
│       │   └── [id]/
│       │       ├── route.ts          # GET: campaign detail, PATCH: update
│       │       ├── discover/route.ts  # POST: run discovery + scoring
│       │       ├── allocate/route.ts  # POST: run budget optimization
│       │       ├── outreach/route.ts  # POST: generate outreach emails
│       │       ├── adcopy/route.ts    # POST: generate ad copy/scripts
│       │       └── overlap/route.ts   # POST: check audience overlap
│       ├── bookings/
│       │   └── route.ts              # POST: create booking, GET: list
│       ├── outcomes/
│       │   └── route.ts              # POST: submit outcome rating
│       ├── shows/
│       │   └── [id]/route.ts         # GET: show detail
│       ├── webhooks/
│       │   └── stripe/route.ts       # Stripe webhook for subscriptions
│       └── cron/
│           ├── refresh-shows/route.ts      # Weekly: audience data refresh
│           ├── refresh-metadata/route.ts   # Monthly: show metadata refresh
│           └── refresh-sponsors/route.ts   # Weekly: sponsor history refresh
├── mcp/
│   ├── server.ts                     # MCP server entry point
│   ├── tools/
│   │   ├── discover_shows.ts
│   │   ├── allocate_budget.ts
│   │   ├── generate_outreach.ts
│   │   ├── generate_adcopy.ts
│   │   └── check_overlap.ts
│   └── package.json                  # Separate package for MCP server
├── lib/
│   ├── supabase/
│   │   ├── client.ts                 # Browser client
│   │   ├── server.ts                 # Server client (cookies)
│   │   ├── admin.ts                  # Service role client (cron jobs)
│   │   └── types.ts                  # Generated DB types
│   ├── ai/
│   │   ├── claude.ts                 # Claude API wrapper
│   │   ├── prompts/
│   │   │   ├── discovery.ts          # Show scoring prompt
│   │   │   ├── outreach.ts           # Email generation prompt
│   │   │   ├── adcopy.ts             # Script generation prompt
│   │   │   └── refinement.ts         # Campaign refinement prompt
│   │   └── scoring.ts               # Show fit scoring algorithm
│   ├── engines/
│   │   ├── discovery.ts              # Discovery engine (DB queries + AI scoring)
│   │   ├── budget.ts                 # Budget optimization algorithm
│   │   └── overlap.ts               # Overlap detection algorithm
│   ├── ingestion/
│   │   ├── podchaser.ts             # Podchaser API client + caching logic
│   │   ├── youtube.ts               # YouTube Data API client
│   │   └── scraper.ts               # Apple/Spotify/social enrichment
│   ├── utils/
│   │   ├── csv.ts                   # CSV export builder
│   │   ├── rate-limit.ts            # API rate limiting
│   │   └── tier.ts                  # Tier enforcement helpers
│   └── constants.ts                 # CPM defaults, budget rules, tier limits
├── components/
│   ├── ui/                          # Shared UI primitives (shadcn/ui)
│   ├── campaign/
│   │   ├── BriefForm.tsx            # 7-field campaign intake form
│   │   ├── ResultsTable.tsx         # Ranked show recommendations
│   │   ├── BudgetBreakdown.tsx      # Per-show allocation display
│   │   ├── OverlapWarnings.tsx      # Overlap flags on results
│   │   └── CompetitorBadges.tsx     # Sponsor history badges
│   ├── workspace/
│   │   ├── BookingForm.tsx          # Enter deal terms
│   │   ├── OutcomeRating.tsx        # Post-campaign feedback
│   │   └── CampaignStatus.tsx       # Status tracking
│   └── layout/
│       ├── Sidebar.tsx
│       └── Header.tsx
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql   # Full schema migration
├── .env.local.example
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## 2. Database Schema

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
  tier            TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'starter', 'growth', 'business')),
  stripe_customer_id   TEXT,
  stripe_subscription_id TEXT,
  campaigns_this_month INT NOT NULL DEFAULT 0,
  campaigns_reset_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SHOWS (Our unified database — the center of gravity)
-- ============================================================

CREATE TABLE public.shows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identity
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE,
  platform        TEXT NOT NULL CHECK (platform IN ('podcast', 'youtube')),
  description     TEXT,
  image_url       TEXT,
  
  -- Taxonomy
  categories      TEXT[] DEFAULT '{}',       -- e.g. {'comedy', 'society_culture'}
  tags            TEXT[] DEFAULT '{}',        -- freeform keywords
  language        TEXT DEFAULT 'en',
  
  -- Network & contacts
  network         TEXT,                       -- e.g. 'Wondery', 'Barstool'
  contact_name    TEXT,
  contact_email   TEXT,
  contact_method  TEXT,                       -- 'email', 'form', 'network_rep'
  
  -- Audience metrics (refreshed weekly)
  audience_size   INT,                        -- estimated downloads/ep (podcast) or avg views (YT)
  audience_demo   JSONB DEFAULT '{}',         -- {"age_25_34": 0.35, "female": 0.62, ...}
  audience_geo    JSONB DEFAULT '{}',         -- {"US": 0.70, "UK": 0.12, ...}
  audience_interests JSONB DEFAULT '{}',      -- {"fitness": 0.8, "tech": 0.3, ...}
  
  -- Pricing (from rate cards + aggregated negotiated data)
  rate_card       JSONB DEFAULT '{}',         -- {"preroll_cpm": 18, "midroll_cpm": 25, "postroll_cpm": 15}
  avg_negotiated_cpm DECIMAL(10,2),           -- anonymized aggregate from campaign data
  min_buy         DECIMAL(10,2),              -- minimum campaign spend
  
  -- Ad format info
  ad_formats      TEXT[] DEFAULT '{}',        -- {'host_read', 'preroll', 'midroll', 'postroll', 'integration'}
  episodes_per_week DECIMAL(3,1),             -- publishing frequency
  avg_episode_length INT,                     -- minutes
  
  -- External IDs (for API cross-referencing)
  podchaser_id    TEXT,
  apple_id        TEXT,
  spotify_id      TEXT,
  youtube_channel_id TEXT,
  rss_url         TEXT,
  
  -- Ranking & enrichment signals
  apple_rank      INT,                        -- current Apple Podcasts rank
  spotify_rank    INT,
  social_followers INT,                       -- aggregate across platforms
  engagement_rate DECIMAL(5,4),               -- social engagement rate
  
  -- Verification & sourcing
  is_claimed      BOOLEAN NOT NULL DEFAULT FALSE,  -- show owner claimed profile
  is_verified     BOOLEAN NOT NULL DEFAULT FALSE,  -- we verified the data
  data_sources    TEXT[] DEFAULT '{}',              -- {'podchaser', 'youtube_api', 'scraped', 'claimed'}
  
  -- Timestamps
  last_api_refresh    TIMESTAMPTZ,
  last_scrape_refresh TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_shows_platform ON public.shows(platform);
CREATE INDEX idx_shows_categories ON public.shows USING GIN(categories);
CREATE INDEX idx_shows_tags ON public.shows USING GIN(tags);
CREATE INDEX idx_shows_audience_size ON public.shows(audience_size DESC);
CREATE INDEX idx_shows_network ON public.shows(network);
CREATE INDEX idx_shows_podchaser_id ON public.shows(podchaser_id);
CREATE INDEX idx_shows_youtube_channel_id ON public.shows(youtube_channel_id);

-- ============================================================
-- SPONSORS (competitive intel — which brands advertise where)
-- ============================================================

CREATE TABLE public.show_sponsors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id         UUID NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  brand_name      TEXT NOT NULL,
  brand_domain    TEXT,
  first_seen      DATE,
  last_seen       DATE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  source          TEXT NOT NULL DEFAULT 'podchaser',  -- 'podchaser', 'scraped', 'user_reported'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_show_sponsors_show ON public.show_sponsors(show_id);
CREATE INDEX idx_show_sponsors_brand ON public.show_sponsors(brand_name);

-- ============================================================
-- CAMPAIGNS
-- ============================================================

CREATE TABLE public.campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  
  -- Brief inputs (the 7 fields)
  name            TEXT NOT NULL,               -- user's name for this campaign
  brand_url       TEXT,
  target_demographics JSONB DEFAULT '{}',      -- {"age_range": "25-34", "gender": "female", "interests": ["fitness","wellness"]}
  keywords        TEXT[] DEFAULT '{}',
  budget_total    DECIMAL(10,2) NOT NULL,
  budget_currency TEXT NOT NULL DEFAULT 'USD',
  platforms       TEXT[] DEFAULT '{"podcast"}', -- {'podcast', 'youtube'}
  campaign_goals  TEXT,                         -- freeform: "brand awareness", "DTC conversions", etc.
  
  -- Generated plan
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'planned', 'active', 'completed', 'archived')),
  recommendations JSONB DEFAULT '[]',           -- array of scored show recommendations
  budget_allocation JSONB DEFAULT '[]',         -- array of per-show allocations
  overlap_warnings JSONB DEFAULT '[]',          -- array of overlap flags
  
  -- AI outputs (stored for re-display without re-generation)
  outreach_drafts JSONB DEFAULT '[]',           -- array of {show_id, email_subject, email_body}
  adcopy_drafts   JSONB DEFAULT '[]',           -- array of {show_id, script_text, duration}
  
  -- Metadata
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaigns_user ON public.campaigns(user_id);
CREATE INDEX idx_campaigns_status ON public.campaigns(status);

-- ============================================================
-- BOOKINGS (actual deals — the proprietary data gold mine)
-- ============================================================

CREATE TABLE public.bookings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  show_id         UUID NOT NULL REFERENCES public.shows(id),
  user_id         UUID NOT NULL REFERENCES public.profiles(id),
  
  -- Deal terms (entered by user)
  negotiated_cpm  DECIMAL(10,2),
  total_cost      DECIMAL(10,2),
  num_episodes    INT,
  placement_type  TEXT CHECK (placement_type IN ('preroll', 'midroll', 'postroll', 'host_read', 'integration', 'other')),
  flight_start    DATE,
  flight_end      DATE,
  
  -- Status
  status          TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'confirmed', 'live', 'completed', 'cancelled')),
  notes           TEXT,
  
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bookings_campaign ON public.bookings(campaign_id);
CREATE INDEX idx_bookings_show ON public.bookings(show_id);
CREATE INDEX idx_bookings_user ON public.bookings(user_id);

-- ============================================================
-- OUTCOMES (self-reported campaign performance)
-- ============================================================

CREATE TABLE public.outcomes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  show_id         UUID NOT NULL REFERENCES public.shows(id),
  user_id         UUID NOT NULL REFERENCES public.profiles(id),
  
  -- Ratings
  overall_rating  INT NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  would_rebook    BOOLEAN,
  audience_fit    INT CHECK (audience_fit BETWEEN 1 AND 5),
  host_quality    INT CHECK (host_quality BETWEEN 1 AND 5),
  
  -- Optional performance data
  reported_impressions INT,
  reported_conversions INT,
  reported_roas    DECIMAL(10,2),
  
  -- Attribution integration data (from Podscribe etc.)
  attribution_source TEXT,                    -- 'podscribe', 'magellan', 'self_reported'
  attribution_data   JSONB DEFAULT '{}',      -- raw data from attribution provider
  
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_outcomes_show ON public.outcomes(show_id);
CREATE INDEX idx_outcomes_booking ON public.outcomes(booking_id);

-- ============================================================
-- API CACHE (tracking data freshness for ingestion pipeline)
-- ============================================================

CREATE TABLE public.api_cache_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL,               -- 'podchaser', 'youtube', 'apple_scrape', 'spotify_scrape'
  entity_type     TEXT NOT NULL,               -- 'show', 'sponsor', 'audience'
  entity_id       TEXT,                        -- external ID
  last_fetched    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_refresh    TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed', 'pending')),
  error_message   TEXT,
  points_used     INT                          -- for Podchaser query point tracking
);

CREATE INDEX idx_cache_log_refresh ON public.api_cache_log(next_refresh);
CREATE INDEX idx_cache_log_source ON public.api_cache_log(source, entity_type);

-- ============================================================
-- SHOW CLAIMS (supply-side portal)
-- ============================================================

CREATE TABLE public.show_claims (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id         UUID NOT NULL REFERENCES public.shows(id),
  claimed_by_email TEXT NOT NULL,
  claimed_by_name  TEXT,
  verification_method TEXT,                    -- 'rss_ownership', 'email_domain', 'manual'
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  
  -- Claimed data (overwrites show defaults when verified)
  claimed_rate_card    JSONB DEFAULT '{}',
  claimed_demographics JSONB DEFAULT '{}',
  claimed_availability JSONB DEFAULT '{}',     -- {"available": true, "next_open_slot": "2026-04-01"}
  claimed_ad_formats   TEXT[] DEFAULT '{}',
  claimed_contact      JSONB DEFAULT '{}',
  
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_claims_show ON public.show_claims(show_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outcomes ENABLE ROW LEVEL SECURITY;

-- Users can only see/edit their own data
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users read own campaigns" ON public.campaigns FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own campaigns" ON public.campaigns FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own campaigns" ON public.campaigns FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own campaigns" ON public.campaigns FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users read own bookings" ON public.bookings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own bookings" ON public.bookings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own bookings" ON public.bookings FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users read own outcomes" ON public.outcomes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own outcomes" ON public.outcomes FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Shows are publicly readable (no RLS restriction on SELECT)
-- Only service role can write to shows (via cron/ingestion)
ALTER TABLE public.shows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Shows are publicly readable" ON public.shows FOR SELECT USING (true);

ALTER TABLE public.show_sponsors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Sponsors are publicly readable" ON public.show_sponsors FOR SELECT USING (true);

-- ============================================================
-- FUNCTIONS
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
CREATE TRIGGER update_bookings_timestamp BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Monthly campaign counter reset
CREATE OR REPLACE FUNCTION reset_monthly_campaigns()
RETURNS void AS $$
BEGIN
  UPDATE public.profiles
  SET campaigns_this_month = 0, campaigns_reset_at = NOW()
  WHERE campaigns_reset_at < DATE_TRUNC('month', NOW());
END;
$$ LANGUAGE plpgsql;

-- Aggregate negotiated CPM for a show (anonymized)
CREATE OR REPLACE FUNCTION get_avg_negotiated_cpm(target_show_id UUID)
RETURNS DECIMAL AS $$
  SELECT AVG(negotiated_cpm)
  FROM public.bookings
  WHERE show_id = target_show_id
    AND negotiated_cpm IS NOT NULL
    AND status IN ('confirmed', 'live', 'completed')
  HAVING COUNT(*) >= 3;  -- only surface when we have 3+ data points
$$ LANGUAGE sql SECURITY DEFINER;
```

---

## 3. API Endpoints

### Campaigns

| Method | Path | Description | Auth | Tier |
|--------|------|-------------|------|------|
| `POST` | `/api/campaigns` | Create campaign from brief | Yes | All |
| `GET` | `/api/campaigns` | List user's campaigns | Yes | All |
| `GET` | `/api/campaigns/[id]` | Get campaign detail + plan | Yes | All |
| `PATCH` | `/api/campaigns/[id]` | Update campaign | Yes | All |
| `DELETE` | `/api/campaigns/[id]` | Archive campaign | Yes | All |
| `POST` | `/api/campaigns/[id]/discover` | Run discovery + scoring | Yes | All |
| `POST` | `/api/campaigns/[id]/allocate` | Run budget optimization | Yes | All |
| `POST` | `/api/campaigns/[id]/outreach` | Generate outreach emails | Yes | Starter+ |
| `POST` | `/api/campaigns/[id]/adcopy` | Generate ad copy/scripts | Yes | Growth+ |
| `POST` | `/api/campaigns/[id]/overlap` | Check audience overlap | Yes | All |
| `GET` | `/api/campaigns/[id]/export` | CSV export of plan | Yes | All |

### Bookings & Outcomes

| Method | Path | Description | Auth | Tier |
|--------|------|-------------|------|------|
| `POST` | `/api/bookings` | Create booking (enter deal terms) | Yes | All |
| `GET` | `/api/bookings?campaign_id=X` | List bookings for campaign | Yes | All |
| `PATCH` | `/api/bookings/[id]` | Update booking status/terms | Yes | All |
| `POST` | `/api/outcomes` | Submit outcome rating | Yes | All |

### Shows

| Method | Path | Description | Auth | Tier |
|--------|------|-------------|------|------|
| `GET` | `/api/shows/[id]` | Show detail | Yes | All |
| `GET` | `/api/shows?search=X&category=Y` | Search/filter shows | Yes | All |

### Request/Response Patterns

```typescript
// POST /api/campaigns — Create campaign
// Request:
{
  name: string;
  brand_url?: string;
  target_demographics: {
    age_range?: string;       // "25-34"
    gender?: string;          // "female", "male", "all"
    interests?: string[];     // ["fitness", "wellness", "nutrition"]
    location?: string;        // "US", "US+UK"
  };
  keywords: string[];         // ["health", "supplements", "DTC"]
  budget_total: number;       // 20000
  platforms: ("podcast" | "youtube")[];
  campaign_goals?: string;    // "DTC conversions for Q2 launch"
}

// POST /api/campaigns/[id]/discover — Run discovery
// Response:
{
  recommendations: {
    show_id: string;
    name: string;
    platform: "podcast" | "youtube";
    audience_size: number;
    fit_score: number;          // 0-100
    fit_rationale: string;      // AI-generated explanation
    estimated_cpm: number;
    categories: string[];
    network: string | null;
    contact_email: string | null;
    current_sponsors: string[]; // competitive intel
    overlap_flag: boolean;
    overlap_with: string[];     // show IDs with likely overlap
  }[];
  total_results: number;
  query_metadata: {
    shows_evaluated: number;
    ai_model: string;
    generated_at: string;
  };
}

// POST /api/campaigns/[id]/allocate — Budget optimization
// Request:
{
  selected_show_ids: string[];   // user picks from recommendations
  budget_total: number;
  strategy: "balanced" | "concentrated" | "testing";  // optional
}
// Response:
{
  allocations: {
    show_id: string;
    show_name: string;
    allocated_budget: number;
    num_episodes: number;
    placement_type: string;
    estimated_cpm: number;
    estimated_impressions: number;
    rationale: string;
  }[];
  budget_used: number;
  budget_remaining: number;
  warnings: string[];           // e.g. "Show X has a $5K minimum buy"
}

// POST /api/campaigns/[id]/outreach — Generate emails
// Response:
{
  drafts: {
    show_id: string;
    show_name: string;
    contact_email: string;
    subject: string;
    body: string;               // personalized email text
  }[];
}

// POST /api/campaigns/[id]/adcopy — Generate scripts  
// Response:
{
  scripts: {
    show_id: string;
    show_name: string;
    script_text: string;        // 60-second host-read draft
    duration_seconds: number;
    tone_notes: string;         // "conversational, humor-forward"
  }[];
}
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
| Campaign refinement | **Yes** — Claude interprets natural language adjustments | Conversational reasoning |
| Competitive sponsor lookup | **No** — database query | Structured data retrieval |
| CSV export | **No** — template generation | Mechanical transformation |

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

### Podchaser Integration

```typescript
// lib/ingestion/podchaser.ts

const PODCHASER_API = "https://api.podchaser.com/graphql";

// Discovery query — search shows by term, sorted by audience size
const SEARCH_SHOWS_QUERY = `
  query($term: String!, $first: Int!) {
    podcasts(
      searchTerm: $term,
      first: $first,
      sort: { sortBy: FOLLOWER_COUNT, direction: DESCENDING }
    ) {
      paginatorInfo { total hasMorePages }
      data {
        id
        title
        description
        url
        rssUrl
        imageUrl
        language
        numberOfEpisodes
        applePodcastsId
        webUrl
        categories { id title }
      }
    }
  }
`;

// Sponsor history query
const SHOW_SPONSORS_QUERY = `
  query($podcastId: ID!) {
    podcast(identifier: { id: $podcastId, type: PODCHASER }) {
      id
      sponsors {
        data {
          name
          url
        }
      }
    }
  }
`;
```

### Refresh Schedule (Vercel Cron)

```typescript
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/refresh-shows",
      "schedule": "0 3 * * 1"          // Weekly Monday 3AM UTC — audience data
    },
    {
      "path": "/api/cron/refresh-metadata",
      "schedule": "0 3 1 * *"          // Monthly 1st at 3AM UTC — show metadata
    },
    {
      "path": "/api/cron/refresh-sponsors",
      "schedule": "0 3 * * 4"          // Weekly Thursday 3AM UTC — sponsor history
    }
  ]
}
```

### Ingestion Logic

Each cron job:
1. Queries `api_cache_log` for entities due for refresh
2. Batches Podchaser API calls (respecting 50 req/10sec limit)
3. Upserts show data into `public.shows`
4. Tracks points usage via `X-Podchaser-Points-Remaining` header
5. Logs results to `api_cache_log`

---

## 7. Authentication & Authorization

### Supabase Auth (replaces Clerk from earlier plans)

Using Supabase Auth directly instead of Clerk — reduces dependencies and integrates natively with RLS.

```typescript
// lib/supabase/server.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function createClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
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
  business: { campaigns_per_month: -1, outreach: true,  adcopy: true,  mcp: true  }, // -1 = unlimited
} as const;

export function canCreateCampaign(profile: Profile): boolean {
  const limit = TIER_LIMITS[profile.tier].campaigns_per_month;
  if (limit === -1) return true;
  return profile.campaigns_this_month < limit;
}

export function canUseFeature(profile: Profile, feature: keyof typeof TIER_LIMITS.free): boolean {
  return TIER_LIMITS[profile.tier][feature] as boolean;
}
```

---

## 8. Environment Variables

```bash
# .env.local.example

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...          # Server-side only, for cron jobs

# Claude
ANTHROPIC_API_KEY=sk-ant-...

# Podchaser
PODCHASER_API_TOKEN=...                   # OAuth client credentials token

# YouTube
YOUTUBE_API_KEY=...

# Stripe
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_...

# MCP Server
MCP_SERVER_PORT=3001

# Cron auth (Vercel cron jobs send this header)
CRON_SECRET=...
```

---

## 9. Implementation Order

Build in this sequence. Each phase is deployable and testable before moving to the next.

### Phase 1: Foundation (Week 1-2)

- [ ] Initialize Next.js 14 project with TypeScript
- [ ] Set up Supabase project + run migration SQL
- [ ] Generate Supabase types (`supabase gen types typescript`)
- [ ] Set up Supabase Auth (email/password + Google OAuth)
- [ ] Build auth pages (login, signup, callback)
- [ ] Build authenticated layout with sidebar
- [ ] Build profile/settings page
- [ ] Deploy to Vercel, confirm auth flow works end-to-end

**Milestone:** User can sign up, log in, see empty dashboard.

### Phase 2: Data Layer (Week 3-4)

- [ ] Build Podchaser API client (`lib/ingestion/podchaser.ts`)
- [ ] Build initial data seed script — pull top 1000 podcasts by category
- [ ] Build YouTube Data API client (`lib/ingestion/youtube.ts`)
- [ ] Build show upsert logic (API data → `public.shows`)
- [ ] Build sponsor ingestion (Podchaser → `public.show_sponsors`)
- [ ] Set up Vercel cron jobs for refresh schedule
- [ ] Build `api_cache_log` tracking
- [ ] Verify data in Supabase dashboard

**Milestone:** Database has 1000+ shows with metadata, audience data, and sponsor history.

### Phase 3: Core Engine (Week 5-7)

- [ ] Build campaign brief form (7 fields)
- [ ] Build `POST /api/campaigns` endpoint
- [ ] Build discovery engine (`lib/engines/discovery.ts`)
  - DB query: filter shows by platform, category, audience size
  - AI scoring: Claude scores top 50 candidates for fit
  - Return ranked top 20
- [ ] Build budget optimization algorithm (`lib/engines/budget.ts`)
  - Input: selected shows + total budget
  - Logic: 3-4 ep test flights, CPM-based allocation, diversification, min buy checks
  - Output: per-show allocation
- [ ] Build overlap detection (`lib/engines/overlap.ts`)
  - Rule-based: network match, category match, demo similarity
  - Output: overlap warnings with alternatives
- [ ] Build results page UI (ranked table + budget breakdown + overlap warnings + competitor badges)
- [ ] Build CSV export

**Milestone:** User submits brief → gets ranked, budget-allocated media plan with overlap warnings and competitive intel. Core product works.

### Phase 4: AI Content (Week 8-9)

- [ ] Build outreach email generation (`lib/ai/prompts/outreach.ts`)
- [ ] Build ad copy generation (`lib/ai/prompts/adcopy.ts`)
- [ ] Build `POST /api/campaigns/[id]/outreach` endpoint
- [ ] Build `POST /api/campaigns/[id]/adcopy` endpoint
- [ ] Add outreach + adcopy sections to results page UI
- [ ] Store generated content in campaign record (JSONB fields)

**Milestone:** Full media plan now includes personalized outreach emails and ad scripts per show.

### Phase 5: Campaign Management (Week 10-11)

- [ ] Build campaign workspace page
- [ ] Build booking form (enter deal terms: negotiated CPM, episodes, dates)
- [ ] Build `POST /api/bookings` endpoint
- [ ] Build outcome rating form (1-5 scale + notes)
- [ ] Build `POST /api/outcomes` endpoint
- [ ] Build logic to update `shows.avg_negotiated_cpm` from anonymized booking data
- [ ] Build campaign status tracking (draft → planned → active → completed)

**Milestone:** Brands can track bookings, enter real deal data, and rate outcomes. Proprietary data flywheel begins.

### Phase 6: Distribution (Week 12-13)

- [ ] Build MCP server (`/mcp/` directory)
- [ ] Expose 5 tools: discover, allocate, outreach, overlap, adcopy
- [ ] Build MCP API key generation in settings page
- [ ] Build OpenClaw skill wrapper
- [ ] Test with Claude Desktop MCP integration
- [ ] Write MCP setup documentation

**Milestone:** External agents can call Taylslate's intelligence. Distribution beyond our own UI.

### Phase 7: Monetization (Week 14)

- [ ] Set up Stripe products + prices for 4 tiers
- [ ] Build Stripe checkout flow
- [ ] Build Stripe webhook handler (subscription events)
- [ ] Implement tier enforcement on all gated endpoints
- [ ] Build monthly campaign counter reset cron
- [ ] Build upgrade prompts in UI when hitting limits

**Milestone:** Product is monetized. Free users convert to paid when they hit limits.

### Phase 8: Show Portal (Week 15-16)

- [ ] Build public show claim page
- [ ] Build claim verification flow (RSS ownership check or email domain match)
- [ ] Build claimed data override logic (verified claims take priority)
- [ ] Surface "Verified" badges in recommendations

**Milestone:** Supply-side data collection begins. Shows can improve their own listings.

---

## Notes

- **Supabase over Clerk:** Reduces dependencies. Supabase Auth + RLS gives us auth and data security in one system. One fewer vendor to manage.
- **Sonnet over Opus for AI calls:** Cost efficiency. Sonnet handles scoring and content generation well. Reserve Opus for complex refinement if Sonnet underperforms.
- **MCP at launch, REST API later:** MCP is lighter to build and reaches agent-native users immediately. REST API requires docs, versioning, billing — that's a Phase 2 product.
- **No campaign calendar at launch:** Campaign workspace with status tracking covers the need. Visual calendar is a v1.1 polish feature.
