import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getAuthenticatedUser, getInvoiceById, getIOById, getDealById, getProfileById } from "@/lib/data/queries";
import { generateInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { EMAIL_ADDRESS_INVOICES, viaTaylslateFrom } from "@/lib/email/addresses";
import { renderInvoiceNotice } from "@/lib/email/templates/invoice-notice";
import type { Invoice } from "@/lib/data";

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

  let body: { invoice_id?: string; invoice?: Invoice };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Resolve the invoice: either by ID (existing) or from the body (generated)
    let invoice: Invoice;
    if (body.invoice_id) {
      const found = await getInvoiceById(body.invoice_id);
      if (!found) {
        return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
      }
      invoice = found;
    } else if (body.invoice) {
      invoice = body.invoice;
    } else {
      return NextResponse.json({ error: "Provide invoice_id or invoice object" }, { status: 400 });
    }

    // Determine recipient from invoice bill_to fields
    const recipientEmail = invoice.bill_to_email;
    const recipientName = invoice.bill_to_name;

    if (!recipientEmail) {
      return NextResponse.json(
        { error: "No billing email found on the invoice." },
        { status: 400 }
      );
    }

    // Determine sender from the IO's publisher/agent
    let senderName = invoice.from_name;
    const io = await getIOById(invoice.io_id);
    if (io) {
      const deal = await getDealById(io.deal_id);
      const agent = deal?.agent_id ? await getProfileById(deal.agent_id) : undefined;
      if (agent) senderName = agent.full_name;
    }

    // Generate PDF
    const pdfBuffer = generateInvoicePdf(invoice);
    const filename = `${invoice.invoice_number.replace(/\s+/g, "_")}.pdf`;

    // Build email
    const subject = `Invoice ${invoice.invoice_number} — ${invoice.advertiser_name} — ${invoice.campaign_period}`;
    const rendered = renderInvoiceNotice(invoice, senderName);

    // Send via Resend. This path does not use sendEmail, so managed-account
    // reroute does not apply — same recipients as before.
    const resend = new Resend(apiKey);

    const { error } = await resend.emails.send({
      from: viaTaylslateFrom(senderName, EMAIL_ADDRESS_INVOICES),
      to: recipientEmail,
      subject,
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

    return NextResponse.json({
      success: true,
      to: recipientEmail,
      toName: recipientName,
      subject,
      invoiceNumber: invoice.invoice_number,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Email send failed: ${message}` },
      { status: 500 }
    );
  }
}
