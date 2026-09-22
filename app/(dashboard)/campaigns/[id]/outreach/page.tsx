import { notFound } from "next/navigation";
import {
  getCampaignById,
  getOutreachesForCampaign,
} from "@/lib/data/queries";
import type { ScoredShowRecord, MediaPlanLineItem } from "@/lib/data/types";
import ShowListWithOutreach from "@/components/outreach/ShowListWithOutreach";
import { tokens } from "@/lib/brand/tokens";
import Link from "next/link";

const radiusStyle = { borderRadius: tokens.radius };

export default async function CampaignOutreachPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const campaign = await getCampaignById(id);
  if (!campaign) notFound();

  const scoredShows = (campaign.scored_shows ?? []) as ScoredShowRecord[];
  const selectedIds = new Set(campaign.selected_show_ids ?? []);
  const selectedShows = scoredShows.filter((s) => selectedIds.has(s.podcastId));
  const lineItemByShow = new Map<string, MediaPlanLineItem>(
    (campaign.media_plan?.line_items ?? []).map((li) => [li.podcast_id, li])
  );
  const outreaches = await getOutreachesForCampaign(id);

  return (
    <div className="min-h-screen bg-[var(--ts-paper)] text-[var(--ts-ink-on-paper)]">
      <div className="border-b border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-8 pt-6 pb-5">
        <div className="mb-3 flex items-center gap-3">
          <Link
            href={`/campaigns/${id}/plan`}
            className="flex items-center gap-1.5 text-xs text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Back to plan
          </Link>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent)]">
            For brands
          </p>
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-[var(--ts-ink-on-paper)]">
          {campaign.name} — Outreach
        </h1>
        <p className="mt-1 text-sm text-[var(--ts-ink-muted-on-paper)]">
          Send a personalized pitch to each show. They&apos;ll see your offer and can
          accept, counter, or decline.
        </p>
      </div>

      <div className="px-8 py-6">
        {selectedShows.length === 0 ? (
          <div
            className="border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-8 text-center"
            style={radiusStyle}
          >
            <p className="mb-3 text-sm text-[var(--ts-ink-muted-on-paper)]">
              No shows selected yet.
            </p>
            <Link
              href={`/campaigns/${id}`}
              className="text-sm font-medium text-[var(--ts-accent)] hover:underline"
            >
              Pick shows →
            </Link>
          </div>
        ) : (
          <ShowListWithOutreach
            campaignId={id}
            initialOutreaches={outreaches}
            selectedShows={selectedShows.map((s) => ({
              show: s,
              line_item: lineItemByShow.get(s.podcastId),
            }))}
            defaultPlacement={campaign.media_plan?.default_placement}
            defaultEpisodes={campaign.media_plan?.default_episodes}
          />
        )}
      </div>
    </div>
  );
}
