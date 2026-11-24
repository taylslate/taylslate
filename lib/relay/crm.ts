// CRM hooks for outreach. Brand side writes name and show id only.
// Do not import this module from a client component.

import { canUseCrm, getProfilePlanId } from "@/lib/entitlements/plan";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function addShowToBrandCrmOnOutreach(input: {
  brandUserId: string;
  outreach: { id: string; show_id: string | null };
}): Promise<{ added: boolean; reason?: "no_crm_access" | "no_catalog_show" | "exists" | "error" }> {
  try {
    const planId = await getProfilePlanId(input.brandUserId);
    if (!canUseCrm(planId)) return { added: false, reason: "no_crm_access" };
    if (!input.outreach.show_id) return { added: false, reason: "no_catalog_show" };

    const { data: existing, error: readError } = await supabaseAdmin
      .from("brand_crm_shows")
      .select("id")
      .eq("brand_id", input.brandUserId)
      .eq("show_id", input.outreach.show_id)
      .maybeSingle();
    if (readError) {
      console.warn("[relay] crm add failed", readError.code ?? "unknown");
      return { added: false, reason: "error" };
    }
    if (existing) return { added: false, reason: "exists" };

    const payload = {
      brand_id: input.brandUserId,
      show_id: input.outreach.show_id,
      source: "outreach",
      outreach_id: input.outreach.id,
    };
    const { error } = await supabaseAdmin.from("brand_crm_shows").insert(payload);
    if (error?.code === "23505") return { added: false, reason: "exists" };
    if (error) {
      console.warn("[relay] crm add failed", error.code ?? "unknown");
      return { added: false, reason: "error" };
    }
    return { added: true };
  } catch (error) {
    console.warn("[relay] crm add failed", errorCode(error));
    return { added: false, reason: "error" };
  }
}

// Shows have no CRM. A show CRM is a separate decision for Chris.
export async function addBrandToShowCrmOnFirstResponse(input?: {
  brandUserId?: string;
  outreachId?: string;
}): Promise<{ added: false; reason: "no_show_crm" }> {
  void input;
  return { added: false, reason: "no_show_crm" };
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
  }
  return "unknown";
}
