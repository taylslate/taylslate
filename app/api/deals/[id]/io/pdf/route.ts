import { NextRequest, NextResponse } from "next/server";
import { deals, getShowById, getIOByDeal, profiles } from "@/lib/data";
import { generateIOPdf } from "@/lib/pdf/io-pdf";
import type { InsertionOrder, IOLineItem } from "@/lib/data";

// POST: Generate PDF from provided IO data (for edited IOs)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const io = body.io as InsertionOrder;
    if (!io || !io.io_number || !io.line_items) {
      return NextResponse.json({ error: "Invalid IO data" }, { status: 400 });
    }

    const pdfBuffer = generateIOPdf(io);
    const filename = `${io.io_number.replace(/\s+/g, "_")}.pdf`;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const deal = deals.find((d) => d.id === id);
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const show = getShowById(deal.show_id);
  if (!show) {
    return NextResponse.json({ error: "Show not found" }, { status: 404 });
  }

  const existingIO = getIOByDeal(deal.id);
  const brand = profiles.find((p) => p.id === deal.brand_id);
  const agency = deal.agency_id ? profiles.find((p) => p.id === deal.agency_id) : undefined;
  const agent = deal.agent_id ? profiles.find((p) => p.id === deal.agent_id) : undefined;

  // Use existing IO or build one from deal data
  let io: InsertionOrder;

  if (existingIO) {
    io = existingIO;
  } else {
    // Generate IO from deal (same logic as IOGeneratorForm)
    const startDate = new Date(deal.flight_start);
    const cadenceDays: Record<string, number> = {
      daily: 7,
      weekly: 7,
      biweekly: 14,
      monthly: 28,
    };
    const spacing = cadenceDays[show.episode_cadence] ?? 7;

    const lineItems: IOLineItem[] = [];
    for (let i = 0; i < deal.num_episodes; i++) {
      const postDate = new Date(startDate);
      postDate.setDate(postDate.getDate() + i * spacing);
      lineItems.push({
        id: `line-gen-${i + 1}`,
        format: show.platform,
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

    const totalDownloads = lineItems.reduce((s, li) => s + li.guaranteed_downloads, 0);
    const totalGross = lineItems.reduce((s, li) => s + li.gross_rate, 0);
    const totalNet = lineItems.reduce((s, li) => s + li.net_due, 0);

    const year = new Date().getFullYear();
    const ioNumber = `IO-${year}-${String(Math.floor(Math.random() * 9000) + 1000).padStart(4, "0")}`;

    io = {
      id: `io-gen-${deal.id}`,
      io_number: ioNumber,
      deal_id: deal.id,
      advertiser_name: brand?.company_name ?? "Unknown",
      advertiser_contact_name: brand?.full_name,
      advertiser_contact_email: brand?.email,
      publisher_name: agent?.company_name ?? "Unknown",
      publisher_contact_name: agent?.full_name ?? "Unknown",
      publisher_contact_email: agent?.email ?? "",
      agency_name: agency?.company_name,
      agency_contact_name: agency?.full_name,
      agency_contact_email: agency?.email,
      line_items: lineItems,
      total_downloads: totalDownloads,
      total_gross: totalGross,
      total_net: totalNet,
      payment_terms: "Net 30 EOM",
      competitor_exclusion: deal.competitor_exclusion,
      exclusivity_days: deal.exclusivity_days,
      rofr_days: deal.rofr_days,
      cancellation_notice_days: 14,
      download_tracking_days: 45,
      make_good_threshold: 0.10,
      status: "draft",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  const pdfBuffer = generateIOPdf(io);
  const filename = `${io.io_number.replace(/\s+/g, "_")}.pdf`;

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
