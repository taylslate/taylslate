import { NextRequest, NextResponse } from "next/server";
import { generateInvoicePdf } from "@/lib/pdf/invoice-pdf";
import type { Invoice } from "@/lib/data";

// POST: accepts full invoice JSON and returns PDF
// Used for dynamically generated invoices not yet persisted
export async function POST(request: NextRequest) {
  let body: { invoice: Invoice };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.invoice) {
    return NextResponse.json({ error: "invoice object is required" }, { status: 400 });
  }

  const pdfBuffer = generateInvoicePdf(body.invoice);
  const filename = `${(body.invoice.invoice_number ?? "invoice").replace(/\s+/g, "_")}.pdf`;

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
