import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { shows } from "@/lib/data/seed";
import type { Campaign, ShowRecommendation, ExpansionShow, Platform } from "@/lib/data/types";
import {
  CAMPAIGN_PLANNING_SYSTEM_PROMPT,
  buildCampaignUserPrompt,
  prepareShowsForPrompt,
} from "@/lib/prompts/campaign-planning";

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

  // Check API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "AI campaign planning is not configured. Please add an ANTHROPIC_API_KEY environment variable.",
        code: "NO_API_KEY",
      },
      { status: 503 }
    );
  }

  // Send ALL shows to Claude — the system prompt handles platform prioritization
  // based on the user's selected platforms in the brief
  const validPlatforms = body.platforms as Platform[];

  // Build prompts — full show database so Claude can cross-reference and make informed picks
  const strippedShows = prepareShowsForPrompt(shows);
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

  // Call Claude
  const client = new Anthropic({ apiKey });

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

    // Parse JSON object from response (recommendations + expansion_opportunities)
    let parsed: {
      recommendations: Array<{
        show_id: string;
        fit_score: number;
        estimated_cpm: number;
        allocated_budget: number;
        num_episodes: number;
        placement: string;
        estimated_impressions: number;
        overlap_flag: boolean;
        overlap_with: string[];
      }>;
      expansion_opportunities?: Array<{
        show_id: string;
        fit_score: number;
        estimated_cpm: number;
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

    const rawRecommendations = parsed.recommendations;
    if (!Array.isArray(rawRecommendations) || rawRecommendations.length === 0) {
      return NextResponse.json(
        { error: "AI returned no recommendations. Please try again." },
        { status: 422 }
      );
    }

    // Build show lookup for cross-referencing
    const showLookup = new Map(shows.map((s) => [s.id, s]));

    // Cross-reference recommendations with real show data
    const recommendations: ShowRecommendation[] = rawRecommendations
      .filter((rec) => showLookup.has(rec.show_id))
      .map((rec) => {
        const show = showLookup.get(rec.show_id)!;
        return {
          show_id: show.id,
          show_name: show.name,
          platform: show.platform,
          network: show.network,
          categories: show.categories,
          current_sponsors: show.current_sponsors,
          audience_size: show.audience_size,
          contact_email: show.contact.email,
          // Trust Claude's analytical outputs
          fit_score: Math.max(0, Math.min(100, Math.round(rec.fit_score))),
          estimated_cpm: rec.estimated_cpm,
          allocated_budget: rec.allocated_budget,
          num_episodes: Math.max(1, Math.round(rec.num_episodes)),
          placement: (["pre-roll", "mid-roll", "post-roll"].includes(rec.placement)
            ? rec.placement
            : "mid-roll") as ShowRecommendation["placement"],
          estimated_impressions: rec.estimated_impressions,
          overlap_flag: rec.overlap_flag ?? false,
          overlap_with: rec.overlap_with ?? [],
        };
      });

    if (recommendations.length === 0) {
      return NextResponse.json(
        { error: "AI recommended shows that don't exist in our database. Please try again." },
        { status: 422 }
      );
    }

    // Cross-reference expansion opportunities with real show data
    const recommendedIds = new Set(recommendations.map((r) => r.show_id));
    const expansionOpportunities: ExpansionShow[] = (parsed.expansion_opportunities ?? [])
      .filter((exp) => showLookup.has(exp.show_id) && !recommendedIds.has(exp.show_id))
      .map((exp) => {
        const show = showLookup.get(exp.show_id)!;
        return {
          show_id: show.id,
          show_name: show.name,
          platform: show.platform,
          network: show.network,
          categories: show.categories,
          current_sponsors: show.current_sponsors,
          audience_size: show.audience_size,
          contact_email: show.contact.email,
          fit_score: Math.max(0, Math.min(100, Math.round(exp.fit_score))),
          estimated_cpm: exp.estimated_cpm,
          reason: exp.reason,
        };
      });

    // Build complete Campaign object
    const now = new Date().toISOString();
    const campaign: Campaign = {
      id: `campaign-gen-${Date.now()}`,
      user_id: "user-brand-001",
      name: body.name,
      brief,
      budget_total: body.budget_total,
      platforms: validPlatforms,
      status: "planned",
      recommendations,
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
