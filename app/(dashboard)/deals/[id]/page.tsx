// Dispatcher: Wave-12 (outreach-driven) deals get the new sign-flow UI;
// legacy deals fall back to the original edit form so older data stays usable.

import { notFound } from "next/navigation";
import {
  getAuthenticatedUser,
  getBrandProfileByUserId,
  getOutreachById,
  getShowProfileByUserId,
  getWave12DealById,
} from "@/lib/data/queries";
import { supabaseAdmin } from "@/lib/supabase/admin";
import LegacyDealClient from "./legacy-client";
import Wave12DealClient from "@/components/deals/Wave12DealClient";
import type { BrandProfile, ShowProfile } from "@/lib/data/types";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ signing?: string }>;
}

function brandDisplayName(bp: Partial<BrandProfile> | null): string {
  if (!bp) return "Brand";
  if (bp.brand_identity) {
    return bp.brand_identity.split(/[.,—–-]/)[0]?.trim() || bp.brand_identity;
  }
  if (bp.brand_website) {
    return bp.brand_website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
  }
  return "Brand";
}

export default async function DealDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const search = await searchParams;
  const user = await getAuthenticatedUser();
  if (!user) notFound();

  // Try the Wave 12 path first — most new deals will land here.
  const wave12 = await getWave12DealById(id);
  if (wave12 && wave12.outreach_id) {
    const brandProfile = await getBrandProfileByUserId(user.id);
    const showProfile = await getShowProfileByUserId(user.id);
    const ownsAsBrand = brandProfile?.id === wave12.brand_profile_id;
    const ownsAsShow = showProfile?.id === wave12.show_profile_id;
    if (!ownsAsBrand && !ownsAsShow) notFound();

    const { data: bp } = await supabaseAdmin
      .from("brand_profiles")
      .select("brand_identity, brand_website")
      .eq("id", wave12.brand_profile_id)
      .single();
    const { data: sp } = await supabaseAdmin
      .from("show_profiles")
      .select("show_name")
      .eq("id", wave12.show_profile_id)
      .single();
    const outreach = await getOutreachById(wave12.outreach_id);
    return (
      <Wave12DealClient
        deal={wave12}
        showName={
          (sp as ShowProfile | null)?.show_name ?? outreach?.show_name ?? "Show"
        }
        brandName={brandDisplayName(bp as Partial<BrandProfile> | null)}
        viewerRole={ownsAsBrand ? "brand" : "show"}
        signingHint={search.signing ?? null}
      />
    );
  }

  // Legacy fall-through.
  return <LegacyDealClient dealId={id} />;
}
