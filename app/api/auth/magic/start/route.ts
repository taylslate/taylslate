// POST /api/auth/magic/start. Issues a magic link to the outreach recipient.
// Used from the public pitch page when the recipient is not yet onboarded.
// The posted address must be outreaches.sent_to_email. Any other address gets
// the same { ok: true } and no mail.

import { NextRequest, NextResponse } from "next/server";
import { signMagicLinkToken, verifyOutreachToken } from "@/lib/io/tokens";
import { EMAIL_FROM_AUTH } from "@/lib/email/addresses";
import { renderMagicLinkEmail } from "@/lib/email/templates/magic-link";
import { sendEmail } from "@/lib/email/send";
import { brandNameFromProfile } from "@/lib/brand/display-name";
import { getOutreachById } from "@/lib/data/queries";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { BrandProfile } from "@/lib/data/types";
import { isValidLoginEmail, normalizeLoginEmail } from "@/lib/auth/login-magic";
import { enforceMagicStart } from "@/lib/security/rate-limit";

interface StartBody {
  outreach_token?: unknown;
  email?: unknown;
}

/** Pitch setup links last one hour. The token helper's default stays 24h. */
export const MAGIC_START_TTL_SECONDS = 60 * 60;

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

  const email = normalizeLoginEmail(body.email);
  const outreachToken = typeof body.outreach_token === "string" ? body.outreach_token : "";
  if (!outreachToken || !email) {
    return NextResponse.json({ error: "outreach_token and email required" }, { status: 400 });
  }
  if (!isValidLoginEmail(email)) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }

  const tokenPayload = verifyOutreachToken(outreachToken);
  if (!tokenPayload) {
    return NextResponse.json({ error: "Invalid outreach token" }, { status: 401 });
  }
  const outreach = await getOutreachById(tokenPayload.outreach_id);
  if (!outreach) {
    return NextResponse.json({ error: "Outreach not found" }, { status: 404 });
  }

  const outreachId = tokenPayload.outreach_id;
  const limited = await enforceMagicStart(request, { outreachId, email });
  if (limited) return limited;

  const recipient = normalizeLoginEmail(outreach.sent_to_email);
  if (!recipient || recipient !== email) {
    console.warn(`[magic.start] recipient mismatch ${outreachId}`);
    return NextResponse.json({ ok: true });
  }

  // Tie the magic link to the original pitch URL so onboarding completion
  // bounces the show back to accept/counter/decline.
  const origin = siteOrigin(request);
  const returnUrl = `${origin}/outreach/${outreachToken}`;
  const magicToken = signMagicLinkToken(recipient, returnUrl, MAGIC_START_TTL_SECONDS);

  const magicUrl = `${origin}/api/auth/magic?token=${encodeURIComponent(magicToken)}`;

  // Look up brand name for the email subject.
  const { data: bp } = await supabaseAdmin
    .from("brand_profiles")
    .select("brand_name, brand_identity, brand_website")
    .eq("id", outreach.brand_profile_id)
    .single();
  const brandProfile = bp as Partial<BrandProfile> | null;
  const brandName =
    brandNameFromProfile((brandProfile ?? {}) as BrandProfile) || "A brand";

  const rendered = renderMagicLinkEmail({
    to_email: recipient,
    brand_name: brandName,
    show_name: outreach.show_name,
    magic_link_url: magicUrl,
  });

  const sendResult = await sendEmail({
    to: recipient,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    from: EMAIL_FROM_AUTH,
    // Show setup links must reach the real address, including for a managed brand.
    bypassManagedReroute: true,
  });
  if (!sendResult.ok) {
    console.error("[magic.start] send failed:", sendResult.reason ?? "send_failed");
  }

  return NextResponse.json({ ok: true });
}
