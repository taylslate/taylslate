// Aircheck step 3. A person confirms or rejects one stored aircheck.
// Confirm delivers the IO line and charges through deliverAndChargeLine.
// Reject stores the decision and does not charge.
// A match_result is not a decision: this module never runs on its own.

import { logEvent } from "@/lib/data/events";
import { deliverAndChargeLine } from "@/lib/delivery/mark-delivered";
import type { ChargeForEpisodeResult } from "@/lib/stripe/payment-intent";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  findAircheckByLine,
  saveAircheckReview,
} from "./store";
import type { AircheckRow } from "./types";

export class AircheckReviewNotFound extends Error {
  readonly status = 404;
  constructor(message: string) {
    super(message);
    this.name = "AircheckReviewNotFound";
  }
}

export class AircheckReviewConflict extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "AircheckReviewConflict";
  }
}

export type ConfirmAircheckResult =
  | {
      ok: true;
      alreadyCharged: boolean;
      aircheck: AircheckRow;
      charge: ChargeForEpisodeResult | null;
    }
  | {
      ok: false;
      aircheck: AircheckRow;
      chargeError: string;
    };

interface DecideInput {
  ioLineItemId: string;
  /** Internal admin email. Stored on the row when a decision completes. */
  decidedBy: string;
  actorId?: string | null;
}

interface RejectInput extends DecideInput {
  reason?: string | null;
}

function cleanReason(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim() ?? "";
  if (!trimmed) return null;
  return trimmed.slice(0, 500);
}

/**
 * True when a non-failed PaymentIntent is already stored for the line.
 * Same gate chargeForEpisode uses before it creates another charge,
 * keyed by the line because each line belongs to one deal.
 */
async function lineAlreadyCharged(ioLineItemId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("payments")
    .select("id")
    .eq("io_line_item_id", ioLineItemId)
    .neq("status", "failed")
    .not("stripe_payment_intent_id", "is", null)
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (error) {
    throw new Error(
      `Failed to check for an existing payment on line ${ioLineItemId}: ${error.message}`
    );
  }
  return data != null;
}

async function requireAircheck(ioLineItemId: string): Promise<AircheckRow> {
  const row = await findAircheckByLine(ioLineItemId);
  if (!row) {
    throw new AircheckReviewNotFound(
      "No aircheck is stored for this line."
    );
  }
  return row;
}

function chargeFailureMessage(result: {
  chargeError: string;
  rollbackError?: string;
}): string {
  if (!result.rollbackError) return result.chargeError;
  return `${result.chargeError} Delivery rollback failed: ${result.rollbackError}`;
}

export async function confirmAircheck(
  input: DecideInput
): Promise<ConfirmAircheckResult> {
  const existing = await requireAircheck(input.ioLineItemId);
  if (existing.review_decision === "confirmed") {
    return {
      ok: true,
      alreadyCharged: true,
      aircheck: existing,
      charge: null,
    };
  }

  if (await lineAlreadyCharged(input.ioLineItemId)) {
    const aircheck = await saveAircheckReview(input.ioLineItemId, {
      review_decision: "confirmed",
      review_reason: null,
      decided_by: input.decidedBy,
      decided_at: new Date().toISOString(),
      charge_error: null,
    });
    await logEvent({
      eventType: "aircheck.confirmed",
      entityType: "aircheck",
      entityId: aircheck.id,
      actorId: input.actorId ?? null,
      payload: {
        io_line_item_id: input.ioLineItemId,
        decided_by: input.decidedBy,
        already_charged: true,
      },
    });
    return { ok: true, alreadyCharged: true, aircheck, charge: null };
  }

  const delivered = await deliverAndChargeLine({
    ioLineItemId: input.ioLineItemId,
  });
  if (!delivered.ok) {
    if (delivered.status === 404) {
      throw new AircheckReviewNotFound(delivered.error);
    }
    if (delivered.status !== 502) {
      throw new Error(delivered.error);
    }
    const chargeError = chargeFailureMessage(delivered);
    const aircheck = await saveAircheckReview(input.ioLineItemId, {
      charge_error: chargeError,
    });
    return { ok: false, aircheck, chargeError };
  }

  const aircheck = await saveAircheckReview(input.ioLineItemId, {
    review_decision: "confirmed",
    review_reason: null,
    decided_by: input.decidedBy,
    decided_at: new Date().toISOString(),
    charge_error: null,
  });
  await logEvent({
    eventType: "aircheck.confirmed",
    entityType: "aircheck",
    entityId: aircheck.id,
    actorId: input.actorId ?? null,
    payload: {
      io_line_item_id: input.ioLineItemId,
      decided_by: input.decidedBy,
      already_charged: false,
      payment_id: delivered.charge.paymentId,
      stripe_payment_intent_id: delivered.charge.stripePaymentIntentId,
    },
  });
  return {
    ok: true,
    alreadyCharged: false,
    aircheck,
    charge: delivered.charge,
  };
}

export async function rejectAircheck(input: RejectInput): Promise<AircheckRow> {
  const existing = await requireAircheck(input.ioLineItemId);
  if (
    existing.review_decision === "confirmed" ||
    (await lineAlreadyCharged(input.ioLineItemId))
  ) {
    throw new AircheckReviewConflict("This line is already charged.");
  }

  const reason = cleanReason(input.reason);
  const aircheck = await saveAircheckReview(input.ioLineItemId, {
    review_decision: "rejected",
    review_reason: reason,
    decided_by: input.decidedBy,
    decided_at: new Date().toISOString(),
    charge_error: null,
  });
  await logEvent({
    eventType: "aircheck.rejected",
    entityType: "aircheck",
    entityId: aircheck.id,
    actorId: input.actorId ?? null,
    payload: {
      io_line_item_id: input.ioLineItemId,
      decided_by: input.decidedBy,
      reason,
    },
  });
  return aircheck;
}
