import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { Campaign, ShowRecommendation, YouTubeRecommendation, Platform } from "@/lib/data/types";
import {
  OUTREACH_EMAIL_SYSTEM_PROMPT,
  buildOutreachUserPrompt,
} from "@/lib/prompts/outreach-email";

export async function POST(request: NextRequest) {
  let body: { campaign: Campaign };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { campaign } = body;
  if (!campaign) {
    return NextResponse.json({ error: "Campaign data is required" }, { status: 400 });
  }

  const recommendations = campaign.recommendations ?? [];
  const youtubeRecs = campaign.youtube_recommendations ?? [];

  if (recommendations.length === 0 && youtubeRecs.length === 0) {
    return NextResponse.json(
      { error: "Campaign has no recommendations. Generate a campaign plan first." },
      { status: 400 }
    );
  }

  const userPrompt = buildOutreachUserPrompt(campaign, recommendations, youtubeRecs);

  let client: Anthropic;
  try {
    client = new Anthropic();
  } catch {
    return NextResponse.json(
      {
        error: "AI outreach generation is not configured. Please add an ANTHROPIC_API_KEY environment variable.",
        code: "NO_API_KEY",
      },
      { status: 503 }
    );
  }

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: OUTREACH_EMAIL_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json({ error: "No response from AI" }, { status: 500 });
    }

    let parsed: Array<{
      show_id: string;
      subject: string;
      body: string;
    }>;

    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse AI response. Please try again." },
        { status: 422 }
      );
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return NextResponse.json(
        { error: "AI returned no email drafts. Please try again." },
        { status: 422 }
      );
    }

    // Build lookup from all recommendations
    const recLookup = new Map<string, { show_name: string; platform: Platform; contact_email: string }>();
    for (const rec of recommendations) {
      recLookup.set(rec.show_id, {
        show_name: rec.show_name,
        platform: rec.platform,
        contact_email: rec.contact_email,
      });
    }
    for (const rec of youtubeRecs) {
      recLookup.set(rec.show_id, {
        show_name: rec.show_name,
        platform: rec.platform,
        contact_email: rec.contact_email,
      });
    }

    // Enrich drafts with show metadata
    const drafts = parsed
      .filter((draft) => recLookup.has(draft.show_id))
      .map((draft) => {
        const show = recLookup.get(draft.show_id)!;
        return {
          show_id: draft.show_id,
          show_name: show.show_name,
          platform: show.platform,
          contact_email: show.contact_email,
          subject: draft.subject,
          body: draft.body,
        };
      });

    return NextResponse.json({ drafts });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Outreach generation failed: ${errMessage}` },
      { status: 500 }
    );
  }
}
