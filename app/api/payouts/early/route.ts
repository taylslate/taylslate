// POST /api/payouts/early
//
// Show requests early payout (within the settle window) for a flat fee.
// Body: `{ paymentId: string }`. Auth: the show user that owns the
// connected account that would receive the transfer.
//
// Refuses if:
//   - The payment hasn't settled (settled_at IS NULL)
//   - A payout already exists for this payment (auto-payout fired, or
//     duplicate request)

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { transferEarlyPayoutForPayment } from "@/lib/payouts/transfer";
import { EARLY_PAYOUT_FEE_PERCENTAGE } from "@/lib/payouts/constants";

export const runtime = "nodejs";

interface EarlyPayoutBody {
  paymentId?: string;
}

interface PaymentRow {
  id: string;
  deal_id: string | null;
}

interface DealRow {
  id: string;
  show_profile_id: string | null;
}

interface ShowProfileRow {
  id: string;
  user_id: string;
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: EarlyPayoutBody;
  try {
    body = (await request.json()) as EarlyPayoutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.paymentId || typeof body.paymentId !== "string") {
    return NextResponse.json({ error: "paymentId is required" }, { status: 400 });
  }

  // Resolve payment → deal → show_profile → user. We authorise BEFORE
  // calling the transfer helper so we never log a request the caller
  // wasn't allowed to make.
  const { data: payment, error: pErr } = await supabaseAdmin
    .from("payments")
    .select("id,deal_id")
    .eq("id", body.paymentId)
    .single<PaymentRow>();
  if (pErr || !payment) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }
  if (!payment.deal_id) {
    return NextResponse.json(
      { error: "Payment has no associated deal; cannot route early payout" },
      { status: 400 }
    );
  }

  const { data: deal, error: dErr } = await supabaseAdmin
    .from("deals")
    .select("id,show_profile_id")
    .eq("id", payment.deal_id)
    .single<DealRow>();
  if (dErr || !deal || !deal.show_profile_id) {
    return NextResponse.json(
      { error: "Deal not found or has no show_profile_id" },
      { status: 404 }
    );
  }

  const { data: sp, error: spErr } = await supabaseAdmin
    .from("show_profiles")
    .select("id,user_id")
    .eq("id", deal.show_profile_id)
    .single<ShowProfileRow>();
  if (spErr || !sp) {
    return NextResponse.json(
      { error: "Show profile not found" },
      { status: 404 }
    );
  }
  if (sp.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await transferEarlyPayoutForPayment(
      payment.id,
      EARLY_PAYOUT_FEE_PERCENTAGE
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Early payout failed";
    console.error(
      `[payouts/early] payment ${payment.id}:`,
      message
    );
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
