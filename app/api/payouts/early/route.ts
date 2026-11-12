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
import { rejectSwitchedViewMoneyAction } from "@/lib/admin/view-guard";

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

function json(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function refusal(err: unknown): { status: number; error: string } | null {
  const name = err instanceof Error ? err.name : "";
  if (name === "PayoutHeldError") {
    return { status: 409, error: "Verify you own this show to get paid." };
  }
  if (name === "PayoutAlreadyExistsError") {
    return { status: 409, error: "This payout is already on its way." };
  }
  return null;
}

export async function POST(request: NextRequest) {
  const blocked = await rejectSwitchedViewMoneyAction(request);
  if (blocked) {
    blocked.headers.set("Cache-Control", "no-store");
    return blocked;
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: EarlyPayoutBody;
  try {
    body = (await request.json()) as EarlyPayoutBody;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!body.paymentId || typeof body.paymentId !== "string") {
    return json({ error: "paymentId is required" }, 400);
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
    return json({ error: "Payment not found" }, 404);
  }
  if (!payment.deal_id) {
    return json(
      { error: "Payment has no associated deal; cannot route early payout" },
      400
    );
  }

  const { data: deal, error: dErr } = await supabaseAdmin
    .from("deals")
    .select("id,show_profile_id")
    .eq("id", payment.deal_id)
    .single<DealRow>();
  if (dErr || !deal || !deal.show_profile_id) {
    return json({ error: "Deal not found or has no show_profile_id" }, 404);
  }

  const { data: sp, error: spErr } = await supabaseAdmin
    .from("show_profiles")
    .select("id,user_id")
    .eq("id", deal.show_profile_id)
    .single<ShowProfileRow>();
  if (spErr || !sp) {
    return json({ error: "Show profile not found" }, 404);
  }
  if (sp.user_id !== user.id) {
    return json({ error: "Forbidden" }, 403);
  }

  try {
    const result = await transferEarlyPayoutForPayment(
      payment.id,
      EARLY_PAYOUT_FEE_PERCENTAGE
    );
    return json(result);
  } catch (err) {
    const known = refusal(err);
    if (known) return json({ error: known.error }, known.status);
    const name = err instanceof Error ? err.name : "Error";
    console.error("[payouts/early]", /^[A-Za-z0-9_]+$/.test(name) ? name : "Error");
    return json({ error: "Couldn't send the early payout." }, 502);
  }
}
