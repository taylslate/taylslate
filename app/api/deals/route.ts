import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  getDealsFiltered,
  createDeal,
  getUserProfile,
  ensureProfile,
  getShowById,
} from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/server";
import { parseDealBody, partiesForRole } from "@/lib/deals/create-input";
import type { DealStatus } from "@/lib/data/types";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") ?? undefined;
    const show_id = searchParams.get("show_id") ?? undefined;
    const brand_id = searchParams.get("brand_id") ?? undefined;

    const deals = await getDealsFiltered(user.id, { status, show_id, brand_id });
    return NextResponse.json({ deals });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Failed to fetch deals: ${message}` }, { status: 500 });
  }
}

async function resolveShowId(
  showId: string | undefined,
  showName: string | undefined
): Promise<{ id: string } | { error: string; field: "show_id" | "show_name" }> {
  if (showId) {
    const show = await getShowById(showId);
    if (!show) return { error: "No show with that id", field: "show_id" };
    return { id: show.id };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shows")
    .select("id, name")
    .ilike("name", showName ?? "")
    .limit(2);
  if (error) return { error: "Could not look up that show", field: "show_name" };
  const rows = data ?? [];
  if (rows.length === 0) {
    return { error: `No show named "${showName}"`, field: "show_name" };
  }
  if (rows.length > 1) {
    return { error: `More than one show is named "${showName}"`, field: "show_name" };
  }
  return { id: rows[0].id as string };
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = parseDealBody(body);
    if (!parsed.ok) {
      const first = Object.values(parsed.fields)[0] ?? "Check the highlighted fields";
      return NextResponse.json({ error: first, fields: parsed.fields }, { status: 400 });
    }

    const show = await resolveShowId(parsed.deal.show_id, parsed.deal.show_name);
    if ("error" in show) {
      return NextResponse.json(
        { error: show.error, fields: { [show.field]: show.error } },
        { status: 400 }
      );
    }

    const profile = (await getUserProfile(user.id)) ?? (await ensureProfile(user));
    const parties = partiesForRole(user.id, profile.role);

    const deal = await createDeal({
      show_id: show.id,
      ...parties,
      campaign_id: parsed.deal.campaign_id,
      status: "planning" as DealStatus,
      num_episodes: parsed.deal.num_episodes,
      placement: parsed.deal.placement,
      ad_format: parsed.deal.ad_format,
      price_type: parsed.deal.price_type,
      cpm_rate: parsed.deal.cpm_rate,
      gross_cpm: parsed.deal.gross_cpm,
      guaranteed_downloads: parsed.deal.guaranteed_downloads,
      net_per_episode: parsed.deal.net_per_episode,
      gross_per_episode: parsed.deal.gross_per_episode,
      total_net: parsed.deal.total_net,
      total_gross: parsed.deal.total_gross,
      is_scripted: parsed.deal.is_scripted,
      is_personal_experience: parsed.deal.is_personal_experience,
      reader_type: parsed.deal.reader_type,
      content_type: parsed.deal.content_type,
      pixel_required: parsed.deal.pixel_required,
      competitor_exclusion: parsed.deal.competitor_exclusion,
      exclusivity_days: parsed.deal.exclusivity_days,
      rofr_days: parsed.deal.rofr_days,
      flight_start: parsed.deal.flight_start,
      flight_end: parsed.deal.flight_end,
      notes: parsed.deal.notes,
    });
    if (!deal) {
      return NextResponse.json(
        { error: "Failed to create deal" },
        { status: 500 }
      );
    }

    return NextResponse.json({ deal }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Failed to create deal: ${message}` }, { status: 500 });
  }
}
