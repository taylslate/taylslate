// ============================================================
// TAYLSLATE SUPABASE QUERIES
// Replaces seed data imports with real database queries.
// ============================================================

import { createClient } from "@/lib/supabase/server";
import type {
  Profile,
  Show,
  ShowContact,
  Platform,
  Deal,
  InsertionOrder,
  IOLineItem,
  Invoice,
  InvoiceLineItem,
  InvoiceStatus,
  AgentDashboardStats,
  AgentShowRelationship,
  Campaign,
  CampaignStatus,
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

export async function addDeals(deals: Record<string, unknown>[]): Promise<Deal[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deals")
    .insert(deals)
    .select();
  if (error || !data) {
    console.error("[addDeals] Error:", error?.message);
    return [];
  }
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

// ---- Deals (filtered queries) ----

export async function getDealsFiltered(
  userId: string,
  filters: { status?: string; show_id?: string; brand_id?: string }
): Promise<(Deal & { show_name?: string })[]> {
  const supabase = await createClient();
  let query = supabase
    .from("deals")
    .select("*, shows!inner(name)")
    .or(`agent_id.eq.${userId},brand_id.eq.${userId},agency_id.eq.${userId}`)
    .order("updated_at", { ascending: false });

  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.show_id) {
    query = query.eq("show_id", filters.show_id);
  }
  if (filters.brand_id) {
    query = query.eq("brand_id", filters.brand_id);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map((row: Record<string, unknown>) => {
    const { shows, ...deal } = row as Record<string, unknown> & { shows: { name: string } };
    return { ...deal, show_name: shows?.name } as Deal & { show_name?: string };
  });
}

export async function getDealWithRelations(
  id: string
): Promise<(Deal & { show_name?: string; insertion_order?: InsertionOrder & { line_items: IOLineItem[] } }) | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deals")
    .select("*, shows!inner(name)")
    .eq("id", id)
    .single();
  if (error || !data) return null;

  const { shows, ...deal } = data as Record<string, unknown> & { shows: { name: string } };
  const result: Deal & { show_name?: string; insertion_order?: InsertionOrder & { line_items: IOLineItem[] } } = {
    ...deal,
    show_name: shows?.name,
  } as Deal & { show_name?: string };

  // Fetch associated IO if one exists
  const io = await getIOByDealId(id);
  if (io) {
    result.insertion_order = io;
  }

  return result;
}

export async function softDeleteDeal(id: string): Promise<Deal | null> {
  return updateDeal(id, { status: "cancelled" } as Partial<Deal>);
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

// ---- Invoice Engine Queries ----

/** Create an invoice from an IO, persisting both invoice and line items in Supabase */
export async function createInvoiceFromIO(
  ioId: string,
  lineItemIds?: string[]
): Promise<(Invoice & { line_items: InvoiceLineItem[] }) | null> {
  const io = await getIOById(ioId);
  if (!io) return null;

  const deal = await getDealById(io.deal_id);
  const agent = deal?.agent_id ? await getProfileById(deal.agent_id) : undefined;

  // Filter to delivered line items
  let eligibleItems = io.line_items.filter(
    (li) => li.actual_post_date || li.verified
  );

  if (lineItemIds && lineItemIds.length > 0) {
    eligibleItems = eligibleItems.filter((li) => lineItemIds.includes(li.id));
  }

  if (eligibleItems.length === 0) return null;

  // Build invoice line items with make-good calculation
  const invoiceLineItems: Omit<InvoiceLineItem, "id">[] = eligibleItems.map((li) => {
    const actualDls = li.actual_downloads ?? li.guaranteed_downloads;
    const underdeliveryPct =
      li.guaranteed_downloads > 0
        ? (li.guaranteed_downloads - actualDls) / li.guaranteed_downloads
        : 0;
    const makeGood = underdeliveryPct > (io.make_good_threshold ?? 0.1);

    // Calculate rate based on price type
    let rate = li.net_due;
    if (li.price_type === "cpm" && li.actual_downloads != null) {
      // CPM: pay for actual downloads delivered
      rate = (li.actual_downloads / 1000) * ((li.net_due / li.guaranteed_downloads) * 1000);
      rate = Math.round(rate * 100) / 100;
    }

    const postDateStr = new Date(li.actual_post_date ?? li.post_date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    return {
      io_line_item_id: li.id,
      show_name: li.show_name,
      post_date: li.actual_post_date ?? li.post_date,
      description: `${li.placement.charAt(0).toUpperCase() + li.placement.slice(1)} ad – ${li.show_name} – ${postDateStr}`,
      guaranteed_downloads: li.guaranteed_downloads,
      actual_downloads: li.actual_downloads,
      rate,
      make_good: makeGood,
    };
  });

  const subtotal = invoiceLineItems.reduce((s, li) => s + li.rate, 0);
  const adjustments = invoiceLineItems
    .filter((li) => li.make_good)
    .reduce((s, li) => s - li.rate, 0);
  const totalDue = Math.max(0, subtotal + adjustments);

  // Determine billing parties
  const billToName = io.agency_name ?? io.advertiser_name;
  const billToEmail = io.send_invoices_to ?? io.agency_contact_email ?? io.advertiser_contact_email ?? "";

  // Campaign period
  let campaignPeriod = "—";
  if (io.line_items.length > 0) {
    const dates = io.line_items.map((li) => new Date(li.post_date)).sort((a, b) => a.getTime() - b.getTime());
    const firstMonth = dates[0].toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const lastMonth = dates[dates.length - 1].toLocaleDateString("en-US", { month: "long", year: "numeric" });
    campaignPeriod = firstMonth === lastMonth ? firstMonth : `${firstMonth} – ${lastMonth}`;
  }

  // Due date: Net 30 EOM
  let dueDate: string;
  const now = new Date();
  if (io.payment_terms?.toLowerCase().includes("eom")) {
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    dueDate = nextMonth.toISOString().split("T")[0];
  } else {
    const due = new Date(now);
    due.setDate(due.getDate() + 30);
    dueDate = due.toISOString().split("T")[0];
  }

  const invoiceNumber = await getNextInvoiceNumber();

  const invoiceData: Omit<Invoice, "id" | "line_items" | "created_at" | "updated_at"> = {
    invoice_number: invoiceNumber,
    io_id: io.id,
    io_number: io.io_number,
    bill_to_name: billToName,
    bill_to_email: billToEmail,
    from_name: agent?.company_name ?? io.publisher_name,
    from_email: agent?.email ?? io.publisher_contact_email,
    from_address: io.publisher_address,
    advertiser_name: io.advertiser_name,
    campaign_period: campaignPeriod,
    subtotal: Math.round(subtotal * 100) / 100,
    adjustments: Math.round(adjustments * 100) / 100,
    total_due: Math.round(totalDue * 100) / 100,
    status: "draft" as InvoiceStatus,
    due_date: dueDate,
  };

  return createInvoice(invoiceData, invoiceLineItems);
}

/** List invoices for a user (via IO -> deal relationship). Supports status and io_id filters. */
export async function getInvoicesForUser(
  userId: string,
  filters?: { status?: InvoiceStatus; io_id?: string }
): Promise<{
  invoices: (Invoice & { line_items: InvoiceLineItem[] })[];
  stats: {
    total_outstanding: number;
    total_paid_this_month: number;
    count_by_status: Record<string, number>;
  };
}> {
  const supabase = await createClient();

  // Get all deal IDs for this user
  const { data: userDeals } = await supabase
    .from("deals")
    .select("id")
    .or(`agent_id.eq.${userId},brand_id.eq.${userId},agency_id.eq.${userId}`);

  if (!userDeals || userDeals.length === 0) {
    return {
      invoices: [],
      stats: { total_outstanding: 0, total_paid_this_month: 0, count_by_status: {} },
    };
  }

  const dealIds = userDeals.map((d) => d.id);

  // Get IO IDs for those deals
  const { data: ios } = await supabase
    .from("insertion_orders")
    .select("id")
    .in("deal_id", dealIds);

  if (!ios || ios.length === 0) {
    return {
      invoices: [],
      stats: { total_outstanding: 0, total_paid_this_month: 0, count_by_status: {} },
    };
  }

  const ioIds = ios.map((io) => io.id);

  // Query invoices
  let query = supabase
    .from("invoices")
    .select("*")
    .in("io_id", ioIds)
    .order("created_at", { ascending: false });

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }
  if (filters?.io_id) {
    query = query.eq("io_id", filters.io_id);
  }

  const { data: invoices, error } = await query;
  if (error || !invoices) {
    return {
      invoices: [],
      stats: { total_outstanding: 0, total_paid_this_month: 0, count_by_status: {} },
    };
  }

  // Fetch line items for each invoice
  const invoiceIds = invoices.map((inv) => inv.id);
  const { data: allLineItems } = await supabase
    .from("invoice_line_items")
    .select("*")
    .in("invoice_id", invoiceIds)
    .order("post_date", { ascending: true });

  const lineItemsByInvoice = new Map<string, InvoiceLineItem[]>();
  for (const li of (allLineItems ?? []) as (InvoiceLineItem & { invoice_id: string })[]) {
    const existing = lineItemsByInvoice.get(li.invoice_id) ?? [];
    existing.push(li);
    lineItemsByInvoice.set(li.invoice_id, existing);
  }

  const result = invoices.map((inv) => ({
    ...inv,
    line_items: lineItemsByInvoice.get(inv.id) ?? [],
  })) as (Invoice & { line_items: InvoiceLineItem[] })[];

  // Compute stats (across ALL user invoices, not just filtered)
  const { data: allInvoices } = await supabase
    .from("invoices")
    .select("status, total_due, paid_at")
    .in("io_id", ioIds);

  let totalOutstanding = 0;
  let totalPaidThisMonth = 0;
  const countByStatus: Record<string, number> = {};
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  for (const inv of allInvoices ?? []) {
    countByStatus[inv.status] = (countByStatus[inv.status] ?? 0) + 1;
    if (inv.status === "sent" || inv.status === "overdue") {
      totalOutstanding += inv.total_due ?? 0;
    }
    if (inv.status === "paid" && inv.paid_at && new Date(inv.paid_at) >= startOfMonth) {
      totalPaidThisMonth += inv.total_due ?? 0;
    }
  }

  return {
    invoices: result,
    stats: { total_outstanding: totalOutstanding, total_paid_this_month: totalPaidThisMonth, count_by_status: countByStatus },
  };
}

/** Valid invoice status transitions */
const INVOICE_STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ["sent"],
  sent: ["paid", "overdue", "disputed"],
  overdue: ["paid", "disputed"],
  disputed: ["sent", "cancelled"],
};

/** Update invoice status with transition validation */
export async function updateInvoiceStatus(
  id: string,
  newStatus: InvoiceStatus,
  extra?: { payment_method?: string }
): Promise<(Invoice & { line_items: InvoiceLineItem[] }) | null> {
  const supabase = await createClient();

  // Get current invoice
  const { data: current, error: fetchError } = await supabase
    .from("invoices")
    .select("status")
    .eq("id", id)
    .single();

  if (fetchError || !current) return null;

  const allowed = INVOICE_STATUS_TRANSITIONS[current.status];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(`Cannot transition invoice from "${current.status}" to "${newStatus}"`);
  }

  const updates: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  };

  if (newStatus === "sent") {
    updates.sent_at = new Date().toISOString();
  }
  if (newStatus === "paid") {
    updates.paid_at = new Date().toISOString();
    if (extra?.payment_method) {
      updates.payment_method = extra.payment_method;
    }
  }

  const { error: updateError } = await supabase
    .from("invoices")
    .update(updates)
    .eq("id", id);

  if (updateError) return null;

  return getInvoiceById(id);
}

/** Check IO line items for make-good triggers (>10% underdelivery) */
export async function checkMakeGoods(
  ioId: string
): Promise<{ id: string; show_name: string; guaranteed: number; actual: number; pctBelow: number; reason: string }[]> {
  const supabase = await createClient();

  const { data: lineItems, error } = await supabase
    .from("io_line_items")
    .select("*")
    .eq("io_id", ioId);

  if (error || !lineItems) return [];

  // Get IO threshold
  const { data: io } = await supabase
    .from("insertion_orders")
    .select("make_good_threshold")
    .eq("id", ioId)
    .single();

  const threshold = io?.make_good_threshold ?? 0.1;
  const triggered: { id: string; show_name: string; guaranteed: number; actual: number; pctBelow: number; reason: string }[] = [];

  for (const li of lineItems) {
    if (li.actual_downloads == null || li.guaranteed_downloads <= 0) continue;

    const pctBelow = (li.guaranteed_downloads - li.actual_downloads) / li.guaranteed_downloads;

    if (pctBelow > threshold) {
      const pctBelowRounded = Math.round(pctBelow * 100);
      const reason = `Underdelivery: ${li.actual_downloads} vs ${li.guaranteed_downloads} (${pctBelowRounded}% below)`;

      // Update the line item in the database
      await supabase
        .from("io_line_items")
        .update({
          make_good_triggered: true,
          make_good_reason: reason,
        })
        .eq("id", li.id);

      triggered.push({
        id: li.id,
        show_name: li.show_name,
        guaranteed: li.guaranteed_downloads,
        actual: li.actual_downloads,
        pctBelow: pctBelowRounded,
        reason,
      });
    }
  }

  return triggered;
}

// ---- Show Management Queries ----

/** Generate a URL-safe slug from a show name */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Flatten nested Show contact into DB columns */
function flattenShowForDB(show: Record<string, unknown>): Record<string, unknown> {
  const result = { ...show };
  if (result.contact && typeof result.contact === "object") {
    const contact = result.contact as Record<string, unknown>;
    result.contact_name = contact.name ?? "";
    result.contact_email = contact.email ?? "";
    result.contact_method = contact.method ?? "email";
    delete result.contact;
  }
  return result;
}

export async function createShow(
  showData: Partial<Show> & { name: string; platform: Platform }
): Promise<Show | null> {
  const supabase = await createClient();
  const slug = generateSlug(showData.name);

  const dbRow = flattenShowForDB({
    ...showData,
    slug,
    is_claimed: showData.is_claimed ?? false,
    is_verified: showData.is_verified ?? false,
  });

  const { data, error } = await supabase
    .from("shows")
    .insert(dbRow)
    .select()
    .single();
  if (error || !data) return null;
  return transformShow(data);
}

export async function updateShow(
  id: string,
  updates: Partial<Show>
): Promise<Show | null> {
  const supabase = await createClient();

  const dbUpdates = flattenShowForDB({
    ...updates,
    updated_at: new Date().toISOString(),
  });

  // Don't allow updating id
  delete dbUpdates.id;

  const { data, error } = await supabase
    .from("shows")
    .update(dbUpdates)
    .eq("id", id)
    .select()
    .single();
  if (error || !data) return null;
  return transformShow(data);
}

export async function getShowsFiltered(filters: {
  search?: string;
  platform?: string;
  category?: string;
  min_audience?: number;
  max_audience?: number;
  agent_id?: string;
}): Promise<Show[]> {
  const supabase = await createClient();

  let showIds: string[] | null = null;

  // If agent_id provided, scope to their shows
  if (filters.agent_id) {
    const { data: rels } = await supabase
      .from("agent_show_relationships")
      .select("show_id")
      .eq("agent_id", filters.agent_id);
    if (!rels || rels.length === 0) return [];
    showIds = rels.map((r) => r.show_id);
  }

  let query = supabase
    .from("shows")
    .select("*")
    .order("audience_size", { ascending: false });

  if (showIds) {
    query = query.in("id", showIds);
  }
  if (filters.search) {
    query = query.ilike("name", `%${filters.search}%`);
  }
  if (filters.platform) {
    query = query.eq("platform", filters.platform);
  }
  if (filters.category) {
    query = query.contains("categories", [filters.category]);
  }
  if (filters.min_audience != null) {
    query = query.gte("audience_size", filters.min_audience);
  }
  if (filters.max_audience != null) {
    query = query.lte("audience_size", filters.max_audience);
  }

  const { data, error } = await query;
  if (error || !data) return [];
  return data.map(transformShow);
}

export async function getAgentShowRelationship(
  agentId: string,
  showId: string
): Promise<AgentShowRelationship | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agent_show_relationships")
    .select("*")
    .eq("agent_id", agentId)
    .eq("show_id", showId)
    .maybeSingle();
  if (error || !data) return null;
  return data as AgentShowRelationship;
}

export async function claimShow(
  agentId: string,
  showId: string,
  commissionRate?: number
): Promise<AgentShowRelationship | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agent_show_relationships")
    .insert({
      agent_id: agentId,
      show_id: showId,
      commission_rate: commissionRate ?? null,
      is_exclusive: false,
    })
    .select()
    .single();
  if (error || !data) return null;
  return data as AgentShowRelationship;
}

export async function importShows(
  shows: (Partial<Show> & { name: string; platform: Platform })[],
  agentId: string
): Promise<{ imported: Show[]; skipped: string[]; errors: string[] }> {
  const supabase = await createClient();
  const imported: Show[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  // Get existing shows for this agent to check duplicates
  const { data: existingRels } = await supabase
    .from("agent_show_relationships")
    .select("show_id, shows!inner(name)")
    .eq("agent_id", agentId);

  const existingNames = new Set(
    (existingRels ?? []).map((r: Record<string, unknown>) => {
      const shows = r.shows as { name: string } | null;
      return shows?.name?.toLowerCase() ?? "";
    })
  );

  for (const showData of shows) {
    if (existingNames.has(showData.name.toLowerCase())) {
      skipped.push(showData.name);
      continue;
    }

    const slug = generateSlug(showData.name);
    const dbRow = flattenShowForDB({
      ...showData,
      slug,
      is_claimed: true,
      is_verified: false,
    });

    const { data: newShow, error: showError } = await supabase
      .from("shows")
      .insert(dbRow)
      .select()
      .single();

    if (showError || !newShow) {
      errors.push(`${showData.name}: ${showError?.message ?? "Unknown error"}`);
      continue;
    }

    // Create agent relationship
    const { error: relError } = await supabase
      .from("agent_show_relationships")
      .insert({
        agent_id: agentId,
        show_id: newShow.id,
        is_exclusive: false,
      });

    if (relError) {
      errors.push(`${showData.name}: relationship error: ${relError.message}`);
    }

    existingNames.add(showData.name.toLowerCase());
    imported.push(transformShow(newShow));
  }

  return { imported, skipped, errors };
}

// ---- Enrichment Queries ----

/**
 * Partial update for enrichment that respects "don't overwrite agent data" rule.
 * Only updates fields that are currently null/empty/default.
 * NEVER overwrites: rate_card, audience_size (if > 0), cpm rates.
 */
export async function updateShowEnrichment(
  id: string,
  enrichmentData: Record<string, unknown>
): Promise<Show | null> {
  const supabase = await createClient();

  // Load current show to check which fields already have data
  const { data: current, error: fetchError } = await supabase
    .from("shows")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !current) return null;

  const updates: Record<string, unknown> = {};

  // Protected fields — never overwrite if already set
  const protectedIfSet = ["audience_size", "rate_card"];
  // Fields that merge (arrays)
  const mergeArrayFields = ["categories", "tags", "current_sponsors", "past_sponsors", "audience_interests", "data_sources"];

  for (const [key, value] of Object.entries(enrichmentData)) {
    if (value === undefined || value === null) continue;

    // Protected: skip if current value is truthy
    if (protectedIfSet.includes(key)) {
      const currentVal = current[key];
      if (key === "audience_size" && currentVal && currentVal > 0) continue;
      if (key === "rate_card" && currentVal && Object.keys(currentVal).length > 0) continue;
    }

    // Array fields: merge, don't replace
    if (mergeArrayFields.includes(key) && Array.isArray(value)) {
      const existing = (current[key] as string[] | null) ?? [];
      const existingLower = new Set(existing.map((s: string) => (typeof s === "string" ? s.toLowerCase() : s)));
      const newItems = (value as string[]).filter(
        (item) => !existingLower.has(typeof item === "string" ? item.toLowerCase() : item)
      );
      if (newItems.length > 0) {
        updates[key] = [...existing, ...newItems];
      }
      continue;
    }

    // Simple fields: only update if current is empty/null/default
    const currentVal = current[key];
    const isEmpty =
      currentVal === null ||
      currentVal === undefined ||
      currentVal === "" ||
      currentVal === 0 ||
      currentVal === "Unknown";

    if (isEmpty) {
      updates[key] = value;
    }
  }

  // Always update these metadata fields
  if (enrichmentData.data_sources) {
    const existing = (current.data_sources as string[] | null) ?? [];
    const newSources = (enrichmentData.data_sources as string[]).filter(
      (s) => !existing.includes(s)
    );
    if (newSources.length > 0) {
      updates.data_sources = [...existing, ...newSources];
    }
  }
  updates.last_api_refresh = new Date().toISOString();
  updates.updated_at = new Date().toISOString();

  if (Object.keys(updates).length <= 2) {
    // Only metadata fields, no actual enrichment
    return transformShow(current);
  }

  const { data, error } = await supabase
    .from("shows")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) return null;
  return transformShow(data);
}

/**
 * Get shows that need enrichment: last_api_refresh is null or older than 7 days.
 * Scoped to an agent's shows.
 */
export async function getShowsNeedingEnrichment(agentId: string): Promise<Show[]> {
  const supabase = await createClient();

  // Get agent's show IDs
  const { data: rels, error: relError } = await supabase
    .from("agent_show_relationships")
    .select("show_id")
    .eq("agent_id", agentId);

  if (relError || !rels || rels.length === 0) return [];

  const showIds = rels.map((r) => r.show_id);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data, error } = await supabase
    .from("shows")
    .select("*")
    .in("id", showIds)
    .or(`last_api_refresh.is.null,last_api_refresh.lt.${sevenDaysAgo.toISOString()}`)
    .order("name", { ascending: true });

  if (error || !data) return [];
  return data.map(transformShow);
}

// ---- Campaign Queries ----

export async function createCampaign(campaign: {
  user_id: string;
  name: string;
  brief: Record<string, unknown>;
  budget_total: number;
  platforms: string[];
  status?: CampaignStatus;
  recommendations: unknown[];
  youtube_recommendations?: unknown[];
  expansion_opportunities?: unknown[];
}): Promise<Campaign | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      user_id: campaign.user_id,
      name: campaign.name,
      brief: campaign.brief,
      budget_total: campaign.budget_total,
      platforms: campaign.platforms,
      status: campaign.status ?? "planned",
      recommendations: campaign.recommendations,
      youtube_recommendations: campaign.youtube_recommendations ?? [],
      expansion_opportunities: campaign.expansion_opportunities ?? [],
    })
    .select()
    .single();
  if (error || !data) {
    console.error("[createCampaign] Error:", error?.message);
    return null;
  }
  return data as Campaign;
}

export async function getCampaignsForUser(userId: string): Promise<Campaign[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as Campaign[];
}

export async function getCampaignById(id: string): Promise<Campaign | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data as Campaign;
}
