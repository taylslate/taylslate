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
import { listMakeGoodsFailSoft } from "@/lib/make-goods/propose";
import { buildTrackingLink } from "@/lib/io/tracking-link";
import { buildShowNotesBlurb } from "@/lib/io/show-notes";
import { computeApplicationFeeCents } from "@/lib/stripe/payment-intent";
import type { BrandProfile, ShowProfile } from "@/lib/data/types";

interface PageProps {
  params: Promise<{ id: string }>;
}

function episodeChargeForBrand(
  showProfile: { audience_size?: number | string | null } | null,
  agreedCpm: number,
  feePercentage: number
): {
  grossCents: number;
  feeCents: number;
  chargedCents: number;
  feePercentage: number;
} | null {
  const audience = Number(showProfile?.audience_size ?? 0);
  if (!Number.isFinite(audience) || audience <= 0 || !(agreedCpm > 0)) return null;
  if (!Number.isFinite(feePercentage) || feePercentage < 0 || feePercentage > 1) {
    return null;
  }

  // Same cents rounding as generateIoPdfFromDeal, then the same fee the
  // charge path adds on top.
  const grossDollars = Math.round((audience / 1000) * agreedCpm * 100) / 100;
  const grossCents = Math.round(grossDollars * 100);
  if (grossCents <= 0) return null;
  const feeCents = computeApplicationFeeCents(grossCents, feePercentage);
  return {
    grossCents,
    feeCents,
    chargedCents: grossCents + feeCents,
    feePercentage,
  };
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

export default async function DealDetailPage({ params }: PageProps) {
  const { id } = await params;
  const user = await getAuthenticatedUser();
  if (!user) notFound();

  // Try the Wave 12 path first — most new deals will land here.
  const wave12 = await getWave12DealById(id);
  if (wave12 && wave12.outreach_id) {
    const [brandProfile, showProfile] = await Promise.all([
      getBrandProfileByUserId(user.id),
      getShowProfileByUserId(user.id),
    ]);
    const ownsAsBrand = brandProfile?.id === wave12.brand_profile_id;
    const ownsAsShow = showProfile?.id === wave12.show_profile_id;
    if (!ownsAsBrand && !ownsAsShow) notFound();

    const [bpRes, spRes, outreach, feeRes] = await Promise.all([
      supabaseAdmin
        .from("brand_profiles")
        .select("brand_identity, brand_website")
        .eq("id", wave12.brand_profile_id)
        .single(),
      supabaseAdmin
        .from("show_profiles")
        .select("show_name, audience_size")
        .eq("id", wave12.show_profile_id)
        .single(),
      getOutreachById(wave12.outreach_id),
      ownsAsBrand
        ? supabaseAdmin
            .from("profiles")
            .select("platform_fee_percentage")
            .eq("id", user.id)
            .maybeSingle<{ platform_fee_percentage: number | string | null }>()
        : Promise.resolve({ data: null }),
    ]);
    const bp = bpRes.data;
    const sp = spRes.data;
    const showName =
      (sp as ShowProfile | null)?.show_name ?? outreach?.show_name ?? "Show";
    const brandName = brandDisplayName(bp as Partial<BrandProfile> | null);
    // Tracking link is generated on read — never persisted. Null when the brand
    // has no website on file, in which case the client renders nothing.
    const trackingLink = buildTrackingLink({
      brandWebsite: (bp as Partial<BrandProfile> | null)?.brand_website,
      dealId: wave12.id,
      showName,
    });
    // Show-notes blurb is likewise generated on read — it stitches the SAVED
    // promo code (Layer A) and the tracking link (Layer B) into one copy-paste
    // string. router.refresh() after a promo save re-derives it automatically.
    const showNotesBlurb = buildShowNotesBlurb({
      brandName,
      promoCode: wave12.promo_code,
      trackingLink,
    });
    const feePercentage = Number(feeRes.data?.platform_fee_percentage);
    const episodeCharge = ownsAsBrand
      ? episodeChargeForBrand(sp, wave12.agreed_cpm, feePercentage)
      : null;
    const makeGoods = await listMakeGoodsFailSoft(wave12.id);
    return (
      <Wave12DealClient
        deal={wave12}
        showName={showName}
        brandName={brandName}
        viewerRole={ownsAsBrand ? "brand" : "show"}
        trackingLink={trackingLink}
        showNotesBlurb={showNotesBlurb}
        episodeCharge={episodeCharge}
        makeGoods={makeGoods}
      />
    );
  }

  // Legacy fall-through.
  return <LegacyDealClient dealId={id} />;
}
