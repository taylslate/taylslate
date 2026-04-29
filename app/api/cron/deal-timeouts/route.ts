// GET /api/cron/deal-timeouts
// Vercel Cron daily job. Two responsibilities:
//   1. Day-3 reminder: brand hasn't sent the IO for signature yet — nudge them.
//   2. Day-14 cancellation: deal still pre-show-signed — cancel with reason.
//
// Both are idempotent. Reminder uses brand_reminder_sent_at as a guard;
// cancellation flips status to 'cancelled' which the timeout query excludes.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.

import { NextRequest, NextResponse } from "next/server";
import {
  findDealsToTimeoutCancel,
  findStaleUnsignedDealsForReminder,
  getOutreachById,
  updateWave12Deal,
} from "@/lib/data/queries";
import { voidEnvelope } from "@/lib/docusign/envelope";
import { logEvent } from "@/lib/data/events";
import { renderBrandSignatureReminder } from "@/lib/email/templates/brand-signature-reminder";
import { renderDealCancelledShow } from "@/lib/email/templates/deal-cancelled-show";
import { sendEmail } from "@/lib/email/send";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { BrandProfile, ShowProfile, Wave12Deal } from "@/lib/data/types";

const REMINDER_DAYS = 3;
const CANCEL_DAYS = 14;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Allow local dev without a CRON_SECRET set so manual testing works.
    return process.env.NODE_ENV !== "production";
  }
  const header = req.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

function siteOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    "https://taylslate.com"
  );
}

interface CronResult {
  reminders_sent: number;
  cancellations: number;
  errors: string[];
}

async function loadBrandContext(deal: Wave12Deal): Promise<{
  brandName: string;
  brandEmail: string | null;
} | null> {
  const { data: bp } = await supabaseAdmin
    .from("brand_profiles")
    .select("user_id, brand_identity, brand_website")
    .eq("id", deal.brand_profile_id)
    .single();
  if (!bp) return null;
  const { data: brandUser } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", (bp as BrandProfile).user_id)
    .single();
  const brandName =
    (bp as BrandProfile).brand_identity?.split(/[.,—–-]/)[0]?.trim() ||
    (bp as BrandProfile).brand_website ||
    "Brand";
  return {
    brandName,
    brandEmail: (brandUser?.email as string | undefined) ?? null,
  };
}

async function sendReminderForDeal(
  deal: Wave12Deal,
  errors: string[]
): Promise<boolean> {
  const ctx = await loadBrandContext(deal);
  if (!ctx?.brandEmail) {
    errors.push(`deal ${deal.id}: no brand email`);
    return false;
  }
  const outreach = await getOutreachById(deal.outreach_id);
  const showName = outreach?.show_name ?? "the show";
  const daysWaiting = Math.max(
    REMINDER_DAYS,
    Math.floor((Date.now() - new Date(deal.created_at).getTime()) / 86_400_000)
  );
  const email = renderBrandSignatureReminder({
    brand_name: ctx.brandName,
    show_name: showName,
    agreed_cpm: deal.agreed_cpm,
    agreed_episode_count: deal.agreed_episode_count,
    deal_url: `${siteOrigin()}/deals/${deal.id}`,
    days_waiting: daysWaiting,
  });
  const sendResult = await sendEmail({
    to: ctx.brandEmail,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
  if (!sendResult.ok) {
    errors.push(`deal ${deal.id}: reminder send failed (${sendResult.reason})`);
  }
  // Stamp regardless — we don't want failed sends to spam the brand on the
  // next cron run. If the email broke, manual follow-up.
  await updateWave12Deal(deal.id, {
    brand_reminder_sent_at: new Date().toISOString(),
  });
  return sendResult.ok;
}

async function cancelTimedOutDeal(
  deal: Wave12Deal,
  errors: string[]
): Promise<boolean> {
  if (deal.docusign_envelope_id) {
    await voidEnvelope(deal.docusign_envelope_id, "Deal timed out (14 days)");
  }
  const updated = await updateWave12Deal(deal.id, {
    status: "cancelled",
    cancelled_at: new Date().toISOString(),
    cancellation_reason: "timeout",
  });
  if (!updated) {
    errors.push(`deal ${deal.id}: cancel update failed`);
    return false;
  }
  await logEvent({
    eventType: "io.timeout_cancelled",
    entityType: "deal",
    entityId: deal.id,
    payload: { deal: updated, days_open: CANCEL_DAYS },
  });
  // Notify show.
  const { data: sp } = await supabaseAdmin
    .from("show_profiles")
    .select("user_id")
    .eq("id", deal.show_profile_id)
    .single();
  if (sp) {
    const { data: showUser } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", (sp as ShowProfile).user_id)
      .single();
    const ctx = await loadBrandContext(deal);
    const outreach = await getOutreachById(deal.outreach_id);
    if (showUser?.email && ctx) {
      const email = renderDealCancelledShow({
        brand_name: ctx.brandName,
        show_name: outreach?.show_name ?? "your show",
        cause: "timeout",
      });
      sendEmail({
        to: showUser.email as string,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }).catch((err) => console.error("[timeout email] send failed:", err));
    }
  }
  return true;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result: CronResult = { reminders_sent: 0, cancellations: 0, errors: [] };

  // Reminders first (they're cheap; failures don't block cancels).
  const stale = await findStaleUnsignedDealsForReminder(REMINDER_DAYS);
  for (const deal of stale) {
    const ok = await sendReminderForDeal(deal, result.errors);
    if (ok) result.reminders_sent += 1;
  }

  // Cancellations.
  const expired = await findDealsToTimeoutCancel(CANCEL_DAYS);
  for (const deal of expired) {
    const ok = await cancelTimedOutDeal(deal, result.errors);
    if (ok) result.cancellations += 1;
  }

  return NextResponse.json(result);
}
