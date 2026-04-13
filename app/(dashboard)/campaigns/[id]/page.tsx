import { getCampaignById } from "@/lib/data/queries";
import { notFound } from "next/navigation";
import CampaignDetail from "./campaign-detail";
import DiscoveryList from "./discovery-list";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaignById(id);
  if (!campaign) notFound();

  // Wave 6: If campaign has scored_shows from scoring engine, show discovery list
  const hasScoredShows = campaign.scored_shows && Array.isArray(campaign.scored_shows) && campaign.scored_shows.length > 0;

  if (hasScoredShows) {
    return <DiscoveryList campaign={campaign} />;
  }

  // Legacy: campaigns generated via Claude still use the old detail view
  return <CampaignDetail campaign={campaign} />;
}
