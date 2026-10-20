// Who may read a deal's make-goods, and who may approve one.
// The brand is deals.brand_id or the user on deals.brand_profile_id.
// The show is deals.show_profile_id. show_profiles.podscan_id is not read.

import { getBrandProfileByUserId, getShowProfileByUserId } from "@/lib/data/queries";
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface DealRef {
  id: string;
  status: string;
  brand_id: string | null;
  agent_id: string | null;
  agency_id: string | null;
  brand_profile_id: string | null;
  show_id: string | null;
  show_profile_id: string | null;
}

export type DealRole = "brand" | "show" | "party" | "none";

export interface DealAccess {
  deal: DealRef | null;
  role: DealRole;
}

const DEAL_COLUMNS =
  "id, status, brand_id, agent_id, agency_id, brand_profile_id, show_id, show_profile_id";

export async function loadDealAccess(dealId: string, userId: string): Promise<DealAccess> {
  const { data, error } = await supabaseAdmin
    .from("deals")
    .select(DEAL_COLUMNS)
    .eq("id", dealId)
    .maybeSingle();
  if (error) {
    throw new Error(`deal lookup failed: ${error.message}`);
  }
  if (!data) return { deal: null, role: "none" };

  const deal = data as DealRef;
  const [brandProfile, showProfile] = await Promise.all([
    getBrandProfileByUserId(userId),
    getShowProfileByUserId(userId),
  ]);

  if (
    (deal.brand_profile_id && brandProfile?.id === deal.brand_profile_id) ||
    deal.brand_id === userId
  ) {
    return { deal, role: "brand" };
  }
  if (deal.show_profile_id && showProfile?.id === deal.show_profile_id) {
    return { deal, role: "show" };
  }
  if (deal.agent_id === userId || deal.agency_id === userId) {
    return { deal, role: "party" };
  }
  return { deal, role: "none" };
}
