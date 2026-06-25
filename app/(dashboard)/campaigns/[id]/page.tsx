import { getCampaignById } from "@/lib/data/queries";
import {
  getLatestCampaignPatternForCampaign,
  getConvictionUniverse,
  type ConvictionUniverse,
} from "@/lib/data/reasoning-log";
import { listEventsForEntity } from "@/lib/data/events";
import {
  getTieredUniverse,
  type TieredUniverse,
} from "@/lib/discovery/tiered-universe";
import { isBriefV2 } from "@/lib/data/types";
import { notFound } from "next/navigation";
import CampaignDetail from "./campaign-detail";
import DiscoveryList from "./discovery-list";
import ConvictionDiscoveryView from "./conviction-discovery-view";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaignById(id);
  if (!campaign) notFound();

  // Wave 14 Phase 2B/2C: a v2-brief (2A-interpreted) campaign ALWAYS renders the
  // conviction discovery view — the tiered (test/scale/bench) scored universe.
  // Checked BEFORE the legacy scored_shows branch on purpose: Phase 2C Layer 4
  // writes scored_shows as the media-plan handoff adapter, so a v2 campaign now
  // carries scored_shows once a plan is built — without this ordering it would
  // mis-route back to the legacy DiscoveryList and the brand could never return
  // to their conviction view. Legacy campaigns are never v2, so they still fall
  // through to the scored_shows branch unchanged.
  //
  // The view auto-fires discovery on first landing (rings confirmed, nothing
  // scored, discovery never run); discoveryRan distinguishes "never ran" from
  // "ran, kept nothing" so an empty result doesn't re-fire on every load.
  if (isBriefV2(campaign.brief)) {
    const pattern = await getLatestCampaignPatternForCampaign(id);
    let universe: ConvictionUniverse = { rings: [], groups: [], hasScores: false };
    let tiered: TieredUniverse | undefined;
    let discoveryRan = false;
    if (pattern) {
      // Phase 2C Layer 3: load the per-ring 2B universe (current rendering) AND
      // the test/scale/bench partitions (the Layer 4 seam) in one pass.
      const [scored, tieredScored, events] = await Promise.all([
        getConvictionUniverse(pattern.id),
        getTieredUniverse(pattern.id),
        listEventsForEntity("campaign", id),
      ]);
      universe = scored;
      tiered = tieredScored;
      discoveryRan = events.some((e) => e.event_type === "conviction.scored");
    }
    return (
      <ConvictionDiscoveryView
        campaignId={id}
        campaignName={campaign.name}
        budgetTotal={campaign.budget_total ?? null}
        universe={universe}
        tiered={tiered}
        discoveryRan={discoveryRan}
        selectedShowIds={campaign.selected_show_ids ?? []}
      />
    );
  }

  // Wave 6 (legacy): campaigns scored by the flat fit-score engine carry
  // scored_shows — render those via the original discovery list.
  const hasScoredShows =
    campaign.scored_shows &&
    Array.isArray(campaign.scored_shows) &&
    campaign.scored_shows.length > 0;
  if (hasScoredShows) {
    return <DiscoveryList campaign={campaign} />;
  }

  // Legacy: campaigns generated via Claude still use the old detail view
  return <CampaignDetail campaign={campaign} />;
}
