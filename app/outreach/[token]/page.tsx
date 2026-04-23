// Public pitch page. Two states:
//   - NOT ONBOARDED: show enters email → magic link → onboarding → returns here
//   - ONBOARDED:     show clicks accept/counter/decline directly
//
// Forwarding the URL is fine and expected — agents and reps share these.
// We never re-auth at this layer; auth happens via magic link or login.

import { notFound } from "next/navigation";
import { verifyOutreachToken } from "@/lib/io/tokens";
import { getOutreachById } from "@/lib/data/queries";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { BrandProfile, Outreach } from "@/lib/data/types";
import PitchClient from "./pitch-client";

interface PageProps {
  params: Promise<{ token: string }>;
}

interface BrandSummary {
  brand_name: string;
  brand_url: string | null;
}

interface ShowContext {
  is_onboarded: boolean;
  show_standard_cpm: number | null;
}

async function loadBrandSummary(brandProfileId: string): Promise<BrandSummary> {
  const { data } = await supabaseAdmin
    .from("brand_profiles")
    .select("brand_identity, brand_website, user_id")
    .eq("id", brandProfileId)
    .single();
  const bp = data as Partial<BrandProfile> | null;
  if (!bp) return { brand_name: "A brand", brand_url: null };

  let brandName =
    bp.brand_identity?.split(/[.,—–-]/)[0]?.trim() ||
    bp.brand_website?.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] ||
    "";
  if (!brandName && bp.user_id) {
    const { data: user } = await supabaseAdmin
      .from("profiles")
      .select("company_name, full_name")
      .eq("id", bp.user_id)
      .single();
    brandName = user?.company_name || user?.full_name || "A brand";
  }
  return { brand_name: brandName || "A brand", brand_url: bp.brand_website ?? null };
}

async function loadShowContext(outreach: Outreach): Promise<ShowContext> {
  // Match by email — that's the contract: the show owns the inbox we sent to.
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .ilike("email", outreach.sent_to_email)
    .maybeSingle();

  if (!profile || profile.role !== "show") {
    return { is_onboarded: false, show_standard_cpm: null };
  }

  const { data: showProfile } = await supabaseAdmin
    .from("show_profiles")
    .select("onboarded_at, expected_cpm")
    .eq("user_id", profile.id)
    .maybeSingle();

  const onboarded = Boolean(showProfile?.onboarded_at);
  return {
    is_onboarded: onboarded,
    show_standard_cpm: onboarded ? (showProfile?.expected_cpm ?? null) : null,
  };
}

export default async function PitchPage({ params }: PageProps) {
  const { token } = await params;
  const payload = verifyOutreachToken(token);
  if (!payload) notFound();

  const outreach = await getOutreachById(payload.outreach_id);
  if (!outreach) notFound();

  const [brand, showContext] = await Promise.all([
    loadBrandSummary(outreach.brand_profile_id),
    loadShowContext(outreach),
  ]);

  return (
    <PitchClient
      token={token}
      outreach={outreach}
      brand={brand}
      isOnboarded={showContext.is_onboarded}
      showStandardCpm={showContext.show_standard_cpm}
    />
  );
}
