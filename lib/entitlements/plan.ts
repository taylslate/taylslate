// Read-only plan lookup for feature gates. Does not write profiles,
// enforce campaign caps, or talk to Stripe.

import { createClient } from "@/lib/supabase/server";
import { getPlan, type PlanId } from "@/lib/billing/plans";

/**
 * Free plan id. `plans.ts` keeps `pay_as_you_go` as the catalogue id
 * (customer-facing label: Free) and as the value missing rows resolve to.
 */
const FREE_PLAN_ID: PlanId = getPlan("pay_as_you_go").id;

/**
 * The caller's plan. Missing rows and values `getPlan` does not know
 * resolve to the Free plan id.
 */
export async function getProfilePlanId(userId: string): Promise<PlanId> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .single();

  return knownPlanId(data?.plan) ?? FREE_PLAN_ID;
}

function knownPlanId(value: unknown): PlanId | null {
  if (typeof value !== "string") return null;
  try {
    return getPlan(value as PlanId).id;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unknown plan id:")) {
      return null;
    }
    throw error;
  }
}

/** Starter, Operator, and the legacy agency record include CRM. */
export function canUseCrm(planId: PlanId): boolean {
  return planId === "starter" || planId === "operator" || planId === "agency";
}
