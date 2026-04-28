// Wave 13 — Conversion-alert payload builder.
//
// PAYG → Operator conversion is the single most important Wave 13 metric
// (per PRICING_DECISIONS.md "Conversion Mechanic"). When a Pay-as-you-go
// customer's trailing-90 monthly average GMV crosses the Operator
// breakeven (~$12,500/mo), we owe ourselves a relationship-grade nudge —
// not an automated upgrade email to the customer, but an internal alert
// to chris@taylslate.com so a human can have the upgrade conversation.
//
// This module builds the payload only. The cron handler at
// app/api/cron/conversion-alerts wires the send.

import { monthlySavingsAtSpend, getPlan } from "@/lib/billing/plans";

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
  /** Annual savings (cents) on Operator vs PAYG at the customer's spend. */
  operatorSavingsAnnualCents: number;
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

/**
 * Build the internal alert email body. Pure function — no Resend, no DB.
 */
export function buildConversionAlertPayload(
  input: ConversionAlertInput
): ConversionAlertPayload {
  const { profile, monthlyAvgCents } = input;
  const payg = getPlan("pay_as_you_go");
  const operator = getPlan("operator");

  const paygMonthlyCents =
    payg.monthlyBaseCents + Math.round(monthlyAvgCents * payg.feePercentage);
  const operatorMonthlyCents =
    operator.monthlyBaseCents +
    Math.round(monthlyAvgCents * operator.feePercentage);

  const paygAnnualCents = paygMonthlyCents * 12;
  const operatorAnnualCents = operatorMonthlyCents * 12;

  const savings = monthlySavingsAtSpend(
    monthlyAvgCents,
    "pay_as_you_go",
    "operator"
  );

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
          above the Operator breakeven of $12,500/mo. Time for the upgrade
          conversation.
        </p>
        <table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:13px;color:#1f2937;">
          <tr>
            <td style="padding:6px 0;color:#6b7280;">Current monthly spend</td>
            <td style="padding:6px 0;text-align:right;font-weight:600;">${fmtUsd(monthlyAvgCents)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;">Current PAYG annual cost</td>
            <td style="padding:6px 0;text-align:right;">${fmtUsd(paygAnnualCents)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;">Operator annual cost ($499/mo + 6%)</td>
            <td style="padding:6px 0;text-align:right;">${fmtUsd(operatorAnnualCents)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#15803d;font-weight:600;">Annual savings on Operator</td>
            <td style="padding:6px 0;text-align:right;color:#15803d;font-weight:600;">${fmtUsd(savings.annualCents)}</td>
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
    `${label} (id ${profile.id}) crossed the Operator breakeven.`,
    "",
    `Current monthly spend:     ${fmtUsd(monthlyAvgCents)}`,
    `Current PAYG annual cost:  ${fmtUsd(paygAnnualCents)}`,
    `Operator annual cost:      ${fmtUsd(operatorAnnualCents)}`,
    `Annual savings on Operator: ${fmtUsd(savings.annualCents)}`,
    "",
    `Conversion is sales-led — reach out personally.`,
  ].join("\n");

  return {
    subject,
    html,
    text,
    operatorSavingsAnnualCents: savings.annualCents,
  };
}
