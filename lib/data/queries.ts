// ============================================================
// TAYLSLATE SUPABASE QUERIES
// Replaces seed data imports with real database queries.
// ============================================================

import { createClient } from "@/lib/supabase/server";
import type {
  Profile,
  Show,
  ShowContact,
  Deal,
  InsertionOrder,
  IOLineItem,
  Invoice,
  InvoiceLineItem,
  AgentDashboardStats,
} from "./types";

// ---- Auth & Profiles ----

export async function getAuthenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

export async function getUserProfile(userId: string): Promise<Profile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error || !data) return null;
  return data as Profile;
}

export async function getProfileById(id: string): Promise<Profile | null> {
  return getUserProfile(id);
}

// ---- Shows ----

/** Transform flat DB row into Show with nested contact object */
function transformShow(row: Record<string, unknown>): Show {
  const contact: ShowContact = {
    name: (row.contact_name as string) ?? "",
    email: (row.contact_email as string) ?? "",
    method: ((row.contact_method as string) ?? "email") as ShowContact["method"],
  };

  return {
    id: row.id as string,
    name: row.name as string,
    platform: row.platform as Show["platform"],
    description: (row.description as string) ?? "",
    image_url: row.image_url as string | undefined,
    categories: (row.categories as string[]) ?? [],
    tags: (row.tags as string[]) ?? [],
    network: row.network as string | undefined,
    contact,
    agent_id: row.agent_id as string | undefined,
    audience_size: (row.audience_size as number) ?? 0,
    demographics: (row.demographics as Show["demographics"]) ?? {},
    audience_interests: (row.audience_interests as string[]) ?? [],
    rate_card: (row.rate_card as Show["rate_card"]) ?? {},
    price_type: (row.price_type as Show["price_type"]) ?? "cpm",
    min_buy: row.min_buy as number | undefined,
    ad_formats: (row.ad_formats as Show["ad_formats"]) ?? [],
    episode_cadence: (row.episode_cadence as Show["episode_cadence"]) ?? "weekly",
    avg_episode_length_min: (row.avg_episode_length_min as number) ?? 0,
    current_sponsors: (row.current_sponsors as string[]) ?? [],
    past_sponsors: (row.past_sponsors as string[]) ?? [],
    apple_id: row.apple_id as string | undefined,
    spotify_id: row.spotify_id as string | undefined,
    youtube_channel_id: row.youtube_channel_id as string | undefined,
    rss_url: row.rss_url as string | undefined,
    is_claimed: (row.is_claimed as boolean) ?? false,
    is_verified: (row.is_verified as boolean) ?? false,
    available_slots: row.available_slots as number | undefined,
    next_available_date: row.next_available_date as string | undefined,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export async function getAllShows(): Promise<Show[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shows")
    .select("*")
    .order("audience_size", { ascending: false });
  if (error || !data) return [];
  return data.map(transformShow);
}

export async function getShowById(id: string): Promise<Show | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shows")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return transformShow(data);
}

export async function getShowsByAgent(agentId: string): Promise<Show[]> {
  const supabase = await createClient();
  // Join through agent_show_relationships
  const { data: rels, error: relError } = await supabase
    .from("agent_show_relationships")
    .select("show_id")
    .eq("agent_id", agentId);
  if (relError || !rels || rels.length === 0) return [];

  const showIds = rels.map((r) => r.show_id);
  const { data, error } = await supabase
    .from("shows")
    .select("*")
    .in("id", showIds)
    .order("audience_size", { ascending: false });
  if (error || !data) return [];
  return data.map(transformShow);
}

// ---- Deals ----

export async function getAllDealsForUser(userId: string): Promise<Deal[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deals")
    .select("*")
    .or(`agent_id.eq.${userId},brand_id.eq.${userId},agency_id.eq.${userId}`)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as Deal[];
}

export async function getDealById(id: string): Promise<Deal | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deals")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data as Deal;
}

export async function createDeal(deal: Omit<Deal, "id" | "created_at" | "updated_at">): Promise<Deal | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deals")
    .insert(deal)
    .select()
    .single();
  if (error || !data) return null;
  return data as Deal;
}

export async function updateDeal(id: string, updates: Partial<Deal>): Promise<Deal | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deals")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error || !data) return null;
  return data as Deal;
}

export async function addDeals(deals: Omit<Deal, "created_at" | "updated_at">[]): Promise<Deal[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deals")
    .insert(deals)
    .select();
  if (error || !data) return [];
  return data as Deal[];
}

// ---- Insertion Orders ----

export async function getIOByDealId(dealId: string): Promise<(InsertionOrder & { line_items: IOLineItem[] }) | null> {
  const supabase = await createClient();
  const { data: ioData, error: ioError } = await supabase
    .from("insertion_orders")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ioError || !ioData) return null;

  const { data: lineItems, error: liError } = await supabase
    .from("io_line_items")
    .select("*")
    .eq("io_id", ioData.id)
    .order("post_date", { ascending: true });

  return {
    ...ioData,
    line_items: (liError || !lineItems ? [] : lineItems) as IOLineItem[],
  } as InsertionOrder & { line_items: IOLineItem[] };
}

export async function getIOById(id: string): Promise<(InsertionOrder & { line_items: IOLineItem[] }) | null> {
  const supabase = await createClient();
  const { data: ioData, error: ioError } = await supabase
    .from("insertion_orders")
    .select("*")
    .eq("id", id)
    .single();
  if (ioError || !ioData) return null;

  const { data: lineItems, error: liError } = await supabase
    .from("io_line_items")
    .select("*")
    .eq("io_id", ioData.id)
    .order("post_date", { ascending: true });

  return {
    ...ioData,
    line_items: (liError || !lineItems ? [] : lineItems) as IOLineItem[],
  } as InsertionOrder & { line_items: IOLineItem[] };
}

export async function createIO(
  io: Omit<InsertionOrder, "id" | "line_items" | "created_at" | "updated_at">,
  lineItems: Omit<IOLineItem, "id">[]
): Promise<(InsertionOrder & { line_items: IOLineItem[] }) | null> {
  const supabase = await createClient();

  // Insert IO
  const { data: ioData, error: ioError } = await supabase
    .from("insertion_orders")
    .insert(io)
    .select()
    .single();
  if (ioError || !ioData) return null;

  // Insert line items with io_id
  const itemsWithIoId = lineItems.map((li) => ({ ...li, io_id: ioData.id }));
  const { data: liData, error: liError } = await supabase
    .from("io_line_items")
    .insert(itemsWithIoId)
    .select();

  return {
    ...ioData,
    line_items: (liError || !liData ? [] : liData) as IOLineItem[],
  } as InsertionOrder & { line_items: IOLineItem[] };
}

export async function getNextIONumber(): Promise<string> {
  const supabase = await createClient();
  const year = new Date().getFullYear();
  const prefix = `IO-${year}-`;

  const { data } = await supabase
    .from("insertion_orders")
    .select("io_number")
    .like("io_number", `${prefix}%`)
    .order("io_number", { ascending: false })
    .limit(1);

  if (data && data.length > 0) {
    const lastNum = parseInt(data[0].io_number.replace(prefix, ""), 10);
    return `${prefix}${String(lastNum + 1).padStart(4, "0")}`;
  }
  return `${prefix}0001`;
}

// ---- Invoices ----

export async function getInvoiceById(id: string): Promise<(Invoice & { line_items: InvoiceLineItem[] }) | null> {
  const supabase = await createClient();
  const { data: invData, error: invError } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", id)
    .single();
  if (invError || !invData) return null;

  const { data: lineItems, error: liError } = await supabase
    .from("invoice_line_items")
    .select("*")
    .eq("invoice_id", invData.id)
    .order("post_date", { ascending: true });

  return {
    ...invData,
    line_items: (liError || !lineItems ? [] : lineItems) as InvoiceLineItem[],
  } as Invoice & { line_items: InvoiceLineItem[] };
}

export async function createInvoice(
  invoice: Omit<Invoice, "id" | "line_items" | "created_at" | "updated_at">,
  lineItems: Omit<InvoiceLineItem, "id">[]
): Promise<(Invoice & { line_items: InvoiceLineItem[] }) | null> {
  const supabase = await createClient();

  const { data: invData, error: invError } = await supabase
    .from("invoices")
    .insert(invoice)
    .select()
    .single();
  if (invError || !invData) return null;

  const itemsWithInvId = lineItems.map((li) => ({ ...li, invoice_id: invData.id }));
  const { data: liData, error: liError } = await supabase
    .from("invoice_line_items")
    .insert(itemsWithInvId)
    .select();

  return {
    ...invData,
    line_items: (liError || !liData ? [] : liData) as InvoiceLineItem[],
  } as Invoice & { line_items: InvoiceLineItem[] };
}

export async function getNextInvoiceNumber(): Promise<string> {
  const supabase = await createClient();
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;

  const { data } = await supabase
    .from("invoices")
    .select("invoice_number")
    .like("invoice_number", `${prefix}%`)
    .order("invoice_number", { ascending: false })
    .limit(1);

  if (data && data.length > 0) {
    const lastNum = parseInt(data[0].invoice_number.replace(prefix, ""), 10);
    return `${prefix}${String(lastNum + 1).padStart(4, "0")}`;
  }
  return `${prefix}0001`;
}

// ---- Agent Stats ----

export async function getAgentStats(agentId: string): Promise<AgentDashboardStats> {
  const supabase = await createClient();

  // Total shows
  const { count: totalShows } = await supabase
    .from("agent_show_relationships")
    .select("*", { count: "exact", head: true })
    .eq("agent_id", agentId);

  // Active deals
  const { count: activeDeals } = await supabase
    .from("deals")
    .select("*", { count: "exact", head: true })
    .eq("agent_id", agentId)
    .in("status", ["proposed", "negotiating", "approved", "io_sent", "signed", "live"]);

  // Pending invoices (via IO -> deal)
  const { data: agentDeals } = await supabase
    .from("deals")
    .select("id")
    .eq("agent_id", agentId);

  let pendingInvoices = 0;
  let revenueThisMonth = 0;
  let revenueOutstanding = 0;

  if (agentDeals && agentDeals.length > 0) {
    const dealIds = agentDeals.map((d) => d.id);

    // Get IOs for these deals
    const { data: ios } = await supabase
      .from("insertion_orders")
      .select("id")
      .in("deal_id", dealIds);

    if (ios && ios.length > 0) {
      const ioIds = ios.map((io) => io.id);

      // Pending invoices
      const { count: pending } = await supabase
        .from("invoices")
        .select("*", { count: "exact", head: true })
        .in("io_id", ioIds)
        .in("status", ["sent", "overdue"]);
      pendingInvoices = pending ?? 0;

      // Revenue this month
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const { data: paidThisMonth } = await supabase
        .from("invoices")
        .select("total_due")
        .in("io_id", ioIds)
        .eq("status", "paid")
        .gte("paid_at", startOfMonth.toISOString());
      revenueThisMonth = paidThisMonth?.reduce((s, inv) => s + (inv.total_due ?? 0), 0) ?? 0;

      // Revenue outstanding
      const { data: outstanding } = await supabase
        .from("invoices")
        .select("total_due")
        .in("io_id", ioIds)
        .in("status", ["sent", "overdue"]);
      revenueOutstanding = outstanding?.reduce((s, inv) => s + (inv.total_due ?? 0), 0) ?? 0;
    }
  }

  return {
    total_shows: totalShows ?? 0,
    active_deals: activeDeals ?? 0,
    pending_invoices: pendingInvoices,
    revenue_this_month: revenueThisMonth,
    revenue_outstanding: revenueOutstanding,
  };
}
