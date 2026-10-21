// Who may write a learning note or a conversion count. Pure.

import type { UserRole } from "@/lib/data/types";
import { STYLE_KEYS } from "./styles";
import type { OverrideAuthorRole, OverrideStance, OverrideTargetKind } from "./review";

const STANCES = new Set<OverrideStance>([
  "renew",
  "test_next",
  "overweight",
  "avoid",
  "note",
]);

const KINDS = new Set<OverrideTargetKind>(["show", "ring", "style"]);

export const NOTE_MAX = 500;
export const CONVERSION_MAX = 1_000_000;

/** Statuses where a brand can already have a conversion count. */
const REPORTABLE_DEAL_STATUS = new Set([
  "completed",
  "live",
  "delivering",
  "show_signed",
  "signed",
]);

export interface OverrideWriteInput {
  userId: string;
  campaignUserId: string;
  isAdmin: boolean;
  role: UserRole | null;
  representedShowIds: string[];
  allowedShowIds: string[];
  allowedRingIds: string[];
  targetKind: string;
  targetKey: string;
  stance: string;
  note: string;
}

export type WriteDecision =
  | { ok: true; authorRole: OverrideAuthorRole; note: string; stance: OverrideStance; targetKind: OverrideTargetKind; targetKey: string }
  | { ok: false; status: 400 | 403; error: string };

export function decideOverrideWrite(input: OverrideWriteInput): WriteDecision {
  const note = input.note.trim();
  if (!note || note.length > NOTE_MAX) {
    return { ok: false, status: 400, error: "A note is required." };
  }
  if (!STANCES.has(input.stance as OverrideStance)) {
    return { ok: false, status: 400, error: "Unknown stance." };
  }
  if (!KINDS.has(input.targetKind as OverrideTargetKind)) {
    return { ok: false, status: 400, error: "Unknown target." };
  }
  const targetKind = input.targetKind as OverrideTargetKind;
  const targetKey = input.targetKey.trim();
  if (!targetAllowed(targetKind, targetKey, input.allowedShowIds, input.allowedRingIds)) {
    return { ok: false, status: 400, error: "That target is not on this campaign." };
  }

  const stance = input.stance as OverrideStance;
  if (input.userId === input.campaignUserId) {
    return { ok: true, authorRole: "brand", note, stance, targetKind, targetKey };
  }
  if (input.isAdmin) {
    return { ok: true, authorRole: "rep", note, stance, targetKind, targetKey };
  }
  if (
    input.role === "agent" &&
    repMayWrite(input.representedShowIds, targetKind, targetKey)
  ) {
    return { ok: true, authorRole: "rep", note, stance, targetKind, targetKey };
  }
  return { ok: false, status: 403, error: "You can't add a note on this campaign." };
}

export function targetAllowed(
  kind: OverrideTargetKind,
  key: string,
  showIds: string[],
  ringIds: string[]
): boolean {
  if (!key) return false;
  if (kind === "show") return showIds.includes(key);
  if (kind === "ring") return ringIds.includes(key);
  return STYLE_KEYS.has(key);
}

/**
 * A rep note on a show requires that catalog show in the rep's set.
 * A ring or style note requires the rep to represent some show on the
 * campaign. The set is built from deals.show_id and
 * agent_show_relationships, never from a user-typed podcast id.
 */
export function repMayWrite(
  representedShowIds: string[],
  kind: OverrideTargetKind,
  key: string
): boolean {
  if (representedShowIds.length === 0) return false;
  if (kind === "show") return representedShowIds.includes(key);
  return true;
}

export interface ConversionWriteInput {
  userId: string;
  campaignUserId: string;
  isAdmin: boolean;
  dealId: string;
  dealStatus: string | null;
  /** False when the deal is not linked to this campaign. */
  onCampaign: boolean;
  conversions: unknown;
}

export type ConversionDecision =
  | { ok: true; clear: true; dealId: string }
  | { ok: true; clear: false; dealId: string; conversions: number }
  | { ok: false; status: 400 | 403 | 404; error: string };

export function decideConversionWrite(input: ConversionWriteInput): ConversionDecision {
  if (!input.onCampaign || !input.dealId) {
    return { ok: false, status: 404, error: "Deal not found." };
  }
  if (input.userId !== input.campaignUserId && !input.isAdmin) {
    return { ok: false, status: 403, error: "Only the brand can report conversions." };
  }
  if (input.dealStatus === "cancelled") {
    return { ok: false, status: 400, error: "Cancelled deals are not a result." };
  }
  if (input.conversions === null) {
    return { ok: true, clear: true, dealId: input.dealId };
  }
  if (!REPORTABLE_DEAL_STATUS.has(input.dealStatus ?? "")) {
    return {
      ok: false,
      status: 400,
      error: "Conversions are reported after the flight is on air.",
    };
  }
  if (typeof input.conversions !== "number" || !Number.isInteger(input.conversions)) {
    return { ok: false, status: 400, error: "Conversions must be a whole number." };
  }
  if (input.conversions < 0 || input.conversions > CONVERSION_MAX) {
    return { ok: false, status: 400, error: "Conversions must be a whole number." };
  }
  return {
    ok: true,
    clear: false,
    dealId: input.dealId,
    conversions: input.conversions,
  };
}
