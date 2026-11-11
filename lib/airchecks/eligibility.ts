// Pure gates for a human confirm. No database and no charge.
// A row is confirmable only when it is transcribed and the match is
// matched or not_matched. ready_for_review alone is not enough: the
// manual aircheck route can leave that flag false.

import { BOOKED_DEAL_STATUSES } from "@/lib/discovery/market-signals";

export type ConfirmGate =
  | { ok: true; reason: null }
  | { ok: false; reason: string };

export function confirmEligibility(row: {
  status: string;
  match_result: string | null;
}): ConfirmGate {
  if (row.status === "failed") {
    return { ok: false, reason: "This aircheck failed and cannot be confirmed." };
  }
  if (row.status === "pending") {
    return {
      ok: false,
      reason: "This aircheck is still pending and cannot be confirmed.",
    };
  }
  if (row.status !== "transcribed") {
    return {
      ok: false,
      reason: "This aircheck is not transcribed and cannot be confirmed.",
    };
  }
  if (row.match_result === "skipped") {
    return {
      ok: false,
      reason: "This aircheck was skipped and cannot be confirmed.",
    };
  }
  if (row.match_result == null || row.match_result === "") {
    return {
      ok: false,
      reason: "This aircheck has not been judged and cannot be confirmed.",
    };
  }
  if (row.match_result === "matched" || row.match_result === "not_matched") {
    return { ok: true, reason: null };
  }
  return {
    ok: false,
    reason: "This aircheck has not been judged and cannot be confirmed.",
  };
}

export function confirmDealEligibility(
  deal: { status: string | null; cancelledAt: string | null } | null
): ConfirmGate {
  if (!deal) {
    return {
      ok: false,
      reason: "This line is not on a booked deal and cannot be confirmed.",
    };
  }
  if (deal.cancelledAt?.trim()) {
    return {
      ok: false,
      reason: "This deal is cancelled and cannot be confirmed.",
    };
  }
  if (!deal.status || !BOOKED_DEAL_STATUSES.has(deal.status)) {
    return {
      ok: false,
      reason: "This deal is not booked and cannot be confirmed.",
    };
  }
  return { ok: true, reason: null };
}
