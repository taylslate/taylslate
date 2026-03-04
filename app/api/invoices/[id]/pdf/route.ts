import { NextRequest, NextResponse } from "next/server";
import { invoices } from "@/lib/data";
import { generateInvoicePdf } from "@/lib/pdf/invoice-pdf";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const invoice = invoices.find((inv) => inv.id === id);

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const pdfBuffer = generateInvoicePdf(invoice);
  const filename = `${invoice.invoice_number.replace(/\s+/g, "_")}.pdf`;

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
