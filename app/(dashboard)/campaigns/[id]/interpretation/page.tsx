// Wave 14 Phase 2A Layer 5 — interpretation page.
//
// Server shell. Reconstructs current ring state from ring_hypotheses when an
// interpretation already exists (durable reload — refinements/adds survive),
// otherwise hands the client a clean slate so it runs the interpretation
// fresh on mount. The reconstruction read path is deliberately independent of
// Layer 4's write-atomic replay; see lib/discovery/interpretation-state.ts.

import { notFound, redirect } from "next/navigation";
import { getAuthenticatedUser, getCampaignById } from "@/lib/data/queries";
import {
  getCampaignReasoning,
  getLatestCampaignPatternForCampaign,
} from "@/lib/data/reasoning-log";
import { reconstructInterpretation } from "@/lib/discovery/interpretation-state";
import { isBriefV2 } from "@/lib/data/types";
import type {
  BriefGoal,
  BriefInterpretation,
  BrandDecision,
  CampaignBriefV2,
  RingHypothesisRow,
} from "@/lib/data/types";
import InterpretationClient from "./interpretation-client";

export default async function InterpretationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const campaign = await getCampaignById(id);
  if (!campaign || campaign.user_id !== user.id) notFound();

  const brief = campaign.brief;
  const briefV2: CampaignBriefV2 | null =
    brief && isBriefV2(brief) ? brief : null;
  const goals: BriefGoal[] = briefV2?.goals ?? [];
  const prefillUrl = briefV2?.product?.url ?? "";

  // Durable reload: if an interpretation already exists, rebuild the current
  // ring state (refinements/adds included, refined rows filtered) and hand it
  // to the client so no fresh /interpret call is made.
  let initialInterpretation: BriefInterpretation | null = null;
  let initialDecisions: Record<string, BrandDecision> | null = null;
  const pattern = await getLatestCampaignPatternForCampaign(id);
  if (pattern) {
    const reasoning = await getCampaignReasoning(pattern.id);
    const reconstructed = reconstructInterpretation(
      pattern,
      reasoning.rings as unknown as RingHypothesisRow[]
    );
    if (reconstructed) {
      initialInterpretation = reconstructed.interpretation;
      initialDecisions = reconstructed.decisions;
    }
  }

  // A pattern exists but reconstruction yielded nothing usable (a save that
  // left no replayable rings). The client must show the refresh banner, NOT
  // re-run a fresh interpretation onto the existing pattern.
  const patternEmpty = Boolean(pattern) && initialInterpretation === null;

  return (
    <InterpretationClient
      campaignId={id}
      budgetTotal={campaign.budget_total ?? null}
      goals={goals}
      prefillUrl={prefillUrl}
      initialInterpretation={initialInterpretation}
      initialDecisions={initialDecisions}
      patternEmpty={patternEmpty}
    />
  );
}
