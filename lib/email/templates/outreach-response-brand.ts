// Notifies the brand when a show responds to their outreach.
// One template, three flavors keyed by the response status.

import type { OutreachResponseStatus } from "@/lib/data/types";

export interface BrandNotificationInput {
  brand_name: string;
  show_name: string;
  campaign_name: string;
  status: Extract<OutreachResponseStatus, "accepted" | "countered" | "declined">;

  /** Full URL back into the brand's dashboard. */
  campaign_url: string;
  outreach_url?: string;

  /** Original brand offer (for context in counter/decline messages). */
  proposed_cpm: number;

  /** Counter-only fields. */
  counter_cpm?: number | null;
  counter_message?: string | null;

  /** Decline-only field. */
  decline_reason?: string | null;
}

export interface RenderedBrandNotification {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderBrandNotification(
  input: BrandNotificationInput
): RenderedBrandNotification {
  const linkUrl = input.outreach_url ?? input.campaign_url;
  const ctaLabel =
    input.status === "accepted"
      ? "Build the IO"
      : input.status === "countered"
        ? "Review the counter"
        : "Plan your next move";

  const headline =
    input.status === "accepted"
      ? `${input.show_name} accepted your offer`
      : input.status === "countered"
        ? `${input.show_name} came back with a counter`
        : `${input.show_name} passed on this one`;

  const subject =
    input.status === "accepted"
      ? `Accepted: ${input.show_name} (${input.campaign_name})`
      : input.status === "countered"
        ? `Counter: ${input.show_name} — $${(input.counter_cpm ?? 0).toFixed(2)} CPM`
        : `Declined: ${input.show_name}`;

  const detailHtml: string = (() => {
    if (input.status === "accepted") {
      return `<p style="font-size:14px;color:#1f2937;line-height:1.6;margin:0 0 12px;">
        Great news — they accepted your offer at <strong>$${input.proposed_cpm.toFixed(2)} CPM</strong>.
        Build the insertion order to lock the dates and move to delivery.
      </p>`;
    }
    if (input.status === "countered") {
      const counter = input.counter_cpm ?? 0;
      const delta = counter - input.proposed_cpm;
      const deltaLabel =
        delta > 0
          ? `$${delta.toFixed(2)} above your offer`
          : delta < 0
            ? `$${Math.abs(delta).toFixed(2)} below your offer`
            : "matches your offer";
      return `<p style="font-size:14px;color:#1f2937;line-height:1.6;margin:0 0 12px;">
        They countered at <strong>$${counter.toFixed(2)} CPM</strong> (${deltaLabel}).
      </p>${
        input.counter_message
          ? `<blockquote style="margin:0 0 12px;padding:10px 14px;border-left:3px solid #2563eb;background:#f3f6ff;font-size:13px;color:#1f2937;line-height:1.55;">${escapeHtml(
              input.counter_message
            )}</blockquote>`
          : ""
      }
      <p style="font-size:14px;color:#1f2937;line-height:1.6;margin:0 0 12px;">
        Accept the counter to move forward, or send a fresh outreach with adjusted terms.
      </p>`;
    }
    return `<p style="font-size:14px;color:#1f2937;line-height:1.6;margin:0 0 12px;">
        They passed on this one${
          input.decline_reason
            ? `: <em style="color:#374151;">${escapeHtml(input.decline_reason)}</em>`
            : "."
        }
      </p>
      <p style="font-size:14px;color:#1f2937;line-height:1.6;margin:0 0 12px;">
        Head back to the campaign to pick another show.
      </p>`;
  })();

  const html = `
<!DOCTYPE html>
<html>
  <body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px 28px;">
        <div style="font-size:11px;color:#6b7280;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:6px;">
          ${escapeHtml(input.campaign_name)}
        </div>
        <h1 style="font-size:18px;font-weight:600;color:#111827;margin:0 0 16px;">${escapeHtml(headline)}</h1>
        ${detailHtml}
        <a href="${escapeHtml(linkUrl)}"
           style="display:inline-block;margin-top:8px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 20px;border-radius:8px;">
          ${escapeHtml(ctaLabel)}
        </a>
      </div>
      <div style="font-size:11px;color:#9ca3af;text-align:center;margin-top:16px;">
        Sent by Taylslate on behalf of ${escapeHtml(input.brand_name)}.
      </div>
    </div>
  </body>
</html>`.trim();

  const textLines = [
    headline,
    "",
    input.status === "accepted"
      ? `Accepted at $${input.proposed_cpm.toFixed(2)} CPM. Build the IO to move forward.`
      : input.status === "countered"
        ? `Counter at $${(input.counter_cpm ?? 0).toFixed(2)} CPM.${
            input.counter_message ? `\n\n"${input.counter_message}"` : ""
          }`
        : `They passed${input.decline_reason ? `: ${input.decline_reason}` : "."}`,
    "",
    `${ctaLabel}: ${linkUrl}`,
  ];

  return { subject, html, text: textLines.join("\n") };
}
