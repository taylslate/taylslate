import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getDealsFiltered, createDeal } from "@/lib/data/queries";
import type { DealStatus, Placement, AdFormat, PriceType } from "@/lib/data/types";

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

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // Required fields
    const requiredFields = [
      "show_id", "brand_id", "num_episodes", "placement",
      "ad_format", "price_type", "cpm_rate", "guaranteed_downloads",
      "is_scripted", "is_personal_experience", "reader_type",
      "content_type", "pixel_required", "flight_start", "flight_end",
    ];

    for (const field of requiredFields) {
      if (body[field] === undefined || body[field] === null) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    // Auto-calculate financial fields
    const guaranteed_downloads = Number(body.guaranteed_downloads);
    const cpm_rate = Number(body.cpm_rate);
    const num_episodes = Number(body.num_episodes);
    const net_per_episode = (guaranteed_downloads / 1000) * cpm_rate;
    const total_net = net_per_episode * num_episodes;

    // If agency involved, calculate gross amounts
    const gross_cpm = body.gross_cpm ? Number(body.gross_cpm) : undefined;
    const gross_per_episode = gross_cpm
      ? (guaranteed_downloads / 1000) * gross_cpm
      : undefined;
    const total_gross = gross_per_episode
      ? gross_per_episode * num_episodes
      : undefined;

    const dealData = {
      show_id: body.show_id as string,
      brand_id: body.brand_id as string,
      campaign_id: body.campaign_id as string | undefined,
      agent_id: body.agent_id as string | undefined,
      agency_id: body.agency_id as string | undefined,
      status: "proposed" as DealStatus,
      num_episodes,
      placement: body.placement as Placement,
      ad_format: body.ad_format as AdFormat,
      price_type: body.price_type as PriceType,
      cpm_rate,
      gross_cpm,
      guaranteed_downloads,
      net_per_episode,
      gross_per_episode,
      total_net,
      total_gross,
      is_scripted: Boolean(body.is_scripted),
      is_personal_experience: Boolean(body.is_personal_experience),
      reader_type: body.reader_type as "host_read" | "producer_read" | "guest_read",
      content_type: body.content_type as "evergreen" | "dated",
      pixel_required: Boolean(body.pixel_required),
      competitor_exclusion: (body.competitor_exclusion as string[]) ?? [],
      exclusivity_days: Number(body.exclusivity_days ?? 90),
      rofr_days: Number(body.rofr_days ?? 30),
      flight_start: body.flight_start as string,
      flight_end: body.flight_end as string,
      notes: body.notes as string | undefined,
    };

    const deal = await createDeal(dealData);
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
