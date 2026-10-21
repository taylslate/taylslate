import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  ensureProfile,
  getCampaignById,
  createShow,
  createDeal,
  createIO,
  getNextIONumber,
  getShowBySlug,
} from "@/lib/data/queries";
import type {
  MediaPlanLineItem,
  ScoredShowRecord,
  Show,
  Placement,
  PlanSpacing,
} from "@/lib/data/types";
import { adjustedCpm, spotPrice } from "@/lib/utils/pricing";
import { addDaysDateOnly } from "@/lib/format/date-only";
import { resolveDealFlight } from "@/lib/deals/campaign-flight";
import { fetchSurfaceAttachment } from "@/lib/data/show-surfaces";
import {
  buildSurfaceAddonLines,
  sanitizeAddonSurfaceIds,
  surfacesEligibleForDeal,
  type SellableSurface,
} from "@/lib/shows/surfaces";

const SPACING_DAYS: Record<PlanSpacing, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
};

function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Persist a discovered show into the shows table (or fetch existing by slug). */
async function persistScoredShow(record: ScoredShowRecord): Promise<Show | null> {
  const existing = await getShowBySlug(slugifyName(record.name));
  if (existing) return existing;

  return createShow({
    name: record.name,
    platform: "podcast",
    description: record.description,
    image_url: record.imageUrl ?? undefined,
    categories: record.categories ?? [],
    network: record.publisherName ?? undefined,
    audience_size: record.audienceSize,
    rate_card: { midroll_cpm: record.estimatedCpm },
    price_type: "cpm",
    ad_formats: ["host_read"],
    episode_cadence: "weekly",
    current_sponsors: [],
    rss_url: record.rssUrl ?? undefined,
    contact: {
      name: record.publisherName ?? "",
      email: record.contactEmail ?? "",
      method: "email",
    },
    data_sources: ["discovery"],
    is_claimed: false,
    is_verified: false,
  });
}

interface LineItemContext {
  scoredShow: ScoredShowRecord;
  lineItem: MediaPlanLineItem;
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { campaign_id: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.campaign_id) {
    return NextResponse.json({ error: "campaign_id required" }, { status: 400 });
  }

  let profile;
  try {
    profile = await ensureProfile({ id: user.id, email: user.email ?? undefined });
  } catch (err) {
    console.error("[plan/generate-ios] ensureProfile failed:", err);
    return NextResponse.json({ error: "Failed to load user profile" }, { status: 500 });
  }

  const campaign = await getCampaignById(body.campaign_id);
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign.user_id !== profile.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const plan = campaign.media_plan;
  if (!plan || !plan.line_items?.length) {
    return NextResponse.json({ error: "Media plan is empty" }, { status: 400 });
  }

  // Join line items with their ScoredShowRecord so we have pricing inputs.
  const scoredById = new Map<string, ScoredShowRecord>(
    (campaign.scored_shows ?? []).map((s) => [s.podcastId, s])
  );
  const items: LineItemContext[] = plan.line_items
    .map((li) => {
      const scored = scoredById.get(li.podcast_id);
      return scored ? { scoredShow: scored, lineItem: li } : null;
    })
    .filter((x): x is LineItemContext => x !== null);

  if (items.length === 0) {
    return NextResponse.json(
      { error: "No plan line items matched a scored show" },
      { status: 400 }
    );
  }

  const spacingDays = SPACING_DAYS[plan.spacing] ?? 7;

  const created: { deal_id: string; io_id: string; show_name: string }[] = [];
  const errors: string[] = [];

  // Resolve every show and its add-ons before creating a deal. A surface that
  // is missing, unpublished, or on another show aborts with nothing written.
  const ready: {
    scoredShow: ScoredShowRecord;
    lineItem: MediaPlanLineItem;
    show: Show;
    surfaces: SellableSurface[];
  }[] = [];

  for (const { scoredShow, lineItem } of items) {
    let show: Show | null = null;
    try {
      show = await persistScoredShow(scoredShow);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      errors.push(`"${scoredShow.name}": ${msg}`);
      console.error(`[plan/generate-ios] Failed on "${scoredShow.name}":`, msg);
      continue;
    }
    if (!show) {
      errors.push(`Could not persist show "${scoredShow.name}"`);
      continue;
    }

    const selected = sanitizeAddonSurfaceIds(lineItem.addon_surface_ids);
    let surfaces: SellableSurface[] = [];
    if (selected.length > 0) {
      const fetched = await fetchSurfaceAttachment(show.id, selected);
      const verdict = fetched.ok
        ? surfacesEligibleForDeal({
            dealShowId: show.id,
            shows: fetched.shows,
            surfaces: fetched.surfaces,
            requestedIds: selected,
          })
        : { ok: false as const, error: "invalid_surface" as const };
      if (!verdict.ok) {
        return NextResponse.json({ error: "invalid_surface" }, { status: 400 });
      }
      surfaces = verdict.surfaces;
    }
    ready.push({ scoredShow, lineItem, show, surfaces });
  }

  for (const { scoredShow, lineItem, show, surfaces } of ready) {
    try {
      const placement: Placement = lineItem.placement;
      const numEpisodes = Math.max(1, Math.round(lineItem.num_episodes));
      const baseCpm = scoredShow.estimatedCpm;
      const adjCpm = adjustedCpm(baseCpm, placement);
      const netPerEpisode = Math.round(
        spotPrice(scoredShow.audienceSize, baseCpm, placement)
      );

      const flight = resolveDealFlight({
        brief: campaign.brief,
        numEpisodes,
        spacingDays,
      });

      const episodeLines = [];
      for (let i = 0; i < numEpisodes; i++) {
        episodeLines.push({
          format: "podcast" as const,
          post_date: addDaysDateOnly(flight.flight_start, i * spacingDays),
          guaranteed_downloads: scoredShow.audienceSize,
          show_name: show.name,
          placement,
          is_scripted: false,
          is_personal_experience: true,
          reader_type: "host_read" as const,
          content_type: "evergreen" as const,
          pixel_required: false,
          gross_rate: netPerEpisode,
          gross_cpm: Math.round(adjCpm * 100) / 100,
          price_type: "cpm" as const,
          net_due: netPerEpisode,
          verified: false,
          make_good_triggered: false,
        });
      }

      const addons = buildSurfaceAddonLines({
        surfaces,
        selectedIds: lineItem.addon_surface_ids,
        showName: show.name,
        placement,
        postDate: episodeLines[0]?.post_date ?? flight.flight_start,
        format: "podcast",
      });
      for (const name of addons.unpriced) {
        errors.push(
          `"${scoredShow.name}": ${name} needs a price before it can go on the IO`
        );
      }
      const lineItems = [...episodeLines, ...addons.lines];
      const totalNet =
        Math.round(lineItems.reduce((sum, li) => sum + li.net_due, 0) * 100) / 100;
      const totalGross =
        Math.round(lineItems.reduce((sum, li) => sum + li.gross_rate, 0) * 100) / 100;

      const deal = await createDeal({
        campaign_id: campaign.id,
        show_id: show.id,
        brand_id: profile.id,
        status: "planning",
        num_episodes: numEpisodes,
        placement,
        ad_format: "host_read",
        price_type: "cpm",
        cpm_rate: Math.round(adjCpm * 100) / 100,
        gross_cpm: Math.round(adjCpm * 100) / 100,
        guaranteed_downloads: scoredShow.audienceSize,
        net_per_episode: netPerEpisode,
        gross_per_episode: netPerEpisode,
        total_net: totalNet,
        total_gross: totalGross,
        is_scripted: false,
        is_personal_experience: true,
        reader_type: "host_read",
        content_type: "evergreen",
        pixel_required: false,
        competitor_exclusion: [],
        exclusivity_days: 90,
        rofr_days: 30,
        flight_start: flight.flight_start,
        flight_end: flight.flight_end,
      });

      if (!deal) {
        errors.push(`Deal creation failed for "${scoredShow.name}"`);
        continue;
      }

      const ioNumber = await getNextIONumber();
      const io = await createIO(
        {
          io_number: ioNumber,
          deal_id: deal.id,
          advertiser_name: profile.company_name ?? profile.full_name ?? "Advertiser",
          advertiser_contact_name: profile.full_name ?? "",
          advertiser_contact_email: profile.email ?? "",
          publisher_name: show.name,
          publisher_contact_name: show.contact?.name ?? "",
          publisher_contact_email: show.contact?.email ?? "",
          total_downloads: scoredShow.audienceSize * numEpisodes,
          total_gross: totalGross,
          total_net: totalNet,
          payment_terms: "Net 30 EOM",
          competitor_exclusion: [],
          exclusivity_days: 90,
          rofr_days: 30,
          cancellation_notice_days: 14,
          download_tracking_days: 45,
          make_good_threshold: 0.1,
          status: "draft",
        },
        lineItems
      );

      if (!io) {
        errors.push(`IO creation failed for "${scoredShow.name}"`);
        continue;
      }

      // Draft only. io_sent is set when the IO is emailed or sent to DocuSign.
      created.push({ deal_id: deal.id, io_id: io.id, show_name: show.name });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      errors.push(`"${scoredShow.name}": ${msg}`);
      console.error(`[plan/generate-ios] Failed on "${scoredShow.name}":`, msg);
    }
  }

  if (created.length === 0) {
    return NextResponse.json(
      { error: "No deals or IOs were created", errors },
      { status: 500 }
    );
  }

  return NextResponse.json({
    created_count: created.length,
    total_count: items.length,
    created,
    errors,
    campaign_id: campaign.id,
  });
}
