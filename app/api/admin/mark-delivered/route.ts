// POST /api/admin/mark-delivered
//
// Internal-admin stub for "Podscribe says this episode delivered" — flips
// `io_line_items.verified = true`, stamps `actual_post_date`, and fires a
// `chargeForEpisode` against the brand's card.
//
// Auth: INTERNAL_ADMIN_EMAILS (comma-separated allowlist) only. There is
// NO public-facing path to this; brands trigger charges through
// /api/deals/[id]/charge-episode. This endpoint is the temporary harness
// for ops + the future Podscribe webhook target.
//
// TODO(post-Wave-13): replace with the real Podscribe verification
// webhook handler. Same DB writes, same chargeForEpisode call — but the
// auth boundary becomes Podscribe's HMAC signature instead of an email
// allowlist.

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { chargeForEpisode } from "@/lib/stripe/payment-intent";

export const runtime = "nodejs";

interface MarkDeliveredBody {
  ioLineItemId?: string;
  actualPostDate?: string;
  actualDownloads?: number;
}

interface IoLineItemRow {
  id: string;
  io_id: string;
  verified: boolean;
  actual_post_date: string | null;
  actual_downloads: number | null;
}

interface IoRow {
  id: string;
  deal_id: string;
}

function isInternalAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.INTERNAL_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isInternalAdmin(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: MarkDeliveredBody;
  try {
    body = (await request.json()) as MarkDeliveredBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.ioLineItemId || typeof body.ioLineItemId !== "string") {
    return NextResponse.json(
      { error: "ioLineItemId is required" },
      { status: 400 }
    );
  }

  // Load the line item to discover its parent IO → deal.
  const { data: lineItem, error: liErr } = await supabaseAdmin
    .from("io_line_items")
    .select("id,io_id,verified,actual_post_date,actual_downloads")
    .eq("id", body.ioLineItemId)
    .single<IoLineItemRow>();
  if (liErr || !lineItem) {
    return NextResponse.json(
      { error: `IO line item ${body.ioLineItemId} not found` },
      { status: 404 }
    );
  }

  const { data: io, error: ioErr } = await supabaseAdmin
    .from("insertion_orders")
    .select("id,deal_id")
    .eq("id", lineItem.io_id)
    .single<IoRow>();
  if (ioErr || !io) {
    return NextResponse.json(
      { error: `Insertion order ${lineItem.io_id} not found` },
      { status: 404 }
    );
  }

  // Mark delivered. We always write `verified = true`; date/downloads
  // fall back to the existing values if the caller didn't pass them.
  const updates: Record<string, unknown> = { verified: true };
  if (body.actualPostDate) {
    updates.actual_post_date = body.actualPostDate;
  } else if (!lineItem.actual_post_date) {
    updates.actual_post_date = new Date().toISOString().slice(0, 10);
  }
  if (Number.isFinite(body.actualDownloads)) {
    updates.actual_downloads = body.actualDownloads;
  }
  const { error: updErr } = await supabaseAdmin
    .from("io_line_items")
    .update(updates)
    .eq("id", lineItem.id);
  if (updErr) {
    return NextResponse.json(
      { error: `Failed to mark delivered: ${updErr.message}` },
      { status: 500 }
    );
  }

  // Trigger the charge. Idempotency lives in the helper — if this line
  // item was already charged we'll get the same PaymentIntent back.
  try {
    const charge = await chargeForEpisode({
      dealId: io.deal_id,
      ioLineItemId: lineItem.id,
    });
    return NextResponse.json({ ok: true, charge });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Charge failed";
    console.error(
      `[admin/mark-delivered] deal ${io.deal_id} line ${lineItem.id}:`,
      message
    );
    return NextResponse.json(
      { ok: true, charge: null, chargeError: message },
      { status: 502 }
    );
  }
}
