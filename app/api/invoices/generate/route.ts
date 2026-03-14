import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, createInvoiceFromIO } from "@/lib/data/queries";

export async function POST(request: NextRequest) {
  let body: { io_id: string; line_item_ids?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { io_id, line_item_ids } = body;

  if (!io_id) {
    return NextResponse.json({ error: "io_id is required" }, { status: 400 });
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const invoice = await createInvoiceFromIO(io_id, line_item_ids);

    if (!invoice) {
      return NextResponse.json(
        { error: "No delivered line items found. Episodes must have actual post dates or be verified to invoice." },
        { status: 400 }
      );
    }

    return NextResponse.json({ invoice });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Failed to generate invoice: ${message}` }, { status: 500 });
  }
}
