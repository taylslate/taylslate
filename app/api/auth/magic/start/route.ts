// POST /api/auth/magic/start — issues a magic link to the show's email.
// Used from the public pitch page when the recipient is not yet onboarded.

import { NextRequest, NextResponse } from "next/server";
import { signMagicLinkToken, verifyOutreachToken } from "@/lib/io/tokens";
import { renderMagicLinkEmail } from "@/lib/email/templates/magic-link";
import { sendEmail } from "@/lib/email/send";
import { getOutreachById } from "@/lib/data/queries";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { BrandProfile } from "@/lib/data/types";

interface StartBody {
  outreach_token: string;
  email: string;
}

function siteOrigin(req: NextRequest): string {
  const envOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  if (envOrigin) return envOrigin.replace(/\/$/, "");
  return new URL(req.url).origin;
}

export async function POST(request: NextRequest) {
  let body: StartBody;
  try {
    body = (await request.json()) as StartBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.outreach_token || !body.email) {
    return NextResponse.json({ error: "outreach_token and email required" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }

  const tokenPayload = verifyOutreachToken(body.outreach_token);
  if (!tokenPayload) {
    return NextResponse.json({ error: "Invalid outreach token" }, { status: 401 });
  }
  const outreach = await getOutreachById(tokenPayload.outreach_id);
  if (!outreach) {
    return NextResponse.json({ error: "Outreach not found" }, { status: 404 });
  }

  // Tie the magic link to the original pitch URL so onboarding completion
  // bounces the show back to accept/counter/decline.
  const origin = siteOrigin(request);
  const returnUrl = `${origin}/outreach/${body.outreach_token}`;
  const magicToken = signMagicLinkToken(body.email, returnUrl);

  const magicUrl = `${origin}/auth/magic?token=${encodeURIComponent(magicToken)}`;

  // Look up brand name for the email subject.
  const { data: bp } = await supabaseAdmin
    .from("brand_profiles")
    .select("brand_identity, brand_website")
    .eq("id", outreach.brand_profile_id)
    .single();
  const brandProfile = bp as Partial<BrandProfile> | null;
  const brandName =
    brandProfile?.brand_identity?.split(/[.,—–-]/)[0]?.trim() ||
    brandProfile?.brand_website?.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] ||
    "A brand";

  const email = renderMagicLinkEmail({
    to_email: body.email,
    brand_name: brandName,
    show_name: outreach.show_name,
    magic_link_url: magicUrl,
  });

  const sendResult = await sendEmail({
    to: body.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  return NextResponse.json({ ok: true, email_sent: sendResult.ok, email_reason: sendResult.reason });
}
