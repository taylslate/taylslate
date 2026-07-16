import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  getDealWithRelations,
  getDealById,
  updateDeal,
  deleteDeal,
  getWave12DealById,
  getOutreachById,
  getBrandProfileByUserId,
  getShowProfileByUserId,
} from "@/lib/data/queries";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { DealStatus, BrandProfile, ShowProfile } from "@/lib/data/types";

const VALID_STATUSES: DealStatus[] = ["planning", "io_sent", "live", "completed"];

// Ownership gate for a single deal. These routes read/mutate via the admin
// client (which bypasses RLS), so authorization MUST be enforced here — without
// it any authenticated user could read or mutate any deal by UUID. Covers both
// legacy ownership (brand/agent/agency_id = user, migration 001) and Wave-12
// ownership (brand_profile_id / show_profile_id resolved from the caller,
// migration 013). `deal` is the raw row so both column families are present.
async function callerOwnsDeal(
  userId: string,
  deal: Record<string, unknown>
): Promise<boolean> {
  if (
    deal.brand_id === userId ||
    deal.agent_id === userId ||
    deal.agency_id === userId
  ) {
    return true;
  }
  const [brandProfile, showProfile] = await Promise.all([
    getBrandProfileByUserId(userId),
    getShowProfileByUserId(userId),
  ]);
  if (deal.brand_profile_id && brandProfile?.id === deal.brand_profile_id) return true;
  if (deal.show_profile_id && showProfile?.id === deal.show_profile_id) return true;
  return false;
}

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

    // Authorization: these handlers use the admin client, so ownership must be
    // checked here. Load the raw row once and gate before returning any data.
    const dealRow = await getDealById(id);
    if (!dealRow) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    if (!(await callerOwnsDeal(user.id, dealRow as unknown as Record<string, unknown>))) {
      // 404 (not 403) so a non-owner can't probe which deal UUIDs exist.
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const deal = await getDealWithRelations(id);

    if (deal && deal.show_name) {
      console.log(
        `[GET /api/deals/${id}] Found legacy deal: brand_id=${deal.brand_id} agent_id=${deal.agent_id} show=${deal.show_name}`
      );
      return NextResponse.json({ deal });
    }

    // Wave 12 fallback — outreach-driven deals don't join through shows table.
    const wave12 = await getWave12DealById(id);
    if (wave12 && wave12.outreach_id) {
      const outreach = await getOutreachById(wave12.outreach_id);
      const { data: bp } = await supabaseAdmin
        .from("brand_profiles")
        .select("id, brand_identity, brand_website")
        .eq("id", wave12.brand_profile_id)
        .single();
      // show_profile_id is null until the show onboards — skip the lookup and
      // fall back to the outreach's show_name below.
      const { data: sp } = wave12.show_profile_id
        ? await supabaseAdmin
            .from("show_profiles")
            .select("id, show_name")
            .eq("id", wave12.show_profile_id)
            .single()
        : { data: null };
      const brandName =
        (bp as BrandProfile | null)?.brand_identity?.split(/[.,—–-]/)[0]?.trim() ||
        (bp as BrandProfile | null)?.brand_website ||
        "Brand";
      return NextResponse.json({
        deal: {
          ...wave12,
          show_name: (sp as ShowProfile | null)?.show_name ?? outreach?.show_name ?? "Show",
          brand_name: brandName,
          outreach,
        },
      });
    }

    console.error(`[GET /api/deals/${id}] Deal not found for user ${user.id}`);
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
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
    if (!(await callerOwnsDeal(user.id, existing as unknown as Record<string, unknown>))) {
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
    if (!(await callerOwnsDeal(user.id, existing as unknown as Record<string, unknown>))) {
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
