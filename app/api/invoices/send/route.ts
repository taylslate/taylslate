import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { invoices, insertionOrders, profiles, deals } from "@/lib/data";
import { generateInvoicePdf } from "@/lib/pdf/invoice-pdf";
import type { Invoice } from "@/lib/data";

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function buildEmailHtml(invoice: Invoice, senderName: string): string {
  const lineItemRows = invoice.line_items
    .map(
      (li, i) => `
      <tr style="border-bottom: 1px solid #e2e5ea;">
        <td style="padding: 8px 12px; font-size: 13px; color: #1a1f27;">${i + 1}</td>
        <td style="padding: 8px 12px; font-size: 13px; color: #1a1f27;">${li.show_name}</td>
        <td style="padding: 8px 12px; font-size: 13px; color: #1a1f27;">${fmtDate(li.post_date)}</td>
        <td style="padding: 8px 12px; font-size: 13px; color: #1a1f27;">${li.description}</td>
        <td style="padding: 8px 12px; font-size: 13px; color: #1a1f27; text-align: right;">$${fmt(li.rate)}</td>
      </tr>`
    )
    .join("");

  const adjustmentRow =
    invoice.adjustments !== 0
      ? `<tr>
          <td style="padding: 4px 0;"><strong style="color: #1a1f27;">Adjustments:</strong></td>
          <td style="text-align: right; color: #f59e0b;">-$${fmt(Math.abs(invoice.adjustments))}</td>
        </tr>`
      : "";

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; color: #1a1f27;">
      <div style="background: #0f1b2d; padding: 24px 32px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 20px; color: #ffffff; font-weight: 600;">Invoice</h1>
        <p style="margin: 6px 0 0; font-size: 13px; color: #b4beda;">${invoice.invoice_number}</p>
      </div>
      <div style="background: #ffffff; padding: 24px 32px; border: 1px solid #e2e5ea; border-top: none;">
        <p style="font-size: 14px; color: #5a6370; line-height: 1.6; margin-top: 0;">
          Hi ${invoice.bill_to_name},
        </p>
        <p style="font-size: 14px; color: #5a6370; line-height: 1.6;">
          Please find the attached invoice for <strong style="color: #1a1f27;">${invoice.advertiser_name}</strong> — ${invoice.campaign_period}.
        </p>

        <div style="margin: 20px 0; padding: 16px; background: #f7f8fa; border-radius: 8px; border: 1px solid #e2e5ea;">
          <table style="width: 100%; font-size: 13px; color: #5a6370;">
            <tr>
              <td style="padding: 4px 0;"><strong style="color: #1a1f27;">IO Reference:</strong></td>
              <td style="text-align: right;">${invoice.io_number}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0;"><strong style="color: #1a1f27;">Line Items:</strong></td>
              <td style="text-align: right;">${invoice.line_items.length}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0;"><strong style="color: #1a1f27;">Subtotal:</strong></td>
              <td style="text-align: right;">$${fmt(invoice.subtotal)}</td>
            </tr>
            ${adjustmentRow}
            <tr>
              <td style="padding: 4px 0;"><strong style="color: #1a1f27;">Total Due:</strong></td>
              <td style="text-align: right; color: #2e7de8; font-weight: 600;">$${fmt(invoice.total_due)}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0;"><strong style="color: #1a1f27;">Due Date:</strong></td>
              <td style="text-align: right;">${fmtDate(invoice.due_date)}</td>
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
              <th style="padding: 8px 12px; font-size: 11px; color: #ffffff; text-align: left;">Description</th>
              <th style="padding: 8px 12px; font-size: 11px; color: #ffffff; text-align: right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${lineItemRows}
          </tbody>
        </table>

        <p style="font-size: 14px; color: #5a6370; line-height: 1.6; margin-top: 24px;">
          The full invoice document is attached as a PDF. Payment is due by <strong style="color: #1a1f27;">${fmtDate(invoice.due_date)}</strong>.
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

  // Resolve the invoice: either by ID (existing) or from the body (generated)
  let invoice: Invoice;
  if (body.invoice_id) {
    const found = invoices.find((inv) => inv.id === body.invoice_id);
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
  const io = insertionOrders.find((o) => o.id === invoice.io_id);
  if (io) {
    const deal = deals.find((d) => d.id === io.deal_id);
    const agent = deal?.agent_id ? profiles.find((p) => p.id === deal.agent_id) : undefined;
    if (agent) senderName = agent.full_name;
  }

  // Generate PDF
  const pdfBuffer = generateInvoicePdf(invoice);
  const filename = `${invoice.invoice_number.replace(/\s+/g, "_")}.pdf`;

  // Build email
  const subject = `Invoice ${invoice.invoice_number} — ${invoice.advertiser_name} — ${invoice.campaign_period}`;
  const html = buildEmailHtml(invoice, senderName);

  // Send via Resend
  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: `${senderName} via Taylslate <invoices@taylslate.com>`,
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
