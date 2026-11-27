import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getAuthEmail } from "@/lib/auth/auth-email";
import {
  getAuthenticatedUser,
  getInvoiceForDelivery,
  getDealById,
  getProfileById,
  getShowProfileByUserId,
} from "@/lib/data/queries";
import { generateInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { EMAIL_ADDRESS_INVOICES, viaTaylslateFrom } from "@/lib/email/addresses";
import { resolveManagedDelivery } from "@/lib/email/send";
import { renderInvoiceNotice } from "@/lib/email/templates/invoice-notice";
import { enforceIoSend } from "@/lib/security/rate-limit";
import type { Invoice } from "@/lib/data/types";

const NOT_FOUND = { error: "Invoice not found" };

function notFound() {
  return NextResponse.json(NOT_FOUND, { status: 404 });
}

function profileId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

type PublisherDeal = {
  agent_id?: unknown;
  show_profile_id?: unknown;
};

/** The show side that generated the invoice: legacy agent_id, or the show profile on the deal. */
async function publisherOwns(userId: string, deal: PublisherDeal): Promise<boolean> {
  if (!userId) return false;
  if (deal.agent_id === userId) return true;
  const showProfileId = profileId(deal.show_profile_id);
  if (!showProfileId) return false;
  try {
    const showProfile = await getShowProfileByUserId(userId);
    return showProfile?.id === showProfileId;
  } catch {
    console.warn("[invoices/send]", "owner");
    return false;
  }
}

export async function POST(request: NextRequest) {
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

  let body: { invoice_id?: unknown; invoice?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if ("invoice" in body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (typeof body.invoice_id !== "string" || body.invoice_id.trim() === "") {
    return NextResponse.json({ error: "invoice_id is required" }, { status: 400 });
  }
  const invoiceId = body.invoice_id.trim();

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limited = await enforceIoSend(user.id);
    if (limited) return limited;

    const loaded = await getInvoiceForDelivery(invoiceId);
    if (!loaded) return notFound();
    const invoice = loaded.invoice;

    const deal = await getDealById(loaded.dealId);
    if (!deal) return notFound();

    const owned = await publisherOwns(user.id, deal);
    if (!owned) return notFound();

    // Account on the deal. Agency when the deal has one, otherwise the brand.
    // IO contact columns and the stored invoice address are not recipients.
    const recipientProfileId = profileId(deal.agency_id) || profileId(deal.brand_id);
    if (!recipientProfileId || recipientProfileId === user.id) {
      return NextResponse.json(
        { error: "No recipient on file for this invoice" },
        { status: 409 }
      );
    }

    let recipientEmail: string | null = null;
    try {
      recipientEmail = await getAuthEmail(recipientProfileId);
    } catch {
      console.warn("[invoices/send]", "recipient");
      recipientEmail = null;
    }
    if (!recipientEmail) {
      return NextResponse.json(
        { error: "No recipient on file for this invoice" },
        { status: 409 }
      );
    }

    let senderName = invoice.from_name;
    const agentId = profileId(deal.agent_id);
    const agent = agentId ? await getProfileById(agentId) : undefined;
    if (agent?.full_name) senderName = agent.full_name;

    const forSend: Invoice = { ...invoice, bill_to_email: recipientEmail };
    const pdfBuffer = generateInvoicePdf(forSend);
    const filename = `${invoice.invoice_number.replace(/\s+/g, "_")}.pdf`;

    const subject = `Invoice ${invoice.invoice_number} for ${invoice.advertiser_name}, ${invoice.campaign_period}`;
    const rendered = renderInvoiceNotice(forSend, senderName);

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

    const resend = new Resend(apiKey);

    const { error } = await resend.emails.send({
      from: viaTaylslateFrom(senderName, EMAIL_ADDRESS_INVOICES),
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
      console.warn("[invoices/send]", (error as { code?: string }).code ?? "unknown");
      return NextResponse.json({ error: "Failed to send" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      toName: invoice.bill_to_name,
      subject,
      invoiceNumber: invoice.invoice_number,
    });
  } catch {
    console.warn("[invoices/send]", "unknown");
    return NextResponse.json({ error: "Email send failed" }, { status: 500 });
  }
}
