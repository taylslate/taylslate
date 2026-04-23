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
