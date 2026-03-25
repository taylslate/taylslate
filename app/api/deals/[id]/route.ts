import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getDealWithRelations, getDealById, updateDeal, deleteDeal } from "@/lib/data/queries";
import type { DealStatus } from "@/lib/data/types";

const VALID_STATUSES: DealStatus[] = ["planning", "io_sent", "live", "completed"];

// Valid status transitions
const VALID_TRANSITIONS: Record<DealStatus, DealStatus[]> = {
  planning: ["io_sent"],
  io_sent: ["live"],
  live: ["completed"],
  completed: [],
};

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
    console.log(`[GET /api/deals/${id}] user=${user.id} email=${user.email}`);

    const deal = await getDealWithRelations(id);

    if (!deal) {
      console.error(`[GET /api/deals/${id}] Deal not found for user ${user.id}`);
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    console.log(`[GET /api/deals/${id}] Found deal: brand_id=${deal.brand_id} agent_id=${deal.agent_id} show=${deal.show_name}`);
    return NextResponse.json({ deal });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Failed to fetch deal: ${message}` }, { status: 500 });
  }
}

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
    const existing = await getDealById(id);

    if (!existing) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const body = await request.json();

    // Validate status transition if status is being changed
    if (body.status && body.status !== existing.status) {
      const currentStatus = existing.status as DealStatus;
      const newStatus = body.status as string;

      if (!VALID_STATUSES.includes(newStatus as DealStatus)) {
        return NextResponse.json(
          { error: `Invalid status: ${newStatus}. Valid statuses: ${VALID_STATUSES.join(", ")}` },
          { status: 400 }
        );
      }
      const allowed = VALID_TRANSITIONS[currentStatus];

      if (!allowed || !allowed.includes(newStatus as DealStatus)) {
        return NextResponse.json(
          {
            error: `Invalid status transition: ${currentStatus} → ${newStatus}. Allowed: ${allowed?.join(", ") || "none (terminal state)"}`,
          },
          { status: 400 }
        );
      }
    }

    // If financial terms change, recalculate
    const updates = { ...body };
    const guaranteed_downloads = Number(updates.guaranteed_downloads ?? existing.guaranteed_downloads);
    const cpm_rate = Number(updates.cpm_rate ?? existing.cpm_rate);
    const num_episodes = Number(updates.num_episodes ?? existing.num_episodes);

    if (updates.guaranteed_downloads || updates.cpm_rate || updates.num_episodes) {
      updates.net_per_episode = (guaranteed_downloads / 1000) * cpm_rate;
      updates.total_net = updates.net_per_episode * num_episodes;

      const gross_cpm = updates.gross_cpm ?? existing.gross_cpm;
      if (gross_cpm) {
        updates.gross_per_episode = (guaranteed_downloads / 1000) * Number(gross_cpm);
        updates.total_gross = updates.gross_per_episode * num_episodes;
      }
    }

    const deal = await updateDeal(id, updates);
    if (!deal) {
      return NextResponse.json({ error: "Failed to update deal" }, { status: 500 });
    }

    return NextResponse.json({ deal });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Failed to update deal: ${message}` }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const existing = await getDealById(id);

    if (!existing) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    // Completed deals cannot be deleted
    if (existing.status === "completed") {
      return NextResponse.json(
        { error: "Cannot delete a completed deal" },
        { status: 400 }
      );
    }

    const success = await deleteDeal(id);
    if (!success) {
      return NextResponse.json({ error: "Failed to delete deal" }, { status: 500 });
    }

    return NextResponse.json({ message: "Deal deleted" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Failed to delete deal: ${message}` }, { status: 500 });
  }
}
