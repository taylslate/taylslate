// Thin wrapper around Resend for transactional sends.
// Returns a structured result so route handlers can decide how to react.

import { Resend } from "resend";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
  reply_to?: string;
}

export interface SendEmailResult {
  ok: boolean;
  /** "no_api_key" means RESEND_API_KEY is missing — treat as "logged" in dev. */
  reason?: "no_api_key" | "send_failed";
  error?: string;
  id?: string;
}

const DEFAULT_FROM = "Taylslate <notifications@taylslate.com>";

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email/send] RESEND_API_KEY missing — skipping send to", input.to);
    return { ok: false, reason: "no_api_key" };
  }
  const client = new Resend(apiKey);
  try {
    const { data, error } = await client.emails.send({
      from: input.from ?? DEFAULT_FROM,
      to: input.to,
      subject: input.subject,
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
