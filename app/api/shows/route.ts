import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getShowsFiltered,
  getAllShows,
  createShow,
  claimShow,
  getUserProfile,
} from "@/lib/data/queries";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

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

    const hasFilters = search || platform || category || minAudience || maxAudience;

    // If authenticated, check role to scope results
    if (user) {
      const profile = await getUserProfile(user.id);

      if (profile?.role === "agent") {
        // Agents see their own shows by default
        const shows = await getShowsFiltered({
          search,
          platform,
          category,
          min_audience: minAudience,
          max_audience: maxAudience,
          agent_id: user.id,
        });
        return NextResponse.json(shows);
      }
    }

    // Brands, unauthenticated, or non-agent users see all shows
    if (hasFilters) {
      const shows = await getShowsFiltered({
        search,
        platform,
        category,
        min_audience: minAudience,
        max_audience: maxAudience,
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

    const show = await createShow({
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
    });

    if (!show) {
      return NextResponse.json(
        { error: "Failed to create show" },
        { status: 500 }
      );
    }

    // Auto-create agent relationship if user is an agent
    const profile = await getUserProfile(user.id);
    if (profile?.role === "agent") {
      await claimShow(user.id, show.id, body.commission_rate);
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
