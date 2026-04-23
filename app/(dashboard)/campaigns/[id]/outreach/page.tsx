import { notFound } from "next/navigation";
import {
  getCampaignById,
  getOutreachesForCampaign,
} from "@/lib/data/queries";
import type { ScoredShowRecord, MediaPlanLineItem } from "@/lib/data/types";
import ShowListWithOutreach from "@/components/outreach/ShowListWithOutreach";
import Link from "next/link";

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
    <div className="px-8 py-6">
      <div className="flex items-center gap-3 mb-1">
        <Link
          href={`/campaigns/${id}/plan`}
          className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">
          {campaign.name} — Outreach
        </h1>
      </div>
      <p className="text-sm text-[var(--brand-text-secondary)] mb-6 ml-8">
        Send a personalized pitch to each show. They&apos;ll see your offer and can
        accept, counter, or decline.
      </p>

      {selectedShows.length === 0 ? (
        <div className="rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] p-8 text-center">
          <p className="text-sm text-[var(--brand-text-secondary)] mb-3">
            No shows selected yet.
          </p>
          <Link
            href={`/campaigns/${id}`}
            className="text-sm text-[var(--brand-blue)] hover:underline font-medium"
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
  );
}
