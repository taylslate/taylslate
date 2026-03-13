-- ============================================================
-- TAYLSLATE: DROP ALL + RECREATE
-- Paste this ENTIRE script into Supabase SQL Editor and run it.
-- URL: https://supabase.com/dashboard/project/ldtmhafewfifdizgfrnn/sql/new
-- ============================================================

-- ==================== DROP EVERYTHING ====================
-- Drop in reverse dependency order to avoid FK conflicts

-- Drop triggers first
DROP TRIGGER IF EXISTS update_invoices_timestamp ON public.invoices;
DROP TRIGGER IF EXISTS update_io_timestamp ON public.insertion_orders;
DROP TRIGGER IF EXISTS update_deals_timestamp ON public.deals;
DROP TRIGGER IF EXISTS update_campaigns_timestamp ON public.campaigns;
DROP TRIGGER IF EXISTS update_shows_timestamp ON public.shows;
DROP TRIGGER IF EXISTS update_profiles_timestamp ON public.profiles;

-- Drop functions
DROP FUNCTION IF EXISTS get_avg_negotiated_cpm(UUID);
DROP FUNCTION IF EXISTS reset_monthly_campaigns();
DROP FUNCTION IF EXISTS update_updated_at();

-- Drop tables (CASCADE handles FK refs, policies, indexes)
DROP TABLE IF EXISTS public.api_cache_log CASCADE;
DROP TABLE IF EXISTS public.payments CASCADE;
DROP TABLE IF EXISTS public.invoice_line_items CASCADE;
DROP TABLE IF EXISTS public.invoices CASCADE;
DROP TABLE IF EXISTS public.io_line_items CASCADE;
DROP TABLE IF EXISTS public.insertion_orders CASCADE;
DROP TABLE IF EXISTS public.deals CASCADE;
DROP TABLE IF EXISTS public.campaigns CASCADE;
DROP TABLE IF EXISTS public.show_sponsors CASCADE;
DROP TABLE IF EXISTS public.agent_show_relationships CASCADE;
DROP TABLE IF EXISTS public.shows CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- ==================== CREATE TABLES ====================

-- USERS & AUTH
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

-- SHOWS
CREATE TABLE public.shows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE,
  platform        TEXT NOT NULL CHECK (platform IN ('podcast', 'youtube')),
  description     TEXT,
  image_url       TEXT,
  categories      TEXT[] DEFAULT '{}',
  tags            TEXT[] DEFAULT '{}',
  network         TEXT,
  contact_name    TEXT,
  contact_email   TEXT,
  contact_method  TEXT CHECK (contact_method IN ('email', 'form', 'network_rep', 'agent')),
  agent_id        UUID REFERENCES public.profiles(id),
  audience_size   INT,
  demographics    JSONB DEFAULT '{}',
  audience_interests TEXT[] DEFAULT '{}',
  rate_card       JSONB DEFAULT '{}',
  price_type      TEXT CHECK (price_type IN ('cpm', 'flat_rate')),
  min_buy         DECIMAL(10,2),
  ad_formats      TEXT[] DEFAULT '{}',
  episode_cadence TEXT CHECK (episode_cadence IN ('daily', 'weekly', 'biweekly', 'monthly')),
  avg_episode_length_min INT,
  current_sponsors TEXT[] DEFAULT '{}',
  past_sponsors    TEXT[] DEFAULT '{}',
  apple_id        TEXT,
  spotify_id      TEXT,
  youtube_channel_id TEXT,
  rss_url         TEXT,
  is_claimed      BOOLEAN NOT NULL DEFAULT FALSE,
  is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  data_sources    TEXT[] DEFAULT '{}',
  available_slots INT,
  next_available_date DATE,
  last_api_refresh    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_shows_platform ON public.shows(platform);
CREATE INDEX idx_shows_categories ON public.shows USING GIN(categories);
CREATE INDEX idx_shows_tags ON public.shows USING GIN(tags);
CREATE INDEX idx_shows_audience_size ON public.shows(audience_size DESC);
CREATE INDEX idx_shows_network ON public.shows(network);
CREATE INDEX idx_shows_agent ON public.shows(agent_id);

-- AGENT-SHOW RELATIONSHIPS
CREATE TABLE public.agent_show_relationships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  show_id         UUID NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  commission_rate DECIMAL(5,4),
  is_exclusive    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(agent_id, show_id)
);

CREATE INDEX idx_agent_shows_agent ON public.agent_show_relationships(agent_id);
CREATE INDEX idx_agent_shows_show ON public.agent_show_relationships(show_id);

-- SHOW SPONSORS
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

-- CAMPAIGNS
CREATE TABLE public.campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  brief           JSONB DEFAULT '{}',
  budget_total    DECIMAL(10,2) NOT NULL,
  platforms       TEXT[] DEFAULT '{"podcast"}',
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'planned', 'active', 'completed', 'archived')),
  recommendations JSONB DEFAULT '[]',
  youtube_recommendations JSONB DEFAULT '[]',
  expansion_opportunities JSONB DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaigns_user ON public.campaigns(user_id);
CREATE INDEX idx_campaigns_status ON public.campaigns(status);

-- DEALS
CREATE TABLE public.deals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID REFERENCES public.campaigns(id),
  show_id         UUID NOT NULL REFERENCES public.shows(id),
  brand_id        UUID NOT NULL REFERENCES public.profiles(id),
  agent_id        UUID REFERENCES public.profiles(id),
  agency_id       UUID REFERENCES public.profiles(id),
  status          TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'negotiating', 'approved', 'io_sent', 'signed', 'live', 'completed', 'cancelled')),
  num_episodes    INT NOT NULL,
  placement       TEXT NOT NULL CHECK (placement IN ('pre-roll', 'mid-roll', 'post-roll')),
  ad_format       TEXT NOT NULL CHECK (ad_format IN ('host_read', 'scripted', 'personal_experience', 'dynamic_insertion', 'integration')),
  price_type      TEXT NOT NULL CHECK (price_type IN ('cpm', 'flat_rate')),
  cpm_rate        DECIMAL(10,2) NOT NULL,
  gross_cpm       DECIMAL(10,2),
  guaranteed_downloads INT NOT NULL,
  net_per_episode DECIMAL(10,2) NOT NULL,
  gross_per_episode DECIMAL(10,2),
  total_net       DECIMAL(10,2) NOT NULL,
  total_gross     DECIMAL(10,2),
  is_scripted     BOOLEAN NOT NULL DEFAULT FALSE,
  is_personal_experience BOOLEAN NOT NULL DEFAULT FALSE,
  reader_type     TEXT NOT NULL DEFAULT 'host_read' CHECK (reader_type IN ('host_read', 'producer_read', 'guest_read')),
  content_type    TEXT NOT NULL DEFAULT 'evergreen' CHECK (content_type IN ('evergreen', 'dated')),
  pixel_required  BOOLEAN NOT NULL DEFAULT FALSE,
  competitor_exclusion TEXT[] DEFAULT '{}',
  exclusivity_days INT NOT NULL DEFAULT 90,
  rofr_days       INT NOT NULL DEFAULT 30,
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

-- INSERTION ORDERS
CREATE TABLE public.insertion_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  io_number       TEXT NOT NULL UNIQUE,
  deal_id         UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
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
  total_downloads INT NOT NULL,
  total_gross     DECIMAL(10,2) NOT NULL,
  total_net       DECIMAL(10,2) NOT NULL,
  payment_terms   TEXT NOT NULL DEFAULT 'Net 30 EOM',
  competitor_exclusion TEXT[] DEFAULT '{}',
  exclusivity_days INT NOT NULL DEFAULT 90,
  rofr_days       INT NOT NULL DEFAULT 30,
  cancellation_notice_days INT NOT NULL DEFAULT 14,
  download_tracking_days INT NOT NULL DEFAULT 45,
  make_good_threshold DECIMAL(3,2) NOT NULL DEFAULT 0.10,
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

-- IO LINE ITEMS
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

-- INVOICES
CREATE TABLE public.invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number  TEXT NOT NULL UNIQUE,
  io_id           UUID NOT NULL REFERENCES public.insertion_orders(id),
  io_number       TEXT NOT NULL,
  bill_to_name    TEXT NOT NULL,
  bill_to_email   TEXT NOT NULL,
  bill_to_address TEXT,
  from_name       TEXT NOT NULL,
  from_email      TEXT NOT NULL,
  from_address    TEXT,
  advertiser_name TEXT NOT NULL,
  campaign_period TEXT NOT NULL,
  subtotal        DECIMAL(10,2) NOT NULL,
  adjustments     DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_due       DECIMAL(10,2) NOT NULL,
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

-- INVOICE LINE ITEMS
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

-- PAYMENTS
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

-- API CACHE
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

-- ==================== ROW LEVEL SECURITY ====================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insertion_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.show_sponsors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_show_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.io_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Campaigns
CREATE POLICY "Users read own campaigns" ON public.campaigns FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own campaigns" ON public.campaigns FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own campaigns" ON public.campaigns FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own campaigns" ON public.campaigns FOR DELETE USING (auth.uid() = user_id);

-- Deals
CREATE POLICY "Deal participants read deals" ON public.deals FOR SELECT USING (
  auth.uid() = agent_id OR auth.uid() = brand_id OR auth.uid() = agency_id
);
CREATE POLICY "Deal participants insert deals" ON public.deals FOR INSERT WITH CHECK (
  auth.uid() = agent_id OR auth.uid() = brand_id OR auth.uid() = agency_id
);
CREATE POLICY "Deal participants update deals" ON public.deals FOR UPDATE USING (
  auth.uid() = agent_id OR auth.uid() = brand_id OR auth.uid() = agency_id
);

-- Insertion Orders (via deal)
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

-- IO Line Items (via IO → deal)
CREATE POLICY "IO line items access via deal" ON public.io_line_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.insertion_orders io
    JOIN public.deals d ON d.id = io.deal_id
    WHERE io.id = io_line_items.io_id
    AND (d.agent_id = auth.uid() OR d.brand_id = auth.uid() OR d.agency_id = auth.uid()))
);
CREATE POLICY "IO line items insert via deal" ON public.io_line_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.insertion_orders io
    JOIN public.deals d ON d.id = io.deal_id
    WHERE io.id = io_line_items.io_id
    AND (d.agent_id = auth.uid() OR d.brand_id = auth.uid() OR d.agency_id = auth.uid()))
);
CREATE POLICY "IO line items update via deal" ON public.io_line_items FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.insertion_orders io
    JOIN public.deals d ON d.id = io.deal_id
    WHERE io.id = io_line_items.io_id
    AND (d.agent_id = auth.uid() OR d.brand_id = auth.uid() OR d.agency_id = auth.uid()))
);

-- Invoices (via IO → deal)
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

-- Invoice Line Items (via invoice → IO → deal)
CREATE POLICY "Invoice line items access via deal" ON public.invoice_line_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.invoices inv
    JOIN public.insertion_orders io ON io.id = inv.io_id
    JOIN public.deals d ON d.id = io.deal_id
    WHERE inv.id = invoice_line_items.invoice_id
    AND (d.agent_id = auth.uid() OR d.brand_id = auth.uid() OR d.agency_id = auth.uid()))
);
CREATE POLICY "Invoice line items insert via deal" ON public.invoice_line_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.invoices inv
    JOIN public.insertion_orders io ON io.id = inv.io_id
    JOIN public.deals d ON d.id = io.deal_id
    WHERE inv.id = invoice_line_items.invoice_id
    AND (d.agent_id = auth.uid() OR d.brand_id = auth.uid() OR d.agency_id = auth.uid()))
);

-- Payments (via invoice → IO → deal)
CREATE POLICY "Payments access via deal" ON public.payments FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.invoices inv
    JOIN public.insertion_orders io ON io.id = inv.io_id
    JOIN public.deals d ON d.id = io.deal_id
    WHERE inv.id = payments.invoice_id
    AND (d.agent_id = auth.uid() OR d.brand_id = auth.uid() OR d.agency_id = auth.uid()))
);
CREATE POLICY "Payments insert via deal" ON public.payments FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.invoices inv
    JOIN public.insertion_orders io ON io.id = inv.io_id
    JOIN public.deals d ON d.id = io.deal_id
    WHERE inv.id = payments.invoice_id
    AND (d.agent_id = auth.uid() OR d.brand_id = auth.uid() OR d.agency_id = auth.uid()))
);

-- Shows (public read)
CREATE POLICY "Shows are publicly readable" ON public.shows FOR SELECT USING (true);
CREATE POLICY "Shows insert by authenticated" ON public.shows FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Shows update by authenticated" ON public.shows FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Show Sponsors (public read)
CREATE POLICY "Sponsors are publicly readable" ON public.show_sponsors FOR SELECT USING (true);

-- Agent-Show Relationships
CREATE POLICY "Agents read own relationships" ON public.agent_show_relationships FOR SELECT USING (auth.uid() = agent_id);
CREATE POLICY "Agents insert own relationships" ON public.agent_show_relationships FOR INSERT WITH CHECK (auth.uid() = agent_id);
CREATE POLICY "Agents delete own relationships" ON public.agent_show_relationships FOR DELETE USING (auth.uid() = agent_id);

-- ==================== FUNCTIONS & TRIGGERS ====================

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

-- Aggregate negotiated CPM for a show
CREATE OR REPLACE FUNCTION get_avg_negotiated_cpm(target_show_id UUID)
RETURNS DECIMAL AS $$
  SELECT AVG(cpm_rate)
  FROM public.deals
  WHERE show_id = target_show_id
    AND cpm_rate IS NOT NULL
    AND status IN ('signed', 'live', 'completed')
  HAVING COUNT(*) >= 3;
$$ LANGUAGE sql SECURITY DEFINER;

-- ==================== DONE ====================
-- All 13 tables created with indexes, RLS policies, triggers, and functions.
-- Shows table now includes agent_id column.
-- Shows have INSERT/UPDATE policies for authenticated users (needed for seed scripts via service role).
