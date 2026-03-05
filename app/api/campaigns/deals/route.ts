import { NextRequest, NextResponse } from "next/server";
import type { Deal, ShowRecommendation, YouTubeRecommendation } from "@/lib/data/types";
import { addDeals } from "@/lib/data/deal-store";

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

  const { campaign_id, brand_id, recommendations, youtube_recommendations } = body;

  if (!campaign_id || !brand_id) {
    return NextResponse.json({ error: "campaign_id and brand_id are required" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const deals: Deal[] = [];

  // Create deals from podcast recommendations
  for (const rec of recommendations) {
    const netPerEpisode = Math.round((rec.audience_size / 1000) * rec.estimated_cpm);
    const totalNet = netPerEpisode * rec.num_episodes;

    deals.push({
      id: `deal-campaign-${campaign_id}-${rec.show_id}`,
      campaign_id,
      show_id: rec.show_id,
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
      created_at: now,
      updated_at: now,
    });
  }

  // Create deals from YouTube recommendations
  for (const rec of youtube_recommendations) {
    deals.push({
      id: `deal-campaign-${campaign_id}-${rec.show_id}`,
      campaign_id,
      show_id: rec.show_id,
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
      created_at: now,
      updated_at: now,
    });
  }

  // Persist to in-memory store (replace with Supabase when connected)
  addDeals(deals);

  return NextResponse.json({ deals, count: deals.length });
}
