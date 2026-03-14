import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getInvoiceById, updateInvoiceStatus } from "@/lib/data/queries";
import type { InvoiceStatus } from "@/lib/data/types";

// GET: Fetch a single invoice with line items
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const invoice = await getInvoiceById(id);

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    return NextResponse.json({ invoice });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Failed to fetch invoice: ${message}` }, { status: 500 });
  }
}

// PATCH: Update invoice status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    if (!body.status) {
      return NextResponse.json({ error: "status is required" }, { status: 400 });
    }

    const invoice = await updateInvoiceStatus(
      id,
      body.status as InvoiceStatus,
      { payment_method: body.payment_method }
    );

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    return NextResponse.json({ invoice });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("Cannot transition")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: `Failed to update invoice: ${message}` }, { status: 500 });
  }
}
