import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser, getAllShows, createCampaign } from "@/lib/data/queries";
import type { Campaign, Show, ShowRecommendation, YouTubeRecommendation, ExpansionShow, Platform } from "@/lib/data/types";
import {
  CAMPAIGN_PLANNING_SYSTEM_PROMPT,
  buildCampaignUserPrompt,
  prepareShowsForPrompt,
} from "@/lib/prompts/campaign-planning";
import { discoverShows } from "@/lib/discovery";

interface GenerateRequest {
  name: string;
  brand_url?: string;
  budget_total: number;
  platforms: string[];
  target_age_range?: string;
  target_gender?: string;
  target_interests: string[];
  keywords: string[];
  campaign_goals?: string;
}

export async function POST(request: NextRequest) {
  // Parse request body
  let body: GenerateRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Validate required fields
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Campaign name is required" }, { status: 400 });
  }
  if (!body.platforms || body.platforms.length === 0) {
    return NextResponse.json({ error: "At least one platform is required" }, { status: 400 });
  }
  if (!body.budget_total || body.budget_total < 1000) {
    return NextResponse.json({ error: "Budget must be at least $1,000" }, { status: 400 });
  }

  // Get authenticated user
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch database shows + discover from Podscan/YouTube in parallel
  const validPlatforms = body.platforms as Platform[];

  const [dbShows, discoveryResult] = await Promise.all([
    getAllShows(),
    discoverShows({
      target_interests: body.target_interests || [],
      keywords: body.keywords || [],
      target_age_range: body.target_age_range,
      target_gender: body.target_gender,
      campaign_goals: body.campaign_goals,
      platforms: body.platforms,
    }).catch((err) => {
      console.warn("[campaign/generate] Discovery failed, using DB only:", err);
      return { discovered: [] as Show[], sources: { podscan: 0, youtube: 0 }, errors: [] as string[] };
    }),
  ]);

  // Merge: DB shows take precedence over discovered duplicates
  const dbShowNames = new Set(dbShows.map((s) => s.name.toLowerCase()));
  const dbRssUrls = new Set(dbShows.filter((s) => s.rss_url).map((s) => s.rss_url!));
  const dbYoutubeIds = new Set(dbShows.filter((s) => s.youtube_channel_id).map((s) => s.youtube_channel_id!));

  const uniqueDiscovered = discoveryResult.discovered.filter((d) => {
    if (dbShowNames.has(d.name.toLowerCase())) return false;
    if (d.rss_url && dbRssUrls.has(d.rss_url)) return false;
    if (d.youtube_channel_id && dbYoutubeIds.has(d.youtube_channel_id)) return false;
    return true;
  });

  // Cap at 100 total shows for larger budgets. Prioritize: DB shows first,
  // then discovered shows sorted by audience size.
  const sortedDiscovered = uniqueDiscovered.sort((a, b) => b.audience_size - a.audience_size);
  const maxDiscovered = Math.max(0, 100 - dbShows.length);
  const allShows = [...dbShows, ...sortedDiscovered.slice(0, maxDiscovered)];

  if (allShows.length === 0) {
    return NextResponse.json({ error: "No shows available. Please add shows or check API keys." }, { status: 500 });
  }

  console.log(
    `[campaign/generate] ${dbShows.length} DB shows + ${uniqueDiscovered.length} discovered ` +
    `(${discoveryResult.sources.podscan} Podscan, ${discoveryResult.sources.youtube} YouTube). ` +
    `Sending ${allShows.length} total to Claude.`
  );

  // Build prompts
  const strippedShows = prepareShowsForPrompt(allShows);
  const showsJson = JSON.stringify(strippedShows, null, 2);

  const brief = {
    brand_url: body.brand_url,
    target_age_range: body.target_age_range,
    target_gender: body.target_gender,
    target_interests: body.target_interests || [],
    keywords: body.keywords || [],
    campaign_goals: body.campaign_goals,
  };

  const userPrompt = buildCampaignUserPrompt(brief, body.budget_total, body.platforms, showsJson);

  // Instantiate Anthropic client
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  console.log("[campaign/generate] ANTHROPIC_API_KEY present:", !!anthropicKey, "length:", anthropicKey?.length);
  if (!anthropicKey) {
    return NextResponse.json(
      {
        error: "AI campaign planning is not configured. Please add an ANTHROPIC_API_KEY environment variable.",
        code: "NO_API_KEY",
      },
      { status: 503 }
    );
  }
  const client = new Anthropic({ apiKey: anthropicKey });

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: CAMPAIGN_PLANNING_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    // Extract text response
    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json(
        { error: "No response from AI" },
        { status: 500 }
      );
    }

    // Parse JSON object from response (recommendations + youtube_recommendations + expansion_opportunities)
    let parsed: {
      recommendations: Array<{
        show_id: string;
        fit_score: number;
        estimated_cpm: number;
        cost_per_episode?: number;
        allocated_budget: number;
        num_episodes: number;
        placement: string;
        estimated_impressions: number;
        overlap_flag: boolean;
        overlap_with: string[];
      }>;
      youtube_recommendations?: Array<{
        show_id: string;
        fit_score: number;
        flat_fee_per_video: number;
        allocated_budget: number;
        num_videos: number;
        estimated_views: number;
        overlap_flag: boolean;
        overlap_with: string[];
      }>;
      expansion_opportunities?: Array<{
        show_id: string;
        platform: string;
        fit_score: number;
        estimated_cpm?: number | null;
        flat_fee?: number | null;
        reason: string;
      }>;
    };

    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse AI response. Please try again." },
        { status: 422 }
      );
    }

    const rawRecommendations = parsed.recommendations ?? [];
    const rawYouTube = parsed.youtube_recommendations ?? [];

    if (rawRecommendations.length === 0 && rawYouTube.length === 0) {
      return NextResponse.json(
        { error: "AI returned no recommendations. Please try again." },
        { status: 422 }
      );
    }

    // Build show lookup for cross-referencing (includes discovered shows)
    const showLookup = new Map(allShows.map((s) => [s.id, s]));

    // Cross-reference podcast recommendations with real show data
    // Server-side enforcement: recalculate allocated_budget and impressions from
    // actual show data to guarantee correct CPM math regardless of AI output.
    const recommendations: ShowRecommendation[] = rawRecommendations
      .filter((rec) => showLookup.has(rec.show_id))
      .map((rec) => {
        const show = showLookup.get(rec.show_id)!;
        const placement = (["pre-roll", "mid-roll", "post-roll"].includes(rec.placement)
          ? rec.placement
          : "mid-roll") as ShowRecommendation["placement"];
        const numEpisodes = Math.max(1, Math.round(rec.num_episodes));

        // Use the rate card CPM for the chosen placement, falling back to the AI's estimate
        const cpmFromCard =
          placement === "pre-roll" ? show.rate_card.preroll_cpm :
          placement === "post-roll" ? show.rate_card.postroll_cpm :
          show.rate_card.midroll_cpm;
        const estimatedCpm = cpmFromCard ?? rec.estimated_cpm;

        // Correct math: (downloads / 1000) x CPM x episodes
        const costPerEpisode = (show.audience_size / 1000) * estimatedCpm;
        const allocatedBudget = Math.round(costPerEpisode * numEpisodes);
        const estimatedImpressions = show.audience_size * numEpisodes;

        return {
          show_id: show.id,
          show_name: show.name,
          platform: show.platform,
          network: show.network,
          image_url: show.image_url,
          categories: show.categories,
          current_sponsors: show.current_sponsors,
          audience_size: show.audience_size,
          contact_email: show.contact.email,
          fit_score: Math.max(0, Math.min(100, Math.round(rec.fit_score))),
          estimated_cpm: estimatedCpm,
          allocated_budget: allocatedBudget,
          num_episodes: numEpisodes,
          placement,
          estimated_impressions: estimatedImpressions,
          overlap_flag: rec.overlap_flag ?? false,
          overlap_with: rec.overlap_with ?? [],
        };
      });

    // Cross-reference YouTube recommendations with real show data
    const youtubeRecommendations: YouTubeRecommendation[] = rawYouTube
      .filter((rec) => showLookup.has(rec.show_id))
      .map((rec) => {
        const show = showLookup.get(rec.show_id)!;
        const numVideos = Math.max(1, Math.round(rec.num_videos));

        // Use rate card flat rate if available, otherwise AI's estimate
        const flatFee = show.rate_card.flat_rate ?? rec.flat_fee_per_video;
        const allocatedBudget = Math.round(flatFee * numVideos);
        const estimatedViews = show.audience_size * numVideos;

        return {
          show_id: show.id,
          show_name: show.name,
          platform: "youtube" as const,
          network: show.network,
          image_url: show.image_url,
          categories: show.categories,
          current_sponsors: show.current_sponsors,
          audience_size: show.audience_size,
          contact_email: show.contact.email,
          fit_score: Math.max(0, Math.min(100, Math.round(rec.fit_score))),
          flat_fee_per_video: flatFee,
          allocated_budget: allocatedBudget,
          num_videos: numVideos,
          estimated_views: estimatedViews,
          overlap_flag: rec.overlap_flag ?? false,
          overlap_with: rec.overlap_with ?? [],
        };
      });

    if (recommendations.length === 0 && youtubeRecommendations.length === 0) {
      return NextResponse.json(
        { error: "AI recommended shows that don't exist in our database. Please try again." },
        { status: 422 }
      );
    }

    // Cross-reference expansion opportunities with real show data
    const recommendedIds = new Set([
      ...recommendations.map((r) => r.show_id),
      ...youtubeRecommendations.map((r) => r.show_id),
    ]);
    const expansionOpportunities: ExpansionShow[] = (parsed.expansion_opportunities ?? [])
      .filter((exp) => showLookup.has(exp.show_id) && !recommendedIds.has(exp.show_id))
      .map((exp) => {
        const show = showLookup.get(exp.show_id)!;
        return {
          show_id: show.id,
          show_name: show.name,
          platform: show.platform,
          network: show.network,
          image_url: show.image_url,
          categories: show.categories,
          current_sponsors: show.current_sponsors,
          audience_size: show.audience_size,
          contact_email: show.contact.email,
          fit_score: Math.max(0, Math.min(100, Math.round(exp.fit_score))),
          estimated_cpm: show.platform === "podcast" ? (exp.estimated_cpm ?? undefined) : undefined,
          flat_fee: show.platform === "youtube" ? (exp.flat_fee ?? show.rate_card.flat_rate) : undefined,
          reason: exp.reason,
        };
      });

    // Discovered shows stay ephemeral — they live in the campaign JSONB only.
    // Shows are only persisted to DB when a brand creates deals (handled in /api/campaigns/deals).
    // Agent-rostered shows are already in DB and use real UUIDs.

    // Save campaign to Supabase
    const savedCampaign = await createCampaign({
      user_id: user.id,
      name: body.name,
      brief: brief as Record<string, unknown>,
      budget_total: body.budget_total,
      platforms: body.platforms,
      status: "planned",
      recommendations: recommendations as unknown[],
      youtube_recommendations: youtubeRecommendations as unknown[],
      expansion_opportunities: expansionOpportunities as unknown[],
    });

    if (savedCampaign) {
      // Return saved campaign with real Supabase ID
      return NextResponse.json({
        campaign: {
          ...savedCampaign,
          recommendations,
          youtube_recommendations: youtubeRecommendations.length > 0 ? youtubeRecommendations : undefined,
          expansion_opportunities: expansionOpportunities.length > 0 ? expansionOpportunities : undefined,
        },
      });
    }

    // Fallback: return campaign without DB persistence
    const now = new Date().toISOString();
    const campaign: Campaign = {
      id: `campaign-gen-${Date.now()}`,
      user_id: user.id,
      name: body.name,
      brief,
      budget_total: body.budget_total,
      platforms: validPlatforms,
      status: "planned",
      recommendations,
      youtube_recommendations: youtubeRecommendations.length > 0 ? youtubeRecommendations : undefined,
      expansion_opportunities: expansionOpportunities.length > 0 ? expansionOpportunities : undefined,
      created_at: now,
      updated_at: now,
    };

    return NextResponse.json({ campaign });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Campaign generation failed: ${errMessage}` },
      { status: 500 }
    );
  }
}
