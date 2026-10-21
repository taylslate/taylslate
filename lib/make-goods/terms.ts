// Amended terms and the options a brand can approve.
// Pure. No DocuSign, no charge, no database.

import type { AircheckUnderdelivery } from "@/lib/airchecks/detect";
import type { MakeGoodKind, MakeGoodOption, MakeGoodOptionId } from "./types";

export interface TermLine {
  showName: string;
  placement: string;
  postDate: string;
  guaranteedDownloads: number;
  actualDownloads: number | null;
  priceType: string;
  grossCpm: number;
  grossRate: number;
  netDue: number;
}

export interface TermContext {
  ioNumber: string;
  advertiserName: string;
  showId: string;
  line: TermLine;
  finding: AircheckUnderdelivery;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function money(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Calendar date plus days, UTC. post_date is a date, not a timestamp. */
export function addUtcDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year || 1970, (month || 1) - 1, day || 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Dollars the shortfall represents. Recorded on a credit approval.
 * Not sent to Stripe.
 */
export function creditAmount(line: TermLine, kind: MakeGoodKind): number {
  const net = Number(line.netDue) || Number(line.grossRate) || 0;
  const guaranteed = Number(line.guaranteedDownloads) || 0;
  const actual = line.actualDownloads;
  if (kind === "missed" || actual == null || guaranteed <= 0) return round2(net);
  const undelivered = Math.max(0, guaranteed - actual);
  if (line.priceType === "cpm") {
    const cpm =
      Number(line.grossCpm) > 0
        ? Number(line.grossCpm)
        : guaranteed > 0
          ? (net / guaranteed) * 1000
          : 0;
    return round2((undelivered / 1000) * cpm);
  }
  return round2(net * (undelivered / guaranteed));
}

function optionSummary(
  id: MakeGoodOptionId,
  line: TermLine,
  replacementDate: string,
  credit: number
): { label: string; summary: string } {
  if (id === "replacement_spot") {
    return {
      label: "Additional episode",
      summary: `Publisher airs one additional ${line.placement} episode on ${replacementDate} at no additional cost. Guarantee ${line.guaranteedDownloads.toLocaleString("en-US")} downloads. Net due $0.00.`,
    };
  }
  if (id === "reair") {
    return {
      label: "Re-air the spot",
      summary: `Publisher re-airs the same ${line.placement} spot on ${replacementDate} at no additional cost. Net due $0.00.`,
    };
  }
  return {
    label: "Credit the shortfall",
    summary: `Credit ${money(credit)} for the downloads that did not land. No charge and no refund is sent. The credit is recorded on the deal.`,
  };
}

export function replacementPostDate(postDate: string): string {
  return addUtcDays(postDate, 14);
}

export function optionsForKind(kind: MakeGoodKind): MakeGoodOptionId[] {
  if (kind === "missed") return ["replacement_spot", "reair"];
  return ["replacement_spot", "credit_shortfall"];
}

export function buildOptions(context: TermContext): MakeGoodOption[] {
  const replacementDate = replacementPostDate(context.line.postDate);
  const credit = creditAmount(context.line, context.finding.kind);
  return optionsForKind(context.finding.kind).map((id) => {
    const text = optionSummary(id, context.line, replacementDate, credit);
    return { id, label: text.label, summary: text.summary };
  });
}

export function draftAmendedTerms(
  context: TermContext,
  optionId: MakeGoodOptionId
): string {
  const replacementDate = replacementPostDate(context.line.postDate);
  const credit = creditAmount(context.line, context.finding.kind);
  const option = optionSummary(optionId, context.line, replacementDate, credit);
  const kindLabel = context.finding.kind === "missed" ? "Missed spot" : "Short delivery";
  const downloads =
    context.line.actualDownloads == null
      ? `Guaranteed downloads: ${context.line.guaranteedDownloads.toLocaleString("en-US")}. Delivered downloads: not recorded.`
      : `Guaranteed downloads: ${context.line.guaranteedDownloads.toLocaleString("en-US")}. Delivered downloads: ${context.line.actualDownloads.toLocaleString("en-US")}.`;

  const remedy =
    optionId === "credit_shortfall"
      ? `The undelivered portion is credited at ${money(credit)}. No charge and no refund is sent from this approval. Payment stays where it already is.`
      : optionId === "reair"
        ? `Publisher will re-air the same ${context.line.placement} spot on ${replacementDate} at no additional cost. Net due $0.00. The original line stays the missed delivery.`
        : `Publisher will air one additional ${context.line.placement} episode on ${replacementDate} at no additional cost. Guaranteed downloads on that episode: ${context.line.guaranteedDownloads.toLocaleString("en-US")}. Net due $0.00.`;

  return [
    `Amendment — IO ${context.ioNumber}`,
    `Advertiser: ${context.advertiserName}`,
    `Publisher show: ${context.line.showName} (show ${context.showId})`,
    `Original line: ${context.line.placement} on ${context.line.postDate}`,
    "",
    `${kindLabel}. ${context.finding.reason}`,
    downloads,
    `Make-good threshold: ${Math.round(context.finding.threshold * 100)}%.`,
    "",
    `Agreed remedy: ${option.summary}`,
    remedy,
    "",
    "This amendment is recorded in Taylslate when the advertiser approves it.",
    "It does not send a DocuSign envelope and it does not charge the brand or the show.",
    "The original signed IO stays the document of record.",
  ].join("\n");
}
