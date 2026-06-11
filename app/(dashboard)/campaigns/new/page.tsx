// Wave 14 Phase 2A Layer 3 — brief intake.
//
// First-time brands get the three-section free-text-led form. Returning
// brands (any prior campaign_patterns row) get the agent-style check-in
// instead of a form prefilled with old answers.

import { redirect } from "next/navigation";
import {
  getAuthenticatedUser,
  getBrandProfileByUserId,
  getCampaignsForUser,
} from "@/lib/data/queries";
import { getLatestCampaignPatternForCustomer } from "@/lib/data/reasoning-log";
import { isBriefV2 } from "@/lib/data/types";
import BriefIntakeForm from "./brief-intake-form";

export default async function NewCampaignPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  const [profile, pattern, campaigns] = await Promise.all([
    getBrandProfileByUserId(user.id),
    getLatestCampaignPatternForCustomer(user.id),
    getCampaignsForUser(user.id),
  ]);

  // Reuse an abandoned intake draft instead of orphaning a new row each
  // visit. Drafts are created before submit because the derive-product
  // endpoint needs a campaign id.
  const existingDraft = campaigns.find(
    (c) =>
      c.status === "draft" &&
      isBriefV2(c.brief) &&
      !c.brief.submitted_at
  );

  // Layer 4 coordination: customer_summary has no column yet. Read it from
  // product_attributes if a future write put it there, else fall back to
  // the raw customer_description.
  let previousSummary: string | null = null;
  if (pattern) {
    const fromAttributes = pattern.product_attributes?.customer_summary;
    previousSummary =
      (typeof fromAttributes === "string" && fromAttributes.trim()) ||
      pattern.customer_description ||
      null;
  }

  // Prior values for the "Yes, here's what's changed" editable check-in:
  // the latest submitted v2 brief holds the brand's last confirmed answers
  // (campaigns are already sorted newest-first). The pattern row's
  // customer_description backstops briefs from the reuse path that carry
  // no customer_text of their own.
  const lastSubmitted = campaigns.find(
    (c) => isBriefV2(c.brief) && c.brief.submitted_at
  );
  const lastBrief =
    lastSubmitted && isBriefV2(lastSubmitted.brief) ? lastSubmitted.brief : null;
  const prior = {
    productUrl: lastBrief?.product?.url ?? null,
    customerText:
      lastBrief?.customer_text ?? pattern?.customer_description ?? null,
    exclusionsText: lastBrief?.exclusions_text ?? null,
  };

  return (
    <BriefIntakeForm
      prefillUrl={profile?.brand_website ?? ""}
      initialDraftId={existingDraft?.id ?? null}
      returning={
        pattern ? { patternId: pattern.id, previousSummary, prior } : null
      }
    />
  );
}
