import { getCampaignById } from "@/lib/data/queries";
import {
  getLatestCampaignPatternForCampaign,
  getConvictionUniverse,
  type ConvictionUniverse,
} from "@/lib/data/reasoning-log";
import { listEventsForEntity } from "@/lib/data/events";
import { isBriefV2 } from "@/lib/data/types";
import { notFound } from "next/navigation";
import CampaignDetail from "./campaign-detail";
import DiscoveryList from "./discovery-list";
import ConvictionDiscoveryView from "./conviction-discovery-view";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaignById(id);
  if (!campaign) notFound();

  // Wave 6 (legacy): campaigns scored by the flat fit-score engine carry
  // scored_shows — keep rendering those via the original discovery list.
  const hasScoredShows = campaign.scored_shows && Array.isArray(campaign.scored_shows) && campaign.scored_shows.length > 0;
  if (hasScoredShows) {
    return <DiscoveryList campaign={campaign} />;
  }

  // Wave 14 Phase 2B: a v2-brief (2A-interpreted) campaign renders the
  // conviction discovery view — the scored universe grouped by confirmed ring.
  // The view auto-fires discovery on first landing (rings confirmed, nothing
  // scored, discovery never run); discoveryRan distinguishes "never ran" from
  // "ran, kept nothing" so an empty result doesn't re-fire on every load.
  if (isBriefV2(campaign.brief)) {
    const pattern = await getLatestCampaignPatternForCampaign(id);
    let universe: ConvictionUniverse = { rings: [], groups: [], hasScores: false };
    let discoveryRan = false;
    if (pattern) {
      const [scored, events] = await Promise.all([
        getConvictionUniverse(pattern.id),
        listEventsForEntity("campaign", id),
      ]);
      universe = scored;
      discoveryRan = events.some((e) => e.event_type === "conviction.scored");
    }
    return (
      <ConvictionDiscoveryView
        campaignId={id}
        campaignName={campaign.name}
        budgetTotal={campaign.budget_total ?? null}
        universe={universe}
        discoveryRan={discoveryRan}
      />
    );
  }

  // Legacy: campaigns generated via Claude still use the old detail view
  return <CampaignDetail campaign={campaign} />;
}
