import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { EMAIL_ADDRESS_IO, viaTaylslateFrom } from "@/lib/email/addresses";
import { renderIoAttachmentEmail } from "@/lib/email/templates/io-attachment";
import { resolveManagedDelivery } from "@/lib/email/send";
import { getAuthenticatedUser, getDealById, getShowById, getIOByDealId, getProfileById, getNextIONumber, updateDeal, markInsertionOrderSent } from "@/lib/data/queries";
import { getAuthEmail } from "@/lib/auth/auth-email";
import { revealAdvertiserContact, revealPublisherContact } from "@/lib/relay/io-contact";
import { enforceIoSend } from "@/lib/security/rate-limit";
import { isShowsAdmin } from "@/lib/shows/can-edit-show";
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
    let admin = false;
    try {
      admin = await isShowsAdmin(user.id);
    } catch {
      admin = false;
    }
    const party =
      deal.agent_id === user.id || deal.brand_id === user.id || deal.agency_id === user.id;
    if (!party && !admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const limited = await enforceIoSend(user.id);
    if (limited) return limited;

    const show = await getShowById(deal.show_id);
    if (!show) {
      return NextResponse.json({ error: "Show not found" }, { status: 404 });
    }

    // Use existing IO or build from deal
    const existingIO = await getIOByDealId(deal.id);
    let io: InsertionOrder;
    let senderName: string;

    if (existingIO) {
      io = existingIO;
      senderName = existingIO.publisher_contact_name;
    } else {
      const brand = await getProfileById(deal.brand_id);
      const agency = deal.agency_id ? await getProfileById(deal.agency_id) : undefined;
      const agent = deal.agent_id ? await getProfileById(deal.agent_id) : undefined;
      const ioNumber = await getNextIONumber();
      const built = buildIOFromDeal(deal, show, brand, agency, agent, ioNumber);
      io = built.io;
      senderName = built.agent?.full_name ?? "Taylslate";
    }

    const recipientName = io.agency_contact_name ?? io.advertiser_contact_name;
    const recipientProfileId = deal.agency_id || deal.brand_id;
    let recipientEmail: string | null = null;
    if (recipientProfileId && recipientProfileId !== user.id) {
      try {
        recipientEmail = await getAuthEmail(recipientProfileId);
      } catch {
        recipientEmail = null;
      }
    }
    if (!recipientProfileId || !recipientEmail || recipientProfileId === user.id) {
      return NextResponse.json(
        { error: "No recipient on file for this IO" },
        { status: 409 }
      );
    }

    const pdfBuffer = generateIOPdf(io, {
      showContactVisible: revealPublisherContact(deal, recipientProfileId, false),
      brandContactVisible: true,
    });
    const filename = `${io.io_number.replace(/\s+/g, "_")}.pdf`;

    // Build email
    const subject = `Insertion order ${io.io_number} for ${io.advertiser_name} and ${io.line_items[0]?.show_name ?? "Campaign"}`;
    const rendered = renderIoAttachmentEmail(io, senderName);

    // The recipient is the agency when one is on the IO, otherwise the brand.
    const delivery = await resolveManagedDelivery({
      to: recipientEmail,
      subject,
      recipientProfileId,
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
      console.warn("[io/send]", (error as { code?: string }).code ?? "unknown");
      return NextResponse.json({ error: "Failed to send" }, { status: 500 });
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

    const body: {
      success: true;
      to?: string;
      toName: typeof recipientName;
      subject: string;
      ioNumber: string;
      senderName: string;
    } = {
      success: true,
      toName: recipientName,
      subject: delivery.subject,
      ioNumber: io.io_number,
      senderName,
    };
    if (revealAdvertiserContact(deal, user.id, admin)) body.to = delivery.to;
    return NextResponse.json(body);
  } catch {
    console.warn("[io/send]", "unknown");
    return NextResponse.json({ error: "Email send failed" }, { status: 500 });
  }
}
