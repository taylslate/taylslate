// Read-only plan lookup for feature gates. Does not write profiles,
// enforce campaign caps, or talk to Stripe.

import { createClient } from "@/lib/supabase/server";
import { PLANS, getPlan, type PlanId } from "@/lib/billing/plans";

/**
 * Free plan id. `plans.ts` keeps `pay_as_you_go` as the catalogue id
 * (customer-facing label: Free) and as the value missing rows resolve to.
 */
const FREE_PLAN_ID: PlanId = getPlan("pay_as_you_go").id;

/**
 * Plan for `userId`.
 *
 * `userId` must be the signed-in user. This reads through the server
 * client, so row-level security only returns that user's profile. Admin
 * and cron callers will need a service-role variant later.
 *
 * A missing row, a null or unknown plan, and any read error resolve to
 * the Free plan id. Errors other than no-rows are logged.
 */
export async function getProfilePlanId(userId: string): Promise<PlanId> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .single();

  if (error && !isNoRowsError(error)) {
    console.error(
      "[getProfilePlanId] profiles.plan read failed:",
      error.code,
      error.message,
    );
  }

  return knownPlanId(data?.plan) ?? FREE_PLAN_ID;
}

/**
 * Catalogue ids only. `Object.hasOwn` rejects inherited names such as
 * "toString", which `PLANS[value]` would otherwise treat as present.
 */
function knownPlanId(value: unknown): PlanId | null {
  if (typeof value !== "string" || !Object.hasOwn(PLANS, value)) return null;
  return getPlan(value as PlanId).id;
}

function isNoRowsError(error: { code?: string; message?: string }): boolean {
  if (error.code === "PGRST116") return true;
  return (error.message ?? "").toLowerCase().includes("no rows");
}

/** Starter, Operator, and the legacy agency record include CRM. */
export function canUseCrm(planId: PlanId): boolean {
  return planId === "starter" || planId === "operator" || planId === "agency";
}
