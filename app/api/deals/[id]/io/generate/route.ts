import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  getDealById,
  getShowById,
  getProfileById,
  getNextIONumber,
  createIO,
  updateDeal,
  getIOByDealId,
} from "@/lib/data/queries";

// Map episode cadence to days between episodes
const CADENCE_DAYS: Record<string, number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
};

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: dealId } = await params;

    // Check if IO already exists for this deal
    const existingIO = await getIOByDealId(dealId);
    if (existingIO) {
      return NextResponse.json(
        { error: "An IO already exists for this deal", io: existingIO },
        { status: 409 }
      );
    }

    // Get the deal
    const deal = await getDealById(dealId);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    // Verify user has access to this deal
    const userId = user.id;
    if (deal.agent_id !== userId && deal.brand_id !== userId && deal.agency_id !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Deal must be in approved status (or negotiating for flexibility)
    if (!["approved", "negotiating"].includes(deal.status)) {
      return NextResponse.json(
        { error: `Cannot generate IO for deal in "${deal.status}" status. Must be "approved" or "negotiating".` },
        { status: 400 }
      );
    }

    // Get show and party details
    const show = await getShowById(deal.show_id);
    if (!show) {
      return NextResponse.json({ error: "Show not found" }, { status: 404 });
    }

    const brand = await getProfileById(deal.brand_id);
    const agent = deal.agent_id ? await getProfileById(deal.agent_id) : null;
    const agency = deal.agency_id ? await getProfileById(deal.agency_id) : null;

    // Generate IO number
    const ioNumber = await getNextIONumber();

    // Generate line items — one per episode, spaced by show's episode_cadence
    const cadenceDays = CADENCE_DAYS[show.episode_cadence || "weekly"] || 7;
    const flightStart = new Date(deal.flight_start);

    const lineItems = [];
    for (let i = 0; i < deal.num_episodes; i++) {
      const postDate = new Date(flightStart);
      postDate.setDate(postDate.getDate() + i * cadenceDays);

      lineItems.push({
        format: show.platform as "podcast" | "youtube",
        post_date: postDate.toISOString().split("T")[0],
        guaranteed_downloads: deal.guaranteed_downloads,
        show_name: show.name,
        placement: deal.placement,
        is_scripted: deal.is_scripted,
        is_personal_experience: deal.is_personal_experience,
        reader_type: deal.reader_type,
        content_type: deal.content_type,
        pixel_required: deal.pixel_required,
        gross_rate: deal.gross_per_episode ?? deal.net_per_episode,
        gross_cpm: deal.gross_cpm ?? deal.cpm_rate,
        price_type: deal.price_type,
        net_due: deal.net_per_episode,
        verified: false,
        make_good_triggered: false,
      });
    }

    // Calculate totals
    const totalDownloads = deal.guaranteed_downloads * deal.num_episodes;
    const totalGross = lineItems.reduce((s, li) => s + li.gross_rate, 0);
    const totalNet = lineItems.reduce((s, li) => s + li.net_due, 0);

    // Build IO record
    const ioData = {
      io_number: ioNumber,
      deal_id: dealId,
      advertiser_name: brand?.company_name ?? brand?.full_name ?? "Unknown Brand",
      advertiser_contact_name: brand?.full_name ?? "",
      advertiser_contact_email: brand?.email ?? "",
      publisher_name: show.name,
      publisher_contact_name: show.contact?.name ?? "",
      publisher_contact_email: show.contact?.email ?? "",
      publisher_address: undefined,
      agency_name: agency?.company_name ?? undefined,
      agency_contact_name: agency?.full_name ?? undefined,
      agency_contact_email: agency?.email ?? undefined,
      agency_billing_contact: agency?.email ?? undefined,
      agency_address: undefined,
      send_invoices_to: agency?.email ?? brand?.email ?? undefined,
      total_downloads: totalDownloads,
      total_gross: Math.round(totalGross * 100) / 100,
      total_net: Math.round(totalNet * 100) / 100,
      // Standard terms from domain knowledge
      payment_terms: "Net 30 EOM",
      competitor_exclusion: deal.competitor_exclusion ?? [],
      exclusivity_days: deal.exclusivity_days ?? 90,
      rofr_days: deal.rofr_days ?? 30,
      cancellation_notice_days: 14,
      download_tracking_days: 45,
      make_good_threshold: 0.10,
      status: "draft" as const,
    };

    // Create IO with line items in Supabase
    const io = await createIO(ioData, lineItems);
    if (!io) {
      return NextResponse.json(
        { error: "Failed to create insertion order" },
        { status: 500 }
      );
    }

    // Update deal status to io_sent
    await updateDeal(dealId, { status: "io_sent" });

    return NextResponse.json({ io }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to generate IO: ${message}` },
      { status: 500 }
    );
  }
}
