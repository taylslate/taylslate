import { NextRequest, NextResponse } from "next/server";
import type { ShowRecommendation, YouTubeRecommendation } from "@/lib/data/types";
import { getAuthenticatedUser, ensureProfile, addDeals, createShow, createCampaign } from "@/lib/data/queries";

export async function POST(request: NextRequest) {
  let body: {
    campaign_id: string;
    campaign_name: string;
    brand_id: string;
    budget_total?: number;
    brief?: Record<string, unknown>;
    platforms?: string[];
    recommendations: ShowRecommendation[];
    youtube_recommendations: YouTubeRecommendation[];
    expansion_opportunities?: unknown[];
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

  // Ensure a profile exists for the authenticated user (FK constraint)
  let profile;
  try {
    profile = await ensureProfile({ id: user.id, email: user.email ?? undefined });
  } catch (err) {
    console.error("[campaigns/deals] Failed to ensure profile:", err);
    return NextResponse.json({ error: "Failed to create user profile" }, { status: 500 });
  }
  const brand_id = profile.id;

  const { recommendations, youtube_recommendations } = body;

  console.log(`[campaigns/deals] Received ${recommendations?.length ?? 0} podcast recs, ${youtube_recommendations?.length ?? 0} YouTube recs`);
  if (recommendations?.length) {
    console.log(`[campaigns/deals] First podcast rec: ${JSON.stringify({ show_id: recommendations[0].show_id, show_name: recommendations[0].show_name, platform: recommendations[0].platform })}`);
  }

  // Step 1: Save the campaign to Supabase to get a real UUID
  // The frontend passes a temporary ID like "campaign-gen-1774296580930"
  let realCampaignId: string | null = null;
  try {
    const allRecs = recommendations ?? [];
    const ytRecs = youtube_recommendations ?? [];
    const totalBudget = body.budget_total ??
      allRecs.reduce((sum, r) => sum + (r.audience_size / 1000) * r.estimated_cpm * r.num_episodes, 0) +
      ytRecs.reduce((sum, r) => sum + r.flat_fee_per_video * r.num_videos, 0);

    const saved = await createCampaign({
      user_id: brand_id,
      name: body.campaign_name || "Campaign",
      brief: body.brief ?? {},
      budget_total: totalBudget,
      platforms: body.platforms ?? ["podcast"],
      status: "planned",
      recommendations: allRecs,
      youtube_recommendations: ytRecs,
      expansion_opportunities: body.expansion_opportunities ?? [],
    });

    if (saved?.id) {
      realCampaignId = saved.id;
    } else {
      console.warn("[campaigns/deals] Failed to save campaign to Supabase — proceeding without campaign_id");
    }
  } catch (err) {
    console.warn("[campaigns/deals] Campaign save error:", err);
    // Don't block deal creation — campaign_id is nullable on the deals table
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
          console.log(`[campaigns/deals] Saved discovered podcast show "${rec.show_name}" → UUID ${saved.id}`);
          showId = saved.id;
        } else {
          console.warn(`[campaigns/deals] Failed to save discovered show: ${rec.show_name} (createShow returned null)`);
          continue;
        }
      } catch (err) {
        console.warn(`[campaigns/deals] Error saving discovered show ${rec.show_name}:`, err);
        continue;
      }
    } else {
      console.log(`[campaigns/deals] Using existing show ID for "${rec.show_name}": ${showId}`);
    }

    const netPerEpisode = Math.round((rec.audience_size / 1000) * rec.estimated_cpm);
    const totalNet = netPerEpisode * rec.num_episodes;

    dealsToInsert.push({
      campaign_id: realCampaignId,
      show_id: showId,
      brand_id,
      status: "planning",
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
      campaign_id: realCampaignId,
      show_id: showId,
      brand_id,
      status: "planning",
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

  console.log(`[campaigns/deals] ${dealsToInsert.length} deals to insert (from ${recommendations?.length ?? 0} podcast + ${youtube_recommendations?.length ?? 0} YouTube recs)`);

  if (dealsToInsert.length === 0) {
    return NextResponse.json({ error: "No valid shows to create deals for." }, { status: 400 });
  }

  let created = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const dealData of dealsToInsert) {
    try {
      const result = await addDeals([dealData]);
      if (result.length > 0) {
        created++;
      }
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : "Unknown error";
      errors.push(`Show ${dealData.show_id}: ${message}`);
      console.error(`[campaigns/deals] Error for show ${dealData.show_id}:`, message);
    }
  }

  return NextResponse.json({
    created,
    failed,
    errors,
    campaign_id: realCampaignId,
  });
}
