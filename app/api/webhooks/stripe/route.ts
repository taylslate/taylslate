// POST /api/webhooks/stripe
//
// Stripe Connect/Payments webhooks land here. The route is intentionally
// thin: it reads the raw body (HMAC verification needs unparsed bytes),
// hands off to verifyAndHandleStripeEvent for signature check + dispatch,
// and translates outcomes to HTTP status codes.
//
// runtime = "nodejs" is mandatory — the Stripe SDK is loaded via runtime
// require behind (0,eval) and cannot run on the Edge runtime.

import { NextRequest, NextResponse } from "next/server";
import { verifyAndHandleStripeEvent } from "@/lib/stripe/webhook";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  // Stripe verifies HMAC against the exact bytes it sent — calling
  // request.json() here would re-serialize and break the signature.
  const rawBody = await request.text();
  const signatureHeader =
    request.headers.get("stripe-signature") ??
    request.headers.get("Stripe-Signature");

  try {
    const result = await verifyAndHandleStripeEvent({
      rawBody,
      signatureHeader,
    });
    return NextResponse.json({
      ok: true,
      eventId: result.eventId,
      eventType: result.eventType,
      handled: result.handled,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    // verifyAndHandleStripeEvent throws on bad signature or missing
    // header/secret — that's the 400 path. Handler-level errors are
    // caught inside the verifier itself and never bubble up here, so
    // anything we catch here is a setup or signature failure.
    console.error("[stripe webhook] rejecting:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
