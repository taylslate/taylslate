import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { EMAIL_ADDRESS_IO, viaTaylslateFrom } from "@/lib/email/addresses";
import { renderIoAttachmentEmail } from "@/lib/email/templates/io-attachment";
import { resolveManagedDelivery } from "@/lib/email/send";
import { getAuthenticatedUser, getDealById, getShowById, getIOByDealId, getProfileById, getNextIONumber, updateDeal, markInsertionOrderSent } from "@/lib/data/queries";
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
    const rendered = renderIoAttachmentEmail(io, senderName);

    // The recipient is the agency when one is on the IO, otherwise the brand.
    const delivery = await resolveManagedDelivery({
      to: recipientEmail,
      subject,
      recipientProfileId: io.agency_contact_email
        ? (deal.agency_id ?? undefined)
        : (deal.brand_id ?? undefined),
    });
    if (!delivery.ok) {
      return NextResponse.json(
        {
          error:
            "This brand is managed and MANAGED_ACCOUNT_INBOX is not set, so the email was not sent.",
        },
        { status: 409 },
      );
    }

    // Send via Resend. Unmanaged sends keep the same from, html, and attachment.
    const resend = new Resend(apiKey);

    const { error } = await resend.emails.send({
      from: viaTaylslateFrom(senderName, EMAIL_ADDRESS_IO),
      to: delivery.to,
      subject: delivery.subject,
      html: rendered.html,
      text: rendered.text,
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

    // A managed reroute or a skipped send is not an IO the brand was sent.
    // Only a delivery to the original recipient advances the pipeline.
    const rerouted =
      delivery.to !== recipientEmail || delivery.subject.startsWith("[managed:");
    if (!rerouted && deal.status === "planning") {
      if (existingIO?.id) {
        await markInsertionOrderSent(existingIO.id);
      }
      await updateDeal(deal.id, { status: "io_sent" });
    }

    return NextResponse.json({
      success: true,
      to: delivery.to,
      toName: recipientName,
      subject: delivery.subject,
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
