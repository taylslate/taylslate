// POST /api/webhooks/docusign
// DocuSign Connect webhook — authoritative source for envelope state changes.
// Verifies HMAC, classifies the event, updates the deal, fires domain events,
// uploads signed PDF + certificate to Supabase storage on completion.

import { NextRequest, NextResponse } from "next/server";
import {
  classifyEvent,
  parseDocuSignEvent,
  verifyDocuSignSignature,
} from "@/lib/docusign/webhook";
import {
  downloadCertificate,
  downloadCompletedDocument,
} from "@/lib/docusign/envelope";
import {
  getOutreachById,
  getWave12DealByEnvelopeId,
  updateWave12Deal,
} from "@/lib/data/queries";
import { logEvent } from "@/lib/data/events";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  renderShowCountersignatureRequest,
} from "@/lib/email/templates/show-countersignature-request";
import {
  renderDealCancelledShow,
} from "@/lib/email/templates/deal-cancelled-show";
import { sendEmail } from "@/lib/email/send";
import { createSetupIntentForBrand } from "@/lib/stripe/setup-intent";
import type { BrandProfile, ShowProfile } from "@/lib/data/types";

const STORAGE_BUCKET = "signed-ios";

function getSignatureHeader(req: NextRequest): string | null {
  // DocuSign Connect sends X-DocuSign-Signature-1 (and -2, -3 if multiple
  // active secrets are configured). We try the first; webhook helper accepts
  // any single match.
  const headers = req.headers;
  return (
    headers.get("x-docusign-signature-1") ??
    headers.get("X-DocuSign-Signature-1") ??
    null
  );
}

async function uploadToBucket(
  bucket: string,
  path: string,
  buffer: Buffer,
  contentType: string
): Promise<string | null> {
  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(path, new Uint8Array(buffer), {
      contentType,
      upsert: true,
    });
  if (error) {
    console.error("[docusign webhook] storage upload failed:", error.message, path);
    return null;
  }
  return path;
}

/**
 * Wave 13 hook — fired additively after `brand_signed` lands. Looks up
 * the brand's profile, creates a Stripe SetupIntent so the brand UI can
 * collect a card on file, and persists the SetupIntent id + client
 * secret onto the deal. Best-effort: a SetupIntent failure must NOT
 * roll back the brand_signed transition (the deal is still legitimately
 * signed; we just need to ask for a card again later).
 */
async function provisionBrandSetupIntent(
  dealId: string,
  brandProfileId: string | null
): Promise<void> {
  if (!brandProfileId) {
    console.warn(
      `[docusign webhook] brand_signed deal ${dealId} has no brand_profile_id; skipping SetupIntent provisioning`
    );
    return;
  }
  const { data: bp, error: bpErr } = await supabaseAdmin
    .from("brand_profiles")
    .select("id,user_id,brand_identity")
    .eq("id", brandProfileId)
    .single<{ id: string; user_id: string; brand_identity: string | null }>();
  if (bpErr || !bp) {
    console.error(
      `[docusign webhook] failed to load brand_profile ${brandProfileId} for SetupIntent on deal ${dealId}:`,
      bpErr?.message
    );
    return;
  }
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("id,email,full_name,company_name,stripe_customer_id")
    .eq("id", bp.user_id)
    .single<{
      id: string;
      email: string;
      full_name: string | null;
      company_name: string | null;
      stripe_customer_id: string | null;
    }>();
  if (profileErr || !profile) {
    console.error(
      `[docusign webhook] failed to load profile ${bp.user_id} for SetupIntent on deal ${dealId}:`,
      profileErr?.message
    );
    return;
  }

  try {
    const result = await createSetupIntentForBrand({
      profile: {
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        company_name: profile.company_name ?? bp.brand_identity ?? null,
        stripe_customer_id: profile.stripe_customer_id,
      },
      dealId,
    });
    const { error: updErr } = await supabaseAdmin
      .from("deals")
      .update({
        setup_intent_id: result.setupIntentId,
        setup_intent_client_secret: result.clientSecret,
      })
      .eq("id", dealId);
    if (updErr) {
      console.error(
        `[docusign webhook] failed to persist SetupIntent ${result.setupIntentId} on deal ${dealId}:`,
        updErr.message
      );
      return;
    }
    await logEvent({
      eventType: "deal.setup_intent_created",
      entityType: "deal",
      entityId: dealId,
      payload: {
        setup_intent_id: result.setupIntentId,
        stripe_customer_id: result.stripeCustomerId,
        profile_id: profile.id,
      },
    });
  } catch (err) {
    // Never let a SetupIntent failure block the signing pipeline. The
    // deal can prompt the brand for a card later via the dashboard.
    console.error(
      `[docusign webhook] createSetupIntentForBrand failed for deal ${dealId}:`,
      err instanceof Error ? err.message : err
    );
  }
}

async function notifyShowOfBrandSignature(dealId: string): Promise<void> {
  const { data: deal } = await supabaseAdmin
    .from("deals")
    .select("*")
    .eq("id", dealId)
    .single();
  if (!deal) return;

  const outreach = await getOutreachById(deal.outreach_id);
  const { data: bp } = await supabaseAdmin
    .from("brand_profiles")
    .select("brand_identity, brand_website")
    .eq("id", deal.brand_profile_id)
    .single();
  const { data: sp } = await supabaseAdmin
    .from("show_profiles")
    .select("user_id, show_name")
    .eq("id", deal.show_profile_id)
    .single();
  if (!sp) return;
  const { data: showUser } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", (sp as ShowProfile).user_id)
    .single();
  if (!showUser?.email) return;

  const brandName =
    (bp as BrandProfile | null)?.brand_identity?.split(/[.,—–-]/)[0]?.trim() ||
    (bp as BrandProfile | null)?.brand_website ||
    "The brand";

  const email = renderShowCountersignatureRequest({
    brand_name: brandName,
    show_name: (sp as ShowProfile).show_name ?? outreach?.show_name ?? "your show",
    agreed_cpm: deal.agreed_cpm,
    agreed_episode_count: deal.agreed_episode_count,
  });
  sendEmail({
    to: showUser.email as string,
    subject: email.subject,
    html: email.html,
    text: email.text,
  }).catch((err) => console.error("[show countersign email] send failed:", err));
}

async function notifyShowOfCancellation(
  dealId: string,
  reason: string | undefined
): Promise<void> {
  const { data: deal } = await supabaseAdmin
    .from("deals")
    .select("*")
    .eq("id", dealId)
    .single();
  if (!deal) return;

  const outreach = await getOutreachById(deal.outreach_id);
  const { data: bp } = await supabaseAdmin
    .from("brand_profiles")
    .select("brand_identity, brand_website")
    .eq("id", deal.brand_profile_id)
    .single();
  const { data: sp } = await supabaseAdmin
    .from("show_profiles")
    .select("user_id")
    .eq("id", deal.show_profile_id)
    .single();
  if (!sp) return;
  const { data: showUser } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", (sp as ShowProfile).user_id)
    .single();
  if (!showUser?.email) return;
  const brandName =
    (bp as BrandProfile | null)?.brand_identity?.split(/[.,—–-]/)[0]?.trim() ||
    (bp as BrandProfile | null)?.brand_website ||
    "The brand";

  const email = renderDealCancelledShow({
    brand_name: brandName,
    show_name: outreach?.show_name ?? "your show",
    reason: reason ?? null,
    cause: "brand_cancelled",
  });
  sendEmail({
    to: showUser.email as string,
    subject: email.subject,
    html: email.html,
    text: email.text,
  }).catch((err) => console.error("[show cancel email] send failed:", err));
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const ok = verifyDocuSignSignature(
    rawBody,
    getSignatureHeader(request),
    process.env.DOCUSIGN_WEBHOOK_SECRET
  );
  if (!ok) {
    console.warn("[docusign webhook] signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const evt = parseDocuSignEvent(payload);
  if (!evt) return NextResponse.json({ ok: true, ignored: "unparseable" });

  const deal = await getWave12DealByEnvelopeId(evt.envelopeId);
  if (!deal) {
    // Webhook may arrive for envelopes we no longer track (test envelopes,
    // legacy deals). Acknowledge so DocuSign stops retrying.
    return NextResponse.json({ ok: true, ignored: "no_matching_deal" });
  }

  const action = classifyEvent(evt);

  if (action.kind === "brand_signed") {
    if (deal.brand_signed_at) {
      return NextResponse.json({ ok: true, idempotent: true });
    }
    await updateWave12Deal(deal.id, {
      status: "brand_signed",
      brand_signed_at: action.signedAt,
    });
    await logEvent({
      eventType: "io.brand_signed",
      entityType: "deal",
      entityId: deal.id,
      payload: { envelope_id: evt.envelopeId, signed_at: action.signedAt },
    });
    await notifyShowOfBrandSignature(deal.id);
    // Wave 13 — provision a SetupIntent so the brand can save a card on
    // file. Additive: this never throws and never alters the signing
    // state, even if Stripe is unreachable.
    await provisionBrandSetupIntent(deal.id, deal.brand_profile_id ?? null);
    return NextResponse.json({ ok: true });
  }

  if (action.kind === "show_signed" || action.kind === "completed") {
    if (deal.show_signed_at && deal.signed_io_pdf_url) {
      return NextResponse.json({ ok: true, idempotent: true });
    }
    // Download the signed PDF and certificate of completion. These are the
    // permanent record we keep — DocuSign retention isn't infinite.
    let signedPath: string | null = null;
    let certPath: string | null = null;
    try {
      const [signedPdf, certificate] = await Promise.all([
        downloadCompletedDocument(evt.envelopeId),
        downloadCertificate(evt.envelopeId),
      ]);
      signedPath = await uploadToBucket(
        STORAGE_BUCKET,
        `deals/${deal.id}/signed-io.pdf`,
        signedPdf,
        "application/pdf"
      );
      certPath = await uploadToBucket(
        STORAGE_BUCKET,
        `deals/${deal.id}/certificate.pdf`,
        certificate,
        "application/pdf"
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      console.error("[docusign webhook] download failed:", message);
      // Continue anyway — we still record the signature event so the deal
      // doesn't stay stuck. A reconciliation job can re-fetch later.
    }

    await updateWave12Deal(deal.id, {
      status: "show_signed",
      show_signed_at: action.signedAt,
      signed_io_pdf_url: signedPath,
      signature_certificate_url: certPath,
    });
    await logEvent({
      eventType: "io.show_signed",
      entityType: "deal",
      entityId: deal.id,
      payload: {
        envelope_id: evt.envelopeId,
        signed_at: action.signedAt,
        signed_io_pdf_url: signedPath,
        signature_certificate_url: certPath,
      },
    });
    await logEvent({
      eventType: "io.completed",
      entityType: "deal",
      entityId: deal.id,
      payload: { envelope_id: evt.envelopeId },
    });
    return NextResponse.json({ ok: true });
  }

  if (action.kind === "declined" || action.kind === "voided") {
    if (deal.status === "cancelled") {
      return NextResponse.json({ ok: true, idempotent: true });
    }
    await updateWave12Deal(deal.id, {
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancellation_reason: action.reason ?? `DocuSign ${action.kind}`,
    });
    await logEvent({
      eventType: "io.declined",
      entityType: "deal",
      entityId: deal.id,
      payload: {
        envelope_id: evt.envelopeId,
        kind: action.kind,
        reason: action.reason ?? null,
      },
    });
    await notifyShowOfCancellation(deal.id, action.reason);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true, ignored: action.kind });
}
