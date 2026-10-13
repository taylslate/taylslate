// Thin wrapper around Resend for transactional sends.
// Returns a structured result so route handlers can decide how to react.
//
// Managed brand accounts are rerouted here. Every brand-facing send should
// pass recipientProfileId when it has one. With no id, the recipient is
// looked up by the `to` address. Login and magic-link sends set
// bypassManagedReroute so Chris can still sign in as the brand.

import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
  reply_to?: string;
  /** Profile that should receive this mail. Managed profiles are rerouted. */
  recipientProfileId?: string;
  /**
   * Login and magic-link mail must reach the real address so a managed
   * brand can still be signed into. Set this to skip managed rerouting.
   */
  bypassManagedReroute?: boolean;
}

export interface SendEmailResult {
  ok: boolean;
  /** "no_api_key" means RESEND_API_KEY is missing — treat as "logged" in dev. */
  reason?: "no_api_key" | "send_failed" | "managed_inbox_unset";
  error?: string;
  id?: string;
}

export type ManagedDelivery =
  | { ok: true; to: string; subject: string }
  | { ok: false; reason: "managed_inbox_unset" };

const DEFAULT_FROM = "Taylslate <notifications@taylslate.com>";

interface ManagedHit {
  email: string | null;
  is_managed: boolean | null;
}

/**
 * Decide where a message goes. Managed recipients go to
 * MANAGED_ACCOUNT_INBOX, with the original address noted in the subject.
 * When that env var is unset, the send is skipped.
 */
export async function resolveManagedDelivery(input: {
  to: string;
  subject: string;
  recipientProfileId?: string;
  bypassManagedReroute?: boolean;
}): Promise<ManagedDelivery> {
  if (input.bypassManagedReroute) {
    return { ok: true, to: input.to, subject: input.subject };
  }

  const managed = await recipientIsManaged(input);
  if (!managed) {
    return { ok: true, to: input.to, subject: input.subject };
  }

  const inbox = process.env.MANAGED_ACCOUNT_INBOX?.trim();
  if (!inbox) {
    console.warn(
      "[email/send] MANAGED_ACCOUNT_INBOX unset — skipping send to managed recipient",
      input.to,
    );
    return { ok: false, reason: "managed_inbox_unset" };
  }

  return {
    ok: true,
    to: inbox,
    subject: `[managed: ${input.to}] ${input.subject}`,
  };
}

async function recipientIsManaged(input: {
  to: string;
  recipientProfileId?: string;
}): Promise<boolean> {
  try {
    if (input.recipientProfileId) {
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("email, is_managed")
        .eq("id", input.recipientProfileId)
        .maybeSingle();
      if (error) {
        console.error("[email/send] managed lookup failed:", error.message);
        return false;
      }
      if (data) return (data as ManagedHit).is_managed === true;
    }

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("email, is_managed")
      .ilike("email", input.to)
      .limit(5);
    if (error) {
      console.error("[email/send] managed lookup failed:", error.message);
      return false;
    }
    return (data ?? []).some((row) => (row as ManagedHit).is_managed === true);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error("[email/send] managed lookup threw:", message);
    return false;
  }
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const delivery = await resolveManagedDelivery(input);
  if (!delivery.ok) {
    return { ok: false, reason: delivery.reason };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email/send] RESEND_API_KEY missing — skipping send to", delivery.to);
    return { ok: false, reason: "no_api_key" };
  }
  const client = new Resend(apiKey);
  try {
    const { data, error } = await client.emails.send({
      from: input.from ?? DEFAULT_FROM,
      to: delivery.to,
      subject: delivery.subject,
      html: input.html,
      text: input.text,
      replyTo: input.reply_to,
    });
    if (error) {
      console.error("[email/send] Resend error:", error.message);
      return { ok: false, reason: "send_failed", error: error.message };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error("[email/send] Throw:", message);
    return { ok: false, reason: "send_failed", error: message };
  }
}
