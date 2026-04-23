// DocuSign Connect webhook helpers.
//
// HMAC verification: DocuSign signs each webhook payload with one or more
// hmac secrets configured in their dashboard. They send the signatures in
// `X-DocuSign-Signature-1`, `X-DocuSign-Signature-2`, etc. We verify the
// payload against `DOCUSIGN_WEBHOOK_SECRET` and accept if any header matches.
// Header name is case-insensitive per HTTP spec.
//
// Payload parsing: we only care about the envelope status and recipients
// status. The "data" field of the JSON payload contains envelopeSummary;
// the "event" field tells us why DocuSign is calling us.

import { createHmac, timingSafeEqual } from "node:crypto";

export interface DocuSignEvent {
  /** Top-level event name like "envelope-completed" or "recipient-completed". */
  event: string;
  /** Envelope GUID. */
  envelopeId: string;
  /** Status from envelopeSummary, e.g. "completed", "declined", "voided", "sent". */
  envelopeStatus: string;
  /** Per-recipient signed timestamps. Keyed by recipientId. */
  recipientSignedAt: Record<string, string | undefined>;
  /** Reason DocuSign provides on declined/voided envelopes. */
  voidedReason?: string;
}

/**
 * Verify the HMAC signature on a DocuSign Connect payload. Returns true
 * if the secret matches at least one signature header. Constant-time
 * comparison via crypto.timingSafeEqual.
 */
export function verifyDocuSignSignature(
  rawBody: string,
  headerValue: string | null | undefined,
  secret: string | undefined
): boolean {
  if (!secret || !headerValue) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");

  // DocuSign sometimes URL-encodes the base64 padding.
  const provided = headerValue.trim();
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  try {
    return timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    return false;
  }
}

/**
 * Parse a Connect "JSON SIM" payload into the subset of fields we need.
 * The full schema is huge; we extract just envelopeId, status, signed
 * timestamps per recipient, and voided reason.
 */
export function parseDocuSignEvent(payload: unknown): DocuSignEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const event = typeof p.event === "string" ? p.event : "";
  const data = (p.data as Record<string, unknown> | undefined) ?? {};
  const summary =
    (data.envelopeSummary as Record<string, unknown> | undefined) ??
    (p.envelopeSummary as Record<string, unknown> | undefined) ??
    {};
  const envelopeId =
    (data.envelopeId as string | undefined) ??
    (summary.envelopeId as string | undefined) ??
    "";
  const envelopeStatus = (summary.status as string | undefined) ?? "";
  const voidedReason = summary.voidedReason as string | undefined;

  // Recipients signed-at timestamps live in summary.recipients.signers[].
  const recipients = (summary.recipients as Record<string, unknown> | undefined) ?? {};
  const signers = (recipients.signers as Array<Record<string, unknown>> | undefined) ?? [];
  const recipientSignedAt: Record<string, string | undefined> = {};
  for (const s of signers) {
    const id = String(s.recipientId ?? "");
    const signedAt = s.signedDateTime as string | undefined;
    if (id) recipientSignedAt[id] = signedAt;
  }

  if (!envelopeId || !event) return null;
  return { event, envelopeId, envelopeStatus, recipientSignedAt, voidedReason };
}

/** Map a DocuSign event/status combo to the canonical action we should take. */
export type WebhookAction =
  | { kind: "brand_signed"; signedAt: string }
  | { kind: "show_signed"; signedAt: string }
  | { kind: "completed"; signedAt: string }
  | { kind: "declined"; reason?: string }
  | { kind: "voided"; reason?: string }
  | { kind: "ignored" };

export function classifyEvent(evt: DocuSignEvent): WebhookAction {
  // Recipient 1 = brand (routingOrder 1), recipient 2 = show.
  if (evt.envelopeStatus === "voided") {
    return { kind: "voided", reason: evt.voidedReason };
  }
  if (evt.envelopeStatus === "declined") {
    return { kind: "declined", reason: evt.voidedReason };
  }
  if (evt.envelopeStatus === "completed") {
    const showSigned = evt.recipientSignedAt["2"];
    return { kind: "completed", signedAt: showSigned ?? new Date().toISOString() };
  }
  // Recipient-level events for partial signatures.
  if (evt.event === "recipient-completed" || evt.event === "recipient-finished") {
    const brandSigned = evt.recipientSignedAt["1"];
    const showSigned = evt.recipientSignedAt["2"];
    if (showSigned) return { kind: "show_signed", signedAt: showSigned };
    if (brandSigned) return { kind: "brand_signed", signedAt: brandSigned };
  }
  return { kind: "ignored" };
}
