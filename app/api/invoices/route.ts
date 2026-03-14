import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getInvoicesForUser } from "@/lib/data/queries";
import type { InvoiceStatus } from "@/lib/data/types";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as InvoiceStatus | null;
    const io_id = searchParams.get("io_id") ?? undefined;

    const result = await getInvoicesForUser(user.id, {
      status: status ?? undefined,
      io_id,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Failed to fetch invoices: ${message}` }, { status: 500 });
  }
}
