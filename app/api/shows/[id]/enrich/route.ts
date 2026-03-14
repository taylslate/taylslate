// ============================================================
// POST /api/shows/[id]/enrich
// Enriches a show record with data from external APIs:
//   - Podcasts: Podscan (primary), Rephonic (fallback)
//   - YouTube: YouTube Data API v3
//
// Agent-provided CPMs, rate_card, and audience_size (if set)
// ALWAYS take precedence over API data. Only empty/missing fields
// are filled in from external APIs.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateShowEnrichment } from "@/lib/data/queries";
import {
  getPodscanClientSafe,
  getPodcastDetails,
  PodscanError,
} from "@/lib/enrichment/podscan";
import { getYouTubeClientSafe } from "@/lib/enrichment/youtube";
import { getRephonicClientSafe } from "@/lib/enrichment/rephonic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    // ---- Auth ----
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    // ---- Load existing show ----
    const { data: show, error: showError } = await supabase
      .from("shows")
      .select("*")
      .eq("id", id)
      .single();

    if (showError || !show) {
      return NextResponse.json({ error: "Show not found" }, { status: 404 });
    }

    // ---- Route by platform ----
    if (show.platform === "youtube") {
      return enrichYouTube(show, id);
    } else {
      return enrichPodcast(show, id);
    }
  } catch (err) {
    console.error("[enrich] Unexpected error:", err);
    if (err instanceof PodscanError) {
      return NextResponse.json(
        { error: `Podscan API error: ${err.message}` },
        { status: err.status >= 500 ? 502 : err.status }
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---- Podcast Enrichment (Podscan → Rephonic fallback) ----

async function enrichPodcast(
  show: Record<string, unknown>,
  showId: string
) {
  // Try Podscan first
  const podscan = getPodscanClientSafe();
  if (podscan) {
    const { podcast, sponsors, hosts } = await getPodcastDetails(
      podscan,
      show.name as string
    );

    if (podcast) {
      const enrichmentData: Record<string, unknown> = {};

      if (podcast.reach && podcast.reach > 0) {
        enrichmentData.audience_size = podcast.reach;
      }
      if (podcast.podcast_categories?.length) {
        enrichmentData.categories = podcast.podcast_categories;
      }
      if (podcast.podcast_description) {
        enrichmentData.description = podcast.podcast_description;
      }
      if (podcast.podcast_image_url) {
        enrichmentData.image_url = podcast.podcast_image_url;
      }
      if (podcast.rss_url) {
        enrichmentData.rss_url = podcast.rss_url;
      }
      if (sponsors.length > 0) {
        enrichmentData.current_sponsors = sponsors.map((s) => s.name);
      }
      if (hosts[0]?.name) {
        enrichmentData.contact_name = hosts[0].name;
      }
      if (podcast.publisher_name) {
        // Set network only if publisher isn't a host name
        const hostNames = hosts.map((h) => h.name.toLowerCase());
        const pubLower = podcast.publisher_name.toLowerCase();
        const isNetwork = !hostNames.some(
          (h) => pubLower.includes(h) || h.includes(pubLower)
        );
        if (isNetwork) {
          enrichmentData.network = podcast.publisher_name;
        }
      }
      if (podcast.episode_count && podcast.episode_count > 0) {
        enrichmentData.tags = [`${podcast.episode_count}+ episodes`];
      }

      enrichmentData.data_sources = ["podscan"];

      const enrichedShow = await updateShowEnrichment(showId, enrichmentData);

      return NextResponse.json({
        message: "Show enriched successfully via Podscan",
        show_id: showId,
        source: "podscan",
        podscan_id: podcast.podcast_id,
        sponsors_found: sponsors.length,
        show: enrichedShow,
      });
    }
  }

  // Fallback: try Rephonic
  const rephonic = getRephonicClientSafe();
  if (rephonic) {
    const podcast = await rephonic.getPodcastDetails(show.name as string);
    if (podcast) {
      // Rephonic stub returns null for now
      return NextResponse.json({
        message: "Rephonic enrichment not yet implemented",
        show_id: showId,
        source: "rephonic",
      });
    }
  }

  return NextResponse.json(
    {
      error: "Could not enrich podcast — no API returned results",
      show_name: show.name,
      apis_tried: [
        podscan ? "podscan" : null,
        rephonic ? "rephonic" : null,
      ].filter(Boolean),
    },
    { status: 404 }
  );
}

// ---- YouTube Enrichment ----

async function enrichYouTube(
  show: Record<string, unknown>,
  showId: string
) {
  const youtube = getYouTubeClientSafe();
  if (!youtube) {
    return NextResponse.json(
      { error: "YouTube API key not configured" },
      { status: 503 }
    );
  }

  // Determine channel ID — use stored one or search by name
  let channelId = show.youtube_channel_id as string | undefined;

  if (!channelId) {
    const results = await youtube.searchChannels(show.name as string, 3);
    if (results.length === 0) {
      return NextResponse.json(
        { error: "YouTube channel not found", show_name: show.name },
        { status: 404 }
      );
    }
    // Use the first result
    channelId = results[0].channelId;
  }

  // Fetch channel details and recent video stats in parallel
  const [channelDetails, recentStats] = await Promise.all([
    youtube.getChannelDetails(channelId),
    youtube.getRecentVideoStats(channelId, 10),
  ]);

  if (!channelDetails) {
    return NextResponse.json(
      { error: "Could not fetch YouTube channel details" },
      { status: 404 }
    );
  }

  const enrichmentData: Record<string, unknown> = {
    youtube_channel_id: channelId,
    audience_size: recentStats.averageViews > 0 ? recentStats.averageViews : undefined,
    description: channelDetails.description || undefined,
    image_url: channelDetails.thumbnailUrl || undefined,
    categories: channelDetails.topicCategories.length > 0 ? channelDetails.topicCategories : undefined,
    tags: channelDetails.country ? [`Country: ${channelDetails.country}`] : undefined,
    data_sources: ["youtube_api"],
  };

  // Remove undefined values
  for (const key of Object.keys(enrichmentData)) {
    if (enrichmentData[key] === undefined) delete enrichmentData[key];
  }

  const enrichedShow = await updateShowEnrichment(showId, enrichmentData);

  return NextResponse.json({
    message: "Show enriched successfully via YouTube API",
    show_id: showId,
    source: "youtube_api",
    channel_id: channelId,
    subscriber_count: channelDetails.subscriberCount,
    avg_views: recentStats.averageViews,
    videos_analyzed: recentStats.totalVideosAnalyzed,
    show: enrichedShow,
  });
}
