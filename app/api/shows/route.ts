import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getShowsFiltered,
  getAllShows,
  createShow,
  claimShow,
  getUserProfile,
} from "@/lib/data/queries";
import { isShowsAdmin } from "@/lib/shows/can-edit-show";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = request.nextUrl.searchParams;
    const search = params.get("search") ?? undefined;
    const platform = params.get("platform") ?? undefined;
    const category = params.get("category") ?? undefined;
    const minAudience = params.get("min_audience")
      ? parseInt(params.get("min_audience")!, 10)
      : undefined;
    const maxAudience = params.get("max_audience")
      ? parseInt(params.get("max_audience")!, 10)
      : undefined;

    const limitRaw = params.get("limit");
    const limitParsed = limitRaw ? parseInt(limitRaw, 10) : undefined;
    const limit =
      limitParsed != null && Number.isFinite(limitParsed) && limitParsed > 0
        ? Math.min(100, limitParsed)
        : undefined;

    const hasFilters = search || platform || category || minAudience || maxAudience || limit;

    const profile = await getUserProfile(user.id);

    if (profile?.role === "agent") {
      const shows = await getShowsFiltered({
        search,
        platform,
        category,
        min_audience: minAudience,
        max_audience: maxAudience,
        agent_id: user.id,
        limit,
      });
      return NextResponse.json(shows);
    }

    // Brands and other signed-in roles see the full catalog, including
    // contact and rate card. Signed-out callers are rejected above.
    if (hasFilters) {
      const shows = await getShowsFiltered({
        search,
        platform,
        category,
        min_audience: minAudience,
        max_audience: maxAudience,
        limit,
      });
      return NextResponse.json(shows);
    }

    const shows = await getAllShows();
    return NextResponse.json(shows);
  } catch (error) {
    console.error("Error fetching shows:", error);
    return NextResponse.json(
      { error: "Failed to fetch shows" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = await getUserProfile(user.id);
    const admin = await isShowsAdmin(user.id);
    const role = profile?.role as string | undefined;
    if (!admin && role !== "agent") {
      return NextResponse.json(
        { error: "Only agents can create shows" },
        { status: 403 }
      );
    }

    const body = await request.json();

    if (!body.name || !body.platform) {
      return NextResponse.json(
        { error: "name and platform are required" },
        { status: 400 }
      );
    }

    if (!["podcast", "youtube"].includes(body.platform)) {
      return NextResponse.json(
        { error: "platform must be 'podcast' or 'youtube'" },
        { status: 400 }
      );
    }

    // is_verified, is_claimed, and podscan_id are ignored. A non-admin
    // show stays hidden until an admin approves it, and agent_id is the caller.
    const show = await createShow(
      {
        name: body.name,
        platform: body.platform,
        description: body.description ?? "",
        audience_size: body.audience_size ?? 0,
        rate_card: body.rate_card ?? {},
        categories: body.categories ?? [],
        tags: body.tags ?? [],
        network: body.network,
        contact: body.contact ?? { name: "", email: "", method: "email" },
        ad_formats: body.ad_formats ?? [],
        episode_cadence: body.episode_cadence ?? "weekly",
        min_buy: body.min_buy,
        price_type: body.price_type ?? (body.platform === "youtube" ? "flat_rate" : "cpm"),
        avg_episode_length_min: body.avg_episode_length_min ?? 0,
        current_sponsors: body.current_sponsors ?? [],
        demographics: body.demographics ?? {},
        audience_interests: body.audience_interests ?? [],
        image_url: body.image_url,
        is_discoverable: admin ? body.is_discoverable !== false : false,
        ...(admin
          ? typeof body.agent_id === "string"
            ? { agent_id: body.agent_id }
            : {}
          : { agent_id: user.id }),
      },
      { actor: { userId: user.id, admin } }
    );

    if (!show) {
      return NextResponse.json(
        { error: "Failed to create show" },
        { status: 500 }
      );
    }

    // Auto-create a pending roster link if the signed-in user is an agent.
    if (role === "agent") {
      try {
        await claimShow(show.id, body.commission_rate);
      } catch (claimError) {
        const message =
          claimError instanceof Error ? claimError.message : "Roster link failed.";
        console.error("Roster link failed after creating show:", claimError);
        return NextResponse.json(
          {
            error: `Show created, but the roster link failed: ${message}`,
            show,
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(show, { status: 201 });
  } catch (error) {
    console.error("Error creating show:", error);
    return NextResponse.json(
      { error: "Failed to create show" },
      { status: 500 }
    );
  }
}
