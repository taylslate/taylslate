// Aircheck step 3. A person confirms or rejects one stored aircheck.
// Confirm delivers the IO line and charges through deliverAndChargeLine.
// Reject stores the decision and does not charge.
// A match_result is not a decision: this module never runs on its own.
// Confirm and reject both claim the row first so two clicks cannot both
// reach the delivery write. The cron does not call this module.

import { logEvent } from "@/lib/data/events";
import { deliverAndChargeLine } from "@/lib/delivery/mark-delivered";
import type { ChargeForEpisodeResult } from "@/lib/stripe/payment-intent";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runMakeGoodDetectionHook } from "./detect";
import { confirmDealEligibility, confirmEligibility } from "./eligibility";
import {
  claimAircheckConfirm,
  loadAircheckLineDeal,
  releaseAircheckConfirm,
  saveAircheckConfirmedIfUndecided,
  saveAircheckReview,
  findAircheckByLine,
  type AircheckLineDeal,
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

export class AircheckConfirmInProgress extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "AircheckConfirmInProgress";
  }
}

export class AircheckConfirmUnavailable extends Error {
  readonly status = 503;
  constructor(
    message = "Confirm is unavailable until migration 080 is applied."
  ) {
    super(message);
    this.name = "AircheckConfirmUnavailable";
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

const REJECTED_FINAL =
  "This line was rejected. Reopening a rejected line is not supported.";

const IN_PROGRESS = "This line is already being reviewed.";

const ALREADY_DECIDED =
  "This line was already decided. No new charge was made.";

const DECIDED_DURING_CHARGE =
  "This line was decided while it was being charged. The charge stands. Check this line before doing anything else.";

function cleanReason(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim() ?? "";
  if (!trimmed) return null;
  return trimmed.slice(0, 500);
}

function isClaimColumnMissing(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code =
    "code" in err && typeof err.code === "string" ? err.code : "";
  const message = err instanceof Error ? err.message : "";
  return (
    code === "42703" ||
    code === "PGRST204" ||
    /confirm_claimed_at|42703|PGRST204/i.test(`${code} ${message}`)
  );
}

/**
 * Payment id when a non-failed PaymentIntent is already stored for this
 * deal and line. Same pair chargeForEpisode checks before it creates
 * another charge. A payment for this line on a different deal does not
 * count.
 */
async function lineAlreadyCharged(
  dealId: string,
  ioLineItemId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("payments")
    .select("id")
    .eq("deal_id", dealId)
    .eq("io_line_item_id", ioLineItemId)
    .neq("status", "failed")
    .not("stripe_payment_intent_id", "is", null)
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (error) {
    throw new Error(
      `Failed to check for an existing payment on deal ${dealId} line ${ioLineItemId}: ${error.message}`
    );
  }
  return data?.id ?? null;
}

async function requireAircheck(ioLineItemId: string): Promise<AircheckRow> {
  const row = await findAircheckByLine(ioLineItemId);
  if (!row) {
    throw new AircheckReviewNotFound("No aircheck is stored for this line.");
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

async function logBlocked(
  input: DecideInput,
  aircheckId: string,
  reason: string
): Promise<void> {
  await logEvent({
    eventType: "aircheck.confirm_blocked",
    entityType: "aircheck",
    entityId: aircheckId,
    actorId: input.actorId ?? null,
    payload: {
      reason,
      io_line_item_id: input.ioLineItemId,
      decided_by: input.decidedBy,
    },
  });
}

function confirmedPayload(
  input: DecideInput,
  row: AircheckRow,
  extra: {
    already_charged: boolean;
    payment_id: string | null;
    stripe_payment_intent_id?: string;
  }
) {
  return {
    io_line_item_id: input.ioLineItemId,
    decided_by: input.decidedBy,
    already_charged: extra.already_charged,
    payment_id: extra.payment_id,
    match_result: row.match_result,
    confidence: row.confidence ?? null,
    override: row.match_result === "not_matched",
    ...(extra.stripe_payment_intent_id
      ? { stripe_payment_intent_id: extra.stripe_payment_intent_id }
      : {}),
  };
}

async function claimOrUnavailable(
  ioLineItemId: string,
  decidedBy: string
): Promise<AircheckRow | null> {
  try {
    return await claimAircheckConfirm(ioLineItemId, decidedBy);
  } catch (err) {
    if (isClaimColumnMissing(err)) throw new AircheckConfirmUnavailable();
    throw err;
  }
}

async function releaseClaim(ioLineItemId: string, heldAt: string): Promise<void> {
  try {
    await releaseAircheckConfirm(ioLineItemId, heldAt);
  } catch (err) {
    console.error(
      "[airchecks] confirm claim release failed:",
      err instanceof Error ? err.message : err
    );
  }
}

async function paymentFor(
  deal: AircheckLineDeal | null,
  ioLineItemId: string
): Promise<string | null> {
  if (!deal?.dealId) return null;
  return lineAlreadyCharged(deal.dealId, ioLineItemId);
}

async function saveConfirmed(
  input: DecideInput,
  clearClaim: boolean
): Promise<AircheckRow | null> {
  return saveAircheckConfirmedIfUndecided(input.ioLineItemId, {
    review_decision: "confirmed",
    review_reason: null,
    decided_by: input.decidedBy,
    decided_at: new Date().toISOString(),
    charge_error: null,
    ...(clearClaim
      ? { confirm_claimed_at: null, confirm_claimed_by: null }
      : {}),
  });
}

async function finishAlreadyCharged(
  input: DecideInput,
  paymentId: string,
  clearClaim: boolean
): Promise<ConfirmAircheckResult> {
  const aircheck = await saveConfirmed(input, clearClaim);
  if (!aircheck) {
    throw new AircheckReviewConflict(ALREADY_DECIDED);
  }
  await logEvent({
    eventType: "aircheck.confirmed",
    entityType: "aircheck",
    entityId: aircheck.id,
    actorId: input.actorId ?? null,
    payload: confirmedPayload(input, aircheck, {
      already_charged: true,
      payment_id: paymentId,
    }),
  });
  await runMakeGoodDetectionHook(input.ioLineItemId);
  return { ok: true, alreadyCharged: true, aircheck, charge: null };
}

export async function confirmAircheck(
  input: DecideInput
): Promise<ConfirmAircheckResult> {
  const existing = await requireAircheck(input.ioLineItemId);
  if (existing.review_decision === "confirmed") {
    await runMakeGoodDetectionHook(input.ioLineItemId);
    return {
      ok: true,
      alreadyCharged: true,
      aircheck: existing,
      charge: null,
    };
  }
  if (existing.review_decision === "rejected") {
    await logBlocked(input, existing.id, REJECTED_FINAL);
    throw new AircheckReviewConflict(REJECTED_FINAL);
  }

  const deal = await loadAircheckLineDeal(input.ioLineItemId);
  const existingPaymentId = await paymentFor(deal, input.ioLineItemId);
  if (existingPaymentId) {
    return finishAlreadyCharged(input, existingPaymentId, false);
  }

  const eligibility = confirmEligibility(existing);
  if (!eligibility.ok) {
    await logBlocked(input, existing.id, eligibility.reason);
    throw new AircheckReviewConflict(eligibility.reason);
  }
  const dealGate = confirmDealEligibility(
    deal
      ? { status: deal.status, cancelledAt: deal.cancelledAt }
      : null
  );
  if (!dealGate.ok || !deal) {
    const reason = dealGate.ok
      ? "This line is not on a booked deal and cannot be confirmed."
      : dealGate.reason;
    await logBlocked(input, existing.id, reason);
    throw new AircheckReviewConflict(reason);
  }

  let heldAt: string | null = null;
  try {
    const claim = await claimOrUnavailable(input.ioLineItemId, input.decidedBy);
    if (!claim) {
      await logBlocked(input, existing.id, IN_PROGRESS);
      throw new AircheckConfirmInProgress(IN_PROGRESS);
    }
    heldAt = claim.confirm_claimed_at ?? null;

    const fresh = await requireAircheck(input.ioLineItemId);
    if (fresh.review_decision === "confirmed") {
      await runMakeGoodDetectionHook(input.ioLineItemId);
      return {
        ok: true,
        alreadyCharged: true,
        aircheck: fresh,
        charge: null,
      };
    }
    if (fresh.review_decision === "rejected") {
      await logBlocked(input, fresh.id, REJECTED_FINAL);
      throw new AircheckReviewConflict(REJECTED_FINAL);
    }
    const racedPaymentId = await lineAlreadyCharged(
      deal.dealId,
      input.ioLineItemId
    );
    if (racedPaymentId) {
      return finishAlreadyCharged(input, racedPaymentId, true);
    }

    const delivered = await deliverAndChargeLine({
      ioLineItemId: input.ioLineItemId,
    });
    if (!delivered.ok) {
      if (delivered.status === 404) {
        throw new AircheckReviewNotFound("No IO line is stored for this line.");
      }
      if (delivered.status !== 502) {
        throw new Error(delivered.error);
      }
      const chargeError = chargeFailureMessage(delivered);
      const aircheck = await saveAircheckReview(input.ioLineItemId, {
        charge_error: chargeError,
      });
      await logEvent({
        eventType: "aircheck.charge_failed",
        entityType: "aircheck",
        entityId: aircheck.id,
        actorId: input.actorId ?? null,
        payload: {
          io_line_item_id: input.ioLineItemId,
          decided_by: input.decidedBy,
          charge_error: chargeError.slice(0, 500),
          rolled_back: delivered.rolledBack,
        },
      });
      return { ok: false, aircheck, chargeError };
    }

    const aircheck = await saveConfirmed(input, true);
    if (!aircheck) {
      await logEvent({
        eventType: "aircheck.confirm_blocked",
        entityType: "aircheck",
        entityId: existing.id,
        actorId: input.actorId ?? null,
        payload: {
          reason: "decided_during_charge",
          payment_id: delivered.charge.paymentId,
          io_line_item_id: input.ioLineItemId,
          decided_by: input.decidedBy,
        },
      });
      throw new AircheckReviewConflict(DECIDED_DURING_CHARGE);
    }
    await logEvent({
      eventType: "aircheck.confirmed",
      entityType: "aircheck",
      entityId: aircheck.id,
      actorId: input.actorId ?? null,
      payload: confirmedPayload(input, aircheck, {
        already_charged: false,
        payment_id: delivered.charge.paymentId,
        stripe_payment_intent_id: delivered.charge.stripePaymentIntentId,
      }),
    });
    await runMakeGoodDetectionHook(input.ioLineItemId);
    return {
      ok: true,
      alreadyCharged: false,
      aircheck,
      charge: delivered.charge,
    };
  } finally {
    if (heldAt) await releaseClaim(input.ioLineItemId, heldAt);
  }
}

export async function rejectAircheck(input: RejectInput): Promise<AircheckRow> {
  await requireAircheck(input.ioLineItemId);
  let heldAt: string | null = null;
  try {
    const claim = await claimOrUnavailable(input.ioLineItemId, input.decidedBy);
    if (!claim) {
      const row = await requireAircheck(input.ioLineItemId);
      if (row.review_decision === "rejected") {
        throw new AircheckReviewConflict("This line was rejected.");
      }
      const deal = await loadAircheckLineDeal(input.ioLineItemId);
      const paymentId = await paymentFor(deal, input.ioLineItemId);
      if (row.review_decision === "confirmed" || paymentId) {
        throw new AircheckReviewConflict("This line is already charged.");
      }
      throw new AircheckConfirmInProgress(IN_PROGRESS);
    }
    heldAt = claim.confirm_claimed_at ?? null;

    const fresh = await requireAircheck(input.ioLineItemId);
    const deal = await loadAircheckLineDeal(input.ioLineItemId);
    const paymentId = await paymentFor(deal, input.ioLineItemId);
    if (fresh.review_decision === "confirmed" || paymentId) {
      throw new AircheckReviewConflict("This line is already charged.");
    }

    const reason = cleanReason(input.reason);
    const aircheck = await saveAircheckReview(input.ioLineItemId, {
      review_decision: "rejected",
      review_reason: reason,
      decided_by: input.decidedBy,
      decided_at: new Date().toISOString(),
      charge_error: null,
      confirm_claimed_at: null,
      confirm_claimed_by: null,
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
    await runMakeGoodDetectionHook(input.ioLineItemId);
    return aircheck;
  } finally {
    if (heldAt) await releaseClaim(input.ioLineItemId, heldAt);
  }
}
