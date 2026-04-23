// GET /api/deals/[id]/preview
// Returns the IO PDF inline so the deal detail page can embed it in an
// <iframe>. Generates fresh on each call — cheap and deterministic.
// Auth: caller must own the brand_profile or show_profile on the deal.

import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  getBrandProfileByUserId,
  getOutreachById,
  getShowProfileByUserId,
  getWave12DealById,
} from "@/lib/data/queries";
import { generateIoPdfFromDeal } from "@/lib/pdf/io-generator";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { BrandProfile, ShowProfile } from "@/lib/data/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const deal = await getWave12DealById(id);
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

  // Ownership check — match either side.
  const brandProfile = await getBrandProfileByUserId(user.id);
  const showProfile = await getShowProfileByUserId(user.id);
  const ownsAsBrand = brandProfile?.id === deal.brand_profile_id;
  const ownsAsShow = showProfile?.id === deal.show_profile_id;
  if (!ownsAsBrand && !ownsAsShow) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Pull related entities. Use admin client so RLS doesn't block legitimate
  // cross-party reads (the brand needs to see the show's profile to render
  // the IO and vice versa).
  const { data: bp } = await supabaseAdmin
    .from("brand_profiles")
    .select("*")
    .eq("id", deal.brand_profile_id)
    .single();
  const { data: sp } = await supabaseAdmin
    .from("show_profiles")
    .select("*")
    .eq("id", deal.show_profile_id)
    .single();
  const outreach = await getOutreachById(deal.outreach_id);
  if (!bp || !sp || !outreach) {
    return NextResponse.json({ error: "Deal context missing" }, { status: 500 });
  }

  const { data: brandUser } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", (bp as BrandProfile).user_id)
    .single();
  const { data: showUser } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", (sp as ShowProfile).user_id)
    .single();

  const rendered = generateIoPdfFromDeal({
    deal,
    brandProfile: bp as BrandProfile,
    showProfile: sp as ShowProfile,
    outreach,
    brandSigningEmail: (brandUser?.email as string) ?? "",
    showSigningEmail: (showUser?.email as string) ?? "",
  });

  return new NextResponse(new Uint8Array(rendered.pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${rendered.ioNumber}.pdf"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
