// Request-time plan check for a resolved API key. Reads profiles with
// the service role. Does not import key-settings (that module pulls in
// the cookie client). The allow rule matches brandHasApiAccess.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { ApiAuthError } from "@/lib/api/errors";

interface DbError {
  code?: string;
}

function planAllowsApi(plan: unknown): boolean {
  if (typeof plan !== "string" || !Object.hasOwn(PLANS, plan)) return false;
  return PLANS[plan as PlanId].features.apiAccess;
}

export function assertProfileApiAccess(
  row: { role?: unknown; plan?: unknown } | null
): void {
  if (row?.role === "brand" && planAllowsApi(row.plan)) return;

  throw new ApiAuthError(
    403,
    "Your plan does not include API access.",
    "plan_no_api_access"
  );
}

export async function assertBrandApiAccess(brandId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("role, plan")
    .eq("id", brandId)
    .maybeSingle();

  if (error) {
    console.warn(
      "[api.plan-gate] profile lookup failed:",
      (error as DbError).code ?? "unknown"
    );
    throw new Error("API key lookup failed.");
  }

  assertProfileApiAccess(data as { role?: unknown; plan?: unknown } | null);
}
