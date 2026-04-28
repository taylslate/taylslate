// GET /api/cron/conversion-alerts
// Vercel Cron daily job (15:00 UTC).
//
// For every Pay-as-you-go customer whose trailing-90 monthly average GMV
// crosses the Operator breakeven (~$12,500/mo), send an internal alert
// to chris@taylslate.com so we can have the upgrade conversation
// personally. PAYG → Operator conversion is the highest-leverage Wave 13
// metric (per PRICING_DECISIONS.md).
//
// Idempotency: we don't want to re-page the same customer every day.
// State is kept in `event_log` itself — we record an
// `conversion_alert_sent` row each time we fire. On the next run we
// query the trailing 7 days for that operation_type and skip the
// customer if anything is already there. No extra column on `profiles`
// required.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.

import { NextRequest, NextResponse } from "next/server";
import { getAllPaygCustomersAboveBreakeven } from "@/lib/analytics/gmv";
import {
  buildConversionAlertPayload,
  type ConversionAlertProfile,
} from "@/lib/alerts/conversion";
import { listEventsForCustomer, recordEvent } from "@/lib/data/event-log";
import { logEvent } from "@/lib/data/events";
import { sendEmail } from "@/lib/email/send";
import { supabaseAdmin } from "@/lib/supabase/admin";

const ALERT_THRESHOLD_CENTS = 1_250_000; // $12,500/mo Operator breakeven
const RESEND_GUARD_DAYS = 7;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  const header = req.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

function internalAlertEmail(): string {
  return process.env.INTERNAL_ALERT_EMAIL || "chris@taylslate.com";
}

interface CronResult {
  candidates: number;
  alerts_sent: number;
  skipped_recently_alerted: number;
  errors: string[];
}

async function alreadyAlertedRecently(customerId: string): Promise<boolean> {
  const sinceIso = new Date(
    Date.now() - RESEND_GUARD_DAYS * 86_400_000
  ).toISOString();
  const events = await listEventsForCustomer(customerId, {
    operationType: "conversion_alert_sent",
    sinceIso,
  });
  return events.length > 0;
}

async function loadAlertProfile(
  customerId: string
): Promise<ConversionAlertProfile | null> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email, full_name, company_name")
    .eq("id", customerId)
    .single();
  if (error || !data) return null;
  return data as ConversionAlertProfile;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result: CronResult = {
    candidates: 0,
    alerts_sent: 0,
    skipped_recently_alerted: 0,
    errors: [],
  };

  const candidates = await getAllPaygCustomersAboveBreakeven(
    ALERT_THRESHOLD_CENTS
  );
  result.candidates = candidates.length;

  for (const candidate of candidates) {
    if (await alreadyAlertedRecently(candidate.customerId)) {
      result.skipped_recently_alerted += 1;
      continue;
    }

    const profile = await loadAlertProfile(candidate.customerId);
    if (!profile) {
      result.errors.push(
        `customer ${candidate.customerId}: profile not found`
      );
      continue;
    }

    const payload = buildConversionAlertPayload({
      profile,
      monthlyAvgCents: candidate.monthlyAvgCents,
    });

    const sendResult = await sendEmail({
      to: internalAlertEmail(),
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });

    if (!sendResult.ok) {
      result.errors.push(
        `customer ${candidate.customerId}: alert send failed (${sendResult.reason})`
      );
      // Don't record the event if the email never went out — we want the
      // next run to retry. (Resend `no_api_key` in dev still flips ok=false.)
      continue;
    }

    // Record the metering event so the 7-day idempotency guard works,
    // and fire the audit-log domain event for downstream consumers.
    await recordEvent({
      customerId: candidate.customerId,
      operationType: "conversion_alert_sent",
      metadata: {
        monthly_avg_cents: candidate.monthlyAvgCents,
        operator_savings_annual_cents: payload.operatorSavingsAnnualCents,
      },
    });
    await logEvent({
      eventType: "customer.conversion_alert_sent",
      entityType: "profile",
      entityId: candidate.customerId,
      payload: {
        profile_id: candidate.customerId,
        monthly_avg_cents: candidate.monthlyAvgCents,
        operator_savings_annual_cents: payload.operatorSavingsAnnualCents,
      },
    });
    result.alerts_sent += 1;
  }

  return NextResponse.json(result);
}
