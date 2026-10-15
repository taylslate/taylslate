// Conversion-alert payload builder.
//
// Free → paid conversion is the relationship moment. This module builds
// one internal alert (no new alert type) that compares Free with Starter
// and Operator using the live plan catalogue. The cron at
// app/api/cron/conversion-alerts decides who receives it and sends it.
//
// Bases and card fees come from lib/billing/plans.ts. Bank-transfer rates
// are not part of this email.

import {
  monthlySavingsAtSpend,
  breakevenSpendCents,
  getPlan,
  type PlanRecord,
} from "@/lib/billing/plans";
import {
  emailDetailTable,
  emailParagraph,
  escapeHtml,
  renderEmailLayout,
} from "@/lib/email/layout";

export interface ConversionAlertProfile {
  id: string;
  email?: string | null;
  full_name?: string | null;
  company_name?: string | null;
}

export interface ConversionAlertInput {
  profile: ConversionAlertProfile;
  monthlyAvgCents: number;
}

export interface ConversionAlertPayload {
  subject: string;
  html: string;
  text: string;
  /** Annual savings (cents) on Operator vs Free at the customer's spend. */
  operatorSavingsAnnualCents: number;
  /** Annual savings (cents) on Starter vs Free at the customer's spend. */
  starterSavingsAnnualCents: number;
}

function fmtUsd(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function customerLabel(profile: ConversionAlertProfile): string {
  return (
    profile.company_name?.trim() ||
    profile.full_name?.trim() ||
    profile.email?.trim() ||
    profile.id
  );
}

function planRateLabel(plan: PlanRecord): string {
  const dollars = (plan.monthlyBaseCents / 100).toLocaleString("en-US");
  const fee = (plan.feePercentage * 100).toFixed(0);
  return `$${dollars}/mo + ${fee}%`;
}

/**
 * Build the internal alert email body. Pure function — no Resend, no DB.
 */
export function buildConversionAlertPayload(
  input: ConversionAlertInput
): ConversionAlertPayload {
  const { profile, monthlyAvgCents } = input;
  const free = getPlan("pay_as_you_go");
  const starter = getPlan("starter");
  const operator = getPlan("operator");

  const freeMonthlyCents =
    free.monthlyBaseCents + Math.round(monthlyAvgCents * free.feePercentage);
  const starterMonthlyCents =
    starter.monthlyBaseCents +
    Math.round(monthlyAvgCents * starter.feePercentage);
  const operatorMonthlyCents =
    operator.monthlyBaseCents +
    Math.round(monthlyAvgCents * operator.feePercentage);

  const freeAnnualCents = freeMonthlyCents * 12;
  const starterAnnualCents = starterMonthlyCents * 12;
  const operatorAnnualCents = operatorMonthlyCents * 12;

  const starterSavings = monthlySavingsAtSpend(
    monthlyAvgCents,
    "pay_as_you_go",
    "starter"
  );
  const operatorSavings = monthlySavingsAtSpend(
    monthlyAvgCents,
    "pay_as_you_go",
    "operator"
  );
  const operatorBreakevenCents =
    breakevenSpendCents("pay_as_you_go", "operator") ?? 0;

  const label = customerLabel(profile);
  const subject = `Conversion alert: ${label} crossed Operator breakeven`;
  const intro = `${label} (profile id ${profile.id}) has trailing-90 monthly average GMV of ${fmtUsd(monthlyAvgCents)}/mo, above the Operator breakeven of ${fmtUsd(operatorBreakevenCents)}/mo. Starter and Operator are both priced against Free below.`;
  const close = "Conversion is sales-led. Reach out personally.";
  const textBody = [
    `${label} (id ${profile.id}) crossed the Operator breakeven of ${fmtUsd(operatorBreakevenCents)}/mo.`,
    "",
    `Current monthly spend:       ${fmtUsd(monthlyAvgCents)}`,
    `Current ${free.label} annual cost:    ${fmtUsd(freeAnnualCents)}`,
    `${starter.label} annual cost:         ${fmtUsd(starterAnnualCents)} (${planRateLabel(starter)})`,
    `Annual savings on ${starter.label}:   ${fmtUsd(starterSavings.annualCents)}`,
    `${operator.label} annual cost:        ${fmtUsd(operatorAnnualCents)} (${planRateLabel(operator)})`,
    `Annual savings on ${operator.label}:  ${fmtUsd(operatorSavings.annualCents)}`,
    "",
    close,
  ].join("\n");

  const laid = renderEmailLayout({
    preheader: `${label} crossed the Operator breakeven.`,
    headline: "Operator conversion opportunity",
    bodyHtml:
      emailParagraph(escapeHtml(intro)) +
      emailDetailTable([
        ["Current monthly spend", escapeHtml(fmtUsd(monthlyAvgCents))],
        [`Current ${free.label} annual cost`, escapeHtml(fmtUsd(freeAnnualCents))],
        [
          `${starter.label} annual cost (${planRateLabel(starter)})`,
          escapeHtml(fmtUsd(starterAnnualCents)),
        ],
        [
          `Annual savings on ${starter.label}`,
          escapeHtml(fmtUsd(starterSavings.annualCents)),
        ],
        [
          `${operator.label} annual cost (${planRateLabel(operator)})`,
          escapeHtml(fmtUsd(operatorAnnualCents)),
        ],
        [
          `Annual savings on ${operator.label}`,
          escapeHtml(fmtUsd(operatorSavings.annualCents)),
        ],
      ]) +
      emailParagraph(escapeHtml(close)),
    text: textBody,
  });

  return {
    subject,
    html: laid.html,
    text: laid.text,
    operatorSavingsAnnualCents: operatorSavings.annualCents,
    starterSavingsAnnualCents: starterSavings.annualCents,
  };
}
