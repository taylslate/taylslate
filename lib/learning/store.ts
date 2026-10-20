// Service-role writes for the learning review. Callers authorize first.
// Domain events are fail-soft and never block the write's result: a
// failed audit row is logged inside logEvent, and a failed write throws
// so the route can return an error instead of pretending it saved.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/data/events";
import type { OverrideAuthorRole, OverrideStance, OverrideTargetKind } from "./review";

export interface SaveOverrideInput {
  campaignId: string;
  authorId: string;
  authorRole: OverrideAuthorRole;
  targetKind: OverrideTargetKind;
  targetKey: string;
  stance: OverrideStance;
  note: string;
}

export async function saveLearningOverride(input: SaveOverrideInput): Promise<void> {
  const { error } = await supabaseAdmin.from("learning_overrides").upsert(
    {
      campaign_id: input.campaignId,
      author_id: input.authorId,
      author_role: input.authorRole,
      target_kind: input.targetKind,
      target_key: input.targetKey,
      stance: input.stance,
      note: input.note,
    },
    { onConflict: "campaign_id,target_kind,target_key,author_role" }
  );
  if (error) throw new Error(error.message);
  await logEvent({
    eventType: "learning.override_saved",
    entityType: "campaign",
    entityId: input.campaignId,
    actorId: input.authorId,
    payload: {
      author_role: input.authorRole,
      target_kind: input.targetKind,
      target_key: input.targetKey,
      stance: input.stance,
    },
  });
}

export async function saveConversionReport(input: {
  campaignId: string;
  dealId: string;
  conversions: number;
  reportedBy: string;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("deal_conversion_reports").upsert(
    {
      campaign_id: input.campaignId,
      deal_id: input.dealId,
      reported_conversions: input.conversions,
      reported_by: input.reportedBy,
    },
    { onConflict: "deal_id" }
  );
  if (error) throw new Error(error.message);
  await logEvent({
    eventType: "learning.conversion_reported",
    entityType: "deal",
    entityId: input.dealId,
    actorId: input.reportedBy,
    payload: {
      campaign_id: input.campaignId,
      reported_conversions: input.conversions,
    },
  });
}

export async function clearConversionReport(input: {
  campaignId: string;
  dealId: string;
  actorId: string;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("deal_conversion_reports")
    .delete()
    .eq("deal_id", input.dealId)
    .eq("campaign_id", input.campaignId);
  if (error) throw new Error(error.message);
  await logEvent({
    eventType: "learning.conversion_cleared",
    entityType: "deal",
    entityId: input.dealId,
    actorId: input.actorId,
    payload: { campaign_id: input.campaignId },
  });
}
