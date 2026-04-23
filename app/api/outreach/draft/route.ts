// POST /api/outreach/draft
// Returns a Claude-generated pitch body for a single show, prefilled into the
// composer modal. Brand may edit before sending. Falls back to a deterministic
// template if Anthropic is unavailable so the composer always opens.

import { NextRequest, NextResponse } from "next/server";
import {
  fallbackPitch,
  generatePitchBody,
} from "@/lib/prompts/outreach-pitch";
import {
  getAuthenticatedUser,
  getBrandProfileByUserId,
} from "@/lib/data/queries";
import type { OutreachPlacement } from "@/lib/data/types";

interface DraftBody {
  show: {
    show_name: string;
    categories?: string[];
    audience_size?: number | null;
    existing_sponsors?: string[];
  };
  proposed: {
    cpm: number;
    episode_count: number;
    placement: OutreachPlacement;
  };
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: DraftBody;
  try {
    body = (await request.json()) as DraftBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.show?.show_name) {
    return NextResponse.json({ error: "show.show_name required" }, { status: 400 });
  }

  const brandProfile = await getBrandProfileByUserId(user.id);
  const brandName =
    brandProfile?.brand_identity?.split(/[.,—–-]/)[0]?.trim() ||
    brandProfile?.brand_website?.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] ||
    "Your brand";

  const input = {
    brand_name: brandName,
    brand_url: brandProfile?.brand_website ?? null,
    brand_profile: brandProfile,
    show_name: body.show.show_name,
    show_categories: body.show.categories,
    show_audience_size: body.show.audience_size ?? null,
    show_existing_sponsors: body.show.existing_sponsors,
    proposed_cpm: body.proposed.cpm,
    proposed_episode_count: body.proposed.episode_count,
    proposed_placement: body.proposed.placement,
  };

  // generatePitchBody catches its own errors and falls back; this try/catch is
  // a final guard against unexpected throws.
  let pitch: string;
  try {
    pitch = await generatePitchBody(input);
  } catch (err) {
    console.error("[outreach/draft] failed:", err);
    pitch = fallbackPitch(input);
  }

  return NextResponse.json({ pitch_body: pitch, brand_name: brandName });
}
