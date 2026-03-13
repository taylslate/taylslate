import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getAuthenticatedUser, getDealById, getShowById, getIOByDealId, getProfileById, getNextIONumber } from "@/lib/data/queries";
import { generateIOPdf } from "@/lib/pdf/io-pdf";
import type { InsertionOrder, IOLineItem, Show, Deal, Profile } from "@/lib/data";

function buildIOFromDeal(
  deal: Deal,
  show: Show,
  brand: Profile | null | undefined,
  agency: Profile | null | undefined,
  agent: Profile | null | undefined,
  ioNumber: string
) {
  const startDate = new Date(deal.flight_start);
  const cadenceDays: Record<string, number> = { daily: 7, weekly: 7, biweekly: 14, monthly: 28 };
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

  const io: InsertionOrder = {
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
    total_downloads: lineItems.reduce((s, li) => s + li.guaranteed_downloads, 0),
    total_gross: lineItems.reduce((s, li) => s + li.gross_rate, 0),
    total_net: lineItems.reduce((s, li) => s + li.net_due, 0),
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

  return { io, brand, agency, agent };
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildEmailHtml(io: InsertionOrder, senderName: string): string {
  const lineItemRows = io.line_items
    .map(
      (li, i) => `
      <tr style="border-bottom: 1px solid #e2e5ea;">
        <td style="padding: 8px 12px; font-size: 13px; color: #1a1f27;">${i + 1}</td>
        <td style="padding: 8px 12px; font-size: 13px; color: #1a1f27;">${li.show_name}</td>
        <td style="padding: 8px 12px; font-size: 13px; color: #1a1f27;">${new Date(li.post_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
        <td style="padding: 8px 12px; font-size: 13px; color: #1a1f27;">${li.placement}</td>
        <td style="padding: 8px 12px; font-size: 13px; color: #1a1f27; text-align: right;">${li.guaranteed_downloads.toLocaleString()}</td>
        <td style="padding: 8px 12px; font-size: 13px; color: #1a1f27; text-align: right;">$${fmt(li.net_due)}</td>
      </tr>`
    )
    .join("");

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; color: #1a1f27;">
      <div style="background: #0f1b2d; padding: 24px 32px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 20px; color: #ffffff; font-weight: 600;">Insertion Order</h1>
        <p style="margin: 6px 0 0; font-size: 13px; color: #b4beda;">${io.io_number}</p>
      </div>
      <div style="background: #ffffff; padding: 24px 32px; border: 1px solid #e2e5ea; border-top: none;">
        <p style="font-size: 14px; color: #5a6370; line-height: 1.6; margin-top: 0;">
          Hi${io.agency_name ? ` ${io.agency_contact_name ?? ""}` : ` ${io.advertiser_contact_name ?? ""}`},
        </p>
        <p style="font-size: 14px; color: #5a6370; line-height: 1.6;">
          Please find the attached insertion order for <strong style="color: #1a1f27;">${io.line_items[0]?.show_name ?? "your campaign"}</strong> on behalf of <strong style="color: #1a1f27;">${io.advertiser_name}</strong>.
        </p>

        <div style="margin: 20px 0; padding: 16px; background: #f7f8fa; border-radius: 8px; border: 1px solid #e2e5ea;">
          <table style="width: 100%; font-size: 13px; color: #5a6370;">
            <tr>
              <td style="padding: 4px 0;"><strong style="color: #1a1f27;">Advertiser:</strong></td>
              <td style="text-align: right;">${io.advertiser_name}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0;"><strong style="color: #1a1f27;">Episodes:</strong></td>
              <td style="text-align: right;">${io.line_items.length}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0;"><strong style="color: #1a1f27;">Total Net:</strong></td>
              <td style="text-align: right; color: #2e7de8; font-weight: 600;">$${fmt(io.total_net)}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0;"><strong style="color: #1a1f27;">Payment Terms:</strong></td>
              <td style="text-align: right;">${io.payment_terms}</td>
            </tr>
          </table>
        </div>

        <h3 style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #8b95a3; margin-bottom: 8px;">Line Items</h3>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #e2e5ea; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background: #0f1b2d;">
              <th style="padding: 8px 12px; font-size: 11px; color: #ffffff; text-align: left;">#</th>
              <th style="padding: 8px 12px; font-size: 11px; color: #ffffff; text-align: left;">Show</th>
              <th style="padding: 8px 12px; font-size: 11px; color: #ffffff; text-align: left;">Date</th>
              <th style="padding: 8px 12px; font-size: 11px; color: #ffffff; text-align: left;">Placement</th>
              <th style="padding: 8px 12px; font-size: 11px; color: #ffffff; text-align: right;">DLs</th>
              <th style="padding: 8px 12px; font-size: 11px; color: #ffffff; text-align: right;">Net Due</th>
            </tr>
          </thead>
          <tbody>
            ${lineItemRows}
          </tbody>
        </table>

        <p style="font-size: 14px; color: #5a6370; line-height: 1.6; margin-top: 24px;">
          The full IO document with terms and signature blocks is attached as a PDF. Please review and return a signed copy at your earliest convenience.
        </p>
        <p style="font-size: 14px; color: #5a6370; line-height: 1.6;">
          Best,<br/>
          <strong style="color: #1a1f27;">${senderName}</strong>
        </p>
      </div>
      <div style="padding: 16px 32px; font-size: 11px; color: #8b95a3; text-align: center; border: 1px solid #e2e5ea; border-top: none; border-radius: 0 0 12px 12px; background: #f7f8fa;">
        Sent via Taylslate &mdash; the infrastructure layer for creator sponsorship advertising
      </div>
    </div>`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "Email sending is not configured. Add a RESEND_API_KEY environment variable.",
        code: "NO_API_KEY",
      },
      { status: 503 }
    );
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const deal = await getDealById(id);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const show = await getShowById(deal.show_id);
    if (!show) {
      return NextResponse.json({ error: "Show not found" }, { status: 404 });
    }

    // Use existing IO or build from deal
    const existingIO = await getIOByDealId(deal.id);
    let io: InsertionOrder;
    let senderName: string;
    let senderEmail: string;

    if (existingIO) {
      io = existingIO;
      senderName = existingIO.publisher_contact_name;
      senderEmail = existingIO.publisher_contact_email;
    } else {
      const brand = await getProfileById(deal.brand_id);
      const agency = deal.agency_id ? await getProfileById(deal.agency_id) : undefined;
      const agent = deal.agent_id ? await getProfileById(deal.agent_id) : undefined;
      const ioNumber = await getNextIONumber();
      const built = buildIOFromDeal(deal, show, brand, agency, agent, ioNumber);
      io = built.io;
      senderName = built.agent?.full_name ?? "Taylslate";
      senderEmail = built.agent?.email ?? "";
    }

    // Determine recipient: agency if present, otherwise advertiser/brand
    const recipientEmail = io.agency_contact_email ?? io.advertiser_contact_email;
    const recipientName = io.agency_contact_name ?? io.advertiser_contact_name;

    if (!recipientEmail) {
      return NextResponse.json(
        { error: "No recipient email found on the IO. Add an agency or advertiser email." },
        { status: 400 }
      );
    }

    // Generate PDF
    const pdfBuffer = generateIOPdf(io);
    const filename = `${io.io_number.replace(/\s+/g, "_")}.pdf`;

    // Build email
    const subject = `Insertion Order ${io.io_number} — ${io.advertiser_name} × ${io.line_items[0]?.show_name ?? "Campaign"}`;
    const html = buildEmailHtml(io, senderName);

    // Send via Resend
    const resend = new Resend(apiKey);

    const { error } = await resend.emails.send({
      from: `${senderName} via Taylslate <io@taylslate.com>`,
      to: recipientEmail,
      subject,
      html,
      attachments: [
        {
          filename,
          content: pdfBuffer.toString("base64"),
        },
      ],
    });

    if (error) {
      return NextResponse.json(
        { error: `Failed to send: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      to: recipientEmail,
      toName: recipientName,
      subject,
      ioNumber: io.io_number,
      senderName,
      senderEmail,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Email send failed: ${message}` },
      { status: 500 }
    );
  }
}
