import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, createCampaign, updateCampaignScoredShows } from "@/lib/data/queries";
import type { CampaignBrief, ScoredShowRecord } from "@/lib/data/types";
import { scoreShows, type ScoredShow } from "@/lib/scoring";

interface ScoreRequest {
  name: string;
  brand_url?: string;
  budget_total: number;
  platforms: string[];
  target_age_range?: string;
  target_gender?: string;
  target_interests: string[];
  keywords: string[];
  campaign_goals?: string;
  // Optional: existing campaign ID to update instead of creating new
  campaign_id?: string;
}

/**
 * Converts a full ScoredShow (with enrichment data) to a serializable
 * ScoredShowRecord for JSONB storage and client-side rendering.
 */
function toScoredShowRecord(show: ScoredShow, budget: number, totalAudience: number): ScoredShowRecord {
  // Estimate CPM from audience tier (same logic as format-discovered-show.ts)
  const audienceSize = show.audienceSize;
  let estimatedCpm = 22; // default mid-range
  if (audienceSize >= 200000) estimatedCpm = 35;
  else if (audienceSize >= 50000) estimatedCpm = 28;
  else if (audienceSize >= 10000) estimatedCpm = 22;
  else estimatedCpm = 18;

  return {
    podcastId: show.podcastId,
    name: show.name,
    description: show.description,
    imageUrl: show.imageUrl,
    websiteUrl: show.websiteUrl,
    rssUrl: show.rssUrl,
    categories: show.categories,
    publisherName: show.publisherName,
    language: show.language,
    episodeCount: show.episodeCount,
    lastPostedAt: show.lastPostedAt,
    contactEmail: show.contactEmail,
    audienceSize: show.audienceSize,
    prsScore: show.prsScore,
    compositeScore: show.compositeScore,
    dimensionScores: show.dimensionScores,
    estimatedCpm,
    demographics: show.demographics
      ? {
          genderSkew: show.demographics.gender_skew,
          dominantAge: show.demographics.age,
          purchasingPower: show.demographics.purchasing_power,
        }
      : null,
    sponsorCount: show.sponsorHistory?.totalSponsors ?? 0,
    adEngagementRate: show.engagement?.avg_ad_engagement_rate ?? null,
    brandSafety: show.brandSafety
      ? {
          maxRiskLevel: show.brandSafety.aggregation.max_risk_level,
          recommendation: show.brandSafety.aggregation.most_common_recommendation,
        }
      : null,
    source: show.source,
  };
}

export async function POST(request: NextRequest) {
  let body: ScoreRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Campaign name is required" }, { status: 400 });
  }
  if (!body.budget_total || body.budget_total < 1000) {
    return NextResponse.json({ error: "Budget must be at least $1,000" }, { status: 400 });
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const brief: CampaignBrief = {
    brand_url: body.brand_url,
    target_age_range: body.target_age_range,
    target_gender: body.target_gender,
    target_interests: body.target_interests || [],
    keywords: body.keywords || [],
    campaign_goals: body.campaign_goals,
  };

  try {
    // Run the scoring engine
    console.log(`[campaign/score] Running scoring engine for "${body.name}"...`);
    const result = await scoreShows(brief, {
      maxCandidates: 150,
      maxResults: 100,
      minAudienceSize: 1000,
    });

    console.log(
      `[campaign/score] Scored ${result.meta.candidatesScored} shows in ${result.meta.durationMs}ms. ` +
      `Top score: ${result.shows[0]?.compositeScore ?? 0}`
    );

    // Convert to serializable records
    const totalAudience = result.shows.reduce((sum, s) => sum + s.audienceSize, 0);
    const scoredRecords = result.shows.map((s) => toScoredShowRecord(s, body.budget_total, totalAudience));

    // Create or update campaign
    let campaignId = body.campaign_id;

    if (!campaignId) {
      const campaign = await createCampaign({
        user_id: user.id,
        name: body.name,
        brief: brief as unknown as Record<string, unknown>,
        budget_total: body.budget_total,
        platforms: body.platforms,
        status: "draft",
        recommendations: [], // Legacy field — empty for Wave 6+ campaigns
      });

      if (!campaign) {
        return NextResponse.json({ error: "Failed to create campaign" }, { status: 500 });
      }
      campaignId = campaign.id;
    }

    // Save scored shows to campaign
    await updateCampaignScoredShows(campaignId, scoredRecords as unknown[], {
      candidatesFound: result.meta.candidatesFound,
      candidatesScored: result.meta.candidatesScored,
      sourceCounts: result.meta.sourceCounts,
      durationMs: result.meta.durationMs,
      errors: result.meta.errors,
    });

    return NextResponse.json({
      campaign_id: campaignId,
      shows_count: scoredRecords.length,
      top_score: scoredRecords[0]?.compositeScore ?? 0,
      duration_ms: result.meta.durationMs,
    });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[campaign/score] Error:", errMessage);
    return NextResponse.json(
      { error: `Scoring failed: ${errMessage}` },
      { status: 500 }
    );
  }
}
