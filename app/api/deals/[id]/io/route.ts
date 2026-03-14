import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getIOByDealId, getDealById } from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/server";

// GET: Fetch IO for a deal
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: dealId } = await params;
    const io = await getIOByDealId(dealId);

    if (!io) {
      return NextResponse.json({ error: "No IO found for this deal" }, { status: 404 });
    }

    return NextResponse.json({ io });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Failed to fetch IO: ${message}` }, { status: 500 });
  }
}

// PATCH: Update IO fields (party details, terms, line items)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: dealId } = await params;

    // Verify deal access
    const deal = await getDealById(dealId);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const io = await getIOByDealId(dealId);
    if (!io) {
      return NextResponse.json({ error: "No IO found for this deal" }, { status: 404 });
    }

    const body = await request.json();
    const supabase = await createClient();

    // Update IO fields (exclude line_items — handled separately)
    const { line_items: lineItemUpdates, ...ioUpdates } = body;

    if (Object.keys(ioUpdates).length > 0) {
      // Don't allow updating id, io_number, deal_id
      delete ioUpdates.id;
      delete ioUpdates.io_number;
      delete ioUpdates.deal_id;

      const { error: ioError } = await supabase
        .from("insertion_orders")
        .update({ ...ioUpdates, updated_at: new Date().toISOString() })
        .eq("id", io.id);

      if (ioError) {
        return NextResponse.json(
          { error: `Failed to update IO: ${ioError.message}` },
          { status: 500 }
        );
      }
    }

    // Update line items if provided
    if (lineItemUpdates && Array.isArray(lineItemUpdates)) {
      for (const li of lineItemUpdates) {
        if (!li.id) continue;
        const { id: liId, ...liFields } = li;
        const { error: liError } = await supabase
          .from("io_line_items")
          .update(liFields)
          .eq("id", liId)
          .eq("io_id", io.id); // Safety: only update items belonging to this IO

        if (liError) {
          return NextResponse.json(
            { error: `Failed to update line item ${liId}: ${liError.message}` },
            { status: 500 }
          );
        }
      }

      // Recalculate IO totals
      const { data: updatedItems } = await supabase
        .from("io_line_items")
        .select("guaranteed_downloads, gross_rate, net_due")
        .eq("io_id", io.id);

      if (updatedItems) {
        const totalDownloads = updatedItems.reduce((s, li) => s + li.guaranteed_downloads, 0);
        const totalGross = updatedItems.reduce((s, li) => s + li.gross_rate, 0);
        const totalNet = updatedItems.reduce((s, li) => s + li.net_due, 0);

        await supabase
          .from("insertion_orders")
          .update({
            total_downloads: totalDownloads,
            total_gross: Math.round(totalGross * 100) / 100,
            total_net: Math.round(totalNet * 100) / 100,
            updated_at: new Date().toISOString(),
          })
          .eq("id", io.id);
      }
    }

    // Return updated IO
    const updatedIO = await getIOByDealId(dealId);
    return NextResponse.json({ io: updatedIO });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Failed to update IO: ${message}` }, { status: 500 });
  }
}
