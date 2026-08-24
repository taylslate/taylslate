// POST /api/deals/[id]/setup-intent
// Brand-only recovery/confirm path for the deal card-on-file SetupIntent.
//
// The AUTHORITATIVE creation path is the DocuSign Connect webhook, which
// provisions a SetupIntent server-side the moment the brand signs
// (lib/docusign webhook → provisionBrandSetupIntent). That is best-effort: if
// Stripe was unreachable at signature time, deals.setup_intent_client_secret
// stays null and the brand UI would otherwise dead-end. This route lets the
// brand UI (re)obtain a client secret without a second signature:
//
//   - reuse the existing SetupIntent when it's still open
//     (requires_payment_method / requires_confirmation / requires_action /
//     processing), keeping deals.setup_intent_client_secret in sync;
//   - backfill payment_method_id if the SetupIntent already succeeded but the
//     webhook lagged;
//   - otherwise create a fresh SetupIntent (metadata { profile_id, deal_id },
//     usage=off_session) via the shared createSetupIntentForBrand helper.
//
// A card capture NEVER charges and NEVER creates a subscription. Gate: the
// brand must have signed the IO (unsigned IO cannot create a SetupIntent).

import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  getBrandProfileByUserId,
  getWave12DealById,
} from "@/lib/data/queries";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";
import { createSetupIntentForBrand } from "@/lib/stripe/setup-intent";
import { logEvent } from "@/lib/data/events";

export const runtime = "nodejs";

// SetupIntent statuses where the SAME intent can still be confirmed by the
// brand — reuse it rather than minting a duplicate.
const REUSABLE_STATUSES = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "processing",
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const deal = await getWave12DealById(id);
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

  const brandProfile = await getBrandProfileByUserId(user.id);
  if (!brandProfile || brandProfile.id !== deal.brand_profile_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Eligibility — the IO must be signed by the brand before a card is collected.
  if (!deal.brand_signed_at) {
    return NextResponse.json(
      { error: "The IO must be signed before adding a card on file." },
      { status: 409 }
    );
  }

  // Already have a confirmed card on this deal — nothing to do.
  if (deal.payment_method_id) {
    return NextResponse.json({
      status: "already_saved",
      payment_method_id: deal.payment_method_id,
    });
  }

  // ---- Reuse an existing SetupIntent when possible ----
  if (deal.setup_intent_id) {
    try {
      const existing = await stripe.setupIntents.retrieve(deal.setup_intent_id);
      // Strict ownership guard — only reuse/backfill a SetupIntent that Stripe
      // confirms belongs to THIS deal. A drifted deals.setup_intent_id (e.g. a
      // stale same-mode id from another deal on the same profile) must never
      // bind that card here; fall through and mint a fresh, correctly-tagged
      // SetupIntent instead. Money path — trust Stripe metadata, not our column.
      if (existing.metadata?.deal_id !== deal.id) {
        console.warn(
          `[deals/setup-intent] setup_intent ${existing.id} metadata.deal_id=${existing.metadata?.deal_id ?? "null"} != deal ${deal.id} — ignoring stored id, creating fresh`
        );
      } else if (existing.status === "succeeded") {
        const pmId =
          typeof existing.payment_method === "string"
            ? existing.payment_method
            : existing.payment_method?.id ?? null;
        if (pmId) {
          // Webhook lagged — backfill so the deal reflects the saved card.
          await supabaseAdmin
            .from("deals")
            .update({ payment_method_id: pmId })
            .eq("id", deal.id);
        }
        return NextResponse.json({ status: "already_saved", payment_method_id: pmId });
      } else if (existing.client_secret && REUSABLE_STATUSES.has(existing.status)) {
        if (deal.setup_intent_client_secret !== existing.client_secret) {
          await supabaseAdmin
            .from("deals")
            .update({ setup_intent_client_secret: existing.client_secret })
            .eq("id", deal.id);
        }
        return NextResponse.json({
          status: "reused",
          client_secret: existing.client_secret,
          setup_intent_id: existing.id,
        });
      }
      // canceled / other terminal state → fall through and create a fresh one.
    } catch (err) {
      // Stale id or test/live mode mismatch — don't fail the brand; create anew.
      console.warn(
        `[deals/setup-intent] retrieve ${deal.setup_intent_id} failed, creating fresh:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // ---- Create a fresh SetupIntent ----
  const { data: profile, error: profErr } = await supabaseAdmin
    .from("profiles")
    .select("id,email,full_name,company_name,stripe_customer_id")
    .eq("id", user.id)
    .single<{
      id: string;
      email: string;
      full_name: string | null;
      company_name: string | null;
      stripe_customer_id: string | null;
    }>();
  if (profErr || !profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 500 });
  }

  try {
    const result = await createSetupIntentForBrand({
      profile: {
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        company_name: profile.company_name ?? brandProfile.brand_identity ?? null,
        stripe_customer_id: profile.stripe_customer_id,
      },
      dealId: deal.id,
    });
    const { error: updErr } = await supabaseAdmin
      .from("deals")
      .update({
        setup_intent_id: result.setupIntentId,
        setup_intent_client_secret: result.clientSecret,
      })
      .eq("id", deal.id);
    if (updErr) {
      return NextResponse.json(
        { error: `Couldn't persist card setup — ${updErr.message}` },
        { status: 500 }
      );
    }
    await logEvent({
      eventType: "deal.setup_intent_created",
      entityType: "deal",
      entityId: deal.id,
      actorId: user.id,
      payload: {
        setup_intent_id: result.setupIntentId,
        stripe_customer_id: result.stripeCustomerId,
        profile_id: profile.id,
        source: "brand_recovery",
      },
    });
    return NextResponse.json({
      status: "created",
      client_secret: result.clientSecret,
      setup_intent_id: result.setupIntentId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stripe error";
    console.error("[deals/setup-intent] create failed:", message);
    return NextResponse.json(
      { error: `Couldn't start card setup — ${message}` },
      { status: 502 }
    );
  }
}
