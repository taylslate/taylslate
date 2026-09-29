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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

  const html = `
<!DOCTYPE html>
<html>
  <body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px 28px;">
        <h1 style="font-size:18px;font-weight:600;color:#111827;margin:0 0 12px;">
          Operator conversion opportunity
        </h1>
        <p style="font-size:14px;color:#1f2937;line-height:1.6;margin:0 0 14px;">
          <strong>${escapeHtml(label)}</strong> (profile id <code>${escapeHtml(profile.id)}</code>)
          has trailing-90 monthly average GMV of <strong>${fmtUsd(monthlyAvgCents)}/mo</strong>,
          above the Operator breakeven of ${fmtUsd(operatorBreakevenCents)}/mo.
          Starter and Operator are both priced against Free below. Time for
          the upgrade conversation.
        </p>
        <table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:13px;color:#1f2937;">
          <tr>
            <td style="padding:6px 0;color:#6b7280;">Current monthly spend</td>
            <td style="padding:6px 0;text-align:right;font-weight:600;">${fmtUsd(monthlyAvgCents)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;">Current ${escapeHtml(free.label)} annual cost</td>
            <td style="padding:6px 0;text-align:right;">${fmtUsd(freeAnnualCents)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;">${escapeHtml(starter.label)} annual cost (${planRateLabel(starter)})</td>
            <td style="padding:6px 0;text-align:right;">${fmtUsd(starterAnnualCents)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#15803d;font-weight:600;">Annual savings on ${escapeHtml(starter.label)}</td>
            <td style="padding:6px 0;text-align:right;color:#15803d;font-weight:600;">${fmtUsd(starterSavings.annualCents)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;">${escapeHtml(operator.label)} annual cost (${planRateLabel(operator)})</td>
            <td style="padding:6px 0;text-align:right;">${fmtUsd(operatorAnnualCents)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#15803d;font-weight:600;">Annual savings on ${escapeHtml(operator.label)}</td>
            <td style="padding:6px 0;text-align:right;color:#15803d;font-weight:600;">${fmtUsd(operatorSavings.annualCents)}</td>
          </tr>
        </table>
        <p style="font-size:12px;color:#6b7280;margin-top:18px;line-height:1.55;">
          Conversion is sales-led, not automated. Reach out personally — this is
          a relationship moment per the PRICING_DECISIONS conversion mechanic.
        </p>
      </div>
    </div>
  </body>
</html>`.trim();

  const text = [
    `${label} (id ${profile.id}) crossed the Operator breakeven of ${fmtUsd(operatorBreakevenCents)}/mo.`,
    "",
    `Current monthly spend:       ${fmtUsd(monthlyAvgCents)}`,
    `Current ${free.label} annual cost:    ${fmtUsd(freeAnnualCents)}`,
    `${starter.label} annual cost:         ${fmtUsd(starterAnnualCents)} (${planRateLabel(starter)})`,
    `Annual savings on ${starter.label}:   ${fmtUsd(starterSavings.annualCents)}`,
    `${operator.label} annual cost:        ${fmtUsd(operatorAnnualCents)} (${planRateLabel(operator)})`,
    `Annual savings on ${operator.label}:  ${fmtUsd(operatorSavings.annualCents)}`,
    "",
    `Conversion is sales-led — reach out personally.`,
  ].join("\n");

  return {
    subject,
    html,
    text,
    operatorSavingsAnnualCents: operatorSavings.annualCents,
    starterSavingsAnnualCents: starterSavings.annualCents,
  };
}
