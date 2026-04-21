import { getCampaignById } from "@/lib/data/queries";
import { notFound, redirect } from "next/navigation";
import type { ScoredShowRecord } from "@/lib/data/types";
import MediaPlanBuilder from "./media-plan-builder";

interface PlanPageProps {
  params: Promise<{ id: string }>;
}

export default async function PlanBuilderPage({ params }: PlanPageProps) {
  const { id } = await params;
  const campaign = await getCampaignById(id);

  if (!campaign) notFound();

  const scoredShows = (campaign.scored_shows ?? []) as ScoredShowRecord[];
  const selectedIds = new Set(campaign.selected_show_ids ?? []);
  const selectedShows = scoredShows.filter((s) => selectedIds.has(s.podcastId));

  // If the brand hasn't selected any shows yet, send them back to discovery.
  if (selectedShows.length === 0) {
    redirect(`/campaigns/${id}`);
  }

  return (
    <MediaPlanBuilder
      campaignId={campaign.id}
      campaignName={campaign.name}
      budgetTotal={campaign.budget_total}
      selectedShows={selectedShows}
      initialPlan={campaign.media_plan ?? null}
    />
  );
}
