import { NextRequest, NextResponse } from "next/server";
import type { ShowRecommendation, YouTubeRecommendation } from "@/lib/data/types";
import { getAuthenticatedUser, addDeals, createShow } from "@/lib/data/queries";

export async function POST(request: NextRequest) {
  let body: {
    campaign_id: string;
    campaign_name: string;
    brand_id: string;
    recommendations: ShowRecommendation[];
    youtube_recommendations: YouTubeRecommendation[];
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { campaign_id, recommendations, youtube_recommendations } = body;
  const brand_id = user.id;

  if (!campaign_id) {
    return NextResponse.json({ error: "campaign_id is required" }, { status: 400 });
  }

  const dealsToInsert: Record<string, unknown>[] = [];

  // Create deals from podcast recommendations
  for (const rec of recommendations ?? []) {
    let showId = rec.show_id;

    // If this is a discovered show, save it to DB first to get a real UUID
    if (showId.startsWith("discovered-")) {
      try {
        const saved = await createShow({
          name: rec.show_name,
          platform: rec.platform ?? "podcast",
          audience_size: rec.audience_size,
          categories: rec.categories ?? [],
          rate_card: { midroll_cpm: rec.estimated_cpm },
          image_url: rec.image_url,
          contact: {
            name: "",
            email: rec.contact_email ?? "",
            method: "email",
          },
          network: rec.network,
          current_sponsors: rec.current_sponsors ?? [],
          data_sources: ["discovery"],
          is_claimed: false,
          is_verified: false,
        });
        if (saved?.id) {
          showId = saved.id;
        } else {
          console.warn(`[campaigns/deals] Failed to save discovered show: ${rec.show_name}`);
          continue;
        }
      } catch (err) {
        console.warn(`[campaigns/deals] Error saving discovered show ${rec.show_name}:`, err);
        continue;
      }
    }

    const netPerEpisode = Math.round((rec.audience_size / 1000) * rec.estimated_cpm);
    const totalNet = netPerEpisode * rec.num_episodes;

    dealsToInsert.push({
      campaign_id,
      show_id: showId,
      brand_id,
      status: "proposed",
      num_episodes: rec.num_episodes,
      placement: rec.placement,
      ad_format: "host_read",
      price_type: "cpm",
      cpm_rate: rec.estimated_cpm,
      guaranteed_downloads: rec.audience_size,
      net_per_episode: netPerEpisode,
      total_net: totalNet,
      is_scripted: false,
      is_personal_experience: true,
      reader_type: "host_read",
      content_type: "evergreen",
      pixel_required: false,
      competitor_exclusion: [],
      exclusivity_days: 90,
      rofr_days: 30,
      flight_start: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
      flight_end: new Date(Date.now() + 120 * 86400000).toISOString().split("T")[0],
    });
  }

  // Create deals from YouTube recommendations
  for (const rec of youtube_recommendations ?? []) {
    let showId = rec.show_id;

    if (showId.startsWith("discovered-")) {
      try {
        const saved = await createShow({
          name: rec.show_name,
          platform: "youtube",
          audience_size: rec.audience_size,
          categories: rec.categories ?? [],
          rate_card: { flat_rate: rec.flat_fee_per_video },
          image_url: rec.image_url,
          contact: {
            name: "",
            email: rec.contact_email ?? "",
            method: "email",
          },
          network: rec.network,
          current_sponsors: rec.current_sponsors ?? [],
          data_sources: ["discovery"],
          is_claimed: false,
          is_verified: false,
        });
        if (saved?.id) {
          showId = saved.id;
        } else {
          console.warn(`[campaigns/deals] Failed to save discovered YT show: ${rec.show_name}`);
          continue;
        }
      } catch (err) {
        console.warn(`[campaigns/deals] Error saving discovered YT show ${rec.show_name}:`, err);
        continue;
      }
    }

    dealsToInsert.push({
      campaign_id,
      show_id: showId,
      brand_id,
      status: "proposed",
      num_episodes: rec.num_videos,
      placement: "mid-roll",
      ad_format: "integration",
      price_type: "flat_rate",
      cpm_rate: 0,
      guaranteed_downloads: rec.audience_size,
      net_per_episode: rec.flat_fee_per_video,
      total_net: rec.flat_fee_per_video * rec.num_videos,
      is_scripted: false,
      is_personal_experience: false,
      reader_type: "host_read",
      content_type: "evergreen",
      pixel_required: false,
      competitor_exclusion: [],
      exclusivity_days: 90,
      rofr_days: 30,
      flight_start: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
      flight_end: new Date(Date.now() + 120 * 86400000).toISOString().split("T")[0],
    });
  }

  if (dealsToInsert.length === 0) {
    return NextResponse.json({ error: "No valid shows to create deals for." }, { status: 400 });
  }

  try {
    const deals = await addDeals(dealsToInsert);
    return NextResponse.json({ deals, count: deals.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[campaigns/deals] Error:", message);
    return NextResponse.json({ error: `Failed to create deals: ${message}` }, { status: 500 });
  }
}
