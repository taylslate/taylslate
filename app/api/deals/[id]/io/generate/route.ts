import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  getDealById,
  getShowById,
  getProfileById,
  getNextIONumber,
  createIO,
  getIOByDealId,
} from "@/lib/data/queries";
import { cadenceDays } from "@/lib/io/cadence-days";
import { maskIoForViewer, revealPublisherContact } from "@/lib/relay/io-contact";
import { isShowsAdmin } from "@/lib/shows/can-edit-show";
import { supabaseAdmin } from "@/lib/supabase/admin";

async function publisherEmailForShow(showId: string): Promise<string> {
  try {
    const { data, error } = await supabaseAdmin
      .from("shows")
      .select("contact_email")
      .eq("id", showId)
      .maybeSingle();
    if (error) {
      console.warn("[io/generate]", error.code ?? "unknown");
      return "";
    }
    return typeof data?.contact_email === "string" ? data.contact_email : "";
  } catch {
    console.warn("[io/generate]", "unknown");
    return "";
  }
}

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

    const deal = await getDealById(dealId);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const userId = user.id;
    if (deal.agent_id !== userId && deal.brand_id !== userId && deal.agency_id !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let admin = false;
    try {
      admin = await isShowsAdmin(userId);
    } catch {
      admin = false;
    }

    const existingIO = await getIOByDealId(dealId);
    if (existingIO) {
      return NextResponse.json(
        { error: "An IO already exists for this deal", ...maskIoForViewer(existingIO, deal, userId, admin) },
        { status: 409 }
      );
    }

    // Deal must be in planning status to generate an IO
    if (deal.status !== "planning") {
      return NextResponse.json(
        { error: `Cannot generate IO for deal in "${deal.status}" status. Must be "planning".` },
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
    const spacingDays = cadenceDays(show.episode_cadence);
    const flightStart = new Date(deal.flight_start);

    const lineItems = [];
    for (let i = 0; i < deal.num_episodes; i++) {
      const postDate = new Date(flightStart);
      // UTC arithmetic: flight_start is a date-only value parsed as UTC midnight
      // and toISOString reads UTC — local getDate/setDate can drift a day.
      postDate.setUTCDate(postDate.getUTCDate() + i * spacingDays);

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
      publisher_contact_email: await publisherEmailForShow(deal.show_id),
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
      payment_off_platform: brand?.is_managed === true,
      competitor_exclusion: deal.competitor_exclusion ?? [],
      exclusivity_days: deal.exclusivity_days ?? 90,
      rofr_days: deal.rofr_days ?? 30,
      cancellation_notice_days: 14,
      download_tracking_days: 45,
      make_good_threshold: 0.10,
      status: "draft" as const,
    };

    // Create IO with line items in Supabase. Stay in planning: a draft is not
    // a sent IO. io_sent is set by the email send and DocuSign send routes.
    const io = await createIO(ioData, lineItems);
    if (!io) {
      return NextResponse.json(
        { error: "Failed to create insertion order" },
        { status: 500 }
      );
    }

    const view = maskIoForViewer(io, deal, userId, admin);
    if (revealPublisherContact(deal, userId, admin)) {
      view.io = { ...view.io, publisher_contact_email: ioData.publisher_contact_email };
    }
    return NextResponse.json(view, { status: 201 });
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err && typeof err.code === "string"
        ? err.code
        : "unknown";
    console.warn("[io/generate]", code);
    return NextResponse.json({ error: "Failed to generate IO" }, { status: 500 });
  }
}
