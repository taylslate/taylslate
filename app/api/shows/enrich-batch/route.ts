// ============================================================
// POST /api/shows/enrich-batch
// Batch enrichment: enriches all of an agent's shows that have
// stale or missing API data (last_api_refresh null or >7 days).
//
// Rate limits:
//   - Podscan: 6 seconds between requests (trial: 10 req/min)
//   - YouTube: 1 second between requests
// ============================================================

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getShowsNeedingEnrichment,
  updateShowEnrichment,
} from "@/lib/data/queries";
import {
  getPodscanClientSafe,
  getPodcastDetails,
} from "@/lib/enrichment/podscan";
import { getYouTubeClientSafe } from "@/lib/enrichment/youtube";

const PODSCAN_DELAY_MS = 6000;
const YOUTUBE_DELAY_MS = 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST() {
  try {
    // ---- Auth ----
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ---- Get shows needing enrichment ----
    const shows = await getShowsNeedingEnrichment(user.id);

    if (shows.length === 0) {
      return NextResponse.json({
        message: "All shows are up to date",
        enriched: 0,
        skipped: 0,
        errors: 0,
      });
    }

    const podscan = getPodscanClientSafe();
    const youtube = getYouTubeClientSafe();

    let enriched = 0;
    let skipped = 0;
    let errorCount = 0;
    const details: { show_id: string; name: string; status: string; source?: string }[] = [];

    for (const show of shows) {
      try {
        if (show.platform === "podcast") {
          if (!podscan) {
            skipped++;
            details.push({ show_id: show.id, name: show.name, status: "skipped", source: "no_podscan_key" });
            continue;
          }

          const { podcast, sponsors, hosts } = await getPodcastDetails(podscan, show.name);

          if (!podcast) {
            skipped++;
            details.push({ show_id: show.id, name: show.name, status: "not_found" });
            // Still update last_api_refresh so we don't retry immediately
            await updateShowEnrichment(show.id, { data_sources: [] });
            await delay(PODSCAN_DELAY_MS);
            continue;
          }

          const enrichmentData: Record<string, unknown> = {};
          const audienceSize = typeof podcast.reach === "object" ? podcast.reach?.audience_size : podcast.reach;
          if (audienceSize && audienceSize > 0) enrichmentData.audience_size = audienceSize;
          if (podcast.podcast_categories?.length) enrichmentData.categories = podcast.podcast_categories;
          if (podcast.podcast_description) enrichmentData.description = podcast.podcast_description;
          if (podcast.podcast_image_url) enrichmentData.image_url = podcast.podcast_image_url;
          if (podcast.rss_url) enrichmentData.rss_url = podcast.rss_url;
          if (sponsors.length > 0) enrichmentData.current_sponsors = sponsors.map((s) => s.name);
          if (hosts[0]?.name) enrichmentData.contact_name = hosts[0].name;
          if (podcast.publisher_name) enrichmentData.network = podcast.publisher_name;
          enrichmentData.data_sources = ["podscan"];

          await updateShowEnrichment(show.id, enrichmentData);
          enriched++;
          details.push({ show_id: show.id, name: show.name, status: "enriched", source: "podscan" });

          await delay(PODSCAN_DELAY_MS);
        } else if (show.platform === "youtube") {
          if (!youtube) {
            skipped++;
            details.push({ show_id: show.id, name: show.name, status: "skipped", source: "no_youtube_key" });
            continue;
          }

          let channelId = show.youtube_channel_id;
          if (!channelId) {
            const results = await youtube.searchChannels(show.name, 1);
            if (results.length === 0) {
              skipped++;
              details.push({ show_id: show.id, name: show.name, status: "not_found" });
              await updateShowEnrichment(show.id, { data_sources: [] });
              await delay(YOUTUBE_DELAY_MS);
              continue;
            }
            channelId = results[0].channelId;
          }

          const [channelDetails, recentStats] = await Promise.all([
            youtube.getChannelDetails(channelId),
            youtube.getRecentVideoStats(channelId, 10),
          ]);

          if (!channelDetails) {
            skipped++;
            details.push({ show_id: show.id, name: show.name, status: "channel_error" });
            await delay(YOUTUBE_DELAY_MS);
            continue;
          }

          const enrichmentData: Record<string, unknown> = {
            youtube_channel_id: channelId,
            data_sources: ["youtube_api"],
          };
          if (recentStats.averageViews > 0) enrichmentData.audience_size = recentStats.averageViews;
          if (channelDetails.description) enrichmentData.description = channelDetails.description;
          if (channelDetails.thumbnailUrl) enrichmentData.image_url = channelDetails.thumbnailUrl;
          if (channelDetails.topicCategories.length > 0) enrichmentData.categories = channelDetails.topicCategories;

          await updateShowEnrichment(show.id, enrichmentData);
          enriched++;
          details.push({ show_id: show.id, name: show.name, status: "enriched", source: "youtube_api" });

          await delay(YOUTUBE_DELAY_MS);
        }
      } catch (err) {
        errorCount++;
        const message = err instanceof Error ? err.message : "Unknown error";
        details.push({ show_id: show.id, name: show.name, status: `error: ${message}` });
        console.error(`[enrich-batch] Error enriching ${show.name}:`, err);
      }
    }

    return NextResponse.json({
      message: `Batch enrichment complete`,
      enriched,
      skipped,
      errors: errorCount,
      total: shows.length,
      details,
    });
  } catch (err) {
    console.error("[enrich-batch] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
