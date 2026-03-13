// ============================================================
// POST /api/shows/[id]/enrich
// Enriches a show record with data from Podscan:
//   - Audience size / reach
//   - Categories
//   - Sponsor history (current + past)
//   - Contact info (host names, publisher)
//   - Active/inactive status
//
// Agent-provided CPMs ALWAYS take precedence over API data.
// Only empty or missing fields are filled in from Podscan.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getPodscanClient,
  PodscanPodcast,
  PodscanEntity,
  PodscanError,
} from "@/lib/enrichment/podscan";

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

    // ---- Initialize Podscan ----
    let podscan;
    try {
      podscan = getPodscanClient();
    } catch {
      return NextResponse.json(
        { error: "Podscan API key not configured" },
        { status: 503 }
      );
    }

    // ---- Find the podcast in Podscan ----
    let podscanPodcast: PodscanPodcast | null = null;

    try {
      podscanPodcast = await podscan.findPodcastByName(show.name);
    } catch (err) {
      if (err instanceof PodscanError && err.status === 429) {
        return NextResponse.json(
          { error: "Podscan rate limit exceeded. Try again later." },
          { status: 429 }
        );
      }
      // Non-fatal: continue with what we have
    }

    if (!podscanPodcast) {
      return NextResponse.json(
        {
          error: "Podcast not found in Podscan",
          show_name: show.name,
          suggestion:
            "Try updating the show name to match its listing on Apple Podcasts or Spotify.",
        },
        { status: 404 }
      );
    }

    const podscanId = podscanPodcast.podcast_id;

    // ---- Gather enrichment data in parallel ----
    const [sponsorResult, contactResult] = await Promise.allSettled([
      podscan.getSponsorsForPodcast(podscanId),
      podscan.getShowContacts(podscanId),
    ]);

    const sponsors: PodscanEntity[] =
      sponsorResult.status === "fulfilled" ? sponsorResult.value : [];
    const contacts =
      contactResult.status === "fulfilled"
        ? contactResult.value
        : { hosts: [], producers: [] };

    // ---- Build the update payload ----
    // Rule: agent-provided data takes precedence. Only fill empty fields.
    const updates: Record<string, unknown> = {};

    // Audience size — only update if our record has 0 or no value
    if (
      (!show.audience_size || show.audience_size === 0) &&
      podscanPodcast.reach &&
      podscanPodcast.reach > 0
    ) {
      updates.audience_size = podscanPodcast.reach;
    }

    // Categories — merge, don't replace
    if (podscanPodcast.podcast_categories?.length) {
      const existing = new Set(
        (show.categories ?? []).map((c: string) => c.toLowerCase())
      );
      const newCats = podscanPodcast.podcast_categories.filter(
        (c) => !existing.has(c.toLowerCase())
      );
      if (newCats.length > 0) {
        updates.categories = [...(show.categories ?? []), ...newCats];
      }
    }

    // Description — only if empty
    if (
      !show.description &&
      podscanPodcast.podcast_description
    ) {
      updates.description = podscanPodcast.podcast_description;
    }

    // Image — only if empty
    if (!show.image_url && podscanPodcast.podcast_image_url) {
      updates.image_url = podscanPodcast.podcast_image_url;
    }

    // RSS URL — only if empty
    if (!show.rss_url && podscanPodcast.rss_url) {
      updates.rss_url = podscanPodcast.rss_url;
    }

    // Sponsors — merge current + past, deduplicating
    if (sponsors.length > 0) {
      const sponsorNames = sponsors.map((s) => s.name);

      // Current sponsors: merge with existing
      const existingCurrent = new Set(
        (show.current_sponsors ?? []).map((s: string) => s.toLowerCase())
      );
      const newCurrentSponsors = sponsorNames.filter(
        (s) => !existingCurrent.has(s.toLowerCase())
      );
      if (newCurrentSponsors.length > 0) {
        updates.current_sponsors = [
          ...(show.current_sponsors ?? []),
          ...newCurrentSponsors,
        ];
      }

      // Also add to past_sponsors for historical record
      const existingPast = new Set(
        (show.past_sponsors ?? []).map((s: string) => s.toLowerCase())
      );
      const allKnown = new Set([
        ...existingCurrent,
        ...(show.past_sponsors ?? []).map((s: string) => s.toLowerCase()),
      ]);
      const newPastSponsors = sponsorNames.filter(
        (s) => !allKnown.has(s.toLowerCase())
      );
      if (newPastSponsors.length > 0) {
        updates.past_sponsors = [
          ...(show.past_sponsors ?? []),
          ...newPastSponsors,
        ];
      }
    }

    // Contact info — only fill if current contact is empty/generic
    const currentContactEmpty =
      !show.contact_name || show.contact_name === "" || show.contact_name === "Unknown";
    if (currentContactEmpty) {
      // Use host name if available
      const primaryHost = contacts.hosts[0];
      if (primaryHost?.name) {
        updates.contact_name = primaryHost.name;
      } else if (podscanPodcast.publisher_name) {
        updates.contact_name = podscanPodcast.publisher_name;
      }
    }

    // Network — only if empty, use publisher_name as proxy
    if (!show.network && podscanPodcast.publisher_name) {
      // Only set network if publisher_name looks like a network (not the host's name)
      const publisherLower = (podscanPodcast.publisher_name ?? "").toLowerCase();
      const hostNames = contacts.hosts.map((h) => h.name.toLowerCase());
      const isLikelyNetwork = !hostNames.some(
        (h) => publisherLower.includes(h) || h.includes(publisherLower)
      );
      if (isLikelyNetwork) {
        updates.network = podscanPodcast.publisher_name;
      }
    }

    // Episode count — store in tags for reference
    if (podscanPodcast.episode_count && podscanPodcast.episode_count > 0) {
      const tag = `${podscanPodcast.episode_count}+ episodes`;
      const existingTags = (show.tags ?? []) as string[];
      const hasEpTag = existingTags.some((t: string) => t.includes("episodes"));
      if (!hasEpTag) {
        updates.tags = [...existingTags, tag];
      }
    }

    // Data sources — track enrichment provenance
    const existingSources = (show.data_sources ?? []) as string[];
    if (!existingSources.includes("podscan")) {
      updates.data_sources = [...existingSources, "podscan"];
    }

    // Last API refresh timestamp
    updates.last_api_refresh = new Date().toISOString();

    // IMPORTANT: Never update rate_card from API data.
    // Agent-provided CPMs always take precedence.
    // Podscan doesn't have CPM data anyway, but this is
    // an explicit safeguard for any future API integrations.

    // ---- Apply updates ----
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({
        message: "Show already up to date — no new data from Podscan",
        show_id: id,
        podscan_id: podscanId,
        fields_updated: [],
      });
    }

    const { data: updatedShow, error: updateError } = await supabase
      .from("shows")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to update show", details: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: "Show enriched successfully",
      show_id: id,
      podscan_id: podscanId,
      fields_updated: Object.keys(updates).filter(
        (k) => k !== "last_api_refresh" && k !== "data_sources"
      ),
      enrichment_summary: {
        audience_size: updates.audience_size ?? null,
        new_categories: updates.categories
          ? (updates.categories as string[]).length -
            (show.categories ?? []).length
          : 0,
        sponsors_found: sponsors.length,
        contact_updated: !!updates.contact_name,
        network_detected: !!updates.network,
      },
      show: updatedShow,
    });
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
