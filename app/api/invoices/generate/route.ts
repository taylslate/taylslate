import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getIOById, getDealById, getProfileById, getNextInvoiceNumber } from "@/lib/data/queries";
import type { Invoice, InvoiceLineItem, InsertionOrder } from "@/lib/data";

function getDueDate(paymentTerms: string): string {
  // Net 30 EOM = end of next month from invoice date
  const now = new Date();
  if (paymentTerms.toLowerCase().includes("eom")) {
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    return nextMonth.toISOString().split("T")[0];
  }
  // Default Net 30
  const due = new Date(now);
  due.setDate(due.getDate() + 30);
  return due.toISOString().split("T")[0];
}

function getCampaignPeriod(io: InsertionOrder): string {
  if (io.line_items.length === 0) return "—";
  const dates = io.line_items
    .map((li) => new Date(li.post_date))
    .sort((a, b) => a.getTime() - b.getTime());
  const first = dates[0];
  const last = dates[dates.length - 1];
  const firstMonth = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const lastMonth = last.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return firstMonth === lastMonth ? firstMonth : `${firstMonth} – ${lastMonth}`;
}

export async function POST(request: NextRequest) {
  let body: { io_id: string; line_item_ids?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { io_id, line_item_ids } = body;

  if (!io_id) {
    return NextResponse.json({ error: "io_id is required" }, { status: 400 });
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const io = await getIOById(io_id);
    if (!io) {
      return NextResponse.json({ error: "IO not found" }, { status: 404 });
    }

    const deal = await getDealById(io.deal_id);
    const agent = deal?.agent_id ? await getProfileById(deal.agent_id) : undefined;

    // Filter to delivered line items (have actual_post_date or verified)
    let eligibleItems = io.line_items.filter(
      (li) => li.actual_post_date || li.verified
    );

    // If specific line item IDs provided, filter further
    if (line_item_ids && line_item_ids.length > 0) {
      eligibleItems = eligibleItems.filter((li) => line_item_ids.includes(li.id));
    }

    if (eligibleItems.length === 0) {
      return NextResponse.json(
        { error: "No delivered line items found. Episodes must have actual post dates to invoice." },
        { status: 400 }
      );
    }

    // Build invoice line items with make-good calculation
    const invoiceLineItems: InvoiceLineItem[] = eligibleItems.map((li, i) => {
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
        rate = (li.actual_downloads / 1000) * (li.net_due / li.guaranteed_downloads * 1000);
        rate = Math.round(rate * 100) / 100;
      }
      // Flat rate: rate stays as net_due regardless of downloads

      const postDateStr = new Date(li.actual_post_date ?? li.post_date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

      return {
        id: `inv-li-gen-${i + 1}`,
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
    // Make-good items: no charge (the make-good episode is free)
    const adjustments = invoiceLineItems
      .filter((li) => li.make_good)
      .reduce((s, li) => s - li.rate, 0);
    const totalDue = Math.max(0, subtotal + adjustments);

    // Determine who to bill: agency if present, otherwise advertiser
    const billToName = io.agency_name ?? io.advertiser_name;
    const billToEmail = io.send_invoices_to ?? io.agency_contact_email ?? io.advertiser_contact_email ?? "";

    const invoiceNumber = await getNextInvoiceNumber();

    const invoice: Invoice = {
      id: `inv-gen-${Date.now()}`,
      invoice_number: invoiceNumber,
      io_id: io.id,
      io_number: io.io_number,
      bill_to_name: billToName,
      bill_to_email: billToEmail,
      from_name: agent?.company_name ?? io.publisher_name,
      from_email: agent?.email ?? io.publisher_contact_email,
      from_address: io.publisher_address,
      advertiser_name: io.advertiser_name,
      campaign_period: getCampaignPeriod(io),
      line_items: invoiceLineItems,
      subtotal: Math.round(subtotal * 100) / 100,
      adjustments: Math.round(adjustments * 100) / 100,
      total_due: Math.round(totalDue * 100) / 100,
      status: "draft",
      due_date: getDueDate(io.payment_terms),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return NextResponse.json({ invoice });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Failed to generate invoice: ${message}` }, { status: 500 });
  }
}
